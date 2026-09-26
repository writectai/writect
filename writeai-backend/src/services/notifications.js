const db = require('../db/postgres');
const { sendMail, sendToAdmins, mailConfigured } = require('./mail');
const templates = require('./emailTemplates');

function fireAndForget(promise, label) {
  Promise.resolve(promise).catch((err) => {
    console.error(`[notify] ${label}:`, err.message || err);
  });
}

async function findUserById(id) {
  if (!id) return null;
  const { rows } = await db.query(
    `SELECT id, email, name, plan, subscription_status, stripe_customer_id, stripe_subscription_id
     FROM users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function findUserByCustomerId(customerId) {
  if (!customerId) return null;
  const { rows } = await db.query(
    `SELECT id, email, name, plan, subscription_status, stripe_customer_id, stripe_subscription_id
     FROM users WHERE stripe_customer_id = $1 LIMIT 1`,
    [customerId]
  );
  return rows[0] || null;
}

async function notifySignup(user, { method } = {}) {
  if (!user?.email || !mailConfigured()) return;
  const signMethod = method === 'google' ? 'google' : 'password';

  const userMail = templates.welcomeUser({
    name: user.name,
    email: user.email,
    method: signMethod
  });
  const adminMail = templates.welcomeAdmin({
    name: user.name,
    email: user.email,
    method: signMethod,
    userId: user.id
  });

  fireAndForget(
    Promise.all([
      sendMail({ to: user.email, ...userMail }),
      sendToAdmins(adminMail)
    ]),
    'signup'
  );
}

async function notifySubscriptionActivated({ userId, customerId, subscriptionId, interval, status }) {
  if (!mailConfigured()) return;

  let user = userId ? await findUserById(userId) : null;
  if (!user && customerId) user = await findUserByCustomerId(customerId);
  if (!user?.email) return;

  const billingInterval = interval === 'year' ? 'year' : 'month';
  const userMail = templates.subscriptionUser({
    name: user.name,
    email: user.email,
    interval: billingInterval,
    status: status || 'active'
  });
  const adminMail = templates.subscriptionAdmin({
    name: user.name,
    email: user.email,
    userId: user.id,
    interval: billingInterval,
    status: status || 'active',
    subscriptionId: subscriptionId || user.stripe_subscription_id
  });

  fireAndForget(
    Promise.all([
      sendMail({ to: user.email, ...userMail }),
      sendToAdmins(adminMail)
    ]),
    'subscription_activated'
  );
}

async function notifySubscriptionCanceled({ userId, customerId, subscriptionId }) {
  if (!mailConfigured()) return;

  let user = userId ? await findUserById(userId) : null;
  if (!user && customerId) user = await findUserByCustomerId(customerId);
  if (!user?.email) return;

  const userMail = templates.cancellationUser({ name: user.name, email: user.email });
  const adminMail = templates.cancellationAdmin({
    name: user.name,
    email: user.email,
    userId: user.id,
    subscriptionId: subscriptionId || user.stripe_subscription_id
  });

  fireAndForget(
    Promise.all([
      sendMail({ to: user.email, ...userMail }),
      sendToAdmins(adminMail)
    ]),
    'subscription_canceled'
  );
}

async function notifyPaymentFailed({ userId, customerId }) {
  if (!mailConfigured()) return;

  let user = userId ? await findUserById(userId) : null;
  if (!user && customerId) user = await findUserByCustomerId(customerId);
  if (!user?.email) return;

  const userMail = templates.paymentFailedUser({ name: user.name, email: user.email });
  const adminMail = templates.paymentFailedAdmin({
    name: user.name,
    email: user.email,
    userId: user.id
  });

  fireAndForget(
    Promise.all([
      sendMail({ to: user.email, ...userMail }),
      sendToAdmins(adminMail)
    ]),
    'payment_failed'
  );
}

module.exports = {
  notifySignup,
  notifySubscriptionActivated,
  notifySubscriptionCanceled,
  notifyPaymentFailed,
  mailConfigured
};
