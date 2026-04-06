const axios  = require('axios');
const { query }  = require('../../config/database');
const { generateKFS } = require('./kfs.generator');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// CREDIT LINE SERVICE
//
// BUG FIX: Pledge Amount Mismatch
//   Problem: KFS showed ₹22.17L but dashboard showed ₹19.66L
//   Root cause: Two different calculations were used:
//     1. `requestSanction` used pledgedLimit from DB
//     2. `activateCreditLine` recalculated from risk_decisions
//   The numbers diverged because risk_decisions uses eligible_value
//   from mf_holdings (which includes drawdown) while the pledge
//   table stores eligible_value_at_pledge (which may differ).
//
//   FIX: Store the sanctioned_limit explicitly in credit_accounts
//   when KFS is accepted. activateCreditLine uses THAT value only.
//   Single source of truth = the number the user saw and accepted.
//
// APR PRODUCTS (two options — user chooses at onboarding):
//   STANDARD (12% APR):
//     - 30 days interest-free from each transaction
//     - Pay back within 30 days = 0% interest
//     - After 30 days: 12% p.a. on outstanding amount
//     - Designed for users who will repay regularly
//
//   INTEREST_ONLY (18% APR):
//     - No interest-free period
//     - Pay interest monthly, principal whenever you want
//     - Designed for users who want revolving credit with no repayment pressure
//     - Higher APR compensates NBFC for longer holding period
// ─────────────────────────────────────────────────────────────

// ── CALCULATE LIMIT FROM PLEDGED FUNDS (single source of truth) ──
const calculatePledgedLimit = async (userId) => {
  const result = await query(`
    SELECT COALESCE(SUM(eligible_value_at_pledge), 0) as total
    FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'
  `, [userId]);
  return Math.round(parseFloat(result.rows[0]?.total || 0));
};

// ── STEP 1: REQUEST SANCTION ──────────────────────────────────
const requestSanction = async (userId) => {
  const riskRes = await query(`
    SELECT * FROM risk_decisions
    WHERE user_id = $1 AND decision = 'APPROVED'
    ORDER BY decided_at DESC LIMIT 1
  `, [userId]);

  if (!riskRes.rows.length) {
    throw { statusCode: 400, message: 'No approved risk decision. Please complete portfolio assessment.' };
  }

  const risk = riskRes.rows[0];
  const userRes = await query(`SELECT full_name, pan_last4, ckyc_id, date_of_birth FROM users WHERE user_id = $1`, [userId]);
  const user = userRes.rows[0];

  const collateralRes = await query(`
    SELECT COUNT(*) as pledge_count, COALESCE(SUM(eligible_value_at_pledge),0) as total_collateral
    FROM pledges WHERE user_id = $1 AND status = 'ACTIVE'
  `, [userId]);
  const collateral = collateralRes.rows[0];

  // Use pledgedLimit as the definitive limit — this is what user actually pledged
  const pledgedLimit = await calculatePledgedLimit(userId);

  if (pledgedLimit === 0) {
    throw { statusCode: 400, message: 'No active pledges found. Please pledge funds first.' };
  }

  const actualLimit = pledgedLimit;

  // Get APR product choice (set during onboarding)
  const aprProductRes = await query(
    `SELECT apr_product_choice FROM users WHERE user_id = $1`,
    [userId]
  ).catch(() => ({ rows: [{}] }));

  const aprProduct = aprProductRes.rows[0]?.apr_product_choice || 'STANDARD';
  const apr = aprProduct === 'INTEREST_ONLY' ? 18.00 : 12.00;

  const sanctionPayload = {
    customer_id:      userId,
    full_name:        user.full_name,
    risk_decision_id: risk.decision_id,
    approved_limit:   actualLimit,
    risk_tier:        risk.risk_tier,
    apr,
    apr_product:      aprProduct,
    collateral_value: Math.round(parseFloat(collateral.total_collateral)),
    credit_line_type: 'CLOU',
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
      sanctioned_limit: r.data.sanctioned_limit || actualLimit,
      apr:              r.data.apr || apr,
      apr_product:      aprProduct,
    };
  } else {
    sanctionResult = {
      sanction_id:      `NBFC_SANCTION_${Date.now()}`,
      sanctioned_limit: actualLimit,
      apr,
      apr_product:      aprProduct,
    };
    logger.info('🏦 [NBFC MOCK] Sanction approved', sanctionResult);
  }

  // Store sanction so activateCreditLine can use the EXACT same limit
  await query(`
    INSERT INTO sanctions (user_id, sanction_id, sanctioned_limit, apr, apr_product, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (sanction_id) DO NOTHING
  `, [userId, sanctionResult.sanction_id, sanctionResult.sanctioned_limit, apr, aprProduct])
  .catch(async () => {
    // If sanctions table doesn't exist, store in users table temporarily
    await query(`UPDATE users SET last_sanction_limit=$2, last_sanction_id=$3 WHERE user_id=$1`,
      [userId, sanctionResult.sanctioned_limit, sanctionResult.sanction_id]).catch(()=>{});
  });

  audit('CREDIT_SANCTIONED', userId, {
    sanction_id: sanctionResult.sanction_id,
    limit:       sanctionResult.sanctioned_limit,
    apr,
    apr_product: aprProduct,
  });

  return sanctionResult;
};

// ── STEP 2: GENERATE KFS ──────────────────────────────────────
const getKFS = async (userId, sanctionData) => {
  const kfsBuffer  = await generateKFS(userId, sanctionData);
  const kfsVersion = process.env.KFS_VERSION || 'v1.0';
  return { kfs_base64: kfsBuffer.toString('base64'), kfs_version: kfsVersion };
};

// ── STEP 3: ACCEPT KFS ───────────────────────────────────────
const acceptKFS = async (userId, sanctionId, kfsVersion) => {
  const { logConsent, CONSENT_TYPES } = require('../kyc/consent.service');
  await logConsent({ userId, consentType: CONSENT_TYPES.KFS_ACCEPTANCE, kfsVersion,
    metadata: { sanction_id: sanctionId } });

  const coolingOffExpires = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  // FIX: Retrieve the sanctioned_limit from the sanctions table
  // This ensures activateCreditLine uses the SAME value the user saw in KFS
  const sanctionRes = await query(
    `SELECT sanctioned_limit, apr, apr_product FROM sanctions WHERE sanction_id=$1 LIMIT 1`,
    [sanctionId]
  ).catch(() => ({ rows: [] }));

  // Fallback: calculate from pledges if sanctions table not available
  const sanctionedLimit = sanctionRes.rows[0]?.sanctioned_limit
    || await calculatePledgedLimit(userId);
  const apr        = sanctionRes.rows[0]?.apr || 12.00;
  const aprProduct = sanctionRes.rows[0]?.apr_product || 'STANDARD';

  const accountRes = await query(`
    INSERT INTO credit_accounts
      (user_id, nbfc_sanction_id, credit_limit, available_credit, outstanding,
       apr, apr_product, kfs_version, kfs_accepted_at,
       cooling_off_expires_at, status, sanctioned_at, free_period_days)
    VALUES ($1,$2,$3,$3,0,$4,$5,$6,NOW(),$7,'COOLING_OFF',NOW(),$8)
    ON CONFLICT (user_id) DO UPDATE SET
      nbfc_sanction_id       = EXCLUDED.nbfc_sanction_id,
      credit_limit           = EXCLUDED.credit_limit,
      available_credit       = EXCLUDED.credit_limit,
      apr                    = EXCLUDED.apr,
      apr_product            = EXCLUDED.apr_product,
      kfs_version            = EXCLUDED.kfs_version,
      kfs_accepted_at        = NOW(),
      cooling_off_expires_at = EXCLUDED.cooling_off_expires_at,
      status                 = 'COOLING_OFF',
      free_period_days       = EXCLUDED.free_period_days,
      updated_at             = NOW()
    RETURNING account_id, credit_limit
  `, [
    userId, sanctionId, sanctionedLimit,
    apr, aprProduct, kfsVersion, coolingOffExpires,
    aprProduct === 'INTEREST_ONLY' ? 0 : 30,
  ]);

  logger.info(`✅ KFS accepted — credit limit locked at ₹${sanctionedLimit.toLocaleString('en-IN')}`);

  return {
    account_id:          accountRes.rows[0].account_id,
    credit_limit_locked: accountRes.rows[0].credit_limit,
    cooling_off_expires: coolingOffExpires.toISOString(),
    message:             'KFS accepted. 3-day cooling-off started.',
  };
};

// ── STEP 4: ACTIVATE CREDIT LINE ──────────────────────────────
const activateCreditLine = async (userId) => {
  const accountRes = await query(
    `SELECT * FROM credit_accounts WHERE user_id=$1 AND status='COOLING_OFF'`,
    [userId]
  );

  if (!accountRes.rows.length) {
    throw { statusCode: 400, message: 'No credit account in cooling-off found.' };
  }
  const account = accountRes.rows[0];

  // FIX: Use the credit_limit that was already locked in during KFS acceptance
  // This is the SAME value shown on the KFS — no recalculation
  const activationLimit = parseFloat(account.credit_limit);

  if (!activationLimit || activationLimit <= 0) {
    throw { statusCode: 400, message: 'Invalid credit limit. Please restart the credit activation process.' };
  }

  const vpa = `lp${Date.now().toString().slice(-8)}@lienpay`;

  await query(`
    UPDATE credit_accounts SET
      credit_limit     = $2,
      available_credit = $2,
      outstanding      = 0,
      status           = 'ACTIVE',
      upi_vpa          = $3,
      upi_active       = true,
      psp_bank         = 'LienPay PSP',
      activated_at     = NOW(),
      updated_at       = NOW()
    WHERE user_id = $1
  `, [userId, activationLimit, vpa]);

  await query(`
    UPDATE users SET
      onboarding_step = 'ACTIVE',
      account_status  = 'CREDIT_ACTIVE',
      updated_at      = NOW()
    WHERE user_id = $1
  `, [userId]);

  audit('CREDIT_ACTIVATED', userId, {
    limit:       activationLimit,
    apr:         account.apr,
    apr_product: account.apr_product,
    vpa,
  });

  logger.info(`💳 Credit line activated for user ${userId}: ₹${activationLimit.toLocaleString('en-IN')} @ ${account.apr}% (${account.apr_product})`);

  return {
    message:         'Credit line is live!',
    credit_limit:    activationLimit,
    available_credit: activationLimit,
    upi_vpa:         vpa,
    apr:             account.apr,
    apr_product:     account.apr_product,
    free_period_days: account.free_period_days || 30,
  };
};

// ── GET STATUS ────────────────────────────────────────────────
const getCreditStatus = async (userId) => {
  const result = await query(`
    SELECT ca.*, u.full_name, u.mobile
    FROM credit_accounts ca
    JOIN users u ON u.user_id = ca.user_id
    WHERE ca.user_id = $1
    LIMIT 1
  `, [userId]);
  return result.rows[0] || null;
};

// ── CANCEL DURING COOLING OFF ────────────────────────────────
const cancelDuringCoolingOff = async (userId) => {
  const accountRes = await query(
    `SELECT * FROM credit_accounts WHERE user_id=$1 AND status='COOLING_OFF'`,
    [userId]
  );
  if (!accountRes.rows.length) {
    throw { statusCode: 400, message: 'No account in cooling-off period found.' };
  }

  await query(`UPDATE credit_accounts SET status='CANCELLED', updated_at=NOW() WHERE user_id=$1`, [userId]);
  await query(`UPDATE users SET onboarding_step='PLEDGE_CONFIRMED', account_status='PLEDGE_DONE', updated_at=NOW() WHERE user_id=$1`, [userId]);

  audit('CREDIT_CANCELLED_COOLING_OFF', userId, {});

  return { message: 'Credit line cancelled during cooling-off period. No charges applied.' };
};

module.exports = {
  requestSanction,
  getKFS,
  acceptKFS,
  activateCreditLine,
  getCreditStatus,
  cancelDuringCoolingOff,
};
