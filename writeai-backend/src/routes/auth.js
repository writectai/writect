const router = require('express').Router();
const { OAuth2Client } = require('google-auth-library');
const { body, validationResult } = require('express-validator');
const db = require('../db/postgres');
const config = require('../config');
const authMiddleware = require('../middleware/auth');
const {
  signupWithPassword,
  loginWithPassword,
  setOrChangePassword,
  createPasswordResetToken,
  resetPasswordWithToken,
  signUserToken,
  publicAuthFlags,
  findUserById,
  normalizeEmail
} = require('../services/passwordAuth');
const { notifySignup } = require('../services/notifications');

const client = new OAuth2Client(
  config.google.clientId,
  config.google.clientSecret,
  config.google.callbackUrl
);

function parseOAuthState(state) {
  if (!state) return { extensionId: '', redirect: '' };

  try {
    const decoded = JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
    return {
      extensionId: decoded.extensionId || '',
      redirect: decoded.redirect || ''
    };
  } catch {
    return { extensionId: state, redirect: '' };
  }
}

function buildOAuthState({ extensionId, redirect }) {
  if (redirect) {
    return Buffer.from(JSON.stringify({ extensionId: extensionId || '', redirect })).toString('base64url');
  }
  return extensionId || '';
}

function isAdminEmail(email) {
  return config.adminEmails.includes(String(email).toLowerCase());
}

function sendAuthError(res, err, fallbackStatus = 400) {
  const status = err.code === 'account_disabled' ? 403 : fallbackStatus;
  res.status(status).json({
    error: err.code || 'auth_error',
    message: err.message || 'Authentication failed.'
  });
}

async function upsertGoogleUser({ googleId, email, name, picture }) {
  const emailNorm = normalizeEmail(email);
  const role = isAdminEmail(emailNorm) ? 'admin' : 'user';

  const byGoogle = await db.query(`SELECT * FROM users WHERE google_id = $1 LIMIT 1`, [googleId]);
  if (byGoogle.rows[0]) {
    const updated = await db.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           avatar_url = COALESCE($2, avatar_url),
           role = CASE WHEN $3 THEN 'admin' ELSE role END,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [name || null, picture || null, isAdminEmail(emailNorm), byGoogle.rows[0].id]
    );
    return { user: updated.rows[0], isNew: false };
  }

  const byEmail = await db.query(
    `SELECT * FROM users WHERE lower(email) = $1 LIMIT 1`,
    [emailNorm]
  );
  if (byEmail.rows[0]) {
    // Link Google to existing email/password account (keep password + auth_provider)
    const updated = await db.query(
      `UPDATE users
       SET google_id = $1,
           name = COALESCE(NULLIF(name, ''), $2),
           avatar_url = COALESCE($3, avatar_url),
           role = CASE WHEN $4 THEN 'admin' ELSE role END,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [googleId, name || null, picture || null, isAdminEmail(emailNorm), byEmail.rows[0].id]
    );
    return { user: updated.rows[0], isNew: false };
  }

  const inserted = await db.query(
    `INSERT INTO users (email, name, avatar_url, google_id, role, auth_provider)
     VALUES ($1, $2, $3, $4, $5, 'google')
     RETURNING *`,
    [emailNorm, name || emailNorm.split('@')[0], picture || null, googleId, role]
  );
  return { user: inserted.rows[0], isNew: true };
}

function finishLoginRedirect(res, user, { extensionId, redirect }) {
  const token = signUserToken(user);

  if (redirect === 'admin') {
    if (user.role !== 'admin') {
      return res.redirect('/admin/?error=not_admin');
    }
    return res.redirect(`/admin/#token=${encodeURIComponent(token)}`);
  }

  if (redirect === 'app' || redirect === 'web' || redirect === 'app_upgrade' || redirect === 'app_upgrade_year') {
    const base = (config.frontendUrl || '').replace(/\/$/, '');
    const target = base ? `${base}/app` : '/app';
    let qs = '';
    if (redirect === 'app_upgrade_year') qs = '?upgrade=1&interval=year';
    else if (redirect === 'app_upgrade') qs = '?upgrade=1&interval=month';
    return res.redirect(`${target}${qs}#token=${encodeURIComponent(token)}`);
  }

  const tokenJson = JSON.stringify(token);
  const extensionIdJson = JSON.stringify(extensionId || '');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Writect — Signed in</title>
  <link rel="icon" type="image/png" href="/img/Writect-logo-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #06060b;
      color: #f4f4f5;
      overflow: hidden;
      position: relative;
    }
    .bg {
      position: absolute; inset: 0;
      background:
        radial-gradient(ellipse 70% 60% at 25% 20%, rgba(242, 24, 98,0.28), transparent 55%),
        radial-gradient(ellipse 60% 50% at 80% 85%, rgba(107, 15, 179,0.22), transparent 55%),
        #071428;
    }
    .card {
      position: relative;
      width: 100%;
      max-width: 400px;
      margin: 24px;
      padding: 44px 36px 36px;
      text-align: center;
      background: rgba(18,18,28,0.8);
      backdrop-filter: blur(24px);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 24px;
      box-shadow: 0 24px 80px rgba(0,0,0,0.5);
      animation: rise 0.5s cubic-bezier(0.34,1.56,0.64,1);
    }
    @keyframes rise { from { opacity:0; transform: translateY(16px) scale(0.97); } to { opacity:1; transform:none; } }
    .logo {
      width: auto;
      height: 36px;
      max-width: 200px;
      margin: 0 auto 22px;
      background: transparent;
      display: block;
      object-fit: contain;
    }
    .check {
      width: 72px; height: 72px; margin: 0 auto 22px;
      border-radius: 50%;
      background: rgba(34,197,94,0.14);
      border: 1px solid rgba(34,197,94,0.3);
      display: flex; align-items: center; justify-content: center;
      animation: pop 0.5s cubic-bezier(0.34,1.56,0.64,1) 0.15s both;
    }
    @keyframes pop { from { opacity:0; transform: scale(0.5); } to { opacity:1; transform: scale(1); } }
    .check svg { width: 36px; height: 36px; stroke: #4ade80; }
    .check svg path { stroke-dasharray: 32; stroke-dashoffset: 32; animation: draw 0.4s ease 0.45s forwards; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    h1 { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 8px; }
    p { color: #a1a1aa; font-size: 14px; line-height: 1.6; }
    .hint {
      margin-top: 24px; padding: 12px 16px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      font-size: 13px; color: #a1a1aa;
    }
    .hint strong { color: #F7A8C8; font-weight: 600; }
    .close-note { margin-top: 16px; font-size: 12px; color: #71717a; }
    .brand-name { font-weight: 700; color: #F21862; }
  </style>
</head>
<body>
  <div class="bg"></div>
  <div class="card">
    <img class="logo" src="/img/Writect-AI-logo-white.png" alt="Writect AI" height="36">
    <div class="check">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
    </div>
    <h1>You're all set!</h1>
    <p>Signed in to <span class="brand-name">Writect</span> successfully.</p>
    <div class="hint">
      Head back to any page, <strong>select some text</strong>, and let Writect fix, rephrase, translate, and more.
    </div>
    <p class="close-note" id="close-note">This tab will close automatically…</p>
  </div>
  <script>
    (function () {
      var payload = { type: 'WRITEAI_AUTH', token: ${tokenJson} };
      var extensionId = ${extensionIdJson};

      if (window.opener) {
        window.opener.postMessage(payload, '*');
      }

      function tryClose(delay) {
        setTimeout(function () {
          window.close();
          var note = document.getElementById('close-note');
          if (note) note.textContent = 'You can close this tab now.';
        }, delay);
      }

      if (extensionId && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        try {
          chrome.runtime.sendMessage(extensionId, payload, function () {
            tryClose(900);
          });
        } catch (e) {
          tryClose(1200);
        }
      } else {
        tryClose(1200);
      }
    })();
  </script>
</body>
</html>`);
}

router.get('/google', (req, res) => {
  if (!config.google.clientId) {
    return res.status(503).json({ error: 'Google OAuth not configured' });
  }

  const state = buildOAuthState({
    extensionId: req.query.extensionId,
    redirect: req.query.redirect
  });

  const url = client.generateAuthUrl({
    access_type: 'offline',
    scope: ['email', 'profile'],
    state,
    prompt: 'consent'
  });
  res.redirect(url);
});

router.get('/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const { extensionId, redirect } = parseOAuthState(state);

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.google.clientId
    });

    const { sub: googleId, email, name, picture } = ticket.getPayload();
    const { user, isNew } = await upsertGoogleUser({ googleId, email, name, picture });
    if (isNew) notifySignup(user, { method: 'google' });
    return finishLoginRedirect(res, user, { extensionId, redirect });
  } catch (err) {
    console.error('Google OAuth error:', err);
    const base = (config.frontendUrl || '').replace(/\/$/, '');
    if (redirect === 'app' || redirect === 'web' || redirect === 'app_upgrade' || redirect === 'app_upgrade_year') {
      const upgradeQs = redirect === 'app_upgrade_year'
        ? '&upgrade=1&interval=year'
        : redirect === 'app_upgrade'
          ? '&upgrade=1&interval=month'
          : '';
      return res.redirect(`${base || ''}/login?error=auth_failed${upgradeQs}`);
    }
    return res.redirect('/login?error=auth_failed');
  }
});

router.post(
  '/signup',
  body('email').isEmail().withMessage('Enter a valid email.'),
  body('password').isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
  body('name').optional().isString().isLength({ max: 120 }),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'validation_error', message: errors.array()[0].msg });
    }
    try {
      const user = await signupWithPassword({
        email: req.body.email,
        password: req.body.password,
        name: req.body.name
      });
      notifySignup(user, { method: 'password' });
      const token = signUserToken(user);
      res.status(201).json({
        token,
        user: {
          email: user.email,
          name: user.name,
          plan: user.plan,
          ...publicAuthFlags(user)
        }
      });
    } catch (err) {
      sendAuthError(res, err, 409);
    }
  }
);

router.post(
  '/login',
  body('email').isEmail().withMessage('Enter a valid email.'),
  body('password').isString().notEmpty().withMessage('Password is required.'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'validation_error', message: errors.array()[0].msg });
    }
    try {
      const user = await loginWithPassword({
        email: req.body.email,
        password: req.body.password
      });
      const token = signUserToken(user);
      res.json({
        token,
        user: {
          email: user.email,
          name: user.name,
          plan: user.plan,
          ...publicAuthFlags(user)
        }
      });
    } catch (err) {
      sendAuthError(res, err, 401);
    }
  }
);

router.post(
  '/forgot-password',
  body('email').isEmail().withMessage('Enter a valid email.'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'validation_error', message: errors.array()[0].msg });
    }
    try {
      const result = await createPasswordResetToken(req.body.email);
      if (result.hint === 'google_only') {
        return res.json({
          ok: true,
          message: result.message
        });
      }
      res.json({
        ok: true,
        message: 'If an account exists for that email, a reset link is ready. Check your inbox, or ask your admin for the reset link from server logs until email delivery is configured.',
        ...(result.resetUrl ? { resetUrl: result.resetUrl } : {})
      });
    } catch (err) {
      console.error('Forgot password error:', err);
      res.json({
        ok: true,
        message: 'If an account exists for that email, password reset instructions will be provided.'
      });
    }
  }
);

router.post(
  '/reset-password',
  body('token').isString().notEmpty(),
  body('password').isString().isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'validation_error', message: errors.array()[0].msg });
    }
    try {
      await resetPasswordWithToken(req.body.token, req.body.password);
      res.json({ ok: true, message: 'Password updated. You can sign in with your email and password.' });
    } catch (err) {
      sendAuthError(res, err, 400);
    }
  }
);

/** Create first password (Google users) or change existing password. */
router.post(
  '/password',
  authMiddleware,
  body('newPassword').isString().isLength({ min: 8 }).withMessage('New password must be at least 8 characters.'),
  body('currentPassword').optional({ nullable: true }).isString(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'validation_error', message: errors.array()[0].msg });
    }
    try {
      const full = await findUserById(req.user.userId);
      const isFirstPassword = !full?.password_hash;
      const result = await setOrChangePassword(req.user.userId, {
        currentPassword: req.body.currentPassword,
        newPassword: req.body.newPassword,
        isFirstPassword
      });
      res.json({
        ok: true,
        created: result.created,
        message: result.message,
        ...publicAuthFlags(result.user)
      });
    } catch (err) {
      sendAuthError(res, err, 400);
    }
  }
);

router.get('/verify', authMiddleware, async (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
