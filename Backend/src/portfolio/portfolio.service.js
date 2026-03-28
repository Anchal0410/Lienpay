const { query }    = require('../../config/database');
const { createAAConsent, fetchPortfolioData } = require('./aa.service');
const { getNavsForPortfolio, getPeakNAV }     = require('./nav.service');
const { isFundEligible, getAssetClass }       = require('./fund.classifier');
const { lookupFund }                           = require('./fund.universe');
const { checkExistingPledges }                 = require('./pledge.check.service');
const { logConsent, CONSENT_TYPES }            = require('../kyc/consent.service');
const { logger, audit }                        = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// PORTFOLIO SERVICE
//
// FUND UNIVERSE WHITELIST LOGIC:
//   Every holding from AA is checked against the fund_universe table.
//   - Fund IN universe (status=ACTIVE)  → eligible, use universe's category + LTV
//   - Fund NOT in universe              → ineligible, FUND_NOT_IN_UNIVERSE
//   - Fund in universe but PENDING      → ineligible, FUND_PENDING_REVIEW
//   - Fund in universe but INACTIVE     → ineligible, FUND_INACTIVE
//
// This means:
//   - LTV rates are NEVER auto-computed from scheme names
//   - Only funds the founder has manually reviewed get credit
//   - New batches are added via POST /api/admin/fund-universe
//
// Production switch: AA_MODE=real, AADHAAR_MODE=real in Railway env.
// ─────────────────────────────────────────────────────────────

// ── STEP 1: Initiate AA consent ───────────────────────────────
const initiateAAConsent = async ({ userId, mobile, ipHash }) => {
  await logConsent({
    userId,
    consentType: CONSENT_TYPES.AA_DATA_ACCESS,
    ipHash,
    metadata: { fips: ['CAMS-FIP', 'KFINTECH-FIP'], purpose: 'CREDIT_UNDERWRITING' },
  });

  const result = await createAAConsent(userId, mobile);

  await query(`
    UPDATE users SET onboarding_step='AA_CONSENT_PENDING', updated_at=NOW()
    WHERE user_id=$1
  `, [userId]);

  return result;
};

// ── STEP 2: Fetch + process portfolio ────────────────────────
const fetchAndProcessPortfolio = async ({ userId, consentId }) => {

  // 1. Get raw holdings from AA (mock: 38 curated funds | real: user's actual portfolio)
  const aaData = await fetchPortfolioData(consentId, userId);
  if (!aaData.success || !aaData.holdings?.length) {
    throw { statusCode: 400, message: 'No mutual fund holdings found in your portfolio.' };
  }

  const holdings = aaData.holdings;

  // 2. Build ISIN list + scheme_code map for NAV lookup
  const isins         = [...new Set(holdings.map(h => h.isin))];
  const schemeCodeMap = {};
  holdings.forEach(h => { if (h.isin && h.scheme_code) schemeCodeMap[h.isin] = h.scheme_code; });

  // 3. Fetch live NAVs
  //    Primary: AMFI bulk file by ISIN (works for all real ISINs in production)
  //    Fallback: mfapi.in by scheme_code (covers mock mode + edge cases)
  const navMap = await getNavsForPortfolio(isins, schemeCodeMap);

  // 4. Check existing pledges
  const pledgeStatuses = await checkExistingPledges(holdings);
  const pledgeMap      = {};
  pledgeStatuses.forEach(p => { pledgeMap[p.folio_number] = p; });

  // 5. Process each holding against the fund universe whitelist
  const processedHoldings = [];
  let universeHits  = 0;
  let universeMisses = 0;

  for (const holding of holdings) {

    // ── UNIVERSE CHECK ────────────────────────────────────────
    // Look up by scheme_code (primary) or isin (fallback)
    const universeEntry = await lookupFund(holding.scheme_code || holding.isin);

    if (!universeEntry) {
      // Not in universe — show in UI but not eligible for credit
      universeMisses++;
      const nav        = navMap[holding.isin] || parseFloat(holding.nav || 0);
      const fundValue  = holding.units_held * nav;

      processedHoldings.push({
        folio_number:         holding.folio_number,
        isin:                 holding.isin,
        scheme_name:          holding.scheme_name,
        amc_name:             holding.amc_name,
        rta:                  holding.rta,
        scheme_type:          null,
        asset_class:          null,
        ltv_cap:              0,
        units_held:           holding.units_held,
        nav_at_fetch:         nav,
        value_at_fetch:       Math.round(fundValue),
        is_eligible:          false,
        ineligibility_reason: 'FUND_NOT_IN_UNIVERSE',
        lock_in_date:         holding.lock_in_date,
        is_joint_holding:     holding.is_joint || false,
        existing_pledge:      false,
        eligible_units:       0,
        eligible_value:       0,
        aa_consent_id:        consentId,
      });
      continue;
    }

    universeHits++;

    // ── FUND IS IN UNIVERSE ───────────────────────────────────
    // Use universe's scheme_type and ltv_rate — NOT auto-classification
    const schemeType = universeEntry.scheme_type;
    const ltv        = universeEntry.ltv_rate;
    const assetClass = getAssetClass(schemeType);

    // Additional eligibility checks (ELSS lock-in, joint holder, etc.)
    const eligibility = isFundEligible(schemeType, holding.lock_in_date);

    // NAV: live from AMFI/mfapi.in → static from AA data → 0
    const currentNav   = navMap[holding.isin] || parseFloat(holding.nav || 0);
    const currentValue = holding.units_held * currentNav;

    if (currentNav <= 0) {
      logger.warn(`No NAV found for ${holding.scheme_name} (scheme_code: ${holding.scheme_code})`);
    }

    // Pledge check
    const pledgeStatus   = pledgeMap[holding.folio_number];
    const existingPledge = pledgeStatus?.has_pledge || false;
    const availableUnits = existingPledge ? (pledgeStatus.available_units || 0) : holding.units_held;
    const eligibleValue  = eligibility.eligible && currentNav > 0
      ? availableUnits * currentNav * ltv
      : 0;

    processedHoldings.push({
      folio_number:         holding.folio_number,
      isin:                 holding.isin,
      scheme_name:          universeEntry.fund_name, // use our canonical name, not AA's
      amc_name:             holding.amc_name,
      rta:                  universeEntry.rta || holding.rta,
      scheme_type:          schemeType,
      asset_class:          assetClass,
      ltv_cap:              ltv,
      units_held:           holding.units_held,
      nav_at_fetch:         currentNav,
      value_at_fetch:       Math.round(currentValue),
      is_eligible:          eligibility.eligible,
      ineligibility_reason: eligibility.reason,
      lock_in_date:         holding.lock_in_date,
      is_joint_holding:     holding.is_joint || false,
      existing_pledge:      existingPledge,
      eligible_units:       availableUnits,
      eligible_value:       Math.round(eligibleValue),
      aa_consent_id:        consentId,
    });
  }

  logger.info(`Portfolio processed: ${universeHits} in universe, ${universeMisses} not in universe`, { userId });

  // 6. Save ALL holdings to DB (including non-universe ones for audit trail)
  for (const h of processedHoldings) {
    await query(`
      INSERT INTO mf_holdings (
        user_id, folio_number, isin, scheme_name, amc_name, rta,
        scheme_type, asset_class, ltv_cap, units_held, nav_at_fetch,
        value_at_fetch, is_eligible, ineligibility_reason, lock_in_date,
        is_joint_holding, existing_pledge, eligible_units, eligible_value, aa_consent_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      ON CONFLICT (user_id, folio_number) DO UPDATE SET
        nav_at_fetch   = EXCLUDED.nav_at_fetch,
        value_at_fetch = EXCLUDED.value_at_fetch,
        eligible_value = EXCLUDED.eligible_value,
        is_eligible    = EXCLUDED.is_eligible,
        ltv_cap        = EXCLUDED.ltv_cap,
        scheme_type    = EXCLUDED.scheme_type,
        updated_at     = NOW()
    `, [
      userId, h.folio_number, h.isin, h.scheme_name, h.amc_name, h.rta,
      h.scheme_type, h.asset_class, h.ltv_cap, h.units_held, h.nav_at_fetch,
      h.value_at_fetch, h.is_eligible, h.ineligibility_reason, h.lock_in_date,
      h.is_joint_holding, h.existing_pledge, h.eligible_units, h.eligible_value,
      h.aa_consent_id,
    ]);
  }

  // 7. Update onboarding step
  const eligibleHoldings = processedHoldings.filter(h => h.is_eligible);
  const totalValue       = processedHoldings.reduce((s, h) => s + (h.value_at_fetch || 0), 0);
  const totalEligible    = eligibleHoldings.reduce((s, h) => s + (h.eligible_value || 0), 0);

  await query(`
    UPDATE users SET account_status='PORTFOLIO_LINKED', onboarding_step='PLEDGE', updated_at=NOW()
    WHERE user_id=$1
  `, [userId]);

  audit('PORTFOLIO_FETCHED', userId, {
    total_funds: processedHoldings.length,
    universe_hits: universeHits,
    universe_misses: universeMisses,
    eligible_funds: eligibleHoldings.length,
    total_value: Math.round(totalValue),
    total_eligible: Math.round(totalEligible),
    aa_mode: process.env.AA_MODE || 'mock',
  });

  return {
    total_funds:           processedHoldings.length,
    universe_hits:         universeHits,
    universe_misses:       universeMisses,
    eligible_funds:        eligibleHoldings.length,
    total_value:           Math.round(totalValue),
    total_eligible_credit: Math.round(totalEligible),
    holdings: processedHoldings.map(h => ({
      folio_number:       h.folio_number,
      scheme_name:        h.scheme_name,
      amc_name:           h.amc_name,
      rta:                h.rta,
      scheme_type:        h.scheme_type,
      asset_class:        h.asset_class,
      ltv_cap:            h.ltv_cap ? `${(h.ltv_cap * 100).toFixed(0)}%` : null,
      units_held:         h.units_held,
      current_nav:        h.nav_at_fetch,
      current_value:      h.value_at_fetch,
      is_eligible:        h.is_eligible,
      ineligible_reason:  h.ineligibility_reason,
      eligible_credit:    h.eligible_value,
      existing_pledge:    h.existing_pledge,
    })),
    next_step: 'PLEDGE',
  };
};

// ── SAVE BULK HOLDINGS (DEV / DEMO ONLY) ─────────────────────
// ⚠ DEV NOTE: Blocked in production (NODE_ENV=production).
// In production, ALL holdings must come through the AA consent flow above.
const saveBulkHoldings = async (userId, holdings) => {
  if (process.env.NODE_ENV === 'production') {
    throw { statusCode: 403, message: 'save-holdings is disabled in production. Use the AA consent flow.' };
  }
  if (!holdings?.length) throw { statusCode: 400, message: 'No holdings provided.' };

  let saved = 0;

  for (const h of holdings) {
    // Universe check — even in dev, respect the whitelist
    const universeEntry = await lookupFund(h.scheme_code || h.folio_number?.replace(/[A-Z]+/, ''));
    const isInUniverse  = !!universeEntry;

    const schemeType  = universeEntry?.scheme_type || h.scheme_type || 'EQUITY_LARGE_CAP';
    const assetClass  = getAssetClass(schemeType);
    const ltv         = universeEntry?.ltv_rate || 0;
    const eligibility = isInUniverse ? isFundEligible(schemeType, null) : { eligible: false, reason: 'FUND_NOT_IN_UNIVERSE' };

    const nav         = parseFloat(h.nav_at_fetch || h.current_nav || h.nav || 0);
    const units       = parseFloat(h.units_held || 0);
    const value       = units * nav;
    const eligibleVal = eligibility.eligible ? value * ltv : 0;

    if (nav <= 0 || units <= 0) continue;

    await query(`
      INSERT INTO mf_holdings (
        user_id, folio_number, isin, scheme_name, amc_name, rta,
        scheme_type, asset_class, ltv_cap, units_held, nav_at_fetch,
        value_at_fetch, is_eligible, ineligibility_reason, eligible_units, eligible_value
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      ON CONFLICT (user_id, folio_number) DO UPDATE SET
        scheme_type    = EXCLUDED.scheme_type,
        asset_class    = EXCLUDED.asset_class,
        ltv_cap        = EXCLUDED.ltv_cap,
        nav_at_fetch   = EXCLUDED.nav_at_fetch,
        value_at_fetch = EXCLUDED.value_at_fetch,
        is_eligible    = EXCLUDED.is_eligible,
        ineligibility_reason = EXCLUDED.ineligibility_reason,
        eligible_units = EXCLUDED.eligible_units,
        eligible_value = EXCLUDED.eligible_value,
        updated_at     = NOW()
    `, [
      userId, h.folio_number, h.isin || `DEV_${h.folio_number}`,
      h.scheme_name, h.amc_name || 'AMC', h.rta || 'CAMS',
      schemeType, assetClass, ltv, units, nav,
      Math.round(value), eligibility.eligible,
      eligibility.reason || null, units, Math.round(eligibleVal),
    ]);

    saved++;
  }

  await query(`
    UPDATE users SET account_status='PORTFOLIO_LINKED', onboarding_step='PLEDGE', updated_at=NOW()
    WHERE user_id=$1
  `, [userId]);

  audit('PORTFOLIO_SAVED_DEV', userId, { saved, total: holdings.length });
  return { saved, total: holdings.length };
};

// ── GET PORTFOLIO SUMMARY ─────────────────────────────────────
const getPortfolioSummary = async (userId) => {
  const [result, holdings] = await Promise.all([
    query(`
      SELECT
        COUNT(*) FILTER (WHERE is_eligible=true) as eligible_count,
        COUNT(*) as total_count,
        SUM(value_at_fetch) as total_value,
        SUM(eligible_value) as total_eligible
      FROM mf_holdings WHERE user_id=$1
    `, [userId]),
    query(`SELECT * FROM mf_holdings WHERE user_id=$1 ORDER BY value_at_fetch DESC`, [userId]),
  ]);

  return { summary: result.rows[0], holdings: holdings.rows };
};

module.exports = {
  initiateAAConsent,
  fetchAndProcessPortfolio,
  saveBulkHoldings,
  getPortfolioSummary,
};
