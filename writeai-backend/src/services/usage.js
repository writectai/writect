const db = require('../db/postgres');
const { getSetting } = require('./settings');

/** Customer-facing defaults (Writect_Simple_Plan_Setup.md). Tokens are admin-only. */
const DEFAULT_FREE_MONTHLY_ACTIONS = 300;
const DEFAULT_FREE_DAILY_ACTIONS = 10;
const DEFAULT_PRO_MONTHLY_ACTIONS = 3000;
const DEFAULT_PRO_DAILY_ACTIONS = 150;
/** Internal soft reference only — not enforced for customers */
const DEFAULT_FREE_TOKENS = 50_000;

/** ~4 chars per token estimate for input sizing */
const CHARS_PER_TOKEN = 4;

/** Input token caps (backend only — not shown on pricing) */
const INPUT_TOKEN_CAPS = {
  free_normal: 2000,
  pro_normal: 4000,
  free_page: 3000,
  pro_page: 12000
};

/** Output token caps for generative replies */
const OUTPUT_TOKEN_CAPS = {
  free_normal: 600,
  pro_normal: 1200
};

/** Rate limits (boss plan) */
const RATE_LIMITS = {
  free: { rpm: 5, concurrent: 1 },
  pro: { rpm: 15, concurrent: 2 }
};

const PAGE_ACTIONS = new Set(['page_summarize', 'page_ask']);
const REWRITE_ACTIONS = new Set(['fix_grammar', 'rephrase', 'translate', 'meaning_lock', 'voice_write']);

/** -1 (or any negative) means unlimited → null */
function normalizeLimit(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < 0) return null;
  return Math.floor(n);
}

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

function tokensToChars(tokens) {
  return Math.max(0, Math.floor(Number(tokens) || 0) * CHARS_PER_TOKEN);
}

function getInputTokenCap(action, plan) {
  const isPro = plan === 'pro';
  if (PAGE_ACTIONS.has(action)) {
    return isPro ? INPUT_TOKEN_CAPS.pro_page : INPUT_TOKEN_CAPS.free_page;
  }
  return isPro ? INPUT_TOKEN_CAPS.pro_normal : INPUT_TOKEN_CAPS.free_normal;
}

function getMaxTextChars(action, plan) {
  return tokensToChars(getInputTokenCap(action, plan));
}

/**
 * Weighted AI Actions (boss plan):
 * - Normal tools / short-medium chat → 1
 * - Long writing → 2
 * - Page Assistant → 3
 * - Very large webpage / request → 5
 */
function getActionCost(action, { length = 'medium', text = '' } = {}) {
  const tokens = estimateTokens(text);

  if (PAGE_ACTIONS.has(action)) {
    return tokens >= 8000 ? 5 : 3;
  }

  if (action === 'chat' && length === 'long') {
    return tokens >= 8000 ? 5 : 2;
  }

  if (tokens >= 8000) return 5;

  return 1;
}

async function getLimitsConfig() {
  return getSetting('limits');
}

async function getFreeMonthlyLimit() {
  const limits = await getLimitsConfig();
  return normalizeLimit(limits.free_monthly_actions, DEFAULT_FREE_MONTHLY_ACTIONS);
}

async function getFreeDailyLimit() {
  const limits = await getLimitsConfig();
  return normalizeLimit(limits.free_daily_actions, DEFAULT_FREE_DAILY_ACTIONS);
}

async function getProMonthlyLimit() {
  const limits = await getLimitsConfig();
  return normalizeLimit(limits.pro_monthly_actions, DEFAULT_PRO_MONTHLY_ACTIONS);
}

async function getProDailyLimit() {
  const limits = await getLimitsConfig();
  return normalizeLimit(limits.pro_daily_actions, DEFAULT_PRO_DAILY_ACTIONS);
}

/** @deprecated use getFreeMonthlyLimit */
async function getFreeLimit() {
  return getFreeMonthlyLimit();
}

async function getFreeTokenLimit() {
  const limits = await getLimitsConfig();
  return normalizeLimit(limits.free_monthly_tokens, DEFAULT_FREE_TOKENS);
}

async function getPlanActionLimits(plan) {
  const isPro = plan === 'pro';
  const [monthly, daily] = await Promise.all([
    isPro ? getProMonthlyLimit() : getFreeMonthlyLimit(),
    isPro ? getProDailyLimit() : getFreeDailyLimit()
  ]);
  return { monthly, daily, isPro };
}

function getPlanRateLimits(plan) {
  return plan === 'pro' ? RATE_LIMITS.pro : RATE_LIMITS.free;
}

async function getMonthlyCount(userId) {
  const monthYear = new Date().toISOString().slice(0, 7);
  const result = await db.query(
    `SELECT action_count FROM monthly_counts
     WHERE user_id = $1 AND month_year = $2`,
    [userId, monthYear]
  );
  return result.rows[0]?.action_count || 0;
}

async function getDailyCount(userId) {
  const result = await db.query(
    `SELECT COALESCE(SUM(COALESCE(action_cost, 1)), 0)::int AS c
     FROM usage
     WHERE user_id = $1
       AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
    [userId]
  );
  return result.rows[0]?.c || 0;
}

async function getMonthlyTokens(userId) {
  const monthYear = new Date().toISOString().slice(0, 7);
  const result = await db.query(
    `SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::int AS tokens
     FROM usage
     WHERE user_id = $1 AND month_year = $2`,
    [userId, monthYear]
  );
  return result.rows[0]?.tokens || 0;
}

/** First day of next UTC month (ISO date YYYY-MM-DD). */
function getMonthResetDate() {
  const now = new Date();
  const reset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return reset.toISOString().slice(0, 10);
}

function remainingOf(used, limit) {
  if (limit == null) return null;
  return Math.max(0, limit - (used || 0));
}

/**
 * Enforce AI Actions only (monthly + daily), including weighted cost.
 * Tokens are logged for admin cost — never used to block customers.
 */
async function checkUsageLimits(userId, plan, cost = 1) {
  const actionCost = Math.max(1, Math.floor(Number(cost) || 1));
  const { monthly, daily, isPro } = await getPlanActionLimits(plan);
  const [count, dailyCount] = await Promise.all([
    getMonthlyCount(userId),
    getDailyCount(userId)
  ]);

  const base = {
    count,
    limit: monthly,
    remaining: remainingOf(count, monthly),
    daily_count: dailyCount,
    daily_limit: daily,
    daily_remaining: remainingOf(dailyCount, daily),
    resets_at: getMonthResetDate(),
    plan: isPro ? 'pro' : 'free',
    action_cost: actionCost
  };

  if (monthly != null && count + actionCost > monthly) {
    return {
      ...base,
      allowed: false,
      reason: 'monthly_limit_reached'
    };
  }

  if (daily != null && dailyCount + actionCost > daily) {
    return {
      ...base,
      allowed: false,
      reason: 'daily_limit_reached'
    };
  }

  return {
    ...base,
    allowed: true,
    reason: null
  };
}

async function canPerformAction(userId, plan, cost = 1) {
  const check = await checkUsageLimits(userId, plan, cost);
  return check.allowed;
}

async function incrementCount(userId, cost = 1) {
  const monthYear = new Date().toISOString().slice(0, 7);
  const n = Math.max(1, Math.floor(Number(cost) || 1));
  await db.query(
    `INSERT INTO monthly_counts (user_id, month_year, action_count)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, month_year)
     DO UPDATE SET action_count = monthly_counts.action_count + $3`,
    [userId, monthYear, n]
  );
}

async function logUsage(userId, action, model, inputTokens, outputTokens, actionCost = 1) {
  const monthYear = new Date().toISOString().slice(0, 7);
  const cost = Math.max(1, Math.floor(Number(actionCost) || 1));
  await db.query(
    `INSERT INTO usage (user_id, action, model, input_tokens, output_tokens, month_year, action_cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, action, model, inputTokens ?? 0, outputTokens ?? 0, monthYear, cost]
  );
}

/** Customer-safe usage payload (no tokens). */
async function getCustomerUsage(userId, plan) {
  const check = await checkUsageLimits(userId, plan, 1);
  return {
    plan: plan === 'pro' ? 'pro' : 'free',
    count: check.count,
    limit: check.limit,
    remaining: check.remaining,
    daily_count: check.daily_count,
    daily_limit: check.daily_limit,
    daily_remaining: check.daily_remaining,
    resets_at: check.resets_at
  };
}

/**
 * Truncate request text to the plan's input token cap.
 * Returns { text, truncated }.
 */
function applyInputCap(action, plan, text) {
  const maxChars = getMaxTextChars(action, plan);
  const raw = String(text || '');
  if (raw.length <= maxChars) {
    return { text: raw, truncated: false, max_chars: maxChars };
  }
  return {
    text: raw.slice(0, maxChars),
    truncated: true,
    max_chars: maxChars
  };
}

module.exports = {
  canPerformAction,
  checkUsageLimits,
  incrementCount,
  logUsage,
  getMonthlyCount,
  getDailyCount,
  getMonthlyTokens,
  getFreeLimit,
  getFreeMonthlyLimit,
  getFreeDailyLimit,
  getProMonthlyLimit,
  getProDailyLimit,
  getFreeTokenLimit,
  getPlanActionLimits,
  getPlanRateLimits,
  getCustomerUsage,
  getMonthResetDate,
  normalizeLimit,
  getActionCost,
  getInputTokenCap,
  getMaxTextChars,
  applyInputCap,
  estimateTokens,
  OUTPUT_TOKEN_CAPS,
  INPUT_TOKEN_CAPS,
  RATE_LIMITS,
  PAGE_ACTIONS,
  REWRITE_ACTIONS,
  FREE_LIMIT: DEFAULT_FREE_MONTHLY_ACTIONS,
  FREE_TOKEN_LIMIT: DEFAULT_FREE_TOKENS,
  DEFAULT_FREE_MONTHLY_ACTIONS,
  DEFAULT_FREE_DAILY_ACTIONS,
  DEFAULT_PRO_MONTHLY_ACTIONS,
  DEFAULT_PRO_DAILY_ACTIONS
};
