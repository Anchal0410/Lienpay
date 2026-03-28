// ─────────────────────────────────────────────────────────────
// LIENPAY FUND UNIVERSE
// These are the mutual funds LienPay supports for pledging.
// NAVs are fetched live from mfapi.in.
// mock_units = demo units shown during investor presentation.
// In production, real units come from Account Aggregator.
// ─────────────────────────────────────────────────────────────

export const SCHEME_TYPE_META = {
  // Colors chosen to be visually distinct from each other AND from jade (#00D4A1)
  // which is the "selected" state colour. Never use jade/green for a category.
  EQUITY_LARGE_CAP:     { label: 'Large Cap',       ltv: 0.40, color: '#3B82F6' },  // blue
  EQUITY_LARGE_MID_CAP: { label: 'Large & Mid Cap', ltv: 0.35, color: '#06B6D4' },  // cyan
  EQUITY_MID_CAP:       { label: 'Mid Cap',         ltv: 0.40, color: '#F59E0B' },  // amber
  EQUITY_SMALL_CAP:     { label: 'Small Cap',       ltv: 0.25, color: '#EF4444' },  // red
  EQUITY_FLEXI_CAP:     { label: 'Flexi Cap',       ltv: 0.35, color: '#8B5CF6' },  // purple
  INDEX_FUND:           { label: 'Index Fund',      ltv: 0.40, color: '#10B981' },  // emerald
}

export const FUND_UNIVERSE = [
  // ── LARGE CAP (LTV: 40%) ────────────────────────────────────
  { scheme_code: 106235, name: 'Nippon India Large Cap Fund',              scheme_type: 'EQUITY_LARGE_CAP',     rta: 'CAMS',     mock_units: 950  },
  { scheme_code: 120586, name: 'ICICI Prudential Large Cap Fund - Direct', scheme_type: 'EQUITY_LARGE_CAP',     rta: 'CAMS',     mock_units: 720  },
  { scheme_code: 119598, name: 'SBI Large Cap Fund - Direct',              scheme_type: 'EQUITY_LARGE_CAP',     rta: 'CAMS',     mock_units: 580  },
  { scheme_code: 119018, name: 'HDFC Large Cap Fund - Direct',             scheme_type: 'EQUITY_LARGE_CAP',     rta: 'CAMS',     mock_units: 440  },
  { scheme_code: 120465, name: 'Axis Large Cap Fund - Direct',             scheme_type: 'EQUITY_LARGE_CAP',     rta: 'CAMS',     mock_units: 830  },

  // ── LARGE & MID CAP (LTV: 35%) ──────────────────────────────
  { scheme_code: 119721, name: 'SBI Large & Midcap Fund - Direct',         scheme_type: 'EQUITY_LARGE_MID_CAP', rta: 'CAMS',     mock_units: 510  },
  { scheme_code: 120665, name: 'UTI Large & Mid Cap Fund - Direct',        scheme_type: 'EQUITY_LARGE_MID_CAP', rta: 'KFINTECH', mock_units: 340  },
  { scheme_code: 112932, name: 'Mirae Asset Large & Midcap - Regular',     scheme_type: 'EQUITY_LARGE_MID_CAP', rta: 'KFINTECH', mock_units: 620  },
  { scheme_code: 102920, name: 'Canara Robeco Large and Mid Cap - Regular',scheme_type: 'EQUITY_LARGE_MID_CAP', rta: 'KFINTECH', mock_units: 270  },
  { scheme_code: 118834, name: 'Mirae Asset Large & Midcap - Direct',      scheme_type: 'EQUITY_LARGE_MID_CAP', rta: 'KFINTECH', mock_units: 480  },
  { scheme_code: 120158, name: 'Kotak Large & Midcap Fund - Direct',       scheme_type: 'EQUITY_LARGE_MID_CAP', rta: 'KFINTECH', mock_units: 390  },
  { scheme_code: 103024, name: 'SBI Large & Midcap Fund - Regular',        scheme_type: 'EQUITY_LARGE_MID_CAP', rta: 'CAMS',     mock_units: 290  },
  { scheme_code: 103819, name: 'DSP Large & Mid Cap Fund - Regular',       scheme_type: 'EQUITY_LARGE_MID_CAP', rta: 'CAMS',     mock_units: 360  },
  { scheme_code: 130498, name: 'HDFC Large and Mid Cap Fund - Direct',     scheme_type: 'EQUITY_LARGE_MID_CAP', rta: 'CAMS',     mock_units: 410  },
  { scheme_code: 120357, name: 'Invesco India Large & Mid Cap - Direct',   scheme_type: 'EQUITY_LARGE_MID_CAP', rta: 'CAMS',     mock_units: 210  },
  { scheme_code: 152225, name: 'Whiteoak Capital Large & Mid Cap - Regular',scheme_type:'EQUITY_LARGE_MID_CAP', rta: 'KFINTECH', mock_units: 180  },

  // ── MID CAP (LTV: 40%) ──────────────────────────────────────
  { scheme_code: 118989, name: 'HDFC Mid Cap Opportunities Fund - Direct', scheme_type: 'EQUITY_MID_CAP',       rta: 'CAMS',     mock_units: 680  },
  { scheme_code: 118666, name: 'Nippon India Growth Fund - Direct',        scheme_type: 'EQUITY_MID_CAP',       rta: 'CAMS',     mock_units: 390  },
  { scheme_code: 147479, name: 'Mirae Asset Midcap Fund - Regular',        scheme_type: 'EQUITY_MID_CAP',       rta: 'KFINTECH', mock_units: 850  },
  { scheme_code: 127042, name: 'Motilal Oswal Midcap Fund - Direct',       scheme_type: 'EQUITY_MID_CAP',       rta: 'KFINTECH', mock_units: 460  },
  { scheme_code: 120841, name: 'Quant Mid Cap Fund - Direct',              scheme_type: 'EQUITY_MID_CAP',       rta: 'KFINTECH', mock_units: 320  },
  { scheme_code: 120505, name: 'Axis Midcap Fund - Direct',                scheme_type: 'EQUITY_MID_CAP',       rta: 'CAMS',     mock_units: 540  },
  { scheme_code: 125305, name: 'PGIM India Midcap Opp Fund - Regular',     scheme_type: 'EQUITY_MID_CAP',       rta: 'CAMS',     mock_units: 240  },

  // ── SMALL CAP (LTV: 25%) ────────────────────────────────────
  { scheme_code: 147946, name: 'Bandhan Small Cap Fund - Direct',          scheme_type: 'EQUITY_SMALL_CAP',     rta: 'CAMS',     mock_units: 920  },
  { scheme_code: 125497, name: 'SBI Small Cap Fund - Direct',              scheme_type: 'EQUITY_SMALL_CAP',     rta: 'CAMS',     mock_units: 310  },
  { scheme_code: 125354, name: 'Axis Small Cap Fund - Direct',             scheme_type: 'EQUITY_SMALL_CAP',     rta: 'CAMS',     mock_units: 440  },
  { scheme_code: 118778, name: 'Nippon India Small Cap Fund - Direct',     scheme_type: 'EQUITY_SMALL_CAP',     rta: 'CAMS',     mock_units: 560  },
  { scheme_code: 145206, name: 'Tata Small Cap Fund - Direct',             scheme_type: 'EQUITY_SMALL_CAP',     rta: 'CAMS',     mock_units: 380  },
  { scheme_code: 130503, name: 'HDFC Small Cap Fund - Direct',             scheme_type: 'EQUITY_SMALL_CAP',     rta: 'CAMS',     mock_units: 290  },
  { scheme_code: 152232, name: 'Motilal Oswal Small Cap Fund - Regular',   scheme_type: 'EQUITY_SMALL_CAP',     rta: 'KFINTECH', mock_units: 510  },
  { scheme_code: 151130, name: 'HSBC Small Cap Fund - Direct',             scheme_type: 'EQUITY_SMALL_CAP',     rta: 'CAMS',     mock_units: 270  },
  { scheme_code: 106823, name: 'ICICI Prudential Smallcap Fund - Growth',  scheme_type: 'EQUITY_SMALL_CAP',     rta: 'CAMS',     mock_units: 430  },

  // ── FLEXI CAP (LTV: 35%) ────────────────────────────────────
  { scheme_code: 122639, name: 'Parag Parikh Flexi Cap Fund - Direct',     scheme_type: 'EQUITY_FLEXI_CAP',     rta: 'CAMS',     mock_units: 780  },
  { scheme_code: 100520, name: 'Franklin India Flexi Cap Fund - Growth',   scheme_type: 'EQUITY_FLEXI_CAP',     rta: 'KFINTECH', mock_units: 350  },
  { scheme_code: 120662, name: 'UTI Flexi Cap Fund - Direct',              scheme_type: 'EQUITY_FLEXI_CAP',     rta: 'KFINTECH', mock_units: 490  },
  { scheme_code: 118955, name: 'HDFC Flexi Cap Fund - Direct',             scheme_type: 'EQUITY_FLEXI_CAP',     rta: 'CAMS',     mock_units: 620  },
  { scheme_code: 148989, name: 'ICICI Prudential Flexicap Fund - Growth',  scheme_type: 'EQUITY_FLEXI_CAP',     rta: 'CAMS',     mock_units: 280  },

  // ── INDEX FUNDS (LTV: 40%) ──────────────────────────────────
  { scheme_code: 151649, name: 'Kotak Nifty Smallcap 50 Index Fund - Direct', scheme_type: 'INDEX_FUND',       rta: 'KFINTECH', mock_units: 1200 },
]

// Helper: get meta for a scheme_type
export const getSchemeMeta = (scheme_type) =>
  SCHEME_TYPE_META[scheme_type] || { label: scheme_type, ltv: 0.40, color: '#7A8F85' }
