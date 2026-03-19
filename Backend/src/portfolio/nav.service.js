const axios = require('axios');
const { query } = require('../../config/database');
const { logger } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// AMFI NAV SERVICE
// This is 100% REAL — free public API from AMFI
// No API key needed. Updated every day after 11pm.
// URL: https://www.amfiindia.com/spages/NAVAll.txt
// ─────────────────────────────────────────────────────────────

// ── FETCH ALL NAVs FROM AMFI ──────────────────────────────────
const fetchAMFINavs = async () => {
  try {
    logger.info('📊 Fetching NAVs from AMFI...');

    const response = await axios.get(
      process.env.AMFI_NAV_URL || 'https://www.amfiindia.com/spages/NAVAll.txt',
      { timeout: 30000, responseType: 'text' }
    );

    const navMap = parseAMFIData(response.data);
    logger.info(`✅ AMFI NAV fetch complete. ${Object.keys(navMap).length} schemes loaded.`);
    return navMap;
  } catch (err) {
    logger.error('AMFI NAV fetch failed:', err.message);
    throw new Error(`AMFI NAV fetch failed: ${err.message}`);
  }
};

// ── PARSE AMFI TEXT FORMAT ────────────────────────────────────
// AMFI returns a text file with this format:
// Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date
const parseAMFIData = (rawText) => {
  const navMap   = {}; // isin → { nav, scheme_name, date }
  const isinMap  = {}; // scheme_code → isin
  const lines    = rawText.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('Scheme Code') || trimmed.startsWith('Open Ended') || trimmed.startsWith('Close Ended')) continue;

    const parts = trimmed.split(';');
    if (parts.length < 6) continue;

    const schemeCode  = parts[0]?.trim();
    const isinGrowth  = parts[1]?.trim();
    const isinDivRein = parts[2]?.trim();
    const schemeName  = parts[3]?.trim();
    const nav         = parseFloat(parts[4]?.trim());
    const navDate     = parts[5]?.trim();

    if (!schemeCode || isNaN(nav) || nav <= 0) continue;

    // Map both ISINs to the NAV
    if (isinGrowth && isinGrowth !== 'N.A.' && isinGrowth.length === 12) {
      navMap[isinGrowth] = { nav, scheme_name: schemeName, nav_date: navDate, scheme_code: schemeCode };
    }
    if (isinDivRein && isinDivRein !== 'N.A.' && isinDivRein.length === 12) {
      navMap[isinDivRein] = { nav, scheme_name: schemeName, nav_date: navDate, scheme_code: schemeCode };
    }
  }

  return navMap;
};

// ── GET NAV FOR SPECIFIC ISIN ─────────────────────────────────
const getNavForISIN = async (isin) => {
  // First check DB cache (today's data)
  const today = new Date().toISOString().split('T')[0];
  const cached = await query(
    'SELECT nav_value, nav_date FROM nav_history WHERE isin = $1 AND nav_date = $2',
    [isin, today]
  );

  if (cached.rows.length > 0) {
    return { nav: cached.rows[0].nav_value, source: 'cache', date: cached.rows[0].nav_date };
  }

  // Fetch fresh from AMFI
  const navMap = await fetchAMFINavs();
  const navData = navMap[isin];

  if (!navData) {
    logger.warn(`NAV not found for ISIN: ${isin}`);
    return null;
  }

  // Store in DB for today
  await query(`
    INSERT INTO nav_history (isin, scheme_name, nav_date, nav_value)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (isin, nav_date) DO UPDATE SET nav_value = $4
  `, [isin, navData.scheme_name, today, navData.nav]);

  return { nav: navData.nav, source: 'amfi', date: today };
};

// ── BULK NAV FETCH FOR PORTFOLIO ──────────────────────────────
const getNavsForPortfolio = async (isins) => {
  const today  = new Date().toISOString().split('T')[0];
  const navMap = {};

  // Check which ISINs are already cached today
  const cached = await query(
    'SELECT isin, nav_value FROM nav_history WHERE isin = ANY($1) AND nav_date = $2',
    [isins, today]
  );

  cached.rows.forEach(row => { navMap[row.isin] = row.nav_value; });

  // Find uncached ISINs
  const uncached = isins.filter(isin => !navMap[isin]);

  if (uncached.length > 0) {
    logger.info(`Fetching ${uncached.length} uncached NAVs from AMFI`);
    const amfiData = await fetchAMFINavs();

    for (const isin of uncached) {
      if (amfiData[isin]) {
        navMap[isin] = amfiData[isin].nav;
        // Cache in DB
        await query(`
          INSERT INTO nav_history (isin, scheme_name, nav_date, nav_value)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (isin, nav_date) DO UPDATE SET nav_value = $4
        `, [isin, amfiData[isin].scheme_name, today, amfiData[isin].nav]);
      }
    }
  }

  return navMap;
};

// ── GET PEAK NAV (for drawdown calculation) ───────────────────
const getPeakNAV = async (isin, lookbackDays = 365) => {
  const result = await query(`
    SELECT MAX(nav_value) as peak_nav, MIN(nav_value) as lowest_nav
    FROM nav_history
    WHERE isin = $1 AND nav_date >= CURRENT_DATE - INTERVAL '${lookbackDays} days'
  `, [isin]);

  return {
    peak_nav:   parseFloat(result.rows[0]?.peak_nav) || null,
    lowest_nav: parseFloat(result.rows[0]?.lowest_nav) || null,
  };
};

module.exports = { fetchAMFINavs, getNavForISIN, getNavsForPortfolio, getPeakNAV };
