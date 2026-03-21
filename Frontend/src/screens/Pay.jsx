import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { initiatePayment, mockSettle, getCreditStatus } from '../api/client'
import useStore from '../store/useStore'

const formatCurrency = (n) =>
  `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

export default function Pay({ onBack, onSuccess }) {
  const { creditAccount, setCreditAccount } = useStore()
  const [step, setStep]     = useState('scan')  // scan | confirm | pin | success | failed
  const [txnData, setTxnData] = useState(null)
  const [txnResult, setTxnResult] = useState(null)
  const [manualVPA, setManualVPA] = useState('')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)

  const available = parseFloat(creditAccount?.available_credit || 0)

  // Mock QR data for demo
  const mockQRs = [
    { merchant_vpa: 'zomato@icici',   merchant_name: 'Zomato',   amount: 299,  emoji: '🍕' },
    { merchant_vpa: 'swiggy@hdfc',    merchant_name: 'Swiggy',   amount: 180,  emoji: '🛵' },
    { merchant_vpa: 'amazon@apl',     merchant_name: 'Amazon',   amount: 1299, emoji: '📦' },
    { merchant_vpa: 'petrol@icici',   merchant_name: 'HP Petrol', amount: 2000, emoji: '⛽' },
  ]

  const handleMockQR = (qr) => {
    setTxnData({ merchant_vpa: qr.merchant_vpa, merchant_name: qr.merchant_name, amount: qr.amount })
    setStep('confirm')
  }

  const handleManualPay = () => {
    if (!manualVPA.includes('@')) return toast.error('Enter a valid UPI ID')
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return toast.error('Enter a valid amount')
    setTxnData({ merchant_vpa: manualVPA, merchant_name: manualVPA, amount: parseFloat(amount) })
    setStep('confirm')
  }

  const handleConfirm = async () => {
    if (!txnData) return
    if (txnData.amount > available) {
      toast.error(`Insufficient credit. Available: ${formatCurrency(available)}`)
      return
    }
    setStep('pin')
  }

  const handlePINComplete = async () => {
    setLoading(true)
    try {
      // Initiate payment
      const initRes = await initiatePayment({
        merchant_vpa:  txnData.merchant_vpa,
        merchant_name: txnData.merchant_name,
        amount:        txnData.amount,
        mcc:           '5812',
      })

      const txnId = initRes.data.txn_id

      // Mock settle (dev mode)
      await mockSettle(txnId)

      // Refresh credit account
      const creditRes = await getCreditStatus()
      setCreditAccount(creditRes.data)

      setTxnResult({ txn_id: txnId, amount: txnData.amount, merchant: txnData.merchant_name })
      setStep('success')
    } catch (err) {
      toast.error(err.message)
      setStep('failed')
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
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        display: 'flex', alignItems: 'center', gap: 16,
        borderBottom: '1px solid var(--border)',
      }}>
        <button onClick={onBack} style={{
          width: 36, height: 36, borderRadius: 10,
          background: 'var(--bg-surface)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18,
        }}>
          ←
        </button>
        <div>
          <h2 style={{ fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600 }}>
            {step === 'scan' ? 'Scan & Pay' : step === 'confirm' ? 'Confirm Payment' : step === 'pin' ? 'Enter PIN' : step === 'success' ? 'Payment Sent' : 'Payment Failed'}
          </h2>
          <p style={{ fontSize: 11, color: 'var(--jade)', marginTop: 1 }}>
            Available: {formatCurrency(available)}
          </p>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
        <AnimatePresence mode="wait">

          {/* SCAN STEP */}
          {step === 'scan' && (
            <motion.div
              key="scan"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* QR Scanner placeholder */}
              <div style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 20,
                padding: 20,
                marginBottom: 20,
                position: 'relative',
                overflow: 'hidden',
              }}>
                {/* Scanner animation */}
                <div style={{
                  width: '100%',
                  aspectRatio: '1',
                  background: 'var(--bg-elevated)',
                  borderRadius: 14,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                  marginBottom: 14,
                }}>
                  {/* Corner brackets */}
                  {[
                    { top: 12, left: 12 },
                    { top: 12, right: 12 },
                    { bottom: 12, left: 12 },
                    { bottom: 12, right: 12 },
                  ].map((pos, i) => (
                    <div key={i} style={{
                      position: 'absolute', ...pos,
                      width: 24, height: 24,
                      borderColor: 'var(--jade)',
                      borderStyle: 'solid',
                      borderWidth: `${i < 2 ? '2px' : '0'} ${i % 2 === 1 ? '2px' : '0'} ${i >= 2 ? '2px' : '0'} ${i % 2 === 0 ? '2px' : '0'}`,
                      borderRadius: i === 0 ? '4px 0 0 0' : i === 1 ? '0 4px 0 0' : i === 2 ? '0 0 0 4px' : '0 0 4px 0',
                    }} />
                  ))}

                  {/* Scan line */}
                  <motion.div
                    animate={{ y: [-80, 80] }}
                    transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse', ease: 'linear' }}
                    style={{
                      position: 'absolute',
                      width: '80%', height: 1.5,
                      background: 'linear-gradient(90deg, transparent, var(--jade), transparent)',
                      boxShadow: '0 0 8px var(--jade)',
                    }}
                  />

                  <div style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: 40, marginBottom: 8 }}>📷</p>
                    <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                      Camera access needed
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      Point at any UPI QR code
                    </p>
                  </div>
                </div>

                <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
                  Works at any merchant in India
                </p>
              </div>

              {/* Manual entry */}
              <div style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  OR ENTER UPI ID MANUALLY
                </p>
                <div style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: '0 16px',
                  marginBottom: 10,
                }}>
                  <input
                    type="text"
                    placeholder="merchant@bank"
                    value={manualVPA}
                    onChange={e => setManualVPA(e.target.value)}
                    style={{ width: '100%', height: 50, fontSize: 14 }}
                  />
                </div>
                <div style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 14,
                  padding: '0 16px',
                  marginBottom: 10,
                  display: 'flex', alignItems: 'center',
                }}>
                  <span style={{ color: 'var(--text-muted)', marginRight: 8 }}>₹</span>
                  <input
                    type="number"
                    placeholder="0"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    style={{ flex: 1, height: 50, fontSize: 20, fontWeight: 600 }}
                  />
                </div>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleManualPay}
                  style={{
                    width: '100%', height: 50, borderRadius: 14,
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border)',
                    color: 'var(--text-primary)',
                    fontSize: 14, fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                  }}
                >
                  Pay Manually
                </motion.button>
              </div>

              {/* Demo merchants */}
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                DEMO — TAP TO SIMULATE PAYMENT
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {mockQRs.map((qr, i) => (
                  <motion.button
                    key={i}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleMockQR(qr)}
                    style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center',
                      background: 'var(--bg-surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 14,
                      padding: '12px 16px',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ fontSize: 24 }}>{qr.emoji}</span>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                          {qr.merchant_name}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{qr.merchant_vpa}</p>
                      </div>
                    </div>
                    <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--jade)' }}>
                      {formatCurrency(qr.amount)}
                    </p>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {/* CONFIRM STEP */}
          {step === 'confirm' && txnData && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              style={{ textAlign: 'center' }}
            >
              <div style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 20,
                padding: '32px 24px',
                marginBottom: 20,
              }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 18,
                  background: 'var(--bg-elevated)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, margin: '0 auto 16px',
                }}>
                  🏪
                </div>

                <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  Paying to
                </p>
                <p style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>
                  {txnData.merchant_name}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 24 }}>
                  {txnData.merchant_vpa}
                </p>

                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6 }}>Amount</p>
                <p style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 48, fontWeight: 400,
                  color: 'var(--text-primary)',
                  marginBottom: 8,
                }}>
                  {formatCurrency(txnData.amount)}
                </p>

                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'var(--jade-dim)',
                  border: '1px solid var(--border-jade)',
                  borderRadius: 20,
                  padding: '4px 12px',
                }}>
                  <span style={{ fontSize: 10, color: 'var(--jade)' }}>✓</span>
                  <span style={{ fontSize: 11, color: 'var(--jade)' }}>30-day interest-free</span>
                </div>
              </div>

              <div style={{
                background: 'var(--bg-surface)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: '12px 16px',
                marginBottom: 20,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Paying from</span>
                  <span style={{ fontSize: 13, color: 'var(--jade)' }}>{creditAccount?.upi_vpa}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Remaining credit</span>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    {formatCurrency(available - txnData.amount)}
                  </span>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={handleConfirm}
                style={{
                  width: '100%', height: 56,
                  borderRadius: 16,
                  background: 'linear-gradient(135deg, var(--jade), #00A878)',
                  color: '#000',
                  fontSize: 16, fontWeight: 700,
                  fontFamily: 'var(--font-sans)',
                  marginBottom: 12,
                  boxShadow: '0 8px 24px rgba(0,200,150,0.25)',
                }}
              >
                Proceed to Pay
              </motion.button>

              <button
                onClick={() => setStep('scan')}
                style={{ fontSize: 14, color: 'var(--text-secondary)', padding: '8px' }}
              >
                Cancel
              </button>
            </motion.div>
          )}

          {/* PIN STEP */}
          {step === 'pin' && (
            <motion.div
              key="pin"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ textAlign: 'center', paddingTop: 40 }}
            >
              <div style={{
                width: 72, height: 72, borderRadius: 20,
                background: 'var(--jade-dim)',
                border: '1px solid var(--border-jade)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 32, margin: '0 auto 20px',
              }}>
                🔐
              </div>

              <h2 style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 24, fontWeight: 400,
                marginBottom: 8,
              }}>
                Enter UPI PIN
              </h2>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Authorise {formatCurrency(txnData?.amount)} to {txnData?.merchant_name}
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 40 }}>
                Secured by {creditAccount?.psp_bank} PSP
              </p>

              {loading ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  style={{
                    width: 40, height: 40,
                    border: '2px solid var(--border)',
                    borderTopColor: 'var(--jade)',
                    borderRadius: '50%',
                    margin: '0 auto 24px',
                  }}
                />
              ) : (
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handlePINComplete}
                  style={{
                    width: '100%', height: 56,
                    borderRadius: 16,
                    background: 'linear-gradient(135deg, var(--jade), #00A878)',
                    color: '#000',
                    fontSize: 16, fontWeight: 700,
                    fontFamily: 'var(--font-sans)',
                    boxShadow: '0 8px 24px rgba(0,200,150,0.25)',
                  }}
                >
                  Confirm with PIN
                </motion.button>
              )}
            </motion.div>
          )}

          {/* SUCCESS STEP */}
          {step === 'success' && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              style={{ textAlign: 'center', paddingTop: 40 }}
            >
              {/* Success animation */}
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', delay: 0.1, stiffness: 300, damping: 20 }}
                style={{
                  width: 100, height: 100, borderRadius: '50%',
                  background: 'radial-gradient(circle, rgba(0,200,150,0.2), rgba(0,200,150,0.05))',
                  border: '2px solid var(--jade)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 44, margin: '0 auto 24px',
                  boxShadow: '0 0 40px rgba(0,200,150,0.3)',
                }}
              >
                ✓
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <h2 style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 28, fontWeight: 400,
                  color: 'var(--text-primary)',
                  marginBottom: 8,
                }}>
                  Payment Sent!
                </h2>
                <p style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: 42, color: 'var(--jade)',
                  marginBottom: 8,
                }}>
                  {formatCurrency(txnResult?.amount)}
                </p>
                <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
                  to {txnResult?.merchant}
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                style={{
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 16,
                  padding: '16px',
                  marginBottom: 24,
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Available credit</span>
                  <span style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 600 }}>
                    {formatCurrency(creditAccount?.available_credit)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Interest-free till</span>
                  <span style={{ fontSize: 12, color: 'var(--jade)' }}>
                    {new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN', {
                      day: 'numeric', month: 'short'
                    })}
                  </span>
                </div>
              </motion.div>

              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => { onSuccess?.(); onBack() }}
                style={{
                  width: '100%', height: 56,
                  borderRadius: 16,
                  background: 'linear-gradient(135deg, var(--jade), #00A878)',
                  color: '#000',
                  fontSize: 16, fontWeight: 700,
                  fontFamily: 'var(--font-sans)',
                }}
              >
                Done
              </motion.button>
            </motion.div>
          )}

          {/* FAILED STEP */}
          {step === 'failed' && (
            <motion.div
              key="failed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{ textAlign: 'center', paddingTop: 60 }}
            >
              <div style={{
                width: 80, height: 80, borderRadius: '50%',
                background: 'rgba(239,68,68,0.1)',
                border: '2px solid rgba(239,68,68,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 36, margin: '0 auto 20px',
              }}>
                ✕
              </div>
              <h2 style={{ fontSize: 22, marginBottom: 8 }}>Payment Failed</h2>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 32 }}>
                Your credit limit was not affected
              </p>
              <button
                onClick={() => setStep('scan')}
                style={{
                  width: '100%', height: 52,
                  borderRadius: 14,
                  background: 'var(--bg-elevated)',
                  color: 'var(--text-primary)',
                  fontSize: 15, fontWeight: 600,
                  fontFamily: 'var(--font-sans)',
                }}
              >
                Try Again
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
