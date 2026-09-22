-- Customer AI Actions model: monthly + daily caps for Free and Pro.
-- Tokens remain logged for admin cost analytics only.

UPDATE app_settings
SET value = jsonb_build_object(
  'free_monthly_actions', 300,
  'free_daily_actions', 10,
  'pro_monthly_actions', 3000,
  'pro_daily_actions', 150,
  'free_monthly_tokens', COALESCE((value->>'free_monthly_tokens')::int, 50000)
),
updated_at = NOW()
WHERE key = 'limits';

INSERT INTO app_settings (key, value, updated_at)
SELECT 'limits', '{"free_monthly_actions":300,"free_daily_actions":10,"pro_monthly_actions":3000,"pro_daily_actions":150,"free_monthly_tokens":50000}'::jsonb, NOW()
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'limits');
