const router = require('express').Router();
const authMiddleware = require('../middleware/auth');
const config = require('../config');
const { getCustomerUsage } = require('../services/usage');
const { getSetting } = require('../services/settings');
const { getModelConfig, resolveModelList, isModelAllowedForPlan } = require('../services/ai');

router.get('/announcement', async (req, res) => {
  const announcement = await getSetting('announcement');
  if (!announcement.enabled) return res.json({ announcement: null });
  res.json({ announcement: { message: announcement.message, type: announcement.type } });
});

router.get('/models', authMiddleware, async (req, res) => {
  const plan = req.user.plan === 'pro' ? 'pro' : 'free';
  const models = await getModelConfig();
  const list = resolveModelList(models).filter((m) => {
    if (m.provider === 'gemini') {
      if (!models.gemini_enabled) return false;
    } else if (!models.gpt_enabled) {
      return false;
    }
    return isModelAllowedForPlan(m.id, plan);
  });

  res.json({
    primary: models.primary,
    fallback: models.fallback,
    plan,
    models: list.map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      free: !!m.free || isModelAllowedForPlan(m.id, 'free')
    }))
  });
});

router.get('/me', authMiddleware, async (req, res) => {
  const {
    userId, email, name, avatar_url, plan, subscription_status, stripe_customer_id,
    has_password, has_google, auth_provider
  } = req.user;
  const isPro = plan === 'pro';
  const usage = await getCustomerUsage(userId, isPro ? 'pro' : 'free');
  const billingConfigured = !!(config.stripe.secretKey && config.stripe.proPriceId);

  const signInMethod = has_password && has_google
    ? 'Email & password (Google linked)'
    : has_password
      ? 'Email & password'
      : 'Google';

  res.json({
    email,
    name,
    avatar_url,
    plan,
    subscription_status: subscription_status || (isPro ? 'active' : 'none'),
    has_billing: !!stripe_customer_id,
    billing_configured: billingConfigured,
    has_password: !!has_password,
    has_google: !!has_google,
    auth_provider: auth_provider || (has_google && !has_password ? 'google' : 'password'),
    sign_in_method: signInMethod,
    usage
  });
});

router.patch('/me', authMiddleware, async (req, res) => {
  const rawName = req.body?.name;
  if (typeof rawName !== 'string') {
    return res.status(400).json({ error: 'validation_error', message: 'Username is required.' });
  }
  let name = rawName.trim().slice(0, 80);
  if (!name) {
    name = String(req.user.email || 'user').split('@')[0].slice(0, 80) || 'user';
  }
  if (name.length < 2) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Username must be at least 2 characters.'
    });
  }

  const db = require('../db/postgres');
  const result = await db.query(
    `UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2
     RETURNING email, name, avatar_url`,
    [name, req.user.userId]
  );
  const row = result.rows[0];
  if (!row) {
    return res.status(404).json({ error: 'user_not_found', message: 'User not found.' });
  }
  res.json({
    ok: true,
    email: row.email,
    name: row.name,
    avatar_url: row.avatar_url,
    message: 'Username updated.'
  });
});

module.exports = router;
