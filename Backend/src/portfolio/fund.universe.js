const { query } = require('../../config/database');
const { logger } = require('../../config/logger');

// ─────────────────────────────────────────────────────────────
// LIENPAY FUND UNIVERSE SERVICE
//
// The fund universe is the AUTHORITATIVE whitelist of mutual funds
// that LienPay accepts as collateral. It is manually curated by
// the founding team — no fund gets credit until it's reviewed
// and added here with an explicit category and LTV rate.
//
// Architecture:
//   - Stored in the `fund_universe` DB table (primary source)
//   - BOOTSTRAP_UNIVERSE below = initial 38 funds from the
//     reference doc, used to seed the DB on first run
//   - Founder adds new batches via POST /api/admin/fund-universe
//
// Why NOT auto-classify?
//   Auto-classification from scheme names is unreliable for
//   credit decisioning. Each fund must be manually reviewed
//   before being assigned a category and LTV rate.
//   If a user's fund is not in the universe:
//     → ineligible with reason FUND_NOT_IN_UNIVERSE
//     → display: "Not yet onboarded for LienPay credit"
//
// LTV Rates (RBI mandate, set per category):
//   Large Cap       40%    Large & Mid Cap  35%
//   Mid Cap         40%    Small Cap        25%
//   Flexi Cap       35%    Index Funds      40%
// ─────────────────────────────────────────────────────────────

// ── BOOTSTRAP UNIVERSE — Batch 1 (from founder reference doc) ──
const BOOTSTRAP_UNIVERSE = [
  // LARGE CAP — LTV 40%
  { scheme_code: 106235, fund_name: 'Nippon India Large Cap Fund',              scheme_type: 'EQUITY_LARGE_CAP',     ltv_rate: 0.40, rta: 'CAMS' },
  { scheme_code: 120586, fund_name: 'ICICI Prudential Large Cap Fund - Direct', scheme_type: 'EQUITY_LARGE_CAP',     ltv_rate: 0.40, rta: 'CAMS' },
  { scheme_code: 119598, fund_name: 'SBI Large Cap Fund - Direct',              scheme_type: 'EQUITY_LARGE_CAP',     ltv_rate: 0.40, rta: 'CAMS' },
  { scheme_code: 119018, fund_name: 'HDFC Large Cap Fund - Direct',             scheme_type: 'EQUITY_LARGE_CAP',     ltv_rate: 0.40, rta: 'CAMS' },
  { scheme_code: 120465, fund_name: 'Axis Large Cap Fund - Direct',             scheme_type: 'EQUITY_LARGE_CAP',     ltv_rate: 0.40, rta: 'CAMS' },

  // LARGE & MID CAP — LTV 35%
  { scheme_code: 119721, fund_name: 'SBI Large & Midcap Fund - Direct',         scheme_type: 'EQUITY_LARGE_MID_CAP', ltv_rate: 0.35, rta: 'CAMS' },
  { scheme_code: 120665, fund_name: 'UTI Large & Mid Cap Fund - Direct',        scheme_type: 'EQUITY_LARGE_MID_CAP', ltv_rate: 0.35, rta: 'KFINTECH' },
  { scheme_code: 112932, fund_name: 'Mirae Asset Large & Midcap - Regular',     scheme_type: 'EQUITY_LARGE_MID_CAP', ltv_rate: 0.35, rta: 'KFINTECH' },
  { scheme_code: 102920, fund_name: 'Canara Robeco Large and Mid Cap - Regular',scheme_type: 'EQUITY_LARGE_MID_CAP', ltv_rate: 0.35, rta: 'KFINTECH' },
  { scheme_code: 118834, fund_name: 'Mirae Asset Large & Midcap - Direct',      scheme_type: 'EQUITY_LARGE_MID_CAP', ltv_rate: 0.35, rta: 'KFINTECH' },
  { scheme_code: 120158, fund_name: 'Kotak Large & Midcap Fund - Direct',       scheme_type: 'EQUITY_LARGE_MID_CAP', ltv_rate: 0.35, rta: 'KFINTECH' },
  { scheme_code: 103024, fund_name: 'SBI Large & Midcap Fund - Regular',        scheme_type: 'EQUITY_LARGE_MID_CAP', ltv_rate: 0.35, rta: 'CAMS' },
  { scheme_code: 103819, fund_name: 'DSP Large & Mid Cap Fund - Regular',       scheme_type: 'EQUITY_LARGE_MID_CAP', ltv_rate: 0.35, rta: 'CAMS' },
  { scheme_code: 130498, fund_name: 'HDFC Large and Mid Cap Fund - Direct',     scheme_type: 'EQUITY_LARGE_MID_CAP', ltv_rate: 0.35, rta: 'CAMS' },
  { scheme_code: 120357, fund_name: 'Invesco India Large & Mid Cap - Direct',   scheme_type: 'EQUITY_LARGE_MID_CAP', ltv_rate: 0.35, rta: 'CAMS' },
  { scheme_code: 152225, fund_name: 'Whiteoak Capital Large & Mid Cap - Regular',scheme_type:'EQUITY_LARGE_MID_CAP', ltv_rate: 0.35, rta: 'KFINTECH' },

  // MID CAP — LTV 40%
  { scheme_code: 118989, fund_name: 'HDFC Mid-Cap Opportunities Fund - Direct', scheme_type: 'EQUITY_MID_CAP',       ltv_rate: 0.40, rta: 'CAMS' },
  { scheme_code: 118666, fund_name: 'Nippon India Growth Fund - Direct',        scheme_type: 'EQUITY_MID_CAP',       ltv_rate: 0.40, rta: 'CAMS' },
  { scheme_code: 147479, fund_name: 'Mirae Asset Midcap Fund - Regular',        scheme_type: 'EQUITY_MID_CAP',       ltv_rate: 0.40, rta: 'KFINTECH' },
  { scheme_code: 127042, fund_name: 'Motilal Oswal Midcap Fund - Direct',       scheme_type: 'EQUITY_MID_CAP',       ltv_rate: 0.40, rta: 'KFINTECH' },
  { scheme_code: 120841, fund_name: 'Quant Mid Cap Fund - Direct',              scheme_type: 'EQUITY_MID_CAP',       ltv_rate: 0.40, rta: 'KFINTECH' },
  { scheme_code: 120505, fund_name: 'Axis Midcap Fund - Direct',                scheme_type: 'EQUITY_MID_CAP',       ltv_rate: 0.40, rta: 'CAMS' },
  { scheme_code: 125305, fund_name: 'PGIM India Midcap Opportunities - Regular',scheme_type: 'EQUITY_MID_CAP',       ltv_rate: 0.40, rta: 'CAMS' },

  // SMALL CAP — LTV 25%
  { scheme_code: 147946, fund_name: 'Bandhan Small Cap Fund - Direct',          scheme_type: 'EQUITY_SMALL_CAP',     ltv_rate: 0.25, rta: 'CAMS' },
  { scheme_code: 125497, fund_name: 'SBI Small Cap Fund - Direct',              scheme_type: 'EQUITY_SMALL_CAP',     ltv_rate: 0.25, rta: 'CAMS' },
  { scheme_code: 125354, fund_name: 'Axis Small Cap Fund - Direct',             scheme_type: 'EQUITY_SMALL_CAP',     ltv_rate: 0.25, rta: 'CAMS' },
  { scheme_code: 118778, fund_name: 'Nippon India Small Cap Fund - Direct',     scheme_type: 'EQUITY_SMALL_CAP',     ltv_rate: 0.25, rta: 'CAMS' },
  { scheme_code: 145206, fund_name: 'Tata Small Cap Fund - Direct',             scheme_type: 'EQUITY_SMALL_CAP',     ltv_rate: 0.25, rta: 'CAMS' },
  { scheme_code: 130503, fund_name: 'HDFC Small Cap Fund - Direct',             scheme_type: 'EQUITY_SMALL_CAP',     ltv_rate: 0.25, rta: 'CAMS' },
  { scheme_code: 152232, fund_name: 'Motilal Oswal Small Cap Fund - Regular',   scheme_type: 'EQUITY_SMALL_CAP',     ltv_rate: 0.25, rta: 'KFINTECH' },
  { scheme_code: 151130, fund_name: 'HSBC Small Cap Fund - Direct',             scheme_type: 'EQUITY_SMALL_CAP',     ltv_rate: 0.25, rta: 'CAMS' },
  { scheme_code: 106823, fund_name: 'ICICI Prudential Smallcap Fund - Growth',  scheme_type: 'EQUITY_SMALL_CAP',     ltv_rate: 0.25, rta: 'CAMS' },

  // FLEXI CAP — LTV 35%
  { scheme_code: 122639, fund_name: 'Parag Parikh Flexi Cap Fund - Direct',     scheme_type: 'EQUITY_FLEXI_CAP',     ltv_rate: 0.35, rta: 'CAMS' },
  { scheme_code: 100520, fund_name: 'Franklin India Flexi Cap Fund - Growth',   scheme_type: 'EQUITY_FLEXI_CAP',     ltv_rate: 0.35, rta: 'KFINTECH' },
  { scheme_code: 120662, fund_name: 'UTI Flexi Cap Fund - Direct',              scheme_type: 'EQUITY_FLEXI_CAP',     ltv_rate: 0.35, rta: 'KFINTECH' },
  { scheme_code: 118955, fund_name: 'HDFC Flexi Cap Fund - Direct',             scheme_type: 'EQUITY_FLEXI_CAP',     ltv_rate: 0.35, rta: 'CAMS' },
  { scheme_code: 148989, fund_name: 'ICICI Prudential Flexicap Fund - Growth',  scheme_type: 'EQUITY_FLEXI_CAP',     ltv_rate: 0.35, rta: 'CAMS' },

  // INDEX FUNDS — LTV 40%
  { scheme_code: 151649, fund_name: 'Kotak Nifty Smallcap 50 Index Fund - Direct', scheme_type: 'INDEX_FUND',       ltv_rate: 0.40, rta: 'KFINTECH' },
];

// ── SEED DB ON STARTUP ────────────────────────────────────────
// Called once when server starts. Upserts all bootstrap funds.
// Safe to run multiple times — won't overwrite manually added funds.
const seedFundUniverse = async () => {
  try {
    let inserted = 0;
    for (const fund of BOOTSTRAP_UNIVERSE) {
      const res = await query(`
        INSERT INTO fund_universe (scheme_code, fund_name, scheme_type, ltv_rate, rta, status, batch_label)
        VALUES ($1, $2, $3, $4, $5, 'ACTIVE', 'BATCH_1_REFERENCE_DOC')
        ON CONFLICT (scheme_code) DO NOTHING
      `, [fund.scheme_code, fund.fund_name, fund.scheme_type, fund.ltv_rate, fund.rta]);
      if (res.rowCount > 0) inserted++;
    }
    if (inserted > 0) logger.info(`🌱 Fund universe seeded: ${inserted} new funds added`);
  } catch (err) {
    // Table may not exist yet — not fatal, will use in-memory fallback
    logger.warn('Fund universe seed skipped (table may not exist yet):', err.message);
  }
};

// ── LOOKUP: Is this fund in the universe? ─────────────────────
// Returns fund info if found, null if not.
// Checks DB first, falls back to in-memory bootstrap list.
const lookupFund = async (scheme_code) => {
  if (!scheme_code) return null;

  try {
    const result = await query(
      `SELECT scheme_code, fund_name, scheme_type, ltv_rate, rta, status
       FROM fund_universe
       WHERE scheme_code = $1`,
      [parseInt(scheme_code)]
    );
    if (result.rows.length > 0) {
      const f = result.rows[0];
      if (f.status !== 'ACTIVE') return null; // PENDING or INACTIVE = not yet available
      return { scheme_code: f.scheme_code, fund_name: f.fund_name, scheme_type: f.scheme_type, ltv_rate: parseFloat(f.ltv_rate), rta: f.rta };
    }
  } catch (err) {
    // DB unavailable — fall back to in-memory bootstrap
    logger.warn('Fund universe DB lookup failed, using in-memory fallback:', err.message);
  }

  // In-memory fallback
  return BOOTSTRAP_UNIVERSE.find(f => f.scheme_code === parseInt(scheme_code)) || null;
};

// ── ADD NEW BATCH ─────────────────────────────────────────────
// Called by admin endpoint when founder uploads a new batch.
// funds = [{ scheme_code, fund_name, scheme_type, ltv_rate, rta }]
const addFundBatch = async (funds, batchLabel, addedBy) => {
  const results = { added: 0, updated: 0, errors: [] };

  for (const fund of funds) {
    try {
      const res = await query(`
        INSERT INTO fund_universe (scheme_code, fund_name, scheme_type, ltv_rate, rta, status, batch_label, added_by)
        VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7)
        ON CONFLICT (scheme_code) DO UPDATE SET
          fund_name   = EXCLUDED.fund_name,
          scheme_type = EXCLUDED.scheme_type,
          ltv_rate    = EXCLUDED.ltv_rate,
          rta         = EXCLUDED.rta,
          batch_label = EXCLUDED.batch_label,
          updated_at  = NOW()
        RETURNING (xmax = 0) AS inserted
      `, [fund.scheme_code, fund.fund_name, fund.scheme_type, fund.ltv_rate, fund.rta, batchLabel, addedBy]);

      if (res.rows[0]?.inserted) results.added++;
      else results.updated++;
    } catch (err) {
      results.errors.push({ scheme_code: fund.scheme_code, error: err.message });
    }
  }

  return results;
};

// ── GET FULL UNIVERSE (for admin) ─────────────────────────────
const getFullUniverse = async () => {
  try {
    const result = await query(
      `SELECT * FROM fund_universe ORDER BY scheme_type, fund_name`,
      []
    );
    return result.rows;
  } catch {
    return BOOTSTRAP_UNIVERSE;
  }
};

module.exports = { seedFundUniverse, lookupFund, addFundBatch, getFullUniverse, BOOTSTRAP_UNIVERSE };
