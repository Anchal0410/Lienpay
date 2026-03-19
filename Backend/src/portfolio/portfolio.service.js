const { query }    = require('../../config/database');
const { createAAConsent, fetchPortfolioData } = require('./aa.service');
const { getNavsForPortfolio, getPeakNAV }     = require('./nav.service');
const { classifyFromSchemeName, getLTVForFund, isFundEligible, getAssetClass } = require('./fund.classifier');
const { checkExistingPledges } = require('./pledge.check.service');
const { logConsent, CONSENT_TYPES } = require('../kyc/consent.service');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// PORTFOLIO SERVICE
// Orchestrates the full MF portfolio linking flow:
// 1. Create AA consent
// 2. Fetch portfolio data via AA
// 3. Fetch current NAVs from AMFI (real, free)
// 4. Classify each fund
// 5. Check existing pledges
// 6. Calculate LTV eligibility per fund
// 7. Store portfolio snapshot
// ─────────────────────────────────────────────────────────────

// ── STEP 1: Initiate AA consent ───────────────────────────────
const initiateAAConsent = async ({ userId, mobile, ipHash }) => {
  // Log AA consent before making any call
  await logConsent({
    userId,
    consentType: CONSENT_TYPES.AA_DATA_ACCESS,
    ipHash,
    metadata: { fips: ['CAMS-FIP', 'KFINTECH-FIP'], purpose: 'CREDIT_UNDERWRITING' },
  });

  const result = await createAAConsent(userId, mobile);

  // Store consent reference
  await query(`
    UPDATE users SET
      onboarding_step = 'AA_CONSENT_PENDING',
      updated_at      = NOW()
    WHERE user_id = $1
  `, [userId]);

  return result;
};

// ── STEP 2: Fetch and process portfolio ───────────────────────
const fetchAndProcessPortfolio = async ({ userId, consentId }) => {
  // 1. Fetch raw portfolio data via AA
  const aaData = await fetchPortfolioData(consentId, userId);
  if (!aaData.success || !aaData.holdings?.length) {
    throw { statusCode: 400, message: 'No mutual fund holdings found in your portfolio.' };
  }

  const holdings = aaData.holdings;

  // 2. Fetch current NAVs from AMFI (real free API)
  const isins  = [...new Set(holdings.map(h => h.isin))];
  const navMap = await getNavsForPortfolio(isins);

  // 3. Check existing pledges on all folios
  const pledgeStatuses = await checkExistingPledges(holdings);
  const pledgeMap = {};
  pledgeStatuses.forEach(p => { pledgeMap[p.folio_number] = p; });

  // 4. Process each holding
  const processedHoldings = [];

  for (const holding of holdings) {
    // Classify fund type
    const schemeType = holding.scheme_type || classifyFromSchemeName(holding.scheme_name);
    const assetClass = getAssetClass(schemeType);
    const ltv        = getLTVForFund(schemeType);

    // Check eligibility
    const eligibility = isFundEligible(schemeType, holding.lock_in_date);

    // Get current NAV
    const currentNav = navMap[holding.isin] || holding.nav;
    const currentValue = holding.units_held * currentNav;

    // Check existing pledge
    const pledgeStatus   = pledgeMap[holding.folio_number];
    const existingPledge = pledgeStatus?.has_pledge || false;
    const availableUnits = existingPledge
      ? (pledgeStatus.available_units || 0)
      : holding.units_held;

    // Calculate eligible value
    const eligibleUnits = availableUnits;
    const eligibleValue = eligibility.eligible
      ? eligibleUnits * currentNav * ltv
      : 0;

    processedHoldings.push({
      folio_number:      holding.folio_number,
      isin:              holding.isin,
      scheme_name:       holding.scheme_name,
      amc_name:          holding.amc_name,
      rta:               holding.rta,
      scheme_type:       schemeType,
      asset_class:       assetClass,
      ltv_cap:           ltv,
      units_held:        holding.units_held,
      nav_at_fetch:      currentNav,
      value_at_fetch:    currentValue,
      is_eligible:       eligibility.eligible,
      ineligibility_reason: eligibility.reason,
      lock_in_date:      holding.lock_in_date,
      is_joint_holding:  holding.is_joint || false,
      existing_pledge:   existingPledge,
      eligible_units:    eligibleUnits,
      eligible_value:    eligibleValue,
      aa_consent_id:     consentId,
    });
  }

  // 5. Store all holdings in DB
  for (const h of processedHoldings) {
    await query(`
      INSERT INTO mf_holdings (
        user_id, folio_number, isin, scheme_name, amc_name, rta,
        scheme_type, asset_class, ltv_cap, units_held, nav_at_fetch,
        value_at_fetch, is_eligible, ineligibility_reason, lock_in_date,
        is_joint_holding, existing_pledge, eligible_units, eligible_value,
        aa_consent_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (user_id, folio_number) DO UPDATE SET
        nav_at_fetch    = EXCLUDED.nav_at_fetch,
        value_at_fetch  = EXCLUDED.value_at_fetch,
        eligible_value  = EXCLUDED.eligible_value,
        updated_at      = NOW()
    `, [
      userId, h.folio_number, h.isin, h.scheme_name, h.amc_name, h.rta,
      h.scheme_type, h.asset_class, h.ltv_cap, h.units_held, h.nav_at_fetch,
      h.value_at_fetch, h.is_eligible, h.ineligibility_reason, h.lock_in_date,
      h.is_joint_holding, h.existing_pledge, h.eligible_units, h.eligible_value,
      h.aa_consent_id,
    ]);
  }

  // 6. Calculate portfolio totals
  const eligibleHoldings  = processedHoldings.filter(h => h.is_eligible);
  const totalValue        = processedHoldings.reduce((s, h) => s + h.value_at_fetch, 0);
  const totalEligible     = eligibleHoldings.reduce((s, h) => s + h.eligible_value, 0);

  // 7. Update user onboarding step
  await query(`
    UPDATE users SET
      account_status  = 'PORTFOLIO_LINKED',
      onboarding_step = 'PLEDGE',
      updated_at      = NOW()
    WHERE user_id = $1
  `, [userId]);

  audit('PORTFOLIO_FETCHED', userId, {
    total_funds:      processedHoldings.length,
    eligible_funds:   eligibleHoldings.length,
    total_value:      totalValue,
    total_eligible:   totalEligible,
  });

  return {
    total_funds:      processedHoldings.length,
    eligible_funds:   eligibleHoldings.length,
    total_value:      Math.round(totalValue),
    total_eligible_credit: Math.round(totalEligible),
    holdings:         processedHoldings.map(h => ({
      folio_number:   h.folio_number,
      scheme_name:    h.scheme_name,
      amc_name:       h.amc_name,
      rta:            h.rta,
      scheme_type:    h.scheme_type,
      asset_class:    h.asset_class,
      ltv_cap:        `${(h.ltv_cap * 100).toFixed(0)}%`,
      units_held:     h.units_held,
      current_nav:    h.nav_at_fetch,
      current_value:  Math.round(h.value_at_fetch),
      is_eligible:    h.is_eligible,
      ineligible_reason: h.ineligibility_reason,
      eligible_credit: Math.round(h.eligible_value),
      existing_pledge: h.existing_pledge,
    })),
    next_step: 'PLEDGE',
  };
};

// ── GET PORTFOLIO SUMMARY ─────────────────────────────────────
const getPortfolioSummary = async (userId) => {
  const result = await query(`
    SELECT
      COUNT(*) FILTER (WHERE is_eligible = true) as eligible_count,
      COUNT(*) as total_count,
      SUM(value_at_fetch) as total_value,
      SUM(eligible_value) as total_eligible,
      SUM(eligible_value) FILTER (WHERE asset_class = 'EQUITY') as equity_eligible,
      SUM(eligible_value) FILTER (WHERE asset_class = 'DEBT')   as debt_eligible
    FROM mf_holdings
    WHERE user_id = $1
  `, [userId]);

  const holdings = await query(`
    SELECT * FROM mf_holdings WHERE user_id = $1 ORDER BY value_at_fetch DESC
  `, [userId]);

  return {
    summary:  result.rows[0],
    holdings: holdings.rows,
  };
};

module.exports = {
  initiateAAConsent,
  fetchAndProcessPortfolio,
  getPortfolioSummary,
};
