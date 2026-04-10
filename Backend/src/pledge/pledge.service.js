const { query }  = require('../../config/database');
const { logger, audit } = require('../../config/logger');
const { checkPledgeForNotoriousFunds } = require('../portfolio/notorious.service');

// ─────────────────────────────────────────────────────────────
// PLEDGE SERVICE
//
// Manages the lien-marking of mutual fund units as collateral.
//
// IMPORTANT ROLE BOUNDARIES:
//
//  LienPay (LSP):
//    - Fetches folio/unit data from MF Central (data collection)
//    - Provides the UI for user to select funds and confirm OTP
//    - Stores pledge records in DB
//    - Notifies NBFC of collateral via webhook
//    - Checks for notorious funds before accepting pledge
//
//  NBFC (RE):
//    - The lien is registered in NBFC's name at MF Central
//    - NBFC holds the credentials for pledge invocation
//    - Only NBFC can authorize pledge release or invocation
//    - LienPay NEVER calls MF Central/CAMS/KFintech for invocation
//
//  MF Central:
//    - Single API for all RTA operations (replaces separate CAMS/KFintech calls)
//    - Government of India initiative (SEBI-mandated)
//    - Covers CAMS-registered and KFintech-registered folios
//    - ISIN is embedded in every MF Central response — no separate lookup
//
// PLEDGE FLOW:
//   1. User selects folios in LienPay app
//   2. LienPay validates eligibility (fund universe + notorious check)
//   3. LienPay calls MF Central to initiate pledge request
//      (in mock: simulated; in real: NBFC's MF Central credentials used)
//   4. MF Central sends OTP to user's registered mobile
//   5. User confirms OTP in LienPay app
//   6. LienPay calls MF Central to confirm — pledge registered in NBFC's name
//   7. LienPay stores pledge record + notifies NBFC
// ─────────────────────────────────────────────────────────────

const MF_CENTRAL_MODE = () => process.env.MF_CENTRAL_MODE || process.env.CAMS_MODE || 'mock';

// ── VALIDATE FOLIOS ───────────────────────────────────────────
const validateFolios = async (userId, selectedFolios) => {
  const holdings = await query(`
    SELECT mh.*, nf.is_active as is_notorious
    FROM mf_holdings mh
    LEFT JOIN notorious_funds nf ON nf.isin = mh.isin AND nf.is_active = true
    WHERE mh.user_id = $1 AND mh.folio_number = ANY($2)
  `, [userId, selectedFolios]);

  const results = [];
  let totalEligibleValue = 0;

  for (const holding of holdings.rows) {
    const isEligible = holding.is_eligible === true;

    results.push({
      folio_number:  holding.folio_number,
      scheme_name:   holding.scheme_name,
      isin:          holding.isin,
      scheme_type:   holding.scheme_type,
      rta:           holding.rta || 'MF_CENTRAL',
      value:         parseFloat(holding.value_at_fetch || 0),
      ltv_cap:       parseFloat(holding.ltv_cap || 0.40),
      eligible_value: parseFloat(holding.eligible_value || 0),
      is_eligible:   isEligible,
      is_notorious:  holding.is_notorious === true,
      reason:        !isEligible ? 'Fund not in eligible universe' : (holding.is_notorious ? 'Fund on SEBI watchlist' : null),
    });

    if (isEligible && !holding.is_notorious) {
      totalEligibleValue += parseFloat(holding.eligible_value || 0);
    }
  }

  return { validated_folios: results, total_eligible_value: Math.round(totalEligibleValue) };
};

// ── INITIATE PLEDGE ───────────────────────────────────────────
const initiatePledges = async (userId, selectedFolios) => {
  // Get holdings for selected folios
  const holdingsRes = await query(`
    SELECT mh.*, nf.is_active as is_notorious
    FROM mf_holdings mh
    LEFT JOIN notorious_funds nf ON nf.isin = mh.isin AND nf.is_active = true
    WHERE mh.user_id = $1 AND mh.folio_number = ANY($2) AND mh.is_eligible = true
  `, [userId, selectedFolios.map(f => f.folio_number || f)]);

  if (!holdingsRes.rows.length) {
    throw { statusCode: 400, message: 'No eligible funds found for the selected folios.' };
  }

  // Check for notorious funds — warn but don't hard block (NBFC decides)
  const isins = holdingsRes.rows.map(h => h.isin).filter(Boolean);
  const notoriousCheck = await checkPledgeForNotoriousFunds(
    holdingsRes.rows.map(h => ({ isin: h.isin, folio_number: h.folio_number }))
  );

  const pledges = [];

  for (const holding of holdingsRes.rows) {
    // Calculate units to pledge (all available units)
    const nav           = parseFloat(holding.nav_at_fetch || 0);
    const value         = parseFloat(holding.value_at_fetch || 0);
    const unitsToPledge = nav > 0 ? value / nav : 0;
    const ltvCap        = parseFloat(holding.ltv_cap || 0.40);
    const eligibleValue = Math.round(value * ltvCap);

    // Apply any LTV override from the user's selection
    const override = selectedFolios.find ? selectedFolios.find(f => f.folio_number === holding.folio_number) : null;
    const effectiveLtv = override?.ltv_override || ltvCap;
    const effectiveEligible = Math.round(value * effectiveLtv);

    if (MF_CENTRAL_MODE() === 'real') {
      // Production: call MF Central API to initiate pledge
      // Pledge is registered in NBFC's name using NBFC's MF Central credentials
      try {
        const pledgeRes = await fetch(`${process.env.MF_CENTRAL_API_URL}/pledge/initiate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': process.env.NBFC_MF_CENTRAL_API_KEY || process.env.MF_CENTRAL_API_KEY,
            'X-Client-Id': process.env.NBFC_CLIENT_ID || 'lienpay-nbfc',
          },
          body: JSON.stringify({
            folio_number:    holding.folio_number,
            isin:            holding.isin,
            units_to_pledge: unitsToPledge.toFixed(3),
            pledgee:         process.env.NBFC_NAME || 'FinServNBFC Ltd.',
            pledgee_dp_id:   process.env.NBFC_DP_ID || '',
          }),
        });
        const pledgeData = await pledgeRes.json();

        if (!pledgeData.success) {
          logger.error('MF Central pledge initiation failed:', pledgeData.message);
          continue;
        }

        const pledge = await storePledgeRecord({
          userId, holding, unitsToPledge, nav, value,
          effectiveLtv, effectiveEligible,
          pledgeRefNumber: pledgeData.pledge_reference,
          otpSource:       'MF_CENTRAL',
          status:          'OTP_PENDING',
          isNotorious:     holding.is_notorious,
        });
        pledges.push({ ...pledge, otp_source: 'MF_CENTRAL', is_notorious: holding.is_notorious });

      } catch (err) {
        logger.error('MF Central pledge initiation error:', err.message);
      }
    } else {
      // Mock mode for development
      const pledge = await storePledgeRecord({
        userId, holding, unitsToPledge, nav, value,
        effectiveLtv, effectiveEligible,
        pledgeRefNumber: `MFCPL_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        otpSource:       'MF_CENTRAL',
        status:          'OTP_PENDING',
        isNotorious:     holding.is_notorious,
      });
      pledges.push({ ...pledge, otp_source: 'MF_CENTRAL', is_notorious: holding.is_notorious });
    }
  }

  if (!pledges.length) {
    throw { statusCode: 500, message: 'Could not initiate pledge for any selected fund. Please try again.' };
  }

  return {
    pledges,
    notorious_warning: notoriousCheck.has_notorious ? notoriousCheck.warning : null,
    note: 'OTP sent to your MF-registered mobile via MF Central. Valid for 10 minutes.',
  };
};

// ── STORE PLEDGE RECORD ───────────────────────────────────────
const storePledgeRecord = async ({ userId, holding, unitsToPledge, nav, value,
  effectiveLtv, effectiveEligible, pledgeRefNumber, otpSource, status, isNotorious }) => {

  const res = await query(`
    INSERT INTO pledges (
      user_id, folio_number, isin, scheme_name, rta,
      units_pledged, nav_at_pledge, value_at_pledge,
      ltv_at_pledge, ltv_cap, eligible_value_at_pledge,
      pledge_ref_number, otp_source, status,
      is_notorious_at_pledge, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,$11,$12,$13,$14,NOW())
    ON CONFLICT (user_id, folio_number) WHERE status IN ('OTP_PENDING','ACTIVE')
    DO UPDATE SET
      pledge_ref_number = EXCLUDED.pledge_ref_number,
      status = 'OTP_PENDING',
      updated_at = NOW()
    RETURNING pledge_id
  `, [
    userId, holding.folio_number, holding.isin, holding.scheme_name,
    'MF_CENTRAL',
    unitsToPledge.toFixed(3), nav, value,
    effectiveLtv, effectiveEligible,
    pledgeRefNumber, otpSource, status,
    isNotorious || false,
  ]);

  return {
    pledge_id:    res.rows[0].pledge_id,
    folio_number: holding.folio_number,
    scheme_name:  holding.scheme_name,
    isin:         holding.isin,
    rta:          'MF_CENTRAL',
    units_pledged: parseFloat(unitsToPledge.toFixed(3)),
    eligible_value: effectiveEligible,
    pledge_ref_number: pledgeRefNumber,
    status,
  };
};

// ── CONFIRM OTP ───────────────────────────────────────────────
const confirmPledgeOTP = async (userId, pledgeId, otp) => {
  const pledgeRes = await query(
    `SELECT * FROM pledges WHERE pledge_id = $1 AND user_id = $2`,
    [pledgeId, userId]
  );

  if (!pledgeRes.rows.length) {
    throw { statusCode: 404, message: 'Pledge not found.' };
  }

  const pledge = pledgeRes.rows[0];

  if (pledge.status === 'ACTIVE') {
    return { already_confirmed: true, pledge_id: pledgeId, status: 'ACTIVE' };
  }

  if (pledge.status !== 'OTP_PENDING') {
    throw { statusCode: 400, message: `Pledge cannot be confirmed in status: ${pledge.status}` };
  }

  if (MF_CENTRAL_MODE() === 'real') {
    // Production: confirm OTP with MF Central
    const confirmRes = await fetch(`${process.env.MF_CENTRAL_API_URL}/pledge/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.NBFC_MF_CENTRAL_API_KEY || process.env.MF_CENTRAL_API_KEY,
      },
      body: JSON.stringify({
        pledge_reference: pledge.pledge_ref_number,
        otp,
      }),
    });
    const confirmData = await confirmRes.json();
    if (!confirmData.success) {
      throw { statusCode: 400, message: confirmData.message || 'OTP confirmation failed with MF Central.' };
    }
  } else {
    // Mock: any 6-digit OTP works (MF_CENTRAL_OTP = 123456 by convention)
    if (otp !== '123456' && otp.length !== 6) {
      throw { statusCode: 400, message: 'Invalid OTP. Use 123456 in dev mode.' };
    }
  }

  await query(`
    UPDATE pledges SET status = 'ACTIVE', confirmed_at = NOW(), updated_at = NOW()
    WHERE pledge_id = $1
  `, [pledgeId]);

  audit('PLEDGE_CONFIRMED', userId, {
    pledge_id:     pledgeId,
    folio_number:  pledge.folio_number,
    scheme_name:   pledge.scheme_name,
    eligible_value: pledge.eligible_value_at_pledge,
  });

  return {
    pledge_id:         pledgeId,
    status:            'ACTIVE',
    pledge_ref_number: pledge.pledge_ref_number,
    scheme_name:       pledge.scheme_name,
    eligible_value:    pledge.eligible_value_at_pledge,
  };
};

// ── NOTIFY NBFC ───────────────────────────────────────────────
const notifyNBFCOfCollateral = async (userId, pledgeIds) => {
  const pledgesRes = await query(`
    SELECT p.*, mh.scheme_type, mh.scheme_name
    FROM pledges p
    LEFT JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
    WHERE p.pledge_id = ANY($1) AND p.user_id = $2 AND p.status = 'ACTIVE'
  `, [pledgeIds, userId]);

  const userRes = await query(
    `SELECT full_name, mobile, pan_last4 FROM users WHERE user_id = $1`,
    [userId]
  );

  const totalCollateral = pledgesRes.rows.reduce((sum, p) =>
    sum + parseFloat(p.eligible_value_at_pledge || 0), 0
  );

  const collateralPackage = {
    user_id:          userId,
    user_name:        userRes.rows[0]?.full_name,
    mobile:           userRes.rows[0]?.mobile,
    pan_last4:        userRes.rows[0]?.pan_last4,
    total_collateral: Math.round(totalCollateral),
    pledge_count:     pledgesRes.rows.length,
    pledges:          pledgesRes.rows.map(p => ({
      pledge_id:     p.pledge_id,
      folio_number:  p.folio_number,
      scheme_name:   p.scheme_name,
      isin:          p.isin,
      units_pledged: p.units_pledged,
      nav_at_pledge: p.nav_at_pledge,
      eligible_value: p.eligible_value_at_pledge,
      ltv_cap:       p.ltv_cap,
      rta:           'MF_CENTRAL',
      pledge_ref:    p.pledge_ref_number,
    })),
    timestamp: new Date().toISOString(),
  };

  // Fire webhook to NBFC
  const webhookUrl = process.env.NBFC_WEBHOOK_URL;
  let nbfcRef = `LOCAL_${Date.now()}`;

  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-LienPay-Event': 'pledge.collateral_ready',
          'X-Webhook-Secret': process.env.NBFC_WEBHOOK_SECRET || '',
        },
        body: JSON.stringify({ event: 'pledge.collateral_ready', payload: collateralPackage }),
      });
      const resData = await res.json().catch(() => ({}));
      nbfcRef = resData.nbfc_collateral_id || nbfcRef;
    } catch (_) {
      logger.warn('NBFC collateral webhook failed (non-blocking)');
    }
  } else {
    logger.info('NBFC_WEBHOOK_URL not set — collateral notified locally', { total: totalCollateral });
  }

  audit('NBFC_COLLATERAL_NOTIFIED', userId, {
    pledge_ids:       pledgeIds,
    total_collateral: Math.round(totalCollateral),
    nbfc_ref:         nbfcRef,
  });

  return {
    nbfc_collateral_id: nbfcRef,
    collateral_value:   Math.round(totalCollateral),
    pledge_count:       pledgesRes.rows.length,
  };
};

// ── GET PLEDGE STATUS ─────────────────────────────────────────
const getPledgeStatus = async (userId) => {
  const result = await query(`
    SELECT p.*, mh.scheme_type,
           COALESCE(n.nav_value, p.nav_at_pledge) as current_nav,
           COALESCE(nf.is_active, false) as is_notorious
    FROM pledges p
    LEFT JOIN mf_holdings mh ON mh.folio_number = p.folio_number AND mh.user_id = p.user_id
    LEFT JOIN nav_history n ON n.isin = p.isin AND n.nav_date = CURRENT_DATE
    LEFT JOIN notorious_funds nf ON nf.isin = p.isin AND nf.is_active = true
    WHERE p.user_id = $1
    ORDER BY p.created_at DESC
  `, [userId]);

  return result.rows;
};

module.exports = {
  validateFolios,
  initiatePledges,
  confirmPledgeOTP,
  notifyNBFCOfCollateral,
  getPledgeStatus,
};
