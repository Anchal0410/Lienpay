const axios = require('axios');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// KFINTECH PLEDGE SERVICE
// Mode: KFINTECH_MODE=mock | real
// Real: KFintech API partnership
// Apply: api.support@kfintech.com (4-6 weeks)
// Same flow as CAMS but separate RTA
// ─────────────────────────────────────────────────────────────

const mockInitiatePledge = async (pledgeData) => {
  await new Promise(r => setTimeout(r, 600));
  const pledgeReqId = `KFT_REQ_${Date.now()}_${Math.random().toString(36).slice(2).toUpperCase()}`;

  console.log('\n' + '─'.repeat(50));
  console.log(`📋 KFINTECH MOCK: Pledge initiated`);
  console.log(`   Folio: ${pledgeData.folio_number}`);
  console.log(`   Units: ${pledgeData.units_to_pledge}`);
  console.log(`   Request ID: ${pledgeReqId}`);
  console.log('─'.repeat(50) + '\n');

  return { success: true, pledge_req_id: pledgeReqId, status: 'OTP_PENDING', mock: true };
};

const mockConfirmPledge = async (pledgeReqId, otp) => {
  await new Promise(r => setTimeout(r, 500));
  // KFintech mock OTP is always 654321
  if (otp !== '654321') {
    throw { statusCode: 400, message: 'Invalid KFintech OTP. Please try again.' };
  }
  const pledgeRef = `KFT-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  return { success: true, pledge_ref_number: pledgeRef, status: 'ACTIVE', registration_date: new Date().toISOString(), mock: true };
};

const realInitiatePledge = async (pledgeData) => {
  try {
    const response = await axios.post(
      `${process.env.KFINTECH_API_URL}/pledge/initiate`,
      {
        folio_number: pledgeData.folio_number,
        isin:         pledgeData.isin,
        units:        pledgeData.units_to_pledge,
        pledgee_name: pledgeData.pledgee_name,
        pledgee_pan:  pledgeData.pledgee_pan,
        lsp_ref:      pledgeData.lsp_pledge_id,
      },
      {
        headers: { 'x-api-key': process.env.KFINTECH_API_KEY, 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );
    return { success: true, pledge_req_id: response.data.request_id, status: 'OTP_PENDING' };
  } catch (err) {
    logger.error('KFintech pledge initiation failed:', err.message);
    throw new Error(`KFintech pledge failed: ${err.message}`);
  }
};

const realConfirmPledge = async (pledgeReqId, otp) => {
  try {
    const response = await axios.post(
      `${process.env.KFINTECH_API_URL}/pledge/confirm`,
      { request_id: pledgeReqId, otp },
      { headers: { 'x-api-key': process.env.KFINTECH_API_KEY }, timeout: 15000 }
    );
    return { success: true, pledge_ref_number: response.data.pledge_ref, status: 'ACTIVE', registration_date: response.data.date };
  } catch (err) {
    if (err.response?.status === 400) throw { statusCode: 400, message: 'Invalid KFintech OTP.' };
    throw new Error(`KFintech confirmation failed: ${err.message}`);
  }
};

// Public functions
const initiatePledge = async (pledgeData) => {
  const mode = process.env.KFINTECH_MODE || 'mock';
  return mode === 'real' ? await realInitiatePledge(pledgeData) : await mockInitiatePledge(pledgeData);
};

const confirmPledge = async (pledgeReqId, otp, userId) => {
  const mode = process.env.KFINTECH_MODE || 'mock';
  const result = mode === 'real' ? await realConfirmPledge(pledgeReqId, otp) : await mockConfirmPledge(pledgeReqId, otp);
  audit('KFT_PLEDGE_CONFIRMED', userId, { pledge_ref: result.pledge_ref_number, mode });
  return result;
};

const releasePledge = async (pledgeRefNumber, userId) => {
  if ((process.env.KFINTECH_MODE || 'mock') === 'mock') {
    return { success: true, release_ref: `KFT_REL_${Date.now()}` };
  }
  try {
    const r = await axios.post(
      `${process.env.KFINTECH_API_URL}/pledge/release`,
      { pledge_ref: pledgeRefNumber },
      { headers: { 'x-api-key': process.env.KFINTECH_API_KEY } }
    );
    return { success: true, release_ref: r.data.release_ref };
  } catch (err) { throw new Error(`KFT release failed: ${err.message}`); }
};

const invokePledge = async (pledgeRefNumber, unitsToRedeem, collectionAccount, userId) => {
  audit('KFT_PLEDGE_INVOKED', userId, { pledge_ref: pledgeRefNumber });
  if ((process.env.KFINTECH_MODE || 'mock') === 'mock') {
    return { success: true, redemption_ref: `KFT_REDEEM_${Date.now()}` };
  }
  try {
    const r = await axios.post(
      `${process.env.KFINTECH_API_URL}/pledge/invoke`,
      { pledge_ref: pledgeRefNumber, units: unitsToRedeem, collection_account: collectionAccount },
      { headers: { 'x-api-key': process.env.KFINTECH_API_KEY } }
    );
    return { success: true, redemption_ref: r.data.redemption_ref };
  } catch (err) { throw new Error(`KFT invocation failed: ${err.message}`); }
};

module.exports = { initiatePledge, confirmPledge, releasePledge, invokePledge };
