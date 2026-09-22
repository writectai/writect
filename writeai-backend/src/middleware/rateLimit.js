const { createClient } = require('redis');
const config = require('../config');
const { getPlanRateLimits } = require('../services/usage');

let client = null;

async function getRedisClient() {
  if (client) return client;

  if (!config.redisUrl) {
    return null;
  }

  client = createClient({ url: config.redisUrl });
  client.on('error', (err) => console.error('Redis error:', err));
  await client.connect();
  return client;
}

/** Legacy IP+path rate limit (unauthenticated / generic routes). */
function rateLimit({ windowMs = 60_000, max = 60, keyPrefix = 'rl' } = {}) {
  return async (req, res, next) => {
    try {
      const redis = await getRedisClient();

      if (!redis) {
        return next();
      }

      const key = `${keyPrefix}:${req.ip}:${req.path}`;
      const count = await redis.incr(key);

      if (count === 1) {
        await redis.pExpire(key, windowMs);
      }

      if (count > max) {
        return res.status(429).json({
          error: 'rate_limit_exceeded',
          message: 'Too many requests. Please try again later.'
        });
      }

      next();
    } catch (err) {
      console.error('Rate limit error:', err.message);
      next();
    }
  };
}

/**
 * Plan-aware RPM + concurrency for authenticated AI routes.
 * Free: 5/min, 1 in-flight. Pro: 15/min, 2 in-flight.
 * Must run after authMiddleware (needs req.user).
 */
function planActionLimit({ windowMs = 60_000 } = {}) {
  return async (req, res, next) => {
    const userId = req.user?.userId;
    if (!userId) return next();

    const plan = req.user.plan === 'pro' ? 'pro' : 'free';
    const { rpm, concurrent } = getPlanRateLimits(plan);
    let acquired = false;
    let redis = null;
    const inflightKey = `action:inflight:${userId}`;

    const release = async () => {
      if (!acquired || !redis) return;
      acquired = false;
      try {
        const left = await redis.decr(inflightKey);
        if (left <= 0) await redis.del(inflightKey);
      } catch (err) {
        console.error('Concurrency release error:', err.message);
      }
    };

    try {
      redis = await getRedisClient();
      if (!redis) return next();

      const rpmKey = `action:rpm:${userId}`;
      const rpmCount = await redis.incr(rpmKey);
      if (rpmCount === 1) {
        await redis.pExpire(rpmKey, windowMs);
      }
      if (rpmCount > rpm) {
        return res.status(429).json({
          error: 'rate_limit_exceeded',
          message: plan === 'pro'
            ? 'Too many AI requests. Please wait a moment and try again.'
            : 'Free plan allows 5 AI requests per minute. Wait a moment, or upgrade to Pro.'
        });
      }

      const inflight = await redis.incr(inflightKey);
      await redis.pExpire(inflightKey, Math.max(windowMs * 5, 300_000));
      if (inflight > concurrent) {
        await redis.decr(inflightKey);
        return res.status(429).json({
          error: 'concurrency_limit_reached',
          message: plan === 'pro'
            ? 'You already have AI requests running. Wait for one to finish.'
            : 'Free plan allows 1 AI request at a time. Wait for it to finish, or upgrade to Pro.'
        });
      }
      acquired = true;

      res.on('finish', () => { release().catch(() => {}); });
      res.on('close', () => { release().catch(() => {}); });
      next();
    } catch (err) {
      console.error('Plan action limit error:', err.message);
      await release();
      next();
    }
  };
}

module.exports = { rateLimit, planActionLimit, getRedisClient };
