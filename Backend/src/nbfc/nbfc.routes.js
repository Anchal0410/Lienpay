const express = require('express');
const router  = express.Router();
const { query }         = require('../../config/database');
const { logger, audit } = require('../../config/logger');
const { checkLTVHealth } = require('../risk/risk.engine');
const { createInAppAlert } = require('../monitoring/nav.monitor');

// ─────────────────────────────────────────────────────────────
// NBFC PROGRAMMATIC API  (Machine-to-Machine)
//
// Auth: x-nbfc-api-key header
//
// IMPORTANT CORRECTIONS (per founder + RBI rules):
//
//  1. POST /nbfc/margin-call/issue
//     → NBFC issues margin call
//     → LienPay ALSO fires in-app notification to user (our job)
//     → NBFC must send SMS separately (their obligation per RBI)
//
//  2. POST /nbfc/pledge/invoke
//     → NBFC authorizes; LienPay has NO right to call MF Central/CAMS/KFintech
//     → This endpoint only RECORDS the authorization and instructs NBFC to
//       proceed via their own MF Central credentials
//     → Changed from "LienPay executes" to "NBFC executes with their credentials"
//
//  3. POST /nbfc/credit/freeze
//     → NBFC FREEZES credit limit (not block UPI spending)
//     → UPI spending is automatically frozen by LienPay at 80% LTV
//     → NBFC's freeze is a credit-level freeze (more permanent)
//
//  4. Cron webhook notes
//     → Cron fires ltv.red_alert when LTV ≥ 90%
//     → LienPay already freezes UPI at 80% LTV (product rule)
//     → NBFC receives webhook and handles SMS + margin call decision
// ─────────────────────────────────────────────────────────────

// AUTH
const nbfcAuth = (req, res, next) => {
  const key = req.headers['x-nbfc-api-key'];
  if (!key || key !== (process.env.NBFC_API_KEY || 'nbfc-dev-key-2026')) {
    logger.warn('NBFC API: Unauthorized', { ip: req.ip, path: req.path });
    return res.status(403).json({ success: false, error: 'Invalid NBFC API key' });
  }
  next();
};
router.use(nbfcAuth);

router.use((req, res, next) => {
  audit('NBFC_API_CALL', 'system', {
    method: req.method,
    path:   req.path,
    body:   req.method === 'POST' ? req.body : undefined,
  });
  next();
});

// ═══════════════════════════════════════════════════════════════
// DATA ENDPOINTS
// ═══════════════════════════════════════════════════════════════

router.get('/book-summary', async (req, res) => {
  try {
    const [book, ltv, alerts, mc] = await Promise.all([
      query(`SELECT COUNT(*) as total_accounts, COUNT(*) FILTER (WHERE status='ACTIVE') as active,
             COALESCE(SUM(credit_limit),0) as total_sanctioned,
             COALESCE(SUM(outstanding),0) as total_outstanding,
             COALESCE(AVG(credit_limit),0) as avg_ticket
             FROM credit_accounts`).catch(()=>({rows:[{}]})),
      query(`SELECT COUNT(*) FILTER (WHERE ltv_alert_level='GREEN') as green,
             COUNT(*) FILTER (WHERE ltv_alert_level='AMBER') as amber,
             COUNT(*) FILTER (WHERE ltv_alert_level='RED') as red
             FROM credit_accounts WHERE status='ACTIVE' AND outstanding>0`).catch(()=>({rows:[{}]})),
      query(`SELECT COUNT(*) as count FROM credit_accounts WHERE ltv_alert_level IN ('AMBER','RED') AND status='ACTIVE'`).catch(()=>({rows:[{count:0}]})),
      query(`SELECT COUNT(*) as count FROM margin_calls WHERE status IN ('PENDING','ISSUED')`).catch(()=>({rows:[{count:0}]})),
    ]);
    res.json({ success: true, data: {
      snapshot_at: new Date().toISOString(),
      book: book.rows[0], ltv_health: ltv.rows[0],
      active_alerts: parseInt(alerts.rows[0]?.count||0),
      open_margin_calls: parseInt(mc.rows[0]?.count||0),
    }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/ltv-alerts', async (req, res) => {
  const sf = req.query.status;
  const where = sf && sf!=='ALL' ? `AND ca.ltv_alert_level='${sf.toUpperCase()}'` : `AND ca.ltv_alert_level IN ('AMBER','RED')`;
  try {
    const result = await query(`
      SELECT ca.user_id, ca.account_id, ca.ltv_ratio, ca.ltv_alert_level as alert_status,
             ca.outstanding, ca.credit_limit, ca.upi_active,
             u.full_name, u.mobile,
             mc.margin_call_id, mc.status as margin_call_status, mc.created_at as margin_call_issued_at,
             mc.deadline,
             EXTRACT(DAY FROM NOW() - mc.created_at) as days_since_margin_call,
             CASE
               WHEN ca.ltv_alert_level='RED' AND mc.margin_call_id IS NULL THEN 'ISSUE_MARGIN_CALL'
               WHEN ca.ltv_alert_level='RED' AND EXTRACT(DAY FROM NOW()-mc.created_at)>=90 THEN 'CONSIDER_NPA_INVOCATION'
               WHEN ca.ltv_alert_level='RED' THEN 'MONITOR_MARGIN_CALL'
               WHEN ca.ltv_alert_level='AMBER' THEN 'SEND_WARNING'
               ELSE 'MONITOR'
             END as recommended_action
      FROM credit_accounts ca
      JOIN users u ON u.user_id=ca.user_id
      LEFT JOIN margin_calls mc ON mc.user_id=ca.user_id AND mc.status IN ('PENDING','ISSUED')
      WHERE ca.status='ACTIVE' AND ca.outstanding>0 ${where}
      ORDER BY ca.ltv_ratio DESC
    `);
    res.json({ success: true, data: { total: result.rows.length, alerts: result.rows, as_of: new Date().toISOString() }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/portfolio/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const [user, account, holdings, pledges, ltvHealth] = await Promise.all([
      query(`SELECT user_id, full_name, mobile, kyc_status, pan_last4 FROM users WHERE user_id=$1`, [userId]),
      query(`SELECT * FROM credit_accounts WHERE user_id=$1 AND status='ACTIVE' LIMIT 1`, [userId]),
      query(`SELECT * FROM mf_holdings WHERE user_id=$1 ORDER BY value_at_fetch DESC`, [userId]),
      query(`SELECT p.*, n.nav_value as latest_nav, COALESCE(nf.is_active,false) as is_notorious
             FROM pledges p
             LEFT JOIN nav_history n ON n.isin=p.isin AND n.nav_date=CURRENT_DATE
             LEFT JOIN notorious_funds nf ON nf.isin=p.isin AND nf.is_active=true
             WHERE p.user_id=$1 AND p.status='ACTIVE'`, [userId]),
      checkLTVHealth(userId, null).catch(()=>null),
    ]);
    if (!user.rows.length) return res.status(404).json({ success: false, error: 'User not found' });
    const currentCollateral = pledges.rows.reduce((sum,p) => {
      const nav = parseFloat(p.latest_nav||p.nav_at_pledge||0);
      return sum + (parseFloat(p.units_pledged||0)*nav);
    }, 0);
    res.json({ success: true, data: {
      user: user.rows[0], credit_account: account.rows[0]||null,
      ltv_health: ltvHealth,
      collateral: { total_portfolio_value: holdings.rows.reduce((s,h)=>s+parseFloat(h.value_at_fetch||0),0),
        current_collateral_value: Math.round(currentCollateral), pledge_count: pledges.rows.length, pledges: pledges.rows },
    }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/user/:userId', async (req, res) => {
  try {
    const result = await query(`
      SELECT u.user_id, u.full_name, u.mobile, u.kyc_status, u.pan_last4,
             u.onboarding_step, u.account_status, u.created_at,
             ca.account_id, ca.status as credit_status, ca.credit_limit,
             ca.outstanding, ca.available_credit, ca.apr, ca.apr_product,
             ca.ltv_ratio, ca.ltv_alert_level, ca.upi_vpa, ca.upi_active,
             rd.risk_tier
      FROM users u
      LEFT JOIN credit_accounts ca ON ca.user_id=u.user_id
      LEFT JOIN risk_decisions rd ON rd.user_id=u.user_id
      WHERE u.user_id=$1 ORDER BY rd.decided_at DESC LIMIT 1
    `, [req.params.userId]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/margin-calls', async (req, res) => {
  const status = req.query.status || 'ISSUED';
  try {
    const result = await query(`
      SELECT mc.*, u.full_name, u.mobile, ca.credit_limit, ca.outstanding, ca.ltv_ratio
      FROM margin_calls mc
      JOIN users u ON u.user_id=mc.user_id
      JOIN credit_accounts ca ON ca.user_id=mc.user_id
      WHERE mc.status=$1 ORDER BY mc.created_at DESC
    `, [status]);
    res.json({ success: true, data: { margin_calls: result.rows, total: result.rows.length }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// ACTION ENDPOINTS
// ═══════════════════════════════════════════════════════════════

/**
 * POST /api/nbfc/margin-call/issue
 *
 * NBFC issues formal margin call.
 * LienPay records it AND sends in-app notification to user.
 * NBFC must send SMS separately (RBI obligation).
 *
 * Body: { user_id, reason?, shortfall_amount?, deadline_days?, nbfc_ref? }
 */
router.post('/margin-call/issue', async (req, res) => {
  const { user_id, reason, shortfall_amount, deadline_days = 90, nbfc_ref } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });

  try {
    const accountRes = await query(
      `SELECT account_id, outstanding, credit_limit, ltv_ratio FROM credit_accounts WHERE user_id=$1 AND status='ACTIVE'`,
      [user_id]
    );
    if (!accountRes.rows.length) return res.status(404).json({ success: false, error: 'No active credit account' });
    const account = accountRes.rows[0];

    const deadline = new Date();
    deadline.setDate(deadline.getDate() + deadline_days);

    const mcRes = await query(`
      INSERT INTO margin_calls
        (user_id, account_id, ltv_at_trigger, outstanding_at_trigger, status, deadline, created_at)
      VALUES ($1,$2,$3,$4,'ISSUED',$5,NOW())
      RETURNING margin_call_id
    `, [user_id, account.account_id, parseFloat(account.ltv_ratio||0), parseFloat(account.outstanding||0), deadline]);

    // LienPay fires in-app notification (we own the app — this is allowed)
    await createInAppAlert(user_id, 'LTV_RED', {
      ltv_pct: parseFloat(account.ltv_ratio||0).toFixed(1),
    });

    // Also insert a specific margin call notification
    await query(`
      INSERT INTO notifications (user_id, type, channel, status, content_preview, sent_at, created_at)
      VALUES ($1, 'MARGIN_CALL', 'PUSH', 'SENT', $2, NOW(), NOW())
    `, [user_id,
      `Margin call issued. Repay or add collateral within ${deadline_days} days to avoid NPA. Your NBFC will contact you via SMS/email.`.slice(0,100),
    ]).catch(()=>{});

    audit('NBFC_MARGIN_CALL_ISSUED', user_id, {
      margin_call_id: mcRes.rows[0].margin_call_id,
      nbfc_ref,
      deadline: deadline.toISOString(),
    });

    res.json({ success: true, data: {
      message: 'Margin call recorded. In-app notification sent to user.',
      margin_call_id: mcRes.rows[0].margin_call_id,
      deadline: deadline.toISOString(),
      note: 'NBFC must send SMS/email to borrower per RBI guidelines. LienPay in-app notification already sent.',
    }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/margin-call/resolve', async (req, res) => {
  const { margin_call_id, resolution_type, nbfc_ref } = req.body;
  if (!margin_call_id) return res.status(400).json({ success: false, error: 'margin_call_id required' });
  try {
    await query(`UPDATE margin_calls SET status='RESOLVED', resolved_at=NOW(), updated_at=NOW() WHERE margin_call_id=$1`, [margin_call_id]);
    audit('NBFC_MARGIN_CALL_RESOLVED', null, { margin_call_id, resolution_type, nbfc_ref });
    res.json({ success: true, data: { message: 'Margin call resolved', margin_call_id }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

/**
 * POST /api/nbfc/pledge/invoke
 *
 * ═══════════════════════════════════════════════════════════════
 * IMPORTANT: LienPay has NO right to call MF Central/CAMS/KFintech
 * for pledge invocation. This is the NBFC's action using their own
 * MF Central credentials.
 *
 * What this endpoint does:
 *   1. Records NBFC's authorization decision in LienPay's DB
 *   2. Returns the pledge reference data NBFC needs for their own
 *      MF Central API call
 *   3. NBFC then calls MF Central directly with their credentials
 *   4. NBFC reports the result back via /pledge/invocation-result
 *
 * Body: { user_id, nbfc_auth_ref (required), nbfc_officer_id }
 */
router.post('/pledge/invoke', async (req, res) => {
  const { user_id, nbfc_auth_ref, nbfc_officer_id } = req.body;

  if (!user_id)       return res.status(400).json({ success: false, error: 'user_id required' });
  if (!nbfc_auth_ref) return res.status(400).json({ success: false, error: 'nbfc_auth_ref required' });

  try {
    const accountRes = await query(
      `SELECT account_id, outstanding FROM credit_accounts WHERE user_id=$1 AND status='ACTIVE'`,
      [user_id]
    );
    if (!accountRes.rows.length) return res.status(404).json({ success: false, error: 'No active account' });

    const pledges = await query(`
      SELECT pledge_id, isin, folio_number, units_pledged, nav_at_pledge
      FROM pledges WHERE user_id=$1 AND status='ACTIVE'
    `, [user_id]);

    if (!pledges.rows.length) return res.status(404).json({ success: false, error: 'No active pledges' });

    // Log the authorization (audit trail — required by RBI)
    await query(`
      INSERT INTO audit_trail (event_type, entity_type, entity_id, new_values, created_at)
      VALUES ('NBFC_PLEDGE_INVOCATION_AUTHORIZED', 'user', $1, $2, NOW())
    `, [user_id, JSON.stringify({
      nbfc_auth_ref,
      nbfc_officer_id,
      outstanding: accountRes.rows[0].outstanding,
      pledge_count: pledges.rows.length,
    })]);

    audit('NBFC_PLEDGE_INVOKE_RECORDED', user_id, { nbfc_auth_ref, nbfc_officer_id });

    // Return the pledge data NBFC needs for their own MF Central call
    res.json({ success: true, data: {
      message: 'Authorization recorded. NBFC must execute pledge invocation via their own MF Central credentials.',
      authorization_logged: true,
      nbfc_auth_ref,
      pledges_data: pledges.rows.map(p => ({
        pledge_id:        p.pledge_id,
        isin:             p.isin,
        folio_number:     p.folio_number,
        units_available:  p.units_pledged,
        nav_at_pledge:    p.nav_at_pledge,
      })),
      outstanding: parseFloat(accountRes.rows[0].outstanding),
      note: 'LienPay has NO right to call MF Central/CAMS/KFintech for invocation. NBFC executes this via their own MF Central account using the pledge data above.',
    }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

/**
 * POST /api/nbfc/pledge/invocation-result
 * NBFC reports the result of their pledge invocation back to LienPay.
 * Body: { user_id, nbfc_auth_ref, redemption_ref, units_redeemed, proceeds_expected }
 */
router.post('/pledge/invocation-result', async (req, res) => {
  const { user_id, nbfc_auth_ref, redemption_ref, units_redeemed, proceeds_expected } = req.body;
  if (!user_id || !nbfc_auth_ref || !redemption_ref) {
    return res.status(400).json({ success: false, error: 'user_id, nbfc_auth_ref, redemption_ref required' });
  }

  try {
    await query(`
      UPDATE pledges SET status='INVOKED', updated_at=NOW()
      WHERE user_id=$1 AND status='ACTIVE'
    `, [user_id]);

    audit('NBFC_PLEDGE_INVOCATION_RESULT', user_id, {
      nbfc_auth_ref, redemption_ref, units_redeemed, proceeds_expected,
    });

    res.json({ success: true, data: { message: 'Invocation result recorded', user_id }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/credit/activate', async (req, res) => {
  const { user_id, approved_limit, apr, apr_product, nbfc_ref } = req.body;
  if (!user_id || !approved_limit) return res.status(400).json({ success: false, error: 'user_id and approved_limit required' });
  try {
    const vpa = `lp${Date.now().toString().slice(-8)}@lienpay`;
    const existing = await query(`SELECT account_id FROM credit_accounts WHERE user_id=$1`, [user_id]);
    if (existing.rows.length) {
      await query(`UPDATE credit_accounts SET credit_limit=$2, available_credit=$2-outstanding, status='ACTIVE',
                   apr=$3, apr_product=$4, updated_at=NOW() WHERE user_id=$1`,
                  [user_id, approved_limit, apr||12.00, apr_product||'STANDARD']);
    } else {
      await query(`INSERT INTO credit_accounts (user_id, credit_limit, available_credit, outstanding, apr, apr_product,
                   status, upi_vpa, upi_active, free_period_days)
                   VALUES ($1,$2,$2,0,$3,$4,'ACTIVE',$5,true,30)`,
                  [user_id, approved_limit, apr||12.00, apr_product||'STANDARD', vpa]);
    }
    await query(`UPDATE users SET onboarding_step='ACTIVE', account_status='ACTIVE', updated_at=NOW() WHERE user_id=$1`, [user_id]);
    audit('NBFC_CREDIT_ACTIVATED', user_id, { approved_limit, apr, apr_product, nbfc_ref });
    res.json({ success: true, data: { message: 'Credit line activated', user_id, approved_limit, apr, apr_product }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/credit/adjust-limit', async (req, res) => {
  const { user_id, new_limit, reason, nbfc_ref } = req.body;
  if (!user_id || !new_limit) return res.status(400).json({ success: false, error: 'user_id and new_limit required' });
  try {
    const result = await query(`UPDATE credit_accounts SET credit_limit=$2, available_credit=GREATEST(0,$2-outstanding),
                                updated_at=NOW() WHERE user_id=$1 AND status='ACTIVE' RETURNING account_id, outstanding`,
                               [user_id, parseFloat(new_limit)]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'No active account' });
    audit('NBFC_LIMIT_ADJUSTED', user_id, { new_limit, reason, nbfc_ref });
    res.json({ success: true, data: { message: 'Credit limit adjusted', user_id, new_limit }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

/**
 * POST /api/nbfc/credit/freeze
 * NBFC freezes the credit limit (not UPI spending).
 * Credit limit freeze = sets credit_limit to outstanding amount
 * so no new spending is possible. Stronger than UPI freeze.
 */
router.post('/credit/freeze', async (req, res) => {
  const { user_id, reason, nbfc_ref } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
  try {
    // Freeze credit limit = set available_credit to 0 and mark frozen
    await query(`UPDATE credit_accounts SET status='FROZEN', available_credit=0, updated_at=NOW() WHERE user_id=$1`, [user_id]);
    await query(`INSERT INTO notifications (user_id, type, channel, status, content_preview, sent_at, created_at)
                 VALUES ($1,'CREDIT_FROZEN','PUSH','SENT','Your credit limit has been frozen by your lending partner.',NOW(),NOW())`,
                [user_id]).catch(()=>{});
    audit('NBFC_CREDIT_FROZEN', user_id, { reason, nbfc_ref });
    res.json({ success: true, data: { message: 'Credit limit frozen. No new spending allowed.', user_id,
      note: 'This freezes the credit limit (sets available_credit=0). UPI spending is separately frozen by LienPay at 80% LTV.' }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/credit/unfreeze', async (req, res) => {
  const { user_id, nbfc_ref } = req.body;
  if (!user_id) return res.status(400).json({ success: false, error: 'user_id required' });
  try {
    await query(`UPDATE credit_accounts SET status='ACTIVE', available_credit=credit_limit-outstanding, updated_at=NOW() WHERE user_id=$1`, [user_id]);
    audit('NBFC_CREDIT_UNFROZEN', user_id, { nbfc_ref });
    res.json({ success: true, data: { message: 'Credit limit unfrozen.', user_id }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/notification/push', async (req, res) => {
  const { user_id, title, body: msgBody, type = 'NBFC_MESSAGE' } = req.body;
  if (!user_id || !title || !msgBody) return res.status(400).json({ success: false, error: 'user_id, title, body required' });
  try {
    await query(`INSERT INTO notifications (user_id, type, channel, status, content_preview, sent_at, created_at)
                 VALUES ($1,$2,'PUSH','SENT',$3,NOW(),NOW())`,
                [user_id, type, `${title}: ${msgBody}`.slice(0,100)]);
    res.json({ success: true, data: { message: 'Notification sent', user_id }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/webhook/register', async (req, res) => {
  const { webhook_url, events } = req.body;
  if (!webhook_url) return res.status(400).json({ success: false, error: 'webhook_url required' });
  logger.info('NBFC webhook registered:', { webhook_url, events });
  audit('NBFC_WEBHOOK_REGISTERED', null, { webhook_url, events });
  res.json({ success: true, data: {
    message: 'Webhook URL registered',
    url: webhook_url,
    events: events || ['ltv.amber_alert','ltv.red_alert','ltv.recovered','fund.notorious_flagged'],
    note: 'Set NBFC_WEBHOOK_URL in LienPay backend .env to persist.',
  }});
});

module.exports = router;
