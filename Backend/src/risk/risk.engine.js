const { query }  = require('../../config/database');
const { getPeakNAV } = require('../portfolio/nav.service');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// RISK ENGINE  (LienPay LSP — Data Calculation Only)
//
// What this engine does:
//   1. Calculates eligible credit from pledged portfolio (LTV caps)
//   2. Applies drawdown adjustment per fund
//   3. Derives risk tier (A/B/C) for NBFC reporting
//   4. LTV health monitoring for existing accounts
//
// What this engine does NOT do:
//   - Bureau check (not needed — loan is 100% collateral-backed)
//   - Fraud adjustment on credit limit (securitised loan)
//   - Make credit decisions (that is NBFC's job)
//   - Set APR (NBFC sets APR based on tier we provide)
//
// APR PRODUCTS (two options — user chooses at onboarding):
//   - STANDARD (12% APR): 30-day interest-free, then 12% p.a.
//   - INTEREST_ONLY (18% APR): Pay only interest monthly,
//     repay principal whenever. No free period.
// ─────────────────────────────────────────────────────────────

// ── DRAWDOWN CALCULATION ──────────────────────────────────────
// Founder-corrected thresholds (from review session):
//   up to 25%       = no reduction
//   25% – 35%       = 5% reduction
//   35% – 50%       = 20% reduction
//   above 50%       = 20% reduction (same ceiling)
const calculateDrawdown = (currentNav, peakNav, lowestNav) => {
  if (!peakNav || peakNav <= 0) return { drawdown_pct: 0, risk_level: 'LOW' };

  const drawdownFromPeak = ((peakNav - currentNav) / peakNav) * 100;
  const maxDrawdown = lowestNav
    ? ((peakNav - lowestNav) / peakNav) * 100
    : drawdownFromPeak;

  let risk_level;
  if (maxDrawdown <= 15)      risk_level = 'LOW';
  else if (maxDrawdown <= 30) risk_level = 'MEDIUM';
  else if (maxDrawdown <= 45) risk_level = 'HIGH';
  else                         risk_level = 'VERY_HIGH';

  return {
    drawdown_from_peak_pct: parseFloat(drawdownFromPeak.toFixed(2)),
    max_drawdown_pct:       parseFloat(maxDrawdown.toFixed(2)),
    risk_level,
  };
};

// Founder correction:
//   ≤ 25%  → 1.00 (no reduction)
//   25–35% → 0.95 (5% reduction)
//   35–50% → 0.80 (20% reduction)
//   > 50%  → 0.80 (capped at 20%)
const getDrawdownAdjustment = (maxDrawdownPct) => {
  if (maxDrawdownPct <= 25)  return 1.00;
  if (maxDrawdownPct <= 35)  return 0.95;
  return 0.80; // 35%+ → 20% reduction
};

// ── MAIN: EVALUATE CREDIT LIMIT ───────────────────────────────
const evaluateCreditLimit = async (userId) => {
  try {
    // 1. Get eligible holdings from portfolio
    const holdingsRes = await query(`
      SELECT * FROM mf_holdings WHERE user_id = $1 AND is_eligible = true
    `, [userId]);

    if (!holdingsRes.rows.length) {
      throw { statusCode: 400, message: 'No eligible mutual fund holdings found.' };
    }

    const holdings = holdingsRes.rows;
    let totalEligibleWithDrawdown = 0;
    const fundBreakdown = [];

    // 2. Calculate per-fund eligible value with drawdown adjustment
    for (const holding of holdings) {
      const { peak_nav, lowest_nav } = await getPeakNAV(holding.isin).catch(() => ({
        peak_nav:   holding.nav_at_fetch,
        lowest_nav: holding.nav_at_fetch,
      }));

      const effectivePeak   = peak_nav   || holding.nav_at_fetch;
      const effectiveLowest = lowest_nav || holding.nav_at_fetch;
      const drawdown        = calculateDrawdown(holding.nav_at_fetch, effectivePeak, effectiveLowest);
      const drawdownAdj     = getDrawdownAdjustment(drawdown.max_drawdown_pct);

      // Base eligible already has LTV cap applied in mf_holdings
      const adjustedEligible = holding.eligible_value * drawdownAdj;
      totalEligibleWithDrawdown += adjustedEligible;

      fundBreakdown.push({
        scheme_name:    holding.scheme_name,
        scheme_type:    holding.scheme_type,
        ltv_cap:        holding.ltv_cap,
        base_eligible:  holding.eligible_value,
        drawdown_pct:   drawdown.max_drawdown_pct,
        drawdown_adj:   drawdownAdj,
        final_eligible: Math.round(adjustedEligible),
        drawdown_risk:  drawdown.risk_level,
      });
    }

    // 3. Apply policy floor — no maximum limit per founder
    const minLimit = parseInt(process.env.RISK_MIN_CREDIT_LIMIT) || 10000;
    let approvedLimit = Math.round(totalEligibleWithDrawdown);

    // Round to nearest 1000
    approvedLimit = Math.round(approvedLimit / 1000) * 1000;

    if (approvedLimit < minLimit) {
      throw {
        statusCode: 400,
        message: `Minimum credit line is ₹${minLimit.toLocaleString('en-IN')}. Your portfolio does not meet the minimum eligibility.`,
      };
    }

    // NOTE: No maximum limit cap — removed per founder instruction
    // NOTE: No bureau adjustment — collateral-backed loan
    // NOTE: No fraud adjustment on limit — securitised 100%

    // 4. Determine risk tier (for NBFC reporting — does not affect limit)
    const { tier, suggested_apr } = getRiskTier(holdings);

    // 5. Store risk decision
    const totalPortfolioValue = holdings.reduce((s, h) => s + parseFloat(h.value_at_fetch || 0), 0);

    const decisionRes = await query(`
      INSERT INTO risk_decisions (
        user_id, decision_type, portfolio_ltv_value,
        fraud_score, aml_result,
        approved_limit, risk_tier, apr,
        decision, engine_version
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING decision_id
    `, [
      userId, 'INITIAL_CREDIT',
      Math.round(totalEligibleWithDrawdown),
      0,       // fraud score — not used for limit
      'PASS',
      approvedLimit,
      tier,
      suggested_apr,
      'APPROVED',
      'v2.0',
    ]);

    audit('RISK_DECISION_APPROVED', userId, {
      approved_limit: approvedLimit,
      risk_tier:      tier,
      suggested_apr,
    });

    return {
      decision_id:           decisionRes.rows[0].decision_id,
      approved_limit:        approvedLimit,
      risk_tier:             tier,
      suggested_apr,
      fund_breakdown:        fundBreakdown,
      total_portfolio_value: Math.round(totalPortfolioValue),
      total_eligible_base:   Math.round(totalEligibleWithDrawdown),
      adjustments_applied:   {
        drawdown: 'Applied per fund (0%, 5%, or 20% based on historical drawdown)',
        bureau:   'Not applied — collateral-backed lending',
        fraud:    'Not applied — securitised 100%',
      },
    };

  } catch (err) {
    if (err.statusCode) throw err;
    logger.error('Risk engine error:', err);
    throw { statusCode: 500, message: 'Risk evaluation failed. Please try again.' };
  }
};

// ── RISK TIER ASSIGNMENT ──────────────────────────────────────
// Tier A = Prime (full loan — 18% APR or interest-only)
// Tier B = Standard (EMI loans — 12% APR)
// Tier C = Starter (others)
// APR is suggested to NBFC — NBFC makes final decision
const getRiskTier = (holdings) => {
  const debtRatio = holdings.filter(h =>
    h.scheme_type === 'DEBT_LIQUID' ||
    h.scheme_type === 'DEBT_SHORT_DUR' ||
    h.scheme_type === 'EQUITY_LARGE_CAP' ||
    h.scheme_type === 'EQUITY_INDEX'
  ).length / holdings.length;

  if (debtRatio >= 0.5) {
    return { tier: 'A', suggested_apr: 18.00 }; // Full loan / interest-only
  }
  if (debtRatio >= 0.3) {
    return { tier: 'B', suggested_apr: 12.00 }; // EMI loans
  }
  return { tier: 'C', suggested_apr: 12.00 };
};

// ── LTV HEALTH CHECK ─────────────────────────────────────────
// Called daily by NAV monitoring cron
// Also checks for notorious fund impact on LTV
const checkLTVHealth = async (userId, accountId) => {
  const accountRes = await query(
    'SELECT outstanding, credit_limit FROM credit_accounts WHERE account_id = $1',
    [accountId]
  );

  if (!accountRes.rows.length) {
    return { status: 'GREEN', action_required: false, ltv_ratio: 0, outstanding: 0 };
  }

  const { outstanding, credit_limit } = accountRes.rows[0];

  if (!outstanding || parseFloat(outstanding) <= 0) {
    return { status: 'GREEN', action_required: false, ltv_ratio: 0, outstanding: 0 };
  }

  // Get current portfolio value (pledged holdings only)
  // Using COALESCE: prefer today's NAV from nav_history, fall back to nav_at_fetch
  const pledgesRes = await query(`
    SELECT p.isin, p.units_pledged,
           COALESCE(n.nav_value, mh.nav_at_fetch) as current_nav,
           mh.ltv_cap, mh.scheme_type,
           COALESCE(nf.is_active, false) as is_notorious
    FROM pledges p
    JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
    LEFT JOIN nav_history n ON n.isin = p.isin AND n.nav_date = CURRENT_DATE
    LEFT JOIN notorious_funds nf ON nf.isin = p.isin AND nf.is_active = true
    WHERE p.user_id = $1 AND p.status = 'ACTIVE'
  `, [userId]);

  if (!pledgesRes.rows.length) {
    return { status: 'GREEN', action_required: false, ltv_ratio: 0, outstanding: 0 };
  }

  // Notorious funds count as 0% LTV for health calculation
  // This simulates the real exposure: if a fund is notorious, it provides
  // no collateral cover, so the actual LTV is higher
  const maxEligible = pledgesRes.rows.reduce((sum, p) => {
    const nav = parseFloat(p.current_nav) || 0;
    const ltv = p.is_notorious ? 0 : (parseFloat(p.ltv_cap) || 0.40);
    return sum + (p.units_pledged * nav * ltv);
  }, 0);

  if (maxEligible <= 0) {
    return {
      status:        'GREEN',
      action_required: false,
      ltv_ratio:     0,
      outstanding:   parseFloat(outstanding),
      message:       'NAV data pending. Portfolio health will update after NAV refresh.',
    };
  }

  const outstandingFloat = parseFloat(outstanding);
  const ltvRatio = (outstandingFloat / maxEligible) * 100;

  // LTV health thresholds
  let status, message, action_required, shortfall;
  if (ltvRatio >= 90) {
    status = 'RED';
    action_required = true;
    shortfall = Math.max(0, outstandingFloat - maxEligible * 0.80);
    message = `LTV at ${ltvRatio.toFixed(1)}%. Margin call territory. NBFC has been notified.`;
  } else if (ltvRatio >= 80) {
    status = 'AMBER';
    action_required = true;
    shortfall = Math.max(0, outstandingFloat - maxEligible * 0.75);
    message = `LTV at ${ltvRatio.toFixed(1)}%. UPI spending paused. Add collateral or repay to restore.`;
  } else {
    status = 'GREEN';
    action_required = false;
    shortfall = 0;
    message = `LTV at ${ltvRatio.toFixed(1)}%. Portfolio is healthy.`;
  }

  const hasNotorious = pledgesRes.rows.some(p => p.is_notorious);

  return {
    status,
    action_required,
    ltv_ratio: parseFloat(ltvRatio.toFixed(2)),
    outstanding: outstandingFloat,
    max_eligible: Math.round(maxEligible),
    shortfall,
    message,
    has_notorious_funds: hasNotorious,
  };
};

module.exports = {
  evaluateCreditLimit,
  getRiskTier,
  checkLTVHealth,
  calculateDrawdown,
  getDrawdownAdjustment,
};
