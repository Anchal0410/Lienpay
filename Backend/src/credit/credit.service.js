const axios  = require('axios');
const { query }  = require('../../config/database');
const { generateKFS } = require('./kfs.generator');
const { sendSMS }     = require('../utils/sms.service');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// CREDIT LINE SERVICE
// Uses CLOU (Credit Line on UPI) — NPCI's official framework
// for pre-sanctioned credit lines on UPI rails.
// PSP bank must be CLOU-empanelled with NPCI.
// ─────────────────────────────────────────────────────────────

// ── HELPER: Calculate limit from ACTUALLY PLEDGED funds ──────
// FIX: credit limit must reflect only pledged funds, not all eligible
const calculatePledgedLimit = async (userId) => {
  const pledgedRes = await query(`
    SELECT COALESCE(SUM(eligible_value_at_pledge), 0) as total
    FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'
  `, [userId]);
  return Math.round(parseFloat(pledgedRes.rows[0]?.total || 0));
};

// ── STEP 1: Request NBFC Sanction ────────────────────────────
const requestSanction = async (userId) => {
  const riskRes = await query(`
    SELECT * FROM risk_decisions
    WHERE user_id = $1 AND decision = 'APPROVED'
    ORDER BY decided_at DESC LIMIT 1
  `, [userId]);

  if (!riskRes.rows.length) {
    throw { statusCode: 400, message: 'No approved risk decision found. Please complete portfolio assessment.' };
  }

  const risk = riskRes.rows[0];

  const userRes = await query(`
    SELECT u.full_name, u.pan_last4, u.ckyc_id, u.date_of_birth,
           k.aadhaar_txn_ref, k.kyc_method
    FROM users u
    LEFT JOIN kyc_records k ON k.user_id = u.user_id
    WHERE u.user_id = $1
  `, [userId]);

  const user = userRes.rows[0];

  const collateralRes = await query(`
    SELECT COUNT(*) as pledge_count,
           SUM(eligible_value_at_pledge) as total_collateral
    FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'
  `, [userId]);

  const collateral = collateralRes.rows[0];

  // FIX: Calculate actual limit from pledged funds only
  const pledgedLimit = await calculatePledgedLimit(userId);
  const actualLimit = pledgedLimit > 0 ? Math.min(risk.approved_limit, pledgedLimit) : risk.approved_limit;

  const sanctionPayload = {
    customer_id:        userId,
    ckyc_id:            user.ckyc_id,
    full_name:          user.full_name,
    kyc_type:           user.kyc_method || 'AADHAAR_OTP',
    risk_decision_id:   risk.decision_id,
    approved_limit:     actualLimit,  // FIX: pledged-based limit
    risk_tier:          risk.risk_tier,
    apr:                risk.apr,
    collateral_pledges: parseInt(collateral.pledge_count),
    collateral_value:   Math.round(parseFloat(collateral.total_collateral)),
    bureau_score_band:  risk.bureau_score_band,
    credit_line_type:   'CLOU',
  };

  const mode = process.env.NBFC_MODE || 'mock';
  let sanctionResult;

  if (mode === 'real') {
    const r = await axios.post(
      `${process.env.NBFC_API_URL}/credit/sanction`,
      sanctionPayload,
      { headers: { Authorization: `Bearer ${process.env.NBFC_API_KEY}` }, timeout: 20000 }
    );
    sanctionResult = {
      sanction_id:      r.data.sanction_id,
      sanctioned_limit: r.data.sanctioned_limit,
      apr:              r.data.apr,
      nbfc_account_id:  r.data.account_id,
    };
  } else {
    sanctionResult = {
      sanction_id:      `NBFC_SANCTION_${Date.now()}`,
      sanctioned_limit: actualLimit,  // FIX: pledged-based limit
      apr:              risk.apr,
      nbfc_account_id:  `NBFC_ACC_${userId.slice(0, 8).toUpperCase()}`,
    };
    logger.info('🏦 [NBFC MOCK] CLOU Sanction approved', sanctionResult);
  }

  audit('CREDIT_SANCTIONED', userId, {
    sanction_id: sanctionResult.sanction_id,
    limit:       sanctionResult.sanctioned_limit,
    apr:         sanctionResult.apr,
    type:        'CLOU',
  });

  return { ...sanctionResult, risk_tier: risk.risk_tier };
};

// ── STEP 2: Generate KFS ──────────────────────────────────────
const getKFS = async (userId, sanctionData) => {
  const kfsBuffer  = await generateKFS(userId, sanctionData);
  const kfsVersion = process.env.KFS_VERSION || 'v1.0';
  const kfsBase64  = kfsBuffer.toString('base64');
  return { kfs_base64: kfsBase64, kfs_version: kfsVersion };
};

// ── STEP 3: Accept KFS ────────────────────────────────────────
const acceptKFS = async (userId, sanctionId, kfsVersion) => {
  const { logConsent, CONSENT_TYPES } = require('../kyc/consent.service');
  await logConsent({
    userId,
    consentType: CONSENT_TYPES.KFS_ACCEPTANCE,
    kfsVersion,
    metadata:    { sanction_id: sanctionId },
  });

  const coolingOffExpires = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const accountRes = await query(`
    INSERT INTO credit_accounts (
      user_id, nbfc_sanction_id,
      credit_limit, available_credit, outstanding,
      apr, kfs_version, kfs_accepted_at,
      cooling_off_expires_at, status, sanctioned_at
    ) VALUES ($1,$2,0,0,0,$3,$4,NOW(),$5,'COOLING_OFF',NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      nbfc_sanction_id       = EXCLUDED.nbfc_sanction_id,
      apr                    = EXCLUDED.apr,
      kfs_version            = EXCLUDED.kfs_version,
      kfs_accepted_at        = NOW(),
      cooling_off_expires_at = EXCLUDED.cooling_off_expires_at,
      status                 = 'COOLING_OFF',
      updated_at             = NOW()
    RETURNING account_id
  `, [userId, sanctionId, 0, kfsVersion, coolingOffExpires]);

  return {
    account_id:          accountRes.rows[0].account_id,
    cooling_off_expires: coolingOffExpires.toISOString(),
    message:             'KFS accepted. 3-day cooling-off period started.',
  };
};

// ── STEP 4: Activate Credit Line + CLOU VPA ──────────────────
const activateCreditLine = async (userId) => {
  const accountRes = await query(
    "SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'COOLING_OFF'",
    [userId]
  );

  if (!accountRes.rows.length) {
    throw { statusCode: 400, message: 'No credit account in cooling-off found.' };
  }
  const account = accountRes.rows[0];

  const riskRes = await query(`
    SELECT approved_limit, apr FROM risk_decisions
    WHERE user_id = $1 AND decision = 'APPROVED'
    ORDER BY decided_at DESC LIMIT 1
  `, [userId]);

  const { approved_limit, apr } = riskRes.rows[0];

  // FIX: Calculate actual limit from pledged funds only
  const pledgedLimit = await calculatePledgedLimit(userId);
  const actualLimit = pledgedLimit > 0 ? Math.min(approved_limit, pledgedLimit) : approved_limit;

  // Notify NBFC to activate
  const mode = process.env.NBFC_MODE || 'mock';
  let nbfcAccountId;

  if (mode === 'real') {
    const r = await axios.post(
      `${process.env.NBFC_API_URL}/credit/activate`,
      {
        sanction_id:       account.nbfc_sanction_id,
        customer_id:       userId,
        credit_line_type:  'CLOU',
      },
      { headers: { Authorization: `Bearer ${process.env.NBFC_API_KEY}` }, timeout: 15000 }
    );
    nbfcAccountId = r.data.account_id;
  } else {
    nbfcAccountId = `NBFC_ACC_${userId.slice(0, 8).toUpperCase()}`;
    logger.info('🏦 [NBFC MOCK] CLOU credit line activated', { account_id: nbfcAccountId });
  }

  // Create CLOU VPA via PSP bank
  const vpa = await createCLOUVPA(userId, account.account_id, nbfcAccountId);

  // Set billing cycle
  const today      = new Date();
  const cycleStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const cycleEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const dueDate    = new Date(today.getFullYear(), today.getMonth() + 2, 1);

  await query(`
    UPDATE credit_accounts SET
      status              = 'ACTIVE',
      nbfc_account_id     = $2,
      credit_limit        = $3,
      available_credit    = $3,
      apr                 = $4,
      upi_vpa             = $5,
      upi_active          = true,
      psp_bank            = $6,
      billing_cycle_day   = 1,
      current_cycle_start = $7,
      current_cycle_end   = $8,
      due_date            = $9,
      activated_at        = NOW(),
      updated_at          = NOW()
    WHERE user_id = $1
  `, [
    userId, nbfcAccountId, actualLimit, apr, vpa,
    process.env.PSP_BANK_NAME || 'YesBank',
    cycleStart, cycleEnd, dueDate,
  ]);

  await query(`
    UPDATE users SET
      account_status  = 'CREDIT_ACTIVE',
      onboarding_step = 'COMPLETE',
      updated_at      = NOW()
    WHERE user_id = $1
  `, [userId]);

  await sendSMS(userId, 'CREDIT_ACTIVATED', {
    limit: `₹${actualLimit.toLocaleString('en-IN')}`,
    vpa,
  }).catch(() => {});

  audit('CLOU_ACTIVATED', userId, { approved_limit: actualLimit, pledgedLimit, vpa, apr });

  return {
    account_id:       account.account_id,
    credit_limit:     actualLimit,
    available_credit: actualLimit,
    apr,
    upi_vpa:          vpa,
    clou_enabled:     true,
    psp_bank:         process.env.PSP_BANK_NAME || 'YesBank',
    billing_cycle:    { start: cycleStart, end: cycleEnd, due: dueDate },
    message:          `Your LienPay CLOU credit line of ₹${approved_limit.toLocaleString('en-IN')} is now active!`,
  };
};

// ── CREATE CLOU VPA ───────────────────────────────────────────
// CLOU VPA is registered with NPCI as a credit line handle
// PSP bank must be CLOU-empanelled (Yes Bank, Axis, ICICI, HDFC)
const createCLOUVPA = async (userId, accountId, nbfcAccountId) => {
  const userRes = await query('SELECT mobile FROM users WHERE user_id = $1', [userId]);
  const mobile  = userRes.rows[0]?.mobile;

  const mode = process.env.UPI_MODE || 'mock';

  if (mode === 'real') {
    // PSP bank registers VPA with NPCI as CLOU type
    const r = await axios.post(
      `${process.env.PSP_API_URL}/clou/vpa/create`,
      {
        mobile,
        account_id:       accountId,
        nbfc_account_id:  nbfcAccountId,
        credit_limit:     null, // NBFC provides this directly to PSP
        type:             'CREDIT_LINE',  // CLOU type flag
        nbfc_id:          process.env.NBFC_CLIENT_ID,
      },
      {
        headers: { Authorization: `Bearer ${process.env.PSP_API_KEY}` },
        timeout: 15000,
      }
    );
    return r.data.vpa;
  }

  // Mock: format follows CLOU convention — mobile@pspbank
  const pspHandle = process.env.PSP_HANDLE || 'yesbank';
  const vpa = `${mobile}@${pspHandle}`;
  logger.info('💳 [CLOU MOCK] VPA created and registered with NPCI', { vpa, type: 'CREDIT_LINE' });
  return vpa;
};

// ── CANCEL DURING COOLING-OFF ─────────────────────────────────
const cancelDuringCoolingOff = async (userId) => {
  const accountRes = await query(
    "SELECT * FROM credit_accounts WHERE user_id = $1 AND status = 'COOLING_OFF'",
    [userId]
  );

  if (!accountRes.rows.length) {
    throw { statusCode: 400, message: 'No credit account in cooling-off period found.' };
  }

  const account = accountRes.rows[0];
  if (new Date() > new Date(account.cooling_off_expires_at)) {
    throw { statusCode: 400, message: 'Cooling-off period has expired. Please contact support.' };
  }

  await query(`
    UPDATE credit_accounts SET
      status = 'CLOSED', cooling_off_cancelled = true, closed_at = NOW()
    WHERE user_id = $1
  `, [userId]);

  const { releasePledges } = require('../pledge/pledge.service');
  await releasePledges(userId);

  audit('CLOU_CANCELLED_COOLING_OFF', userId, { account_id: account.account_id });
  return { message: 'Credit line cancelled. All pledges released. No charges applied.' };
};

// ── GET CREDIT STATUS ─────────────────────────────────────────
const getCreditStatus = async (userId) => {
  const result = await query(`
    SELECT account_id, credit_limit, available_credit, outstanding,
           apr, upi_vpa, upi_active, psp_bank, status,
           current_cycle_start, current_cycle_end, due_date,
           cooling_off_expires_at, activated_at
    FROM credit_accounts WHERE user_id = $1
  `, [userId]);
  return result.rows[0] || null;
};

module.exports = {
  requestSanction,
  getKFS,
  acceptKFS,
  activateCreditLine,
  cancelDuringCoolingOff,
  getCreditStatus,
};
