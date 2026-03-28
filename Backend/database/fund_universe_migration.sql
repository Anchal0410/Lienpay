-- ================================================================
-- FUND UNIVERSE TABLE
-- LienPay's manually curated whitelist of mutual funds.
-- Only funds in this table (status=ACTIVE) are eligible as collateral.
-- Founder adds batches via POST /api/admin/fund-universe
-- ================================================================

CREATE TABLE IF NOT EXISTS fund_universe (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Fund identity
  scheme_code   INTEGER UNIQUE NOT NULL,  -- mfapi.in scheme code (authoritative ID)
  fund_name     TEXT NOT NULL,
  rta           VARCHAR(20),              -- CAMS or KFINTECH

  -- Founder-assigned category and LTV (NEVER auto-computed)
  scheme_type   VARCHAR(50) NOT NULL,
  -- EQUITY_LARGE_CAP, EQUITY_LARGE_MID_CAP, EQUITY_MID_CAP,
  -- EQUITY_SMALL_CAP, EQUITY_FLEXI_CAP, INDEX_FUND, etc.
  ltv_rate      DECIMAL(4,3) NOT NULL,    -- 0.40 = 40%

  -- Upload tracking
  status        VARCHAR(20) DEFAULT 'ACTIVE',
  -- ACTIVE = accepting collateral
  -- PENDING = under review, not yet available
  -- INACTIVE = de-listed (e.g. fund merged/wound up)
  batch_label   TEXT,                     -- e.g. "BATCH_1_REFERENCE_DOC"
  added_by      TEXT,                     -- who uploaded this batch

  -- Timestamps
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by scheme_code (the primary lookup key)
CREATE INDEX IF NOT EXISTS idx_fund_universe_scheme_code ON fund_universe(scheme_code);
CREATE INDEX IF NOT EXISTS idx_fund_universe_status ON fund_universe(status);
CREATE INDEX IF NOT EXISTS idx_fund_universe_type ON fund_universe(scheme_type);

-- ================================================================
-- HOW TO RUN THIS MIGRATION
-- Option 1: Add to database/migrate.js (run once on deploy)
-- Option 2: Run directly in Railway's PostgreSQL console:
--   Copy-paste above SQL and execute
-- The fund.universe.js service seeds the initial 38 funds automatically
-- on server startup via seedFundUniverse() called from server.js
-- ================================================================
