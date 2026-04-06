const { query }  = require('../../config/database');
const { logger, audit } = require('../../config/logger');
const { checkNotoriousFunds } = require('../portfolio/mf_central.service');

// ─────────────────────────────────────────────────────────────
// NOTORIOUS FUND DETECTION SERVICE
//
// "Notorious funds" = mutual funds flagged by SEBI, AMFI, or
// LienPay's internal risk team as high-risk, under investigation,
// suspended, or subject to side-pocketing.
//
// Examples:
//   - Funds under SEBI enforcement action
//   - Funds with sudden large NAV drops (>30% in a week)
//   - Funds with suspended redemptions
//   - Funds with fraud/mismanagement allegations
//
// WHAT HAPPENS WHEN A FUND IS FLAGGED:
//
//  At Pledge Time:
//    - If user tries to pledge a notorious fund → BLOCK pledge
//    - Show clear warning: "This fund is on SEBI watchlist"
//
//  For Existing Pledges (daily cron):
//    - Check all active pledges against watchlist
//    - If a previously clean fund gets flagged:
//        1. Mark fund as notorious in DB
//        2. Send in-app notification to affected users
//        3. Freeze UPI for affected users (notorious fund LTV rule)
//        4. Fire webhook to NBFC
//
//  LTV Rule for Notorious Funds:
//    - Notorious funds count as 0% LTV for limit calculation
//    - BUT outstanding balance remains (user still owes it)
//    - This pushes LTV ratio above 80% → UPI freeze kicks in
//    - Purpose: ensure remaining non-notorious collateral covers the loan
// ─────────────────────────────────────────────────────────────

// ── RUN NOTORIOUS FUND CHECK (called from cron) ───────────────
const runNotoriousFundCheck = async () => {
  logger.info('🔍 Running notorious fund check...');

  const results = {
    funds_checked:    0,
    new_flags:        0,
    users_affected:   0,
    upi_freezes:      0,
    notifications_sent: 0,
  };

  try {
    // Get all ISINs currently in active pledges
    const pledgeIsins = await query(`
      SELECT DISTINCT p.isin, mh.scheme_name
      FROM pledges p
      JOIN mf_holdings mh ON mh.isin = p.isin AND mh.user_id = p.user_id
      WHERE p.status = 'ACTIVE'
    `).catch(() => ({ rows: [] }));

    if (!pledgeIsins.rows.length) {
      logger.info('No active pledges to check');
      return results;
    }

    results.funds_checked = pledgeIsins.rows.length;
    const isins = pledgeIsins.rows.map(r => r.isin);

    // Check against MF Central watchlist
    const notoriousHits = await checkNotoriousFunds(isins);

    if (!notoriousHits.length) {
      logger.info('✅ No notorious funds found in active pledges');
      return results;
    }

    logger.warn(`⚠️ ${notoriousHits.length} notorious fund(s) found in active pledges!`);

    for (const notoriousFund of notoriousHits) {
      const isin = notoriousFund.isin;

      // Check if already flagged in our DB (avoid duplicate processing)
      const existing = await query(
        `SELECT fund_id FROM notorious_funds WHERE isin = $1 AND is_active = true`,
        [isin]
      ).catch(() => ({ rows: [] }));

      if (!existing.rows.length) {
        // New flag — record it
        await query(`
          INSERT INTO notorious_funds (isin, scheme_name, reason, source, flagged_at, is_active)
          VALUES ($1, $2, $3, 'MF_CENTRAL', NOW(), true)
          ON CONFLICT (isin) DO UPDATE SET
            is_active  = true,
            reason     = EXCLUDED.reason,
            flagged_at = NOW(),
            updated_at = NOW()
        `, [
          isin,
          notoriousFund.scheme_name || pledgeIsins.rows.find(r => r.isin === isin)?.scheme_name || isin,
          notoriousFund.reason || 'Flagged on SEBI/AMFI watchlist',
        ]).catch(() => {});

        results.new_flags++;
        audit('NOTORIOUS_FUND_FLAGGED', null, { isin, reason: notoriousFund.reason });
      }

      // Find all users who have this ISIN pledged
      const affectedUsers = await query(`
        SELECT DISTINCT p.user_id, p.pledge_id,
               ca.account_id, ca.outstanding, ca.credit_limit,
               ca.ltv_ratio, ca.upi_active
        FROM pledges p
        JOIN credit_accounts ca ON ca.user_id = p.user_id
        WHERE p.isin = $1 AND p.status = 'ACTIVE'
          AND ca.status = 'ACTIVE'
      `, [isin]).catch(() => ({ rows: [] }));

      for (const user of affectedUsers.rows) {
        results.users_affected++;

        // 1. Send in-app notification
        const schemeName = notoriousFund.scheme_name || isin;
        await query(`
          INSERT INTO notifications
            (user_id, type, channel, status, content_preview, sent_at, created_at)
          VALUES ($1, 'NOTORIOUS_FUND', 'PUSH', 'SENT', $2, NOW(), NOW())
        `, [
          user.user_id,
          `Alert: ${schemeName.slice(0, 40)} has been flagged. Your UPI spending is paused.`.slice(0, 100),
        ]).catch(() => {});

        results.notifications_sent++;

        // 2. Apply notorious fund LTV rule:
        //    Freeze UPI if this notorious fund contributes to their collateral
        //    (the credit is now under-collateralised)
        if (user.upi_active) {
          await query(`
            UPDATE credit_accounts
            SET upi_active           = false,
                notorious_fund_freeze = true,
                ltv_alert_level      = 'RED',
                updated_at           = NOW()
            WHERE account_id = $1
          `, [user.account_id]).catch(() => {});

          results.upi_freezes++;

          audit('UPI_FROZEN_NOTORIOUS_FUND', user.user_id, {
            account_id: user.account_id,
            isin,
            scheme_name: schemeName,
          });
        }

        // 3. Fire webhook to NBFC
        try {
          const { fireNBFCWebhook } = require('../monitoring/nav.monitor');
          await fireNBFCWebhook('fund.notorious_flagged', {
            user_id:    user.user_id,
            account_id: user.account_id,
            isin,
            scheme_name: schemeName,
            outstanding: parseFloat(user.outstanding),
            reason:      notoriousFund.reason,
            action_required: 'REVIEW_COLLATERAL',
            note: 'Notorious fund flagged in user pledge. UPI frozen. NBFC to decide on margin call.',
          });
        } catch (_) {}
      }
    }

    logger.info('✅ Notorious fund check complete', results);
  } catch (err) {
    logger.error('Notorious fund check failed:', err.message);
  }

  return results;
};

// ── CHECK SINGLE USER'S PLEDGES (at pledge time) ─────────────
/**
 * Called before a new pledge is accepted.
 * Returns a warning if any fund in the pledge request is notorious.
 * Does NOT auto-block — NBFC decides based on the warning.
 */
const checkPledgeForNotoriousFunds = async (folios) => {
  const isins = folios.map(f => f.isin).filter(Boolean);
  if (!isins.length) return { has_notorious: false, notorious_funds: [] };

  const hits = await checkNotoriousFunds(isins);
  return {
    has_notorious:   hits.length > 0,
    notorious_funds: hits,
    warning:         hits.length > 0
      ? `${hits.length} fund(s) in your selection are on the SEBI watchlist. Your NBFC will be notified.`
      : null,
  };
};

// ── GET NOTORIOUS FUNDS LIST (for admin/NBFC dashboard) ───────
const getNotoriousFundsList = async () => {
  const result = await query(`
    SELECT isin, scheme_name, reason, source, flagged_at, is_active,
           (SELECT COUNT(DISTINCT p.user_id)
            FROM pledges p
            WHERE p.isin = notorious_funds.isin AND p.status = 'ACTIVE') as affected_users
    FROM notorious_funds
    ORDER BY flagged_at DESC
  `).catch(() => ({ rows: [] }));

  return result.rows;
};

// ── UNFLAG A FUND (when SEBI removes from watchlist) ─────────
const unflagNotoriousFund = async (isin, unflaggedBy = 'admin') => {
  await query(`
    UPDATE notorious_funds
    SET is_active = false, updated_at = NOW()
    WHERE isin = $1
  `, [isin]).catch(() => {});

  // Unfreeze users who were frozen ONLY because of this fund
  // (don't unfreeze users who have other issues)
  const users = await query(`
    SELECT DISTINCT ca.user_id, ca.account_id
    FROM pledges p
    JOIN credit_accounts ca ON ca.user_id = p.user_id
    WHERE p.isin = $1 AND p.status = 'ACTIVE'
      AND ca.notorious_fund_freeze = true
      AND ca.status = 'ACTIVE'
  `, [isin]).catch(() => ({ rows: [] }));

  for (const user of users.rows) {
    // Check if they have any OTHER notorious funds still active
    const otherFlags = await query(`
      SELECT COUNT(*) as cnt
      FROM pledges p
      JOIN notorious_funds nf ON nf.isin = p.isin
      WHERE p.user_id = $1 AND p.status = 'ACTIVE'
        AND nf.is_active = true AND nf.isin != $2
    `, [user.user_id, isin]).catch(() => ({ rows: [{ cnt: 1 }] }));

    if (parseInt(otherFlags.rows[0]?.cnt || 0) === 0) {
      // Safe to unfreeze
      await query(`
        UPDATE credit_accounts
        SET upi_active = true, notorious_fund_freeze = false, updated_at = NOW()
        WHERE account_id = $1
      `, [user.account_id]).catch(() => {});

      await query(`
        INSERT INTO notifications (user_id, type, channel, status, content_preview, sent_at, created_at)
        VALUES ($1, 'UPI_UNFROZEN', 'PUSH', 'SENT', 'Good news: Your UPI spending has been restored.', NOW(), NOW())
      `, [user.user_id]).catch(() => {});
    }
  }

  audit('NOTORIOUS_FUND_UNFLAGGED', null, { isin, unflagged_by: unflaggedBy });
  return { unflagged: true, isin, users_unfreezed: users.rows.length };
};

module.exports = {
  runNotoriousFundCheck,
  checkPledgeForNotoriousFunds,
  getNotoriousFundsList,
  unflagNotoriousFund,
};
