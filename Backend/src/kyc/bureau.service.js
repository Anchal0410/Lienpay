const axios = require('axios');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// BUREAU SERVICE (CIBIL / Experian)
// Mode: BUREAU_MODE=mock | real
// Real access: Via lending partner's bureau membership
//
// IMPORTANT: We use bureau as NEGATIVE FILTER only
// Reject if: active DPD > 90 days, write-off in 3 years,
//            active bankruptcy
// We do NOT use score to set credit limit (that's LTV-based)
// ─────────────────────────────────────────────────────────────

const mockBureauPull = async (pan, name, dob) => {
  await new Promise(r => setTimeout(r, 700));

  // Simulate different profiles for testing
  // PAN ending in 'F' = good profile
  // PAN ending in 'Z' = rejected profile
  const lastChar = pan.slice(-1);

  if (lastChar === 'Z') {
    return {
      score_value:      520,
      score_band:       'POOR',
      dpd_90_plus:      true,
      written_off:      false,
      active_loans:     4,
      enquiries_6m:     8,
      recommendation:   'REJECT',
      rejection_reason: 'DPD_90_PLUS',
      bureau_ref:       `MOCK_CIBIL_${Date.now()}`,
    };
  }

  return {
    score_value:      742,
    score_band:       'GOOD',
    dpd_90_plus:      false,
    written_off:      false,
    active_loans:     2,
    settled_loans:    3,
    enquiries_6m:     1,
    recommendation:   'PROCEED',
    rejection_reason: null,
    bureau_ref:       `MOCK_CIBIL_${Date.now()}`,
  };
};

const realBureauPull = async (pan, name, dob) => {
  try {
    const response = await axios.post(
      `${process.env.BUREAU_API_URL}/pull`,
      { pan, name, dob, bureau: 'CIBIL' },
      {
        headers: {
          Authorization: `Bearer ${process.env.BUREAU_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    const d = response.data;
    const dpd90    = d.dpd_history?.some(h => h.days_past_due >= 90) || false;
    const writeOff = d.accounts?.some(a =>
      a.account_status === 'WRITTEN_OFF' &&
      new Date(a.closed_date) > new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000)
    ) || false;

    let recommendation = 'PROCEED';
    let rejection_reason = null;

    if (dpd90)    { recommendation = 'REJECT'; rejection_reason = 'DPD_90_PLUS'; }
    if (writeOff) { recommendation = 'REJECT'; rejection_reason = 'WRITTEN_OFF_3YR'; }
    if (d.score < parseInt(process.env.RISK_MIN_BUREAU_SCORE || '600')) {
      recommendation = 'REJECT'; rejection_reason = 'LOW_SCORE';
    }

    return {
      score_value:      d.score,
      score_band:       getScoreBand(d.score),
      dpd_90_plus:      dpd90,
      written_off:      writeOff,
      active_loans:     d.active_accounts_count || 0,
      settled_loans:    d.closed_accounts_count || 0,
      enquiries_6m:     d.enquiries_6m || 0,
      recommendation,
      rejection_reason,
      bureau_ref:       d.report_id,
    };
  } catch (err) {
    logger.error('Bureau pull failed:', err.message);
    throw new Error(`Bureau pull failed: ${err.message}`);
  }
};

const getScoreBand = (score) => {
  if (score >= 750) return 'EXCELLENT';
  if (score >= 700) return 'GOOD';
  if (score >= 600) return 'FAIR';
  return 'POOR';
};

const pullBureau = async (pan, name, dob, userId, consentId) => {
  const mode = process.env.BUREAU_MODE || 'mock';

  const result = mode === 'real'
    ? await realBureauPull(pan, name, dob)
    : await mockBureauPull(pan, name, dob);

  audit('BUREAU_PULLED', userId, {
    pan_last4:       pan.slice(-4),
    score_band:      result.score_band,
    recommendation:  result.recommendation,
    mode,
  });

  return result;
};

// ─────────────────────────────────────────────────────────────
// AML SCREENING SERVICE
// Mode: AML_MODE=mock | real
// Real vendor: ComplyAdvantage / IDfy
// ─────────────────────────────────────────────────────────────

const mockAMLScreen = async (pan, name, dob) => {
  await new Promise(r => setTimeout(r, 400));

  // Simulate: most users pass AML
  // Name containing 'TERRORIST' fails (for testing)
  const isFlagged = name.toUpperCase().includes('TERRORIST');

  return {
    risk_score:       isFlagged ? 95 : Math.floor(Math.random() * 20),
    pep_flag:         false,
    sanctions_flag:   isFlagged,
    adverse_media_flag: false,
    flags:            isFlagged ? [{ type: 'SANCTIONS', detail: 'Test flag' }] : [],
    result:           isFlagged ? 'FAIL' : 'PASS',
    provider_ref:     `MOCK_AML_${Date.now()}`,
  };
};

const realAMLScreen = async (pan, name, dob) => {
  try {
    const response = await axios.post(
      `${process.env.COMPLY_API_URL}/searches`,
      {
        search_term: name,
        fuzziness:   0.6,
        filters: {
          types: ['sanction', 'pep', 'adverse-media'],
        },
      },
      {
        headers: {
          Authorization: `Token ${process.env.COMPLY_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const hits = response.data?.content?.data?.hits || [];
    const riskScore = response.data?.content?.data?.risk_score || 0;

    const sanctionsFlag = hits.some(h => h.doc?.types?.includes('sanction'));
    const pepFlag       = hits.some(h => h.doc?.types?.includes('pep'));
    const mediaFlag     = hits.some(h => h.doc?.types?.includes('adverse-media'));

    return {
      risk_score:         riskScore,
      pep_flag:           pepFlag,
      sanctions_flag:     sanctionsFlag,
      adverse_media_flag: mediaFlag,
      flags:              hits.map(h => ({ type: h.doc?.types?.[0], detail: h.doc?.name })),
      result:             (sanctionsFlag || riskScore > 70) ? 'FAIL' : pepFlag ? 'REVIEW' : 'PASS',
      provider_ref:       response.data?.content?.id,
    };
  } catch (err) {
    logger.error('AML screening failed:', err.message);
    throw new Error(`AML screening failed: ${err.message}`);
  }
};

const screenAML = async (pan, name, dob, userId) => {
  const mode = process.env.AML_MODE || 'mock';

  const result = mode === 'real'
    ? await realAMLScreen(pan, name, dob)
    : await mockAMLScreen(pan, name, dob);

  audit('AML_SCREENED', userId, {
    pan_last4:      pan.slice(-4),
    risk_score:     result.risk_score,
    result:         result.result,
    pep:            result.pep_flag,
    sanctions:      result.sanctions_flag,
    mode,
  });

  return result;
};

module.exports = { pullBureau, screenAML };
