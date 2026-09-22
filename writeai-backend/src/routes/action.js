const router = require('express').Router();
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const { planActionLimit } = require('../middleware/rateLimit');
const { runAction, streamAction, parseAiError } = require('../services/ai');
const {
  checkUsageLimits,
  incrementCount,
  logUsage,
  getActionCost,
  applyInputCap,
  getMaxTextChars,
  getCustomerUsage
} = require('../services/usage');

const VALID_ACTIONS = [
  'fix_grammar',
  'rephrase',
  'translate',
  'summarize',
  'explain',
  'chat',
  'voice_write',
  'page_summarize',
  'page_ask',
  'meaning_lock'
];

const actionValidators = [
  body('action').isIn(VALID_ACTIONS),
  body('text').isString().custom((value, { req }) => {
    if (!value || value.length < 1) throw new Error('text is required');
    // Hard ceiling; plan-aware truncate happens after auth in the handler
    const plan = req.user?.plan === 'pro' ? 'pro' : 'free';
    const max = getMaxTextChars(req.body.action, plan);
    // Allow slightly over so we can truncate cleanly instead of 400
    if (value.length > max * 2) {
      throw new Error(`text must be at most ${max * 2} characters`);
    }
    return true;
  }),
  body('extra').optional().isString().isLength({ max: 500 }),
  body('model').optional().isString().isLength({ max: 100 }),
  body('length').optional().isIn(['short', 'medium', 'long']),
  body('forceRefresh').optional().isBoolean(),
  body('image').optional().isString().isLength({ max: 1_800_000 }),
  body('history').optional().isArray({ max: 20 }),
  body('history.*.role').optional().isIn(['user', 'assistant']),
  body('history.*.content').optional().isString().isLength({ max: 8000 }),
  body('source').optional().isIn(['selection', 'page', 'web', 'compose', 'extension'])
];

function buildOptions(req) {
  const { extra, model, length, forceRefresh, image, history } = req.body;
  return {
    forceRefresh: !!forceRefresh,
    model: model || '',
    length: length || 'medium',
    plan: req.user.plan,
    image: typeof image === 'string' && image.startsWith('data:image/') ? image : '',
    history: Array.isArray(history) ? history : []
  };
}

async function guardUsage(req, res, actionCost) {
  const { userId, plan } = req.user;
  const usage = await checkUsageLimits(userId, plan, actionCost);
  if (!usage.allowed) {
    if (usage.reason === 'daily_limit_reached') {
      res.status(403).json({
        error: 'daily_limit_reached',
        message: `You've used today's AI action limit (${usage.daily_limit}). Try again tomorrow, or upgrade for higher limits.`,
        count: usage.count,
        limit: usage.limit,
        remaining: usage.remaining,
        daily_count: usage.daily_count,
        daily_limit: usage.daily_limit,
        daily_remaining: usage.daily_remaining,
        action_cost: actionCost,
        resets_at: usage.resets_at
      });
      return null;
    }

    const isPro = plan === 'pro';
    res.status(403).json({
      error: 'monthly_limit_reached',
      message: isPro
        ? `You've used all ${usage.limit.toLocaleString()} Pro AI actions this month. Usage resets on ${usage.resets_at}.`
        : `You've used all ${usage.limit.toLocaleString()} free AI actions this month. Upgrade to Pro for higher limits.`,
      count: usage.count,
      limit: usage.limit,
      remaining: usage.remaining,
      daily_count: usage.daily_count,
      daily_limit: usage.daily_limit,
      daily_remaining: usage.daily_remaining,
      action_cost: actionCost,
      resets_at: usage.resets_at
    });
    return null;
  }
  return usage;
}

function prepareRequest(req) {
  const plan = req.user.plan === 'pro' ? 'pro' : 'free';
  const action = req.body.action;
  const length = req.body.length || 'medium';
  const capped = applyInputCap(action, plan, req.body.text);
  req.body.text = capped.text;
  const actionCost = getActionCost(action, { length, text: capped.text });
  return { plan, action, length, actionCost, truncated: capped.truncated };
}

router.post('/',
  authMiddleware,
  planActionLimit(),
  actionValidators,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { actionCost } = prepareRequest(req);
    const usageOk = await guardUsage(req, res, actionCost);
    if (!usageOk) return;

    const { userId } = req.user;
    const { action, text, extra } = req.body;

    try {
      const { result, model: usedModel, input_tokens, output_tokens, cached, meaning } = await runAction(
        action,
        text,
        extra,
        buildOptions(req)
      );

      // Always bill AI Actions — cache may skip the provider call, not the user's action.
      try {
        await incrementCount(userId, actionCost);
        await logUsage(
          userId,
          action,
          usedModel,
          cached ? 0 : (input_tokens ?? 0),
          cached ? 0 : (output_tokens ?? 0),
          actionCost
        );
      } catch (usageErr) {
        console.error('Usage accounting failed:', usageErr);
      }

      const plan = req.user.plan === 'pro' ? 'pro' : 'free';
      let usage = null;
      try {
        usage = await getCustomerUsage(userId, plan);
      } catch {
        /* ignore */
      }

      res.json({
        result,
        model: usedModel,
        cached: !!cached,
        action_cost: actionCost,
        ...(usage ? { usage } : {}),
        ...(meaning ? { meaning } : {})
      });
    } catch (err) {
      console.error('Action failed:', err);
      const parsed = parseAiError(err);
      res.status(parsed.status).json({
        error: parsed.code,
        message: parsed.message
      });
    }
  }
);

/** SSE streaming for chat. */
router.post('/stream',
  authMiddleware,
  planActionLimit(),
  actionValidators,
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { actionCost } = prepareRequest(req);
    const usageOk = await guardUsage(req, res, actionCost);
    if (!usageOk) return;

    const { userId } = req.user;
    const { action, text, extra } = req.body;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const send = (payload) => {
      if (res.writableEnded) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const { result, model: usedModel, input_tokens, output_tokens } = await streamAction(
        action,
        text,
        extra,
        buildOptions(req),
        (delta) => send({ type: 'delta', text: delta })
      );

      try {
        await incrementCount(userId, actionCost);
        await logUsage(userId, action, usedModel, input_tokens, output_tokens, actionCost);
      } catch (usageErr) {
        console.error('Usage accounting failed:', usageErr);
      }

      const plan = req.user.plan === 'pro' ? 'pro' : 'free';
      let usage = null;
      try {
        usage = await getCustomerUsage(userId, plan);
      } catch {
        /* ignore */
      }

      // Do not expose token counts to customers — admin analytics still has DB rows
      send({
        type: 'done',
        result,
        model: usedModel,
        action_cost: actionCost,
        ...(usage ? { usage } : {})
      });
      res.end();
    } catch (err) {
      console.error('Stream action failed:', err);
      const parsed = parseAiError(err);
      if (err.code === 'model_not_allowed') {
        send({ type: 'error', error: 'model_not_allowed', message: err.message || parsed.message });
      } else {
        send({ type: 'error', error: parsed.code, message: parsed.message });
      }
      res.end();
    }
  }
);

module.exports = router;
