# LienPay Backend

MF-Backed UPI Credit Line — Backend API

---

## Quick Start (5 minutes)

### Option A — With Docker (recommended, zero setup)

```bash
# 1. Clone the repo
git clone https://github.com/Gagangeeth2003/LienPay.git
cd LienPay

# 2. Copy environment config
cp backend/.env.example backend/.env

# 3. Start everything (PostgreSQL + Redis + Backend)
docker-compose up -d

# 4. Check it's running
curl http://localhost:3000/health
```

### Option B — Without Docker

```bash
cd backend
npm install
cp .env.example .env
# Edit .env with your PostgreSQL and Redis credentials
node database/migrate.js   # creates all tables
npm run dev                # starts with auto-reload
```

---

## What's Running

| Service    | Port  | What it is           |
|------------|-------|----------------------|
| Backend    | 3000  | LienPay API server   |
| PostgreSQL | 5432  | Main database        |
| Redis      | 6379  | Sessions + OTP cache |

---

## API Health Check

```
GET http://localhost:3000/health
```

Returns:
```json
{
  "status": "ok",
  "service": "LienPay Backend",
  "version": "1.0.0"
}
```

---

## Systems Built So Far

- [x] System 1 — Foundation, Database, Config
- [ ] System 2 — Authentication & OTP
- [ ] System 3 — KYC & Identity
- [ ] System 4 — MF Portfolio & AA
- [ ] System 5 — Risk Engine
- [ ] System 6 — Pledge Management
- [ ] System 7 — Credit Line & UPI
- [ ] System 8 — UPI Transactions
- [ ] System 9 — Billing & Repayment
- [ ] System 10 — NAV Monitoring
- [ ] System 11 — Frontend App

---

## Database Tables

21 tables covering the complete credit line lifecycle:
users, sessions, otp_logs, consent_logs, kyc_records,
aml_checks, bureau_results, mf_holdings, nav_history,
ltv_snapshots, pledges, pledge_invocations, risk_decisions,
credit_accounts, transactions, statements, repayments,
margin_calls, lsp_invoices, notifications, disputes,
grievances, audit_trail, system_config

---

## Mock vs Real APIs

All external APIs (CAMS, CIBIL, UIDAI, NBFC, NPCI) are
mocked during development. Switch each to real by changing
one line in `.env`:

```
CAMS_MODE=mock   →   CAMS_MODE=real
```

---

## Deploy to Railway (free)

1. Go to railway.app
2. Click "Login with GitHub"
3. Click "New Project" → "Deploy from GitHub"
4. Select "Gagangeeth2003/LienPay"
5. Add environment variables from .env.example
6. Done — live URL generated automatically
