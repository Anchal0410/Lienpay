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

// Step icons — clean SVG, no emoji
const StepIconKYC = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="5" width="20" height="14" rx="2"/>
    <circle cx="8" cy="12" r="2"/>
    <path d="M14 10h4M14 14h3"/>
  </svg>
)
const StepIconPortfolio = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>
)
const StepIconPledge = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
)
const StepIconCredit = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>
  </svg>
)

const STEPS = [
  { id: 'KYC',       title: 'Verify Identity',  Icon: StepIconKYC,       sub: 'PAN & Aadhaar' },
  { id: 'PORTFOLIO', title: 'Link Portfolio',    Icon: StepIconPortfolio, sub: 'Connect mutual funds' },
  { id: 'PLEDGE',    title: 'Select & Pledge',   Icon: StepIconPledge,    sub: 'Choose which funds' },
  { id: 'CREDIT',    title: 'Activate Credit',   Icon: StepIconCredit,    sub: 'Go live' },
]

const fmtL = (n) => {
  const v = parseFloat(n || 0)
  return v >= 100000 ? `${(v / 100000).toFixed(2)}L` : v.toLocaleString('en-IN', { maximumFractionDigits: 0 })
}

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
  const [ltvOverrides, setLtvOverrides]   = useState({})

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
  const calcEligible = (h) => Math.round(parseFloat(h.current_value || 0) * parseLtv(h))
  const formatLtv    = (h) => `${(parseLtv(h) * 100).toFixed(0)}%`
  const selectedEligible = holdings.filter(h => selectedFolios.includes(h.folio_number) && h.is_eligible)
  const selectedCredit   = selectedEligible.reduce((s, h) => s + calcEligible(h), 0)

  // ── KYC ───────────────────────────────────────────────
  const handleKYCProfile = async () => {
    if (!pan || !fullName || !dob) return toast.error('Fill all fields')
    setLoading(true)
    try {
      await submitKYCProfile({ pan, full_name: fullName, date_of_birth: dob, email: `${pan.toLowerCase()}@lienpay.in` })
      const res = await sendAadhaarOTP({ aadhaar_last4: '3421', consent_given: 'true' })
      setAadhaarTxn(res.data.txn_id)
      setSubStep(1)
      toast.success('PAN verified. OTP sent.')
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
      toast.success('KYC Complete')
      setCurrentStep('PORTFOLIO')
      setSubStep(0)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // ── PORTFOLIO ──────────────────────────────────────────
  const handleLinkPortfolio = async () => {
    setLoading(true)
    try {
      const consentRes   = await initiateAAConsent()
      const portfolioRes = await fetchPortfolio(consentRes.data.consent_id)
      const riskRes      = await evaluateRisk()
      setPortfolioData(portfolioRes.data)
      setRiskData(riskRes.data)
      setHoldings(portfolioRes.data.holdings || [])
      setSelectedFolios((portfolioRes.data.holdings || []).filter(h => h.is_eligible).map(h => h.folio_number))
      setSubStep(1)
      toast.success(`${portfolioRes.data.eligible_funds} funds found`)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const toggleFolio = (folio) => {
    setSelectedFolios(prev => prev.includes(folio) ? prev.filter(f => f !== folio) : [...prev, folio])
  }

  // ── PLEDGE ─────────────────────────────────────────────
  const handleInitiatePledge = async () => {
    if (selectedFolios.length === 0) return toast.error('Select at least one fund')
    setLoading(true)
    try {
      const folios = selectedFolios.map(f => ({ folio_number: f, ltv_override: ltvOverrides[f] || undefined }))
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
      toast.success('All pledges confirmed')
      setCurrentStep('CREDIT')
      setSubStep(0)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // ── CREDIT ─────────────────────────────────────────────
  const handleActivateCredit = async () => {
    setLoading(true)
    try {
      const sanctionRes = await requestSanction()
      await getKFS({ sanction_id: sanctionRes.data.sanction_id, approved_limit: sanctionRes.data.sanctioned_limit, apr: sanctionRes.data.apr })
      await acceptKFS({ sanction_id: sanctionRes.data.sanction_id, kfs_version: 'v1.0' })
      await activateCredit()
      await setupPIN()
      toast.success('Credit line is live')
      setOnboardingStep('ACTIVE')
      onComplete()
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const CurrentIcon = STEPS[stepIndex]?.Icon || StepIconKYC

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-void)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <LiquidBlob size={280} color="var(--jade)" top="-100px" right="-80px" />
      <LiquidBlob size={160} color="var(--jade)" bottom="200px" left="-50px" delay={4} />

      {/* Progress bar */}
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
              <div style={{
                width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                background: 'var(--jade-dim)', border: '1px solid var(--jade-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <CurrentIcon />
              </div>
              <div>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 400 }}>
                  {STEPS[stepIndex]?.title}
                </h2>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {STEPS[stepIndex]?.sub}
                </p>
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
              <CTA onClick={handleKYCProfile} loading={loading} label="Verify PAN" />
            </motion.div>
          )}

          {/* ── KYC 1: Aadhaar OTP ── */}
          {currentStep === 'KYC' && subStep === 1 && (
            <motion.div key="kyc1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 16, padding: '14px 16px', marginBottom: 20 }}>
                <p style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 700, marginBottom: 3 }}>PAN Verified</p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Aadhaar OTP sent to your registered mobile</p>
              </div>
              <Field label="AADHAAR OTP" id="aadhaar-otp" value={aadhaarOTP} onChange={setAadhaarOTP} placeholder="6-digit OTP" type="tel" maxLength={6} />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>Check server logs for mock OTP</p>
              <CTA onClick={handleAadhaarVerify} loading={loading} label="Complete KYC" />
            </motion.div>
          )}

          {/* ── PORTFOLIO 0: Link ── */}
          {currentStep === 'PORTFOLIO' && subStep === 0 && (
            <motion.div key="port0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '28px 20px', marginBottom: 20, textAlign: 'center' }}>
                <div style={{
                  width: 52, height: 52, borderRadius: 16,
                  background: 'var(--jade-dim)', border: '1px solid var(--jade-border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 16px',
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                </div>
                <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Connect your MF Portfolio</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  We'll securely fetch your holdings via Account Aggregator and calculate your eligible credit limit.
                </p>
              </div>
              <CTA onClick={handleLinkPortfolio} loading={loading} label="Link Portfolio" />
            </motion.div>
          )}

          {/* ── PORTFOLIO 1: Fund Selection ── */}
          {currentStep === 'PORTFOLIO' && subStep === 1 && (
            <motion.div key="port1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              {/* Credit limit card */}
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}
                style={{ background: 'linear-gradient(135deg, var(--jade-dim), var(--jade-glow))', border: '1px solid var(--jade-border)', borderRadius: 20, padding: '20px', textAlign: 'center', marginBottom: 16 }}>
                <p style={{ fontSize: 10, color: 'var(--jade)', letterSpacing: '2.5px', marginBottom: 6, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>YOUR CREDIT LIMIT</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 42, color: 'var(--jade)', lineHeight: 1, marginBottom: 4 }}>
                  ₹{selectedCredit > 0 ? fmtL(selectedCredit) : (riskData?.approved_limit || 0).toLocaleString('en-IN')}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  12% APR · {riskData?.risk_tier === 'A' ? 'Prime' : riskData?.risk_tier === 'B' ? 'Standard' : 'Starter'} plan
                </p>
              </motion.div>

              <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', marginBottom: 10, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                SELECT FUNDS TO PLEDGE
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {holdings.filter(h => h.is_eligible).map((h) => {
                  const selected = selectedFolios.includes(h.folio_number)
                  const color    = TYPE_COLORS[h.scheme_type] || '#8888AA'
                  const eligible = calcEligible(h)
                  return (
                    <motion.div key={h.folio_number} whileTap={{ scale: 0.98 }}
                      onClick={() => toggleFolio(h.folio_number)}
                      style={{
                        background: selected ? 'var(--jade-dim)' : 'var(--bg-surface)',
                        border: `1px solid ${selected ? 'var(--jade-border)' : 'var(--border)'}`,
                        borderRadius: 16, padding: '14px 16px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.2s',
                      }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: 8, flexShrink: 0,
                        background: selected ? 'var(--jade)' : 'var(--bg-elevated)',
                        border: `2px solid ${selected ? 'var(--jade)' : 'var(--border-light)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {selected && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--bg-void)" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.scheme_name?.split(' - ')[0] || h.scheme_name}
                        </p>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', background: `${color}18`, color, padding: '1px 6px', borderRadius: 4 }}>
                            {h.scheme_type?.replace(/_/g, ' ') || 'FUND'}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            ₹{(parseFloat(h.current_value || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--jade)', fontWeight: 700 }}>
                          ₹{fmtL(eligible)}
                        </p>
                        <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          {formatLtv(h)} LTV
                        </p>
                      </div>
                    </motion.div>
                  )
                })}
              </div>

              {/* Summary */}
              {selectedFolios.length > 0 && (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 16px', marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      {selectedFolios.length} fund{selectedFolios.length !== 1 ? 's' : ''} selected
                    </span>
                    <span style={{ fontSize: 14, color: 'var(--jade)', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                      ₹{fmtL(selectedCredit)} eligible
                    </span>
                  </div>
                  {selectedEligible.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                      {selectedEligible.map((h, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 2 }}>
                          <span>{h.scheme_name?.split(' ').slice(0, 2).join(' ')}</span>
                          <span>₹{fmtL(h.current_value)} × {formatLtv(h)} = <span style={{ color: 'var(--jade)' }}>₹{fmtL(calcEligible(h))}</span></span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <CTA onClick={() => { setCurrentStep('PLEDGE'); setSubStep(0) }} loading={false}
                label={`Pledge ${selectedFolios.length} Fund${selectedFolios.length !== 1 ? 's' : ''}`}
                disabled={selectedFolios.length === 0} />
            </motion.div>
          )}

          {/* ── PLEDGE 0: Info ── */}
          {currentStep === 'PLEDGE' && subStep === 0 && (
            <motion.div key="pledge0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px', marginBottom: 16 }}>
                <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>What happens when you pledge?</p>
                {[
                  'Your MF units are lien-marked — not sold',
                  'Your investments keep growing as collateral',
                  'MF Central manages the pledge securely',
                  'Release anytime by closing your credit line',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0, marginTop: 1,
                      background: 'var(--jade-dim)', border: '1px solid var(--jade-border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item}</p>
                  </div>
                ))}
              </div>

              {/* Fund preview */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {selectedFolios.slice(0, 3).map((folio, i) => {
                  const h = holdings.find(h => h.folio_number === folio)
                  if (!h) return null
                  return (
                    <div key={i} style={{
                      background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      borderRadius: 14, padding: '12px 14px',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                      <div>
                        <p style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', letterSpacing: '1px', marginBottom: 2 }}>
                          MF CENTRAL · {h.scheme_type?.replace('EQUITY_', '').replace('DEBT_', '').replace('_', ' ')}
                        </p>
                        <p style={{ fontSize: 13, fontWeight: 600 }}>{h.scheme_name?.split(' - ')[0] || h.scheme_name}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700 }}>₹{fmtL(h.current_value)}</p>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--jade)' }}>{formatLtv(h)} LTV</p>
                        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--jade)' }}>₹{fmtL(calcEligible(h))} eligible</p>
                      </div>
                    </div>
                  )
                })}
                {selectedFolios.length > 3 && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                    +{selectedFolios.length - 3} more fund{selectedFolios.length - 3 !== 1 ? 's' : ''}
                  </p>
                )}
              </div>

              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '12px 14px', marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Total eligible credit</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 800, color: 'var(--jade)' }}>₹{fmtL(selectedCredit)}</span>
              </div>

              <CTA onClick={handleInitiatePledge} loading={loading} label="Initiate Pledge with RTA" />
            </motion.div>
          )}

          {/* ── PLEDGE 1: Confirm OTPs ── */}
          {currentStep === 'PLEDGE' && subStep === 1 && (
            <motion.div key="pledge1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                {pledges.map((p, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, marginRight: 12 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{p.scheme_name?.split(' - ')[0]}</p>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {/* Always show MF Central — not CAMS or KFINTECH */}
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', background: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: 6, color: 'var(--text-secondary)' }}>
                            MF CENTRAL
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {parseFloat(p.units_pledged).toFixed(3)} units
                          </span>
                        </div>
                      </div>
                      <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 10, padding: '4px 10px', flexShrink: 0 }}>
                        <p style={{ fontSize: 10, color: 'var(--jade)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>OTP</p>
                        <p style={{ fontSize: 18, color: 'var(--jade)', fontWeight: 900, fontFamily: 'var(--font-mono)' }}>
                          {p.rta === 'CAMS' ? '123456' : '654321'}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
                Mock OTPs shown above. In production, these arrive via SMS from MF Central to your registered mobile.
              </p>
              <CTA onClick={handleConfirmPledges} loading={loading} label="Confirm All Pledges" />
            </motion.div>
          )}

          {/* ── CREDIT ── */}
          {currentStep === 'CREDIT' && (
            <motion.div key="credit" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <motion.div
                animate={{ background: ['var(--jade-dim)', 'var(--jade-glow)', 'var(--jade-dim)'] }}
                transition={{ duration: 3, repeat: Infinity }}
                style={{ border: '1px solid var(--jade-border)', borderRadius: 24, padding: '28px 20px', textAlign: 'center', marginBottom: 20 }}>
                {/* Clean check circle — no emoji */}
                <motion.div
                  animate={{ scale: [1, 1.06, 1] }}
                  transition={{ duration: 3, repeat: Infinity }}
                  style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'var(--jade-dim)', border: '1px solid var(--jade-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 14px',
                  }}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </motion.div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 400, marginBottom: 8 }}>Almost there</h3>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  One tap to activate your wealth-backed CLOU credit line. KFS will be generated, reviewed, and credit activated instantly.
                </p>
              </motion.div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {['NBFC sanction request', 'KFS generation (RBI mandate)', 'Cooling-off period', 'Credit line activation', 'UPI VPA creation', 'PIN setup via PSP SDK'].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--jade-dim)', border: '1px solid var(--jade-border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--jade)" strokeWidth="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item}</p>
                  </div>
                ))}
              </div>

              <CTA onClick={handleActivateCredit} loading={loading} label="Activate My Credit Line" />
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}

/* ── Sub-components ─── */
function Field({ label, id, value, onChange, placeholder, type = 'text', maxLength }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', marginBottom: 7, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{label}</p>
      <input id={id} name={id} type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} maxLength={maxLength}
        style={{
          width: '100%', height: 52, fontSize: 15,
          background: 'var(--bg-surface)', borderRadius: 14, padding: '0 16px',
          color: 'var(--text-primary)', border: '1px solid var(--border-light)',
          boxSizing: 'border-box', fontFamily: 'var(--font-sans)',
          outline: 'none', transition: 'border-color 0.2s',
        }}
      />
    </div>
  )
}

function CTA({ onClick, loading, label, disabled = false }) {
  return (
    <motion.button whileTap={{ scale: 0.97 }} onClick={onClick}
      disabled={loading || disabled}
      style={{
        width: '100%', height: 56, borderRadius: 16,
        background: disabled || loading ? 'var(--bg-elevated)' : 'linear-gradient(135deg, var(--jade), #00A878)',
        color: disabled || loading ? 'var(--text-muted)' : 'var(--bg-void)',
        fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
        boxShadow: disabled || loading ? 'none' : '0 4px 16px rgba(0,212,161,0.2)',
        border: 'none', cursor: disabled || loading ? 'not-allowed' : 'pointer',
      }}>
      {loading ? 'Please wait...' : label}
    </motion.button>
  )
}
