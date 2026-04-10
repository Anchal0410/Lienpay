const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');

// ── TIMING-SAFE AUTH ──────────────────────────────────────────
// NEVER use === for token comparison. Use crypto.timingSafeEqual.
const adminAuth = (req, res, next) => {
  const provided = req.headers['x-admin-token'] || '';
  const expected = process.env.ADMIN_TOKEN || 'lienpay-admin-2026';

  if (provided.length !== expected.length) {
    logger.warn('Admin auth failure (length mismatch)', { ip: req.ip, path: req.path });
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }

  const match = crypto.timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(expected, 'utf8')
  );

  if (!match) {
    logger.warn('Admin auth failure (bad token)', { ip: req.ip, path: req.path });
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  next();
};
router.use(adminAuth);

// ── OVERVIEW ──────────────────────────────────────────────────
router.get('/overview', async (req, res) => {
  try {
    const empty = { rows: [{}] };
    let users=empty, sessions=empty, otps=empty, credit=empty, txns=empty, pledges=empty, statements=empty;

    try { users = await query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE account_status = 'ONBOARDING') as onboarding,
             COUNT(*) FILTER (WHERE kyc_status = 'VERIFIED') as kyc_done,
             COUNT(*) FILTER (WHERE account_status = 'CREDIT_ACTIVE') as active,
             COUNT(*) FILTER (WHERE account_status = 'OVERDUE') as overdue,
             COUNT(*) FILTER (WHERE account_status = 'MARGIN_CALL') as margin_call,
             COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as new_today
      FROM users WHERE deleted_at IS NULL`);
    } catch(e) { logger.error('Admin users query:', e.message); }

    try { sessions = await query(`
      SELECT COUNT(*) as active_sessions
      FROM sessions WHERE is_active = true AND expires_at > NOW()`);
    } catch(e) {}

    try { otps = await query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'VERIFIED') as verified,
             COUNT(*) FILTER (WHERE status = 'LOCKED') as locked,
             COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as today
      FROM otp_logs`);
    } catch(e) {}

    try { credit = await query(`
      SELECT COUNT(*) as total_accounts,
             COALESCE(SUM(credit_limit), 0) as total_limit,
             COALESCE(SUM(outstanding), 0) as total_outstanding,
             COALESCE(SUM(available_credit), 0) as total_available,
             COUNT(*) FILTER (WHERE status = 'ACTIVE') as active,
             COUNT(*) FILTER (WHERE status = 'FROZEN') as frozen
      FROM credit_accounts`);
    } catch(e) {}

    try { txns = await query(`
      SELECT COUNT(*) as total,
             COALESCE(SUM(amount), 0) as total_volume,
             COUNT(*) FILTER (WHERE status = 'SETTLED') as settled,
             COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
             COUNT(*) FILTER (WHERE initiated_at > NOW() - INTERVAL '24 hours') as today_count,
             COALESCE(SUM(amount) FILTER (WHERE initiated_at > NOW() - INTERVAL '24 hours'), 0) as today_volume,
             COALESCE(SUM(amount) FILTER (WHERE initiated_at > NOW() - INTERVAL '7 days'), 0) as week_volume
      FROM transactions`);
    } catch(e) {}

    try { pledges = await query(`
      SELECT COUNT(*) as total,
             COUNT(*) FILTER (WHERE status = 'ACTIVE') as active,
             COUNT(*) FILTER (WHERE rta = 'CAMS') as cams,
             COUNT(*) FILTER (WHERE rta = 'KFINTECH' OR rta = 'MF_CENTRAL') as mf_central
      FROM pledges`);
    } catch(e) {}

    try { statements = await query(`
      SELECT COUNT(*) as total,
             COALESCE(SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END), 0) as paid,
             COALESCE(SUM(CASE WHEN status = 'OVERDUE' THEN 1 ELSE 0 END), 0) as overdue
      FROM statements`);
    } catch(e) {}

    res.json({ success: true, data: {
      users:      users.rows[0],
      sessions:   sessions.rows[0],
      otps:       otps.rows[0],
      credit:     credit.rows[0],
      transactions: txns.rows[0],
      pledges:    pledges.rows[0],
      statements: statements.rows[0],
      timestamp:  new Date().toISOString(),
    }});
  } catch (err) {
    logger.error('Admin overview error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── USERS LIST ────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const { limit = 50, offset = 0, status } = req.query;

    // FIX: SQL INJECTION — never interpolate user input into SQL strings.
    // Use a whitelist of valid statuses and parameterized queries.
    const VALID_STATUSES = [
      'ONBOARDING', 'KYC_DONE', 'PORTFOLIO_LINKED', 'PLEDGE_CONFIRMED',
      'CREDIT_ACTIVE', 'OVERDUE', 'MARGIN_CALL', 'DEFAULTED', 'FROZEN', 'CLOSED',
    ];

    let queryText, queryParams;

    if (status && VALID_STATUSES.includes(status.toUpperCase())) {
      queryText = `
        SELECT user_id, mobile, full_name, pan_last4, kyc_status,
               account_status, onboarding_step, created_at
        FROM users
        WHERE deleted_at IS NULL AND account_status = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
      queryParams = [status.toUpperCase(), parseInt(limit), parseInt(offset)];
    } else {
      queryText = `
        SELECT user_id, mobile, full_name, pan_last4, kyc_status,
               account_status, onboarding_step, created_at
        FROM users
        WHERE deleted_at IS NULL
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `;
      queryParams = [parseInt(limit), parseInt(offset)];
    }

    const result = await query(queryText, queryParams);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── USER DETAIL ───────────────────────────────────────────────
router.get('/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // FIX: Never SELECT * on users — pan_encrypted and other sensitive fields
    // must never leave the backend. Select only what the admin UI needs.
    const [user, kyc, credit, pledges, txns, risk] = await Promise.all([
      query(`
        SELECT user_id, mobile, full_name, pan_last4, kyc_status, kyc_type,
               account_status, onboarding_step, ckyc_id, gender,
               address_city, address_state, address_pincode,
               created_at, updated_at
        FROM users WHERE user_id = $1
      `, [userId]),
      query(`
        SELECT kyc_method, status, name_match_score, aadhaar_last4,
               ckyc_id, ckyc_action, completed_at, created_at
        FROM kyc_records WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1
      `, [userId]),
      query(`
        SELECT account_id, credit_limit, available_credit, outstanding,
               apr, apr_product, upi_vpa, psp_bank, status, ltv_ratio,
               ltv_alert_level, upi_active, notorious_fund_freeze, created_at
        FROM credit_accounts WHERE user_id = $1
      `, [userId]),
      query(`
        SELECT pledge_id, folio_number, scheme_name, isin, rta,
               units_pledged, nav_at_pledge, value_at_pledge,
               ltv_cap, eligible_value_at_pledge, status, created_at,
               is_notorious_at_pledge
        FROM pledges WHERE user_id = $1 ORDER BY created_at DESC
      `, [userId]),
      query(`
        SELECT txn_id, merchant_vpa, merchant_name, amount, status,
               utr, initiated_at, settled_at, is_in_free_period
        FROM transactions WHERE user_id = $1
        ORDER BY initiated_at DESC LIMIT 20
      `, [userId]),
      query(`
        SELECT decision_id, approved_limit, risk_tier, apr, apr_product,
               fraud_score, engine_version, decided_at
        FROM risk_decisions WHERE user_id = $1
        ORDER BY decided_at DESC LIMIT 1
      `, [userId]),
    ]);

    res.json({ success: true, data: {
      user:         user.rows[0],
      kyc:          kyc.rows[0],
      credit:       credit.rows[0],
      pledges:      pledges.rows,
      transactions: txns.rows,
      risk:         risk.rows[0],
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── CREDIT ACCOUNTS ───────────────────────────────────────────
router.get('/credit-accounts', async (req, res) => {
  try {
    const result = await query(`
      SELECT ca.account_id, ca.credit_limit, ca.available_credit, ca.outstanding,
             ca.apr, ca.apr_product, ca.status, ca.ltv_ratio, ca.ltv_alert_level,
             ca.upi_active, ca.notorious_fund_freeze, ca.created_at,
             u.full_name, u.mobile,
             rd.risk_tier
      FROM credit_accounts ca
      JOIN users u ON u.user_id = ca.user_id
      LEFT JOIN risk_decisions rd ON rd.user_id = ca.user_id
      ORDER BY ca.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── LTV HEALTH ────────────────────────────────────────────────
router.get('/ltv-health', async (req, res) => {
  try {
    const result = await query(`
      SELECT ls.user_id, ls.ltv_ratio, ls.status, ls.outstanding, ls.snapshot_date,
             u.full_name,
             ca.credit_limit, ca.outstanding as current_outstanding
      FROM ltv_snapshots ls
      JOIN users u ON u.user_id = ls.user_id
      JOIN credit_accounts ca ON ca.user_id = ls.user_id
      WHERE ls.snapshot_date = (SELECT MAX(snapshot_date) FROM ltv_snapshots)
      ORDER BY ls.ltv_ratio DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── PLEDGES ───────────────────────────────────────────────────
router.get('/pledges', async (req, res) => {
  try {
    const result = await query(`
      SELECT p.pledge_id, p.folio_number, p.scheme_name, p.isin, p.rta,
             p.units_pledged, p.nav_at_pledge, p.value_at_pledge,
             p.ltv_cap, p.status, p.created_at,
             p.is_notorious_at_pledge,
             mh.scheme_type,
             u.full_name,
             COALESCE(nf.is_active, false) as currently_notorious
      FROM pledges p
      JOIN users u ON u.user_id = p.user_id
      LEFT JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
      LEFT JOIN notorious_funds nf ON nf.isin = p.isin AND nf.is_active = true
      ORDER BY p.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── TRANSACTIONS ──────────────────────────────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const result = await query(`
      SELECT t.txn_id, t.merchant_vpa, t.merchant_name, t.amount,
             t.status, t.utr, t.initiated_at, t.settled_at, t.is_in_free_period,
             u.full_name
      FROM transactions t
      JOIN users u ON u.user_id = t.user_id
      ORDER BY t.initiated_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), parseInt(offset)]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── RISK DISTRIBUTION ─────────────────────────────────────────
router.get('/risk-distribution', async (req, res) => {
  try {
    const result = await query(`
      SELECT risk_tier, COUNT(*) as count,
             AVG(approved_limit) as avg_limit,
             AVG(apr) as avg_apr
      FROM risk_decisions
      WHERE decision = 'APPROVED'
      GROUP BY risk_tier
      ORDER BY risk_tier
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── AUDIT LOG ─────────────────────────────────────────────────
router.get('/audit', async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const result = await query(`
      SELECT event_type, entity_type, entity_id, new_values, created_at
      FROM audit_trail
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, [parseInt(limit), parseInt(offset)]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── SYSTEM HEALTH ─────────────────────────────────────────────
router.get('/system-health', async (req, res) => {
  try {
    const dbCheck = await query('SELECT NOW() as db_time, version() as db_version');
    res.json({ success: true, data: {
      database: { status: 'connected', ...dbCheck.rows[0] },
      uptime:   process.uptime(),
      memory:   process.memoryUsage(),
      node:     process.version,
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── NOTORIOUS FUNDS (ops visibility) ─────────────────────────
router.get('/notorious-funds', async (req, res) => {
  try {
    const result = await query(`
      SELECT nf.fund_id, nf.isin, nf.scheme_name, nf.reason, nf.source,
             nf.flagged_at, nf.is_active,
             COUNT(DISTINCT p.user_id) as affected_users,
             COUNT(p.pledge_id) as active_pledges
      FROM notorious_funds nf
      LEFT JOIN pledges p ON p.isin = nf.isin AND p.status = 'ACTIVE'
      GROUP BY nf.fund_id, nf.isin, nf.scheme_name, nf.reason, nf.source, nf.flagged_at, nf.is_active
      ORDER BY nf.flagged_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── BLOCK / UNBLOCK USER ──────────────────────────────────────
router.post('/block-user', async (req, res) => {
  const { user_id, reason = 'Admin action' } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
  try {
    await query(`UPDATE credit_accounts SET status = 'FROZEN', upi_active = false, updated_at = NOW() WHERE user_id = $1`, [user_id]);
    await query(`UPDATE users SET account_status = 'FROZEN', updated_at = NOW() WHERE user_id = $1`, [user_id]);
    await query(`INSERT INTO audit_trail (event_type, entity_type, entity_id, new_values)
                 VALUES ('USER_BLOCKED', 'user', $1, $2)`,
                [user_id, JSON.stringify({ reason, blocked_by: 'admin', blocked_at: new Date().toISOString() })]);
    logger.info(`USER BLOCKED: ${user_id} — ${reason}`);
    res.json({ success: true, message: 'User blocked', user_id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/unblock-user', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
  try {
    const pledgedTotal = await query(`
      SELECT COALESCE(SUM(eligible_value_at_pledge), 0) as total
      FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'
    `, [user_id]);
    const limit = Math.round(parseFloat(pledgedTotal.rows[0].total || 0));

    await query(`
      UPDATE credit_accounts SET status = 'ACTIVE', upi_active = true,
             credit_limit = $2, available_credit = $2 - COALESCE(outstanding, 0), updated_at = NOW()
      WHERE user_id = $1
    `, [user_id, limit]);
    await query(`UPDATE users SET account_status = 'CREDIT_ACTIVE', updated_at = NOW() WHERE user_id = $1`, [user_id]);
    await query(`INSERT INTO audit_trail (event_type, entity_type, entity_id, new_values)
                 VALUES ('USER_UNBLOCKED', 'user', $1, $2)`,
                [user_id, JSON.stringify({ unblocked_by: 'admin', unblocked_at: new Date().toISOString() })]);
    res.json({ success: true, message: 'User unblocked', user_id, new_limit: limit });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
