const router = require('express').Router();
const authMiddleware = require('../middleware/auth');
const db = require('../db/postgres');
const config = require('../config');
const { getStripe } = require('../services/stripe');

function stripeConfigured() {
  return !!(config.stripe.secretKey && config.stripe.proPriceId);
}

function appUrl(path = '/app') {
  const base = (config.frontendUrl || `http://localhost:${config.port}`).replace(/\/$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

router.get('/status', authMiddleware, async (req, res) => {
  res.json({
    configured: stripeConfigured(),
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

  try {
    const stripe = getStripe();
    const { email, userId } = req.user;

    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { userId: String(userId) }
      });
      customerId = customer.id;
      await db.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, userId]);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: String(userId),
      payment_method_types: ['card'],
      line_items: [{ price: config.stripe.proPriceId, quantity: 1 }],
      mode: 'subscription',
      allow_promotion_codes: true,
      success_url: `${appUrl('/app')}?upgraded=1`,
      cancel_url: `${appUrl('/app')}?billing=cancel`,
      metadata: { userId: String(userId) },
      subscription_data: {
        metadata: { userId: String(userId) }
      }
    });

    res.json({ url: session.url });
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
      message: 'Billing portal is not available. Your plan was assigned by an admin.'
    });
  }

  try {
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({
        error: 'no_subscription',
        message: 'No billing account found. Your Pro plan was assigned by an admin.'
      });
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id,
      return_url: `${appUrl('/app')}?view=settings`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Portal error:', err);
    res.status(500).json({ error: 'portal_failed', message: 'Could not open billing portal.' });
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

        if (userId) {
          await setProFromUserId(userId, customerId, subscriptionId, 'active');
        } else if (customerId) {
          await setProFromCustomer(customerId, subscriptionId, 'active');
        }
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
        if (customerId) {
          await db.query(
            `UPDATE users SET plan = 'free', subscription_status = 'canceled', updated_at = NOW()
             WHERE stripe_customer_id = $1`,
            [customerId]
          );
        }
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
