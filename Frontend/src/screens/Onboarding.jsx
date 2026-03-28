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
  { id: 'KYC',       title: 'Verify Identity',  icon: '🪪', sub: 'PAN & Aadhaar' },
  { id: 'PORTFOLIO', title: 'Link Portfolio',    icon: '📊', sub: 'Connect mutual funds' },
  { id: 'PLEDGE',    title: 'Select & Pledge',   icon: '🔒', sub: 'Choose which funds' },
  { id: 'CREDIT',    title: 'Activate Credit',   icon: '✨', sub: 'Go live' },
]

const fmtL = (n) => {
  const v = parseFloat(n || 0)
  return v >= 100000 ? `${(v / 100000).toFixed(2)}L` : v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

// ── Shared field component ────────────────────────────────────
const Field = ({ label, id, value, onChange, placeholder, type = 'text', maxLength }) => (
  <div style={{ marginBottom: 16 }}>
    <label htmlFor={id} style={{ display: 'block', fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 8 }}>
      {label}
    </label>
    <input
      id={id}
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      style={{
        width: '100%', height: 52,
        background: 'var(--bg-elevated)', border: '1px solid var(--border-light)',
        borderRadius: 14, padding: '0 16px',
        fontSize: 15, fontWeight: 500, color: 'var(--text-primary)',
        fontFamily: 'var(--font-sans)', outline: 'none',
      }}
      onFocus={e => e.target.style.borderColor = 'var(--jade-border)'}
      onBlur={e => e.target.style.borderColor = 'var(--border-light)'}
    />
  </div>
)

// ── CTA button ────────────────────────────────────────────────
const CTA = ({ onClick, loading, label, disabled }) => (
  <motion.button
    whileTap={{ scale: 0.97 }}
    onClick={onClick}
    disabled={loading || disabled}
    style={{
      width: '100%', height: 56, borderRadius: 16,
      background: loading || disabled ? 'var(--bg-elevated)' : 'linear-gradient(135deg, var(--jade), #00A878)',
      color: loading || disabled ? 'var(--text-muted)' : 'var(--bg-void)',
      fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-sans)',
      letterSpacing: '-0.3px',
      boxShadow: loading || disabled ? 'none' : '0 8px 28px rgba(0,212,161,0.2)',
      transition: 'all 0.2s',
    }}
  >
    {loading ? (
      <span style={{ display: 'inline-block', width: 18, height: 18, border: '2px solid var(--text-muted)', borderTopColor: 'var(--jade)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
    ) : label}
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

  // Portfolio state
  const [portfolioData, setPortfolioData] = useState(null)
  const [riskData, setRiskData]           = useState(null)
  const [holdings, setHoldings]           = useState([])
  const [selectedFolios, setSelectedFolios] = useState([])
  const [ltvOverrides, setLtvOverrides]   = useState({})

  // Pledge state
  const [pledges, setPledges] = useState([])

  const stepIndex = STEPS.findIndex(s => s.id === currentStep)

  // LTV options for dropdown
  const LTV_OPTIONS = [
    { label: '80%', value: 0.80, desc: 'Debt / Liquid' },
    { label: '65%', value: 0.65, desc: 'Conservative Hybrid' },
    { label: '50%', value: 0.50, desc: 'Balanced' },
    { label: '40%', value: 0.40, desc: 'Large Cap / Index' },
    { label: '35%', value: 0.35, desc: 'Flexi Cap' },
    { label: '30%', value: 0.30, desc: 'Mid Cap' },
    { label: '25%', value: 0.25, desc: 'Small Cap / Sectoral' },
  ]

  // Correct eligible calculation — uses override if set
  const parseLtv = (h) => {
    if (ltvOverrides[h.folio_number] !== undefined) return ltvOverrides[h.folio_number]
    const raw = h.ltv_cap
    if (typeof raw === 'string' && raw.includes('%')) return parseFloat(raw) / 100
    const num = parseFloat(raw || 0)
    return num > 1 ? num / 100 : num
  }
  const calcEligible = (h) => Math.round(parseFloat(h.current_value || 0) * parseLtv(h))
  const formatLtv = (h) => `${(parseLtv(h) * 100).toFixed(0)}%`
  const selectedEligible = holdings.filter(h => selectedFolios.includes(h.folio_number) && h.is_eligible)
  const selectedCredit = selectedEligible.reduce((s, h) => s + calcEligible(h), 0)

  // ── KYC ───────────────────────────────────────────────────
  const handleKYCProfile = async () => {
    if (!pan || !fullName || !dob) return toast.error('Fill all fields')
    setLoading(true)
    try {
      await submitKYCProfile({ pan, full_name: fullName, date_of_birth: dob, email: `${pan.toLowerCase()}@lienpay.in` })
      const res = await sendAadhaarOTP({ aadhaar_last4: '3421', consent_given: 'true' })
      setAadhaarTxn(res.data.txn_id)

      // ── DEV BYPASS: auto-fill & auto-verify Aadhaar OTP ──────
      // Mirrors the auth OTP bypass pattern (Auth.jsx handleSendOTP).
      // Backend returns dev_otp only when AADHAAR_MODE=mock.
      // When AADHAAR_MODE=real, this block is silently skipped.
      if (res.data?.dev_otp) {
        setAadhaarOTP(res.data.dev_otp)
        toast.success(`Aadhaar OTP: ${res.data.dev_otp} (auto-filled)`)
        setSubStep(1)
        setTimeout(() => handleAadhaarVerify(res.data.dev_otp), 800)
      } else {
        toast.success('PAN verified! OTP sent.')
        setSubStep(1)
      }
      // ─────────────────────────────────────────────────────────

    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // Accepts an optional overrideOtp so the dev bypass can pass the OTP directly
  // without depending on state having updated yet (React state is async).
  const handleAadhaarVerify = async (overrideOtp) => {
    const otpToUse = overrideOtp || aadhaarOTP
    if (!otpToUse) return toast.error('Enter OTP')
    setLoading(true)
    try {
      await verifyAadhaarOTP({ txn_id: aadhaarTxn, otp: otpToUse })
      await submitCKYC()
      await submitBureau()
      toast.success('KYC Complete! ✓')
      setCurrentStep('PORTFOLIO')
      setSubStep(0)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // ── PORTFOLIO ──────────────────────────────────────────────
  const handleLinkPortfolio = async () => {
    setLoading(true)
    try {
      const consentRes = await initiateAAConsent()
      const portfolioRes = await fetchPortfolio(consentRes.data.consent_id)
      const riskRes = await evaluateRisk()
      setPortfolioData(portfolioRes.data)
      setRiskData(riskRes.data)
      setHoldings(portfolioRes.data.holdings || [])
      setSelectedFolios((portfolioRes.data.holdings || []).filter(h => h.is_eligible).map(h => h.folio_number))
      setSubStep(1)
      toast.success(`${portfolioRes.data.eligible_funds} funds found!`)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const toggleFolio = (folio) => {
    setSelectedFolios(prev =>
      prev.includes(folio) ? prev.filter(f => f !== folio) : [...prev, folio]
    )
  }

  // ── PLEDGE ─────────────────────────────────────────────────
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

  // ── CREDIT ─────────────────────────────────────────────────
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
      {/* Liquid bg */}
      <LiquidBlob size={280} color="var(--jade)" top="-100px" right="-80px" />
      <LiquidBlob size={160} color="var(--jade)" bottom="200px" left="-50px" delay={4} />

      {/* Progress dots */}
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
      <div style={{ position: 'relative', zIndex: 1, flex: 1, overflow: 'auto', padding: '16px 24px 24px' }}>
        <AnimatePresence mode="wait">

          {/* ── KYC 0: PAN + Name ── */}
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
              {/* Note: in dev mode the OTP is auto-filled and verified — this field is just shown briefly */}
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
                  We'll securely fetch your holdings via Account Aggregator and calculate your eligible credit limit.
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginBottom: 20 }}>
                {[
                  'Select your bank or MF holder',
                  'Consent to share data (read-only)',
                  'We calculate your credit limit',
                ].map((step, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < 2 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'var(--jade)', flexShrink: 0 }}>{i + 1}</div>
                    <p style={{ fontSize: 13 }}>{step}</p>
                  </div>
                ))}
              </div>
              <CTA onClick={handleLinkPortfolio} loading={loading} label="Link via Account Aggregator →" />
              <p style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
                Secured by RBI-regulated Account Aggregator framework. We never store your credentials.
              </p>
            </motion.div>
          )}

          {/* ── PORTFOLIO 1: Fund selection ── */}
          {currentStep === 'PORTFOLIO' && subStep === 1 && (
            <motion.div key="port1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              {/* Credit summary */}
              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '14px 16px', marginBottom: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Eligible credit limit</span>
                  <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>₹{fmtL(selectedCredit)}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {selectedFolios.length} FUNDS SELECTED
                </div>
              </div>

              {/* Fund list */}
              {holdings.map(h => {
                const color = TYPE_COLORS[h.scheme_type] || '#8888AA'
                const selected = selectedFolios.includes(h.folio_number)
                const eligible = calcEligible(h)
                return (
                  <motion.div
                    key={h.folio_number}
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    onClick={() => h.is_eligible && toggleFolio(h.folio_number)}
                    style={{
                      background: 'var(--bg-surface)', border: `1px solid ${selected ? 'var(--jade-border)' : 'var(--border)'}`,
                      borderRadius: 14, padding: '14px 16px', marginBottom: 8,
                      position: 'relative', overflow: 'hidden',
                      cursor: h.is_eligible ? 'pointer' : 'default',
                      opacity: h.is_eligible ? 1 : 0.5,
                    }}
                  >
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: selected ? 'var(--jade)' : color }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginLeft: 8 }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>{h.scheme_name}</p>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: `${color}15`, color }}>{h.scheme_type?.replace(/_/g, ' ')}</span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{h.rta}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>₹{fmtL(h.current_value)}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Eligible: ₹{fmtL(eligible)}</div>
                      </div>
                    </div>
                    {/* LTV override dropdown */}
                    {selected && (
                      <div style={{ marginTop: 10, marginLeft: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>LTV cap:</span>
                        <select
                          value={ltvOverrides[h.folio_number] ?? parseLtv(h)}
                          onChange={e => setLtvOverrides(prev => ({ ...prev, [h.folio_number]: parseFloat(e.target.value) }))}
                          onClick={e => e.stopPropagation()}
                          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', borderRadius: 8, color: 'var(--jade)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: '4px 8px' }}
                        >
                          {LTV_OPTIONS.map(o => (
                            <option key={o.value} value={o.value}>{o.label} — {o.desc}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </motion.div>
                )
              })}

              <CTA onClick={() => { setCurrentStep('PLEDGE'); setSubStep(0) }} loading={false} label="Continue to Pledge →" disabled={selectedFolios.length === 0} />
            </motion.div>
          )}

          {/* ── PLEDGE 0: Initiate ── */}
          {currentStep === 'PLEDGE' && subStep === 0 && (
            <motion.div key="pledge0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
                Your selected mutual funds will be marked as lien with the RTA. You retain ownership — units can't be redeemed while pledged.
              </p>
              {selectedFolios.map(folio => {
                const h = holdings.find(x => x.folio_number === folio)
                if (!h) return null
                return (
                  <div key={folio} style={{ background: 'var(--bg-surface)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '14px 16px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <div>
                        <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--jade)' }}>{h.rta}</span>
                        <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{h.scheme_name}</div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>₹{fmtL(h.current_value)}</div>
                    </div>
                  </div>
                )
              })}
              <div style={{ height: 16 }} />
              <CTA onClick={handleInitiatePledge} loading={loading} label="Initiate Pledge →" />
            </motion.div>
          )}

          {/* ── PLEDGE 1: Confirm OTPs ── */}
          {currentStep === 'PLEDGE' && subStep === 1 && (
            <motion.div key="pledge1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                RTAs have sent OTPs to your registered mobile. Confirm each pledge below.
              </p>
              {pledges.map((pledge, i) => (
                <div key={pledge.pledge_id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '14px 16px', marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div>
                      <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--jade)' }}>{pledge.rta}</span>
                      <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2 }}>{pledge.scheme_name || `Folio ${pledge.folio_number}`}</div>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>₹{fmtL(pledge.pledge_value)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--jade)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--bg-void)', fontWeight: 700 }}>✓</div>
                    <span style={{ fontSize: 11, color: 'var(--jade)' }}>OTP auto-confirmed (dev mode)</span>
                  </div>
                </div>
              ))}
              <div style={{ height: 16 }} />
              <CTA onClick={handleConfirmPledges} loading={loading} label="Confirm All Pledges →" />
            </motion.div>
          )}

          {/* ── CREDIT 0: KFS + Activate ── */}
          {currentStep === 'CREDIT' && subStep === 0 && (
            <motion.div key="credit0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px', marginBottom: 16 }}>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', marginBottom: 14 }}>KEY FACT STATEMENT</div>
                {[
                  { k: 'Credit Limit', v: `₹${fmtL(riskData?.credit_limit || 250000)}`, c: 'var(--jade)' },
                  { k: 'Annual Interest Rate', v: `${riskData?.apr || '14.99'}% p.a.`, c: null },
                  { k: 'Interest-Free Period', v: '30 days', c: null },
                  { k: 'Processing Fee', v: '₹0 (waived)', c: null },
                  { k: 'Lender', v: 'FinServ NBFC Ltd.', c: null },
                ].map((row, i, arr) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.k}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: row.c || 'var(--text-primary)' }}>{row.v}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-light)', borderRadius: 12, padding: '12px 14px', marginBottom: 18, display: 'flex', gap: 8 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>ℹ️</span>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  By activating, you agree to the KFS terms. Interest is charged only on amounts used beyond the free period.
                </p>
              </div>
              <CTA onClick={handleActivateCredit} loading={loading} label="Accept & Activate Credit Line →" />
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
