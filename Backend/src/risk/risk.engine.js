const { query }  = require('../../config/database');
const { getPeakNAV } = require('../portfolio/nav.service');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// RISK ENGINE
// The brain of LienPay. Calculates:
// 1. Drawdown risk per fund
// 2. Portfolio-level credit limit
// 3. Fraud score
// 4. Risk tier (A/B/C)
// 5. Interest rate
// ─────────────────────────────────────────────────────────────

// ── DRAWDOWN CALCULATION ──────────────────────────────────────
// Measures how much a fund fell from its peak NAV
// Uses this to assess collateral quality
const calculateDrawdown = (currentNav, peakNav, lowestNav) => {
  if (!peakNav || peakNav <= 0) return { drawdown_pct: 0, risk_level: 'LOW' };

  // How far from peak right now
  const drawdownFromPeak = ((peakNav - currentNav) / peakNav) * 100;

  // Worst historical drawdown
  const maxDrawdown = lowestNav
    ? ((peakNav - lowestNav) / peakNav) * 100
    : drawdownFromPeak;

  // Risk level based on max historical drawdown
  let risk_level;
  if (maxDrawdown <= 10)      risk_level = 'LOW';
  else if (maxDrawdown <= 25) risk_level = 'MEDIUM';
  else if (maxDrawdown <= 40) risk_level = 'HIGH';
  else                         risk_level = 'VERY_HIGH';

  return {
    drawdown_from_peak_pct: parseFloat(drawdownFromPeak.toFixed(2)),
    max_drawdown_pct:       parseFloat(maxDrawdown.toFixed(2)),
    risk_level,
  };
};

// ── DRAWDOWN ADJUSTMENT TO LTV ────────────────────────────────
// If a fund has high drawdown history, we reduce its effective LTV
const getDrawdownAdjustment = (maxDrawdownPct) => {
  if (maxDrawdownPct <= 15)  return 1.00; // no adjustment
  if (maxDrawdownPct <= 25)  return 0.95; // 5% reduction
  if (maxDrawdownPct <= 35)  return 0.90; // 10% reduction
  if (maxDrawdownPct <= 50)  return 0.85; // 15% reduction
  return 0.80;                             // 20% reduction for extreme drawdowns
};

// ── FRAUD SCORE CALCULATION ───────────────────────────────────
// Score 0-100. Higher = more suspicious.
const calculateFraudScore = async (userId, deviceId, ipHash) => {
  let score = 0;
  const flags = [];

  try {
    // Check 1: OTP velocity — too many OTP requests?
    const otpVelocity = await query(`
      SELECT COUNT(*) as count FROM otp_logs
      WHERE mobile = (SELECT mobile FROM users WHERE user_id = $1)
      AND created_at > NOW() - INTERVAL '24 hours'
    `, [userId]);

    const otpCount = parseInt(otpVelocity.rows[0]?.count) || 0;
    if (otpCount >= 4) { score += 20; flags.push('HIGH_OTP_VELOCITY'); }
    if (otpCount >= 5) { score += 20; flags.push('MAX_OTP_VELOCITY'); }

    // Check 2: Multiple failed OTP attempts
    const failedOTPs = await query(`
      SELECT COUNT(*) as count FROM otp_logs
      WHERE mobile = (SELECT mobile FROM users WHERE user_id = $1)
      AND status = 'LOCKED'
      AND created_at > NOW() - INTERVAL '7 days'
    `, [userId]);

    if (parseInt(failedOTPs.rows[0]?.count) > 0) {
      score += 15;
      flags.push('PREVIOUS_OTP_LOCKOUT');
    }

    // Check 3: Account age (very new accounts are higher risk)
    const accountAge = await query(`
      SELECT EXTRACT(EPOCH FROM (NOW() - created_at))/3600 as hours_old
      FROM users WHERE user_id = $1
    `, [userId]);

    const hoursOld = parseFloat(accountAge.rows[0]?.hours_old) || 0;
    if (hoursOld < 1)  { score += 25; flags.push('ACCOUNT_LESS_THAN_1HR'); }
    else if (hoursOld < 24) { score += 10; flags.push('ACCOUNT_LESS_THAN_24HR'); }

    // Score is capped at 100
    score = Math.min(score, 100);

  } catch (err) {
    logger.error('Fraud score calculation error:', err.message);
    // If fraud check fails, default to low score (don't block legitimate users)
    score = 10;
  }

  return { fraud_score: score, flags };
};

// ── BUREAU ADJUSTMENT ─────────────────────────────────────────
// Bureau score adjusts the credit limit upward (good score = full limit)
// We use it as a positive multiplier, not a gate
const getBureauAdjustment = (scoreBand) => {
  switch (scoreBand) {
    case 'EXCELLENT': return 1.00; // 750+ — full limit
    case 'GOOD':      return 0.90; // 700-749 — 90% of limit
    case 'FAIR':      return 0.80; // 600-699 — 80% of limit
    default:          return 0.00; // below 600 — rejected at KYC stage already
  }
};

// ── MAIN: EVALUATE CREDIT LIMIT ───────────────────────────────
const evaluateCreditLimit = async (userId) => {
  try {
    // 1. Get portfolio data
    const holdingsRes = await query(`
      SELECT * FROM mf_holdings WHERE user_id = $1 AND is_eligible = true
    `, [userId]);

    if (!holdingsRes.rows.length) {
      throw { statusCode: 400, message: 'No eligible mutual fund holdings found.' };
    }

    const holdings = holdingsRes.rows;

    // 2. Get NAV history for drawdown calculation
    let totalEligibleWithDrawdown = 0;
    const fundBreakdown = [];

    for (const holding of holdings) {
      const { peak_nav, lowest_nav } = await getPeakNAV(holding.isin);
      // If no NAV history yet (new fund) — treat current NAV as peak
      // No drawdown penalty for funds with no history — correct behaviour
      const effectivePeak   = peak_nav   || holding.nav_at_fetch;
      const effectiveLowest = lowest_nav || holding.nav_at_fetch;
      const drawdown = calculateDrawdown(holding.nav_at_fetch, effectivePeak, effectiveLowest);
      const drawdownAdj = getDrawdownAdjustment(drawdown.max_drawdown_pct);

      // Base eligible value already has LTV cap applied
      // Now apply drawdown adjustment on top
      const adjustedEligible = holding.eligible_value * drawdownAdj;
      totalEligibleWithDrawdown += adjustedEligible;

      fundBreakdown.push({
        scheme_name:       holding.scheme_name,
        scheme_type:       holding.scheme_type,
        ltv_cap:           holding.ltv_cap,
        base_eligible:     holding.eligible_value,
        drawdown_pct:      drawdown.max_drawdown_pct,
        drawdown_adj:      drawdownAdj,
        final_eligible:    Math.round(adjustedEligible),
        drawdown_risk:     drawdown.risk_level,
      });
    }

    // 3. Get bureau score
    const bureauRes = await query(`
      SELECT score_band, score_value FROM bureau_results
      WHERE user_id = $1
      ORDER BY pulled_at DESC LIMIT 1
    `, [userId]);

    const scoreBand      = bureauRes.rows[0]?.score_band || 'GOOD';
    const bureauAdj      = getBureauAdjustment(scoreBand);
    const postBureauLimit = totalEligibleWithDrawdown * bureauAdj;

    // 4. Fraud score
    const user = await query('SELECT device_fingerprint FROM users WHERE user_id = $1', [userId]);
    const { fraud_score, flags: fraudFlags } = await calculateFraudScore(
      userId,
      user.rows[0]?.device_fingerprint,
      null
    );

    // Reject if fraud score too high
    const fraudThreshold = parseInt(process.env.RISK_FRAUD_SCORE_THRESHOLD) || 70;
    if (fraud_score >= fraudThreshold) {
      throw {
        statusCode: 400,
        message:    'Unable to process your application at this time.',
        reason:     'HIGH_FRAUD_SCORE',
      };
    }

    // Fraud adjustment (mild — don't punish too hard, fraud check is more of a gate)
    const fraudAdj    = fraud_score < 30 ? 1.0 : fraud_score < 50 ? 0.95 : 0.90;
    const postFraudLimit = postBureauLimit * fraudAdj;

    // 5. Apply policy limits
    const minLimit = parseInt(process.env.RISK_MIN_CREDIT_LIMIT) || 10000;
    const maxLimit = parseInt(process.env.RISK_MAX_CREDIT_LIMIT) || 5000000; // 50L

    let approvedLimit = Math.round(postFraudLimit);
    approvedLimit = Math.max(approvedLimit, minLimit);
    approvedLimit = Math.min(approvedLimit, maxLimit);

    // Round to nearest 1000
    approvedLimit = Math.round(approvedLimit / 1000) * 1000;

    if (approvedLimit < minLimit) {
      throw {
        statusCode: 400,
        message:    `Minimum credit line is ₹${minLimit.toLocaleString()}. Your portfolio does not meet the minimum eligibility.`,
      };
    }

    // 6. Determine risk tier and interest rate
    const { tier, apr } = getRiskTier(scoreBand, fraud_score, holdings);

    // 7. Store risk decision
    const totalPortfolioValue = holdings.reduce((s, h) => s + parseFloat(h.value_at_fetch || 0), 0);
    const decisionRes = await query(`
      INSERT INTO risk_decisions (
        user_id, decision_type, portfolio_ltv_value,
        bureau_score, bureau_score_band, kyc_type,
        fraud_score, aml_result, bureau_adjustment,
        fraud_adjustment, approved_limit, risk_tier,
        apr, decision, engine_version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING decision_id
    `, [
      userId, 'INITIAL_CREDIT',
      Math.round(totalEligibleWithDrawdown),
      bureauRes.rows[0]?.score_value,
      scoreBand,
      'AADHAAR_OTP',
      fraud_score,
      'PASS',
      bureauAdj,
      fraudAdj,
      approvedLimit,
      tier,
      apr,
      'APPROVED',
      'v1.0',
    ]);

    audit('RISK_DECISION_APPROVED', userId, {
      approved_limit: approvedLimit,
      risk_tier:      tier,
      apr,
      fraud_score,
    });

    return {
      decision_id:        decisionRes.rows[0].decision_id,
      approved_limit:     approvedLimit,
      risk_tier:          tier,
      apr,
      bureau_score_band:  scoreBand,
      fraud_score,
      fund_breakdown:     fundBreakdown,
      total_portfolio_value: Math.round(totalPortfolioValue),
      total_eligible_base:   Math.round(totalEligibleWithDrawdown),
      adjustments_applied: {
        bureau: `${(bureauAdj * 100).toFixed(0)}%`,
        fraud:  `${(fraudAdj * 100).toFixed(0)}%`,
      },
    };

  } catch (err) {
    if (err.statusCode) throw err;
    logger.error('Risk engine error:', err);
    throw { statusCode: 500, message: 'Risk evaluation failed. Please try again.' };
  }
};

// ── RISK TIER & INTEREST RATE ─────────────────────────────────
const getRiskTier = (scoreBand, fraudScore, holdings) => {
  // APR is flat 12% for all customers
  // Tiers still used for credit limit adjustments, not pricing
  // Penalty rate of 18% kicks in on overdue (handled in billing engine)
  const BASE_APR = parseFloat(process.env.BASE_APR) || 12.00;

  const debtRatio = holdings.filter(h =>
    h.scheme_type?.startsWith('DEBT_') || h.scheme_type === 'EQUITY_LARGE_CAP'
  ).length / holdings.length;

  if (scoreBand === 'EXCELLENT' && fraudScore < 20 && debtRatio >= 0.5) {
    return { tier: 'A', apr: BASE_APR };
  }

  if ((scoreBand === 'EXCELLENT' || scoreBand === 'GOOD') && fraudScore < 40) {
    return { tier: 'B', apr: BASE_APR };
  }

  return { tier: 'C', apr: BASE_APR };
};

// ── LTV HEALTH CHECK (for existing accounts) ─────────────────
// Called daily by NAV monitoring cron
const checkLTVHealth = async (userId, accountId) => {
  // Get current outstanding
  const accountRes = await query(
    'SELECT outstanding, credit_limit FROM credit_accounts WHERE account_id = $1',
    [accountId]
  );
  const { outstanding, credit_limit } = accountRes.rows[0];

  if (!outstanding || outstanding <= 0) {
    return { status: 'GREEN', action_required: false, ltv: 0 };
  }

  // Get current portfolio value (pledged holdings)
  // FIX: COALESCE nav_history with mf_holdings.nav_at_fetch — in mock mode
  // nav_history may have no entry for today, causing NULL nav → 0 → false margin call
  const pledgesRes = await query(`
    SELECT p.isin, p.units_pledged,
           COALESCE(n.nav_value, mh.nav_at_fetch) as current_nav,
           mh.ltv_cap, mh.scheme_type, mh.nav_at_fetch
    FROM pledges p
    JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
    LEFT JOIN nav_history n ON n.isin = p.isin AND n.nav_date = CURRENT_DATE
    WHERE p.user_id = $1 AND p.status = 'ACTIVE'
  `, [userId]);

  if (!pledgesRes.rows.length) return { status: 'GREEN', action_required: false, ltv: 0 };

  // Calculate current pledge value
  const currentPledgeValue = pledgesRes.rows.reduce((sum, p) => {
    const nav = parseFloat(p.current_nav) || 0;
    return sum + (p.units_pledged * nav);
  }, 0);

  // Max eligible based on current values and LTV caps
  const maxEligible = pledgesRes.rows.reduce((sum, p) => {
    const nav = parseFloat(p.current_nav) || 0;
    const ltv = parseFloat(p.ltv_cap) || 0.40;
    return sum + (p.units_pledged * nav * ltv);
  }, 0);

  // Current LTV ratio (outstanding vs max eligible)
  // Guard against division by zero — if maxEligible is 0, status is GREEN (data issue, not margin call)
  if (maxEligible <= 0) {
    return { status: 'GREEN', action_required: false, ltv_ratio: 0, outstanding, current_pledge_value: Math.round(currentPledgeValue), max_eligible: 0, message: 'NAV data pending. Portfolio health will update once NAV is refreshed.' };
  }
  const ltvRatio = outstanding / maxEligible;

  // Drawdown calculation from peak (optional — don't let it block the LTV check)
  const drawdowns = [];
  try {
    for (const pledge of pledgesRes.rows) {
      try {
        const { peak_nav } = await getPeakNAV(pledge.isin);
        if (peak_nav && pledge.current_nav) {
          const dd = ((peak_nav - parseFloat(pledge.current_nav)) / peak_nav) * 100;
          drawdowns.push({ isin: pledge.isin, drawdown_pct: dd });
        }
      } catch(e) { /* skip this pledge's drawdown — DB might not have history */ }
    }
  } catch(e) { /* drawdown calc is optional */ }

  // Determine health status
  const AMBER_THRESHOLD = 0.80; // 80% of max eligible
  const RED_THRESHOLD   = 0.90; // 90% of max eligible

  let status, action_required, message;

  if (ltvRatio >= RED_THRESHOLD) {
    status           = 'RED';
    action_required  = true;
    message          = `Portfolio value has dropped. Margin call: add more MFs or repay ₹${Math.round(outstanding - maxEligible * 0.85).toLocaleString()} to restore health.`;
  } else if (ltvRatio >= AMBER_THRESHOLD) {
    status           = 'AMBER';
    action_required  = false;
    message          = 'Portfolio value dropped. Consider adding more funds or partial repayment.';
  } else {
    status           = 'GREEN';
    action_required  = false;
    message          = 'Portfolio health is good.';
  }

  return {
    status,
    action_required,
    message,
    ltv_ratio:           parseFloat((ltvRatio * 100).toFixed(2)),
    outstanding,
    current_pledge_value: Math.round(currentPledgeValue),
    max_eligible:         Math.round(maxEligible),
    shortfall:            status === 'RED' ? Math.round(outstanding - maxEligible * 0.85) : 0,
    drawdowns,
  };
};

module.exports = {
  evaluateCreditLimit,
  calculateDrawdown,
  checkLTVHealth,
  calculateFraudScore,
  getRiskTier,
};
