require('dotenv').config();

function stripTrailingSlash(url) {
  return typeof url === 'string' ? url.replace(/\/$/, '') : url;
}

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '30d'
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: stripTrailingSlash(process.env.GOOGLE_CALLBACK_URL)
  },
  openaiApiKey: process.env.OPENAI_API_KEY,
  geminiApiKey: process.env.GEMINI_API_KEY,
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    proPriceId: process.env.STRIPE_PRO_PRICE_ID,
    proYearlyPriceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID
  },
  frontendUrl: stripTrailingSlash(process.env.FRONTEND_URL),
  extensionOrigin: process.env.EXTENSION_ORIGIN,
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  mail: {
    driver: (process.env.MAIL_DRIVER || '').toLowerCase(),
    host: process.env.MAIL_HOST || '',
    port: parseInt(process.env.MAIL_PORT, 10) || 587,
    secure: String(process.env.MAIL_SECURE || '').toLowerCase() === 'true'
      || String(process.env.MAIL_PORT || '') === '465',
    user: process.env.MAIL_USERNAME || '',
    pass: String(process.env.MAIL_PASSWORD || '').replace(/^["']|["']$/g, ''),
    from: process.env.MAIL_FROM
      || (process.env.MAIL_USERNAME
        ? `Writect <${process.env.MAIL_USERNAME}>`
        : 'Writect <noreply@writect.ai>'),
    replyTo: process.env.MAIL_REPLY_TO || ''
  },
  panel: {
    username: process.env.ADMIN_USERNAME || 'admin',
    password: process.env.ADMIN_PASSWORD,
    sessionExpiresIn: process.env.ADMIN_SESSION_EXPIRES_IN || '8h'
  }
};
