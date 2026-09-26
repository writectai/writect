const config = require('../config');

function siteUrl(path = '/') {
  const base = (config.frontendUrl || 'https://writect.ai').replace(/\/$/, '');
  if (!path || path === '/') return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function layout({ title, preheader, bodyHtml }) {
  const brand = siteUrl('/');
  const logo = siteUrl('/img/Writect-AI-logo.png');
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(title)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#F4F6FB;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
    ${escapeHtml(preheader || title)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F4F6FB;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid #E8ECF4;box-shadow:0 12px 40px rgba(11,31,68,0.08);">
          <tr>
            <td style="padding:0;background:linear-gradient(135deg,#F21862 0%,#6B0FB3 100%);height:6px;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:28px 32px 8px;text-align:left;">
              <a href="${brand}" style="text-decoration:none;">
                <img src="${logo}" alt="Writect AI" width="140" height="32" style="display:block;border:0;height:32px;width:auto;max-width:160px;">
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 32px 8px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 28px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F8F9FC;border-radius:14px;border:1px solid #EEF1F7;">
                <tr>
                  <td style="padding:16px 18px;font-size:12px;line-height:1.55;color:#6B7289;">
                    Questions? Email <a href="mailto:support@writect.ai" style="color:#F21862;text-decoration:none;font-weight:600;">support@writect.ai</a>
                    · <a href="${siteUrl('/privacy')}" style="color:#6B0FB3;text-decoration:none;">Privacy</a>
                    · <a href="${siteUrl('/terms')}" style="color:#6B0FB3;text-decoration:none;">Terms</a>
                    <br>
                    © ${year} Writect · Operated by Websrow FZE
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
        <p style="margin:18px 0 0;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:11px;color:#9AA3B5;text-align:center;">
          You’re receiving this because of activity on your Writect account.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function heading(text) {
  return `<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:750;letter-spacing:-0.02em;color:#0B1F44;">${escapeHtml(text)}</h1>`;
}

function para(text) {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#3D4A63;">${text}</p>`;
}

function detailTable(rows) {
  const cells = rows
    .filter((r) => Array.isArray(r) && r[1] != null && String(r[1]) !== '')
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #EEF1F7;font-size:13px;color:#6B7289;width:38%;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #EEF1F7;font-size:13px;color:#0B1F44;font-weight:600;vertical-align:top;">${escapeHtml(String(value))}</td>
      </tr>`
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px;">${cells}</table>`;
}

function cta(label, href) {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;">
    <tr>
      <td style="border-radius:12px;background:linear-gradient(135deg,#F21862 0%,#6B0FB3 100%);">
        <a href="${href}" style="display:inline-block;padding:14px 22px;font-family:'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.01em;">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

function pill(text, tone = 'brand') {
  const bg = tone === 'ok' ? '#E8F8EF' : tone === 'warn' ? '#FFF4E5' : '#F8E8F0';
  const color = tone === 'ok' ? '#0F7A3F' : tone === 'warn' ? '#9A5B00' : '#9B1050';
  return `<span style="display:inline-block;padding:4px 10px;border-radius:999px;background:${bg};color:${color};font-size:12px;font-weight:700;">${escapeHtml(text)}</span>`;
}

function welcomeUser({ name, email, method }) {
  const display = name || email.split('@')[0];
  const methodLabel = method === 'google' ? 'Google' : 'Email & password';
  const html = layout({
    title: 'Welcome to Writect',
    preheader: `Hi ${display}, your Writect account is ready.`,
    bodyHtml: `
      ${heading(`Welcome to Writect, ${display}`)}
      ${para('Your account is ready. Write better emails, messages, and docs — right where you work.')}
      ${detailTable([
        ['Account', email],
        ['Sign-in method', methodLabel],
        ['Plan', 'Free']
      ])}
      ${cta('Open Writect', siteUrl('/app'))}
      ${para(`Install the free Chrome extension anytime from <a href="${siteUrl('/')}" style="color:#F21862;text-decoration:none;font-weight:600;">writect.ai</a>.`)}
    `
  });
  return {
    subject: 'Welcome to Writect — your account is ready',
    html,
    text: `Welcome to Writect, ${display}. Your account (${email}) is ready. Open ${siteUrl('/app')}`
  };
}

function welcomeAdmin({ name, email, method, userId }) {
  const methodLabel = method === 'google' ? 'Google' : 'Email & password';
  const html = layout({
    title: 'New Writect signup',
    preheader: `New user: ${email}`,
    bodyHtml: `
      ${heading('New user signup')}
      ${para('A new Writect account was created.')}
      ${detailTable([
        ['Name', name || '—'],
        ['Email', email],
        ['Sign-in method', methodLabel],
        ['User ID', userId],
        ['Plan', 'Free'],
        ['Time', new Date().toISOString()]
      ])}
      ${cta('Open admin', siteUrl('/admin/'))}
    `
  });
  return {
    subject: `New signup — ${email}`,
    html,
    text: `New Writect signup: ${name || ''} <${email}> via ${methodLabel} (id ${userId})`
  };
}

function subscriptionUser({ name, email, interval, status }) {
  const display = name || email.split('@')[0];
  const isYear = interval === 'year';
  const planLabel = isYear ? 'Pro · Yearly ($99.99/year)' : 'Pro · Monthly ($9.99/month)';
  const html = layout({
    title: 'You are on Writect Pro',
    preheader: `Thanks ${display} — Pro is active.`,
    bodyHtml: `
      ${heading('You’re on Writect Pro')}
      <p style="margin:0 0 14px;">${pill('Pro active', 'ok')}</p>
      ${para(`Thanks, ${escapeHtml(display)}. Your subscription is confirmed. Enjoy higher limits, all models, and full Page Assistant.`)}
      ${detailTable([
        ['Account', email],
        ['Plan', planLabel],
        ['Status', status || 'active'],
        ['Billing', isYear ? 'Billed yearly · cancel anytime' : 'Billed monthly · cancel anytime']
      ])}
      ${cta('Go to your account', siteUrl('/app'))}
      ${para(`Manage billing anytime in <a href="${siteUrl('/app')}" style="color:#F21862;text-decoration:none;font-weight:600;">Settings → Manage billing</a>.`)}
    `
  });
  return {
    subject: 'Welcome to Writect Pro',
    html,
    text: `You’re on Writect Pro (${planLabel}). Manage billing at ${siteUrl('/app')}`
  };
}

function subscriptionAdmin({ name, email, userId, interval, status, subscriptionId }) {
  const isYear = interval === 'year';
  const planLabel = isYear ? 'Pro Yearly' : 'Pro Monthly';
  const html = layout({
    title: 'New Pro subscription',
    preheader: `${email} upgraded to ${planLabel}`,
    bodyHtml: `
      ${heading('New Pro subscription')}
      <p style="margin:0 0 14px;">${pill(planLabel, 'brand')}</p>
      ${para('A user upgraded to Writect Pro.')}
      ${detailTable([
        ['Name', name || '—'],
        ['Email', email],
        ['User ID', userId || '—'],
        ['Plan', planLabel],
        ['Status', status || 'active'],
        ['Subscription ID', subscriptionId || '—'],
        ['Time', new Date().toISOString()]
      ])}
      ${cta('Open admin', siteUrl('/admin/'))}
    `
  });
  return {
    subject: `Pro upgrade — ${email} (${planLabel})`,
    html,
    text: `Pro upgrade: ${email} → ${planLabel} (${status || 'active'}) sub=${subscriptionId || 'n/a'}`
  };
}

function cancellationUser({ name, email }) {
  const display = name || email.split('@')[0];
  const html = layout({
    title: 'Pro subscription canceled',
    preheader: 'Your Writect Pro plan has been canceled.',
    bodyHtml: `
      ${heading('Pro subscription canceled')}
      <p style="margin:0 0 14px;">${pill('Canceled', 'warn')}</p>
      ${para(`Hi ${escapeHtml(display)}, your Writect Pro subscription has been canceled. Your account is now on the Free plan.`)}
      ${detailTable([
        ['Account', email],
        ['Current plan', 'Free']
      ])}
      ${cta('Upgrade again anytime', siteUrl('/#pricing'))}
      ${para('We’re sorry to see you go — you can resubscribe whenever you’re ready.')}
    `
  });
  return {
    subject: 'Your Writect Pro subscription was canceled',
    html,
    text: `Your Writect Pro subscription was canceled. Account ${email} is now Free. ${siteUrl('/#pricing')}`
  };
}

function cancellationAdmin({ name, email, userId, subscriptionId }) {
  const html = layout({
    title: 'Pro canceled',
    preheader: `${email} canceled Pro`,
    bodyHtml: `
      ${heading('Pro subscription canceled')}
      ${detailTable([
        ['Name', name || '—'],
        ['Email', email],
        ['User ID', userId || '—'],
        ['Subscription ID', subscriptionId || '—'],
        ['Time', new Date().toISOString()]
      ])}
    `
  });
  return {
    subject: `Pro canceled — ${email}`,
    html,
    text: `Pro canceled: ${email} (id ${userId || 'n/a'})`
  };
}

function paymentFailedUser({ name, email }) {
  const display = name || email.split('@')[0];
  const html = layout({
    title: 'Payment failed',
    preheader: 'Update your payment method to keep Pro.',
    bodyHtml: `
      ${heading('Payment failed')}
      <p style="margin:0 0 14px;">${pill('Action needed', 'warn')}</p>
      ${para(`Hi ${escapeHtml(display)}, we couldn’t process your Writect Pro payment. Please update your card to avoid losing Pro access.`)}
      ${cta('Update billing', siteUrl('/app'))}
      ${para('Open Settings → Manage billing to update your payment method.')}
    `
  });
  return {
    subject: 'Writect Pro payment failed — action needed',
    html,
    text: `Payment failed for ${email}. Update billing at ${siteUrl('/app')}`
  };
}

function paymentFailedAdmin({ name, email, userId }) {
  const html = layout({
    title: 'Payment failed',
    preheader: `Payment failed for ${email}`,
    bodyHtml: `
      ${heading('Pro payment failed')}
      ${detailTable([
        ['Name', name || '—'],
        ['Email', email],
        ['User ID', userId || '—'],
        ['Time', new Date().toISOString()]
      ])}
    `
  });
  return {
    subject: `Payment failed — ${email}`,
    html,
    text: `Payment failed: ${email}`
  };
}

function passwordResetUser({ name, email, resetUrl }) {
  const display = name || email.split('@')[0];
  const html = layout({
    title: 'Reset your password',
    preheader: 'Use this link to reset your Writect password.',
    bodyHtml: `
      ${heading('Reset your password')}
      ${para(`Hi ${escapeHtml(display)}, we received a request to reset the password for <strong>${escapeHtml(email)}</strong>.`)}
      ${cta('Reset password', resetUrl)}
      ${para('This link expires in 1 hour. If you didn’t ask for a reset, you can ignore this email.')}
      <p style="margin:0 0 14px;font-size:12px;line-height:1.55;color:#6B7289;word-break:break-all;">Or copy this link:<br>${escapeHtml(resetUrl)}</p>
    `
  });
  return {
    subject: 'Reset your Writect password',
    html,
    text: `Reset your Writect password: ${resetUrl}`
  };
}

module.exports = {
  siteUrl,
  welcomeUser,
  welcomeAdmin,
  subscriptionUser,
  subscriptionAdmin,
  cancellationUser,
  cancellationAdmin,
  paymentFailedUser,
  paymentFailedAdmin,
  passwordResetUser
};
