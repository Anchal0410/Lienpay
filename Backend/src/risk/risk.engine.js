// ─────────────────────────────────────────────────────────────
// RISK ENGINE
// LTV health, credit limit evaluation, fraud scoring
// ─────────────────────────────────────────────────────────────

const { query }  = require('../../config/database');
const { logger, audit } = require('../../config/logger');
const { getNavForISIN, getPeakNAV } = require('../portfolio/nav.service');

// ── FRAUD SCORE ───────────────────────────────────────────────
const calculateFraudScore = async (userId, ipAddress, deviceId) => {
  const score = Math.floor(Math.random() * 30); // mock
  return score;
};

// ── CREDIT LIMIT EVALUATION ───────────────────────────────────
const evaluateCreditLimit = async (userId) => {
  // Get KYC & bureau data
  const kycRes = await query(
    'SELECT * FROM kyc_records WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  const bureauRes = await query(
    'SELECT * FROM bureau_results WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  const holdingsRes = await query(
    'SELECT * FROM mf_holdings WHERE user_id = $1 AND is_eligible = true',
    [userId]
  );

  if (!holdingsRes.rows.length) {
    throw { statusCode: 400, message: 'No eligible holdings found. Please link your portfolio first.' };
  }

  const holdings = holdingsRes.rows;
  const bureau   = bureauRes.rows[0];

  // Score band mapping
  const scoreBand = bureau?.score_band || 'GOOD';
  const fraudScore = bureau?.fraud_score || 15;

  // Credit limit = sum of (units × nav × ltv_cap) for eligible holdings
  const totalEligible = holdings.reduce((sum, h) => {
    return sum + parseFloat(h.eligible_value || 0);
  }, 0);

  const { tier, apr } = getRiskTier(scoreBand, fraudScore, holdings);

  // Cap between min/max
  const MIN_LIMIT = parseInt(process.env.RISK_MIN_CREDIT_LIMIT) || 10000;
  const MAX_LIMIT = parseInt(process.env.RISK_MAX_CREDIT_LIMIT) || 5000000;
  const approvedLimit = Math.max(MIN_LIMIT, Math.min(MAX_LIMIT, Math.round(totalEligible)));

  // Save risk decision
  const decisionRes = await query(`
    INSERT INTO risk_decisions
      (user_id, decision, approved_limit, risk_tier, apr,
       bureau_score_band, fraud_score, decided_at)
    VALUES ($1, 'APPROVED', $2, $3, $4, $5, $6, NOW())
    ON CONFLICT DO NOTHING
    RETURNING decision_id
  `, [userId, approvedLimit, tier, apr, scoreBand, fraudScore]);

  audit('RISK_EVALUATED', userId, { approved_limit: approvedLimit, tier, apr });

  return {
    decision:        'APPROVED',
    approved_limit:  approvedLimit,
    risk_tier:       tier,
    apr,
    bureau_score_band: scoreBand,
    fraud_score:     fraudScore,
    sanctioned_limit: approvedLimit,
    message:         'Credit limit approved based on your portfolio.',
  };
};

// ── DRAWDOWN CALCULATION ──────────────────────────────────────
const calculateDrawdown = async (isin) => {
  const { peak_nav } = await getPeakNAV(isin);
  const current = await getNavForISIN(isin);
  if (!peak_nav || !current?.nav) return null;
  return ((peak_nav - current.nav) / peak_nav) * 100;
};

// ── RISK TIER & INTEREST RATE ─────────────────────────────────
const getRiskTier = (scoreBand, fraudScore, holdings) => {
  const BASE_APR = parseFloat(process.env.BASE_APR) || 12.00;

  const debtRatio = holdings.filter(h =>
    h.scheme_type?.startsWith('DEBT_') || h.scheme_type === 'EQUITY_LARGE_CAP'
  ).length / (holdings.length || 1);

  if (scoreBand === 'EXCELLENT' && fraudScore < 20 && debtRatio >= 0.5) {
    return { tier: 'A', apr: BASE_APR };
  }
  if ((scoreBand === 'EXCELLENT' || scoreBand === 'GOOD') && fraudScore < 40) {
    return { tier: 'B', apr: BASE_APR };
  }
  return { tier: 'C', apr: BASE_APR };
};

// ── LTV HEALTH CHECK ──────────────────────────────────────────
// Called by: NAV monitoring cron, /api/risk/ltv-health endpoint
// Returns ltv_ratio as a PERCENTAGE (e.g. 45.5 = 45.5%)
// ─────────────────────────────────────────────────────────────
const checkLTVHealth = async (userId, accountId) => {
  const accountRes = await query(
    'SELECT outstanding, credit_limit FROM credit_accounts WHERE account_id = $1',
    [accountId]
  );
  const { outstanding, credit_limit } = accountRes.rows[0];

  // ── FIX: was returning { ltv: 0 } — must be ltv_ratio: 0 for frontend consistency ──
  if (!outstanding || outstanding <= 0) {
    return {
      status:           'GREEN',
      action_required:  false,
      ltv_ratio:        0,          // FIXED: was `ltv: 0`
      outstanding:      0,
      current_pledge_value: 0,
      max_eligible:     0,
      message:          'No outstanding balance. Portfolio health is good.',
    };
  }

  // Get pledged holdings with current NAV
  // COALESCE nav_history → mf_holdings.nav_at_fetch (mock fallback)
  const pledgesRes = await query(`
    SELECT p.isin, p.units_pledged,
           COALESCE(n.nav_value, mh.nav_at_fetch) as current_nav,
           mh.ltv_cap, mh.scheme_type, mh.nav_at_fetch
    FROM pledges p
    JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
    LEFT JOIN nav_history n ON n.isin = p.isin AND n.nav_date = CURRENT_DATE
    WHERE p.user_id = $1 AND p.status = 'ACTIVE'
  `, [userId]);

  // ── FIX: was returning { ltv: 0 } — must be ltv_ratio: 0 ──
  if (!pledgesRes.rows.length) {
    return {
      status:           'GREEN',
      action_required:  false,
      ltv_ratio:        0,          // FIXED: was `ltv: 0`
      outstanding,
      current_pledge_value: 0,
      max_eligible:     0,
      message:          'No active pledges found.',
    };
  }

  // Calculate current pledge value and max eligible
  const currentPledgeValue = pledgesRes.rows.reduce((sum, p) => {
    const nav = parseFloat(p.current_nav) || 0;
    return sum + (p.units_pledged * nav);
  }, 0);

  const maxEligible = pledgesRes.rows.reduce((sum, p) => {
    const nav = parseFloat(p.current_nav) || 0;
    const ltv = parseFloat(p.ltv_cap) || 0.40;
    return sum + (p.units_pledged * nav * ltv);
  }, 0);

  if (maxEligible <= 0) {
    return {
      status:               'GREEN',
      action_required:      false,
      ltv_ratio:            0,
      outstanding,
      current_pledge_value: Math.round(currentPledgeValue),
      max_eligible:         0,
      message:              'NAV data pending. Portfolio health will update once NAV is refreshed.',
    };
  }

  const ltvRatio = outstanding / maxEligible;

  // Optional: drawdown calc (don't let it block)
  const drawdowns = [];
  try {
    for (const pledge of pledgesRes.rows) {
      try {
        const { peak_nav } = await getPeakNAV(pledge.isin);
        if (peak_nav && pledge.current_nav) {
          const dd = ((peak_nav - parseFloat(pledge.current_nav)) / peak_nav) * 100;
          drawdowns.push({ isin: pledge.isin, drawdown_pct: dd });
        }
      } catch(e) {}
    }
  } catch(e) {}

  const AMBER_THRESHOLD = 0.80;
  const RED_THRESHOLD   = 0.90;

  let status, action_required, message;

  if (ltvRatio >= RED_THRESHOLD) {
    status          = 'RED';
    action_required = true;
    message         = `Portfolio value has dropped. Margin call: add more MFs or repay ₹${Math.round(outstanding - maxEligible * 0.85).toLocaleString()} to restore health.`;
  } else if (ltvRatio >= AMBER_THRESHOLD) {
    status          = 'AMBER';
    action_required = false;
    message         = 'Portfolio value dropped. Consider adding more funds or partial repayment.';
  } else {
    status          = 'GREEN';
    action_required = false;
    message         = 'Portfolio health is good.';
  }

  return {
    status,
    action_required,
    message,
    ltv_ratio:            parseFloat((ltvRatio * 100).toFixed(2)), // percentage e.g. 45.5
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
