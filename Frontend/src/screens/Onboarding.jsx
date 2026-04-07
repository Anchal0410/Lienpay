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

const TYPE_COLORS = {
  EQUITY_LARGE_CAP: 'var(--jade)', EQUITY_MID_CAP: 'var(--amber)',
  EQUITY_SMALL_CAP: '#E05252', EQUITY_FLEXI_CAP: '#8B7BD4',
  DEBT_SHORT_DUR: '#4DA8FF', DEBT_LIQUID: '#06B6D4',
  HYBRID_BALANCED: 'var(--amber)',
}

const STEPS = [
  { id: 'KYC',       title: 'Verify Identity', icon: '🪪', sub: 'PAN & Aadhaar' },
  { id: 'PORTFOLIO', title: 'Link Portfolio',   icon: '📊', sub: 'Connect mutual funds' },
  { id: 'PLEDGE',    title: 'Select & Pledge',  icon: '🔒', sub: 'Choose which funds' },
  { id: 'CREDIT',    title: 'Activate Credit',  icon: '✨', sub: 'Go live' },
]

const fmtL = (n) => {
  const v = parseFloat(n || 0)
  return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

// CTA button
const CTA = ({ onClick, loading, label, disabled }) => (
  <motion.button
    whileTap={{ scale: 0.97 }}
    onClick={onClick}
    disabled={loading || disabled}
    style={{
      width: '100%', height: 54, borderRadius: 16,
      background: (loading || disabled) ? 'var(--bg-elevated)' : 'linear-gradient(135deg, var(--jade), #00A878)',
      color: (loading || disabled) ? 'var(--text-muted)' : 'var(--bg-void)',
      fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
      border: 'none', cursor: (loading || disabled) ? 'not-allowed' : 'pointer',
      boxShadow: (loading || disabled) ? 'none' : '0 8px 24px rgba(0,212,161,0.2)',
    }}
  >
    {loading ? (
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>⟳</motion.span>
        Processing…
      </span>
    ) : label}
  </motion.button>
)

// Input field
const Field = ({ label, id, value, onChange, placeholder, type = 'text', maxLength }) => (
  <div style={{ marginBottom: 16 }}>
    <label htmlFor={id} style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500, display: 'block', marginBottom: 8 }}>
      {label}
    </label>
    <input
      id={id} name={id} type={type} inputMode={type === 'tel' ? 'numeric' : undefined}
      value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} maxLength={maxLength}
      autoComplete="off"
      style={{
        width: '100%', height: 52, borderRadius: 14, padding: '0 16px',
        background: 'var(--bg-surface)', border: '1px solid var(--border-light)',
        fontSize: 15, fontFamily: type === 'tel' ? 'var(--font-mono)' : 'var(--font-sans)',
        color: 'var(--text-primary)',
      }}
    />
  </div>
)

export default function Onboarding({ onComplete }) {
  const { setOnboardingStep } = useStore()
  const [currentStep, setCurrentStep] = useState('KYC')
  const [subStep, setSubStep]         = useState(0)
  const [loading, setLoading]         = useState(false)

  // KYC
  const [pan, setPan]               = useState('')
  const [fullName, setFullName]     = useState('')
  const [dob, setDob]               = useState('')
  const [aadhaarTxn, setAadhaarTxn] = useState('')
  const [aadhaarOTP, setAadhaarOTP] = useState('')

  // Portfolio
  const [portfolioData, setPortfolioData] = useState(null)
  const [riskData, setRiskData]           = useState(null)
  const [holdings, setHoldings]           = useState([])
  const [selectedFolios, setSelectedFolios] = useState([])
  const [ltvOverrides, setLtvOverrides]     = useState({})

  // Pledge
  const [pledges, setPledges] = useState([])

  const stepIndex = STEPS.findIndex(s => s.id === currentStep)

  const LTV_OPTIONS = [
    { label: '80%', value: 0.80, desc: 'Debt / Liquid' },
    { label: '65%', value: 0.65, desc: 'Conservative Hybrid' },
    { label: '50%', value: 0.50, desc: 'Balanced' },
    { label: '40%', value: 0.40, desc: 'Large Cap / Index' },
    { label: '35%', value: 0.35, desc: 'Flexi Cap' },
    { label: '30%', value: 0.30, desc: 'Mid Cap' },
    { label: '25%', value: 0.25, desc: 'Small Cap / Sectoral' },
  ]

  const parseLtv = (h) => {
    if (ltvOverrides[h.folio_number] !== undefined) return ltvOverrides[h.folio_number]
    const raw = h.ltv_cap
    if (typeof raw === 'string' && raw.includes('%')) return parseFloat(raw) / 100
    const num = parseFloat(raw || 0)
    return num > 1 ? num / 100 : num
  }
  const calcEligible = (h) => Math.round(parseFloat(h.current_value || h.eligible_credit || 0) || Math.round(parseFloat(h.current_value || 0) * parseLtv(h)))
  const formatLtvPct = (h) => `${(parseLtv(h) * 100).toFixed(0)}%`

  const selectedEligible = holdings.filter(h => selectedFolios.includes(h.folio_number) && h.is_eligible)
  const selectedCredit   = selectedEligible.reduce((s, h) => s + calcEligible(h), 0)

  // ── KYC ───────────────────────────────────────────────────────
  const handleKYCProfile = async () => {
    if (!pan || !fullName || !dob) return toast.error('Fill all fields')
    setLoading(true)
    try {
      await submitKYCProfile({ pan, full_name: fullName, date_of_birth: dob, email: `${pan.toLowerCase()}@lienpay.in` })
      const res = await sendAadhaarOTP({ aadhaar_last4: '3421', consent_given: 'true' })
      setAadhaarTxn(res.data.txn_id)

      // ── FIX: auto-fill Aadhaar OTP in dev/mock mode ──────────
      const devOtp = res.data?.dev_otp || res.data?.otp
      if (devOtp) {
        setAadhaarOTP(String(devOtp))
        toast.success(`PAN verified! Aadhaar OTP: ${devOtp} (auto-filled)`)
      } else {
        toast.success('PAN verified! OTP sent to Aadhaar-linked mobile.')
      }

      setSubStep(1)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const handleAadhaarVerify = async () => {
    if (!aadhaarOTP) return toast.error('Enter OTP')
    setLoading(true)
    try {
      await verifyAadhaarOTP({ txn_id: aadhaarTxn, otp: aadhaarOTP })
      await submitCKYC()
      await submitBureau()
      toast.success('KYC Complete! ✓')
      setCurrentStep('PORTFOLIO')
      setSubStep(0)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // ── PORTFOLIO ─────────────────────────────────────────────────
  const handleLinkPortfolio = async () => {
    setLoading(true)
    try {
      const consentRes   = await initiateAAConsent()
      const portfolioRes = await fetchPortfolio(consentRes.data.consent_id)
      const riskRes      = await evaluateRisk()
      setPortfolioData(portfolioRes.data)
      setRiskData(riskRes.data)
      const fetchedHoldings = portfolioRes.data.holdings || []
      setHoldings(fetchedHoldings)
      setSelectedFolios(fetchedHoldings.filter(h => h.is_eligible).map(h => h.folio_number))
      setSubStep(1)
      toast.success(`${portfolioRes.data.eligible_funds || fetchedHoldings.filter(h => h.is_eligible).length} eligible funds found!`)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const toggleFolio = (folio) => {
    setSelectedFolios(prev =>
      prev.includes(folio) ? prev.filter(f => f !== folio) : [...prev, folio]
    )
  }

  // ── PLEDGE ────────────────────────────────────────────────────
  const handleInitiatePledge = async () => {
    if (selectedFolios.length === 0) return toast.error('Select at least one fund')
    setLoading(true)
    try {
      const folios = selectedFolios.map(f => ({
        folio_number: f,
        ltv_override: ltvOverrides[f] || undefined,
      }))
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
      toast.success('🎉 Credit line is live!')

      // ── FIX: MUST set onboardingStep so App.jsx routes to main app ──
      setOnboardingStep('ACTIVE')
      if (onComplete) onComplete()
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // ─────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-void)', overflow: 'hidden' }}>
      <LiquidBlob size={250} color="var(--jade)" top="-60px" left="-40px" />
      <LiquidBlob size={180} color="var(--jade)" bottom="80px" right="-30px" delay={2} />

      <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '20px 20px 40px', paddingTop: 'calc(20px + env(safe-area-inset-top))' }}>

        {/* Step indicator */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 28 }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ flex: 1, height: 3, borderRadius: 2, background: i < stepIndex ? 'var(--jade)' : i === stepIndex ? 'var(--jade)' : 'var(--bg-elevated)', opacity: i <= stepIndex ? 1 : 0.4 }} />
          ))}
        </div>

        {/* Step header */}
        <motion.div key={currentStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6 }}>
            <div style={{ width: 48, height: 48, borderRadius: 16, background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
              {STEPS[stepIndex]?.icon}
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
              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 16, padding: '14px 16px', marginBottom: 20 }}>
                <p style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 700, marginBottom: 3 }}>✓ PAN Verified</p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Aadhaar OTP sent to your registered mobile</p>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500, display: 'block', marginBottom: 8 }}>
                  AADHAAR OTP
                </label>
                <input
                  id="aadhaar-otp" name="aadhaar-otp" type="tel" inputMode="numeric" maxLength={6}
                  value={aadhaarOTP}
                  onChange={e => setAadhaarOTP(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit OTP"
                  autoComplete="one-time-code"
                  style={{ width: '100%', height: 52, borderRadius: 14, padding: '0 16px', background: 'var(--bg-surface)', border: `1px solid ${aadhaarOTP.length === 6 ? 'var(--jade)' : 'var(--border-light)'}`, fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.3em', textAlign: 'center' }}
                />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>
                Dev mode: check server logs or auto-filled above
              </p>
              <CTA onClick={handleAadhaarVerify} loading={loading} label="Complete KYC →" disabled={aadhaarOTP.length !== 6} />
            </motion.div>
          )}

          {/* ── PORTFOLIO 0: Link ── */}
          {currentStep === 'PORTFOLIO' && subStep === 0 && (
            <motion.div key="port0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '28px 20px', marginBottom: 20, textAlign: 'center' }}>
                <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 4, repeat: Infinity }} style={{ fontSize: 48, marginBottom: 14 }}>🔗</motion.div>
                <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Connect your MF Portfolio</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                  We'll securely fetch your holdings via Account Aggregator and calculate your eligible credit limit.
                </p>
                {/* ── Dev mode note ── */}
                <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 12, padding: '10px 14px' }}>
                  <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 600, marginBottom: 2 }}>🧪 Dev / Demo Mode</p>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    Mock AA fetch active. Pulling from our curated universe of <strong style={{ color: 'var(--jade)' }}>38 eligible MF schemes</strong> — real ISINs, live NAVs, correct LTV caps.
                  </p>
                </div>
              </div>
              <CTA onClick={handleLinkPortfolio} loading={loading} label="Link Portfolio →" />
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

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>SELECT FUNDS TO PLEDGE</p>
                <p style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)' }}>{selectedFolios.length}/{holdings.filter(h => h.is_eligible).length} selected</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {holdings.filter(h => h.is_eligible).map((h) => {
                  const isSelected = selectedFolios.includes(h.folio_number)
                  const color      = TYPE_COLORS[h.scheme_type] || '#8888AA'
                  const eligible   = calcEligible(h)
                  return (
                    <motion.div key={h.folio_number} whileTap={{ scale: 0.98 }}
                      onClick={() => toggleFolio(h.folio_number)}
                      style={{ background: isSelected ? 'var(--jade-dim)' : 'var(--bg-surface)', border: `1px solid ${isSelected ? 'var(--jade-border)' : 'var(--border)'}`, borderRadius: 16, padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.2s' }}>
                      <div style={{ width: 22, height: 22, borderRadius: 8, flexShrink: 0, background: isSelected ? 'var(--jade)' : 'var(--bg-elevated)', border: `2px solid ${isSelected ? 'var(--jade)' : 'var(--border-light)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {isSelected && <span style={{ fontSize: 11, color: '#000', fontWeight: 800 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.scheme_name}</p>
                        <p style={{ fontSize: 9, color, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{h.scheme_type?.replace(/_/g, ' ')} · {fmtL(h.current_value || 0)}</p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--jade)', fontFamily: 'var(--font-mono)' }}>{fmtL(eligible)}</p>
                        <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{formatLtvPct(h)} LTV</p>
                      </div>
                    </motion.div>
                  )
                })}

                {/* Ineligible funds — collapsed, with reason */}
                {holdings.filter(h => !h.is_eligible).length > 0 && (
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', opacity: 0.5 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{holdings.filter(h => !h.is_eligible).length} fund(s) not eligible</p>
                    <p style={{ fontSize: 10, color: 'var(--text-hint)' }}>ELSS lock-in, existing pledge, or excluded category</p>
                  </div>
                )}
              </div>

              <CTA onClick={() => { setCurrentStep('PLEDGE'); setSubStep(0) }} loading={false} label="Continue to Pledge →" disabled={selectedFolios.length === 0} />
            </motion.div>
          )}

          {/* ── PLEDGE 0: Confirm selection ── */}
          {currentStep === 'PLEDGE' && subStep === 0 && (
            <motion.div key="pledge0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '16px 18px', marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)' }}>What happens when you pledge?</p>
                {[
                  'Your MF units are lien-marked — not sold',
                  'Your investments keep growing as collateral',
                  'MF Central manages the pledge securely',
                  'Release anytime by closing your credit line',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <span style={{ color: 'var(--jade)', fontSize: 13, flexShrink: 0 }}>✓</span>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{item}</p>
                  </div>
                ))}
              </div>

              {/* ── FIX: Show ALL selected funds, no truncation ── */}
              <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>FUNDS TO BE PLEDGED ({selectedFolios.length})</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {holdings.filter(h => selectedFolios.includes(h.folio_number)).map((h, i) => {
                  const eligible = calcEligible(h)
                  return (
                    <motion.div key={h.folio_number}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                            {h.rta === 'CAMS' ? 'MF CENTRAL' : 'KFINTECH'} · {h.scheme_type?.replace(/_/g, ' ')}
                          </p>
                          <p style={{ fontSize: 13, fontWeight: 600 }}>{h.scheme_name}</p>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 12 }}>
                          <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>{fmtL(h.current_value || 0)}</p>
                          <p style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatLtvPct(h)} LTV</p>
                          <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtL(eligible)} eligible</p>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>

              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '14px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--jade)' }}>Total eligible credit</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--jade)' }}>{fmtL(selectedCredit)}</p>
              </div>

              <CTA onClick={handleInitiatePledge} loading={loading} label="Initiate Pledge with RTA →" />
            </motion.div>
          )}

          {/* ── PLEDGE 1: OTP confirmation ── */}
          {currentStep === 'PLEDGE' && subStep === 1 && (
            <motion.div key="pledge1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                Pledge OTPs have been sent to your registered mobile by CAMS/KFintech. In dev mode these are auto-confirmed.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {pledges.map((p, i) => (
                  <div key={p.pledge_id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{p.scheme_name || `Fund ${i + 1}`}</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{p.rta} · OTP: {p.rta === 'CAMS' ? '123456' : '654321'}</p>
                    </div>
                    <span style={{ fontSize: 18, color: 'var(--jade)' }}>🔒</span>
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
                <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ duration: 2, repeat: Infinity }} style={{ fontSize: 56, marginBottom: 16 }}>✨</motion.div>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, color: 'var(--jade)', marginBottom: 6 }}>
                  {fmtL(selectedCredit)}
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>Credit limit ready to activate</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                  {['KFS Ready', 'NBFC Sanctioned', 'PIN Setup'].map((s, i) => (
                    <span key={i} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 6, background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{s}</span>
                  ))}
                </div>
              </div>

              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px 18px', marginBottom: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>By activating you agree to:</p>
                {['Key Fact Statement (KFS) terms', '3-day cooling-off period starts now', 'RBI Digital Lending Guidelines compliance', 'Pledge terms with MF Central / KFintech'].map((t, i) => (
                  <p key={i} style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>· {t}</p>
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
