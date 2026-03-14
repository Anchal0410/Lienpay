const axios = require('axios');
const levenshtein = require('fast-levenshtein');
const { logger, audit } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// PAN VERIFICATION SERVICE
// Mode: PAN_VERIFY_MODE=mock | real
// Real vendor: Setu (setu.co) — swap API key in .env
// ─────────────────────────────────────────────────────────────

// ── MOCK PAN RESPONSE ─────────────────────────────────────────
const mockPANVerify = async (pan, name, dob) => {
  // Simulate realistic responses based on PAN format
  // In dev, all valid-format PANs return active
  await new Promise(r => setTimeout(r, 400)); // simulate API latency

  // Simulate a few test cases
  if (pan === 'AAAAA0000A') {
    return { status: 'INACTIVE', name_match: false, name_on_pan: 'TEST INACTIVE' };
  }

  // Fuzzy name match simulation
  const nameOnPAN  = name.toUpperCase().trim();
  const matchScore = calculateNameMatchScore(name, nameOnPAN);

  return {
    status:       'ACTIVE',
    name_on_pan:  nameOnPAN,
    name_match:   matchScore >= 75,
    match_score:  matchScore,
    pan_type:     'INDIVIDUAL', // INDIVIDUAL, COMPANY, HUF etc.
    aadhaar_linked: true,
  };
};

// ── REAL PAN VERIFY via Setu ──────────────────────────────────
const realPANVerify = async (pan, name, dob) => {
  try {
    const response = await axios.post(
      'https://dg.setu.co/api/verify/pan',
      { pan },
      {
        headers: {
          'x-client-id':     process.env.SETU_CLIENT_ID,
          'x-client-secret': process.env.SETU_CLIENT_SECRET,
          'x-product-instance-id': process.env.SETU_PRODUCT_INSTANCE_ID,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    const data = response.data?.data;
    const nameOnPAN  = data?.name || '';
    const matchScore = calculateNameMatchScore(name, nameOnPAN);

    return {
      status:       data?.status || 'UNKNOWN',
      name_on_pan:  nameOnPAN,
      name_match:   matchScore >= 75,
      match_score:  matchScore,
      pan_type:     data?.pan_type || 'INDIVIDUAL',
      aadhaar_linked: data?.aadhaar_seeding_status === 'Y',
    };
  } catch (err) {
    logger.error('Setu PAN verify failed:', err.message);
    throw new Error(`PAN verification failed: ${err.message}`);
  }
};

// ── MAIN EXPORT ───────────────────────────────────────────────
const verifyPAN = async (pan, name, dob, userId) => {
  const mode = process.env.PAN_VERIFY_MODE || 'mock';
  const result = mode === 'real'
    ? await realPANVerify(pan, name, dob)
    : await mockPANVerify(pan, name, dob);

  audit('PAN_VERIFIED', userId, {
    pan_last4:    pan.slice(-4),
    status:       result.status,
    name_match:   result.name_match,
    match_score:  result.match_score,
    mode,
  });

  return result;
};

// ── NAME FUZZY MATCH ──────────────────────────────────────────
// Uses Levenshtein distance to handle spelling variations
const calculateNameMatchScore = (name1, name2) => {
  if (!name1 || !name2) return 0;
  const n1 = name1.toUpperCase().trim().replace(/\s+/g, ' ');
  const n2 = name2.toUpperCase().trim().replace(/\s+/g, ' ');

  if (n1 === n2) return 100;

  // Check if all words in one name appear in the other
  const words1 = n1.split(' ');
  const words2 = n2.split(' ');
  const commonWords = words1.filter(w => words2.includes(w));
  if (commonWords.length >= Math.min(words1.length, words2.length)) return 90;

  // Levenshtein distance score
  const maxLen  = Math.max(n1.length, n2.length);
  const dist    = levenshtein.get(n1, n2);
  const score   = Math.round(((maxLen - dist) / maxLen) * 100);
  return score;
};

module.exports = { verifyPAN, calculateNameMatchScore };
