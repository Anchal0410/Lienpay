import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { initiatePayment, mockSettle, getCreditStatus } from '../api/client'
import useStore from '../store/useStore'

const formatCurrency = (n) =>
  `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const DEMO_MERCHANTS = [
  { merchant_vpa: 'zomato@icici',   merchant_name: 'Zomato',     amount: 299,  emoji: '🍕' },
  { merchant_vpa: 'swiggy@hdfc',    merchant_name: 'Swiggy',     amount: 180,  emoji: '🛵' },
  { merchant_vpa: 'uber@yesbank',   merchant_name: 'Uber',       amount: 250,  emoji: '🚗' },
  { merchant_vpa: 'amazon@apl',     merchant_name: 'Amazon',     amount: 1299, emoji: '📦' },
  { merchant_vpa: 'netflix@icici',  merchant_name: 'Netflix',    amount: 649,  emoji: '🎬' },
  { merchant_vpa: 'petrol@icici',   merchant_name: 'HP Petrol',  amount: 2000, emoji: '⛽' },
]

export default function Pay({ onBack, onSuccess }) {
  const { creditAccount, setCreditAccount } = useStore()
  const [step, setStep]         = useState('scan')
  const [txnData, setTxnData]   = useState(null)
  const [txnResult, setTxnResult] = useState(null)
  const [loading, setLoading]   = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError]   = useState(null)
  const [manualVPA, setManualVPA]     = useState('')
  const [manualAmount, setManualAmount] = useState('')
  const [confirmAmount, setConfirmAmount] = useState('')

  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef    = useRef(null)
  const available = parseFloat(creditAccount?.available_credit || 0)

  // ── CAMERA ─────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setCameraActive(false)
  }, [])

  const parseUPIQR = (str) => {
    try {
      const url    = new URL(str)
      const params = url.searchParams
      const vpa    = params.get('pa')
      if (vpa) return { merchant_vpa: vpa, merchant_name: params.get('pn') || vpa, amount: parseFloat(params.get('am')) || null }
    } catch (_) {}
    if (str?.includes('@')) return { merchant_vpa: str.trim(), merchant_name: str.trim(), amount: null }
    return null
  }

  const scanFrame = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(scanFrame)
      return
    }
    canvas.width  = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    if (window.jsQR) {
      try {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height)
        if (code?.data) {
          const parsed = parseUPIQR(code.data)
          if (parsed) {
            stopCamera()
            setTxnData(parsed)
            setStep('confirm')
            toast.success('QR detected! ✓')
            return
          }
        }
      } catch (_) {}
    }
    rafRef.current = requestAnimationFrame(scanFrame)
  }, [stopCamera])

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null)
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraActive(true)
        rafRef.current = requestAnimationFrame(scanFrame)
      }
    } catch (err) {
      setCameraError(err.name === 'NotAllowedError'
        ? 'Camera permission denied. Please allow camera access in browser settings.'
        : 'Camera unavailable. Use demo merchants or enter UPI ID manually.'
      )
    }
  }, [scanFrame])

  useEffect(() => {
    if (!window.jsQR) {
      const s = document.createElement('script')
      s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'
      document.head.appendChild(s)
    }
    return stopCamera
  }, [stopCamera])

  const handlePayment = async () => {
    const amount = txnData.amount || parseFloat(confirmAmount)
    if (!amount || amount <= 0) return toast.error('Enter payment amount')
    if (amount > available) return toast.error(`Only ${formatCurrency(available)} available`)
    setLoading(true)
    try {
      const initRes = await initiatePayment({ merchant_vpa: txnData.merchant_vpa, merchant_name: txnData.merchant_name, amount, mcc: '5812' })
      await mockSettle(initRes.data.txn_id)
      const creditRes = await getCreditStatus()
      setCreditAccount(creditRes.data)
      setTxnResult({ amount, merchant: txnData.merchant_name })
      setStep('success')
    } catch (err) {
      toast.error(err.message)
      setStep('failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
        style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <motion.button whileTap={{ scale: 0.88 }} onClick={() => { stopCamera(); onBack() }}
          style={{ width: 40, height: 40, borderRadius: 13, background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
          ←
        </motion.button>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.5px' }}>
            {step === 'scan' ? 'Scan & Pay' : step === 'confirm' ? 'Confirm' : step === 'success' ? 'Sent ✓' : 'Failed'}
          </h2>
          <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 700 }}>{formatCurrency(available)} available</p>
        </div>
      </motion.div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <AnimatePresence mode="wait">

          {/* SCAN */}
          {step === 'scan' && (
            <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '16px 20px 20px' }}>

              {/* Camera viewfinder */}
              <div style={{ position: 'relative', borderRadius: 24, overflow: 'hidden', background: '#0D0D14', aspectRatio: '1', marginBottom: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
                <video ref={videoRef} playsInline muted autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraActive ? 'block' : 'none' }} />

                {!cameraActive && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                    {/* Corner brackets */}
                    {[{top:14,left:14,borderRadius:'8px 0 0 0'},{top:14,right:14,borderRadius:'0 8px 0 0'},{bottom:14,left:14,borderRadius:'0 0 0 8px'},{bottom:14,right:14,borderRadius:'0 0 8px 0'}]
                      .map((s,i) => <div key={i} style={{ position:'absolute', ...s, width:36, height:36, border:'2px solid var(--jade)', opacity:0.6 }} />)}

                    {cameraError ? (
                      <div style={{ textAlign: 'center', padding: '0 24px', zIndex: 1 }}>
                        <p style={{ fontSize: 36, marginBottom: 10 }}>📵</p>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{cameraError}</p>
                      </div>
                    ) : (
                      <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }} onClick={startCamera} style={{ zIndex: 1,
                        padding: '14px 30px', borderRadius: 18, background: 'linear-gradient(135deg, var(--jade), #00A878)',
                        color: '#000', fontSize: 16, fontWeight: 800, fontFamily: 'var(--font-sans)',
                        boxShadow: '0 8px 28px rgba(0,200,150,0.4)' }}>
                        📷 Allow Camera
                      </motion.button>
                    )}
                  </div>
                )}

                {cameraActive && (
                  <>
                    <motion.div animate={{ y: ['-35%', '35%'] }} transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse', ease: 'linear' }}
                      style={{ position: 'absolute', left: '8%', right: '8%', height: 2.5, background: 'linear-gradient(90deg, transparent, var(--jade), transparent)', boxShadow: '0 0 16px var(--jade), 0 0 6px var(--jade)' }} />
                    <motion.button whileTap={{ scale: 0.9 }} onClick={stopCamera}
                      style={{ position: 'absolute', top: 12, right: 12, padding: '6px 14px', borderRadius: 10, background: 'rgba(0,0,0,0.7)', color: '#fff', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-sans)' }}>
                      Stop
                    </motion.button>
                    <p style={{ position: 'absolute', bottom: 14, left: 0, right: 0, textAlign: 'center', fontSize: 12, color: 'rgba(0,200,150,0.8)', fontWeight: 600 }}>
                      Scanning…
                    </p>
                  </>
                )}
              </div>

              {/* Manual UPI */}
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '16px', marginBottom: 16 }}>
                <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 12 }}>MANUAL ENTRY</p>
                <input id="upi-id" name="upi-id" type="text" placeholder="merchant@bank" value={manualVPA} onChange={e => setManualVPA(e.target.value)}
                  style={{ width: '100%', height: 46, fontSize: 14, background: 'var(--bg-elevated)', borderRadius: 10, padding: '0 14px',
                    color: 'var(--text-primary)', border: '1px solid var(--border)', marginBottom: 10, boxSizing: 'border-box', fontFamily: 'var(--font-sans)' }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 4 }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: 16, fontWeight: 600 }}>₹</span>
                    <input id="manual-amount" name="manual-amount" type="number" placeholder="0" value={manualAmount} onChange={e => setManualAmount(e.target.value)}
                      style={{ flex: 1, height: 44, fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }} />
                  </div>
                  <motion.button whileTap={{ scale: 0.93 }}
                    onClick={() => {
                      if (!manualVPA.includes('@')) return toast.error('Invalid UPI ID')
                      if (!manualAmount) return toast.error('Enter amount')
                      setTxnData({ merchant_vpa: manualVPA, merchant_name: manualVPA, amount: parseFloat(manualAmount) })
                      setStep('confirm')
                    }}
                    style={{ padding: '0 20px', borderRadius: 10, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontWeight: 800, fontFamily: 'var(--font-sans)', fontSize: 14 }}>
                    Pay
                  </motion.button>
                </div>
              </div>

              {/* Demo merchants */}
              <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10 }}>QUICK PAY — DEMO</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {DEMO_MERCHANTS.map((m, i) => (
                  <motion.button key={i} whileHover={{ y: -2 }} whileTap={{ scale: 0.94 }}
                    onClick={() => { setTxnData({ merchant_vpa: m.merchant_vpa, merchant_name: m.merchant_name, amount: m.amount }); setStep('confirm') }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 14, padding: '12px 14px', textAlign: 'left' }}>
                    <span style={{ fontSize: 24, flexShrink: 0 }}>{m.emoji}</span>
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.merchant_name}</p>
                      <p style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 800 }}>{formatCurrency(m.amount)}</p>
                    </div>
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {/* CONFIRM */}
          {step === 'confirm' && txnData && (
            <motion.div key="confirm" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ padding: '20px 20px' }}>
              <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 250 }}
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 26, padding: '28px 20px', textAlign: 'center', marginBottom: 14 }}>
                <div style={{ width: 68, height: 68, borderRadius: 20, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, margin: '0 auto 16px' }}>🏪</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Paying to</p>
                <p style={{ fontSize: 22, fontWeight: 800, marginBottom: 3, letterSpacing: '-0.5px' }}>{txnData.merchant_name}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 24 }}>{txnData.merchant_vpa}</p>

                {txnData.amount ? (
                  <p style={{ fontFamily: 'var(--font-serif)', fontSize: 56, color: 'var(--text-primary)', lineHeight: 1, marginBottom: 14 }}>
                    {formatCurrency(txnData.amount)}
                  </p>
                ) : (
                  <div style={{ marginBottom: 14 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, letterSpacing: '1px' }}>ENTER AMOUNT</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                      <span style={{ fontSize: 32, color: 'var(--text-secondary)', fontFamily: 'var(--font-serif)' }}>₹</span>
                      <input id="pay-amount" name="pay-amount" type="number" placeholder="0" autoFocus value={confirmAmount}
                        onChange={e => setConfirmAmount(e.target.value)}
                        style={{ width: 160, textAlign: 'center', fontSize: 48, fontWeight: 900, fontFamily: 'var(--font-serif)', color: 'var(--jade)', background: 'transparent' }} />
                    </div>
                  </div>
                )}

                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--jade-dim)', border: '1px solid var(--border-jade)', borderRadius: 20, padding: '5px 14px' }}>
                  <span style={{ fontSize: 11, color: 'var(--jade)' }}>✓</span>
                  <span style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 700 }}>30-day interest-free · 55% cheaper than credit cards</span>
                </div>
              </motion.div>

              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 16px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Paying from</span>
                  <span style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 700 }}>{creditAccount?.upi_vpa}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Remaining credit</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{formatCurrency(available - (txnData.amount || parseFloat(confirmAmount) || 0))}</span>
                </div>
              </div>

              <motion.button whileTap={{ scale: 0.97 }} onClick={handlePayment} disabled={loading}
                style={{ width: '100%', height: 62, borderRadius: 20, background: 'linear-gradient(135deg, var(--jade), #00A878)',
                  color: '#000', fontSize: 18, fontWeight: 900, fontFamily: 'var(--font-sans)',
                  marginBottom: 10, boxShadow: '0 10px 32px rgba(0,200,150,0.35)', position: 'relative', overflow: 'hidden' }}>
                {loading ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    style={{ width: 24, height: 24, border: '2.5px solid rgba(0,0,0,0.2)', borderTopColor: '#000', borderRadius: '50%', margin: '0 auto' }} />
                ) : 'Pay Now →'}
              </motion.button>
              <button onClick={() => setStep('scan')} style={{ width: '100%', padding: '10px', fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center' }}>Cancel</button>
            </motion.div>
          )}

          {/* SUCCESS */}
          {step === 'success' && (
            <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ position: 'relative', width: 100, height: 100, margin: '0 auto 28px' }}>
                {/* Pulse rings — gentler, no overflow */}
                {[0,1,2].map(i => (
                  <motion.div key={i} initial={{ scale: 1, opacity: 0.4 }} animate={{ scale: 2, opacity: 0 }}
                    transition={{ duration: 2, repeat: Infinity, delay: i * 0.6, ease: 'easeOut' }}
                    style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1px solid var(--jade)', willChange: 'transform, opacity' }} />
                ))}
                {/* Check circle */}
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', borderRadius: '50%',
                    background: 'var(--jade-dim)',
                    border: '2px solid var(--jade)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 0 40px rgba(0,212,161,0.3)', fontSize: 44, color: 'var(--jade)' }}>
                  ✓
                </motion.div>
              </div>

              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
                <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 34, fontWeight: 400, marginBottom: 6 }}>Payment Sent</h2>
                <p style={{ fontFamily: 'var(--font-serif)', fontSize: 52, color: 'var(--jade)', marginBottom: 6, lineHeight: 1 }}>{formatCurrency(txnResult?.amount)}</p>
                <p style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 32 }}>to {txnResult?.merchant}</p>
              </motion.div>

              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '16px', marginBottom: 24, textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Credit remaining</span>
                  <span style={{ fontSize: 14, color: 'var(--jade)', fontWeight: 800 }}>{formatCurrency(creditAccount?.available_credit)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Interest-free till</span>
                  <span style={{ fontSize: 13, color: 'var(--jade)', fontWeight: 600 }}>
                    {new Date(Date.now() + 30*24*60*60*1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}
                  </span>
                </div>
              </motion.div>

              <motion.button whileTap={{ scale: 0.97 }} onClick={() => { onSuccess?.(); onBack() }}
                style={{ width: '100%', height: 60, borderRadius: 20, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 17, fontWeight: 900, fontFamily: 'var(--font-sans)' }}>
                Done
              </motion.button>
            </motion.div>
          )}

          {/* FAILED */}
          {step === 'failed' && (
            <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: '60px 20px 20px' }}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}
                style={{ width: 88, height: 88, borderRadius: '50%', background: 'rgba(239,68,68,0.1)', border: '2px solid rgba(239,68,68,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, margin: '0 auto 20px' }}>✕</motion.div>
              <h2 style={{ fontSize: 26, fontWeight: 800, marginBottom: 8 }}>Payment Failed</h2>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 36 }}>Your credit was not charged</p>
              <button onClick={() => setStep('scan')} style={{ width: '100%', height: 56, borderRadius: 18, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-sans)' }}>Try Again</button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
