const express = require('express');
const router  = express.Router();
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');

// ── AUTH ──────────────────────────────────────────────────────
const lenderAuth = (req, res, next) => {
  const token = req.headers['x-lender-token'];
  if (token !== (process.env.LENDER_TOKEN || 'lienpay-lender-2026')) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  next();
};
router.use(lenderAuth);

// ── HELPERS ───────────────────────────────────────────────────
const fmtCr  = n => `₹${(parseFloat(n||0)/10000000).toFixed(2)}Cr`;
const maskName = n => {
  if (!n) return 'User';
  const parts = n.trim().split(' ');
  return parts.map(p => p[0] + '*'.repeat(Math.max(p.length - 1, 2))).join(' ');
};

/**
 * Compute the 3 extra risk parameters LienPay provides to NBFC.
 * These are the "2-3 more parameters" the founder mentioned.
 *
 * @param {Array} holdings  - mf_holdings rows for this user
 * @param {Array} pledges   - active pledges for this user
 * @returns {Object}
 */
const computeExtraParams = (holdings, pledges) => {
  const totalPortfolioValue = holdings.reduce((s, h) => s + parseFloat(h.value_at_fetch || 0), 0);
  const totalPledgedValue   = pledges.reduce((s, p) => s + parseFloat(p.value_at_pledge || 0), 0);

  // ── PARAMETER 1: PLEDGE CONCENTRATION ────────────────────
  // What % of total portfolio is being pledged.
  // High % = user is stretching to access credit (risk signal).
  // Low %  = user has plenty of un-pledged assets (comfort signal).
  const pledgeConcentration = totalPortfolioValue > 0
    ? Math.round((totalPledgedValue / totalPortfolioValue) * 100)
    : 0;
  const concentrationBand =
    pledgeConcentration <= 30 ? 'LOW'    // Only pledging a small portion
    : pledgeConcentration <= 70 ? 'MEDIUM' // Moderate exposure
    : 'HIGH'; // Pledging most of their portfolio

  // ── PARAMETER 2: FUND QUALITY SCORE ──────────────────────
  // Composite score based on pledged fund types.
  // Large Cap / Debt = more liquid and stable → higher quality.
  // Small Cap = volatile → lower quality.
  const QUALITY_WEIGHTS = {
    EQUITY_LARGE_CAP:     90,
    EQUITY_LARGE_MID_CAP: 80,
    INDEX_FUND:           85,
    ETF:                  85,
    DEBT_LIQUID:          95,
    DEBT_SHORT_DUR:       90,
    EQUITY_FLEXI_CAP:     75,
    EQUITY_MID_CAP:       65,
    HYBRID_BALANCED:      70,
    EQUITY_SMALL_CAP:     45,
    EQUITY_ELSS:          70,
  };

  const pledgedHoldings = holdings.filter(h =>
    pledges.some(p => p.folio_number === h.folio_number)
  );

  let weightedQuality = 0;
  let totalWeight = 0;
  for (const h of pledgedHoldings) {
    const val    = parseFloat(h.value_at_fetch || 0);
    const score  = QUALITY_WEIGHTS[h.scheme_type] || 60;
    weightedQuality += score * val;
    totalWeight     += val;
  }
  const fundQualityScore = totalWeight > 0 ? Math.round(weightedQuality / totalWeight) : 0;
  const fundQualityGrade =
    fundQualityScore >= 85 ? 'A+'
    : fundQualityScore >= 75 ? 'A'
    : fundQualityScore >= 65 ? 'B'
    : 'C';

  // ── PARAMETER 3: PORTFOLIO VINTAGE ESTIMATE ───────────────
  // Proxy: average units held across funds as a proxy for how long
  // the user has been investing. In production this comes from
  // RTA transaction history (first SIP date). For now we infer:
  // – Larger unit counts relative to current NAV suggest older investments
  // – We classify as SHORT (<12m), MEDIUM (12-36m), LONG (36m+)
  // This will be replaced with real RTA data when CAMS/KFintech API is live.
  let avgUnitToNavRatio = 0;
  if (pledgedHoldings.length > 0) {
    const ratios = pledgedHoldings.map(h => {
      const nav = parseFloat(h.nav_at_fetch || 1);
      const units = parseFloat(h.units_held || 0);
      return units / Math.max(nav, 1);
    });
    avgUnitToNavRatio = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  }
  // Estimate vintage in months (heuristic — will be replaced by real data)
  const estimatedVintageMonths =
    avgUnitToNavRatio > 50 ? 36
    : avgUnitToNavRatio > 10 ? 24
    : avgUnitToNavRatio > 2  ? 12
    : 6;
  const vintageBand =
    estimatedVintageMonths >= 36 ? 'LONG (3+ years)'
    : estimatedVintageMonths >= 12 ? 'MEDIUM (1-3 years)'
    : 'SHORT (<1 year)';

  return {
    pledge_concentration_pct:  pledgeConcentration,
    pledge_concentration_band: concentrationBand,
    fund_quality_score:        fundQualityScore,
    fund_quality_grade:        fundQualityGrade,
    portfolio_vintage_months:  estimatedVintageMonths,
    portfolio_vintage_band:    vintageBand,
    total_portfolio_value:     Math.round(totalPortfolioValue),
    total_pledged_value:       Math.round(totalPledgedValue),
  };
};

// ── EXISTING ROUTES ───────────────────────────────────────────

router.get('/overview', async (req, res) => {
  try {
    let book = { rows: [{}] }, risk = { rows: [] }, collections = { rows: [{}] }, ltv = { rows: [{}] };
    try { book = await query(`
      SELECT COUNT(*) as total_accounts,
             COALESCE(SUM(credit_limit), 0) as total_sanctioned,
             COALESCE(SUM(outstanding), 0) as total_outstanding,
             COALESCE(SUM(available_credit), 0) as total_undrawn,
             COUNT(*) FILTER (WHERE status = 'ACTIVE') as active_accounts,
             COALESCE(AVG(credit_limit), 0) as avg_ticket_size
      FROM credit_accounts`);
    } catch(e) { logger.error('Lender book query:', e.message); }

    try { risk = await query(`
      SELECT risk_tier, COUNT(*) as count,
             COALESCE(SUM(approved_limit), 0) as tier_exposure,
             AVG(apr) as avg_apr
      FROM risk_decisions rd
      JOIN credit_accounts ca ON ca.user_id = rd.user_id
      WHERE rd.decision = 'APPROVED'
      GROUP BY risk_tier`);
    } catch(e) { logger.error('Lender risk query:', e.message); }

    try { collections = await query(`
      SELECT COUNT(*) as total_repayments,
             COALESCE(SUM(amount), 0) as total_collected,
             COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days') as repayments_30d,
             COALESCE(SUM(amount) FILTER (WHERE created_at > NOW() - INTERVAL '30 days'), 0) as collected_30d
      FROM repayments WHERE status = 'SUCCESS'`);
    } catch(e) { logger.error('Lender collections query:', e.message); }

    try { ltv = await query(`
      SELECT
        COUNT(*) FILTER (WHERE ltv_ratio < 0.50) as safe,
        COUNT(*) FILTER (WHERE ltv_ratio >= 0.50 AND ltv_ratio < 0.75) as watch,
        COUNT(*) FILTER (WHERE ltv_ratio >= 0.75 AND ltv_ratio < 0.90) as amber,
        COUNT(*) FILTER (WHERE ltv_ratio >= 0.90) as red
      FROM ltv_snapshots
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM ltv_snapshots)`);
    } catch(e) { logger.error('Lender ltv query:', e.message); }

    res.json({ success: true, data: {
      book:        book.rows[0],
      risk_tiers:  risk.rows,
      collections: collections.rows[0],
      ltv_health:  ltv.rows[0] || { safe: 0, watch: 0, amber: 0, red: 0 },
      timestamp:   new Date().toISOString()
    }});
  } catch (err) {
    logger.error('Lender overview error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/collateral', async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*, mh.scheme_name, mh.scheme_type, mh.ltv_cap,
             u.full_name, ca.credit_limit, ca.outstanding
      FROM pledges p
      JOIN users u ON u.user_id = p.user_id
      JOIN credit_accounts ca ON ca.user_id = p.user_id
      LEFT JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
      WHERE p.status = 'ACTIVE'
      ORDER BY p.value_at_pledge DESC`);
    res.json({ success: true, data: {
      pledges: result.rows,
      total_collateral_value: result.rows.reduce((s, r) => s + parseFloat(r.value_at_pledge || 0), 0)
    }});
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/exposure', async (req, res) => {
  try {
    const result = await query(`
      SELECT ca.*, u.full_name, u.mobile, rd.risk_tier, rd.fraud_score
      FROM credit_accounts ca
      JOIN users u ON u.user_id = ca.user_id
      LEFT JOIN risk_decisions rd ON rd.user_id = ca.user_id
      ORDER BY ca.outstanding DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/margin-calls', async (req, res) => {
  try {
    const result = await query(`
      SELECT mc.*, u.full_name, u.mobile, ca.credit_limit, ca.outstanding
      FROM margin_calls mc
      JOIN users u ON u.user_id = mc.user_id
      JOIN credit_accounts ca ON ca.user_id = mc.user_id
      WHERE mc.status IN ('PENDING', 'ISSUED')
      ORDER BY mc.created_at DESC`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/disbursements', async (req, res) => {
  try {
    const result = await query(`
      SELECT t.*, u.full_name, ca.credit_limit, ca.outstanding
      FROM transactions t
      JOIN users u ON u.user_id = t.user_id
      JOIN credit_accounts ca ON ca.user_id = t.user_id
      ORDER BY t.initiated_at DESC LIMIT 100`);
    res.json({ success: true, data: result.rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});


// ── NEW: APPLICATIONS (NBFC HANDOVER FLOW) ────────────────────

/**
 * GET /api/lender/applications
 *
 * Returns the complete data package for every user who has completed
 * risk assessment. This is what the NBFC reviews before activating credit.
 *
 * For each applicant the package includes:
 *   1. Applicant identity (masked for privacy — only NBFC should see unmasked via their own KYC)
 *   2. Portfolio breakdown — funds, values, eligible credit per fund
 *   3. LienPay risk assessment — bureau band, fraud score, risk tier, APR
 *   4. Three extra parameters — pledge concentration, fund quality, portfolio vintage
 *   5. LienPay's recommendation — suggested limit, confidence level
 *   6. Current status — PENDING_REVIEW | ACTIVE | FROZEN
 */
router.get('/applications', async (req, res) => {
  try {
    // 1. Get all users with completed risk assessments
    const usersRes = await query(`
      SELECT
        u.user_id,
        u.full_name,
        u.mobile,
        u.kyc_status,
        u.pan_last4,
        u.onboarding_step,
        u.created_at,
        rd.decision_id,
        rd.approved_limit,
        rd.risk_tier,
        rd.apr,
        rd.bureau_score_band,
        rd.fraud_score,
        rd.decided_at,
        ca.account_id,
        ca.status       AS account_status,
        ca.credit_limit AS active_limit,
        ca.outstanding,
        ca.available_credit,
        ca.upi_vpa
      FROM users u
      JOIN risk_decisions rd ON rd.user_id = u.user_id
      LEFT JOIN credit_accounts ca ON ca.user_id = u.user_id
      WHERE rd.decision = 'APPROVED'
      ORDER BY rd.decided_at DESC
    `).catch(() => ({ rows: [] }));

    if (!usersRes.rows.length) {
      return res.json({ success: true, data: { applications: [], total: 0 } });
    }

    // 2. For each user, enrich with portfolio + pledge data
    const applications = await Promise.all(usersRes.rows.map(async (user) => {
      // Holdings
      const holdingsRes = await query(`
        SELECT folio_number, scheme_name, scheme_type, rta, ltv_cap,
               units_held, nav_at_fetch, value_at_fetch,
               eligible_value, is_eligible
        FROM mf_holdings
        WHERE user_id = $1
        ORDER BY value_at_fetch DESC
      `, [user.user_id]).catch(() => ({ rows: [] }));

      // Active pledges
      const pledgesRes = await query(`
        SELECT pledge_id, folio_number, scheme_name, rta,
               units_pledged, nav_at_pledge, value_at_pledge,
               eligible_value_at_pledge, pledge_ref_number,
               status, registered_at
        FROM pledges
        WHERE user_id = $1 AND status = 'ACTIVE'
        ORDER BY value_at_pledge DESC
      `, [user.user_id]).catch(() => ({ rows: [] }));

      const holdings = holdingsRes.rows;
      const pledges  = pledgesRes.rows;

      // Extra parameters (LienPay's 3 enrichment signals)
      const extraParams = computeExtraParams(holdings, pledges);

      // Confidence level based on combined signals
      const confidenceScore =
        (user.fraud_score < 20 ? 30 : user.fraud_score < 50 ? 20 : 0) +
        (extraParams.fund_quality_score >= 80 ? 25 : extraParams.fund_quality_score >= 65 ? 15 : 5) +
        (extraParams.pledge_concentration_pct <= 50 ? 25 : extraParams.pledge_concentration_pct <= 75 ? 15 : 5) +
        (extraParams.portfolio_vintage_months >= 24 ? 20 : extraParams.portfolio_vintage_months >= 12 ? 12 : 5);

      const confidence =
        confidenceScore >= 80 ? 'HIGH'
        : confidenceScore >= 55 ? 'MEDIUM'
        : 'LOW';

      // Fund type breakdown for the dashboard pie chart
      const fundBreakdown = {};
      for (const h of holdings) {
        const type = h.scheme_type || 'OTHER';
        if (!fundBreakdown[type]) fundBreakdown[type] = 0;
        fundBreakdown[type] += parseFloat(h.value_at_fetch || 0);
      }

      return {
        user_id: user.user_id,

        // ── Applicant (masked for display, unmasked for NBFC's own records) ──
        applicant: {
          full_name:    maskName(user.full_name),
          full_name_raw: user.full_name, // NBFC sees this
          kyc_status:   user.kyc_status,
          pan_last4:    user.pan_last4,
          mobile_masked:`+91 XXXXX${(user.mobile || '').slice(-5)}`,
          applied_at:   user.decided_at || user.created_at,
        },

        // ── Portfolio data (from CDSL/AA via CAMS + KFintech) ──
        portfolio: {
          total_value:     extraParams.total_portfolio_value,
          eligible_value:  Math.round(holdings.filter(h => h.is_eligible).reduce((s, h) => s + parseFloat(h.eligible_value || 0), 0)),
          pledged_value:   extraParams.total_pledged_value,
          fund_count:      holdings.length,
          pledged_count:   pledges.length,
          data_source:     'CAMS + KFintech (via Account Aggregator)',
          holdings:        holdings.map(h => ({
            scheme_name: h.scheme_name,
            scheme_type: h.scheme_type,
            rta:         h.rta,
            value:       Math.round(parseFloat(h.value_at_fetch || 0)),
            ltv_cap:     h.ltv_cap,
            eligible:    Math.round(parseFloat(h.eligible_value || 0)),
            pledged:     pledges.some(p => p.folio_number === h.folio_number),
          })),
          fund_breakdown: Object.entries(fundBreakdown).map(([type, value]) => ({
            type,
            value: Math.round(value),
          })),
        },

        // ── LienPay risk assessment ──
        risk_assessment: {
          bureau_score_band: user.bureau_score_band || 'N/A',
          fraud_score:       parseFloat(user.fraud_score || 0),
          risk_tier:         user.risk_tier,
          apr_suggested:     parseFloat(user.apr || 0),
          ltv_weighted_avg:  holdings.length > 0
            ? parseFloat(holdings.reduce((s, h) => {
                const ltv = typeof h.ltv_cap === 'string' && h.ltv_cap.includes('%')
                  ? parseFloat(h.ltv_cap) / 100
                  : parseFloat(h.ltv_cap || 0);
                return s + (ltv * parseFloat(h.value_at_fetch || 0));
              }, 0) / Math.max(extraParams.total_portfolio_value, 1)).toFixed(3)
            : 0,
        },

        // ── 3 extra parameters (LienPay's enrichment, not bureau-derived) ──
        extra_parameters: {
          pledge_concentration: {
            value:  extraParams.pledge_concentration_pct,
            band:   extraParams.pledge_concentration_band,
            label:  `${extraParams.pledge_concentration_pct}% of portfolio pledged`,
            signal: extraParams.pledge_concentration_band === 'LOW' ? 'POSITIVE' : extraParams.pledge_concentration_band === 'HIGH' ? 'CAUTION' : 'NEUTRAL',
          },
          fund_quality: {
            score:  extraParams.fund_quality_score,
            grade:  extraParams.fund_quality_grade,
            label:  `${extraParams.fund_quality_grade} grade — ${extraParams.fund_quality_score}/100`,
            signal: extraParams.fund_quality_score >= 80 ? 'POSITIVE' : extraParams.fund_quality_score >= 65 ? 'NEUTRAL' : 'CAUTION',
          },
          portfolio_vintage: {
            months: extraParams.portfolio_vintage_months,
            band:   extraParams.portfolio_vintage_band,
            label:  extraParams.portfolio_vintage_band,
            signal: extraParams.portfolio_vintage_months >= 24 ? 'POSITIVE' : extraParams.portfolio_vintage_months >= 12 ? 'NEUTRAL' : 'CAUTION',
            note:   'Estimated via RTA unit-to-NAV heuristic. Live data available post CAMS/KFin API.',
          },
        },

        // ── LienPay's recommendation to NBFC ──
        recommendation: {
          suggested_limit: parseFloat(user.approved_limit || 0),
          suggested_apr:   parseFloat(user.apr || 0),
          risk_tier:       user.risk_tier,
          confidence,
          confidence_score: confidenceScore,
          rationale: [
            `Portfolio value ₹${(extraParams.total_portfolio_value/100000).toFixed(1)}L with ${pledges.length} active pledges`,
            `Bureau ${user.bureau_score_band || 'N/A'} | Fraud score ${user.fraud_score || 0}/100`,
            `Fund quality ${extraParams.fund_quality_grade} | Concentration ${extraParams.pledge_concentration_band}`,
            `Estimated investment vintage: ${extraParams.portfolio_vintage_band}`,
          ],
        },

        // ── Current account status ──
        account: {
          status:          user.account_status || 'NO_ACCOUNT',
          active_limit:    parseFloat(user.active_limit || 0),
          outstanding:     parseFloat(user.outstanding || 0),
          available:       parseFloat(user.available_credit || 0),
          upi_vpa:         user.upi_vpa || null,
        },

        // ── Meta ──
        risk_decided_at: user.decided_at,
        onboarding_step: user.onboarding_step,
      };
    }));

    // Summary stats for the dashboard header
    const summary = {
      total:          applications.length,
      pending_review: applications.filter(a => a.account.status === 'NO_ACCOUNT' || !a.account.status).length,
      active:         applications.filter(a => a.account.status === 'ACTIVE').length,
      high_confidence:applications.filter(a => a.recommendation.confidence === 'HIGH').length,
      total_suggested_book: applications.reduce((s, a) => s + a.recommendation.suggested_limit, 0),
    };

    res.json({ success: true, data: { applications, summary } });
  } catch (err) {
    logger.error('Lender applications error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


/**
 * POST /api/lender/applications/:userId/decision
 *
 * NBFC makes a credit decision on an application.
 * Actions:
 *   APPROVE  — activate credit at suggested or adjusted limit
 *   ADJUST   — approve at a different limit than suggested
 *   FLAG     — flag for manual review / request more info
 *   REJECT   — reject the application
 *
 * Body: { action, adjusted_limit?, note?, nbfc_officer? }
 */
router.post('/applications/:userId/decision', async (req, res) => {
  const { userId } = req.params;
  const { action, adjusted_limit, note, nbfc_officer } = req.body;

  if (!['APPROVE', 'ADJUST', 'FLAG', 'REJECT'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Invalid action. Use: APPROVE | ADJUST | FLAG | REJECT' });
  }

  try {
    // Get the risk decision
    const rdRes = await query(
      `SELECT * FROM risk_decisions WHERE user_id = $1 ORDER BY decided_at DESC LIMIT 1`,
      [userId]
    );
    if (!rdRes.rows.length) {
      return res.status(404).json({ success: false, error: 'No risk decision found for this user' });
    }
    const rd = rdRes.rows[0];

    if (action === 'APPROVE' || action === 'ADJUST') {
      const finalLimit = action === 'ADJUST' && adjusted_limit
        ? parseFloat(adjusted_limit)
        : parseFloat(rd.approved_limit);

      const apr = parseFloat(rd.apr || 14.99);

      // Check if account already exists
      const existingAccount = await query(
        `SELECT account_id FROM credit_accounts WHERE user_id = $1`,
        [userId]
      ).catch(() => ({ rows: [] }));

      if (existingAccount.rows.length) {
        // Update existing account (might be frozen/pending)
        await query(`
          UPDATE credit_accounts
          SET credit_limit      = $2,
              available_credit  = $2 - outstanding,
              status            = 'ACTIVE',
              updated_at        = NOW()
          WHERE user_id = $1
        `, [userId, finalLimit]);
      } else {
        // Create new credit account
        const vpa = `lp${Date.now().toString().slice(-8)}@lienpay`;
        await query(`
          INSERT INTO credit_accounts
            (user_id, credit_limit, available_credit, outstanding, apr, status,
             upi_vpa, psp_bank, upi_active, free_period_days)
          VALUES ($1, $2, $2, 0, $3, 'ACTIVE', $4, 'LienPay PSP', true, 30)
        `, [userId, finalLimit, apr, vpa]);
      }

      // Update user onboarding step
      await query(`
        UPDATE users
        SET onboarding_step = 'ACTIVE', account_status = 'ACTIVE', updated_at = NOW()
        WHERE user_id = $1
      `, [userId]);

      // Log the NBFC decision
      await query(`
        INSERT INTO audit_trail (event_type, user_id, details, created_at)
        VALUES ('NBFC_CREDIT_APPROVED', $1, $2, NOW())
      `, [userId, JSON.stringify({ action, final_limit: finalLimit, note, nbfc_officer, source: 'LENDER_DASHBOARD' })]).catch(() => {});

      return res.json({ success: true, data: {
        message: `Credit line ${action === 'ADJUST' ? 'approved at adjusted limit' : 'approved'} successfully`,
        user_id: userId,
        approved_limit: finalLimit,
        apr,
        status: 'ACTIVE',
      }});
    }

    if (action === 'FLAG') {
      await query(`
        INSERT INTO audit_trail (event_type, user_id, details, created_at)
        VALUES ('NBFC_APPLICATION_FLAGGED', $1, $2, NOW())
      `, [userId, JSON.stringify({ note, nbfc_officer, source: 'LENDER_DASHBOARD' })]).catch(() => {});

      return res.json({ success: true, data: {
        message: 'Application flagged for manual review',
        user_id: userId,
        note,
      }});
    }

    if (action === 'REJECT') {
      await query(`
        UPDATE users SET account_status = 'REJECTED', updated_at = NOW() WHERE user_id = $1
      `, [userId]);

      await query(`
        INSERT INTO audit_trail (event_type, user_id, details, created_at)
        VALUES ('NBFC_APPLICATION_REJECTED', $1, $2, NOW())
      `, [userId, JSON.stringify({ note, nbfc_officer, source: 'LENDER_DASHBOARD' })]).catch(() => {});

      return res.json({ success: true, data: {
        message: 'Application rejected',
        user_id: userId,
        note,
      }});
    }

  } catch (err) {
    logger.error('NBFC decision error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


/**
 * GET /api/lender/applications/:userId
 * Full data package for a single applicant.
 * Calls the same logic as /applications but for one user.
 */
router.get('/applications/:userId', async (req, res) => {
  try {
    // Reuse the applications logic but filter to one user
    req.query.userId = req.params.userId;
    // Simplified single-user fetch
    const userRes = await query(`
      SELECT u.*, rd.decision_id, rd.approved_limit, rd.risk_tier, rd.apr,
             rd.bureau_score_band, rd.fraud_score, rd.decided_at,
             ca.account_id, ca.status as account_status, ca.credit_limit as active_limit,
             ca.outstanding, ca.available_credit, ca.upi_vpa
      FROM users u
      JOIN risk_decisions rd ON rd.user_id = u.user_id AND rd.decision = 'APPROVED'
      LEFT JOIN credit_accounts ca ON ca.user_id = u.user_id
      WHERE u.user_id = $1
      ORDER BY rd.decided_at DESC LIMIT 1
    `, [req.params.userId]);

    if (!userRes.rows.length) {
      return res.status(404).json({ success: false, error: 'Application not found' });
    }

    res.json({ success: true, data: userRes.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
