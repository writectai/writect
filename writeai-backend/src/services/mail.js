const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function mailConfigured() {
  const m = config.mail;
  if (!m || m.driver !== 'smtp') return false;
  return !!(m.host && m.port && m.user && m.pass);
}

function getTransporter() {
  if (!mailConfigured()) return null;
  if (transporter) return transporter;

  const m = config.mail;
  transporter = nodemailer.createTransport({
    host: m.host,
    port: m.port,
    secure: m.secure,
    auth: {
      user: m.user,
      pass: m.pass
    }
  });
  return transporter;
}

/**
 * Send an email. Never throws to callers — logs and returns { ok, error }.
 */
async function sendMail({ to, subject, html, text }) {
  if (!to) return { ok: false, error: 'missing_to' };
  const tx = getTransporter();
  if (!tx) {
    console.warn(`[mail] skipped (not configured): ${subject} → ${to}`);
    return { ok: false, error: 'mail_not_configured' };
  }

  try {
    const info = await tx.sendMail({
      from: config.mail.from,
      ...(config.mail.replyTo ? { replyTo: config.mail.replyTo } : {}),
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    });
    console.log(`[mail] sent: ${subject} → ${to} (${info.messageId || 'ok'})`);
    return { ok: true, id: info.messageId };
  } catch (err) {
    console.error(`[mail] failed: ${subject} → ${to}:`, err.message);
    return { ok: false, error: err.message };
  }
}

async function sendToAdmins({ subject, html, text }) {
  const admins = config.adminEmails || [];
  if (!admins.length) {
    console.warn('[mail] no ADMIN_EMAILS configured for admin notifications');
    return { ok: false, error: 'no_admin_emails' };
  }
  const results = await Promise.all(
    admins.map((email) => sendMail({ to: email, subject, html, text }))
  );
  return { ok: results.some((r) => r.ok), results };
}

module.exports = {
  mailConfigured,
  sendMail,
  sendToAdmins
};
