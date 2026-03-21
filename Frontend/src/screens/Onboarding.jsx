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

const SCHEME_COLORS = {
  EQUITY_LARGE_CAP: '#00C896', EQUITY_MID_CAP: '#C9A449',
  EQUITY_SMALL_CAP: '#EF4444', EQUITY_FLEXI_CAP: '#8B5CF6',
  DEBT_SHORT_DUR: '#3B82F6',   DEBT_LIQUID: '#06B6D4',
  HYBRID_BALANCED: '#F59E0B',
}

const STEPS = [
  { id: 'KYC',       title: 'Verify Identity',    icon: '🪪', sub: 'PAN & Aadhaar' },
  { id: 'PORTFOLIO', title: 'Link Portfolio',      icon: '📊', sub: 'Connect mutual funds' },
  { id: 'PLEDGE',    title: 'Select & Pledge',     icon: '🔒', sub: 'Choose which funds' },
  { id: 'CREDIT',    title: 'Activate Credit',     icon: '✨', sub: 'Go live in seconds' },
]

export default function Onboarding({ onComplete }) {
  const { setOnboardingStep } = useStore()
  const [currentStep, setCurrentStep] = useState('KYC')
  const [subStep,     setSubStep]     = useState(0)
  const [loading,     setLoading]     = useState(false)

  // KYC
  const [pan,        setPan]        = useState('')
  const [fullName,   setFullName]   = useState('')
  const [dob,        setDob]        = useState('')
  const [aadhaarTxn, setAadhaarTxn] = useState('')
  const [aadhaarOTP, setAadhaarOTP] = useState('')

  // Portfolio
  const [portfolioData, setPortfolioData] = useState(null)
  const [riskData,      setRiskData]      = useState(null)

  // Pledge — fund selection
  const [holdings,         setHoldings]         = useState([])
  const [selectedFolios,   setSelectedFolios]   = useState([])  // array of folio_number strings
  const [pledges,          setPledges]          = useState([])

  const stepIndex = STEPS.findIndex(s => s.id === currentStep)

  // ── KYC ───────────────────────────────────────────────────
  const handleKYCProfile = async () => {
    if (!pan || !fullName || !dob) return toast.error('Fill all fields')
    setLoading(true)
    try {
      await submitKYCProfile({ pan, full_name: fullName, date_of_birth: dob, email: `${pan.toLowerCase()}@lienpay.in` })
      const res = await sendAadhaarOTP({ aadhaar_last4: '3421', consent_given: 'true' })
      setAadhaarTxn(res.data.txn_id)
      setSubStep(1)
      toast.success('PAN verified! OTP sent.')
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

  // ── PORTFOLIO ──────────────────────────────────────────────
  const handleLinkPortfolio = async () => {
    setLoading(true)
    try {
      const consentRes = await initiateAAConsent()
      const portfolioRes = await fetchPortfolio(consentRes.data.consent_id)
      const riskRes      = await evaluateRisk()
      setPortfolioData(portfolioRes.data)
      setRiskData(riskRes.data)
      setHoldings(portfolioRes.data.holdings || [])
      // Default: all eligible selected
      setSelectedFolios((portfolioRes.data.holdings || []).filter(h => h.is_eligible).map(h => h.folio_number))
      setSubStep(1)
      toast.success(`${portfolioRes.data.eligible_funds} funds found!`)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const toggleFolio = (folio_number) => {
    setSelectedFolios(prev =>
      prev.includes(folio_number)
        ? prev.filter(f => f !== folio_number)
        : [...prev, folio_number]
    )
  }

  const selectedEligible = holdings.filter(h => selectedFolios.includes(h.folio_number) && h.is_eligible)
  const selectedCredit   = selectedEligible.reduce((s, h) => s + parseFloat(h.eligible_credit || 0), 0)

  // ── PLEDGE ─────────────────────────────────────────────────
  const handleInitiatePledge = async () => {
    if (selectedFolios.length === 0) return toast.error('Select at least one fund')
    setLoading(true)
    try {
      const folios = selectedFolios.map(f => ({ folio_number: f }))
      const res    = await initiatePledge(folios)
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
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Liquid bg */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0, overflow: 'hidden' }}>
        <motion.div animate={{ scale: [1, 1.15, 1], rotate: [0, 10, 0] }} transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          style={{ position: 'absolute', top: -120, right: -80, width: 300, height: 300, borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,200,150,0.12), transparent)', filter: 'blur(60px)' }} />
      </div>

      {/* Progress dots */}
      <div style={{ position: 'relative', zIndex: 1, padding: '18px 24px 0', display: 'flex', gap: 6 }}>
        {STEPS.map((s, i) => (
          <motion.div key={s.id} animate={{ width: i === stepIndex ? 32 : 8, background: i <= stepIndex ? 'var(--jade)' : 'var(--bg-elevated)' }}
            transition={{ duration: 0.4 }}
            style={{ height: 4, borderRadius: 2 }} />
        ))}
      </div>

      {/* Step header */}
      <div style={{ position: 'relative', zIndex: 1, padding: '14px 24px 0', marginBottom: 4 }}>
        <AnimatePresence mode="wait">
          <motion.div key={currentStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 30 }}>{STEPS[stepIndex]?.icon}</span>
              <div>
                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 400 }}>{STEPS[stepIndex]?.title}</h2>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{STEPS[stepIndex]?.sub}</p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, flex: 1, overflow: 'auto', padding: '16px 24px 24px' }}>
        <AnimatePresence mode="wait">

          {/* ── KYC 0 ── */}
          {currentStep === 'KYC' && subStep === 0 && (
            <motion.div key="kyc0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <Field label="PAN NUMBER" id="pan" value={pan} onChange={v => setPan(v.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
              <Field label="FULL NAME (AS PER PAN)" id="fname" value={fullName} onChange={setFullName} placeholder="Rahul Sharma" />
              <Field label="DATE OF BIRTH" id="dob" value={dob} onChange={setDob} placeholder="1992-08-12" type="date" />
              <CTA onClick={handleKYCProfile} loading={loading} label="Verify PAN →" />
            </motion.div>
          )}

          {/* ── KYC 1 ── */}
          {currentStep === 'KYC' && subStep === 1 && (
            <motion.div key="kyc1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'rgba(0,200,150,0.06)', border: '1px solid var(--border-jade)', borderRadius: 16, padding: '14px 16px', marginBottom: 20 }}>
                <p style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 700, marginBottom: 3 }}>✓ PAN Verified</p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Aadhaar OTP sent to your registered mobile</p>
              </div>
              <Field label="AADHAAR OTP" id="aadhaar-otp" value={aadhaarOTP} onChange={setAadhaarOTP} placeholder="6-digit OTP" type="tel" maxLength={6} />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>Check Railway logs for mock OTP</p>
              <CTA onClick={handleAadhaarVerify} loading={loading} label="Complete KYC →" />
            </motion.div>
          )}

          {/* ── PORTFOLIO 0 ── */}
          {currentStep === 'PORTFOLIO' && subStep === 0 && (
            <motion.div key="port0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '24px 20px', marginBottom: 20, textAlign: 'center' }}>
                <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 4, repeat: Infinity }}
                  style={{ fontSize: 48, marginBottom: 14 }}>🔗</motion.div>
                <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Connect your MF Portfolio</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  We'll securely fetch your mutual fund holdings via Account Aggregator and calculate your eligible credit limit instantly.
                </p>
              </div>
              <CTA onClick={handleLinkPortfolio} loading={loading} label="Link Portfolio →" />
            </motion.div>
          )}

          {/* ── PORTFOLIO 1 — Fund Selection ── */}
          {currentStep === 'PORTFOLIO' && subStep === 1 && (
            <motion.div key="port1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              {/* Approved limit */}
              <motion.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}
                style={{ background: 'linear-gradient(135deg, rgba(0,200,150,0.1), rgba(0,200,150,0.03))', border: '1px solid var(--border-jade)', borderRadius: 20, padding: '20px', textAlign: 'center', marginBottom: 16 }}>
                <p style={{ fontSize: 11, color: 'var(--jade)', letterSpacing: '2px', marginBottom: 6 }}>APPROVED LIMIT</p>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: 48, color: 'var(--jade)', lineHeight: 1, marginBottom: 4 }}>
                  ₹{(riskData?.approved_limit || 0).toLocaleString('en-IN')}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{riskData?.apr}% APR • Tier {riskData?.risk_tier}</p>
              </motion.div>

              {/* Fund selection */}
              <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10 }}>
                SELECT FUNDS TO PLEDGE
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {holdings.filter(h => h.is_eligible).map((h, i) => {
                  const selected = selectedFolios.includes(h.folio_number)
                  const color    = SCHEME_COLORS[h.scheme_type] || '#8888AA'
                  return (
                    <motion.div key={h.folio_number} whileTap={{ scale: 0.98 }}
                      onClick={() => toggleFolio(h.folio_number)}
                      style={{
                        background: selected ? `rgba(${color === '#00C896' ? '0,200,150' : '201,164,73'},0.06)` : 'var(--bg-surface)',
                        border: `1px solid ${selected ? color + '40' : 'var(--border)'}`,
                        borderRadius: 16, padding: '14px 16px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 12, transition: 'all 0.2s',
                      }}>
                      {/* Checkbox */}
                      <div style={{ width: 22, height: 22, borderRadius: 8, flexShrink: 0,
                        background: selected ? color : 'var(--bg-elevated)',
                        border: `2px solid ${selected ? color : 'var(--border)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}>
                        {selected && <span style={{ fontSize: 12, color: color === '#00C896' ? '#000' : '#fff', fontWeight: 900 }}>✓</span>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {h.scheme_name?.split(' - ')[0]}
                        </p>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ fontSize: 9, color: color, fontWeight: 700, background: `${color}15`, padding: '2px 6px', borderRadius: 4 }}>
                            {h.ltv_cap ? `${(parseFloat(h.ltv_cap)*100).toFixed(0)}% LTV` : h.scheme_type?.replace(/_/g,' ')}
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.rta}</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
                          ₹{parseFloat(h.current_value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 700 }}>
                          ₹{parseFloat(h.eligible_credit || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })} eligible
                        </p>
                      </div>
                    </motion.div>
                  )
                })}
              </div>

              {/* Selected summary */}
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{selectedFolios.length} fund{selectedFolios.length !== 1 ? 's' : ''} selected</span>
                  <span style={{ fontSize: 14, color: 'var(--jade)', fontWeight: 800 }}>
                    ₹{selectedCredit.toLocaleString('en-IN', { maximumFractionDigits: 0 })} eligible
                  </span>
                </div>
              </div>

              <CTA onClick={() => { setCurrentStep('PLEDGE'); setSubStep(0) }} loading={false} label={`Pledge ${selectedFolios.length} Fund${selectedFolios.length !== 1 ? 's' : ''} →`} disabled={selectedFolios.length === 0} />
            </motion.div>
          )}

          {/* ── PLEDGE 0 ── */}
          {currentStep === 'PLEDGE' && subStep === 0 && (
            <motion.div key="pledge0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '20px', marginBottom: 16 }}>
                <p style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>What happens when you pledge?</p>
                {['Your MF units are lien-marked — not sold', 'Your investments keep growing as collateral', 'CAMS & KFintech manage the pledge securely', 'Release anytime by closing your credit line'].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%', background: 'var(--jade-dim)', border: '1px solid var(--jade)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                      <span style={{ fontSize: 9, color: 'var(--jade)' }}>✓</span>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{item}</p>
                  </div>
                ))}
              </div>

              {/* Selected funds summary */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {holdings.filter(h => selectedFolios.includes(h.folio_number)).map((h, i) => (
                  <div key={i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{h.scheme_name?.split(' - ')[0]}</p>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.rta}</p>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 700 }}>
                      ₹{parseFloat(h.eligible_credit || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </p>
                  </div>
                ))}
              </div>

              <CTA onClick={handleInitiatePledge} loading={loading} label="Initiate Pledge →" />
            </motion.div>
          )}

          {/* ── PLEDGE 1 ── */}
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
                          <span style={{ fontSize: 10, background: 'var(--bg-elevated)', padding: '2px 8px', borderRadius: 6, color: 'var(--text-secondary)' }}>{p.rta}</span>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{parseFloat(p.units_pledged).toFixed(3)} units</span>
                        </div>
                      </div>
                      <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade)', borderRadius: 10, padding: '4px 10px', flexShrink: 0 }}>
                        <p style={{ fontSize: 10, color: 'var(--jade)', fontWeight: 700 }}>OTP</p>
                        <p style={{ fontSize: 18, color: 'var(--jade)', fontWeight: 900, fontFamily: 'var(--font-sans)' }}>
                          {p.rta === 'CAMS' ? '123456' : '654321'}
                        </p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.5 }}>
                Mock OTPs shown above. In production, these arrive via SMS from CAMS/KFintech to your registered mobile.
              </p>
              <CTA onClick={handleConfirmPledges} loading={loading} label="Confirm All Pledges →" />
            </motion.div>
          )}

          {/* ── CREDIT ── */}
          {currentStep === 'CREDIT' && (
            <motion.div key="credit" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <motion.div animate={{ background: ['rgba(0,200,150,0.05)', 'rgba(0,200,150,0.1)', 'rgba(0,200,150,0.05)'] }}
                transition={{ duration: 3, repeat: Infinity }}
                style={{ border: '1px solid var(--border-jade)', borderRadius: 24, padding: '28px 20px', textAlign: 'center', marginBottom: 20 }}>
                <motion.div animate={{ scale: [1, 1.1, 1], rotate: [0, 5, -5, 0] }} transition={{ duration: 3, repeat: Infinity }}>
                  <span style={{ fontSize: 52 }}>🎉</span>
                </motion.div>
                <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 26, fontWeight: 400, marginTop: 12, marginBottom: 8 }}>Almost there!</h3>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  One tap to activate your wealth-backed credit line. Your KFS will be generated, reviewed, and credit activated — all instantly.
                </p>
              </motion.div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {['NBFC sanction request', 'KFS generation (RBI mandate)', 'Cooling-off period', 'Credit line activation', 'UPI VPA creation', 'PIN setup via PSP SDK'].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--jade-dim)', border: '1px solid var(--jade)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ fontSize: 9, color: 'var(--jade)' }}>✓</span>
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item}</p>
                  </div>
                ))}
              </div>

              <CTA onClick={handleActivateCredit} loading={loading} label="Activate My Credit Line 🚀" />
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────

function Field({ label, id, value, onChange, placeholder, type = 'text', maxLength }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 7 }}>{label}</p>
      <input id={id} name={id} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength}
        style={{ width: '100%', height: 52, fontSize: 15, background: 'var(--bg-surface)', borderRadius: 14, padding: '0 16px',
          color: 'var(--text-primary)', border: '1px solid var(--border)', boxSizing: 'border-box', fontFamily: 'var(--font-sans)',
          outline: 'none', transition: 'border-color 0.2s' }} />
    </div>
  )
}

function CTA({ onClick, loading, label, disabled = false }) {
  return (
    <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.97 }} onClick={onClick}
      disabled={loading || disabled}
      style={{
        width: '100%', height: 58, borderRadius: 18,
        background: disabled ? 'var(--bg-elevated)' : loading ? 'var(--bg-elevated)' : 'linear-gradient(135deg, var(--jade), #00A878)',
        color: disabled || loading ? 'var(--text-muted)' : '#000',
        fontSize: 16, fontWeight: 900, fontFamily: 'var(--font-sans)',
        boxShadow: disabled || loading ? 'none' : '0 10px 30px rgba(0,200,150,0.25)',
        transition: 'all 0.3s', position: 'relative', overflow: 'hidden',
      }}>
      {!loading && !disabled && (
        <motion.div animate={{ x: ['-100%', '200%'] }} transition={{ duration: 3, repeat: Infinity, repeatDelay: 2, ease: 'linear' }}
          style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)', transform: 'skewX(-15deg)' }} />
      )}
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: 'var(--text-secondary)', borderRadius: '50%' }} />
          Processing…
        </div>
      ) : <span style={{ position: 'relative' }}>{label}</span>}
    </motion.button>
  )
}
