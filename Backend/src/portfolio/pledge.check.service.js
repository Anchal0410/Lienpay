const axios = require('axios');
const { logger } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// PLEDGE STATUS CHECK SERVICE
// Checks if folios already have existing pledges
// before calculating eligible credit
// ─────────────────────────────────────────────────────────────

// ── MOCK: Check existing pledges ─────────────────────────────
const mockCheckPledgeStatus = async (folios) => {
  await new Promise(r => setTimeout(r, 400));

  // Simulate: most folios are clean (no existing pledge)
  return folios.map(folio => ({
    folio_number:     folio.folio_number,
    rta:              folio.rta,
    has_pledge:       false,
    pledged_units:    0,
    available_units:  folio.units_held,
    pledge_details:   [],
  }));
};

// ── REAL: Check CAMS pledge status ───────────────────────────
const realCheckCAMSPledge = async (folios) => {
  try {
    const camsFolios = folios.filter(f => f.rta === 'CAMS');
    if (!camsFolios.length) return [];

    const response = await axios.post(
      `${process.env.CAMS_API_URL}/pledge/status`,
      {
        folios: camsFolios.map(f => ({
          folio_number: f.folio_number,
          isin:         f.isin,
        })),
        lsp_id: process.env.CAMS_CLIENT_ID,
      },
      {
        headers: {
          'x-api-key':  process.env.CAMS_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    return response.data.folios || [];
  } catch (err) {
    logger.error('CAMS pledge status check failed:', err.message);
    return [];
  }
};

// ── REAL: Check KFintech pledge status ───────────────────────
const realCheckKFTPledge = async (folios) => {
  try {
    const kftFolios = folios.filter(f => f.rta === 'KFINTECH');
    if (!kftFolios.length) return [];

    const response = await axios.post(
      `${process.env.KFINTECH_API_URL}/pledge/status`,
      {
        folios: kftFolios.map(f => ({
          folio_number: f.folio_number,
          isin:         f.isin,
        })),
      },
      {
        headers: {
          'x-api-key': process.env.KFINTECH_API_KEY,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }
    );

    return response.data.folios || [];
  } catch (err) {
    logger.error('KFintech pledge status check failed:', err.message);
    return [];
  }
};

// ── PUBLIC: Check all pledge statuses ────────────────────────
const checkExistingPledges = async (folios) => {
  const mode = process.env.CAMS_MODE || 'mock';

  if (mode === 'mock') {
    return await mockCheckPledgeStatus(folios);
  }

  // Real: check both RTAs in parallel
  const [camsResults, kftResults] = await Promise.all([
    realCheckCAMSPledge(folios),
    realCheckKFTPledge(folios),
  ]);

  return [...camsResults, ...kftResults];
};

module.exports = { checkExistingPledges };
