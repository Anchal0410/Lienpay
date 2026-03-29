const express = require('express');
const router  = express.Router();
const { query }         = require('../../config/database');
const { logger, audit } = require('../../config/logger');
const { checkLTVHealth } = require('../risk/risk.engine');

// ─────────────────────────────────────────────────────────────
// NBFC PROGRAMMATIC API
//
// This is the machine-to-machine API layer between LienPay (LSP)
// and the NBFC (Regulated Entity / RE).
//
// The NBFC integrates this API into their own loan management
// system (LMS) or credit operations platform. They do NOT need
// to manually use the lender dashboard for day-to-day operations.
//
// RBI Digital Lending Directions 2025:
//   - RE (NBFC) retains full responsibility for all credit decisions
//   - LSP (LienPay) provides data and executes NBFC's instructions
//   - All actions here are NBFC-initiated, LienPay-executed
//
// AUTH: NBFC_API_KEY from env — set in .env:
//   NBFC_API_KEY=your_shared_secret_from_nbfc_agreement
//
// The NBFC uses this key in the header: x-nbfc-api-key
//
// ENDPOINT MAP:
//   DATA (NBFC reads):
//     GET  /api/nbfc/book-summary          Book health snapshot
//     GET  /api/nbfc/ltv-alerts            All LTV breach accounts
//     GET  /api/nbfc/portfolio/:userId     Full portfolio + LTV for a user
//     GET  /api/nbfc/user/:userId          User + credit account status
//     GET  /api/nbfc/margin-calls          All active margin calls
//     GET  /api/nbfc/pledges/:userId       Active pledges for a user
//
//   ACTIONS (NBFC authorizes, LienPay executes):
//     POST /api/nbfc/margin-call/issue     NBFC formally issues margin call
//     POST /api/nbfc/margin-call/resolve   NBFC resolves margin call
//     POST /api/nbfc/pledge/invoke         NBFC authorizes pledge invocation
//     POST /api/nbfc/credit/activate       NBFC activates credit line
//     POST /api/nbfc/credit/adjust-limit   NBFC adjusts credit limit
//     POST /api/nbfc/credit/freeze         NBFC freezes credit line
//     POST /api/nbfc/credit/unfreeze       NBFC unfreezes credit line
//     POST /api/nbfc/notification/push     NBFC triggers in-app alert
//     POST /api/nbfc/webhook/register      NBFC registers webhook URL
// ─────────────────────────────────────────────────────────────

// ── AUTHENTICATION ────────────────────────────────────────────
const nbfcAuth = (req, res, next) => {
  const key = req.headers['x-nbfc-api-key'];
  if (!key || key !== (process.env.NBFC_API_KEY || 'nbfc-dev-key-2026')) {
    logger.warn('NBFC API: Unauthorized attempt', { ip: req.ip, path: req.path });
    return res.status(403).json({ success: false, error: 'Invalid NBFC API key' });
  }
  next();
};

router.use(nbfcAuth);

// Log all NBFC API calls for compliance audit trail
router.use((req, res, next) => {
  audit('NBFC_API_CALL', 'system', {
    method: req.method,
    path:   req.path,
    body:   req.method === 'POST' ? req.body : undefined,
    ip:     req.ip,
  });
  next();
});

// ═══════════════════════════════════════════════════════════════
// DATA ENDPOINTS — NBFC READS FROM LIENPAY
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/nbfc/book-summary
 * Full book health snapshot. NBFC can poll this for their LMS.
 * Equivalent to the lender dashboard overview, but machine-readable.
 */
router.get('/book-summary', async (req, res) => {
  try {
    const [book, ltvHealth, alerts, marginCalls] = await Promise.all([
      query(`
        SELECT
          COUNT(*) as total_accounts,
          COUNT(*) FILTER (WHERE status = 'ACTIVE')  as active_accounts,
          COUNT(*) FILTER (WHERE status = 'FROZEN')  as frozen_accounts,
          COALESCE(SUM(credit_limit),      0) as total_sanctioned,
          COALESCE(SUM(outstanding),       0) as total_outstanding,
          COALESCE(SUM(available_credit),  0) as total_undrawn,
          COALESCE(AVG(credit_limit),      0) as avg_ticket_size,
          COALESCE(AVG(apr),               0) as weighted_avg_apr
        FROM credit_accounts
      `).catch(() => ({ rows: [{}] })),

      query(`
        SELECT
          COUNT(*) FILTER (WHERE ltv_alert_level = 'GREEN') as green,
          COUNT(*) FILTER (WHERE ltv_alert_level = 'AMBER') as amber,
          COUNT(*) FILTER (WHERE ltv_alert_level = 'RED')   as red,
          COUNT(*) FILTER (WHERE ltv_alert_level IS NULL)   as unknown
        FROM credit_accounts
        WHERE status = 'ACTIVE' AND outstanding > 0
      `).catch(() => ({ rows: [{}] })),

      query(`
        SELECT COUNT(*) as count
        FROM credit_accounts
        WHERE ltv_alert_level IN ('AMBER','RED') AND status = 'ACTIVE'
      `).catch(() => ({ rows: [{ count: 0 }] })),

      query(`
        SELECT COUNT(*) as count
        FROM margin_calls
        WHERE status IN ('PENDING', 'ISSUED')
      `).catch(() => ({ rows: [{ count: 0 }] })),
    ]);

    res.json({ success: true, data: {
      snapshot_at:     new Date().toISOString(),
      book:            book.rows[0],
      ltv_health:      ltvHealth.rows[0],
      active_alerts:   parseInt(alerts.rows[0]?.count || 0),
      open_margin_calls: parseInt(marginCalls.rows[0]?.count || 0),
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/nbfc/ltv-alerts
 * All accounts with LTV breach (AMBER or RED).
 * NBFC polls this every hour/day to find accounts needing action.
 * Query params: ?status=AMBER|RED|ALL (default ALL breaches)
 */
router.get('/ltv-alerts', async (req, res) => {
  const statusFilter = req.query.status;
  const whereClause  = statusFilter && statusFilter !== 'ALL'
    ? `AND ca.ltv_alert_level = '${statusFilter.toUpperCase()}'`
    : `AND ca.ltv_alert_level IN ('AMBER', 'RED')`;

  try {
    const result = await query(`
      SELECT
        ca.user_id,
        ca.account_id,
        ca.ltv_ratio,
        ca.ltv_alert_level   AS alert_status,
        ca.outstanding,
        ca.credit_limit,
        ca.available_credit,
        u.full_name,
        u.mobile,
        mc.margin_call_id,
        mc.status            AS margin_call_status,
        mc.created_at        AS margin_call_issued_at,
        mc.deadline          AS margin_call_deadline,
        -- Days since margin call issued (for NBFC to track deadline)
        CASE WHEN mc.created_at IS NOT NULL
          THEN EXTRACT(DAY FROM NOW() - mc.created_at)
          ELSE NULL
        END                  AS days_since_margin_call,
        -- Action NBFC should take
        CASE
          WHEN ca.ltv_alert_level = 'RED' AND mc.margin_call_id IS NULL
            THEN 'ISSUE_MARGIN_CALL'
          WHEN ca.ltv_alert_level = 'RED' AND mc.margin_call_id IS NOT NULL
            AND EXTRACT(DAY FROM NOW() - mc.created_at) >= 3
            THEN 'CONSIDER_PLEDGE_INVOCATION'
          WHEN ca.ltv_alert_level = 'RED' AND mc.margin_call_id IS NOT NULL
            THEN 'MONITOR_MARGIN_CALL'
          WHEN ca.ltv_alert_level = 'AMBER'
            THEN 'SEND_WARNING'
          ELSE 'MONITOR'
        END                  AS recommended_action
      FROM credit_accounts ca
      JOIN users u ON u.user_id = ca.user_id
      LEFT JOIN margin_calls mc ON mc.user_id = ca.user_id
        AND mc.status IN ('PENDING', 'ISSUED')
      WHERE ca.status = 'ACTIVE'
        AND ca.outstanding > 0
        ${whereClause}
      ORDER BY ca.ltv_ratio DESC
    `);

    res.json({ success: true, data: {
      total:   result.rows.length,
      alerts:  result.rows,
      as_of:   new Date().toISOString(),
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/nbfc/portfolio/:userId
 * Full portfolio + current LTV for a specific user.
 * NBFC uses this to get real-time collateral state before making decisions.
 */
router.get('/portfolio/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const [user, account, holdings, pledges, ltvHealth] = await Promise.all([
      query(`SELECT user_id, full_name, mobile, kyc_status, pan_last4 FROM users WHERE user_id = $1`, [userId]),
      query(`SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE' LIMIT 1`, [userId]),
      query(`SELECT * FROM mf_holdings WHERE user_id = $1 ORDER BY value_at_fetch DESC`, [userId]),
      query(`
        SELECT p.*, n.nav_value as latest_nav
        FROM pledges p
        LEFT JOIN nav_history n ON n.isin = p.isin AND n.nav_date = CURRENT_DATE
        WHERE p.user_id = $1 AND p.status = 'ACTIVE'
      `, [userId]),
      checkLTVHealth(userId, null).catch(() => null),
    ]);

    if (!user.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Calculate current collateral value using latest NAVs
    const currentCollateralValue = pledges.rows.reduce((sum, p) => {
      const nav = parseFloat(p.latest_nav || p.nav_at_pledge || 0);
      return sum + (parseFloat(p.units_pledged || 0) * nav);
    }, 0);

    res.json({ success: true, data: {
      user:         user.rows[0],
      credit_account: account.rows[0] || null,
      ltv_health:   ltvHealth,
      collateral: {
        total_portfolio_value:  holdings.rows.reduce((s, h) => s + parseFloat(h.value_at_fetch || 0), 0),
        current_collateral_value: Math.round(currentCollateralValue),
        pledge_count:           pledges.rows.length,
        pledges:                pledges.rows,
      },
      portfolio: {
        total_funds: holdings.rows.length,
        holdings:    holdings.rows,
      },
      data_freshness: 'NAVs updated nightly from AMFI after 11pm IST',
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/nbfc/user/:userId
 * User details + credit account status for NBFC's LMS.
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.user_id, u.full_name, u.mobile, u.kyc_status, u.pan_last4,
             u.onboarding_step, u.account_status, u.created_at,
             ca.account_id, ca.status as credit_status, ca.credit_limit,
             ca.outstanding, ca.available_credit, ca.apr,
             ca.ltv_ratio, ca.ltv_alert_level, ca.upi_vpa,
             rd.risk_tier, rd.bureau_score_band, rd.fraud_score
      FROM users u
      LEFT JOIN credit_accounts ca ON ca.user_id = u.user_id
      LEFT JOIN risk_decisions rd ON rd.user_id = u.user_id
      WHERE u.user_id = $1
      ORDER BY rd.decided_at DESC
      LIMIT 1
    `, [req.params.userId]);

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/nbfc/margin-calls
 * All active margin calls. NBFC uses this to track open cases.
 * Query params: ?status=PENDING|ISSUED|RESOLVED
 */
router.get('/margin-calls', async (req, res) => {
  const status = req.query.status || 'ISSUED';
  try {
    const result = await query(`
      SELECT mc.*, u.full_name, u.mobile,
             ca.credit_limit, ca.outstanding, ca.ltv_ratio
      FROM margin_calls mc
      JOIN users u ON u.user_id = mc.user_id
      JOIN credit_accounts ca ON ca.user_id = mc.user_id
      WHERE mc.status = $1
      ORDER BY mc.created_at DESC
    `, [status]);

    res.json({ success: true, data: { margin_calls: result.rows, total: result.rows.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
// ACTION ENDPOINTS — NBFC AUTHORIZES, LIENPAY EXECUTES
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/nbfc/margin-call/issue
 *
 * NBFC formally issues a margin call for a user.
 * LienPay records this and shows it to the user in-app.
 * NBFC is responsible for sending SMS/email to the borrower.
 *
 * Body: { user_id, reason?, shortfall_amount?, deadline_days? }
 */
router.post('/margin-call/issue', async (req, res) => {
  const { user_id, reason, shortfall_amount, deadline_days = 90, nbfc_ref } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  try {
    const accountRes = await query(
      `SELECT account_id, outstanding, credit_limit, ltv_ratio FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'`,
      [user_id]
    );
    if (!accountRes.rows.length) {
      return res.status(404).json({ success: false, error: 'No active credit account' });
    }
    const account = accountRes.rows[0];

    const deadline = new Date();
    deadline.setDate(deadline.getDate() + deadline_days);

    const mcRes = await query(`
      INSERT INTO margin_calls
        (user_id, account_id, ltv_at_trigger, outstanding_at_trigger,
         status, deadline, created_at)
      VALUES ($1, $2, $3, $4, 'ISSUED', $5, NOW())
      RETURNING margin_call_id
    `, [
      user_id,
      account.account_id,
      parseFloat(account.ltv_ratio || 0),
      parseFloat(account.outstanding || 0),
      deadline.toISOString(),
    ]);

    // Show in-app notification (LienPay allowed to notify user inside our app)
    await query(`
      INSERT INTO notifications (user_id, type, channel, status, content_preview, sent_at, created_at)
      VALUES ($1, 'MARGIN_CALL', 'PUSH', 'SENT', $2, NOW(), NOW())
    `, [
      user_id,
      `Your lending partner has issued a margin call. Repay or add collateral within ${deadline_days} days to avoid NPA classification.`.slice(0, 100),
    ]).catch(() => {});

    audit('NBFC_MARGIN_CALL_ISSUED', user_id, {
      margin_call_id: mcRes.rows[0].margin_call_id,
      nbfc_ref,
      deadline: deadline.toISOString(),
    });

    logger.info('Margin call issued by NBFC', { user_id, margin_call_id: mcRes.rows[0].margin_call_id });

    res.json({ success: true, data: {
      message:        'Margin call recorded. In-app notification sent to user.',
      margin_call_id: mcRes.rows[0].margin_call_id,
      deadline:       deadline.toISOString(),
      note:           'NBFC must send SMS/email to borrower per RBI guidelines. LienPay cannot send SMS on your behalf.',
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nbfc/margin-call/resolve
 *
 * NBFC marks a margin call as resolved (user repaid or added collateral).
 * Body: { margin_call_id, resolution_type, nbfc_ref? }
 * resolution_type: REPAID | COLLATERAL_ADDED | WAIVED
 */
router.post('/margin-call/resolve', async (req, res) => {
  const { margin_call_id, resolution_type, nbfc_ref } = req.body;
  if (!margin_call_id) return res.status(400).json({ success: false, error: 'margin_call_id required' });

  try {
    await query(`
      UPDATE margin_calls
      SET status = 'RESOLVED', resolved_at = NOW(), updated_at = NOW()
      WHERE margin_call_id = $1
    `, [margin_call_id]);

    audit('NBFC_MARGIN_CALL_RESOLVED', null, { margin_call_id, resolution_type, nbfc_ref });

    res.json({ success: true, data: { message: 'Margin call resolved', margin_call_id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nbfc/pledge/invoke
 *
 * ═══════════════════════════════════════════════════════════════
 * CRITICAL ENDPOINT — NBFC AUTHORIZES PLEDGE INVOCATION
 * ═══════════════════════════════════════════════════════════════
 *
 * The NBFC explicitly authorizes LienPay to invoke (redeem) pledged
 * units to recover the outstanding loan amount.
 *
 * NBFC calls this ONLY after:
 *   1. Margin call was issued (per RBI NPA framework — typically after 90 days of non-payment)
 *   2. Borrower has not repaid or added collateral
 *   3. NBFC's internal credit committee / policy engine approves invocation
 *
 * LienPay then:
 *   1. Validates the authorization
 *   2. Calculates units to redeem (outstanding + 5% buffer)
 *   3. Calls CAMS/KFintech API to invoke the pledge
 *   4. Reports result back to NBFC
 *
 * Body: {
 *   user_id:           string,
 *   pledge_id:         string (optional — if not given, uses primary active pledge),
 *   nbfc_auth_ref:     string (NBFC's authorization reference number — required),
 *   amount_to_recover: number (optional — defaults to full outstanding + buffer),
 *   nbfc_officer_id:   string,
 *   collection_account: string (NBFC's collection account for proceeds)
 * }
 */
router.post('/pledge/invoke', async (req, res) => {
  const {
    user_id,
    pledge_id,
    nbfc_auth_ref,
    amount_to_recover,
    nbfc_officer_id,
    collection_account,
  } = req.body;

  // Validate required fields — without NBFC auth ref, LienPay cannot act
  if (!user_id)       return res.status(400).json({ success: false, error: 'user_id required' });
  if (!nbfc_auth_ref) return res.status(400).json({ success: false, error: 'nbfc_auth_ref required. NBFC must provide authorization reference.' });

  try {
    // 1. Get account details
    const accountRes = await query(
      `SELECT account_id, outstanding, credit_limit FROM credit_accounts WHERE user_id = $1 AND status = 'ACTIVE'`,
      [user_id]
    );
    if (!accountRes.rows.length) {
      return res.status(404).json({ success: false, error: 'No active credit account found' });
    }
    const account = accountRes.rows[0];
    const outstanding = parseFloat(account.outstanding || 0);

    if (outstanding <= 0) {
      return res.status(400).json({ success: false, error: 'No outstanding balance. No invocation needed.' });
    }

    // 2. Get the pledge to invoke
    const pledgeQuery = pledge_id
      ? `SELECT * FROM pledges WHERE pledge_id = $1 AND user_id = $2 AND status = 'ACTIVE'`
      : `SELECT * FROM pledges WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY value_at_pledge DESC LIMIT 1`;
    const pledgeArgs = pledge_id ? [pledge_id, user_id] : [user_id];
    const pledgeRes  = pledge_id
      ? await query(pledgeQuery, pledgeArgs)
      : await query(`SELECT * FROM pledges WHERE user_id = $1 AND status = 'ACTIVE' ORDER BY value_at_pledge DESC LIMIT 1`, [user_id]);

    if (!pledgeRes.rows.length) {
      return res.status(404).json({ success: false, error: 'No active pledge found' });
    }
    const pledge = pledgeRes.rows[0];

    // 3. Calculate units to redeem
    const targetAmount  = amount_to_recover || (outstanding * 1.05); // 5% buffer
    const latestNav     = parseFloat(pledge.nav_at_pledge); // Use latest NAV in production
    const unitsNeeded   = Math.ceil(targetAmount / latestNav);
    const unitsToRedeem = Math.min(unitsNeeded, parseFloat(pledge.units_pledged));

    // 4. Log invocation record BEFORE calling RTA (for audit trail)
    const invRes = await query(`
      INSERT INTO pledge_invocations
        (pledge_id, user_id, invoked_at, units_to_redeem, nav_at_invocation,
         expected_proceeds, outstanding_at_invocation, status, nbfc_auth_ref, nbfc_officer_id)
      VALUES ($1, $2, NOW(), $3, $4, $5, $6, 'INVOKED', $7, $8)
      RETURNING invocation_id
    `, [
      pledge.pledge_id,
      user_id,
      unitsToRedeem,
      latestNav,
      Math.round(unitsToRedeem * latestNav),
      outstanding,
      nbfc_auth_ref,
      nbfc_officer_id || 'NBFC_SYSTEM',
    ]);

    // 5. Call RTA (CAMS or KFintech) to redeem units
    //    The proceeds go to the NBFC's collection account
    const collectionAcc = collection_account
      || process.env.NBFC_COLLECTION_ACCOUNT
      || 'NBFC_NODAL_ACCOUNT';

    let rtaResult = { redemption_ref: `MOCK_${Date.now()}`, status: 'SUCCESS' };

    if (process.env.NODE_ENV === 'production') {
      // Real RTA call — enabled when CAMS_MODE=real or KFINTECH_MODE=real
      try {
        if (pledge.rta === 'CAMS') {
          const { invokePledge } = require('../portfolio/cams.service');
          rtaResult = await invokePledge(pledge.pledge_ref_number, unitsToRedeem, collectionAcc, user_id);
        } else {
          const { invokePledge } = require('../portfolio/kfintech.service');
          rtaResult = await invokePledge(pledge.pledge_ref_number, unitsToRedeem, collectionAcc, user_id);
        }
      } catch (rtaErr) {
        logger.error('RTA invocation failed:', rtaErr.message);
        return res.status(502).json({
          success: false,
          error:   `RTA call failed: ${rtaErr.message}`,
          invocation_id: invRes.rows[0].invocation_id,
          note:    'Invocation logged. Retry or contact CAMS/KFintech support.',
        });
      }
    }

    // 6. Update records
    await query(`
      UPDATE pledge_invocations
      SET redemption_ref = $2, status = 'REDEEMED', updated_at = NOW()
      WHERE invocation_id = $1
    `, [invRes.rows[0].invocation_id, rtaResult.redemption_ref]);

    await query(`
      UPDATE pledges SET status = 'INVOKED', updated_at = NOW()
      WHERE pledge_id = $1
    `, [pledge.pledge_id]);

    audit('NBFC_PLEDGE_INVOKED', user_id, {
      invocation_id:  invRes.rows[0].invocation_id,
      pledge_id:      pledge.pledge_id,
      nbfc_auth_ref,
      nbfc_officer_id,
      units_redeemed: unitsToRedeem,
      redemption_ref: rtaResult.redemption_ref,
      expected_proceeds: Math.round(unitsToRedeem * latestNav),
    });

    logger.info('✅ Pledge invoked on NBFC authorization', {
      user_id,
      nbfc_auth_ref,
      units: unitsToRedeem,
      ref: rtaResult.redemption_ref,
    });

    res.json({ success: true, data: {
      message:          'Pledge invocation submitted to RTA',
      invocation_id:    invRes.rows[0].invocation_id,
      redemption_ref:   rtaResult.redemption_ref,
      units_redeemed:   unitsToRedeem,
      expected_proceeds:Math.round(unitsToRedeem * latestNav),
      collection_account: collectionAcc,
      rta:              pledge.rta,
      note:             'Proceeds will be credited to NBFC collection account upon RTA processing (T+3 business days).',
    }});
  } catch (err) {
    logger.error('Pledge invocation error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nbfc/credit/activate
 * NBFC activates a user's credit line (after approving the application).
 * Body: { user_id, approved_limit, apr?, nbfc_ref? }
 */
router.post('/credit/activate', async (req, res) => {
  const { user_id, approved_limit, apr, nbfc_ref } = req.body;
  if (!user_id || !approved_limit) {
    return res.status(400).json({ success: false, error: 'user_id and approved_limit required' });
  }

  try {
    const rdRes = await query(
      `SELECT apr FROM risk_decisions WHERE user_id = $1 ORDER BY decided_at DESC LIMIT 1`,
      [user_id]
    );
    const finalApr = apr || parseFloat(rdRes.rows[0]?.apr || 14.99);

    const existing = await query(`SELECT account_id FROM credit_accounts WHERE user_id = $1`, [user_id]);

    if (existing.rows.length) {
      await query(`
        UPDATE credit_accounts
        SET credit_limit = $2, available_credit = $2 - outstanding,
            status = 'ACTIVE', updated_at = NOW()
        WHERE user_id = $1
      `, [user_id, approved_limit]);
    } else {
      const vpa = `lp${Date.now().toString().slice(-8)}@lienpay`;
      await query(`
        INSERT INTO credit_accounts
          (user_id, credit_limit, available_credit, outstanding, apr,
           status, upi_vpa, psp_bank, upi_active, free_period_days)
        VALUES ($1, $2, $2, 0, $3, 'ACTIVE', $4, 'LienPay PSP', true, 30)
      `, [user_id, approved_limit, finalApr, vpa]);
    }

    await query(`
      UPDATE users SET onboarding_step = 'ACTIVE', account_status = 'ACTIVE', updated_at = NOW()
      WHERE user_id = $1
    `, [user_id]);

    audit('NBFC_CREDIT_ACTIVATED', user_id, { approved_limit, apr: finalApr, nbfc_ref });

    res.json({ success: true, data: {
      message:        'Credit line activated',
      user_id,
      approved_limit,
      apr:            finalApr,
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nbfc/credit/adjust-limit
 * NBFC adjusts a user's credit limit (up or down).
 * Body: { user_id, new_limit, reason, nbfc_ref? }
 */
router.post('/credit/adjust-limit', async (req, res) => {
  const { user_id, new_limit, reason, nbfc_ref } = req.body;
  if (!user_id || !new_limit) {
    return res.status(400).json({ success: false, error: 'user_id and new_limit required' });
  }

  try {
    const result = await query(`
      UPDATE credit_accounts
      SET credit_limit     = $2,
          available_credit = GREATEST(0, $2 - outstanding),
          updated_at       = NOW()
      WHERE user_id = $1 AND status = 'ACTIVE'
      RETURNING account_id, outstanding
    `, [user_id, parseFloat(new_limit)]);

    if (!result.rows.length) {
      return res.status(404).json({ success: false, error: 'No active credit account found' });
    }

    audit('NBFC_LIMIT_ADJUSTED', user_id, { new_limit, reason, nbfc_ref });

    res.json({ success: true, data: {
      message:   'Credit limit adjusted',
      user_id,
      new_limit,
      outstanding: parseFloat(result.rows[0].outstanding),
    }});
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nbfc/credit/freeze
 * NBFC freezes a user's credit line (prevents further UPI spend).
 * Body: { user_id, reason, nbfc_ref? }
 */
router.post('/credit/freeze', async (req, res) => {
  const { user_id, reason, nbfc_ref } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  try {
    await query(`
      UPDATE credit_accounts
      SET status = 'FROZEN', upi_active = false, updated_at = NOW()
      WHERE user_id = $1
    `, [user_id]);

    audit('NBFC_ACCOUNT_FROZEN', user_id, { reason, nbfc_ref });

    res.json({ success: true, data: { message: 'Credit line frozen. UPI transactions blocked.', user_id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nbfc/credit/unfreeze
 * NBFC unfreezes a user's credit line.
 * Body: { user_id, nbfc_ref? }
 */
router.post('/credit/unfreeze', async (req, res) => {
  const { user_id, nbfc_ref } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  try {
    await query(`
      UPDATE credit_accounts
      SET status = 'ACTIVE', upi_active = true, updated_at = NOW()
      WHERE user_id = $1
    `, [user_id]);

    audit('NBFC_ACCOUNT_UNFROZEN', user_id, { nbfc_ref });

    res.json({ success: true, data: { message: 'Credit line unfrozen.', user_id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nbfc/notification/push
 * NBFC triggers an in-app notification to a user via LienPay's app.
 * This is how NBFC communicates inside the app (SMS they send directly).
 * Body: { user_id, title, body, type? }
 */
router.post('/notification/push', async (req, res) => {
  const { user_id, title, body: msgBody, type = 'NBFC_MESSAGE' } = req.body;
  if (!user_id || !title || !msgBody) {
    return res.status(400).json({ success: false, error: 'user_id, title, and body required' });
  }

  try {
    await query(`
      INSERT INTO notifications (user_id, type, channel, status, content_preview, sent_at, created_at)
      VALUES ($1, $2, 'PUSH', 'SENT', $3, NOW(), NOW())
    `, [user_id, type, `${title}: ${msgBody}`.slice(0, 100)]);

    res.json({ success: true, data: { message: 'In-app notification queued', user_id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/nbfc/webhook/register
 * NBFC registers or updates their webhook URL for LTV event notifications.
 * LienPay will POST to this URL when LTV breaches thresholds.
 * Body: { webhook_url, events?: string[], secret? }
 */
router.post('/webhook/register', async (req, res) => {
  const { webhook_url, events, secret } = req.body;
  if (!webhook_url) return res.status(400).json({ success: false, error: 'webhook_url required' });

  // In production: store in DB table `nbfc_webhooks`
  // For now: log it and tell dev to set env var
  logger.info('NBFC webhook registered:', { webhook_url, events });
  audit('NBFC_WEBHOOK_REGISTERED', null, { webhook_url, events });

  res.json({ success: true, data: {
    message:  'Webhook URL registered',
    url:      webhook_url,
    events:   events || ['ltv.amber_alert', 'ltv.red_alert', 'ltv.recovered'],
    note:     'Set NBFC_WEBHOOK_URL in LienPay backend .env to persist across restarts.',
  }});
});

module.exports = router;
