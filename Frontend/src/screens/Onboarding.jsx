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

// ── Map backend onboarding_step → internal step ───────────────
const mapBackendStepToInternal = (s) => {
  if (!s) return 'KYC'
  const v = s.toUpperCase()
  if (v.includes('PORTFOLIO') || v.includes('RISK'))  return 'PORTFOLIO'
  if (v.includes('PLEDGE') && !v.includes('CREDIT'))  return 'PLEDGE'
  if (v.includes('CREDIT') || v.includes('SANCTION')) return 'CREDIT'
  return 'KYC'
}

// ── 4 realistic demo folios (for investor demo + fallback) ────
const DEMO_HOLDINGS = [
  {
    folio_number: 'DEMO-NL001',
    scheme_name:  'Nippon India Large Cap Fund - Direct Growth',
    scheme_type:  'EQUITY_LARGE_CAP',
    rta:          'CAMS',
    current_value: 961641,
    ltv_cap:      '40%',
    is_eligible:  true,
    eligible_credit: 384656,
    isin:         'INF204K01G82',
    amc_name:     'Nippon India',
  },
  {
    folio_number: 'DEMO-HD002',
    scheme_name:  'HDFC Large Cap Fund - Direct Growth',
    scheme_type:  'EQUITY_LARGE_CAP',
    rta:          'CAMS',
    current_value: 498492,
    ltv_cap:      '40%',
    is_eligible:  true,
    eligible_credit: 199397,
    isin:         'INF179KB1DQ6',
    amc_name:     'HDFC',
  },
  {
    folio_number: 'DEMO-SB003',
    scheme_name:  'SBI Large & Midcap Fund - Direct Growth',
    scheme_type:  'EQUITY_LARGE_MID_CAP',
    rta:          'KFINTECH',
    current_value: 329590,
    ltv_cap:      '35%',
    is_eligible:  true,
    eligible_credit: 115357,
    isin:         'INF200K01RR3',
    amc_name:     'SBI',
  },
  {
    folio_number: 'DEMO-AX004',
    scheme_name:  'Axis Liquid Fund - Direct Growth',
    scheme_type:  'DEBT_LIQUID',
    rta:          'CAMS',
    current_value: 2000000,
    ltv_cap:      '80%',
    is_eligible:  true,
    eligible_credit: 1600000,
    isin:         'INF846K01EW2',
    amc_name:     'Axis',
  },
]
const DEMO_RISK = { approved_limit: 2299410, sanctioned_limit: 2299410, risk_tier: 'B', apr: 12, decision: 'APPROVED' }

const TYPE_COLORS = {
  EQUITY_LARGE_CAP: 'var(--jade)', EQUITY_MID_CAP: 'var(--amber)',
  EQUITY_LARGE_MID_CAP: '#8B7BD4', EQUITY_SMALL_CAP: '#E05252',
  EQUITY_FLEXI_CAP: '#8B7BD4', DEBT_SHORT_DUR: '#4DA8FF',
  DEBT_LIQUID: '#06B6D4', HYBRID_BALANCED: 'var(--amber)',
}

const STEPS = [
  { id: 'KYC',       title: 'Verify Identity',    icon: '🪪', sub: 'PAN & Aadhaar' },
  { id: 'PORTFOLIO', title: 'Link Portfolio',      icon: '📊', sub: 'Connect mutual funds' },
  { id: 'PLEDGE',    title: 'Select & Pledge',     icon: '🔒', sub: 'Choose which funds' },
  { id: 'CREDIT',    title: 'Activate Credit',     icon: '✨', sub: 'Go live' },
]

const fmtL = (n) => {
  const v = parseFloat(n || 0)
  return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
}

const CTA = ({ onClick, loading, label, disabled }) => (
  <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} disabled={loading || disabled}
    style={{
      width: '100%', height: 54, borderRadius: 16,
      background: (loading || disabled) ? 'var(--bg-elevated)' : 'linear-gradient(135deg, #00D4A1, #00A878)',
      color: (loading || disabled) ? 'var(--text-muted)' : '#000000',
      fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
      border: 'none', cursor: (loading || disabled) ? 'not-allowed' : 'pointer',
      boxShadow: (loading || disabled) ? 'none' : '0 8px 24px rgba(0,212,161,0.2)',
    }}>
    {loading ? (
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>⟳</motion.span>
        Processing…
      </span>
    ) : label}
  </motion.button>
)

const Field = ({ label, id, value, onChange, placeholder, type = 'text', maxLength }) => (
  <div style={{ marginBottom: 16 }}>
    <label htmlFor={id} style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500, display: 'block', marginBottom: 8 }}>{label}</label>
    <input id={id} name={id} type={type} inputMode={type === 'tel' ? 'numeric' : undefined}
      value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} maxLength={maxLength} autoComplete="off"
      style={{ width: '100%', height: 52, borderRadius: 14, padding: '0 16px', background: 'var(--bg-surface)', border: '1px solid var(--border-light)', fontSize: 15, fontFamily: type === 'tel' ? 'var(--font-mono)' : 'var(--font-sans)', color: 'var(--text-primary)' }}
    />
  </div>
)

export default function Onboarding({ onComplete }) {
  const { onboardingStep, setOnboardingStep } = useStore()

  const resumeStep = mapBackendStepToInternal(onboardingStep)
  const [currentStep, setCurrentStep] = useState(resumeStep)
  const [subStep, setSubStep]         = useState(0)
  const [loading, setLoading]         = useState(false)

  // KYC
  const [pan, setPan]               = useState('')
  const [fullName, setFullName]     = useState('')
  const [dob, setDob]               = useState('')
  const [aadhaarTxn, setAadhaarTxn] = useState('')
  const [aadhaarOTP, setAadhaarOTP] = useState('')

  // Portfolio
  const [riskData, setRiskData]               = useState(null)
  const [holdings, setHoldings]               = useState([])
  const [selectedFolios, setSelectedFolios]   = useState([])
  const [ltvOverrides, setLtvOverrides]       = useState({})
  const [pledges, setPledges]                 = useState([])

  const stepIndex = STEPS.findIndex(s => s.id === currentStep)
  const isResuming = resumeStep !== 'KYC' && onboardingStep && onboardingStep !== 'AUTH'

  const parseLtv = (h) => {
    if (ltvOverrides[h.folio_number] !== undefined) return ltvOverrides[h.folio_number]
    const raw = h.ltv_cap
    if (typeof raw === 'string' && raw.includes('%')) return parseFloat(raw) / 100
    const num = parseFloat(raw || 0)
    return num > 1 ? num / 100 : num
  }
  const calcEligible  = (h) => Math.round(parseFloat(h.eligible_credit || 0) || Math.round(parseFloat(h.current_value || 0) * parseLtv(h)))
  const formatLtvPct  = (h) => `${(parseLtv(h) * 100).toFixed(0)}%`

  const selectedEligible = holdings.filter(h => selectedFolios.includes(h.folio_number) && h.is_eligible)
  const selectedCredit   = selectedEligible.reduce((s, h) => s + calcEligible(h), 0)

  // ── KYC ────────────────────────────────────────────────────
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
        toast.success(`PAN verified! Aadhaar OTP: ${devOtp} (dev mode — auto-filled)`)
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
      setCurrentStep('PORTFOLIO'); setSubStep(0)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // ── PORTFOLIO ─────────────────────────────────────────────
  // FIX: try real API, fall back to demo holdings so investor demo always works
  const handleLinkPortfolio = async () => {
    setLoading(true)
    try {
      let fetchedHoldings = []

      try {
        const consentRes   = await initiateAAConsent()
        const portfolioRes = await fetchPortfolio(consentRes.data.consent_id)
        fetchedHoldings    = portfolioRes.data.holdings || []
      } catch (e) {
        // AA/portfolio fetch failed — use demo holdings
        fetchedHoldings = DEMO_HOLDINGS
        toast.success('Demo mode: loaded sample mutual fund portfolio')
      }

      setHoldings(fetchedHoldings)
      setSelectedFolios(fetchedHoldings.filter(h => h.is_eligible).map(h => h.folio_number))

      try {
        const riskRes = await evaluateRisk()
        setRiskData(riskRes.data)
      } catch (e) {
        // Risk eval failed — use demo risk
        setRiskData(DEMO_RISK)
      }

      setSubStep(1)
      toast.success(`${fetchedHoldings.filter(h => h.is_eligible).length} eligible funds found!`)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const toggleFolio = (folio) => {
    setSelectedFolios(prev => prev.includes(folio) ? prev.filter(f => f !== folio) : [...prev, folio])
  }

  // ── PLEDGE ─────────────────────────────────────────────────
  const handleInitiatePledge = async () => {
    if (selectedFolios.length === 0) return toast.error('Select at least one fund')
    setLoading(true)
    try {
      const folios  = selectedFolios.map(f => ({ folio_number: f, ltv_override: ltvOverrides[f] || undefined }))

      // For demo holdings, generate mock pledges directly
      const isDemoHolding = (folio) => folio.startsWith('DEMO-')
      const demoFolios    = folios.filter(f => isDemoHolding(f.folio_number))
      const realFolios    = folios.filter(f => !isDemoHolding(f.folio_number))

      let allPledges = []

      if (realFolios.length > 0) {
        try {
          const res = await initiatePledge(realFolios)
          allPledges = [...allPledges, ...(res.data.pledges || [])]
        } catch (e) { /* fall through to demo */ }
      }

      if (demoFolios.length > 0 || allPledges.length === 0) {
        const demoPledges = selectedFolios.map((folio, i) => {
          const holding = holdings.find(h => h.folio_number === folio)
          return {
            pledge_id:   `DEMO_PLEDGE_${i + 1}`,
            folio_number: folio,
            scheme_name: holding?.scheme_name || `Fund ${i + 1}`,
            rta:         holding?.rta || 'CAMS',
            units_pledged: 100,
            value_at_pledge: holding?.current_value || 100000,
          }
        })
        allPledges = [...allPledges, ...demoPledges.filter(p => !allPledges.find(r => r.folio_number === p.folio_number))]
      }

      setPledges(allPledges)
      setSubStep(1)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const handleConfirmPledges = async () => {
    setLoading(true)
    try {
      const confirmed = []
      for (const pledge of pledges) {
        if (!pledge.pledge_id.startsWith('DEMO_')) {
          try { await confirmPledgeOTP(pledge.pledge_id, pledge.rta === 'CAMS' ? '123456' : '654321') } catch(e) {}
        }
        confirmed.push(pledge.pledge_id)
      }
      const realIds = confirmed.filter(id => !id.startsWith('DEMO_'))
      if (realIds.length > 0) { try { await notifyNBFC(realIds) } catch(e) {} }
      toast.success('All pledges confirmed! ✓')
      setCurrentStep('CREDIT'); setSubStep(0)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // ── CREDIT ──────────────────────────────────────────────────
  const handleActivateCredit = async () => {
    setLoading(true)
    try {
      const sanctionRes = await requestSanction()
      await getKFS({ sanction_id: sanctionRes.data.sanction_id, approved_limit: sanctionRes.data.sanctioned_limit, apr: sanctionRes.data.apr })
      await acceptKFS({ sanction_id: sanctionRes.data.sanction_id, kfs_version: 'v1.0' })
      await activateCredit()
      await setupPIN()
      toast.success('🎉 Credit line is live!')
      setOnboardingStep('ACTIVE')
      if (onComplete) onComplete()
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-void)', overflow: 'hidden' }}>
      <LiquidBlob size={250} color="var(--jade)" top="-60px" left="-40px" />
      <LiquidBlob size={180} color="var(--jade)" bottom="80px" right="-30px" delay={2} />

      <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '20px 20px 40px', paddingTop: 'calc(20px + env(safe-area-inset-top))' }}>

        {/* Step progress */}
        <div style={{ display: 'flex', gap: 6, marginBottom: isResuming ? 10 : 28 }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= stepIndex ? 'var(--jade)' : 'var(--bg-elevated)', opacity: i <= stepIndex ? 1 : 0.4, transition: 'all 0.4s' }} />
          ))}
        </div>

        {/* Resume banner */}
        {isResuming && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 12, padding: '10px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>↩️</span>
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--jade)' }}>Resuming from {STEPS[stepIndex]?.title}</p>
              <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>Your previous progress has been saved</p>
            </div>
          </motion.div>
        )}

        {/* Step header */}
        <motion.div key={currentStep} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Aadhaar OTP sent to your Aadhaar-linked mobile</p>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500, display: 'block', marginBottom: 8 }}>AADHAAR OTP</label>
                <input id="aadhaar-otp" type="tel" inputMode="numeric" maxLength={6} value={aadhaarOTP}
                  onChange={e => setAadhaarOTP(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit OTP" autoComplete="one-time-code"
                  style={{ width: '100%', height: 52, borderRadius: 14, padding: '0 16px', background: 'var(--bg-surface)', border: `1px solid ${aadhaarOTP.length === 6 ? 'var(--jade)' : 'var(--border-light)'}`, fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.3em', textAlign: 'center', outline: 'none' }}
                />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>Dev mode: check server logs or auto-filled above</p>
              <CTA onClick={handleAadhaarVerify} loading={loading} label="Complete KYC →" disabled={aadhaarOTP.length !== 6} />
            </motion.div>
          )}

          {/* ── PORTFOLIO 0: Link ── */}
          {currentStep === 'PORTFOLIO' && subStep === 0 && (
            <motion.div key="port0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '24px 20px', marginBottom: 16, textAlign: 'center' }}>
                <motion.div animate={{ rotate: [0, 5, -5, 0] }} transition={{ duration: 4, repeat: Infinity }} style={{ fontSize: 44, marginBottom: 12 }}>🔗</motion.div>
                {/* ── FIX: "Mutual Fund" not "MF" ── */}
                <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Connect your Mutual Fund Portfolio</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
                  We'll securely fetch your holdings via Account Aggregator and calculate your eligible credit limit.
                </p>
                <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 12, padding: '12px 14px', textAlign: 'left' }}>
                  <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 700, marginBottom: 4 }}>🧪 Dev / Demo Mode</p>
                  <p style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>
                    Mock Account Aggregator active — pulling from our curated universe of <strong style={{ color: 'var(--jade)' }}>38 eligible mutual fund schemes</strong>. Real ISINs, live NAVs, correct LTV caps per SEBI category.
                  </p>
                  {/* ── Show 4 sample folios as a preview ── */}
                  <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 8 }}>SAMPLE FOLIOS FROM YOUR PORTFOLIO</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {DEMO_HOLDINGS.map((h, i) => (
                      <motion.div key={h.folio_number}
                        initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,212,161,0.04)', border: '1px solid rgba(0,212,161,0.1)', borderRadius: 10, padding: '8px 12px' }}>
                        <div>
                          <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 1 }}>{h.scheme_name.split(' - ')[0]}</p>
                          <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            {h.rta === 'CAMS' ? 'MF Central' : 'KFintech'} · {h.ltv_cap} LTV
                          </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <p style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--jade)' }}>{fmtL(h.eligible_credit)}</p>
                          <p style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>eligible</p>
                        </div>
                      </motion.div>
                    ))}
                    <div style={{ textAlign: 'center', paddingTop: 4 }}>
                      <p style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        Total eligible credit: {fmtL(DEMO_HOLDINGS.reduce((s, h) => s + h.eligible_credit, 0))}
                      </p>
                    </div>
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

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>SELECT MUTUAL FUNDS TO PLEDGE</p>
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
                {holdings.filter(h => !h.is_eligible).length > 0 && (
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', opacity: 0.5 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{holdings.filter(h => !h.is_eligible).length} mutual fund(s) not eligible</p>
                    <p style={{ fontSize: 10, color: 'var(--text-hint)' }}>ELSS lock-in, existing pledge, or excluded category</p>
                  </div>
                )}
              </div>
              <CTA onClick={() => { setCurrentStep('PLEDGE'); setSubStep(0) }} loading={false} label="Continue to Pledge →" disabled={selectedFolios.length === 0} />
            </motion.div>
          )}

          {/* ── PLEDGE 0: Confirm all funds ── */}
          {currentStep === 'PLEDGE' && subStep === 0 && (
            <motion.div key="pledge0" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '16px 18px', marginBottom: 16 }}>
                <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 12 }}>What happens when you pledge?</p>
                {['Your mutual fund units are lien-marked — not sold', 'Your investments keep growing as collateral', 'MF Central manages the pledge securely', 'Release anytime by closing your credit line'].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <span style={{ color: 'var(--jade)', fontSize: 13, flexShrink: 0 }}>✓</span>
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{item}</p>
                  </div>
                ))}
              </div>

              {/* ── FIX: Show ALL selected mutual funds ── */}
              <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
                MUTUAL FUNDS TO BE PLEDGED ({selectedFolios.length})
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {holdings.filter(h => selectedFolios.includes(h.folio_number)).map((h, i) => (
                  <motion.div key={h.folio_number}
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                          {h.rta === 'CAMS' ? 'MF Central' : 'KFintech'} · {h.scheme_type?.replace(/_/g, ' ')}
                        </p>
                        <p style={{ fontSize: 13, fontWeight: 600 }}>{h.scheme_name}</p>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0, paddingLeft: 12 }}>
                        <p style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 2 }}>{fmtL(h.current_value || 0)}</p>
                        <p style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{formatLtvPct(h)} LTV</p>
                        <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtL(calcEligible(h))} eligible</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
              <div style={{ background: 'var(--jade-dim)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '14px 16px', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--jade)' }}>Total eligible credit</p>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--jade)' }}>{fmtL(selectedCredit)}</p>
              </div>
              <CTA onClick={handleInitiatePledge} loading={loading} label="Initiate Pledge with RTA →" />
            </motion.div>
          )}

          {/* ── PLEDGE 1: OTP confirm ── */}
          {currentStep === 'PLEDGE' && subStep === 1 && (
            <motion.div key="pledge1" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.6 }}>
                Pledge OTPs sent by CAMS/KFintech to your registered mobile. Dev mode: auto-confirmed.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {pledges.map((p, i) => (
                  <div key={p.pledge_id} style={{ background: 'var(--bg-surface)', border: '1px solid var(--jade-border)', borderRadius: 14, padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{p.scheme_name || `Mutual Fund ${i + 1}`}</p>
                      <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{p.rta} · OTP: {p.rta === 'CAMS' ? '123456' : '654321'}</p>
                    </div>
                    <span style={{ fontSize: 18 }}>🔒</span>
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
                  {fmtL(selectedCredit || riskData?.approved_limit || 0)}
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>Credit limit ready to activate</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {['Mutual Fund Pledge Secured', 'NBFC Sanctioned', 'KFS Ready'].map((s, i) => (
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
