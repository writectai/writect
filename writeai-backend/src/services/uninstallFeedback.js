const db = require('../db/postgres');

const REASON_LABELS = {
  bug: 'It broke or felt unreliable',
  missing_feature: 'Missing a feature I needed',
  limits: 'Limits or price weren\'t right',
  privacy: 'Privacy / permissions',
  other: 'Something else'
};

const ALLOWED_REASONS = new Set(Object.keys(REASON_LABELS));

function normalizeReason(raw) {
  const reason = String(raw || 'other').trim().slice(0, 64);
  return ALLOWED_REASONS.has(reason) ? reason : 'other';
}

function reasonLabel(reason) {
  return REASON_LABELS[reason] || reason || 'Something else';
}

async function saveUninstallFeedback({
  reason,
  notes = '',
  source = 'extension_uninstall',
  userAgent = '',
  ipAddress = ''
}) {
  const cleanReason = normalizeReason(reason);
  const cleanNotes = String(notes || '').trim().slice(0, 800) || null;
  const cleanSource = String(source || 'extension_uninstall').slice(0, 64);
  const cleanUa = String(userAgent || '').slice(0, 500) || null;
  const cleanIp = String(ipAddress || '').slice(0, 45) || null;

  const { rows } = await db.query(
    `INSERT INTO uninstall_feedback (reason, notes, source, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, reason, notes, source, created_at`,
    [cleanReason, cleanNotes, cleanSource, cleanUa, cleanIp]
  );

  return rows[0];
}

async function listUninstallFeedback({
  page = 1,
  limit = 50,
  reason = '',
  search = ''
} = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (safePage - 1) * safeLimit;

  const conditions = [];
  const params = [];

  if (reason && ALLOWED_REASONS.has(reason)) {
    params.push(reason);
    conditions.push(`reason = $${params.length}`);
  }

  if (search) {
    params.push(`%${String(search).trim()}%`);
    conditions.push(`(notes ILIKE $${params.length} OR reason ILIKE $${params.length})`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(safeLimit, offset);

  const [rows, countResult, breakdown] = await Promise.all([
    db.query(
      `SELECT id, reason, notes, source, user_agent, ip_address, created_at
       FROM uninstall_feedback
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    db.query(
      `SELECT COUNT(*)::int AS total FROM uninstall_feedback ${where}`,
      params.slice(0, -2)
    ),
    db.query(
      `SELECT reason, COUNT(*)::int AS count
       FROM uninstall_feedback
       GROUP BY reason
       ORDER BY count DESC`
    )
  ]);

  const total = countResult.rows[0]?.total || 0;

  return {
    feedback: rows.rows.map((row) => ({
      ...row,
      reason_label: reasonLabel(row.reason)
    })),
    breakdown: breakdown.rows.map((row) => ({
      reason: row.reason,
      label: reasonLabel(row.reason),
      count: row.count
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.max(1, Math.ceil(total / safeLimit))
    }
  };
}

async function deleteUninstallFeedback(id) {
  const { rows } = await db.query(
    `DELETE FROM uninstall_feedback WHERE id = $1 RETURNING id, reason`,
    [id]
  );
  return rows[0] || null;
}

module.exports = {
  REASON_LABELS,
  ALLOWED_REASONS,
  normalizeReason,
  reasonLabel,
  saveUninstallFeedback,
  listUninstallFeedback,
  deleteUninstallFeedback
};
