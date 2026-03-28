import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  submitKYCProfile, sendAadhaarOTP, verifyAadhaarOTP, submitCKYC, submitBureau,
  initiateAAConsent, fetchPortfolio, evaluateRisk,
  initiatePledge, confirmPledgeOTP, notifyNBFC,
  requestSanction, getKFS, acceptKFS, activateCredit, setupPIN,
} from '../api/client'
import useStore from '../store/useStore'
import { LiquidBlob } from '../components/LiquidUI'

// ─────────────────────────────────────────────────────────────
// DISPLAY METADATA FOR FUND CATEGORIES
// Used only for colours and labels in the UI.
// LTV rates come from the backend (fund.classifier.js) — not from here.
// Frontend reads h.ltv_cap from the backend response for calculations.
// ─────────────────────────────────────────────────────────────
const SCHEME_TYPE_DISPLAY = {
  EQUITY_LARGE_CAP:     { label: 'Large Cap',       color: '#3B82F6' },  // blue
  EQUITY_LARGE_MID_CAP: { label: 'Large & Mid Cap', color: '#06B6D4' },  // cyan
  EQUITY_MID_CAP:       { label: 'Mid Cap',         color: '#F59E0B' },  // amber
  EQUITY_SMALL_CAP:     { label: 'Small Cap',       color: '#EF4444' },  // red
  EQUITY_FLEXI_CAP:     { label: 'Flexi Cap',       color: '#8B5CF6' },  // purple
  EQUITY_ELSS:          { label: 'ELSS',            color: '#8B5CF6' },  // purple
  INDEX_FUND:           { label: 'Index Fund',      color: '#F472B6' },  // pink — distinct from jade
  ETF:                  { label: 'ETF',             color: '#F472B6' },
  DEBT_LIQUID:          { label: 'Liquid Debt',     color: '#22D3EE' },
  DEBT_SHORT_DUR:       { label: 'Short Duration',  color: '#22D3EE' },
  DEBT_CORPORATE:       { label: 'Corporate Bond',  color: '#22D3EE' },
  DEBT_GILT:            { label: 'Gilt',            color: '#22D3EE' },
  HYBRID_BALANCED:      { label: 'Balanced Hybrid', color: '#FB923C' },
  HYBRID_AGGRESSIVE:    { label: 'Aggressive Hybrid', color: '#FB923C' },
}

const getCategoryDisplay = (schemeType) =>
  SCHEME_TYPE_DISPLAY[schemeType] || { label: schemeType?.replace(/_/g, ' ') || 'Equity', color: '#7A8F85' }

// Parse LTV from backend ltv_cap field (e.g. "40%" or 0.40)
const parseLtvCap = (ltv_cap) => {
  if (typeof ltv_cap === 'string' && ltv_cap.includes('%')) return parseFloat(ltv_cap) / 100
  const n = parseFloat(ltv_cap || 0)
  return n > 1 ? n / 100 : n
}

const STEPS = [
  { id: 'KYC',       title: 'Verify Identity',  icon: '🪪', sub: 'PAN & Aadhaar' },
  { id: 'PORTFOLIO', title: 'Link Portfolio',    icon: '📊', sub: 'Connect mutual funds' },
  { id: 'PLEDGE',    title: 'Select & Pledge',   icon: '🔒', sub: 'Choose which funds' },
  { id: 'CREDIT',    title: 'Activate Credit',   icon: '✨', sub: 'Go live' },
]

const fmtL = (n) => {
  const v = parseFloat(n || 0)
  if (v >= 10000000) return `₹${(v / 10000000).toFixed(2)}Cr`
  if (v >= 100000)   return `₹${(v / 100000).toFixed(2)}L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}

const Field = ({ label, id, value, onChange, placeholder, type = 'text', maxLength }) => (
  <div style={{ marginBottom: 16 }}>
    <label htmlFor={id} style={{ display: 'block', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 8 }}>
      {label}
    </label>
    <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} maxLength={maxLength}
      style={{ width: '100%', height: 52, background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', borderRadius: 14, padding: '0 16px', fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)', outline: 'none' }}
      onFocus={e => e.target.style.borderColor = 'var(--jade-border)'}
      onBlur={e => e.target.style.borderColor = 'var(--border-light)'}
    />
  </div>
)

const CTA = ({ onClick, loading, label, disabled }) => (
  <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} disabled={loading || disabled}
    style={{ width: '100%', height: 56, borderRadius: 16, border: 'none', cursor: loading || disabled ? 'default' : 'pointer',
      background: loading || disabled ? 'var(--bg-elevated)' : 'linear-gradient(135deg, var(--jade), #00A878)',
      color: loading || disabled ? 'var(--text-muted)' : 'var(--bg-void)',
      fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-sans)', letterSpacing: '-0.3px',
      boxShadow: loading || disabled ? 'none' : '0 8px 28px rgba(0,212,161,0.2)', transition: 'all 0.2s' }}>
    {loading
      ? <span style={{ display: 'inline-block', width: 18, height: 18, border: '2px solid var(--text-muted)', borderTopColor: 'var(--jade)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      : label}
  </motion.button>
)

export default function Onboarding({ onComplete }) {
  const { setOnboardingStep } = useStore()
  const [currentStep, setCurrentStep] = useState('KYC')
  const [subStep, setSubStep]         = useState(0)
  const [loading, setLoading]         = useState(false)

  // KYC state
  const [pan, setPan]               = useState('')
  const [fullName, setFullName]     = useState('')
  const [dob, setDob]               = useState('')
  const [aadhaarTxn, setAadhaarTxn] = useState('')
  const [aadhaarOTP, setAadhaarOTP] = useState('')

  // Portfolio state — populated by backend response
  const [riskData, setRiskData]             = useState(null)
  const [holdings, setHoldings]             = useState([])
  const [selectedFolios, setSelectedFolios] = useState([])
  // Dropdown open state — collapsed by default
  const [openCategories, setOpenCategories] = useState({})

  // Pledge state
  const [pledges, setPledges] = useState([])

  const stepIndex = STEPS.findIndex(s => s.id === currentStep)

  // ── Eligible credit calculation ─────────────────────────────
  // Uses backend-computed eligible_credit as the authoritative value.
  // LTV rates are always calculated server-side (fund.classifier.js).
  // Frontend only does display — never overrides backend LTV rates.
  const calcEligible = (h) => {
    if (h.eligible_credit != null && parseFloat(h.eligible_credit) > 0) {
      return Math.round(parseFloat(h.eligible_credit))
    }
    // Fallback: compute from ltv_cap if eligible_credit not in response
    const val = parseFloat(h.current_value || h.value_at_fetch || 0)
    const ltv = parseLtvCap(h.ltv_cap)
    return Math.round(val * ltv)
  }

  const selectedEligible    = holdings.filter(h => selectedFolios.includes(h.folio_number) && h.is_eligible)
  const selectedCredit      = selectedEligible.reduce((s, h) => s + calcEligible(h), 0)
  const totalPortfolioValue = holdings.reduce((s, h) => s + parseFloat(h.current_value || h.value_at_fetch || 0), 0)

  const toggleFolio = (folio) =>
    setSelectedFolios(prev => prev.includes(folio) ? prev.filter(f => f !== folio) : [...prev, folio])

  // ── KYC ──────────────────────────────────────────────────────
  const handleKYCProfile = async () => {
    if (!pan || !fullName || !dob) return toast.error('Fill all fields')
    setLoading(true)
    try {
      await submitKYCProfile({ pan, full_name: fullName, date_of_birth: dob, email: `${pan.toLowerCase()}@lienpay.in` })
      const res = await sendAadhaarOTP({ aadhaar_last4: '3421', consent_given: 'true' })

      // Capture txn_id as local variable — state updates are async so setTimeout
      // would read stale empty string if we rely on aadhaarTxn state.
      const txnId = res.data.txn_id
      setAadhaarTxn(txnId)

      if (res.data?.dev_otp) {
        // Dev bypass — mirrors auth OTP pattern
        setAadhaarOTP(res.data.dev_otp)
        toast.success(`Aadhaar OTP: ${res.data.dev_otp} (auto-filled)`)
        setSubStep(1)
        setTimeout(() => handleAadhaarVerify(res.data.dev_otp, txnId), 800)
      } else {
        toast.success('PAN verified! OTP sent to your Aadhaar-linked mobile.')
        setSubStep(1)
      }
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // Accepts overrideOtp and overrideTxnId to avoid React state closure stale reads
  const handleAadhaarVerify = async (overrideOtp, overrideTxnId) => {
    const otpToUse = overrideOtp || aadhaarOTP
    const txnToUse = overrideTxnId || aadhaarTxn
    if (!otpToUse) return toast.error('Enter OTP')
    if (!txnToUse) return toast.error('Transaction ID missing — please go back and try again')
    setLoading(true)
    try {
      await verifyAadhaarOTP({ txn_id: txnToUse, otp: otpToUse })
      await submitCKYC()
      await submitBureau()
      toast.success('KYC Complete! ✓')
      setCurrentStep('PORTFOLIO')
      setSubStep(0)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // ── PORTFOLIO ─────────────────────────────────────────────────
  // Full backend flow:
  // 1. Backend creates AA consent (mock: instant | real: returns redirect URL)
  // 2. Backend fetches holdings via AA (mock: 38 curated funds | real: user's actual funds)
  // 3. Backend fetches live NAVs: AMFI by ISIN (real) + mfapi.in fallback (mock)
  // 4. Backend classifies, calculates LTV, saves to mf_holdings DB
  // 5. Backend runs risk engine → credit limit
  // 6. Frontend gets fully computed holdings — no client-side bypass needed
  //
  // Production switch: set AA_MODE=real, AADHAAR_MODE=real in Railway env.
  const handleLinkPortfolio = async () => {
    setLoading(true)
    try {
      toast.loading('Fetching your portfolio...', { id: 'portfolio-fetch' })

      // Step 1: create AA consent
      const consentRes = await initiateAAConsent()

      // Step 2: fetch + process (backend handles NAVs, LTV, classification, DB save)
      const portfolioRes = await fetchPortfolio(consentRes.data.consent_id)

      // Step 3: risk engine → credit limit
      const riskRes = await evaluateRisk()

      toast.dismiss('portfolio-fetch')

      const allHoldings = portfolioRes.data.holdings || []
      setRiskData(riskRes.data)
      setHoldings(allHoldings)
      setSelectedFolios(allHoldings.filter(h => h.is_eligible).map(h => h.folio_number))
      // Open all categories by default so user sees funds immediately
      const initialOpen = {}
      allHoldings.forEach(h => { initialOpen[h.scheme_type] = true })
      setOpenCategories(initialOpen)

      setSubStep(1)
      toast.success(`${portfolioRes.data.eligible_funds} eligible funds loaded!`)
    } catch (err) {
      toast.dismiss('portfolio-fetch')
      toast.error(err.message)
    }
    finally { setLoading(false) }
  }

  // ── PLEDGE ────────────────────────────────────────────────────
  const handleInitiatePledge = async () => {
    if (selectedFolios.length === 0) return toast.error('Select at least one fund')
    setLoading(true)
    try {
      const folios = selectedFolios.map(f => ({ folio_number: f }))
      const res = await initiatePledge(folios)
      setPledges(res.data.pledges)
      setSubStep(1)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const handleConfirmPledges = async () => {
    setLoading(true)
    try {
      const confirmed = []
      for (const pledge of pledges) {
        await confirmPledgeOTP(pledge.pledge_id, pledge.rta === 'CAMS' ? '123456' : '654321')
        confirmed.push(pledge.pledge_id)
      }
      await notifyNBFC(confirmed)
      toast.success('All pledges confirmed! ✓')
      setCurrentStep('CREDIT')
      setSubStep(0)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // ── CREDIT ────────────────────────────────────────────────────
  const handleActivateCredit = async () => {
    setLoading(true)
    try {
      const sanctionRes = await requestSanction()
      await getKFS({ sanction_id: sanctionRes.data.sanction_id, approved_limit: sanctionRes.data.sanctioned_limit, apr: sanctionRes.data.apr })
      await acceptKFS({ sanction_id: sanctionRes.data.sanction_id, kfs_version: 'v1.0' })
      await activateCredit()
      await setupPIN()
      toast.success('Credit line is live! 🎉')
      setOnboardingStep('ACTIVE')
      onComplete()
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-void)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <LiquidBlob size={280} color="var(--jade)" top="-100px" right="-80px" />
      <LiquidBlob size={160} color="var(--jade)" bottom="200px" left="-50px" delay={4} />

      {/* Progress */}
      <div style={{ position: 'relative', zIndex: 1, padding: '18px 24px 0', display: 'flex', gap: 6 }}>
        {STEPS.map((s, i) => (
          <motion.div key={s.id}
            animate={{ width: i === stepIndex ? 32 : 8, background: i <= stepIndex ? 'var(--jade)' : 'var(--bg-elevated)' }}
            transition={{ duration: 0.4 }}
            style={{ height: 4, borderRadius: 2 }} />
        ))}
      </div>

      {/* Step header */}
      <div style={{ position: 'relative', zIndex: 1, padding: '14px 24px 0', marginBottom: 4 }}>
        <AnimatePresence mode="wait">
          <motion.div key={currentStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 28 }}>{STEPS[stepIndex]?.icon}</span>
              <div>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 400 }}>{STEPS[stepIndex]?.title}</h2>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{STEPS[stepIndex]?.sub}</p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, flex: 1, overflowY: 'auto', padding: '16px 24px 24px' }}>
        <AnimatePresence mode="wait">

          {/* ── KYC 0: PAN ── */}
          {currentStep === 'KYC' && subStep === 0 && (
            <motion.div key="kyc0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <Field label="PAN NUMBER" id="pan" value={pan} onChange={v => setPan(v.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
              <Field label="FULL NAME (AS PER PAN)" id="fname" value={fullName} onChange={setFullName} placeholder="Rahul Sharma" />
              <Field label="DATE OF BIRTH" id="dob" value={dob} onChange={setDob} placeholder="1992-08-12" type="date" />
              <CTA onClick={handleKYCProfile} loading={loading} label="Verify PAN →" />
            </motion.div>
          )}

          {/* ── KYC 1: Aadhaar OTP ── */}
          {currentStep === 'KYC' && subStep === 1 && (
            <motion.div key="kyc1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 16, padding: '14px 16px', marginBottom: 20 }}>
                <p style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 700, marginBottom: 3 }}>✓ PAN Verified</p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Aadhaar OTP sent to your registered mobile</p>
              </div>
              <Field label="AADHAAR OTP" id="aadhaar-otp" value={aadhaarOTP} onChange={setAadhaarOTP} placeholder="6-digit OTP" type="tel" maxLength={6} />
              <CTA onClick={() => handleAadhaarVerify()} loading={loading} label="Complete KYC →" />
            </motion.div>
          )}

          {/* ── PORTFOLIO 0: Link ── */}
          {currentStep === 'PORTFOLIO' && subStep === 0 && (
            <motion.div key="port0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '28px 20px', marginBottom: 20, textAlign: 'center' }}>
                <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 4, repeat: Infinity }} style={{ fontSize: 48, marginBottom: 14 }}>🔗</motion.div>
                <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Connect your MF Portfolio</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  We'll securely fetch your holdings via Account Aggregator and calculate your eligible credit limit using live NAVs.
                </p>
              </div>
              {/* LTV rates reference */}
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', marginBottom: 20 }}>
                <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 8 }}>LTV BY CATEGORY (RBI MANDATE)</p>
                {[
                  { label: 'Large Cap',       rate: '40%', color: '#3B82F6' },
                  { label: 'Large & Mid Cap', rate: '35%', color: '#06B6D4' },
                  { label: 'Mid Cap',         rate: '40%', color: '#F59E0B' },
                  { label: 'Small Cap',       rate: '25%', color: '#EF4444' },
                  { label: 'Flexi Cap',       rate: '35%', color: '#8B5CF6' },
                  { label: 'Index Funds',     rate: '40%', color: '#F472B6' },
                ].map((r, i, arr) => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: r.color }} />
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.label}</span>
                    </div>
                    <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono)', color: r.color }}>{r.rate}</span>
                  </div>
                ))}
              </div>
              <CTA onClick={handleLinkPortfolio} loading={loading} label="Link via Account Aggregator →" />
              <p style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
                Secured by RBI-regulated Account Aggregator framework. We never store your credentials.
              </p>
            </motion.div>
          )}

          {/* ── PORTFOLIO 1: Fund selection (collapsible category dropdowns) ── */}
          {currentStep === 'PORTFOLIO' && subStep === 1 && (
            <motion.div key="port1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>

              {/* Info banner */}
              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '12px 14px', marginBottom: 14, display: 'flex', gap: 10 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>📡</span>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--jade)', marginBottom: 2 }}>LIVE NAVs · LTV CALCULATED SERVER-SIDE</p>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Fund values use today's real NAVs from AMFI. LTV rates are applied by the backend per RBI mandate — authoritative for all credit calculations.
                  </p>
                </div>
              </div>

              {/* Credit summary */}
              <div style={{ background: 'rgba(0,212,161,0.06)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '12px 16px', marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Eligible credit</span>
                  <span style={{ fontSize: 18, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>{fmtL(selectedCredit)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{selectedFolios.length} OF {holdings.length} SELECTED</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtL(totalPortfolioValue)} TOTAL VALUE</span>
                </div>
              </div>

              {/* Select all / clear all */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <button onClick={() => setSelectedFolios(holdings.filter(h => h.is_eligible).map(h => h.folio_number))}
                  style={{ flex: 1, height: 30, borderRadius: 8, fontSize: 11, fontWeight: 600, background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                  Select all
                </button>
                <button onClick={() => setSelectedFolios([])}
                  style={{ flex: 1, height: 30, borderRadius: 8, fontSize: 11, fontWeight: 600, background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
                  Clear all
                </button>
              </div>

              {/* ── COLLAPSIBLE CATEGORY DROPDOWNS ──
                  Colors: all distinct from jade (#00D4A1) which is the selected state.
                  Tap category header to expand/collapse.
                  Tap ✓/+ button in header to select/deselect all in that category.
              ── */}
              {(() => {
                // Group holdings by scheme_type preserving order
                const seen = [], categories = {}
                holdings.forEach(h => {
                  if (!categories[h.scheme_type]) {
                    seen.push(h.scheme_type)
                    categories[h.scheme_type] = { funds: [] }
                  }
                  categories[h.scheme_type].funds.push(h)
                })

                return seen.map(schemeType => {
                  const group        = categories[schemeType]
                  const display      = getCategoryDisplay(schemeType)
                  const color        = display.color
                  const isOpen       = openCategories[schemeType] !== false
                  const catFolios    = group.funds.filter(f => f.is_eligible).map(f => f.folio_number)
                  const catSelected  = catFolios.filter(f => selectedFolios.includes(f)).length
                  const allSelected  = catFolios.length > 0 && catSelected === catFolios.length
                  const catEligible  = group.funds
                    .filter(f => selectedFolios.includes(f.folio_number))
                    .reduce((s, f) => s + calcEligible(f), 0)
                  // Get LTV from first fund in category (all same type = same LTV)
                  const ltv = parseLtvCap(group.funds[0]?.ltv_cap)

                  return (
                    <div key={schemeType} style={{ marginBottom: 6 }}>
                      {/* Category header */}
                      <div
                        onClick={() => setOpenCategories(prev => ({ ...prev, [schemeType]: !isOpen }))}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px',
                          borderRadius: isOpen ? '12px 12px 0 0' : 12,
                          background: `${color}10`, border: `1px solid ${color}22`,
                          borderBottom: isOpen ? `1px solid ${color}12` : `1px solid ${color}22`,
                          cursor: 'pointer', userSelect: 'none' }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{display.label}</span>
                        {/* LTV badge — from backend value */}
                        <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color, background: `${color}18`, padding: '2px 8px', borderRadius: 4 }}>
                          {Math.round(ltv * 100)}% LTV
                        </span>
                        {/* Selected count */}
                        {catSelected > 0 ? (
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--jade)', fontWeight: 600 }}>
                            {catSelected}/{group.funds.length} · {fmtL(catEligible)}
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            {group.funds.length} funds
                          </span>
                        )}
                        {/* Select all toggle */}
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            if (allSelected) {
                              setSelectedFolios(prev => prev.filter(f => !catFolios.includes(f)))
                            } else {
                              setSelectedFolios(prev => [...new Set([...prev, ...catFolios])])
                            }
                          }}
                          style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, cursor: 'pointer',
                            background: allSelected ? color : 'var(--bg-elevated)',
                            border: allSelected ? 'none' : `1.5px solid ${color}40`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 900, color: allSelected ? '#fff' : color }}>
                          {allSelected ? '✓' : '+'}
                        </button>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'inline-block', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>▼</span>
                      </div>

                      {/* Fund list */}
                      {isOpen && (
                        <div style={{ border: `1px solid ${color}18`, borderTop: 'none', borderRadius: '0 0 12px 12px', overflow: 'hidden' }}>
                          {group.funds.map((h, fi) => {
                            const selected  = selectedFolios.includes(h.folio_number)
                            const eligible  = calcEligible(h)
                            const fundValue = parseFloat(h.current_value || h.value_at_fetch || 0)
                            return (
                              <div key={h.folio_number}
                                onClick={() => h.is_eligible && toggleFolio(h.folio_number)}
                                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
                                  background: selected ? 'rgba(0,212,161,0.04)' : 'var(--bg-surface)',
                                  borderBottom: fi < group.funds.length - 1 ? '1px solid var(--border)' : 'none',
                                  cursor: h.is_eligible ? 'pointer' : 'default',
                                  opacity: h.is_eligible ? 1 : 0.4 }}>
                                {/* Checkbox — jade green, totally separate from category colors */}
                                <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, transition: 'all 0.15s',
                                  background: selected ? 'var(--jade)' : 'var(--bg-elevated)',
                                  border: selected ? 'none' : '1.5px solid var(--border-light)',
                                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  {selected && <span style={{ fontSize: 11, color: 'var(--bg-void)', fontWeight: 900, lineHeight: 1 }}>✓</span>}
                                </div>
                                {/* Fund info */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <p style={{ fontSize: 12, fontWeight: selected ? 600 : 400,
                                    color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 1 }}>
                                    {h.scheme_name}
                                  </p>
                                  <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{h.rta}</span>
                                </div>
                                {/* Value and eligible */}
                                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                                  <p style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginBottom: 1 }}>
                                    {fmtL(fundValue)}
                                  </p>
                                  <p style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: selected ? 600 : 400,
                                    color: selected ? 'var(--jade)' : 'var(--text-muted)' }}>
                                    → {fmtL(eligible)}
                                  </p>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })
              })()}

              <div style={{ height: 12 }} />
              <CTA onClick={() => { setCurrentStep('PLEDGE'); setSubStep(0) }}
                loading={false}
                label={`Pledge Selected · ${fmtL(selectedCredit)} →`}
                disabled={selectedFolios.length === 0} />
            </motion.div>
          )}

          {/* ── PLEDGE 0: Review + Initiate ── */}
          {currentStep === 'PLEDGE' && subStep === 0 && (
            <motion.div key="pledge0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                Your selected funds will be lien-marked with CAMS/KFintech. You retain ownership — units keep growing but can't be redeemed while pledged.
              </p>
              {selectedFolios.map(folio => {
                const h = holdings.find(x => x.folio_number === folio)
                if (!h) return null
                const display  = getCategoryDisplay(h.scheme_type)
                const eligible = calcEligible(h)
                const ltv      = parseLtvCap(h.ltv_cap)
                return (
                  <div key={folio} style={{ background: 'var(--bg-surface)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '14px 16px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: display.color }}>{h.rta} · {display.label}</span>
                        <p style={{ fontSize: 13, fontWeight: 500, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.scheme_name}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      <div>
                        <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '1.5px', fontFamily: 'var(--font-mono)', marginBottom: 3 }}>FUND VALUE</p>
                        <p style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>{fmtL(h.current_value || h.value_at_fetch || 0)}</p>
                      </div>
                      <div style={{ textAlign: 'center' }}>
                        <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '1.5px', fontFamily: 'var(--font-mono)', marginBottom: 3 }}>LTV CAP</p>
                        <p style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)', color: display.color }}>{Math.round(ltv * 100)}%</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '1.5px', fontFamily: 'var(--font-mono)', marginBottom: 3 }}>ELIGIBLE CREDIT</p>
                        <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>{fmtL(eligible)}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total eligible credit</span>
                <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>{fmtL(selectedCredit)}</span>
              </div>
              <CTA onClick={handleInitiatePledge} loading={loading} label="Initiate Pledge with RTA →" />
            </motion.div>
          )}

          {/* ── PLEDGE 1: Confirm OTPs ── */}
          {currentStep === 'PLEDGE' && subStep === 1 && (
            <motion.div key="pledge1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                RTAs have sent OTPs to confirm lien marking. In dev mode these are auto-confirmed.
              </p>
              {pledges.map(pledge => {
                const h        = holdings.find(x => x.folio_number === pledge.folio_number)
                const display  = getCategoryDisplay(pledge.scheme_type || h?.scheme_type)
                const eligible = parseFloat(pledge.pledge_value || pledge.eligible_credit || 0) || (h ? calcEligible(h) : 0)
                return (
                  <div key={pledge.pledge_id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '14px 16px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: display.color }}>{pledge.rta}</span>
                        <p style={{ fontSize: 13, fontWeight: 500, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {pledge.scheme_name || h?.scheme_name || `Folio ${pledge.folio_number}`}
                        </p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '1.5px', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>ELIGIBLE</p>
                        <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>{fmtL(eligible)}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--jade)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--bg-void)', fontWeight: 700 }}>✓</div>
                      <span style={{ fontSize: 11, color: 'var(--jade)' }}>OTP confirmed (dev mode)</span>
                    </div>
                  </div>
                )
              })}
              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total credit limit</span>
                <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>{fmtL(selectedCredit)}</span>
              </div>
              <CTA onClick={handleConfirmPledges} loading={loading} label="Confirm All Pledges →" />
            </motion.div>
          )}

          {/* ── CREDIT 0: KFS + Activate ── */}
          {currentStep === 'CREDIT' && subStep === 0 && (
            <motion.div key="credit0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px', marginBottom: 16 }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', marginBottom: 14 }}>KEY FACT STATEMENT</div>
                {[
                  { k: 'Credit Limit',         v: fmtL(riskData?.credit_limit || selectedCredit), c: 'var(--jade)' },
                  { k: 'Annual Interest Rate',  v: `${riskData?.apr || '14.99'}% p.a.` },
                  { k: 'Interest-Free Period',  v: '30 days per transaction' },
                  { k: 'Processing Fee',        v: '₹0 (waived)' },
                  { k: 'Lender',               v: 'FinServ NBFC Ltd.' },
                ].map((row, i, arr) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.k}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: row.c || 'var(--text-primary)' }}>{row.v}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '12px 14px', marginBottom: 18, display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>ℹ️</span>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>By activating, you agree to the KFS terms. Interest accrues only on amounts used beyond the free period.</p>
              </div>
              <CTA onClick={handleActivateCredit} loading={loading} label="Accept & Activate Credit Line →" />
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
