import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { sendOTP, verifyOTP } from '../api/client'
import useStore from '../store/useStore'
import { LiquidBlob } from '../components/LiquidUI'
import { LienzoLogoImage } from '../components/Logo'

export default function Auth() {
  const { setAuth, setOnboardingStep } = useStore()
  const [step, setStep]     = useState('mobile')
  const [mobile, setMobile] = useState('')
  const [otp, setOtp]       = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const otpRefs = useRef([])
  const verifyingRef = useRef(false)  // guard against double-fire

  const handleSendOTP = async () => {
    if (mobile.length !== 10) return toast.error('Enter a valid 10-digit mobile number')
    setLoading(true)
    try {
      await sendOTP(mobile)
      toast.success('OTP sent!')
      setStep('otp')
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
    if (verifyingRef.current) return  // prevent double-fire
    verifyingRef.current = true
    setLoading(true)
    try {
      const res = await verifyOTP(mobile, otpCode)
      setAuth(res.data.token, { mobile, user_id: res.data.user_id })
      const onbStep = res.data.onboarding_step || 'KYC'
      setOnboardingStep(onbStep)
      toast.success('Welcome to LienPay!')
    } catch (err) {
      toast.error(err.message)
      setOtp(['', '', '', '', '', ''])
      otpRefs.current[0]?.focus()
      verifyingRef.current = false  // allow retry on failure
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-void)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Liquid blobs */}
      <LiquidBlob size={280} color="var(--jade)" top="-100px" right="-60px" />
      <LiquidBlob size={180} color="var(--jade)" bottom="200px" left="-40px" delay={3} />

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '0 24px 40px',
        position: 'relative', zIndex: 1,
      }}>
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ marginBottom: 48 }}
        >
          <LienzoLogoImage size={44} />
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 400,
            letterSpacing: '-0.5px', marginTop: 20,
          }}>
            Welcome to<br />Lien<span style={{ color: 'var(--jade)' }}>Pay</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 8, lineHeight: 1.6, maxWidth: 280 }}>
            Your mutual funds, unlocked as a private credit line.
          </p>
        </motion.div>

        <AnimatePresence mode="wait">
          {step === 'mobile' ? (
            <motion.div
              key="mobile"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
            >
              <label style={{
                fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px',
                fontFamily: 'var(--font-mono)', fontWeight: 500, display: 'block', marginBottom: 10,
              }}>
                MOBILE NUMBER
              </label>

              <div style={{
                display: 'flex', alignItems: 'center',
                background: 'var(--bg-surface)', border: '1px solid var(--border-light)',
                borderRadius: 14, padding: '0 16px', marginBottom: 16,
              }}>
                <span style={{ color: 'var(--text-muted)', marginRight: 10, fontSize: 14, fontFamily: 'var(--font-mono)' }}>+91</span>
                <div style={{ width: 1, height: 20, background: 'var(--border)', marginRight: 10 }} />
                <input
                  id="mobile" name="mobile" autoComplete="tel" type="tel"
                  value={mobile}
                  onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="98765 43210"
                  onKeyDown={e => e.key === 'Enter' && handleSendOTP()}
                  style={{
                    flex: 1, height: 54, fontSize: 17, letterSpacing: '1.5px',
                    fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text-primary)',
                  }}
                />
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleSendOTP}
                disabled={loading || mobile.length !== 10}
                style={{
                  width: '100%', height: 54, borderRadius: 14,
                  background: mobile.length === 10
                    ? 'linear-gradient(135deg, var(--jade), #00A878)'
                    : 'var(--bg-elevated)',
                  color: mobile.length === 10 ? 'var(--bg-void)' : 'var(--text-muted)',
                  fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-sans)',
                  transition: 'all 0.3s', letterSpacing: '0.3px',
                  boxShadow: mobile.length === 10 ? '0 8px 32px rgba(0,212,161,0.2)' : 'none',
                }}
              >
                {loading ? '...' : 'Continue'}
              </motion.button>
            </motion.div>
          ) : (
            <motion.div
              key="otp"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 6 }}>
                Code sent to +91 {mobile.slice(0, 5)} •••••
              </p>
              <button
                onClick={() => setStep('mobile')}
                style={{ color: 'var(--jade)', fontSize: 12, marginBottom: 24, fontWeight: 600 }}
              >
                Change number
              </button>

              {/* ─── OTP INPUTS — FIXED: uses flexible grid, never overflows ─── */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(6, 1fr)',
                gap: 8,
                marginBottom: 28,
                maxWidth: '100%',
              }}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => otpRefs.current[i] = el}
                    id={`otp-${i}`}
                    name={`otp-${i}`}
                    type="tel"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOTPChange(i, e.target.value)}
                    onKeyDown={e => handleOTPKeyDown(i, e)}
                    autoFocus={i === 0}
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1.1',
                      maxHeight: 56,
                      textAlign: 'center',
                      fontSize: 20,
                      fontWeight: 600,
                      fontFamily: 'var(--font-mono)',
                      background: digit ? 'var(--jade-dim)' : 'var(--bg-surface)',
                      border: `1.5px solid ${digit ? 'var(--jade-border)' : 'var(--border-light)'}`,
                      borderRadius: 12,
                      color: 'var(--text-primary)',
                      transition: 'all 0.2s',
                      padding: 0,
                      minWidth: 0,
                    }}
                  />
                ))}
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => handleVerify()}
                disabled={loading || otp.join('').length !== 6}
                style={{
                  width: '100%', height: 54, borderRadius: 14,
                  background: otp.join('').length === 6
                    ? 'linear-gradient(135deg, var(--jade), #00A878)'
                    : 'var(--bg-elevated)',
                  color: otp.join('').length === 6 ? 'var(--bg-void)' : 'var(--text-muted)',
                  fontSize: 15, fontWeight: 600, fontFamily: 'var(--font-sans)',
                  transition: 'all 0.3s',
                }}
              >
                {loading ? 'Verifying...' : 'Verify & Continue'}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <p style={{
          textAlign: 'center', fontSize: 11, color: 'var(--text-muted)',
          marginTop: 24, lineHeight: 1.6,
        }}>
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  )
}
