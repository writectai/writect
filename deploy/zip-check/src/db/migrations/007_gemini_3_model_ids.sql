-- Migrate retired Gemini 2.5 model IDs to Gemini 3.x (required for new API keys)
UPDATE app_settings
SET value = jsonb_set(
  jsonb_set(
    value,
    '{primary}',
    to_jsonb(
      CASE value->>'primary'
        WHEN 'gemini-1.5-flash' THEN 'gemini-3.6-flash'
        WHEN 'gemini-1.5-flash-002' THEN 'gemini-3.6-flash'
        WHEN 'gemini-1.5-pro' THEN 'gemini-3.5-flash'
        WHEN 'gemini-2.0-flash' THEN 'gemini-3.6-flash'
        WHEN 'gemini-2.0-flash-lite' THEN 'gemini-3.5-flash-lite'
        WHEN 'gemini-2.5-flash' THEN 'gemini-3.6-flash'
        WHEN 'gemini-2.5-flash-lite' THEN 'gemini-3.5-flash-lite'
        WHEN 'gemini-2.5-pro' THEN 'gemini-3.5-flash'
        ELSE value->>'primary'
      END
    )
  ),
  '{fallback}',
  to_jsonb(
    CASE value->>'fallback'
      WHEN 'gemini-1.5-flash' THEN 'gemini-3.5-flash-lite'
      WHEN 'gemini-1.5-flash-002' THEN 'gemini-3.5-flash-lite'
      WHEN 'gemini-1.5-pro' THEN 'gemini-3.5-flash'
      WHEN 'gemini-2.0-flash' THEN 'gemini-3.5-flash-lite'
      WHEN 'gemini-2.0-flash-lite' THEN 'gemini-3.5-flash-lite'
      WHEN 'gemini-2.5-flash' THEN 'gemini-3.6-flash'
      WHEN 'gemini-2.5-flash-lite' THEN 'gemini-3.5-flash-lite'
      WHEN 'gemini-2.5-pro' THEN 'gemini-3.5-flash'
      ELSE value->>'fallback'
    END
  )
),
updated_at = NOW()
WHERE key = 'models';
