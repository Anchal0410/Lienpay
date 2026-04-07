import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { sendOTP, verifyOTP } from '../api/client'
import useStore from '../store/useStore'
import { LiquidBlob } from '../components/LiquidUI'
import { LienzoLogoImage } from '../components/Logo'

export default function Auth() {
  const { setAuth, setOnboardingStep } = useStore()
  const [step, setStep]       = useState('mobile')
  const [mobile, setMobile]   = useState('')
  const [otp, setOtp]         = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const otpRefs      = useRef([])
  const verifyingRef = useRef(false)

  const handleSendOTP = async () => {
    if (mobile.length !== 10) return toast.error('Enter a valid 10-digit mobile number')
    setLoading(true)
    try {
      const res = await sendOTP(mobile)
      if (res?.data?.dev_otp) {
        const devOtp = String(res.data.dev_otp)
        setOtp(devOtp.split(''))
        toast.success(`Dev mode — OTP: ${devOtp} (auto-filled)`)
        setStep('otp')
        setTimeout(() => handleVerify(devOtp), 800)
      } else {
        toast.success('OTP sent!')
        setStep('otp')
      }
    } catch (err) {
      toast.error(err.message || 'Failed to send OTP')
    } finally {
      setLoading(false)
    }
  }

  const handleOTPChange = (index, value) => {
    if (!/^\d*$/.test(value)) return
    const newOtp = [...otp]
    newOtp[index] = value.slice(-1)
    setOtp(newOtp)
    if (value && index < 5) otpRefs.current[index + 1]?.focus()
    if (newOtp.every(d => d) && newOtp.join('').length === 6) {
      handleVerify(newOtp.join(''))
    }
  }

  const handleOTPKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus()
    }
  }

  const handleVerify = async (code) => {
    const otpCode = code || otp.join('')
    if (otpCode.length !== 6) return
    if (verifyingRef.current) return
    verifyingRef.current = true
    setLoading(true)
    try {
      const res      = await verifyOTP(mobile, otpCode)
      const userData = res.data.user || res.data
      setAuth(res.data.token, { mobile, user_id: userData.user_id })
      const rawStep  = userData.onboarding_step
      const onbStep  = (rawStep === 'COMPLETE' || userData.account_status === 'CREDIT_ACTIVE')
        ? 'COMPLETE' : (rawStep || 'KYC')
      setOnboardingStep(onbStep)
      toast.success(onbStep === 'COMPLETE' ? 'Welcome back! 👋' : 'Welcome to LienPay!')
    } catch (err) {
      verifyingRef.current = false
      toast.error(err.message || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const otpFilled = otp.join('').length === 6

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-void)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      <LiquidBlob size={280} color="var(--jade)" top="-80px" left="-60px" />
      <LiquidBlob size={200} color="var(--jade)" bottom="80px" right="-50px" delay={2} />

      <div style={{ position: 'relative', zIndex: 10, width: '100%', maxWidth: 400, padding: '0 24px' }}>

        {/* Logo */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
          style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-block', marginBottom: 16 }}>
            <LienzoLogoImage size={52} />
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400, marginBottom: 6 }}>
            Lien<span style={{ color: 'var(--jade)' }}>Pay</span>
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', letterSpacing: '1px' }}>
            WEALTH-BACKED CREDIT
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {step === 'mobile' ? (
            <motion.div key="mobile" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
              <label style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', fontWeight: 500, display: 'block', marginBottom: 10 }}>
                MOBILE NUMBER
              </label>

              <div style={{ display: 'flex', alignItems: 'center', background: 'var(--bg-surface)', border: '1px solid var(--border-light)', borderRadius: 14, padding: '0 16px', marginBottom: 16 }}>
                <span style={{ color: 'var(--text-muted)', marginRight: 10, fontSize: 14, fontFamily: 'var(--font-mono)' }}>+91</span>
                <div style={{ width: 1, height: 20, background: 'var(--border)', marginRight: 10 }} />
                <input
                  id="mobile" name="mobile" autoComplete="tel" type="tel"
                  value={mobile}
                  onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="98765 43210"
                  onKeyDown={e => e.key === 'Enter' && mobile.length === 10 && handleSendOTP()}
                  style={{ flex: 1, height: 54, fontSize: 17, letterSpacing: '1.5px', fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text-primary)', background: 'transparent', border: 'none', outline: 'none' }}
                />
                {mobile.length === 10 && (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ fontSize: 16 }}>✓</motion.span>
                )}
              </div>

              {/* ── FIX: explicit color #000 on active, clear text "Send OTP" ── */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleSendOTP}
                disabled={loading || mobile.length !== 10}
                style={{
                  width: '100%', height: 54, borderRadius: 14,
                  background: mobile.length === 10
                    ? 'linear-gradient(135deg, #00D4A1, #00A878)'
                    : 'var(--bg-elevated)',
                  // ── FIX: use explicit #000 not var(--bg-void) which can be invisible ──
                  color: mobile.length === 10 ? '#000000' : 'var(--text-muted)',
                  fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
                  transition: 'all 0.3s', letterSpacing: '0.3px',
                  boxShadow: mobile.length === 10 ? '0 8px 32px rgba(0,212,161,0.25)' : 'none',
                  border: 'none', cursor: mobile.length === 10 ? 'pointer' : 'not-allowed',
                }}>
                {loading ? 'Sending…' : mobile.length === 10 ? 'Send OTP →' : 'Enter mobile number'}
              </motion.button>
            </motion.div>

          ) : (
            <motion.div key="otp" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 4 }}>
                Code sent to +91 {mobile.slice(0, 5)} •••••
              </p>
              <button onClick={() => { setStep('mobile'); setOtp(['','','','','','']); verifyingRef.current = false }}
                style={{ color: 'var(--jade)', fontSize: 12, marginBottom: 28, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                ← Change number
              </button>

              {/* OTP boxes */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8, marginBottom: 28, maxWidth: '100%' }}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => otpRefs.current[i] = el}
                    id={`otp-${i}`} name={`otp-${i}`}
                    type="tel" inputMode="numeric" maxLength={1}
                    value={digit}
                    onChange={e => handleOTPChange(i, e.target.value)}
                    onKeyDown={e => handleOTPKeyDown(i, e)}
                    autoFocus={i === 0}
                    style={{
                      width: '100%', aspectRatio: '1 / 1.1', maxHeight: 56,
                      textAlign: 'center', fontSize: 20, fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      background: digit ? 'var(--jade-dim)' : 'var(--bg-surface)',
                      border: `1.5px solid ${digit ? 'var(--jade-border)' : 'var(--border-light)'}`,
                      borderRadius: 12,
                      // ── FIX: explicit text color ──
                      color: 'var(--text-primary)',
                      outline: 'none', transition: 'all 0.2s', padding: 0, minWidth: 0,
                    }}
                  />
                ))}
              </div>

              {/* ── FIX: explicit #000 on active, clear label "Verify OTP" ── */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => handleVerify()}
                disabled={loading || !otpFilled}
                style={{
                  width: '100%', height: 54, borderRadius: 14,
                  background: otpFilled
                    ? 'linear-gradient(135deg, #00D4A1, #00A878)'
                    : 'var(--bg-elevated)',
                  color: otpFilled ? '#000000' : 'var(--text-muted)',
                  fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)',
                  transition: 'all 0.3s',
                  border: 'none', cursor: otpFilled ? 'pointer' : 'not-allowed',
                  boxShadow: otpFilled ? '0 8px 32px rgba(0,212,161,0.25)' : 'none',
                }}>
                {loading ? 'Verifying…' : otpFilled ? 'Verify OTP →' : 'Enter 6-digit OTP'}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginTop: 28, lineHeight: 1.6 }}>
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  )
}
