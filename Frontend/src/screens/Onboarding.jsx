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

const STEPS = [
  { id: 'KYC',        title: 'Identity Verification', icon: '🪪', subtitle: 'PAN & Aadhaar verification' },
  { id: 'PORTFOLIO',  title: 'Link Portfolio',        icon: '📊', subtitle: 'Connect your mutual funds' },
  { id: 'PLEDGE',     title: 'Pledge Funds',          icon: '🔒', subtitle: 'Secure your credit line' },
  { id: 'CREDIT',     title: 'Activate Credit',       icon: '✨', subtitle: 'Your wealth-backed credit line' },
]

export default function Onboarding({ onComplete }) {
  const { setOnboardingStep } = useStore()
  const [currentStep, setCurrentStep] = useState('KYC')
  const [loading, setLoading] = useState(false)
  const [subStep, setSubStep] = useState(0)

  // KYC state
  const [pan, setPan]           = useState('')
  const [fullName, setFullName] = useState('')
  const [dob, setDob]           = useState('')
  const [aadhaarTxn, setAadhaarTxn] = useState('')
  const [aadhaarOTP, setAadhaarOTP] = useState('')

  // Portfolio state
  const [consentId, setConsentId]     = useState('')
  const [portfolioData, setPortfolioData] = useState(null)
  const [riskData, setRiskData]       = useState(null)

  // Pledge state
  const [pledges, setPledges]         = useState([])
  const [camsPledgeId, setCamsPledgeId] = useState('')
  const [camsOTP, setCamsOTP]         = useState('')

  // Credit state
  const [sanctionData, setSanctionData] = useState(null)

  const stepIndex = STEPS.findIndex(s => s.id === currentStep)

  // ── KYC FLOW ──────────────────────────────────────────────────

  const handleKYCProfile = async () => {
    if (!pan || !fullName || !dob) return toast.error('Fill all fields')
    setLoading(true)
    try {
      await submitKYCProfile({ pan, full_name: fullName, date_of_birth: dob, email: `${pan.toLowerCase()}@lienpay.in` })
      setSubStep(1)
      // Send Aadhaar OTP
      const res = await sendAadhaarOTP({ aadhaar_last4: '3421', consent_given: 'true' })
      setAadhaarTxn(res.data.txn_id)
      toast.success('Aadhaar OTP sent!')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAadhaarVerify = async () => {
    setLoading(true)
    try {
      await verifyAadhaarOTP({ txn_id: aadhaarTxn, otp: aadhaarOTP })
      await submitCKYC()
      await submitBureau()
      toast.success('KYC Complete! ✓')
      setCurrentStep('PORTFOLIO')
      setSubStep(0)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── PORTFOLIO FLOW ─────────────────────────────────────────────

  const handleLinkPortfolio = async () => {
    setLoading(true)
    try {
      const res = await initiateAAConsent()
      setConsentId(res.data.consent_id)
      // Auto-fetch (mock mode)
      const portfolioRes = await fetchPortfolio(res.data.consent_id)
      setPortfolioData(portfolioRes.data)
      // Evaluate risk
      const riskRes = await evaluateRisk()
      setRiskData(riskRes.data)
      setSubStep(1)
      toast.success(`Found ${portfolioRes.data.eligible_funds} eligible funds!`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleProceedToPledge = () => {
    setCurrentStep('PLEDGE')
    setSubStep(0)
  }

  // ── PLEDGE FLOW ────────────────────────────────────────────────

  const handleInitiatePledge = async () => {
    setLoading(true)
    try {
      const folios = portfolioData?.holdings?.map(h => ({ folio_number: h.folio_number })) || []
      const res = await initiatePledge(folios)
      setPledges(res.data.pledges)
      // Find CAMS pledge
      const camsPledge = res.data.pledges.find(p => p.rta === 'CAMS')
      if (camsPledge) setCamsPledgeId(camsPledge.pledge_id)
      setSubStep(1)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmAllPledges = async () => {
    setLoading(true)
    try {
      const confirmed = []
      for (const pledge of pledges) {
        const otp = pledge.rta === 'CAMS' ? '123456' : '654321'
        const res = await confirmPledgeOTP(pledge.pledge_id, otp)
        confirmed.push(pledge.pledge_id)
      }
      await notifyNBFC(confirmed)
      toast.success('All pledges confirmed!')
      setCurrentStep('CREDIT')
      setSubStep(0)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── CREDIT FLOW ────────────────────────────────────────────────

  const handleActivateCredit = async () => {
    setLoading(true)
    try {
      const sanctionRes = await requestSanction()
      setSanctionData(sanctionRes.data)
      const kfsRes = await getKFS({
        sanction_id:    sanctionRes.data.sanction_id,
        approved_limit: sanctionRes.data.sanctioned_limit,
        apr:            sanctionRes.data.apr,
      })
      await acceptKFS({
        sanction_id: sanctionRes.data.sanction_id,
        kfs_version: 'v1.0',
      })
      await activateCredit()
      await setupPIN()
      toast.success('Credit line activated! 🎉')
      setOnboardingStep('ACTIVE')
      onComplete()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── RENDER ─────────────────────────────────────────────────────

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-base)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Progress bar */}
      <div style={{
        height: 2,
        background: 'var(--bg-elevated)',
        position: 'relative',
      }}>
        <motion.div
          animate={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
          style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            background: 'linear-gradient(90deg, var(--jade), var(--gold))',
          }}
        />
      </div>

      {/* Header */}
      <div style={{ padding: '20px 24px 0' }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              style={{
                flex: 1, height: 3, borderRadius: 2,
                background: i <= stepIndex ? 'var(--jade)' : 'var(--bg-elevated)',
                transition: 'background 0.4s',
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 28 }}>{STEPS[stepIndex]?.icon}</span>
          <div>
            <h2 style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 22, fontWeight: 400,
            }}>
              {STEPS[stepIndex]?.title}
            </h2>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
              {STEPS[stepIndex]?.subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
        <AnimatePresence mode="wait">

          {/* ── KYC ─────────────────────────────────── */}
          {currentStep === 'KYC' && subStep === 0 && (
            <motion.div key="kyc-0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <Field label="PAN Number" value={pan} onChange={setPan} placeholder="ABCDE1234F" maxLength={10} transform={v => v.toUpperCase()} />
              <Field label="Full Name (as per PAN)" value={fullName} onChange={setFullName} placeholder="Rahul Sharma" />
              <Field label="Date of Birth" value={dob} onChange={setDob} placeholder="1992-08-12" type="date" />
              <CTAButton onClick={handleKYCProfile} loading={loading} label="Verify PAN →" />
            </motion.div>
          )}

          {currentStep === 'KYC' && subStep === 1 && (
            <motion.div key="kyc-1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{
                background: 'var(--jade-dim)', border: '1px solid var(--border-jade)',
                borderRadius: 14, padding: '14px 16px', marginBottom: 20,
              }}>
                <p style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 600, marginBottom: 4 }}>
                  ✓ PAN Verified
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Aadhaar OTP sent to your registered mobile
                </p>
              </div>
              <Field label="Aadhaar OTP" value={aadhaarOTP} onChange={setAadhaarOTP} placeholder="Enter 6-digit OTP" maxLength={6} type="tel" />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>
                Check Railway logs for mock OTP
              </p>
              <CTAButton onClick={handleAadhaarVerify} loading={loading} label="Complete KYC →" />
            </motion.div>
          )}

          {/* ── PORTFOLIO ────────────────────────────── */}
          {currentStep === 'PORTFOLIO' && subStep === 0 && (
            <motion.div key="port-0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 16, padding: '20px', marginBottom: 20,
              }}>
                <p style={{ fontSize: 32, textAlign: 'center', marginBottom: 12 }}>🔗</p>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.6 }}>
                  Connect your mutual fund portfolio via Account Aggregator.
                  We'll calculate your eligible credit limit instantly.
                </p>
              </div>
              <CTAButton onClick={handleLinkPortfolio} loading={loading} label="Link Portfolio →" />
            </motion.div>
          )}

          {currentStep === 'PORTFOLIO' && subStep === 1 && portfolioData && (
            <motion.div key="port-1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{
                background: 'var(--jade-dim)', border: '1px solid var(--border-jade)',
                borderRadius: 16, padding: '20px', marginBottom: 16, textAlign: 'center',
              }}>
                <p style={{ fontSize: 13, color: 'var(--jade)', marginBottom: 4 }}>Credit Limit Approved</p>
                <p style={{
                  fontFamily: 'var(--font-serif)', fontSize: 44, color: 'var(--jade)',
                  marginBottom: 4,
                }}>
                  ₹{(riskData?.approved_limit || 0).toLocaleString('en-IN')}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {riskData?.apr}% APR • Tier {riskData?.risk_tier}
                </p>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                {portfolioData.eligible_funds} eligible funds • ₹{(portfolioData.total_value || 0).toLocaleString('en-IN')} portfolio value
              </p>
              <CTAButton onClick={handleProceedToPledge} loading={false} label="Pledge & Activate →" />
            </motion.div>
          )}

          {/* ── PLEDGE ──────────────────────────────── */}
          {currentStep === 'PLEDGE' && subStep === 0 && (
            <motion.div key="pledge-0" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 16, padding: '20px', marginBottom: 20,
              }}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>What is pledging?</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  Your mutual fund units will be lien-marked with CAMS/KFintech as collateral.
                  Your investments continue to grow — we just hold them as security.
                </p>
              </div>
              <CTAButton onClick={handleInitiatePledge} loading={loading} label="Initiate Pledge →" />
            </motion.div>
          )}

          {currentStep === 'PLEDGE' && subStep === 1 && (
            <motion.div key="pledge-1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
                {pledges.map((p, i) => (
                  <div key={i} style={{
                    background: 'var(--bg-surface)', border: '1px solid var(--border)',
                    borderRadius: 14, padding: '14px 16px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>
                          {p.scheme_name?.split(' - ')[0]}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {p.rta} • OTP: <span style={{ color: 'var(--jade)', fontWeight: 600 }}>
                            {p.rta === 'CAMS' ? '123456' : '654321'}
                          </span>
                        </p>
                      </div>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: 'var(--jade-dim)', border: '1px solid var(--jade)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, color: 'var(--jade)',
                      }}>
                        ✓
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
                Mock OTPs shown above. In production, OTPs arrive via SMS from CAMS/KFintech.
              </p>
              <CTAButton onClick={handleConfirmAllPledges} loading={loading} label="Confirm All Pledges →" />
            </motion.div>
          )}

          {/* ── CREDIT ──────────────────────────────── */}
          {currentStep === 'CREDIT' && (
            <motion.div key="credit" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <div style={{
                background: 'linear-gradient(135deg, rgba(0,200,150,0.08), rgba(201,164,73,0.05))',
                border: '1px solid var(--border-jade)',
                borderRadius: 18, padding: '24px 20px',
                textAlign: 'center', marginBottom: 20,
              }}>
                <p style={{ fontSize: 40, marginBottom: 12 }}>🎉</p>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: 24, marginBottom: 8 }}>
                  Almost there!
                </p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                  We'll generate your Key Fact Statement (KFS), start the 3-day cooling-off period,
                  and activate your credit line — all in one tap.
                </p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                {[
                  'NBFC sanction request',
                  'KFS generation & acceptance',
                  '3-day cooling-off (waived in demo)',
                  'Credit line activation',
                  'UPI VPA creation',
                  'PIN setup via PSP SDK',
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%',
                      background: 'var(--jade-dim)', border: '1px solid var(--jade)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: 'var(--jade)', flexShrink: 0,
                    }}>✓</div>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{item}</p>
                  </div>
                ))}
              </div>
              <CTAButton onClick={handleActivateCredit} loading={loading} label="Activate My Credit Line →" />
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────

function Field({ label, value, onChange, placeholder, type = 'text', maxLength, transform }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.5px', marginBottom: 6 }}>
        {label.toUpperCase()}
      </p>
      <div style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '0 16px',
      }}>
        <input
          type={type}
          value={value}
          onChange={e => onChange(transform ? transform(e.target.value) : e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          style={{ width: '100%', height: 50, fontSize: 15 }}
        />
      </div>
    </div>
  )
}

function CTAButton({ onClick, loading, label }) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={loading}
      style={{
        width: '100%', height: 56, borderRadius: 16,
        background: loading ? 'var(--bg-elevated)' : 'linear-gradient(135deg, var(--jade), #00A878)',
        color: loading ? 'var(--text-muted)' : '#000',
        fontSize: 16, fontWeight: 700,
        fontFamily: 'var(--font-sans)',
        transition: 'all 0.3s',
        boxShadow: loading ? 'none' : '0 8px 24px rgba(0,200,150,0.2)',
      }}
    >
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            style={{
              width: 16, height: 16,
              border: '2px solid rgba(255,255,255,0.2)',
              borderTopColor: 'var(--text-secondary)',
              borderRadius: '50%',
            }}
          />
          Processing...
        </div>
      ) : label}
    </motion.button>
  )
}
