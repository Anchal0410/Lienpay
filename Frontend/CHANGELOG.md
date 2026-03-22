# LienPay Frontend V3 — Redesign

## What Changed

### Design System (`index.css`)
- **New palette**: Black + Green (jade) primary — `--jade: #00D4A1`
- **Typography**: Fraunces (display), Manrope (body), JetBrains Mono (data)
- **Animations**: Liquid morphing blobs, scroll-driven reveals, parallax, pulse rings
- **All CSS variables renamed** to match new system

### New Components
- `components/Logo.jsx` — Lienzo brand mark (SVG + PNG), wordmark variants
- `components/LiquidUI.jsx` — LiquidBlob, ScrollReveal, CreditRing, useScrollY hook
- `components/NavBar.jsx` — Redesigned with jade accents and mono labels

### Redesigned Screens
- `screens/Splash.jsx` — Lienzo logo with liquid blobs, loading bar
- `screens/Auth.jsx` — **OTP boxes FIXED** (flexible grid, never overflows)
- `screens/Onboarding.jsx` — Full 4-step flow with correct math breakdowns
- `screens/Dashboard.jsx` — Liquid scroll, parallax blobs, CreditRing, CLOU badge

### Math Fixes
- LTV ratio = outstanding / max_eligible (weighted by per-fund LTV caps)
- Credit limit shows calculation: value × LTV cap per fund
- Onboarding fund selection shows live breakdown as user selects/deselects

### Kept Unchanged
- `api/client.js` — Same API endpoints
- `store/useStore.js` — Same Zustand store
- `App.jsx` — Same routing/state logic
- Backend — No changes needed

## Deploy
```bash
cd Frontend
npm install
npm run dev
```
