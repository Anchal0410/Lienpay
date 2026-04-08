import { useState, useRef } from 'react'
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

// ── Premium SVG icons (no emojis) ────────────────────────────
const Icon = {
  Identity: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.5" strokeLinecap="round">
      <rect x="2" y="5" width="20" height="14" rx="2"/>
      <circle cx="8" cy="12" r="2.5"/>
      <path d="M13 10h5M13 14h3"/>
    </svg>
  ),
  Portfolio: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.5" strokeLinecap="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  Pledge: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.5" strokeLinecap="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  Credit: () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.5" strokeLinecap="round">
      <rect x="1" y="4" width="22" height="16" rx="2"/>
      <line x1="1" y1="10" x2="23" y2="10"/>
    </svg>
  ),
  Check: () => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17L4 12"/></svg>
  ),
  Link: () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.2" strokeLinecap="round">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
    </svg>
  ),
  Checkmark: () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.2" strokeLinecap="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
  ),
  Sparkle: () => (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.2" strokeLinecap="round">
      <path d="M12 2l2.4 7.2H22l-6.2 4.5 2.4 7.3L12 17l-6.2 4 2.4-7.3L2 9.2h7.6z"/>
    </svg>
  ),
  Lock: () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
}

// ── Map backend step → internal ───────────────────────────────
const mapBackendStepToInternal = (s) => {
  if (!s) return 'KYC'
  const v = s.toUpperCase()
  if (v.includes('PORTFOLIO') || v.includes('RISK'))  return 'PORTFOLIO'
  if (v.includes('PLEDGE') && !v.includes('CREDIT'))  return 'PLEDGE'
  if (v.includes('CREDIT') || v.includes('SANCTION')) return 'CREDIT'
  return 'KYC'
}

const LTV_CAPS = {
  EQUITY_LARGE_CAP:      { pct: 40, label: 'Large Cap Equity',   color: '#00D4A1' },
  EQUITY_LARGE_MID_CAP:  { pct: 35, label: 'Large & Mid Cap',    color: '#8B7BD4' },
  EQUITY_MID_CAP:        { pct: 30, label: 'Mid Cap Equity',      color: '#C9A449' },
  EQUITY_SMALL_CAP:      { pct: 25, label: 'Small Cap Equity',    color: '#E05252' },
  EQUITY_FLEXI_CAP:      { pct: 35, label: 'Flexi Cap',           color: '#8B7BD4' },
  HYBRID_BALANCED:       { pct: 50, label: 'Balanced Hybrid',     color: '#C9A449' },
  DEBT_SHORT_DUR:        { pct: 70, label: 'Short Duration Debt', color: '#4DA8FF' },
  DEBT_LIQUID:           { pct: 80, label: 'Liquid / Overnight',  color: '#06B6D4' },
}

const STEPS = [
  { id: 'KYC',       title: 'Verify Identity',   IconComp: Icon.Identity,  sub: 'PAN & Aadhaar' },
  { id: 'PORTFOLIO', title: 'Link Portfolio',     IconComp: Icon.Portfolio, sub: 'Connect mutual funds' },
  { id: 'PLEDGE',    title: 'Select & Pledge',    IconComp: Icon.Pledge,    sub: 'Choose which funds' },
  { id: 'CREDIT',    title: 'Activate Credit',    IconComp: Icon.Credit,    sub: 'Go live' },
]

const fmtL = (n) => { const v = parseFloat(n || 0); return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` }

const CTA = ({ onClick, loading, label, disabled }) => (
  <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} disabled={loading || disabled}
    style={{ width: '100%', height: 54, borderRadius: 16, border: 'none', background: (loading || disabled) ? 'var(--bg-elevated)' : 'linear-gradient(135deg, #00D4A1, #00A878)', color: (loading || disabled) ? 'var(--text-muted)' : '#000000', fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)', cursor: (loading || disabled) ? 'not-allowed' : 'pointer', boxShadow: (loading || disabled) ? 'none' : '0 8px 24px rgba(0,212,161,0.2)' }}>
    {loading ? <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}><motion.span animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>⟳</motion.span>Processing…</span> : label}
  </motion.button>
)

const Field = ({ label, id, value, onChange, placeholder, type = 'text', maxLength }) => (
  <div style={{ marginBottom: 16 }}>
    <label htmlFor={id} style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500, display: 'block', marginBottom: 8 }}>{label}</label>
    <input id={id} name={id} type={type} inputMode={type === 'tel' ? 'numeric' : undefined}
      value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} autoComplete="off"
      style={{ width: '100%', height: 52, borderRadius: 14, padding: '0 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-light)', fontSize: 15, fontFamily: type === 'tel' ? 'var(--font-mono)' : 'var(--font-sans)', color: 'var(--text-primary)', outline: 'none' }} />
  </div>
)

export default function Onboarding({ onComplete }) {
  const { onboardingStep, setOnboardingStep } = useStore()

  const resumeStep = mapBackendStepToInternal(onboardingStep)
  const [currentStep, setCurrentStep] = useState(resumeStep)
  const [subStep, setSubStep]         = useState(0)
  const [loading, setLoading]         = useState(false)
  const verifyingRef = useRef(false)

  const [pan, setPan]               = useState('')
  const [fullName, setFullName]     = useState('')
  const [dob, setDob]               = useState('')
  const [aadhaarTxn, setAadhaarTxn] = useState('')
  const [aadhaarOTP, setAadhaarOTP] = useState('')
  const [riskData, setRiskData]     = useState(null)
  const [holdings, setHoldings]     = useState([])
  const [selectedFolios, setSelectedFolios] = useState([])
  const [pledges, setPledges]       = useState([])

  const stepIndex = STEPS.findIndex(s => s.id === currentStep)
  const isResuming = resumeStep !== 'KYC' && onboardingStep && onboardingStep !== 'AUTH'

  const parseLtv = (h) => { const raw = h.ltv_cap; if (typeof raw === 'string' && raw.includes('%')) return parseFloat(raw) / 100; const num = parseFloat(raw || 0); return num > 1 ? num / 100 : num }
  const calcEligible = (h) => Math.round(parseFloat(h.eligible_credit || 0) || Math.round(parseFloat(h.current_value || h.value_at_fetch || 0) * parseLtv(h)))
  const fmtPct       = (h) => `${(parseLtv(h) * 100).toFixed(0)}%`

  const selectedEligible = holdings.filter(h => selectedFolios.includes(h.folio_number) && h.is_eligible)
  const selectedCredit   = selectedEligible.reduce((s, h) => s + calcEligible(h), 0)

  // ── KYC ──────────────────────────────────────────────────────
  const handleKYCProfile = async () => {
    if (!pan || !fullName || !dob) return toast.error('Fill all fields')
    setLoading(true)
    try {
      await submitKYCProfile({ pan, full_name: fullName, date_of_birth: dob, email: `${pan.toLowerCase()}@lienpay.in` })
      const res = await sendAadhaarOTP({ aadhaar_last4: '3421', consent_given: 'true' })
      setAadhaarTxn(res.data.txn_id)
      const devOtp = res.data?.dev_otp || res.data?.otp
      if (devOtp) {
        setAadhaarOTP(String(devOtp))
        toast.success(`PAN verified — Aadhaar OTP: ${devOtp}`)
        setSubStep(1)
        setTimeout(() => { if (!verifyingRef.current) handleAadhaarVerifyWithOTP(res.data.txn_id, String(devOtp)) }, 900)
      } else {
        toast.success('PAN verified — OTP sent')
        setSubStep(1)
      }
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const handleAadhaarVerifyWithOTP = async (txnId, otp) => {
    if (verifyingRef.current) return; verifyingRef.current = true
    setLoading(true)
    try {
      await verifyAadhaarOTP({ txn_id: txnId, otp })
      await submitCKYC(); await submitBureau()
      toast.success('KYC Complete')
      setCurrentStep('PORTFOLIO'); setSubStep(0)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false); verifyingRef.current = false }
  }

  const handleAadhaarVerify = async () => {
    if (!aadhaarOTP) return toast.error('Enter OTP')
    await handleAadhaarVerifyWithOTP(aadhaarTxn, aadhaarOTP)
  }

  // ── PORTFOLIO ─────────────────────────────────────────────────
  const handleLinkPortfolio = async () => {
    setLoading(true)
    try {
      const consentRes   = await initiateAAConsent()
      const portfolioRes = await fetchPortfolio(consentRes.data.consent_id)
      const riskRes      = await evaluateRisk()
      const all = portfolioRes.data.holdings || []
      const top4 = all.filter(h => h.is_eligible).sort((a, b) => parseFloat(b.current_value || b.value_at_fetch || 0) - parseFloat(a.current_value || a.value_at_fetch || 0)).slice(0, 4)
      setHoldings(top4)
      setSelectedFolios(top4.map(h => h.folio_number))
      setRiskData(riskRes.data)
      toast.success(`${top4.length} mutual funds loaded`)
      setSubStep(1)
    } catch (err) { toast.error(err.message || 'Failed to link portfolio') }
    finally { setLoading(false) }
  }

  const toggleFolio = (folio) => setSelectedFolios(prev => prev.includes(folio) ? prev.filter(f => f !== folio) : [...prev, folio])

  // ── PLEDGE ────────────────────────────────────────────────────
  const handleInitiatePledge = async () => {
    if (selectedFolios.length === 0) return toast.error('Select at least one fund')
    setLoading(true)
    try {
      const res = await initiatePledge(selectedFolios.map(f => ({ folio_number: f })))
      setPledges(res.data.pledges)
      setSubStep(1)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const handleConfirmPledges = async () => {
    setLoading(true)
    try {
      const confirmed = []
      for (const pledge of pledges) { await confirmPledgeOTP(pledge.pledge_id, pledge.rta === 'CAMS' ? '123456' : '654321'); confirmed.push(pledge.pledge_id) }
      await notifyNBFC(confirmed)
      toast.success('Pledges confirmed')
      setCurrentStep('CREDIT'); setSubStep(0)
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
      await activateCredit(); await setupPIN()
      toast.success('Credit line activated')
      setOnboardingStep('ACTIVE')
      if (onComplete) onComplete()
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const CurrentStepIcon = STEPS[stepIndex]?.IconComp || Icon.Identity

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-void)', overflow: 'hidden' }}>
      <LiquidBlob size={240} color="var(--jade)" top="-50px" left="-40px" />
      <LiquidBlob size={170} color="var(--jade)" bottom="80px" right="-30px" delay={2} />

      <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '20px 20px 40px', paddingTop: 'calc(20px + env(safe-area-inset-top))' }}>

        {/* Step progress */}
        <div style={{ display: 'flex', gap: 6, marginBottom: isResuming ? 10 : 28 }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= stepIndex ? 'var(--jade)' : 'var(--bg-elevated)', opacity: i <= stepIndex ? 1 : 0.35, transition: 'all 0.4s' }} />
          ))}
        </div>

        {/* Resume banner */}
        {isResuming && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 12, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.5"/></svg>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--jade)' }}>Resuming from {STEPS[stepIndex]?.title}</p>
              <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>Your previous progress is saved</p>
            </div>
          </motion.div>
        )}

        {/* Step header — premium SVG icon, no emoji */}
        <motion.div key={currentStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: 18, background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <CurrentStepIcon />
            </div>
            <div>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 400, lineHeight: 1.1 }}>{STEPS[stepIndex]?.title}</h1>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{STEPS[stepIndex]?.sub}</p>
            </div>
          </div>
        </motion.div>

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
              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 16, padding: '14px 16px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ flexShrink: 0, color: 'var(--jade)' }}><Icon.Check /></div>
                <div>
                  <p style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 700, marginBottom: 2 }}>PAN Verified</p>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Aadhaar OTP sent to your registered mobile</p>
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500, display: 'block', marginBottom: 8 }}>AADHAAR OTP</label>
                <input id="aadhaar-otp" type="tel" inputMode="numeric" maxLength={6} value={aadhaarOTP}
                  onChange={e => setAadhaarOTP(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit OTP" autoComplete="one-time-code"
                  style={{ width: '100%', height: 52, borderRadius: 14, padding: '0 16px', background: 'var(--bg-surface)', border: `1px solid ${aadhaarOTP.length === 6 ? 'var(--jade)' : 'var(--border-light)'}`, fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.3em', textAlign: 'center', outline: 'none' }} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>Dev mode — auto-filling and proceeding…</p>
              <CTA onClick={handleAadhaarVerify} loading={loading} label="Complete KYC →" disabled={aadhaarOTP.length !== 6} />
            </motion.div>
          )}

          {/* ── PORTFOLIO 0: Link ── */}
          {currentStep === 'PORTFOLIO' && subStep === 0 && (
            <motion.div key="port0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '24px 20px', marginBottom: 16, textAlign: 'center' }}>
                <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 3, repeat: Infinity }} style={{ display: 'flex', justifyContent: 'center', marginBottom: 14, color: 'var(--jade)' }}>
                  <Icon.Link />
                </motion.div>
                <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Connect your Mutual Fund Portfolio</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                  We'll securely fetch your holdings via Account Aggregator and calculate your eligible credit limit.
                </p>
                <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 12, padding: '12px 14px', textAlign: 'left' }}>
                  <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 700, marginBottom: 4 }}>Dev / Demo Mode</p>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 10 }}>
                    Mock Account Aggregator active — top 4 funds from our curated universe of <strong style={{ color: 'var(--jade)' }}>38 eligible mutual fund schemes</strong>.
                  </p>
                  <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 7 }}>LTV CAPS BY CATEGORY</p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {Object.entries(LTV_CAPS).map(([key, val]) => (
                      <div key={key} style={{ display: 'flex', justifyContent: 'space-between', background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: '4px 8px' }}>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{val.label}</span>
                        <span style={{ fontSize: 9, color: val.color, fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{val.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <CTA onClick={handleLinkPortfolio} loading={loading} label="Link Mutual Fund Portfolio →" />
            </motion.div>
          )}

          {/* ── PORTFOLIO 1: Fund Selection ── */}
          {currentStep === 'PORTFOLIO' && subStep === 1 && (
            <motion.div key="port1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}
                style={{ background: 'linear-gradient(135deg, var(--jade-dim), var(--jade-glow))', border: '1px solid var(--jade-border)', borderRadius: 20, padding: '20px', textAlign: 'center', marginBottom: 16 }}>
                <p style={{ fontSize: 10, color: 'var(--jade)', letterSpacing: '2.5px', marginBottom: 6, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>YOUR CREDIT LIMIT</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 42, color: 'var(--jade)', lineHeight: 1, marginBottom: 4 }}>
                  {fmtL(selectedCredit > 0 ? selectedCredit : riskData?.approved_limit || 0)}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{riskData?.apr || 12}% APR · {riskData?.risk_tier === 'A' ? 'Prime' : riskData?.risk_tier === 'B' ? 'Standard' : 'Starter'} plan</p>
              </motion.div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)' }}>SELECT MUTUAL FUNDS TO PLEDGE</p>
                <p style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)' }}>{selectedFolios.length}/{holdings.length}</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {holdings.map((h) => {
                  const isSel = selectedFolios.includes(h.folio_number)
                  const ltvPct = (parseLtv(h) * 100).toFixed(0)
                  const ltvColor = LTV_CAPS[h.scheme_type]?.color || 'var(--jade)'
                  const eligible = calcEligible(h)
                  const value = parseFloat(h.current_value || h.value_at_fetch || 0)
                  return (
                    <motion.div key={h.folio_number} whileTap={{ scale: 0.98 }} onClick={() => toggleFolio(h.folio_number)}
                      style={{ background: isSel ? 'var(--jade-dim)' : 'var(--bg-surface)', border: `1px solid ${isSel ? 'var(--jade-border)' : 'var(--border)'}`, borderRadius: 16, padding: '14px 16px', cursor: 'pointer', transition: 'all 0.2s' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                        <div style={{ width: 22, height: 22, borderRadius: 8, flexShrink: 0, background: isSel ? 'var(--jade)' : 'var(--bg-elevated)', border: `1.5px solid ${isSel ? 'var(--jade)' : 'var(--border-light)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {isSel && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3"><path d="M20 6L9 17L4 12"/></svg>}
                        </div>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 2 }}>{h.scheme_name}</p>
                          <p style={{ fontSize: 9, color: ltvColor, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{h.scheme_type?.replace(/_/g, ' ')} · {h.rta === 'CAMS' ? 'MF Central' : 'KFintech'}</p>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 5 }}>
                        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 7, padding: '5px 8px' }}><p style={{ fontSize: 7, color: 'var(--text-muted)', marginBottom: 2 }}>VALUE</p><p style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmtL(value)}</p></div>
                        <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 7, padding: '5px 8px' }}><p style={{ fontSize: 7, color: 'var(--text-muted)', marginBottom: 2 }}>LTV CAP</p><p style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: ltvColor }}>{ltvPct}%</p></div>
                        <div style={{ background: isSel ? 'rgba(0,212,161,0.12)' : 'rgba(0,0,0,0.2)', borderRadius: 7, padding: '5px 8px' }}><p style={{ fontSize: 7, color: 'var(--text-muted)', marginBottom: 2 }}>CREDIT</p><p style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>{fmtL(eligible)}</p></div>
                      </div>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 7, fontFamily: 'var(--font-mono)' }}>
                        {fmtL(value)} × <span style={{ color: ltvColor }}>{ltvPct}% LTV</span> = <span style={{ color: 'var(--jade)', fontWeight: 600 }}>{fmtL(eligible)} credit</span>
                      </p>
                    </motion.div>
                  )
                })}
              </div>
              <CTA onClick={() => { setCurrentStep('PLEDGE'); setSubStep(0) }} loading={false} label="Continue to Pledge →" disabled={selectedFolios.length === 0} />
            </motion.div>
          )}

          {/* ── PLEDGE 0: Confirm ── */}
          {currentStep === 'PLEDGE' && subStep === 0 && (
            <motion.div key="pledge0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '16px 18px', marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>What happens when you pledge?</p>
                {['Your mutual fund units are lien-marked — not sold', 'Your investments keep growing as collateral', 'MF Central manages the pledge securely', 'Release anytime by closing your credit line'].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 9 }}>
                    <div style={{ flexShrink: 0, marginTop: 1, color: 'var(--jade)' }}><Icon.Check /></div>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{item}</p>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>MUTUAL FUNDS TO BE PLEDGED ({selectedFolios.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {holdings.filter(h => selectedFolios.includes(h.folio_number)).map((h, i) => {
                  const value = parseFloat(h.current_value || h.value_at_fetch || 0)
                  const eligible = calcEligible(h)
                  const ltvPct = (parseLtv(h) * 100).toFixed(0)
                  const ltvColor = LTV_CAPS[h.scheme_type]?.color || 'var(--jade)'
                  return (
                    <motion.div key={h.folio_number} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>{h.rta === 'CAMS' ? 'MF CENTRAL' : 'KFINTECH'}</p>
                          <p style={{ fontSize: 13, fontWeight: 600 }}>{h.scheme_name}</p>
                        </div>
                        <div style={{ background: 'rgba(0,212,161,0.1)', borderRadius: 7, padding: '3px 9px', textAlign: 'center', marginLeft: 8 }}>
                          <p style={{ fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-mono)', color: ltvColor }}>{ltvPct}%</p>
                          <p style={{ fontSize: 7, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>LTV CAP</p>
                        </div>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 5, marginBottom: 6 }}>
                        {[{ l: 'VALUE', v: fmtL(value), c: 'var(--text-primary)' }, { l: 'NAV', v: parseFloat(h.current_nav || h.nav_at_fetch || 0) > 0 ? `₹${parseFloat(h.current_nav || h.nav_at_fetch).toFixed(2)}` : '—', c: 'var(--text-primary)' }, { l: 'UNITS', v: parseFloat(h.current_nav || h.nav_at_fetch || 1) > 0 ? (value / parseFloat(h.current_nav || h.nav_at_fetch || 1)).toFixed(2) : '—', c: 'var(--text-primary)' }, { l: 'CREDIT', v: fmtL(eligible), c: 'var(--jade)' }].map((s, j) => (
                          <div key={j} style={{ background: 'var(--bg-elevated)', borderRadius: 7, padding: '6px 8px' }}>
                            <p style={{ fontSize: 7, color: 'var(--text-muted)', marginBottom: 2 }}>{s.l}</p>
                            <p style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: s.c }}>{s.v}</p>
                          </div>
                        ))}
                      </div>
                      <div style={{ background: 'var(--bg-elevated)', borderRadius: 7, padding: '5px 9px' }}>
                        <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {fmtL(value)} × <span style={{ color: ltvColor }}>{ltvPct}% LTV</span> = <span style={{ color: 'var(--jade)', fontWeight: 700 }}>{fmtL(eligible)} available credit</span>
                        </p>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '14px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--jade)' }}>Total eligible credit</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--jade)' }}>{fmtL(selectedCredit)}</p>
              </div>
              <CTA onClick={handleInitiatePledge} loading={loading} label="Initiate Pledge with RTA →" />
            </motion.div>
          )}

          {/* ── PLEDGE 1: OTP ── */}
          {currentStep === 'PLEDGE' && subStep === 1 && (
            <motion.div key="pledge1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>Pledge confirmations sent by CAMS/KFintech. Dev mode: auto-confirmed.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {pledges.map((p, i) => (
                  <div key={p.pledge_id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{p.scheme_name || `Fund ${i + 1}`}</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{p.rta} · OTP: {p.rta === 'CAMS' ? '123456' : '654321'}</p>
                    </div>
                    <div style={{ color: 'var(--jade)' }}><Icon.Lock /></div>
                  </div>
                ))}
              </div>
              <CTA onClick={handleConfirmPledges} loading={loading} label="Confirm All Pledges →" />
            </motion.div>
          )}

          {/* ── CREDIT 0: Activate ── */}
          {currentStep === 'CREDIT' && subStep === 0 && (
            <motion.div key="credit0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'linear-gradient(135deg, var(--jade-dim), rgba(0,212,161,0.03))', border: '1px solid var(--jade-border)', borderRadius: 20, padding: '28px 20px', textAlign: 'center', marginBottom: 20 }}>
                <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2.5, repeat: Infinity }} style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, color: 'var(--jade)' }}>
                  <Icon.Sparkle />
                </motion.div>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 36, fontWeight: 400, color: 'var(--jade)', marginBottom: 6 }}>
                  {fmtL(selectedCredit || riskData?.approved_limit || 0)}
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>Credit limit ready to activate</p>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {['Pledge Secured', 'NBFC Sanctioned', 'KFS Ready'].map((s, i) => (
                    <span key={i} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 5, background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{s}</span>
                  ))}
                </div>
              </div>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px 18px', marginBottom: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>By activating you agree to:</p>
                {['Key Fact Statement (KFS) terms', '3-day cooling-off period begins', 'RBI Digital Lending Guidelines', 'Pledge terms with MF Central / KFintech'].map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: i < 3 ? 7 : 0 }}>
                    <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--jade)', flexShrink: 0 }} />
                    <p style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{t}</p>
                  </div>
                ))}
              </div>
              <CTA onClick={handleActivateCredit} loading={loading} label="Activate Credit Line →" />
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
