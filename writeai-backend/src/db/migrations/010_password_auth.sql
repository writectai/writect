-- Email/password auth alongside Google OAuth.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash TEXT,
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'google',
  ADD COLUMN IF NOT EXISTS password_reset_token TEXT,
  ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMPTZ;

-- Existing Google users stay on google; null provider → google if they have google_id
UPDATE users
SET auth_provider = 'google'
WHERE auth_provider IS NULL OR auth_provider = '';

CREATE INDEX IF NOT EXISTS idx_users_password_reset_token
  ON users (password_reset_token)
  WHERE password_reset_token IS NOT NULL;
