-- Weighted AI Actions (boss Simple Plan Setup).
-- Each usage row stores how many actions it consumed (1, 2, 3, or 5).

ALTER TABLE usage
  ADD COLUMN IF NOT EXISTS action_cost INT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_usage_user_created ON usage(user_id, created_at);
