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

// ── LTV rates per category (matches fund.classifier.js backend) ──
const CATEGORY_LTV = {
  EQUITY_LARGE_CAP:  { rate: 0.50, label: 'Large Cap Equity',      color: '#00D4A1' },
  EQUITY_MID_CAP:    { rate: 0.30, label: 'Mid Cap Equity',         color: '#C9A449' },
  EQUITY_SMALL_CAP:  { rate: 0.25, label: 'Small Cap Equity',       color: '#EF4444' },
  EQUITY_FLEXI_CAP:  { rate: 0.40, label: 'Flexi / Multi Cap',      color: '#8B5CF6' },
  EQUITY_ELSS:       { rate: 0.40, label: 'ELSS (Tax Saver)',        color: '#8B5CF6' },
  INDEX_FUND:        { rate: 0.50, label: 'Index Fund / ETF',        color: '#00D4A1' },
  ETF:               { rate: 0.50, label: 'ETF',                     color: '#00D4A1' },
  DEBT_LIQUID:       { rate: 0.80, label: 'Liquid / Overnight',      color: '#3B82F6' },
  DEBT_SHORT_DUR:    { rate: 0.80, label: 'Short Duration Debt',     color: '#3B82F6' },
  DEBT_CORPORATE:    { rate: 0.75, label: 'Corporate Bond',          color: '#06B6D4' },
  DEBT_GILT:         { rate: 0.75, label: 'Gilt / G-Sec',            color: '#06B6D4' },
  HYBRID_BALANCED:   { rate: 0.50, label: 'Balanced / Hybrid',       color: '#F59E0B' },
  HYBRID_AGGRESSIVE: { rate: 0.40, label: 'Aggressive Hybrid',       color: '#F59E0B' },
}

const getCategoryInfo = (schemeType) =>
  CATEGORY_LTV[schemeType] || { rate: 0.40, label: schemeType?.replace(/_/g,' ') || 'Equity', color: '#7A8F85' }

const STEPS = [
  { id: 'KYC',       title: 'Verify Identity',  icon: '🪪', sub: 'PAN & Aadhaar' },
  { id: 'PORTFOLIO', title: 'Link Portfolio',    icon: '📊', sub: 'Connect mutual funds' },
  { id: 'PLEDGE',    title: 'Select & Pledge',   icon: '🔒', sub: 'Choose which funds' },
  { id: 'CREDIT',    title: 'Activate Credit',   icon: '✨', sub: 'Go live' },
]

const fmtL = (n) => {
  const v = parseFloat(n || 0)
  if (v >= 10000000) return `₹${(v/10000000).toFixed(2)}Cr`
  if (v >= 100000)   return `₹${(v/100000).toFixed(2)}L`
  return `₹${Math.round(v).toLocaleString('en-IN')}`
}

const Field = ({ label, id, value, onChange, placeholder, type='text', maxLength }) => (
  <div style={{ marginBottom: 16 }}>
    <label htmlFor={id} style={{ display:'block', fontSize:9, color:'var(--text-muted)', letterSpacing:'2px', fontFamily:'var(--font-mono)', fontWeight:500, marginBottom:8 }}>
      {label}
    </label>
    <input id={id} type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} maxLength={maxLength}
      style={{ width:'100%', height:52, background:'var(--bg-elevated)', border:'1px solid var(--border-light)', borderRadius:14, padding:'0 16px', fontSize:15, fontWeight:500, color:'var(--text-primary)', fontFamily:'var(--font-sans)', outline:'none' }}
      onFocus={e => e.target.style.borderColor='var(--jade-border)'}
      onBlur={e => e.target.style.borderColor='var(--border-light)'}
    />
  </div>
)

const CTA = ({ onClick, loading, label, disabled }) => (
  <motion.button whileTap={{ scale: 0.97 }} onClick={onClick} disabled={loading || disabled}
    style={{ width:'100%', height:56, borderRadius:16, border:'none', cursor: loading||disabled?'default':'pointer',
      background: loading||disabled ? 'var(--bg-elevated)' : 'linear-gradient(135deg, var(--jade), #00A878)',
      color: loading||disabled ? 'var(--text-muted)' : 'var(--bg-void)',
      fontSize:16, fontWeight:700, fontFamily:'var(--font-sans)', letterSpacing:'-0.3px',
      boxShadow: loading||disabled ? 'none' : '0 8px 28px rgba(0,212,161,0.2)', transition:'all 0.2s' }}>
    {loading
      ? <span style={{ display:'inline-block', width:18, height:18, border:'2px solid var(--text-muted)', borderTopColor:'var(--jade)', borderRadius:'50%', animation:'spin 0.8s linear infinite' }}/>
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

  // Portfolio state
  const [portfolioData, setPortfolioData] = useState(null)
  const [riskData, setRiskData]           = useState(null)
  const [holdings, setHoldings]           = useState([])
  const [selectedFolios, setSelectedFolios] = useState([])
  const [ltvOverrides, setLtvOverrides]   = useState({})

  // Pledge state
  const [pledges, setPledges] = useState([])

  const stepIndex = STEPS.findIndex(s => s.id === currentStep)

  // ── Eligible credit calculation ───────────────────────────────
  // Uses backend-calculated eligible_credit when available (most accurate).
  // Falls back to value × LTV if not present.
  // If user has overridden LTV, always recalculates.
  const calcEligible = (h) => {
    if (ltvOverrides[h.folio_number] !== undefined) {
      return Math.round(parseFloat(h.current_value || h.value_at_fetch || 0) * ltvOverrides[h.folio_number])
    }
    if (h.eligible_credit != null && parseFloat(h.eligible_credit) > 0) {
      return Math.round(parseFloat(h.eligible_credit))
    }
    const val  = parseFloat(h.current_value || h.value_at_fetch || 0)
    const cat  = getCategoryInfo(h.scheme_type)
    const ltv  = h.ltv_cap
      ? (typeof h.ltv_cap === 'string' && h.ltv_cap.includes('%')
          ? parseFloat(h.ltv_cap) / 100
          : parseFloat(h.ltv_cap) > 1 ? parseFloat(h.ltv_cap) / 100 : parseFloat(h.ltv_cap))
      : cat.rate
    return Math.round(val * ltv)
  }

  const selectedEligible = holdings.filter(h => selectedFolios.includes(h.folio_number) && h.is_eligible)
  const selectedCredit   = selectedEligible.reduce((s, h) => s + calcEligible(h), 0)
  const totalPortfolioValue = holdings.reduce((s, h) => s + parseFloat(h.current_value || h.value_at_fetch || 0), 0)

  // ── KYC ───────────────────────────────────────────────────────
  const handleKYCProfile = async () => {
    if (!pan || !fullName || !dob) return toast.error('Fill all fields')
    setLoading(true)
    try {
      await submitKYCProfile({ pan, full_name: fullName, date_of_birth: dob, email: `${pan.toLowerCase()}@lienpay.in` })
      const res = await sendAadhaarOTP({ aadhaar_last4: '3421', consent_given: 'true' })

      // Capture txn_id as local variable — do NOT rely on state here.
      // React state updates (setAadhaarTxn) are async; when the setTimeout
      // fires 800ms later, the closure over `aadhaarTxn` state would still
      // read the old value ('') — causing the "txn_id not found" error.
      const txnId = res.data.txn_id
      setAadhaarTxn(txnId)

      if (res.data?.dev_otp) {
        // Dev bypass — auto-fill and auto-verify (AADHAAR_MODE=mock only)
        setAadhaarOTP(res.data.dev_otp)
        toast.success(`Aadhaar OTP: ${res.data.dev_otp} (auto-filled)`)
        setSubStep(1)
        // Pass BOTH otp and txnId directly — do NOT read from state
        setTimeout(() => handleAadhaarVerify(res.data.dev_otp, txnId), 800)
      } else {
        toast.success('PAN verified! OTP sent.')
        setSubStep(1)
      }
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // Accepts overrideOtp and overrideTxnId to avoid React state closure issues
  const handleAadhaarVerify = async (overrideOtp, overrideTxnId) => {
    const otpToUse = overrideOtp || aadhaarOTP
    const txnToUse = overrideTxnId || aadhaarTxn  // prefer direct value over state
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
  const handleLinkPortfolio = async () => {
    setLoading(true)
    try {
      const consentRes   = await initiateAAConsent()
      const portfolioRes = await fetchPortfolio(consentRes.data.consent_id)
      const riskRes      = await evaluateRisk()
      setPortfolioData(portfolioRes.data)
      setRiskData(riskRes.data)
      const allHoldings = portfolioRes.data.holdings || []
      setHoldings(allHoldings)
      setSelectedFolios(allHoldings.filter(h => h.is_eligible).map(h => h.folio_number))
      setSubStep(1)
      toast.success(`${portfolioRes.data.eligible_funds} eligible funds found!`)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const toggleFolio = (folio) => {
    setSelectedFolios(prev => prev.includes(folio) ? prev.filter(f => f !== folio) : [...prev, folio])
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
      toast.success('Credit line is live! 🎉')
      setOnboardingStep('ACTIVE')
      onComplete()
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ position:'fixed', inset:0, background:'var(--bg-void)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <LiquidBlob size={280} color="var(--jade)" top="-100px" right="-80px" />
      <LiquidBlob size={160} color="var(--jade)" bottom="200px" left="-50px" delay={4} />

      {/* Progress dots */}
      <div style={{ position:'relative', zIndex:1, padding:'18px 24px 0', display:'flex', gap:6 }}>
        {STEPS.map((s, i) => (
          <motion.div key={s.id}
            animate={{ width: i===stepIndex?32:8, background: i<=stepIndex?'var(--jade)':'var(--bg-elevated)' }}
            transition={{ duration:0.4 }}
            style={{ height:4, borderRadius:2 }}/>
        ))}
      </div>

      {/* Step header */}
      <div style={{ position:'relative', zIndex:1, padding:'14px 24px 0', marginBottom:4 }}>
        <AnimatePresence mode="wait">
          <motion.div key={currentStep} initial={{opacity:0,x:20}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-20}}>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <span style={{ fontSize:28 }}>{STEPS[stepIndex]?.icon}</span>
              <div>
                <h2 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:400 }}>{STEPS[stepIndex]?.title}</h2>
                <p style={{ fontSize:12, color:'var(--text-secondary)', marginTop:2 }}>{STEPS[stepIndex]?.sub}</p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Content */}
      <div style={{ position:'relative', zIndex:1, flex:1, overflowY:'auto', padding:'16px 24px 24px' }}>
        <AnimatePresence mode="wait">

          {/* ── KYC 0: PAN ── */}
          {currentStep==='KYC' && subStep===0 && (
            <motion.div key="kyc0" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <Field label="PAN NUMBER" id="pan" value={pan} onChange={v=>setPan(v.toUpperCase())} placeholder="ABCDE1234F" maxLength={10}/>
              <Field label="FULL NAME (AS PER PAN)" id="fname" value={fullName} onChange={setFullName} placeholder="Rahul Sharma"/>
              <Field label="DATE OF BIRTH" id="dob" value={dob} onChange={setDob} placeholder="1992-08-12" type="date"/>
              <CTA onClick={handleKYCProfile} loading={loading} label="Verify PAN →"/>
            </motion.div>
          )}

          {/* ── KYC 1: Aadhaar OTP ── */}
          {currentStep==='KYC' && subStep===1 && (
            <motion.div key="kyc1" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <div style={{ background:'var(--jade-dim)', border:'1px solid var(--jade-border)', borderRadius:16, padding:'14px 16px', marginBottom:20 }}>
                <p style={{ fontSize:13, color:'var(--jade)', fontWeight:700, marginBottom:3 }}>✓ PAN Verified</p>
                <p style={{ fontSize:12, color:'var(--text-secondary)' }}>Aadhaar OTP sent to your registered mobile</p>
              </div>
              <Field label="AADHAAR OTP" id="aadhaar-otp" value={aadhaarOTP} onChange={setAadhaarOTP} placeholder="6-digit OTP" type="tel" maxLength={6}/>
              <CTA onClick={()=>handleAadhaarVerify()} loading={loading} label="Complete KYC →"/>
            </motion.div>
          )}

          {/* ── PORTFOLIO 0: Link ── */}
          {currentStep==='PORTFOLIO' && subStep===0 && (
            <motion.div key="port0" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:20, padding:'28px 20px', marginBottom:20, textAlign:'center' }}>
                <motion.div animate={{rotate:[0,5,-5,0]}} transition={{duration:4,repeat:Infinity}} style={{fontSize:48,marginBottom:14}}>🔗</motion.div>
                <p style={{ fontSize:15, fontWeight:700, marginBottom:8 }}>Connect your MF Portfolio</p>
                <p style={{ fontSize:13, color:'var(--text-secondary)', lineHeight:1.6 }}>We'll securely fetch your holdings via Account Aggregator and calculate your eligible credit limit.</p>
              </div>
              <CTA onClick={handleLinkPortfolio} loading={loading} label="Link via Account Aggregator →"/>
              <p style={{ fontSize:10, color:'var(--text-muted)', textAlign:'center', marginTop:12, lineHeight:1.5 }}>Secured by RBI-regulated Account Aggregator framework.</p>
            </motion.div>
          )}

          {/* ── PORTFOLIO 1: Fund selection ── */}
          {currentStep==='PORTFOLIO' && subStep===1 && (
            <motion.div key="port1" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>

              {/* ── MOCK BANNER ── */}
              <div style={{ background:'rgba(224,160,48,0.08)', border:'1px solid rgba(224,160,48,0.25)', borderRadius:14, padding:'12px 14px', marginBottom:16, display:'flex', gap:10, alignItems:'flex-start' }}>
                <span style={{ fontSize:18, flexShrink:0 }}>⚠️</span>
                <div>
                  <p style={{ fontSize:12, fontWeight:700, color:'#E0A030', marginBottom:3 }}>DEMO DATA</p>
                  <p style={{ fontSize:11, color:'var(--text-secondary)', lineHeight:1.5 }}>In production, real fund data is fetched via Account Aggregator. LTV rates are assigned per SEBI/RBI fund category classifications.</p>
                </div>
              </div>

              {/* ── LTV CATEGORY TABLE ── */}
              <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px', marginBottom:16 }}>
                <p style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:'2px', fontFamily:'var(--font-mono)', fontWeight:500, marginBottom:10 }}>LTV RATES BY CATEGORY</p>
                {[
                  { label:'Liquid / Short Debt', rate:'80%', color:'#3B82F6' },
                  { label:'Balanced / Hybrid',   rate:'50%', color:'#F59E0B' },
                  { label:'Large Cap / Index',   rate:'50%', color:'#00D4A1' },
                  { label:'Flexi Cap',           rate:'40%', color:'#8B5CF6' },
                  { label:'Mid Cap',             rate:'30%', color:'#C9A449' },
                  { label:'Small Cap',           rate:'25%', color:'#EF4444' },
                ].map(r => (
                  <div key={r.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'5px 0', borderBottom:'1px solid var(--border)' }}>
                    <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{r.label}</span>
                    <span style={{ fontSize:13, fontWeight:700, fontFamily:'var(--font-mono)', color:r.color }}>{r.rate}</span>
                  </div>
                ))}
                <p style={{ fontSize:10, color:'var(--text-muted)', marginTop:8, lineHeight:1.5 }}>Rates set by RBI mandate. Debt funds get higher LTV (safer collateral). Equity gets lower LTV (more volatile).</p>
              </div>

              {/* ── CREDIT SUMMARY ── */}
              <div style={{ background:'var(--jade-dim)', border:'1px solid var(--jade-border)', borderRadius:14, padding:'14px 16px', marginBottom:16 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                  <span style={{ fontSize:12, color:'var(--text-secondary)' }}>Eligible credit limit</span>
                  <span style={{ fontSize:17, fontWeight:700, fontFamily:'var(--font-mono)', color:'var(--jade)' }}>{fmtL(selectedCredit)}</span>
                </div>
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>{selectedFolios.length} FUNDS SELECTED</span>
                  <span style={{ fontSize:10, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>TOTAL VALUE {fmtL(totalPortfolioValue)}</span>
                </div>
              </div>

              {/* ── FUND LIST ── */}
              {holdings.map((h, i) => {
                const cat       = getCategoryInfo(h.scheme_type)
                const selected  = selectedFolios.includes(h.folio_number)
                const eligible  = calcEligible(h)
                const fundValue = parseFloat(h.current_value || h.value_at_fetch || 0)
                return (
                  <motion.div key={h.folio_number}
                    initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:i*0.06}}
                    onClick={() => h.is_eligible && toggleFolio(h.folio_number)}
                    style={{
                      background: selected ? 'rgba(0,212,161,0.03)' : 'var(--bg-surface)',
                      border: `1px solid ${selected ? 'var(--jade-border)' : 'var(--border)'}`,
                      borderRadius:14, padding:'14px 16px', marginBottom:8,
                      position:'relative', overflow:'hidden',
                      cursor: h.is_eligible ? 'pointer' : 'default',
                      opacity: h.is_eligible ? 1 : 0.45,
                    }}>
                    {/* Category colour bar */}
                    <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background: selected ? 'var(--jade)' : cat.color }}/>
                    <div style={{ display:'flex', justifyContent:'space-between', marginLeft:8 }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <p style={{ fontSize:13, fontWeight:500, marginBottom:5, paddingRight:8, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{h.scheme_name}</p>
                        <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                          {/* Category badge */}
                          <span style={{ fontSize:9, fontWeight:600, padding:'2px 7px', borderRadius:5, background:`${cat.color}15`, color:cat.color }}>{cat.label}</span>
                          <span style={{ fontSize:10, color:'var(--text-muted)' }}>{h.rta}</span>
                          {/* LTV rate badge */}
                          <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:5, background:'var(--bg-elevated)', color:cat.color, fontFamily:'var(--font-mono)' }}>
                            {Math.round(cat.rate * 100)}% LTV
                          </span>
                          {!h.is_eligible && <span style={{ fontSize:9, color:'var(--red)', fontFamily:'var(--font-mono)' }}>INELIGIBLE</span>}
                        </div>
                      </div>
                      <div style={{ textAlign:'right', flexShrink:0 }}>
                        <p style={{ fontSize:14, fontWeight:600, fontFamily:'var(--font-mono)', color:'var(--text-primary)' }}>{fmtL(fundValue)}</p>
                        <p style={{ fontSize:11, color:'var(--jade)', fontFamily:'var(--font-mono)', fontWeight:600 }}>→ {fmtL(eligible)}</p>
                      </div>
                    </div>
                  </motion.div>
                )
              })}

              <div style={{ height:12 }}/>
              <CTA onClick={() => { setCurrentStep('PLEDGE'); setSubStep(0) }} loading={false} label={`Pledge Selected · ${fmtL(selectedCredit)} →`} disabled={selectedFolios.length===0}/>
            </motion.div>
          )}

          {/* ── PLEDGE 0: Initiate ── */}
          {currentStep==='PLEDGE' && subStep===0 && (
            <motion.div key="pledge0" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16, lineHeight:1.6 }}>
                Your selected mutual funds will be marked as lien with the RTA. You retain ownership — units keep growing but can't be redeemed while pledged.
              </p>
              {selectedFolios.map(folio => {
                const h = holdings.find(x => x.folio_number === folio)
                if (!h) return null
                const cat     = getCategoryInfo(h.scheme_type)
                const eligible = calcEligible(h)
                return (
                  <div key={folio} style={{ background:'var(--bg-surface)', border:'1px solid var(--jade-border)', borderRadius:14, padding:'14px 16px', marginBottom:8 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                      <div style={{ flex:1, minWidth:0, paddingRight:8 }}>
                        <span style={{ fontSize:9, fontFamily:'var(--font-mono)', fontWeight:600, color:cat.color }}>{h.rta} · {cat.label}</span>
                        <p style={{ fontSize:13, fontWeight:500, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{h.scheme_name}</p>
                      </div>
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', borderTop:'1px solid var(--border)', paddingTop:8 }}>
                      <div>
                        <p style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:'1.5px', fontFamily:'var(--font-mono)', marginBottom:3 }}>FUND VALUE</p>
                        <p style={{ fontSize:14, fontWeight:600, fontFamily:'var(--font-mono)' }}>{fmtL(h.current_value || h.value_at_fetch || 0)}</p>
                      </div>
                      <div style={{ textAlign:'center' }}>
                        <p style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:'1.5px', fontFamily:'var(--font-mono)', marginBottom:3 }}>LTV CAP</p>
                        <p style={{ fontSize:14, fontWeight:600, fontFamily:'var(--font-mono)', color:cat.color }}>{Math.round(cat.rate*100)}%</p>
                      </div>
                      <div style={{ textAlign:'right' }}>
                        <p style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:'1.5px', fontFamily:'var(--font-mono)', marginBottom:3 }}>ELIGIBLE CREDIT</p>
                        <p style={{ fontSize:14, fontWeight:700, fontFamily:'var(--font-mono)', color:'var(--jade)' }}>{fmtL(eligible)}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div style={{ background:'var(--jade-dim)', border:'1px solid var(--jade-border)', borderRadius:12, padding:'12px 14px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Total eligible credit</span>
                <span style={{ fontSize:16, fontWeight:700, fontFamily:'var(--font-mono)', color:'var(--jade)' }}>{fmtL(selectedCredit)}</span>
              </div>
              <CTA onClick={handleInitiatePledge} loading={loading} label="Initiate Pledge with RTA →"/>
            </motion.div>
          )}

          {/* ── PLEDGE 1: Confirm OTPs ── */}
          {currentStep==='PLEDGE' && subStep===1 && (
            <motion.div key="pledge1" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16, lineHeight:1.6 }}>
                RTAs have sent OTPs to confirm the lien marking. In dev mode these are auto-confirmed.
              </p>
              {pledges.map(pledge => {
                const holdingForPledge = holdings.find(h => h.folio_number === pledge.folio_number)
                const cat = getCategoryInfo(pledge.scheme_type || holdingForPledge?.scheme_type)
                const pledgeEligible = parseFloat(pledge.pledge_value || pledge.eligible_credit || 0) || (holdingForPledge ? calcEligible(holdingForPledge) : 0)
                return (
                  <div key={pledge.pledge_id} style={{ background:'var(--bg-surface)', border:'1px solid var(--jade-border)', borderRadius:14, padding:'14px 16px', marginBottom:8 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                      <div style={{ flex:1, minWidth:0, paddingRight:8 }}>
                        <span style={{ fontSize:9, fontFamily:'var(--font-mono)', fontWeight:600, color:cat.color }}>{pledge.rta}</span>
                        <p style={{ fontSize:13, fontWeight:500, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {pledge.scheme_name || holdingForPledge?.scheme_name || `Folio ${pledge.folio_number}`}
                        </p>
                      </div>
                      <div style={{ textAlign:'right', flexShrink:0 }}>
                        <p style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:'1.5px', fontFamily:'var(--font-mono)', marginBottom:2 }}>ELIGIBLE</p>
                        <p style={{ fontSize:14, fontWeight:700, fontFamily:'var(--font-mono)', color:'var(--jade)' }}>{fmtL(pledgeEligible)}</p>
                      </div>
                    </div>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <div style={{ width:18, height:18, borderRadius:'50%', background:'var(--jade)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:9, color:'var(--bg-void)', fontWeight:700 }}>✓</div>
                      <span style={{ fontSize:11, color:'var(--jade)' }}>OTP confirmed (dev mode)</span>
                    </div>
                  </div>
                )
              })}
              <div style={{ background:'var(--jade-dim)', border:'1px solid var(--jade-border)', borderRadius:12, padding:'12px 14px', marginBottom:16, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontSize:13, color:'var(--text-secondary)' }}>Total credit limit</span>
                <span style={{ fontSize:16, fontWeight:700, fontFamily:'var(--font-mono)', color:'var(--jade)' }}>{fmtL(selectedCredit)}</span>
              </div>
              <CTA onClick={handleConfirmPledges} loading={loading} label="Confirm All Pledges →"/>
            </motion.div>
          )}

          {/* ── CREDIT 0: KFS + Activate ── */}
          {currentStep==='CREDIT' && subStep===0 && (
            <motion.div key="credit0" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:16, padding:'18px', marginBottom:16 }}>
                <div style={{ fontSize:9, color:'var(--text-muted)', letterSpacing:'2px', fontFamily:'var(--font-mono)', marginBottom:14 }}>KEY FACT STATEMENT</div>
                {[
                  { k:'Credit Limit',        v: fmtL(riskData?.credit_limit || selectedCredit || 250000), c:'var(--jade)' },
                  { k:'Annual Interest Rate', v:`${riskData?.apr || '14.99'}% p.a.` },
                  { k:'Interest-Free Period', v:'30 days per transaction' },
                  { k:'Processing Fee',       v:'₹0 (waived)' },
                  { k:'Lender',              v:'FinServ NBFC Ltd.' },
                ].map((row, i, arr) => (
                  <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'10px 0', borderBottom: i<arr.length-1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ fontSize:12, color:'var(--text-secondary)' }}>{row.k}</span>
                    <span style={{ fontSize:13, fontWeight:600, fontFamily:'var(--font-mono)', color: row.c || 'var(--text-primary)' }}>{row.v}</span>
                  </div>
                ))}
              </div>
              <div style={{ background:'var(--bg-elevated)', border:'1px solid var(--border-light)', borderRadius:12, padding:'12px 14px', marginBottom:18, display:'flex', gap:8 }}>
                <span style={{ fontSize:16, flexShrink:0 }}>ℹ️</span>
                <p style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.5 }}>By activating, you agree to the KFS terms. Interest accrues only on amounts used beyond the free period.</p>
              </div>
              <CTA onClick={handleActivateCredit} loading={loading} label="Accept & Activate Credit Line →"/>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
