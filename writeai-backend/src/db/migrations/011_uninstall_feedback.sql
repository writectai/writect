-- Uninstall feedback from Chrome extension uninstall page
CREATE TABLE IF NOT EXISTS uninstall_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reason VARCHAR(64) NOT NULL,
  notes TEXT,
  source VARCHAR(64) DEFAULT 'extension_uninstall',
  user_agent TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_uninstall_feedback_created
  ON uninstall_feedback (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_uninstall_feedback_reason
  ON uninstall_feedback (reason);
