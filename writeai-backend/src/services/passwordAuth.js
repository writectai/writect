const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db/postgres');
const config = require('../config');

const MIN_PASSWORD_LEN = 8;
const RESET_TOKEN_HOURS = 2;

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return 'Password is required.';
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return `Password must be at least ${MIN_PASSWORD_LEN} characters.`;
  }
  return null;
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function comparePassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

function signUserToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, plan: user.plan, role: user.role || 'user' },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

function publicAuthFlags(user) {
  const hasPassword = !!user.password_hash;
  const hasGoogle = !!user.google_id;
  return {
    has_password: hasPassword,
    has_google: hasGoogle,
    auth_provider: user.auth_provider || (hasGoogle && !hasPassword ? 'google' : hasPassword ? 'password' : 'google'),
    sign_in_method: hasPassword && hasGoogle
      ? 'Email & password (Google also linked)'
      : hasPassword
        ? 'Email & password'
        : 'Google'
  };
}

async function findUserByEmail(email) {
  const result = await db.query(
    `SELECT * FROM users WHERE lower(email) = $1 LIMIT 1`,
    [normalizeEmail(email)]
  );
  return result.rows[0] || null;
}

async function findUserById(id) {
  const result = await db.query(`SELECT * FROM users WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function signupWithPassword({ email, password, name }) {
  const emailNorm = normalizeEmail(email);
  if (!emailNorm || !emailNorm.includes('@')) {
    const err = new Error('Enter a valid email address.');
    err.code = 'invalid_email';
    throw err;
  }
  const pwdErr = validatePassword(password);
  if (pwdErr) {
    const err = new Error(pwdErr);
    err.code = 'weak_password';
    throw err;
  }

  const existing = await findUserByEmail(emailNorm);
  if (existing) {
    const err = new Error(
      existing.google_id && !existing.password_hash
        ? 'This email already uses Google sign-in. Sign in with Google, then create a password in Settings.'
        : 'An account with this email already exists. Please sign in.'
    );
    err.code = 'email_taken';
    throw err;
  }

  const password_hash = await hashPassword(password);
  const displayName = String(name || '').trim() || emailNorm.split('@')[0];
  const role = config.adminEmails.includes(emailNorm) ? 'admin' : 'user';

  const result = await db.query(
    `INSERT INTO users (email, name, password_hash, auth_provider, role, google_id)
     VALUES ($1, $2, $3, 'password', $4, NULL)
     RETURNING *`,
    [emailNorm, displayName, password_hash, role]
  );
  return result.rows[0];
}

async function loginWithPassword({ email, password }) {
  const user = await findUserByEmail(email);
  if (!user || !user.password_hash) {
    const err = new Error(
      user?.google_id
        ? 'This account uses Google sign-in. Continue with Google, or create a password in Settings after signing in.'
        : 'Invalid email or password.'
    );
    err.code = user?.google_id ? 'use_google' : 'invalid_credentials';
    throw err;
  }

  const ok = await comparePassword(password, user.password_hash);
  if (!ok) {
    const err = new Error('Invalid email or password.');
    err.code = 'invalid_credentials';
    throw err;
  }

  if (user.is_active === false) {
    const err = new Error('Your account has been disabled. Please contact support.');
    err.code = 'account_disabled';
    throw err;
  }

  return user;
}

/**
 * Google-only users: set first password (no current password).
 * Password users: change password (requires current).
 * After first password on a Google account, auth_provider becomes 'password'
 * so email/password is the primary method going forward (Google remains linked).
 */
async function setOrChangePassword(userId, { currentPassword, newPassword, isFirstPassword }) {
  const user = await findUserById(userId);
  if (!user) {
    const err = new Error('User not found.');
    err.code = 'user_not_found';
    throw err;
  }

  const pwdErr = validatePassword(newPassword);
  if (pwdErr) {
    const err = new Error(pwdErr);
    err.code = 'weak_password';
    throw err;
  }

  const hasPassword = !!user.password_hash;

  if (!hasPassword || isFirstPassword) {
    if (hasPassword) {
      const err = new Error('A password is already set. Enter your current password to change it.');
      err.code = 'password_exists';
      throw err;
    }
    const password_hash = await hashPassword(newPassword);
    const result = await db.query(
      `UPDATE users
       SET password_hash = $1,
           auth_provider = 'password',
           password_reset_token = NULL,
           password_reset_expires = NULL,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [password_hash, userId]
    );
    return {
      user: result.rows[0],
      created: true,
      message:
        'Password created. From now on, please sign in with your email and password. Google will no longer be your primary sign-in method — we will use email and password instead. (Google stays linked as a backup if you ever need it.)'
    };
  }

  if (!currentPassword) {
    const err = new Error('Enter your current password.');
    err.code = 'current_required';
    throw err;
  }

  const ok = await comparePassword(currentPassword, user.password_hash);
  if (!ok) {
    const err = new Error('Current password is incorrect.');
    err.code = 'wrong_password';
    throw err;
  }

  const password_hash = await hashPassword(newPassword);
  const result = await db.query(
    `UPDATE users
     SET password_hash = $1,
         auth_provider = 'password',
         password_reset_token = NULL,
         password_reset_expires = NULL,
         updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [password_hash, userId]
  );
  return {
    user: result.rows[0],
    created: false,
    message: 'Password updated successfully.'
  };
}

async function createPasswordResetToken(email) {
  const user = await findUserByEmail(email);
  // Always succeed from caller's perspective to avoid email enumeration
  if (!user) {
    return { ok: true, sent: false };
  }

  if (!user.password_hash && user.google_id) {
    return {
      ok: true,
      sent: false,
      hint: 'google_only',
      message:
        'This account signs in with Google. Use Continue with Google, then create a password in Settings if you want email sign-in.'
    };
  }

  if (!user.password_hash) {
    return { ok: true, sent: false };
  }

  const raw = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + RESET_TOKEN_HOURS * 60 * 60 * 1000);
  await db.query(
    `UPDATE users
     SET password_reset_token = $1,
         password_reset_expires = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [raw, expires.toISOString(), user.id]
  );

  const base = (config.frontendUrl || '').replace(/\/$/, '') || '';
  const resetUrl = `${base}/reset-password?token=${encodeURIComponent(raw)}`;

  try {
    const { sendMail, mailConfigured } = require('./mail');
    const { passwordResetUser } = require('./emailTemplates');
    if (mailConfigured()) {
      const mail = passwordResetUser({
        name: user.name,
        email: user.email,
        resetUrl
      });
      await sendMail({ to: user.email, ...mail });
    } else {
      console.log(`[password-reset] mail not configured — ${user.email} → ${resetUrl}`);
    }
  } catch (err) {
    console.error('[password-reset] mail error:', err.message);
  }

  return {
    ok: true,
    sent: true,
    resetUrl: process.env.NODE_ENV === 'production' ? undefined : resetUrl
  };
}

async function resetPasswordWithToken(token, newPassword) {
  const pwdErr = validatePassword(newPassword);
  if (pwdErr) {
    const err = new Error(pwdErr);
    err.code = 'weak_password';
    throw err;
  }
  if (!token) {
    const err = new Error('Invalid or expired reset link.');
    err.code = 'invalid_token';
    throw err;
  }

  const result = await db.query(
    `SELECT * FROM users
     WHERE password_reset_token = $1
       AND password_reset_expires > NOW()
     LIMIT 1`,
    [token]
  );
  const user = result.rows[0];
  if (!user) {
    const err = new Error('Invalid or expired reset link. Request a new one.');
    err.code = 'invalid_token';
    throw err;
  }

  const password_hash = await hashPassword(newPassword);
  await db.query(
    `UPDATE users
     SET password_hash = $1,
         auth_provider = 'password',
         password_reset_token = NULL,
         password_reset_expires = NULL,
         updated_at = NOW()
     WHERE id = $2`,
    [password_hash, user.id]
  );
  return { ok: true };
}

module.exports = {
  MIN_PASSWORD_LEN,
  normalizeEmail,
  validatePassword,
  hashPassword,
  comparePassword,
  signUserToken,
  publicAuthFlags,
  findUserByEmail,
  findUserById,
  signupWithPassword,
  loginWithPassword,
  setOrChangePassword,
  createPasswordResetToken,
  resetPasswordWithToken
};
