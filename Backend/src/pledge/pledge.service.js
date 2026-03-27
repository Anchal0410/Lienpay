const { query }    = require('../../config/database');
const { v4: uuidv4 } = require('uuid');
const camsService  = require('./cams.service');
const kftService   = require('./kfintech.service');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// PLEDGE SERVICE
// Orchestrates the full pledge flow:
// 1. Validate selection
// 2. Initiate pledge per RTA
// 3. Confirm with OTP
// 4. Store immutable pledge record
// 5. Notify NBFC of collateral
// 6. Release on account closure
// 7. Invoke on default
// ─────────────────────────────────────────────────────────────

// ── STEP 1: Validate fund selection ──────────────────────────
const validatePledgeSelection = async (userId, selectedFolios) => {
  // Get holdings for selected folios
  const holdingIds = selectedFolios.map(f => f.folio_number);
  const holdings = await query(`
    SELECT * FROM mf_holdings
    WHERE user_id = $1 AND folio_number = ANY($2)
  `, [userId, holdingIds]);

  if (!holdings.rows.length) {
    throw { statusCode: 400, message: 'No valid holdings found for selected folios.' };
  }

  // Validate each selected folio
  const validatedFolios = [];
  let totalEligibleValue = 0;

  for (const selected of selectedFolios) {
    const holding = holdings.rows.find(h => h.folio_number === selected.folio_number);
    if (!holding) throw { statusCode: 400, message: `Folio ${selected.folio_number} not found.` };
    if (!holding.is_eligible) throw { statusCode: 400, message: `Folio ${selected.folio_number} is not eligible: ${holding.ineligibility_reason}` };

    // Units to pledge — use all eligible units if not specified
    const unitsToPledge = selected.units_to_pledge || holding.eligible_units;
    if (unitsToPledge > holding.units_held) {
      throw { statusCode: 400, message: `Cannot pledge more units than held in folio ${selected.folio_number}` };
    }

    // Use LTV override if provided (founder-set per-fund LTV), else use auto-classified LTV
    const effectiveLtv = selected.ltv_override || holding.ltv_cap;
    const pledgeValue = unitsToPledge * holding.nav_at_fetch * effectiveLtv;
    totalEligibleValue += pledgeValue;

    validatedFolios.push({
      ...holding,
      ltv_cap: effectiveLtv, // override stored LTV with selected value
      units_to_pledge: unitsToPledge,
      pledge_value:    pledgeValue,
    });
  }

  return { validatedFolios, totalEligibleValue: Math.round(totalEligibleValue) };
};

// ── STEP 2: Initiate pledges with RTA ────────────────────────
const initiatePledges = async (userId, validatedFolios, nbfcName, nbfcPan) => {
  const initiatedPledges = [];

  for (const folio of validatedFolios) {
    const lspPledgeId = uuidv4();
    const pledgeData  = {
      userId,
      folio_number:   folio.folio_number,
      isin:           folio.isin,
      units_to_pledge: folio.units_to_pledge,
      pledgee_name:   nbfcName || process.env.NBFC_NAME || 'FinServNBFC Ltd.',
      pledgee_pan:    nbfcPan  || process.env.NBFC_PAN  || 'AAAPL1234C',
      lsp_pledge_id:  lspPledgeId,
    };

    // Route to correct RTA
    let rtaResponse;
    if (folio.rta === 'CAMS') {
      rtaResponse = await camsService.initiatePledge(pledgeData);
    } else if (folio.rta === 'KFINTECH') {
      rtaResponse = await kftService.initiatePledge(pledgeData);
    } else {
      throw { statusCode: 400, message: `Unknown RTA: ${folio.rta}` };
    }

    // Store initiated pledge (IMMUTABLE from this point)
    const pledgeRes = await query(`
      INSERT INTO pledges (
        user_id, folio_number, isin, scheme_name, rta,
        units_pledged, nav_at_pledge, value_at_pledge, ltv_at_pledge,
        eligible_value_at_pledge, pledgee_name, pledgee_pan,
        rta_txn_id, status, initiated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
      RETURNING pledge_id
    `, [
      userId,
      folio.folio_number,
      folio.isin,
      folio.scheme_name,
      folio.rta,
      folio.units_to_pledge,
      folio.nav_at_fetch,
      folio.units_to_pledge * folio.nav_at_fetch,
      folio.ltv_cap,
      folio.pledge_value,
      pledgeData.pledgee_name,
      pledgeData.pledgee_pan,
      rtaResponse.pledge_req_id,
      'OTP_PENDING',
    ]);

    initiatedPledges.push({
      pledge_id:     pledgeRes.rows[0].pledge_id,
      folio_number:  folio.folio_number,
      rta:           folio.rta,
      scheme_name:   folio.scheme_name,
      units_pledged: folio.units_to_pledge,
      pledge_req_id: rtaResponse.pledge_req_id,
      otp_source:    folio.rta === 'CAMS'
        ? 'CAMS-registered mobile (OTP: 123456 in mock)'
        : 'KFintech-registered mobile (OTP: 654321 in mock)',
    });
  }

  return initiatedPledges;
};

// ── STEP 3: Confirm pledge with OTP ──────────────────────────
const confirmPledgeOTP = async (userId, pledgeId, otp) => {
  // Get pledge record
  const pledgeRes = await query(
    'SELECT * FROM pledges WHERE pledge_id = $1 AND user_id = $2',
    [pledgeId, userId]
  );

  if (!pledgeRes.rows.length) throw { statusCode: 404, message: 'Pledge not found.' };
  const pledge = pledgeRes.rows[0];
  if (pledge.status !== 'OTP_PENDING') throw { statusCode: 400, message: `Pledge is already ${pledge.status}.` };

  // Confirm with correct RTA
  let rtaResult;
  if (pledge.rta === 'CAMS') {
    rtaResult = await camsService.confirmPledge(pledge.rta_txn_id, otp, userId);
  } else {
    rtaResult = await kftService.confirmPledge(pledge.rta_txn_id, otp, userId);
  }

  // Update pledge record (ONLY status and ref — core fields immutable)
  await query(`
    UPDATE pledges SET
      pledge_ref_number = $2,
      status            = 'ACTIVE',
      registered_at     = NOW()
    WHERE pledge_id = $1
  `, [pledgeId, rtaResult.pledge_ref_number]);

  audit('PLEDGE_CONFIRMED', userId, {
    pledge_id:  pledgeId,
    pledge_ref: rtaResult.pledge_ref_number,
    rta:        pledge.rta,
  });

  return {
    pledge_id:         pledgeId,
    pledge_ref_number: rtaResult.pledge_ref_number,
    rta:               pledge.rta,
    status:            'ACTIVE',
    folio_number:      pledge.folio_number,
    units_pledged:     pledge.units_pledged,
  };
};

// ── STEP 4: Notify NBFC of all confirmed pledges ──────────────
const notifyNBFCOfCollateral = async (userId, pledgeIds) => {
  const axios = require('axios');

  // Get all confirmed pledges
  const pledges = await query(`
    SELECT p.*, mh.scheme_type, mh.ltv_cap
    FROM pledges p
    JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
    WHERE p.pledge_id = ANY($1) AND p.status = 'ACTIVE'
  `, [pledgeIds]);

  const totalCollateralValue = pledges.rows.reduce((s, p) => s + parseFloat(p.value_at_pledge), 0);
  const totalEligibleValue   = pledges.rows.reduce((s, p) => s + parseFloat(p.eligible_value_at_pledge), 0);

  const nbfcPayload = {
    customer_id:    userId,
    pledge_records: pledges.rows.map(p => ({
      pledge_ref:   p.pledge_ref_number,
      folio:        p.folio_number,
      isin:         p.isin,
      rta:          p.rta,
      units:        p.units_pledged,
      value:        p.value_at_pledge,
      eligible:     p.eligible_value_at_pledge,
      ltv_cap:      p.ltv_cap,
      scheme_type:  p.scheme_type,
    })),
    total_collateral_value: Math.round(totalCollateralValue),
    total_eligible_value:   Math.round(totalEligibleValue),
  };

  const mode = process.env.NBFC_MODE || 'mock';
  let collateralId;

  if (mode === 'real') {
    const r = await axios.post(
      `${process.env.NBFC_API_URL}/collateral/register`,
      nbfcPayload,
      { headers: { Authorization: `Bearer ${process.env.NBFC_API_KEY}` }, timeout: 15000 }
    );
    collateralId = r.data.collateral_id;
  } else {
    collateralId = `NBFC_COL_${Date.now()}`;
    logger.info('🏦 [NBFC MOCK] Collateral registered', { collateral_id: collateralId, total_eligible: totalEligibleValue });
  }

  // Update all pledges with NBFC collateral reference
  await query(`
    UPDATE pledges SET nbfc_collateral_id = $1, nbfc_confirmed_at = NOW()
    WHERE pledge_id = ANY($2)
  `, [collateralId, pledgeIds]);

  // FIX: Recalculate credit limit from ALL active pledges
  const allPledged = await query(`
    SELECT COALESCE(SUM(eligible_value_at_pledge), 0) as total_eligible
    FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'
  `, [userId]);
  const newLimit = Math.round(parseFloat(allPledged.rows[0]?.total_eligible || 0));

  // Update credit_accounts with new limit
  const accountUpdate = await query(`
    UPDATE credit_accounts
    SET credit_limit = $2,
        available_credit = $2 - COALESCE(outstanding, 0),
        updated_at = NOW()
    WHERE user_id = $1 AND status = 'ACTIVE'
    RETURNING credit_limit, available_credit, outstanding
  `, [userId, newLimit]);

  if (accountUpdate.rows.length) {
    logger.info('💰 Credit limit recalculated after pledge', {
      user_id: userId,
      new_limit: newLimit,
      outstanding: accountUpdate.rows[0].outstanding,
      available: accountUpdate.rows[0].available_credit,
    });
  }

  return { collateral_id: collateralId, total_eligible_value: Math.round(totalEligibleValue), new_credit_limit: newLimit };
};

// ── RELEASE PLEDGES (on account closure) ─────────────────────
const releasePledges = async (userId) => {
  const pledges = await query(
    "SELECT * FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'",
    [userId]
  );

  const released = [];
  for (const pledge of pledges.rows) {
    let releaseResult;
    if (pledge.rta === 'CAMS') {
      releaseResult = await camsService.releasePledge(pledge.pledge_ref_number, userId);
    } else {
      releaseResult = await kftService.releasePledge(pledge.pledge_ref_number, userId);
    }

    await query(`
      UPDATE pledges SET status = 'RELEASED', released_at = NOW(), release_ref = $2
      WHERE pledge_id = $1
    `, [pledge.pledge_id, releaseResult.release_ref]);

    released.push({ pledge_id: pledge.pledge_id, release_ref: releaseResult.release_ref });
  }

  audit('PLEDGES_RELEASED', userId, { count: released.length });
  return released;
};

// ── INVOKE PLEDGES (on default) ───────────────────────────────
const invokePledgeForDefault = async (userId, pledgeId, outstanding) => {
  const pledgeRes = await query(
    'SELECT * FROM pledges WHERE pledge_id = $1 AND user_id = $2',
    [pledgeId, userId]
  );
  if (!pledgeRes.rows.length) throw { statusCode: 404, message: 'Pledge not found.' };
  const pledge = pledgeRes.rows[0];

  // Calculate units to redeem to cover outstanding
  const currentNav   = pledge.nav_at_pledge; // Use latest nav in production
  const unitsNeeded  = Math.ceil((outstanding * 1.05) / currentNav); // 5% buffer
  const unitsToRedeem = Math.min(unitsNeeded, pledge.units_pledged);

  // Log invocation record
  const invRes = await query(`
    INSERT INTO pledge_invocations (
      pledge_id, user_id, invoked_at,
      units_to_redeem, nav_at_invocation, expected_proceeds,
      outstanding_at_invocation, status
    ) VALUES ($1,$2,NOW(),$3,$4,$5,$6,'INVOKED')
    RETURNING invocation_id
  `, [
    pledgeId, userId,
    unitsToRedeem, currentNav,
    unitsToRedeem * currentNav,
    outstanding,
  ]);

  // Call RTA to invoke
  let rtaResult;
  const collectionAccount = process.env.NBFC_COLLECTION_ACCOUNT || 'NBFC_NODAL_ACCOUNT';
  if (pledge.rta === 'CAMS') {
    rtaResult = await camsService.invokePledge(pledge.pledge_ref_number, unitsToRedeem, collectionAccount, userId);
  } else {
    rtaResult = await kftService.invokePledge(pledge.pledge_ref_number, unitsToRedeem, collectionAccount, userId);
  }

  // Update records
  await query(`
    UPDATE pledge_invocations SET redemption_ref = $2, status = 'REDEEMED'
    WHERE invocation_id = $1
  `, [invRes.rows[0].invocation_id, rtaResult.redemption_ref]);

  await query(`
    UPDATE pledges SET status = 'INVOKED' WHERE pledge_id = $1
  `, [pledgeId]);

  audit('PLEDGE_INVOKED', userId, {
    pledge_id:       pledgeId,
    units_redeemed:  unitsToRedeem,
    expected_amount: unitsToRedeem * currentNav,
  });

  return {
    invocation_id:    invRes.rows[0].invocation_id,
    redemption_ref:   rtaResult.redemption_ref,
    units_redeemed:   unitsToRedeem,
    expected_proceeds: Math.round(unitsToRedeem * currentNav),
  };
};

// ── GET PLEDGE STATUS ─────────────────────────────────────────
const getPledgeStatus = async (userId) => {
  const result = await query(`
    SELECT pledge_id, folio_number, scheme_name, rta,
           units_pledged, nav_at_pledge, value_at_pledge,
           eligible_value_at_pledge, pledge_ref_number,
           status, registered_at
    FROM pledges
    WHERE user_id = $1
    ORDER BY initiated_at DESC
  `, [userId]);

  return result.rows;
};

module.exports = {
  validatePledgeSelection,
  initiatePledges,
  confirmPledgeOTP,
  notifyNBFCOfCollateral,
  releasePledges,
  invokePledgeForDefault,
  getPledgeStatus,
};
