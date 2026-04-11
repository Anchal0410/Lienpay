import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import {
  submitKYCProfile, sendAadhaarOTP, verifyAadhaarOTP, submitCKYC, submitBureau,
  initiateAAConsent, fetchPortfolio, evaluateRisk,
  initiatePledge, confirmPledgeOTP, notifyNBFC,
  requestSanction, getKFS, acceptKFS, activateCredit, setupPIN,
  setAprProduct,
} from '../api/client'
import useStore from '../store/useStore'
import { LiquidBlob } from '../components/LiquidUI'
import APRChoiceStep from './APRChoiceStep'

const STEPS = [
  { id: 'KYC',        title: 'Verify Identity', icon: '🪪', sub: 'PAN & Aadhaar' },
  { id: 'PORTFOLIO',  title: 'Link Portfolio',   icon: '📊', sub: 'Connect mutual funds' },
  { id: 'PLEDGE',     title: 'Select & Pledge',  icon: '🔒', sub: 'Choose which funds' },
  { id: 'APR_CHOICE', title: 'Choose Your Plan', icon: '💳', sub: 'How you want to repay' },
  { id: 'CREDIT',     title: 'Activate Credit',  icon: '✨', sub: 'Go live' },
]

const fmtL = (n) => {
  const v = parseFloat(n || 0)
  return v >= 100000 ? `${(v / 100000).toFixed(2)}L` : v.toLocaleString('en-IN')
}

export default function Onboarding({ onComplete }) {
  const { setOnboardingStep } = useStore()

  const [currentStep, setCurrentStep] = useState('KYC')
  const [subStep, setSubStep]         = useState(0)
  const stepIndex = STEPS.findIndex(s => s.id === currentStep)
  const [loading, setLoading]         = useState(false)

  // KYC
  const [pan, setPan]                 = useState('')
  const [fullName, setFullName]       = useState('')
  const [dob, setDob]                 = useState('')
  const [aadhaarLast4, setAadhaarLast4] = useState('')
  const [aadhaarOTP, setAadhaarOTP]   = useState('')
  const [aadhaarTxn, setAadhaarTxn]   = useState('')

  // Portfolio
  const [riskData, setRiskData]           = useState(null)
  const [holdings, setHoldings]           = useState([])
  const [selectedFolios, setSelectedFolios] = useState([])
  const [ltvOverrides, setLtvOverrides]   = useState({})

  // Pledge
  const [pledges, setPledges]   = useState([])

  // APR
  const [aprProduct, setAprLocal] = useState(null)

  // ── KYC ────────────────────────────────────────────────
  const handlePANSubmit = async () => {
    if (!pan || !fullName || !dob) return toast.error('Fill all fields')
    setLoading(true)
    try {
      await submitKYCProfile({ pan: pan.toUpperCase(), full_name: fullName, date_of_birth: dob })
      toast.success('PAN verified ✓')
      setSubStep(1)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const handleAadhaarSend = async () => {
    if (!aadhaarLast4 || aadhaarLast4.length !== 4) return toast.error('Enter last 4 digits')
    setLoading(true)
    try {
      const res = await sendAadhaarOTP({ aadhaar_last4: aadhaarLast4, consent_given: true })
      setAadhaarTxn(res.data.txn_id)
      toast.success('OTP sent.')
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const handleAadhaarVerify = async () => {
    if (!aadhaarOTP) return toast.error('Enter OTP')
    setLoading(true)
    try {
      await verifyAadhaarOTP({ txn_id: aadhaarTxn, otp: aadhaarOTP })
      await submitCKYC()
      await submitBureau() // no-op for LAMF, marks KYC complete
      toast.success('KYC Complete! ✓')
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
      setRiskData(riskRes.data)
      setHoldings(portfolioRes.data.holdings || [])
      setSelectedFolios(
        (portfolioRes.data.holdings || []).filter(h => h.is_eligible).map(h => h.folio_number)
      )
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

  // ── PLEDGE ─────────────────────────────────────────────
  const handleInitiatePledge = async () => {
    if (!selectedFolios.length) return toast.error('Select at least one fund')
    setLoading(true)
    try {
      const folios = selectedFolios.map(f => ({ folio_number: f, ltv_override: ltvOverrides[f] }))
      const res = await initiatePledge(folios)
      setPledges(res.data.pledges || [])
      if (res.data.notorious_warning) toast.error(res.data.notorious_warning, { duration: 5000 })
      setSubStep(1)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  const handleConfirmPledges = async () => {
    setLoading(true)
    try {
      const confirmed = []
      for (const pledge of pledges) {
        await confirmPledgeOTP(pledge.pledge_id, '123456') // dev OTP
        confirmed.push(pledge.pledge_id)
      }
      await notifyNBFC(confirmed)
      toast.success('All pledges confirmed! ✓')
      // ← Goes to APR_CHOICE, not CREDIT
      setCurrentStep('APR_CHOICE')
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // ── APR CHOICE ─────────────────────────────────────────
  // Called by APRChoiceStep when user confirms their selection
  // APRChoiceStep handles the API call internally (POST /api/users/apr-product)
  const handleAprChoice = (chosen) => {
    setAprLocal(chosen)
    setCurrentStep('CREDIT')
  }

  // ── CREDIT ─────────────────────────────────────────────
  const handleActivateCredit = async () => {
    setLoading(true)
    try {
      const sanctionRes = await requestSanction()
      await getKFS({
        sanction_id:    sanctionRes.data.sanction_id,
        approved_limit: sanctionRes.data.sanctioned_limit,
        apr:            sanctionRes.data.apr,
      })
      await acceptKFS({ sanction_id: sanctionRes.data.sanction_id, kfs_version: 'v1.0' })
      await activateCredit()
      await setupPIN()
      toast.success('Credit line is live! 🎉')
      setOnboardingStep('ACTIVE')
      onComplete()
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  // ── HELPERS ────────────────────────────────────────────
  const calcEligible = (h) => {
    const ltv = ltvOverrides[h.folio_number] || parseFloat((h.ltv_cap || '').replace('%','') || 0) / 100
    return Math.round((h.current_value || 0) * ltv)
  }
  const selectedEligible  = holdings.filter(h => selectedFolios.includes(h.folio_number) && h.is_eligible)
  const selectedCredit    = selectedEligible.reduce((s, h) => s + calcEligible(h), 0)

  return (
    <div style={{ position:'fixed', inset:0, background:'var(--bg-void)', display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <LiquidBlob size={280} color="var(--jade)" top="-100px" right="-80px" />
      <LiquidBlob size={160} color="var(--jade)" bottom="200px" left="-50px" delay={4} />

      {/* Progress */}
      <div style={{ position:'relative', zIndex:1, padding:'18px 24px 0', display:'flex', gap:6 }}>
        {STEPS.map((s, i) => (
          <motion.div key={s.id}
            animate={{ width: i===stepIndex?32:8, background: i<=stepIndex?'var(--jade)':'var(--bg-elevated)' }}
            transition={{ duration:0.4 }}
            style={{ height:4, borderRadius:2 }}
          />
        ))}
      </div>

      {/* Header */}
      <div style={{ position:'relative', zIndex:1, padding:'14px 24px 0', marginBottom:4 }}>
        <AnimatePresence mode="wait">
          <motion.div key={currentStep} initial={{ opacity:0, x:20 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:-20 }}>
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
      <div style={{ position:'relative', zIndex:1, flex:1, overflow:'auto', padding:'16px 24px 24px' }}>
        <AnimatePresence mode="wait">

          {/* KYC 0: PAN */}
          {currentStep==='KYC' && subStep===0 && (
            <motion.div key="kyc0" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <Field label="PAN NUMBER" id="pan" value={pan} onChange={setPan} placeholder="ABCDE1234F" maxLength={10} />
              <Field label="FULL NAME (as on PAN)" id="name" value={fullName} onChange={setFullName} placeholder="Your legal name" />
              <Field label="DATE OF BIRTH" id="dob" value={dob} onChange={setDob} placeholder="YYYY-MM-DD" type="date" />
              <CTA onClick={handlePANSubmit} loading={loading} label="Verify PAN →" />
            </motion.div>
          )}

          {/* KYC 1: Aadhaar */}
          {currentStep==='KYC' && subStep===1 && (
            <motion.div key="kyc1" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <Field label="AADHAAR LAST 4 DIGITS" id="aadhaar" value={aadhaarLast4} onChange={setAadhaarLast4} placeholder="XXXX" maxLength={4} type="number" />
              <motion.button className="btn-primary" style={{marginBottom:12}}
                onClick={handleAadhaarSend} disabled={loading || !!aadhaarTxn}>
                {aadhaarTxn ? 'OTP Sent ✓' : 'Send Aadhaar OTP'}
              </motion.button>
              {aadhaarTxn && (
                <>
                  <Field label="6-DIGIT OTP" id="otp" value={aadhaarOTP} onChange={setAadhaarOTP} placeholder="______" maxLength={6} type="number" />
                  <CTA onClick={handleAadhaarVerify} loading={loading} label="Verify & Continue →" />
                </>
              )}
            </motion.div>
          )}

          {/* Portfolio 0: Fetch */}
          {currentStep==='PORTFOLIO' && subStep===0 && (
            <motion.div key="port0" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:18,padding:20,marginBottom:20}}>
                <p style={{fontSize:15,fontWeight:700,marginBottom:8}}>Connect your mutual funds</p>
                <p style={{fontSize:13,color:'var(--text-secondary)',lineHeight:1.6}}>
                  We'll fetch your portfolio via MF Central — a government-mandated repository. Your units stay untouched.
                </p>
              </div>
              <CTA onClick={handleLinkPortfolio} loading={loading} label="Fetch My Portfolio →" />
            </motion.div>
          )}

          {/* Portfolio 1: Select */}
          {currentStep==='PORTFOLIO' && subStep===1 && (
            <motion.div key="port1" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:16}}>
                {holdings.map((h,i) => (
                  <motion.div key={i}
                    onClick={() => h.is_eligible && toggleFolio(h.folio_number)}
                    style={{
                      background: selectedFolios.includes(h.folio_number)?'var(--jade-dim)':'var(--bg-surface)',
                      border: `1px solid ${selectedFolios.includes(h.folio_number)?'var(--jade-border)':'var(--border)'}`,
                      borderRadius:16, padding:'14px 16px',
                      opacity: h.is_eligible?1:0.5, cursor: h.is_eligible?'pointer':'not-allowed',
                    }}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <div style={{flex:1,marginRight:12}}>
                        <p style={{fontSize:13,fontWeight:600,marginBottom:3}}>{h.scheme_name?.split(' - ')[0]}</p>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                          <span style={{fontSize:9,background:'var(--bg-elevated)',padding:'2px 7px',borderRadius:5,color:'var(--text-secondary)'}}>
                            {h.scheme_type?.replace('EQUITY_','').replace('DEBT_','').replace(/_/g,' ')}
                          </span>
                          {h.is_notorious && (
                            <span style={{fontSize:9,background:'rgba(239,68,68,0.1)',padding:'2px 7px',borderRadius:5,color:'#EF4444',border:'1px solid rgba(239,68,68,0.3)'}}>
                              ⚠ WATCHLIST
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <p style={{fontFamily:'var(--font-mono)',fontSize:14,fontWeight:800}}>₹{fmtL(h.current_value)}</p>
                        <p style={{fontSize:10,color:'var(--jade)'}}>{h.ltv_cap} LTV</p>
                      </div>
                    </div>
                    {!h.is_eligible && <p style={{fontSize:10,color:'#E05252',marginTop:6}}>{h.ineligible_reason}</p>}
                  </motion.div>
                ))}
              </div>
              <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:14,padding:'12px 16px',marginBottom:16,display:'flex',justifyContent:'space-between'}}>
                <span style={{fontSize:12,color:'var(--text-secondary)'}}>{selectedFolios.length} fund{selectedFolios.length!==1?'s':''} selected</span>
                <span style={{fontFamily:'var(--font-mono)',fontSize:14,color:'var(--jade)',fontWeight:800}}>₹{fmtL(selectedCredit)} eligible</span>
              </div>
              <CTA onClick={() => { setCurrentStep('PLEDGE'); setSubStep(0) }}
                label={`Pledge ${selectedFolios.length} Fund${selectedFolios.length!==1?'s':''} →`}
                disabled={!selectedFolios.length} />
            </motion.div>
          )}

          {/* Pledge 0: Info */}
          {currentStep==='PLEDGE' && subStep===0 && (
            <motion.div key="pledge0" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:18,padding:20,marginBottom:16}}>
                <p style={{fontSize:14,fontWeight:700,marginBottom:10}}>What happens when you pledge?</p>
                {['Units are lien-marked — not sold','Portfolio keeps growing as collateral','MF Central manages the pledge securely','Release anytime by closing your credit line'].map((item,i)=>(
                  <div key={i} style={{display:'flex',gap:10,alignItems:'flex-start',marginBottom:8}}>
                    <div style={{width:18,height:18,borderRadius:'50%',background:'var(--jade-dim)',border:'1px solid var(--jade-border)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:1}}>
                      <span style={{fontSize:9,color:'var(--jade)'}}>✓</span>
                    </div>
                    <p style={{fontSize:13,color:'var(--text-secondary)',lineHeight:1.5}}>{item}</p>
                  </div>
                ))}
              </div>
              <CTA onClick={handleInitiatePledge} loading={loading} label="Initiate Pledge →" />
            </motion.div>
          )}

          {/* Pledge 1: Confirm OTPs */}
          {currentStep==='PLEDGE' && subStep===1 && (
            <motion.div key="pledge1" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
                {pledges.map((p,i)=>(
                  <motion.div key={i} initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} transition={{delay:i*0.08}}
                    style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:16}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                      <div style={{flex:1,marginRight:12}}>
                        <p style={{fontSize:13,fontWeight:600,marginBottom:4}}>{p.scheme_name?.split(' - ')[0]}</p>
                        <div style={{display:'flex',gap:8,alignItems:'center'}}>
                          <span style={{fontSize:10,background:'var(--bg-elevated)',padding:'2px 8px',borderRadius:6,color:'var(--text-secondary)'}}>MF Central</span>
                          <span style={{fontSize:11,color:'var(--text-muted)'}}>{parseFloat(p.units_pledged||0).toFixed(3)} units</span>
                        </div>
                      </div>
                      <div style={{background:'var(--jade-dim)',border:'1px solid var(--jade-border)',borderRadius:10,padding:'4px 10px',flexShrink:0}}>
                        <p style={{fontSize:10,color:'var(--jade)',fontWeight:700}}>OTP (dev)</p>
                        <p style={{fontFamily:'var(--font-mono)',fontSize:18,color:'var(--jade)',fontWeight:900}}>123456</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
              <p style={{fontSize:12,color:'var(--text-muted)',marginBottom:16,lineHeight:1.5}}>
                Mock OTP shown above. In production, OTP arrives via SMS from MF Central to your registered mobile.
              </p>
              <CTA onClick={handleConfirmPledges} loading={loading} label="Confirm All Pledges →" />
            </motion.div>
          )}

          {/* APR CHOICE — new step */}
          {currentStep==='APR_CHOICE' && (
            <motion.div key="apr" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <APRChoiceStep onChoose={handleAprChoice} creditLimit={riskData?.approved_limit||0} />
            </motion.div>
          )}

          {/* Credit */}
          {currentStep==='CREDIT' && (
            <motion.div key="credit" initial={{opacity:0,x:30}} animate={{opacity:1,x:0}} exit={{opacity:0}}>
              <motion.div
                animate={{background:['var(--jade-dim)','var(--jade-glow)','var(--jade-dim)']}}
                transition={{duration:3,repeat:Infinity}}
                style={{border:'1px solid var(--jade-border)',borderRadius:24,padding:'28px 20px',textAlign:'center',marginBottom:20}}>
                <motion.div animate={{scale:[1,1.1,1]}} transition={{duration:3,repeat:Infinity}}>
                  <span style={{fontSize:52}}>🎉</span>
                </motion.div>
                <h3 style={{fontFamily:'var(--font-display)',fontSize:24,fontWeight:400,marginTop:12,marginBottom:8}}>Almost there!</h3>
                <p style={{fontSize:13,color:'var(--text-secondary)',lineHeight:1.6}}>
                  {aprProduct==='REVOLVING'
                    ? 'Activating your 18% revolving credit line. Pay interest monthly, principal whenever.'
                    : 'Activating your 12% standard credit line. 30 days interest-free on every payment.'}
                </p>
              </motion.div>
              {['NBFC sanction request','KFS generation (RBI mandate)','3-day cooling-off','Credit line activation','UPI VPA — mobile@yesbank','PIN setup via Yes Bank SDK'].map((item,i)=>(
                <div key={i} style={{display:'flex',gap:10,alignItems:'center',marginBottom:8}}>
                  <div style={{width:20,height:20,borderRadius:'50%',background:'var(--jade-dim)',border:'1px solid var(--jade-border)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <span style={{fontSize:9,color:'var(--jade)'}}>✓</span>
                  </div>
                  <p style={{fontSize:13,color:'var(--text-secondary)'}}>{item}</p>
                </div>
              ))}
              <div style={{marginTop:16}}>
                <CTA onClick={handleActivateCredit} loading={loading} label="Activate My Credit Line 🚀" />
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}

function Field({ label, id, value, onChange, placeholder, type='text', maxLength }) {
  return (
    <div style={{marginBottom:14}}>
      <p style={{fontSize:9,color:'var(--text-muted)',letterSpacing:'2.5px',marginBottom:7,fontFamily:'var(--font-mono)',fontWeight:500}}>{label}</p>
      <input id={id} name={id} type={type} value={value} onChange={e=>onChange(e.target.value)}
        placeholder={placeholder} maxLength={maxLength}
        style={{width:'100%',height:52,fontSize:15,background:'var(--bg-surface)',borderRadius:14,padding:'0 16px',color:'var(--text-primary)',border:'1px solid var(--border-light)',boxSizing:'border-box',fontFamily:'var(--font-sans)',outline:'none'}}
      />
    </div>
  )
}

function CTA({ onClick, loading, label, disabled=false }) {
  return (
    <motion.button whileTap={{scale:0.97}} onClick={onClick} disabled={loading||disabled}
      style={{width:'100%',height:56,borderRadius:16,background:disabled||loading?'var(--bg-elevated)':'linear-gradient(135deg, var(--jade), #00A878)',
        color:disabled||loading?'var(--text-muted)':'var(--bg-void)',fontSize:15,fontWeight:700,fontFamily:'var(--font-sans)',border:'none',cursor:disabled||loading?'not-allowed':'pointer'}}>
      {loading ? 'Please wait…' : label}
    </motion.button>
  )
}
