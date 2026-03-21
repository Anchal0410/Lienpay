import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { sendOTP, verifyOTP } from '../api/client'
import useStore from '../store/useStore'

export default function Auth() {
  const { setAuth, setOnboardingStep } = useStore()
  const [step, setStep]     = useState('mobile') // mobile | otp
  const [mobile, setMobile] = useState('')
  const [otp, setOtp]       = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const otpRefs = useRef([])

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
    setLoading(true)
    try {
      const res = await verifyOTP(mobile, otpCode)
      setAuth(res.data.token, { mobile, user_id: res.data.user_id })
      const step = res.data.onboarding_step || 'KYC'
      setOnboardingStep(step)
      toast.success('Welcome to LienPay!')
    } catch (err) {
      toast.error(err.message)
      setOtp(['', '', '', '', '', ''])
      otpRefs.current[0]?.focus()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-base)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
    }}>
      {/* Background gradient */}
      <div style={{
        position: 'absolute', top: -200, left: -100,
        width: 500, height: 500,
        background: 'radial-gradient(circle, #00C89615 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        justifyContent: 'flex-end', padding: '0 28px 48px',
      }}>
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ marginBottom: 48 }}
        >
          <h1 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 36,
            fontWeight: 400,
            color: 'var(--text-primary)',
          }}>
            Lien<span style={{ color: 'var(--jade)' }}>Pay</span>
          </h1>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            marginTop: 6,
            fontFamily: 'var(--font-sans)',
          }}>
            Your mutual funds, working for you
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
              <p style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                marginBottom: 12,
                letterSpacing: '0.5px',
              }}>
                MOBILE NUMBER
              </p>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: '0 20px',
                marginBottom: 16,
                transition: 'border-color 0.2s',
              }}>
                <span style={{ color: 'var(--text-secondary)', marginRight: 12, fontSize: 15 }}>🇮🇳 +91</span>
                <input
                  id="mobile"
                  name="mobile"
                  autoComplete="tel"
                  type="tel"
                  value={mobile}
                  onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  placeholder="98765 43210"
                  onKeyDown={e => e.key === 'Enter' && handleSendOTP()}
                  style={{
                    flex: 1, height: 56,
                    fontSize: 18,
                    letterSpacing: '1px',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleSendOTP}
                disabled={loading || mobile.length !== 10}
                style={{
                  width: '100%', height: 56,
                  borderRadius: 16,
                  background: mobile.length === 10
                    ? 'linear-gradient(135deg, var(--jade), #00A878)'
                    : 'var(--bg-elevated)',
                  color: mobile.length === 10 ? '#000' : 'var(--text-muted)',
                  fontSize: 16,
                  fontWeight: 600,
                  fontFamily: 'var(--font-sans)',
                  transition: 'all 0.3s',
                  letterSpacing: '0.3px',
                }}
              >
                {loading ? '...' : 'Get OTP →'}
              </motion.button>
            </motion.div>
          ) : (
            <motion.div
              key="otp"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
            >
              <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginBottom: 8 }}>
                OTP sent to +91 {mobile}
              </p>
              <button
                onClick={() => setStep('mobile')}
                style={{ color: 'var(--jade)', fontSize: 13, marginBottom: 28 }}
              >
                Change number
              </button>

              <div style={{ display: 'flex', gap: 10, marginBottom: 32 }}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={el => otpRefs.current[i] = el}
                    id={`otp-${i}`}
                    name={`otp-${i}`}
                    type="tel"
                    maxLength={1}
                    value={digit}
                    onChange={e => handleOTPChange(i, e.target.value)}
                    onKeyDown={e => handleOTPKeyDown(i, e)}
                    autoFocus={i === 0}
                    style={{
                      flex: 1, height: 56,
                      textAlign: 'center',
                      fontSize: 22,
                      fontWeight: 600,
                      background: digit ? 'var(--jade-dim)' : 'var(--bg-surface)',
                      border: `1px solid ${digit ? 'var(--jade)' : 'var(--border)'}`,
                      borderRadius: 12,
                      color: 'var(--text-primary)',
                      transition: 'all 0.2s',
                    }}
                  />
                ))}
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => handleVerify()}
                disabled={loading || otp.join('').length !== 6}
                style={{
                  width: '100%', height: 56,
                  borderRadius: 16,
                  background: otp.join('').length === 6
                    ? 'linear-gradient(135deg, var(--jade), #00A878)'
                    : 'var(--bg-elevated)',
                  color: otp.join('').length === 6 ? '#000' : 'var(--text-muted)',
                  fontSize: 16,
                  fontWeight: 600,
                  fontFamily: 'var(--font-sans)',
                  transition: 'all 0.3s',
                }}
              >
                {loading ? 'Verifying...' : 'Verify & Continue →'}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        <p style={{
          textAlign: 'center',
          fontSize: 12,
          color: 'var(--text-muted)',
          marginTop: 24,
          lineHeight: 1.6,
        }}>
          By continuing, you agree to our Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  )
}
