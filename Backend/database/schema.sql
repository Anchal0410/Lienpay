-- ================================================================
-- LienPay Database Schema
-- Complete schema for MF-Backed UPI Credit Line
-- PostgreSQL 14+
-- ================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ================================================================
-- 1. USERS
-- Core identity table. Everything references user_id.
-- ================================================================
CREATE TABLE IF NOT EXISTS users (
  user_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mobile            VARCHAR(15) NOT NULL UNIQUE,
  mobile_verified   BOOLEAN DEFAULT FALSE,
  email             VARCHAR(255),
  email_verified    BOOLEAN DEFAULT FALSE,

  -- Name stored plaintext (from PAN/Aadhaar — public field)
  full_name         VARCHAR(255),

  -- PAN: only last 4 stored in plaintext for display
  pan_last4         CHAR(4),
  -- Full PAN encrypted with AES-256
  pan_encrypted     TEXT,
  pan_verified      BOOLEAN DEFAULT FALSE,
  pan_status        VARCHAR(50), -- ACTIVE, INACTIVE, DEACTIVATED

  date_of_birth     DATE,
  gender            VARCHAR(10),

  -- Address from Aadhaar eKYC
  address_line1     TEXT,
  address_city      VARCHAR(100),
  address_state     VARCHAR(100),
  address_pincode   VARCHAR(10),

  -- KYC status
  kyc_status        VARCHAR(50) DEFAULT 'PENDING',
  -- PENDING → AADHAAR_OTP_DONE → VKYC_DONE → VERIFIED → REJECTED
  kyc_type          VARCHAR(50), -- AADHAAR_OTP, VIDEO_KYC
  kyc_completed_at  TIMESTAMPTZ,

  -- CKYC
  ckyc_id           VARCHAR(20) UNIQUE,
  ckyc_verified_at  TIMESTAMPTZ,

  -- Credit account status (overall)
  account_status    VARCHAR(50) DEFAULT 'ONBOARDING',
  -- ONBOARDING → KYC_DONE → PORTFOLIO_LINKED → CREDIT_ACTIVE
  -- → OVERDUE → MARGIN_CALL → DEFAULTED → CLOSED

  -- Onboarding tracking
  onboarding_step   VARCHAR(50) DEFAULT 'MOBILE_VERIFY',

  -- Device
  device_fingerprint TEXT,
  last_device_id    TEXT,

  -- Metadata
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ -- soft delete only

  CONSTRAINT users_mobile_format CHECK (mobile ~ '^[6-9][0-9]{9}$')
);

CREATE INDEX idx_users_mobile ON users(mobile);
CREATE INDEX idx_users_ckyc ON users(ckyc_id);
CREATE INDEX idx_users_pan_last4 ON users(pan_last4);
CREATE INDEX idx_users_account_status ON users(account_status);

-- ================================================================
-- 2. SESSIONS
-- JWT session tracking. Each login = one session.
-- ================================================================
CREATE TABLE IF NOT EXISTS sessions (
  session_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  jwt_jti           VARCHAR(255) UNIQUE NOT NULL, -- JWT ID claim
  device_id         TEXT,
  device_os         VARCHAR(50),
  device_model      VARCHAR(100),
  ip_address        INET,
  ip_hash           TEXT, -- hashed for privacy
  user_agent        TEXT,
  is_active         BOOLEAN DEFAULT TRUE,
  last_active_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ,
  revoke_reason     VARCHAR(100),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_jti ON sessions(jwt_jti);

-- ================================================================
-- 3. OTP LOGS
-- Every OTP sent, for audit and fraud detection.
-- ================================================================
CREATE TABLE IF NOT EXISTS otp_logs (
  otp_log_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mobile            VARCHAR(15) NOT NULL,
  otp_type          VARCHAR(50) NOT NULL, -- MOBILE_VERIFY, AADHAAR_KYC
  otp_hash          TEXT NOT NULL, -- bcrypt hash, never plaintext
  attempts          INTEGER DEFAULT 0,
  max_attempts      INTEGER DEFAULT 3,
  status            VARCHAR(50) DEFAULT 'PENDING', -- PENDING, VERIFIED, EXPIRED, LOCKED
  ip_hash           TEXT,
  expires_at        TIMESTAMPTZ NOT NULL,
  verified_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_otp_mobile ON otp_logs(mobile);

-- ================================================================
-- 4. CONSENT LOGS
-- DPDP Act 2023: immutable record of every consent action.
-- ================================================================
CREATE TABLE IF NOT EXISTS consent_logs (
  consent_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  consent_type      VARCHAR(100) NOT NULL,
  -- Types: BUREAU_PULL, CKYC_REGISTRATION, AA_DATA_ACCESS,
  --        PLEDGE_CREATION, KFS_ACCEPTANCE, AADHAAR_KYC,
  --        T_AND_C, MARKETING (optional)
  consent_action    VARCHAR(20) NOT NULL, -- GRANTED, REVOKED, UPDATED
  consent_version   VARCHAR(20) NOT NULL, -- e.g. "v1.2"
  kfs_version       VARCHAR(20), -- for KFS_ACCEPTANCE type
  ip_hash           TEXT,
  device_id         TEXT,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW()
  -- NOTE: No updated_at. This table is APPEND-ONLY. Never UPDATE or DELETE.
);

CREATE INDEX idx_consent_user ON consent_logs(user_id);
CREATE INDEX idx_consent_type ON consent_logs(consent_type);

-- ================================================================
-- 5. KYC RECORDS
-- Full KYC data per user. Aadhaar fields masked per UIDAI mandate.
-- ================================================================
CREATE TABLE IF NOT EXISTS kyc_records (
  kyc_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id) UNIQUE,

  -- Aadhaar — NEVER store full number per UIDAI mandate
  aadhaar_last4     CHAR(4),
  aadhaar_txn_ref   TEXT, -- UIDAI transaction reference
  aadhaar_linked_mobile_last4 CHAR(4), -- mobile Aadhaar is linked to

  -- eKYC data (from Aadhaar)
  name_from_aadhaar TEXT,
  dob_from_aadhaar  DATE,
  gender_from_aadhaar VARCHAR(10),
  address_from_aadhaar JSONB, -- full address object
  photo_hash        TEXT, -- SHA256 of photo, not the photo itself

  -- Name match result
  name_match_score  DECIMAL(5,2), -- 0-100 fuzzy match score
  name_match_pass   BOOLEAN,

  -- KYC method
  kyc_method        VARCHAR(50), -- AADHAAR_OTP, VIDEO_KYC
  kyc_provider      VARCHAR(100), -- e.g. "Digio", "Signzy"
  kyc_provider_ref  TEXT, -- provider's transaction ID

  -- V-KYC specific
  vkyc_session_id   TEXT,
  vkyc_agent_id     TEXT,
  vkyc_recorded_at  TIMESTAMPTZ,

  -- CKYC
  ckyc_id           VARCHAR(20),
  ckyc_action       VARCHAR(20), -- FETCHED, CREATED, UPDATED
  ckyc_verified_at  TIMESTAMPTZ,

  -- Status
  status            VARCHAR(50) DEFAULT 'PENDING',
  -- PENDING → AADHAAR_OTP_VERIFIED → CKYC_DONE → COMPLETE → REJECTED

  rejection_reason  TEXT,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_kyc_user ON kyc_records(user_id);

-- ================================================================
-- 6. AML CHECKS
-- AML / sanctions screening results. Immutable.
-- ================================================================
CREATE TABLE IF NOT EXISTS aml_checks (
  aml_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  check_type        VARCHAR(50) DEFAULT 'ONBOARDING', -- ONBOARDING, PERIODIC, TRANSACTION
  provider          VARCHAR(100), -- ComplyAdvantage, IDfy, etc.
  provider_ref      TEXT,
  risk_score        INTEGER, -- 0-100
  pep_flag          BOOLEAN DEFAULT FALSE, -- Politically Exposed Person
  sanctions_flag    BOOLEAN DEFAULT FALSE,
  adverse_media_flag BOOLEAN DEFAULT FALSE,
  flags             JSONB DEFAULT '[]', -- array of flag objects
  result            VARCHAR(20), -- PASS, FAIL, REVIEW
  raw_response      JSONB, -- full provider response (encrypted at rest)
  checked_at        TIMESTAMPTZ DEFAULT NOW()
  -- APPEND-ONLY. Never UPDATE or DELETE.
);

CREATE INDEX idx_aml_user ON aml_checks(user_id);

-- ================================================================
-- 7. BUREAU RESULTS
-- Credit bureau pull results. Store decision fields only.
-- ================================================================
CREATE TABLE IF NOT EXISTS bureau_results (
  bureau_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  bureau_name       VARCHAR(50), -- CIBIL, EXPERIAN, CRIF
  pull_type         VARCHAR(20), -- HARD, SOFT
  consent_id        UUID REFERENCES consent_logs(consent_id),
  provider_ref      TEXT, -- bureau's reference number

  -- Decision fields only (not full report per DPDP data minimisation)
  score_band        VARCHAR(20), -- EXCELLENT(750+), GOOD(700-749), FAIR(600-699)
  score_value       INTEGER,
  dpd_90_plus       BOOLEAN DEFAULT FALSE, -- any DPD > 90 days
  written_off       BOOLEAN DEFAULT FALSE, -- any write-off in 3 years
  active_loans_count INTEGER DEFAULT 0,
  settled_loans_count INTEGER DEFAULT 0,
  enquiries_6m      INTEGER DEFAULT 0, -- bureau enquiries in 6 months

  -- Decision
  recommendation    VARCHAR(20), -- PROCEED, REJECT, MANUAL_REVIEW
  rejection_reason  VARCHAR(100),
  pulled_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bureau_user ON bureau_results(user_id);

-- ================================================================
-- 8. MF HOLDINGS
-- User's MF portfolio fetched via AA.
-- ================================================================
CREATE TABLE IF NOT EXISTS mf_holdings (
  holding_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),

  -- Fund identity
  folio_number      VARCHAR(50) NOT NULL,
  isin              VARCHAR(20) NOT NULL,
  scheme_name       TEXT NOT NULL,
  amc_name          VARCHAR(100),
  rta               VARCHAR(20), -- CAMS or KFINTECH

  -- Classification (determines LTV cap)
  scheme_type       VARCHAR(50),
  -- EQUITY_LARGE_CAP, EQUITY_MID_CAP, EQUITY_SMALL_CAP,
  -- EQUITY_FLEXI, EQUITY_ELSS, DEBT_LIQUID, DEBT_SHORT_DURATION,
  -- DEBT_CORPORATE_BOND, DEBT_GILT, HYBRID_BALANCED,
  -- INDEX_FUND, ETF, FOF_INTERNATIONAL
  asset_class       VARCHAR(20), -- EQUITY, DEBT, HYBRID
  ltv_cap           DECIMAL(4,3), -- 0.500 or 0.800 per RBI

  -- Holdings
  units_held        DECIMAL(15,4) NOT NULL,
  nav_at_fetch      DECIMAL(15,4),
  value_at_fetch    DECIMAL(15,2), -- units × nav

  -- Eligibility
  is_eligible       BOOLEAN DEFAULT TRUE,
  ineligibility_reason VARCHAR(100),
  -- Reasons: ELSS_LOCK_IN, ALREADY_PLEDGED, JOINT_HOLDER, NBFC_RESTRICTED

  -- ELSS lock-in
  lock_in_date      DATE, -- null if not ELSS

  -- Joint holders
  is_joint_holding  BOOLEAN DEFAULT FALSE,
  joint_holder_names JSONB DEFAULT '[]',

  -- Existing pledge check
  existing_pledge   BOOLEAN DEFAULT FALSE,
  existing_pledge_detail JSONB DEFAULT '{}',

  -- Eligible credit from this folio
  eligible_units    DECIMAL(15,4), -- units × 0.9 buffer
  eligible_value    DECIMAL(15,2), -- eligible_units × nav × ltv_cap

  -- AA metadata
  aa_consent_id     TEXT,
  fetched_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_holdings_user ON mf_holdings(user_id);
CREATE INDEX idx_holdings_isin ON mf_holdings(isin);
CREATE INDEX idx_holdings_folio ON mf_holdings(folio_number);

-- ================================================================
-- 9. NAV SNAPSHOTS & HISTORY
-- Daily NAV data from AMFI. Used for LTV monitoring.
-- ================================================================
CREATE TABLE IF NOT EXISTS nav_history (
  nav_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  isin              VARCHAR(20) NOT NULL,
  scheme_name       TEXT,
  nav_date          DATE NOT NULL,
  nav_value         DECIMAL(15,4) NOT NULL,
  source            VARCHAR(50) DEFAULT 'AMFI',
  fetched_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(isin, nav_date)
);

CREATE INDEX idx_nav_isin ON nav_history(isin);
CREATE INDEX idx_nav_date ON nav_history(nav_date);

-- LTV monitoring snapshots per user per day
CREATE TABLE IF NOT EXISTS ltv_snapshots (
  snapshot_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  snapshot_date     DATE NOT NULL,
  total_pledge_value DECIMAL(15,2), -- current value of all pledged units
  total_outstanding DECIMAL(15,2), -- current credit line outstanding
  current_ltv       DECIMAL(5,4),  -- outstanding / pledge_value
  ltv_status        VARCHAR(20),   -- GREEN, AMBER, RED, MARGIN_CALL
  alert_sent        BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, snapshot_date)
);

CREATE INDEX idx_ltv_user ON ltv_snapshots(user_id);

-- ================================================================
-- 10. PLEDGES
-- Pledge records. IMMUTABLE — never delete or update core fields.
-- ================================================================
CREATE TABLE IF NOT EXISTS pledges (
  pledge_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),

  -- Folio / fund details
  folio_number      VARCHAR(50) NOT NULL,
  isin              VARCHAR(20) NOT NULL,
  scheme_name       TEXT,
  rta               VARCHAR(20) NOT NULL, -- CAMS or KFINTECH

  -- Pledge details
  units_pledged     DECIMAL(15,4) NOT NULL,
  nav_at_pledge     DECIMAL(15,4),
  value_at_pledge   DECIMAL(15,2),
  ltv_at_pledge     DECIMAL(4,3),
  eligible_value_at_pledge DECIMAL(15,2),

  -- Pledgee (always the NBFC, never LienPay)
  pledgee_name      TEXT NOT NULL, -- e.g. "FinServNBFC Ltd."
  pledgee_pan       VARCHAR(20),

  -- RTA reference
  pledge_ref_number TEXT UNIQUE, -- CAMS or KFintech reference
  rta_txn_id        TEXT,

  -- NBFC collateral reference
  nbfc_collateral_id TEXT,
  nbfc_confirmed_at  TIMESTAMPTZ,

  -- Status
  status            VARCHAR(50) DEFAULT 'INITIATED',
  -- INITIATED → OTP_PENDING → ACTIVE → MARGIN_CALL →
  -- INVOKED → RELEASED → CANCELLED

  -- Dates
  initiated_at      TIMESTAMPTZ DEFAULT NOW(),
  registered_at     TIMESTAMPTZ, -- when RTA confirmed
  released_at       TIMESTAMPTZ,
  release_ref       TEXT,

  -- Metadata
  created_at        TIMESTAMPTZ DEFAULT NOW()
  -- NO updated_at — this is append-only for compliance
);

CREATE INDEX idx_pledges_user ON pledges(user_id);
CREATE INDEX idx_pledges_folio ON pledges(folio_number);
CREATE INDEX idx_pledges_status ON pledges(status);

-- ================================================================
-- 11. PLEDGE INVOCATIONS
-- When a pledge is invoked on default. Immutable audit trail.
-- ================================================================
CREATE TABLE IF NOT EXISTS pledge_invocations (
  invocation_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pledge_id         UUID REFERENCES pledges(pledge_id),
  user_id           UUID REFERENCES users(user_id),

  -- Notice
  notice_sent_at    TIMESTAMPTZ,
  notice_channel    VARCHAR(50), -- EMAIL_AND_SMS
  cure_deadline     TIMESTAMPTZ, -- +3 business days from notice

  -- User response
  user_responded    BOOLEAN DEFAULT FALSE,
  user_response     VARCHAR(50), -- PLEDGED_MORE, REPAID, NO_ACTION

  -- Invocation
  invoked_at        TIMESTAMPTZ,
  units_to_redeem   DECIMAL(15,4),
  nav_at_invocation DECIMAL(15,4),
  expected_proceeds DECIMAL(15,2),

  -- Redemption
  redemption_ref    TEXT, -- CAMS/KFintech redemption reference
  redeemed_at       TIMESTAMPTZ,
  actual_proceeds   DECIMAL(15,2),

  -- Recovery
  outstanding_at_invocation DECIMAL(15,2),
  amount_recovered  DECIMAL(15,2),
  excess_proceeds   DECIMAL(15,2),
  excess_returned_at TIMESTAMPTZ,
  excess_return_utr TEXT,

  -- Status
  status            VARCHAR(50) DEFAULT 'NOTICE_SENT',
  -- NOTICE_SENT → CURED → INVOKED → REDEEMED → SETTLED

  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invocations_pledge ON pledge_invocations(pledge_id);
CREATE INDEX idx_invocations_user ON pledge_invocations(user_id);

-- ================================================================
-- 12. RISK DECISIONS
-- Every risk engine evaluation. Immutable for audit.
-- ================================================================
CREATE TABLE IF NOT EXISTS risk_decisions (
  decision_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  decision_type     VARCHAR(50), -- INITIAL_CREDIT, LIMIT_INCREASE, PERIODIC_REVIEW

  -- Inputs snapshot (what the engine saw)
  portfolio_ltv_value DECIMAL(15,2),
  bureau_score      INTEGER,
  bureau_score_band VARCHAR(20),
  kyc_type          VARCHAR(50),
  fraud_score       INTEGER,
  aml_result        VARCHAR(20),

  -- Adjustments applied
  bureau_adjustment DECIMAL(4,3), -- e.g. 1.0, 0.9, 0.0
  fraud_adjustment  DECIMAL(4,3),

  -- Output
  approved_limit    DECIMAL(15,2),
  risk_tier         VARCHAR(5),   -- A, B, C
  apr               DECIMAL(5,2), -- e.g. 15.99
  decision          VARCHAR(20),  -- APPROVED, REJECTED, MANUAL_REVIEW
  rejection_reason  TEXT,

  -- Metadata
  engine_version    VARCHAR(20) DEFAULT 'v1.0',
  decided_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_risk_user ON risk_decisions(user_id);

-- ================================================================
-- 13. CREDIT ACCOUNTS
-- The live credit line for each user.
-- ================================================================
CREATE TABLE IF NOT EXISTS credit_accounts (
  account_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id) UNIQUE,
  risk_decision_id  UUID REFERENCES risk_decisions(decision_id),

  -- NBFC sanction details
  nbfc_sanction_id  TEXT UNIQUE,
  nbfc_account_id   TEXT,

  -- Credit line
  credit_limit      DECIMAL(15,2) NOT NULL,
  available_credit  DECIMAL(15,2) NOT NULL,
  outstanding       DECIMAL(15,2) DEFAULT 0,

  -- Interest
  apr               DECIMAL(5,2) NOT NULL, -- Annual Percentage Rate
  interest_free_days INTEGER DEFAULT 30,

  -- UPI
  upi_vpa           VARCHAR(100), -- e.g. "9876543210@finservnbfc"
  upi_active        BOOLEAN DEFAULT FALSE,
  psp_bank          VARCHAR(100),

  -- Billing cycle
  billing_cycle_day INTEGER DEFAULT 1, -- day of month billing starts
  current_cycle_start DATE,
  current_cycle_end   DATE,
  due_date            DATE,

  -- NACH mandate
  nach_mandate_id   TEXT,
  nach_status       VARCHAR(50), -- REGISTERED, FAILED, NOT_SET
  nach_bank_account TEXT, -- masked e.g. "HDFC ••••4821"

  -- Account status
  status            VARCHAR(50) DEFAULT 'INACTIVE',
  -- INACTIVE → COOLING_OFF → ACTIVE → OVERDUE →
  -- MARGIN_CALL → DEFAULTED → CLOSED

  -- Cooling-off
  cooling_off_expires_at TIMESTAMPTZ,
  cooling_off_cancelled  BOOLEAN DEFAULT FALSE,

  -- KFS
  kfs_version       VARCHAR(20),
  kfs_accepted_at   TIMESTAMPTZ,

  -- Dates
  sanctioned_at     TIMESTAMPTZ,
  activated_at      TIMESTAMPTZ,
  closed_at         TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_credit_user ON credit_accounts(user_id);
CREATE INDEX idx_credit_status ON credit_accounts(status);
CREATE INDEX idx_credit_due ON credit_accounts(due_date);

-- ================================================================
-- 14. TRANSACTIONS
-- Every UPI transaction. Immutable after SETTLED.
-- ================================================================
CREATE TABLE IF NOT EXISTS transactions (
  txn_id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  account_id        UUID REFERENCES credit_accounts(account_id),

  -- Idempotency
  lsp_txn_ref       TEXT UNIQUE NOT NULL, -- LienPay's own reference
  nbfc_pre_auth_id  TEXT,

  -- UPI details
  utr               TEXT UNIQUE, -- NPCI Unique Transaction Reference
  merchant_vpa      TEXT NOT NULL,
  merchant_name     TEXT,
  mcc               VARCHAR(10), -- Merchant Category Code
  payer_vpa         TEXT, -- user's credit line VPA

  -- Amount
  amount            DECIMAL(15,2) NOT NULL,
  currency          CHAR(3) DEFAULT 'INR',

  -- Status lifecycle
  status            VARCHAR(50) DEFAULT 'INITIATED',
  -- INITIATED → PRE_AUTHORISED → PENDING → SETTLED → FAILED → REVERSED

  -- Timestamps per status
  initiated_at      TIMESTAMPTZ DEFAULT NOW(),
  pre_authed_at     TIMESTAMPTZ,
  pending_at        TIMESTAMPTZ,
  settled_at        TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  reversed_at       TIMESTAMPTZ,

  -- Settlement
  settlement_date   DATE, -- T+1 from NPCI
  nbfc_drawdown_id  TEXT,

  -- Interest tracking
  billing_cycle_start DATE,
  is_in_free_period   BOOLEAN DEFAULT TRUE,
  interest_if_unpaid  DECIMAL(15,2) DEFAULT 0,

  -- Failure / reversal
  failure_reason    TEXT,
  reversal_reason   TEXT,
  reversal_utr      TEXT,

  -- Dispute
  dispute_raised    BOOLEAN DEFAULT FALSE,
  dispute_id        UUID,

  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_txn_user ON transactions(user_id);
CREATE INDEX idx_txn_utr ON transactions(utr);
CREATE INDEX idx_txn_status ON transactions(status);
CREATE INDEX idx_txn_lsp_ref ON transactions(lsp_txn_ref);

-- ================================================================
-- 15. STATEMENTS
-- Monthly billing statements.
-- ================================================================
CREATE TABLE IF NOT EXISTS statements (
  statement_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  account_id        UUID REFERENCES credit_accounts(account_id),

  -- Period
  billing_period_start DATE NOT NULL,
  billing_period_end   DATE NOT NULL,
  due_date             DATE NOT NULL,

  -- Amounts
  opening_balance      DECIMAL(15,2) DEFAULT 0,
  total_drawdowns      DECIMAL(15,2) DEFAULT 0,
  total_repayments     DECIMAL(15,2) DEFAULT 0,
  interest_charged     DECIMAL(15,2) DEFAULT 0,
  fees_charged         DECIMAL(15,2) DEFAULT 0,
  total_due            DECIMAL(15,2) NOT NULL,
  minimum_due          DECIMAL(15,2),

  -- Interest calculation detail
  interest_bearing_balance DECIMAL(15,2) DEFAULT 0,
  days_in_period           INTEGER,
  daily_rate               DECIMAL(10,8),

  -- Counts
  transaction_count  INTEGER DEFAULT 0,

  -- Status
  status             VARCHAR(50) DEFAULT 'GENERATED',
  -- GENERATED → NOTIFIED → PAID → PARTIALLY_PAID → OVERDUE → BAD_DEBT

  -- PDF
  pdf_url            TEXT,

  generated_at       TIMESTAMPTZ DEFAULT NOW(),
  paid_at            TIMESTAMPTZ
);

CREATE INDEX idx_stmt_user ON statements(user_id);
CREATE INDEX idx_stmt_due ON statements(due_date);
CREATE INDEX idx_stmt_status ON statements(status);

-- ================================================================
-- 16. REPAYMENTS
-- Every repayment attempt and its result.
-- ================================================================
CREATE TABLE IF NOT EXISTS repayments (
  repayment_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  statement_id      UUID REFERENCES statements(statement_id),
  account_id        UUID REFERENCES credit_accounts(account_id),

  -- Payment details
  amount            DECIMAL(15,2) NOT NULL,
  payment_method    VARCHAR(50), -- UPI_COLLECT, NACH_DEBIT, NEFT, RTGS
  payment_ref       TEXT, -- UTR for UPI, NACH ref, etc.

  -- NACH specific
  nach_mandate_id   TEXT,
  nach_attempt_number INTEGER DEFAULT 1,

  -- Status
  status            VARCHAR(50) DEFAULT 'INITIATED',
  -- INITIATED → PENDING → SUCCESS → FAILED → BOUNCED

  initiated_at      TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ,
  failed_at         TIMESTAMPTZ,
  failure_reason    TEXT,

  -- NBFC webhook confirmation
  nbfc_confirmation_ref TEXT,
  nbfc_confirmed_at     TIMESTAMPTZ,

  -- Credit line restored after this repayment
  credit_restored   BOOLEAN DEFAULT FALSE,
  credit_restored_at TIMESTAMPTZ
);

CREATE INDEX idx_repay_user ON repayments(user_id);
CREATE INDEX idx_repay_stmt ON repayments(statement_id);

-- ================================================================
-- 17. MARGIN CALLS
-- Formal margin call records.
-- ================================================================
CREATE TABLE IF NOT EXISTS margin_calls (
  margin_call_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  account_id        UUID REFERENCES credit_accounts(account_id),

  -- LTV at time of call
  ltv_at_trigger    DECIMAL(5,4),
  outstanding_at_trigger DECIMAL(15,2),
  pledge_value_at_trigger DECIMAL(15,2),

  -- Notice
  issued_at         TIMESTAMPTZ DEFAULT NOW(),
  deadline          TIMESTAMPTZ, -- +3 business days
  notice_channels   JSONB DEFAULT '["EMAIL", "SMS", "PUSH"]',

  -- Resolution
  status            VARCHAR(50) DEFAULT 'ISSUED',
  -- ISSUED → RESOLVED_PLEDGE → RESOLVED_REPAYMENT → EXPIRED → INVOKED

  resolved_at       TIMESTAMPTZ,
  resolution_method VARCHAR(50), -- PLEDGE_TOPUP, REPAYMENT, INVOCATION

  -- If expired → invocation triggered
  invocation_id     UUID REFERENCES pledge_invocations(invocation_id),

  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_mc_user ON margin_calls(user_id);
CREATE INDEX idx_mc_status ON margin_calls(status);

-- ================================================================
-- 18. LSP INVOICES
-- LienPay's monthly invoices to the lending partner.
-- ================================================================
CREATE TABLE IF NOT EXISTS lsp_invoices (
  invoice_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_number    TEXT UNIQUE NOT NULL, -- e.g. "LP-2024-01-001"
  invoice_period_start DATE NOT NULL,
  invoice_period_end   DATE NOT NULL,

  -- Components
  new_accounts_count    INTEGER DEFAULT 0,
  sourcing_fee_amount   DECIMAL(15,2) DEFAULT 0, -- % of disbursed
  tech_fee_monthly      DECIMAL(15,2) DEFAULT 0,
  total_before_tax      DECIMAL(15,2) NOT NULL,
  gst_amount            DECIMAL(15,2) NOT NULL, -- 18%
  total_with_tax        DECIMAL(15,2) NOT NULL,

  -- Status
  status            VARCHAR(50) DEFAULT 'GENERATED',
  -- GENERATED → SENT → PAID → DISPUTED

  sent_at           TIMESTAMPTZ,
  paid_at           TIMESTAMPTZ,
  payment_ref       TEXT,

  -- PDF
  pdf_url           TEXT,
  generated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 19. NOTIFICATIONS
-- All notifications sent to users.
-- ================================================================
CREATE TABLE IF NOT EXISTS notifications (
  notification_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  type              VARCHAR(100) NOT NULL,
  -- OTP_SENT, TXN_SUCCESS, PAYMENT_DUE, MARGIN_CALL,
  -- PLEDGE_INVOCATION_NOTICE, NPA_WARNING, STATEMENT_READY
  channel           VARCHAR(20) NOT NULL, -- SMS, EMAIL, PUSH
  status            VARCHAR(20) DEFAULT 'PENDING', -- PENDING, SENT, DELIVERED, FAILED
  template_id       TEXT,
  content_preview   TEXT, -- first 100 chars, no PII
  sent_at           TIMESTAMPTZ,
  delivered_at      TIMESTAMPTZ,
  failure_reason    TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notif_user ON notifications(user_id);
CREATE INDEX idx_notif_type ON notifications(type);

-- ================================================================
-- 20. DISPUTES
-- Transaction dispute tracking.
-- ================================================================
CREATE TABLE IF NOT EXISTS disputes (
  dispute_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  txn_id            UUID REFERENCES transactions(txn_id),

  category          VARCHAR(100), -- WRONG_AMOUNT, DUPLICATE, NOT_INITIATED, MERCHANT_ISSUE
  description       TEXT,

  -- NPCI UDIR process
  npci_case_id      TEXT,
  status            VARCHAR(50) DEFAULT 'OPEN',
  -- OPEN → ACKNOWLEDGED → UNDER_REVIEW → RESOLVED → CLOSED

  provisional_credit DECIMAL(15,2), -- temporary credit to user while investigating
  resolution_amount  DECIMAL(15,2),
  resolution_notes   TEXT,

  opened_at         TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at   TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ
);

CREATE INDEX idx_disputes_user ON disputes(user_id);
CREATE INDEX idx_disputes_txn ON disputes(txn_id);

-- ================================================================
-- 21. GRIEVANCES
-- Customer complaints per RBI Fair Practices Code.
-- ================================================================
CREATE TABLE IF NOT EXISTS grievances (
  grievance_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID REFERENCES users(user_id),
  ticket_number     TEXT UNIQUE NOT NULL, -- e.g. "GR-2024-001234"

  category          VARCHAR(100),
  -- TXN_DISPUTE, BILLING_ERROR, PLEDGE_ISSUE, KYC_ISSUE,
  -- INTEREST_DISPUTE, MARGIN_CALL_QUERY, OTHER
  description       TEXT NOT NULL,
  attachments       JSONB DEFAULT '[]',

  -- SLA tracking (RBI mandates 30-day resolution)
  status            VARCHAR(50) DEFAULT 'OPEN',
  -- OPEN → ACKNOWLEDGED → UNDER_REVIEW → RESOLVED → ESCALATED → CLOSED
  acknowledged_at   TIMESTAMPTZ,
  sla_deadline      TIMESTAMPTZ, -- opened_at + 30 days
  resolved_at       TIMESTAMPTZ,
  resolution_notes  TEXT,

  -- Escalation (if not resolved in 30 days → Nodal Officer)
  escalated_at      TIMESTAMPTZ,
  escalated_to      VARCHAR(100), -- "Nodal Officer: Priya Mehta"

  opened_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_grievances_user ON grievances(user_id);
CREATE INDEX idx_grievances_status ON grievances(status);
CREATE INDEX idx_grievances_sla ON grievances(sla_deadline);

-- ================================================================
-- AUDIT TRAIL
-- Append-only log of all sensitive operations.
-- ================================================================
CREATE TABLE IF NOT EXISTS audit_trail (
  audit_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID, -- nullable (system events)
  admin_id          UUID, -- if admin action
  event_type        TEXT NOT NULL,
  entity_type       TEXT, -- "user", "pledge", "credit_account", etc.
  entity_id         UUID,
  old_values        JSONB, -- before change (sensitive fields masked)
  new_values        JSONB, -- after change
  ip_hash           TEXT,
  user_agent        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
  -- APPEND-ONLY. Never UPDATE or DELETE. Retained 7 years.
);

CREATE INDEX idx_audit_user ON audit_trail(user_id);
CREATE INDEX idx_audit_event ON audit_trail(event_type);
CREATE INDEX idx_audit_entity ON audit_trail(entity_type, entity_id);

-- ================================================================
-- TRIGGERS: auto-update updated_at
-- ================================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_kyc_updated_at
  BEFORE UPDATE ON kyc_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_credit_updated_at
  BEFORE UPDATE ON credit_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ================================================================
-- SEED: System configuration
-- ================================================================
CREATE TABLE IF NOT EXISTS system_config (
  key               TEXT PRIMARY KEY,
  value             TEXT NOT NULL,
  description       TEXT,
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO system_config (key, value, description) VALUES
  ('ltv_cap_equity',          '0.50', 'RBI LTV cap for equity mutual funds'),
  ('ltv_cap_debt',            '0.80', 'RBI LTV cap for debt mutual funds'),
  ('ltv_internal_buffer',     '0.10', 'Internal safety buffer on top of LTV cap'),
  ('ltv_amber_threshold',     '0.80', 'LTV ratio (of cap) that triggers amber alert'),
  ('ltv_red_threshold',       '0.90', 'LTV ratio (of cap) that triggers margin call'),
  ('cooling_off_days',        '3',    'Days user has to cancel credit line post-sanction'),
  ('margin_call_notice_days', '3',    'Business days notice before pledge invocation'),
  ('interest_free_days',      '30',   'Interest-free period on billing cycle'),
  ('apr_tier_a',              '14.99','APR for Risk Tier A borrowers'),
  ('apr_tier_b',              '15.99','APR for Risk Tier B borrowers'),
  ('apr_tier_c',              '17.99','APR for Risk Tier C borrowers'),
  ('bureau_min_score',        '600',  'Minimum bureau score to proceed'),
  ('fraud_score_max',         '70',   'Max fraud score allowed (0-100)'),
  ('otp_expiry_seconds',      '600',  'OTP validity in seconds'),
  ('otp_max_attempts',        '3',    'Max wrong OTP attempts before lockout'),
  ('otp_max_daily',           '5',    'Max OTP requests per mobile per day'),
  ('kfs_version',             'v1.0', 'Current KFS document version'),
  ('toc_version',             'v1.0', 'Current T&C version'),
  ('lsp_sourcing_fee_pct',    '1.80', 'LSP sourcing fee % of disbursed amount'),
  ('lsp_tech_fee_monthly',    '50000','LSP monthly technology service fee INR'),
  ('gst_rate',                '18.00','GST rate on LSP services %')
ON CONFLICT (key) DO NOTHING;

-- ================================================================
-- Done
-- ================================================================
COMMENT ON DATABASE lienpay_db IS 'LienPay - MF-Backed UPI Credit Line Platform';
