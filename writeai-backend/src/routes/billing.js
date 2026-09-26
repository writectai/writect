const router = require('express').Router();
const authMiddleware = require('../middleware/auth');
const db = require('../db/postgres');
const config = require('../config');
const { getStripe } = require('../services/stripe');
const {
  notifySubscriptionActivated,
  notifySubscriptionCanceled,
  notifyPaymentFailed
} = require('../services/notifications');

function stripeConfigured() {
  return !!(config.stripe.secretKey && config.stripe.proPriceId);
}

function resolveProPriceId(interval) {
  if (interval === 'year') {
    return config.stripe.proYearlyPriceId || null;
  }
  return config.stripe.proPriceId || null;
}

function isStaleStripeCustomerError(err) {
  const msg = err?.message || '';
  const code = err?.code || err?.raw?.code;
  return (
    code === 'resource_missing'
    || /no such customer/i.test(msg)
    || /similar object exists in (test|live) mode/i.test(msg)
  );
}

async function clearStripeCustomer(userId) {
  await db.query(
    `UPDATE users SET
      stripe_customer_id = NULL,
      stripe_subscription_id = NULL,
      updated_at = NOW()
    WHERE id = $1`,
    [userId]
  );
}

/** Resolve a Stripe customer for this user; recreates if DB has a test/live mismatch ID. */
async function ensureStripeCustomer(stripe, user) {
  const { email, userId } = user;
  let customerId = user.stripe_customer_id;

  if (customerId) {
    try {
      await stripe.customers.retrieve(customerId);
      return customerId;
    } catch (err) {
      if (!isStaleStripeCustomerError(err)) throw err;
      console.warn(`Clearing stale Stripe customer ${customerId} for user ${userId}: ${err.message}`);
      await clearStripeCustomer(userId);
      customerId = null;
    }
  }

  const customer = await stripe.customers.create({
    email,
    metadata: { userId: String(userId) }
  });
  customerId = customer.id;
  await db.query('UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2', [customerId, userId]);
  return customerId;
}

function appUrl(path = '/app') {
  const base = (config.frontendUrl || `http://localhost:${config.port}`).replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

router.get('/status', authMiddleware, async (req, res) => {
  res.json({
    configured: stripeConfigured(),
    yearly_configured: !!(config.stripe.secretKey && config.stripe.proYearlyPriceId),
    plan: req.user.plan,
    subscription_status: req.user.subscription_status || null,
    has_billing: !!req.user.stripe_customer_id
  });
});

router.post('/checkout', authMiddleware, async (req, res) => {
  if (!stripeConfigured()) {
    return res.status(503).json({
      error: 'billing_not_configured',
      message: 'Online billing is not set up yet. Ask your admin to enable Stripe, or contact support.'
    });
  }

  if (req.user.plan === 'pro' && req.user.subscription_status === 'active') {
    return res.status(400).json({
      error: 'already_pro',
      message: 'You already have an active Pro subscription.'
    });
  }

  const interval = req.body?.interval === 'year' ? 'year' : 'month';
  const priceId = resolveProPriceId(interval);
  if (!priceId) {
    return res.status(503).json({
      error: 'billing_not_configured',
      message: interval === 'year'
        ? 'Yearly billing is not set up yet. Choose monthly, or ask your admin to add STRIPE_PRO_YEARLY_PRICE_ID.'
        : 'Online billing is not set up yet. Ask your admin to enable Stripe, or contact support.'
    });
  }

  try {
    const stripe = getStripe();
    const customerId = await ensureStripeCustomer(stripe, req.user);

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: String(req.user.userId),
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      allow_promotion_codes: true,
      success_url: `${appUrl('/app')}?upgraded=1`,
      cancel_url: `${appUrl('/app')}?billing=cancel`,
      metadata: { userId: String(req.user.userId), interval },
      subscription_data: {
        metadata: { userId: String(req.user.userId), interval }
      }
    });

    res.json({ url: session.url, interval });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({
      error: 'checkout_failed',
      message: err.message || 'Could not create checkout session.'
    });
  }
});

router.post('/portal', authMiddleware, async (req, res) => {
  if (!stripeConfigured()) {
    return res.status(503).json({
      error: 'billing_not_configured',
      message: 'Billing portal is not available. Ask your admin to enable Stripe.'
    });
  }

  try {
    const stripe = getStripe();
    let customerId = req.user.stripe_customer_id;

    if (!customerId) {
      return res.status(400).json({
        error: 'no_subscription',
        message: 'No billing account found. Upgrade to Pro first, or contact support if an admin assigned your plan.'
      });
    }

    try {
      await stripe.customers.retrieve(customerId);
    } catch (err) {
      if (isStaleStripeCustomerError(err)) {
        await clearStripeCustomer(req.user.userId);
        return res.status(400).json({
          error: 'billing_reset',
          message: 'Your billing account was from Stripe test mode. Click Upgrade to Pro to set up live billing.'
        });
      }
      throw err;
    }

    // Stripe requires an active Customer Portal configuration (Dashboard or API).
    // Create a default one if missing so Manage billing works out of the box.
    let configurationId;
    try {
      const existing = await stripe.billingPortal.configurations.list({ limit: 1 });
      configurationId = existing.data.find((c) => c.active !== false)?.id || existing.data[0]?.id;
      if (!configurationId) {
        const created = await stripe.billingPortal.configurations.create({
          business_profile: {
            headline: 'Manage your Writect Pro subscription'
          },
          features: {
            customer_update: {
              enabled: true,
              allowed_updates: ['email', 'address', 'name']
            },
            invoice_history: { enabled: true },
            payment_method_update: { enabled: true },
            subscription_cancel: {
              enabled: true,
              mode: 'at_period_end',
              proration_behavior: 'none'
            },
            subscription_update: { enabled: false }
          }
        });
        configurationId = created.id;
      }
    } catch (cfgErr) {
      console.error('Portal configuration error:', cfgErr.message);
    }

    const sessionParams = {
      customer: customerId,
      return_url: `${appUrl('/app')}?view=settings`
    };
    if (configurationId) sessionParams.configuration = configurationId;

    const session = await stripe.billingPortal.sessions.create(sessionParams);

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    const hint = /configuration|portal/i.test(err.message || '')
      ? ' Enable Customer Portal in Stripe Dashboard → Settings → Billing → Customer portal.'
      : '';
    res.status(500).json({
      error: 'portal_failed',
      message: (err.message || 'Could not open billing portal.') + hint
    });
  }
});

async function setProFromCustomer(customerId, subscriptionId, status) {
  const plan = status === 'active' || status === 'trialing' ? 'pro' : 'free';
  await db.query(
    `UPDATE users SET
      plan = $1,
      stripe_subscription_id = COALESCE($2, stripe_subscription_id),
      subscription_status = $3,
      updated_at = NOW()
    WHERE stripe_customer_id = $4`,
    [plan, subscriptionId || null, status, customerId]
  );
}

async function setProFromUserId(userId, customerId, subscriptionId, status) {
  const plan = status === 'active' || status === 'trialing' ? 'pro' : 'free';
  await db.query(
    `UPDATE users SET
      plan = $1,
      stripe_customer_id = COALESCE($2, stripe_customer_id),
      stripe_subscription_id = COALESCE($3, stripe_subscription_id),
      subscription_status = $4,
      updated_at = NOW()
    WHERE id = $5`,
    [plan, customerId || null, subscriptionId || null, status, userId]
  );
}

router.post('/webhook', async (req, res) => {
  if (!config.stripe.secretKey || !config.stripe.webhookSecret) {
    return res.status(503).send('Stripe webhook not configured');
  }

  const stripe = getStripe();
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, config.stripe.webhookSecret);
  } catch (err) {
    console.error('Webhook signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode !== 'subscription') break;
        const userId = session.metadata?.userId || session.client_reference_id;
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const subscriptionId = typeof session.subscription === 'string'
          ? session.subscription
          : session.subscription?.id;
        const interval = session.metadata?.interval === 'year' ? 'year' : 'month';

        if (userId) {
          await setProFromUserId(userId, customerId, subscriptionId, 'active');
        } else if (customerId) {
          await setProFromCustomer(customerId, subscriptionId, 'active');
        }

        notifySubscriptionActivated({
          userId,
          customerId,
          subscriptionId,
          interval,
          status: 'active'
        });
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id;
        const userId = subscription.metadata?.userId;
        if (userId) {
          await setProFromUserId(userId, customerId, subscription.id, subscription.status);
        } else if (customerId) {
          await setProFromCustomer(customerId, subscription.id, subscription.status);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer?.id;
        const userId = subscription.metadata?.userId;
        if (customerId) {
          await db.query(
            `UPDATE users SET plan = 'free', subscription_status = 'canceled', updated_at = NOW()
             WHERE stripe_customer_id = $1`,
            [customerId]
          );
        }
        notifySubscriptionCanceled({
          userId,
          customerId,
          subscriptionId: subscription.id
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        if (customerId) {
          await db.query(
            `UPDATE users SET subscription_status = 'past_due', updated_at = NOW()
             WHERE stripe_customer_id = $1`,
            [customerId]
          );
        }
        notifyPaymentFailed({ customerId });
        break;
      }

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    res.status(500).json({ error: 'webhook_handler_failed' });
  }
});

module.exports = router;
