import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { initiatePayment, mockSettle, getCreditStatus, getTxnHistory } from '../api/client'
import useStore from '../store/useStore'

const fmt = (n) => `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const categorize = (name) => {
  const n = (name || '').toLowerCase()
  if (n.includes('zomato') || n.includes('swiggy') || n.includes('food') || n.includes('blinkit')) return { cat: 'Food & Dining',    icon: '🍕', color: '#EF8B2C' }
  if (n.includes('uber') || n.includes('ola') || n.includes('rapido') || n.includes('petrol'))  return { cat: 'Transport',         icon: '🚗', color: '#4DA8FF' }
  if (n.includes('amazon') || n.includes('flipkart') || n.includes('myntra'))                    return { cat: 'Shopping',           icon: '🛍️', color: '#8B7BD4' }
  if (n.includes('netflix') || n.includes('spotify') || n.includes('hotstar'))                   return { cat: 'Subscriptions',      icon: '🎬', color: '#E05252' }
  if (n.includes('pharma') || n.includes('medic') || n.includes('apollo'))                      return { cat: 'Health',             icon: '💊', color: '#00D4A1' }
  if (n.includes('rent') || n.includes('utility') || n.includes('electric'))                    return { cat: 'Bills & Utilities',  icon: '🏠', color: '#06B6D4' }
  return { cat: 'Other', icon: '💳', color: '#7A8F85' }
}

// ─────────────────────────────────────────────────────────────
// PAYMENT PROCESSING ANIMATION (motion graphic)
// ─────────────────────────────────────────────────────────────
function ProcessingOverlay({ merchant, amount }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ position: 'absolute', inset: 0, background: 'var(--bg-void)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
    >
      {/* Pulsing rings */}
      {[1, 2, 3].map(i => (
        <motion.div key={i}
          animate={{ scale: [1, 2.5 + i * 0.4], opacity: [0.5, 0] }}
          transition={{ duration: 1.8, repeat: Infinity, delay: i * 0.35, ease: 'easeOut' }}
          style={{
            position: 'absolute',
            width: 80, height: 80, borderRadius: '50%',
            border: `2px solid rgba(0,212,161,${0.4 - i * 0.1})`,
          }}
        />
      ))}

      {/* Center icon */}
      <motion.div
        animate={{ scale: [0.95, 1.05, 0.95] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          width: 80, height: 80, borderRadius: 24,
          background: 'linear-gradient(135deg, var(--jade-dim), rgba(0,212,161,0.15))',
          border: '2px solid var(--jade)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, position: 'relative', zIndex: 1,
          boxShadow: '0 0 40px rgba(0,212,161,0.3)',
        }}
      >
        💳
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        style={{ marginTop: 32, textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, marginBottom: 6, color: 'var(--text-primary)' }}>Processing…</p>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>{fmt(amount)} to {merchant}</p>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Authorising via CLOU · Routed via NBFC</p>
      </motion.div>

      {/* Progress bar */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        style={{ marginTop: 40, width: 160, height: 2, background: 'rgba(0,212,161,0.15)', borderRadius: 2, overflow: 'hidden' }}>
        <motion.div
          animate={{ x: ['-100%', '100%'] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ width: '60%', height: '100%', background: 'linear-gradient(90deg, transparent, var(--jade), transparent)' }}
        />
      </motion.div>

      {/* Steps */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}
        style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {['Pre-authorise with NBFC', 'Route via CLOU UPI', 'Settle with merchant'].map((step, i) => (
          <motion.div key={i}
            initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.8 + i * 0.2 }}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <motion.div
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.4 }}
              style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--jade)', flexShrink: 0 }}
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{step}</p>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  )
}

export default function Pay({ onBack, onSuccess }) {
  const { creditAccount, setCreditAccount } = useStore()
  const [step, setStep]             = useState('scan')
  const [txnData, setTxnData]       = useState(null)
  const [txnResult, setTxnResult]   = useState(null)
  const [loading, setLoading]       = useState(false)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraError, setCameraError]   = useState(null)
  const [confirmAmount, setConfirmAmount] = useState('')
  const [spendingData, setSpendingData]   = useState(null)
  const videoRef  = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const rafRef    = useRef(null)

  const available = parseFloat(creditAccount?.available_credit || 0)

  // Fetch fresh credit + spending on mount
  useEffect(() => {
    const init = async () => {
      try { const r = await getCreditStatus(); setCreditAccount(r.data) } catch(e) {}
      try {
        const r    = await getTxnHistory({ limit: 50 })
        const txns = (r.data?.transactions || []).filter(t => t.status === 'SETTLED')
        const byCategory = {}
        let total = 0
        txns.forEach(t => {
          const { cat, icon, color } = categorize(t.merchant_name)
          if (!byCategory[cat]) byCategory[cat] = { cat, icon, color, amount: 0, count: 0 }
          byCategory[cat].amount += parseFloat(t.amount || 0)
          byCategory[cat].count++
          total += parseFloat(t.amount || 0)
        })
        const sorted = Object.values(byCategory).sort((a, b) => b.amount - a.amount)
        const latest = txns.slice(0, 3)
        // Free period check
        const freePeriodTxns = txns.filter(t => t.is_in_free_period).length
        setSpendingData({ categories: sorted, total, count: txns.length, freePeriodCount: freePeriodTxns, latest })
      } catch(e) {}
    }
    init()
  }, [])

  // ── CAMERA ──────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setCameraActive(false)
  }, [])

  const parseUPIQR = (str) => {
    try {
      const url = new URL(str)
      const pa  = url.searchParams.get('pa')
      if (pa) return { merchant_vpa: pa, merchant_name: url.searchParams.get('pn') || pa, amount: parseFloat(url.searchParams.get('am')) || null }
    } catch (_) {}
    if (str?.includes('@')) return { merchant_vpa: str.trim(), merchant_name: str.trim(), amount: null }
    return null
  }

  const scanFrame = useCallback(() => {
    const video = videoRef.current; const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(scanFrame); return }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0)
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
    if (window.jsQR) {
      try {
        const code = window.jsQR(imageData.data, imageData.width, imageData.height)
        if (code?.data) {
          const parsed = parseUPIQR(code.data)
          if (parsed) { stopCamera(); setTxnData(parsed); setStep('confirm'); toast.success('QR detected! ✓'); return }
        }
      } catch (_) {}
    }
    rafRef.current = requestAnimationFrame(scanFrame)
  }, [stopCamera])

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); setCameraActive(true); rafRef.current = requestAnimationFrame(scanFrame) }
    } catch (err) {
      setCameraError(err.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Camera unavailable. Enter UPI ID manually.')
    }
  }, [scanFrame])

  useEffect(() => {
    if (!window.jsQR) { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'; document.head.appendChild(s) }
    return stopCamera
  }, [stopCamera])

  // ── PAYMENT ─────────────────────────────────────────────────
  const handlePayment = async () => {
    const amount = txnData.amount || parseFloat(confirmAmount)
    if (!amount || amount <= 0) return toast.error('Enter payment amount')
    if (amount > available) return toast.error(`Only ${fmt(available)} available`)
    setLoading(true)
    setStep('processing')
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

  const QUICK_AMOUNTS = [100, 250, 500, 1000]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Header */}
      {step !== 'processing' && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <motion.button whileTap={{ scale: 0.88 }} onClick={() => { stopCamera(); onBack() }}
            style={{ width: 40, height: 40, borderRadius: 13, background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>←</motion.button>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.5px' }}>
              {step === 'scan' ? 'Scan & Pay' : step === 'confirm' ? 'Confirm Payment' : step === 'success' ? 'Sent ✓' : 'Failed'}
            </h2>
            {/* ── FIX: just show available, no amount mentioned ── */}
            <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 700 }}>
              {available > 0 ? `${fmt(available)} available` : 'No credit available'}
            </p>
          </div>
        </motion.div>
      )}

      <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
        <AnimatePresence mode="wait">

          {/* ── SCAN ── */}
          {step === 'scan' && (
            <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '16px 20px 20px' }}>

              {/* Camera */}
              <div style={{ position: 'relative', borderRadius: 24, overflow: 'hidden', background: '#0D0D14', aspectRatio: '1', marginBottom: 20, boxShadow: '0 8px 32px rgba(0,0,0,0.4)' }}>
                <video ref={videoRef} playsInline muted autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraActive ? 'block' : 'none' }} />
                {!cameraActive && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                    {[{top:14,left:14,borderRadius:'8px 0 0 0'},{top:14,right:14,borderRadius:'0 8px 0 0'},{bottom:14,left:14,borderRadius:'0 0 0 8px'},{bottom:14,right:14,borderRadius:'0 0 8px 0'}]
                      .map((s,i) => <div key={i} style={{ position:'absolute', ...s, width:36, height:36, border:'2px solid var(--jade)', opacity:0.6 }} />)}
                    {cameraError ? (
                      <div style={{ textAlign:'center', padding:'0 20px' }}>
                        <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:14 }}>{cameraError}</p>
                        <motion.button whileTap={{ scale:0.96 }} onClick={startCamera}
                          style={{ padding:'10px 24px', borderRadius:12, background:'var(--jade)', color:'#000', fontSize:13, fontWeight:700 }}>Try Again</motion.button>
                      </div>
                    ) : (
                      <>
                        <p style={{ fontSize:24 }}>📷</p>
                        <p style={{ fontSize:13, color:'var(--text-muted)', textAlign:'center', padding:'0 24px' }}>Point at any UPI QR code</p>
                        <motion.button whileTap={{ scale:0.96 }} onClick={startCamera}
                          style={{ padding:'11px 28px', borderRadius:14, background:'var(--jade)', color:'#000', fontSize:13, fontWeight:700 }}>Start Camera</motion.button>
                      </>
                    )}
                  </div>
                )}
                {cameraActive && (
                  <>
                    <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:200, height:200 }}>
                      {[{top:0,left:0,borderRadius:'8px 0 0 0'},{top:0,right:0,borderRadius:'0 8px 0 0'},{bottom:0,left:0,borderRadius:'0 0 0 8px'},{bottom:0,right:0,borderRadius:'0 0 8px 0'}]
                        .map((s,i) => <div key={i} style={{ position:'absolute', ...s, width:32, height:32, border:'2.5px solid var(--jade)', opacity:0.9 }} />)}
                    </div>
                    <div style={{ position:'absolute', bottom:16, left:0, right:0, textAlign:'center' }}>
                      <span style={{ fontSize:11, color:'var(--jade)', fontFamily:'var(--font-mono)', background:'rgba(0,0,0,0.6)', padding:'4px 12px', borderRadius:8 }}>Scanning…</span>
                    </div>
                  </>
                )}
              </div>

              {/* Manual UPI entry */}
              <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>OR ENTER UPI ID MANUALLY</p>
              <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
                <input id="upi-manual" placeholder="merchant@upi"
                  style={{ flex: 1, height: 46, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '0 14px', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', outline: 'none' }}
                  onKeyDown={e => { if (e.key === 'Enter' && e.target.value.includes('@')) { setTxnData({ merchant_vpa: e.target.value.trim(), merchant_name: e.target.value.trim(), amount: null }); setStep('confirm') } }}
                />
                <motion.button whileTap={{ scale: 0.96 }}
                  onClick={() => { const v = document.getElementById('upi-manual')?.value; if (v?.includes('@')) { setTxnData({ merchant_vpa: v.trim(), merchant_name: v.trim(), amount: null }); setStep('confirm') } else toast.error('Enter valid UPI ID') }}
                  style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--jade)', color: '#000', fontSize: 18, fontWeight: 700, flexShrink: 0, border: 'none', cursor: 'pointer' }}>→</motion.button>
              </div>

              {/* ── Spending analytics instead of demo merchants ── */}
              {spendingData && spendingData.count > 0 ? (
                <>
                  <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>YOUR SPENDING BREAKDOWN</p>
                  <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '16px', marginBottom: 16 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Total spent</p>
                        <p style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--text-primary)' }}>{fmt(spendingData.total)}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{spendingData.count} transactions</p>
                        {spendingData.freePeriodCount > 0 && (
                          <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 600 }}>{spendingData.freePeriodCount} interest-free</p>
                        )}
                      </div>
                    </div>

                    {/* Category bars */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {spendingData.categories.slice(0, 5).map((cat, i) => {
                        const pct = spendingData.total > 0 ? (cat.amount / spendingData.total) * 100 : 0
                        return (
                          <div key={i}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 14 }}>{cat.icon}</span>
                                <span style={{ fontSize: 12, fontWeight: 600 }}>{cat.cat}</span>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{cat.count} txns</span>
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmt(cat.amount)}</span>
                            </div>
                            <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                              <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, delay: i * 0.1, ease: 'easeOut' }}
                                style={{ height: '100%', background: cat.color, borderRadius: 2 }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '24px', textAlign: 'center' }}>
                  <p style={{ fontSize: 28, marginBottom: 8 }}>📊</p>
                  <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>No spending yet</p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Your spending analytics will appear here after your first payment</p>
                </div>
              )}
            </motion.div>
          )}

          {/* ── CONFIRM ── */}
          {step === 'confirm' && txnData && (
            <motion.div key="confirm" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} style={{ padding: '20px' }}>
              <motion.div initial={{ scale: 0.92 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 250 }}
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 26, padding: '28px 20px', textAlign: 'center', marginBottom: 14 }}>
                <div style={{ width: 68, height: 68, borderRadius: 20, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, margin: '0 auto 16px' }}>🏪</div>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 4 }}>Paying to</p>
                <p style={{ fontSize: 22, fontWeight: 800, marginBottom: 3 }}>{txnData.merchant_name}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 24 }}>{txnData.merchant_vpa}</p>

                {txnData.amount ? (
                  <div style={{ background: 'var(--bg-elevated)', borderRadius: 16, padding: '16px 20px', marginBottom: 16 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>AMOUNT</p>
                    <p style={{ fontFamily: 'var(--font-display)', fontSize: 40, color: 'var(--jade)' }}>{fmt(txnData.amount)}</p>
                  </div>
                ) : (
                  <div style={{ marginBottom: 16 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>ENTER AMOUNT</p>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12 }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 22, color: 'var(--text-secondary)' }}>₹</span>
                      <input type="number" inputMode="numeric" placeholder="0" value={confirmAmount} onChange={e => setConfirmAmount(e.target.value)}
                        style={{ fontSize: 40, fontFamily: 'var(--font-display)', color: 'var(--jade)', width: 160, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none' }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                      {QUICK_AMOUNTS.map(a => (
                        <motion.button key={a} whileTap={{ scale: 0.9 }} onClick={() => setConfirmAmount(String(a))}
                          style={{ padding: '5px 12px', borderRadius: 8, background: confirmAmount === String(a) ? 'var(--jade)' : 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--font-mono)', color: confirmAmount === String(a) ? '#000' : 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}>
                          ₹{a}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                )}

                <div style={{ background: 'rgba(0,212,161,0.06)', borderRadius: 10, padding: '8px 14px' }}>
                  <p style={{ fontSize: 10, color: 'var(--jade)', fontFamily: 'var(--font-mono)' }}>✓ 30-day interest-free · 55% cheaper than credit cards</p>
                </div>
              </motion.div>

              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '14px 18px', marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Paying from</span>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>LienPay Credit</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Remaining credit</span>
                  <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: available - (txnData.amount || parseFloat(confirmAmount) || 0) >= 0 ? 'var(--jade)' : 'var(--red)' }}>
                    {fmt(available - (txnData.amount || parseFloat(confirmAmount) || 0))}
                  </span>
                </div>
              </div>

              {available <= 0 && (
                <div style={{ background: 'var(--red-dim)', border: '1px solid rgba(224,82,82,0.3)', borderRadius: 12, padding: '10px 14px', marginBottom: 12, textAlign: 'center' }}>
                  <p style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>Insufficient credit. Repay your balance to continue.</p>
                </div>
              )}

              <motion.button whileTap={{ scale: 0.97 }} onClick={handlePayment} disabled={loading || available <= 0}
                style={{ width: '100%', height: 54, borderRadius: 16, background: available > 0 ? 'linear-gradient(135deg, var(--jade), #00A878)' : 'var(--bg-elevated)', color: available > 0 ? '#000' : 'var(--text-muted)', fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-sans)', marginBottom: 10, border: 'none', cursor: available > 0 ? 'pointer' : 'not-allowed' }}>
                Pay Now →
              </motion.button>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => { setTxnData(null); setStep('scan') }}
                style={{ width: '100%', height: 44, borderRadius: 14, background: 'transparent', color: 'var(--text-muted)', fontSize: 13, fontFamily: 'var(--font-sans)', border: 'none', cursor: 'pointer' }}>
                Cancel
              </motion.button>
            </motion.div>
          )}

          {/* ── PROCESSING — motion graphic ── */}
          {step === 'processing' && txnData && (
            <ProcessingOverlay merchant={txnData.merchant_name} amount={txnData.amount || parseFloat(confirmAmount) || 0} />
          )}

          {/* ── SUCCESS ── */}
          {step === 'success' && txnResult && (
            <motion.div key="success" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} style={{ padding: '40px 20px', textAlign: 'center' }}>
              <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, delay: 0.1 }}
                style={{ width: 80, height: 80, borderRadius: 24, background: 'var(--jade-dim)', border: '2px solid var(--jade)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 20px' }}>✓</motion.div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 32, marginBottom: 6 }}>Payment Sent</h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>to {txnResult.merchant}</p>
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '20px', marginBottom: 24 }}>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 42, color: 'var(--jade)' }}>{fmt(txnResult.amount)}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>30-day interest-free period started</p>
              </div>
              <motion.button whileTap={{ scale: 0.97 }} onClick={onSuccess}
                style={{ width: '100%', height: 52, borderRadius: 16, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-sans)', border: 'none', cursor: 'pointer' }}>
                Done
              </motion.button>
            </motion.div>
          )}

          {/* ── FAILED ── */}
          {step === 'failed' && (
            <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ width: 72, height: 72, borderRadius: 20, background: 'var(--red-dim)', border: '1px solid rgba(224,82,82,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 20px' }}>✕</div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, marginBottom: 6 }}>Payment Failed</h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>Something went wrong. Try again.</p>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep('scan')}
                style={{ width: '100%', height: 52, borderRadius: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-sans)', cursor: 'pointer' }}>
                Try Again
              </motion.button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  )
}
