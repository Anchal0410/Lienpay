import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { initiatePayment, mockSettle, getCreditStatus, getTxnHistory } from '../api/client'
import useStore from '../store/useStore'
import { TICKER_HEIGHT } from '../App'

const fmt = (n) => `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const fmtL = (n) => { const v = parseFloat(n || 0); return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : fmt(v) }

const categorize = (name) => {
  const n = (name || '').toLowerCase()
  if (n.includes('zomato') || n.includes('swiggy') || n.includes('food') || n.includes('blinkit')) return { cat: 'Food & Dining', icon: '🍕', color: '#EF8B2C' }
  if (n.includes('uber') || n.includes('ola') || n.includes('rapido'))                              return { cat: 'Transport', icon: '🚗', color: '#4DA8FF' }
  if (n.includes('amazon') || n.includes('flipkart') || n.includes('myntra'))                       return { cat: 'Shopping', icon: '🛍️', color: '#8B7BD4' }
  if (n.includes('netflix') || n.includes('spotify') || n.includes('hotstar'))                      return { cat: 'Subscriptions', icon: '🎬', color: '#E05252' }
  return { cat: 'Other', icon: '💳', color: '#7A8F85' }
}

// ─────────────────────────────────────────────────────────────
// CITYSCAPE — persistent, never re-mounts
// ─────────────────────────────────────────────────────────────
function Cityscape({ merchant, amount }) {
  const buildings = [
    { x: 2,   w: 36, h: 145, windows: [[7,16],[19,16],[7,30],[19,30],[7,44],[19,44],[7,58],[19,58],[7,72],[19,72]] },
    { x: 44,  w: 28, h: 108, windows: [[7,14],[17,14],[7,26],[17,26],[7,38],[17,38],[7,50],[17,50]] },
    { x: 78,  w: 40, h: 172, windows: [[7,16],[19,16],[31,16],[7,30],[19,30],[31,30],[7,44],[19,44],[31,44],[7,58],[19,58],[31,58],[7,72],[19,72]] },
    { x: 124, w: 34, h: 128, windows: [[7,15],[19,15],[7,28],[19,28],[7,41],[19,41],[7,54],[19,54],[7,67],[19,67]] },
    { x: 164, w: 26, h: 92,  windows: [[6,13],[15,13],[6,24],[15,24],[6,35],[15,35],[6,46],[15,46]] },
    { x: 268, w: 30, h: 118, windows: [[7,14],[17,14],[7,26],[17,26],[7,38],[17,38],[7,50],[17,50],[7,62],[17,62]] },
    { x: 304, w: 42, h: 156, windows: [[7,16],[19,16],[31,16],[7,30],[19,30],[31,30],[7,44],[19,44],[31,44],[7,58],[19,58],[31,58],[7,72],[19,72]] },
    { x: 352, w: 28, h: 106, windows: [[6,13],[16,13],[6,25],[16,25],[6,37],[16,37],[6,49],[16,49],[6,61],[16,61]] },
    { x: 386, w: 36, h: 140, windows: [[7,15],[19,15],[7,28],[19,28],[7,41],[19,41],[7,54],[19,54],[7,67],[19,67],[7,80],[19,80]] },
    { x: 428, w: 26, h: 88,  windows: [[6,12],[16,12],[6,23],[16,23],[6,34],[16,34],[6,45],[16,45]] },
    { x: 460, w: 38, h: 132, windows: [[7,14],[19,14],[29,14],[7,27],[19,27],[29,27],[7,40],[19,40],[29,40],[7,53],[19,53],[29,53]] },
  ]
  const stars = Array.from({ length: 38 }, (_, i) => ({
    x: (i * 83 + 31) % 500, y: (i * 47 + 11) % 180, r: i % 4 === 0 ? 1.2 : 0.7, delay: (i * 0.22) % 5,
  }))
  const groundY = 225, svgH = 270, cx = 240

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#040c08', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Amount + merchant — smooth fade in */}
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.4, ease: 'easeOut', delay: 0.2 }}
        style={{ textAlign: 'center', paddingTop: 28, paddingBottom: 6, zIndex: 10, flexShrink: 0 }}>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 0.7 }} transition={{ delay: 0.5, duration: 1.2 }}
          style={{ fontSize: 9, color: 'var(--jade)', fontFamily: 'var(--font-mono)', letterSpacing: '4px', fontWeight: 600, marginBottom: 8 }}>LIENPAY</motion.p>
        <motion.p initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6, duration: 1.1, ease: [0.16,1,0.3,1] }}
          style={{ fontFamily: 'var(--font-display)', fontSize: 46, fontWeight: 400, color: '#ffffff', letterSpacing: '-1px', marginBottom: 4 }}>{fmt(amount)}</motion.p>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 0.45 }} transition={{ delay: 1.0, duration: 1 }}
          style={{ fontSize: 13, color: '#8fa99a' }}>to {merchant}</motion.p>
      </motion.div>

      {/* SVG cityscape */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <svg viewBox={`0 0 500 ${svgH}`} preserveAspectRatio="xMidYMax meet"
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, width: '100%', height: '100%' }}>
          <defs>
            <linearGradient id="sky9" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#030a06"/><stop offset="100%" stopColor="#050f09"/>
            </linearGradient>
            <linearGradient id="bld9" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0d1e16"/><stop offset="100%" stopColor="#081209"/>
            </linearGradient>
            <linearGradient id="ctr9" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f2e1c"/><stop offset="100%" stopColor="#071508"/>
            </linearGradient>
            <radialGradient id="glow9" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0,212,161,0.11)"/><stop offset="100%" stopColor="transparent"/>
            </radialGradient>
          </defs>

          <rect width="500" height={svgH} fill="url(#sky9)"/>

          {/* Stars — very gentle twinkle */}
          {stars.map((s, i) => (
            <motion.circle key={i} cx={s.x} cy={s.y} r={s.r} fill="white"
              animate={{ opacity: [0.1, 0.45, 0.1] }}
              transition={{ duration: 4 + (i % 4), repeat: Infinity, delay: s.delay, ease: 'easeInOut' }} />
          ))}

          {/* Regular buildings — rise sequentially with easing */}
          {buildings.map((b, i) => (
            <motion.g key={i} initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.6, delay: 0.15 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}>
              <rect x={b.x} y={groundY - b.h} width={b.w} height={b.h} fill="url(#bld9)"/>
              {b.windows.map((w, j) => (
                <motion.rect key={j} x={b.x + w[0]} y={groundY - b.h + w[1]} width={5} height={4}
                  fill={j % 4 === 0 ? 'rgba(255,185,60,0.5)' : j % 7 === 0 ? 'rgba(255,215,80,0.3)' : 'rgba(255,255,255,0.04)'}
                  rx={0.3}
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ delay: 0.7 + i * 0.08 + j * 0.018, duration: 0.7 }} />
              ))}
            </motion.g>
          ))}

          {/* Central LienPay building — rises last */}
          <motion.g initial={{ opacity: 0, y: 55 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 2.0, delay: 1.0, ease: [0.16, 1, 0.3, 1] }}>
            <ellipse cx={cx} cy={groundY - 120} rx={58} ry={72} fill="url(#glow9)"/>
            <rect x={204} y={groundY - 230} width={72} height={230} fill="url(#ctr9)" rx={0.5}/>
            {[0,1,2,3,4,5,6].map(row => [0,1,2,3].map(col => (
              <motion.rect key={`${row}-${col}`} x={208 + col * 16} y={groundY - 220 + row * 28} width={9} height={7}
                fill={row % 2 === 0 && col % 2 === 0 ? 'rgba(0,212,161,0.18)' : 'rgba(255,255,255,0.025)'} rx={1}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                transition={{ delay: 1.4 + row * 0.07 + col * 0.04, duration: 0.9 }} />
            )))}
            <motion.text x={cx} y={groundY - 55} textAnchor="middle" fill="#00D4A1" fontSize="26" fontFamily="Georgia, serif" fontWeight="300"
              initial={{ opacity: 0 }} animate={{ opacity: 0.85 }} transition={{ delay: 2.0, duration: 1.4 }}>L</motion.text>
            <motion.circle cx={cx} cy={groundY - 65} r={20} fill="rgba(0,212,161,0.06)"
              animate={{ r: [17, 23, 17] }} transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut', delay: 2.5 }} />
          </motion.g>

          {/* Orbital ring — draws in slowly */}
          <motion.circle cx={cx} cy={groundY - 165} r={68} fill="none" stroke="rgba(0,212,161,0.13)" strokeWidth="0.7"
            initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
            transition={{ delay: 2.2, duration: 2.4, ease: 'easeInOut' }} />

          {/* Orbiting dot — slow, peaceful revolution (10s/orbit) */}
          <motion.g animate={{ rotate: [0, 360] }} transition={{ duration: 10, repeat: Infinity, ease: 'linear', delay: 3.0 }}
            style={{ transformOrigin: `${cx}px ${groundY - 165}px` }}>
            <motion.circle cx={cx} cy={groundY - 165 - 68} r={5} fill="#00D4A1"
              animate={{ r: [4, 6.5, 4] }} transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}/>
            <circle cx={cx} cy={groundY - 165 - 68} r={11} fill="rgba(0,212,161,0.1)"/>
          </motion.g>

          {/* Inner orbit — counter-rotation (very slow) */}
          <motion.g animate={{ rotate: [360, 0] }} transition={{ duration: 16, repeat: Infinity, ease: 'linear', delay: 3.5 }}
            style={{ transformOrigin: `${cx}px ${groundY - 165}px` }}>
            <motion.circle cx={cx} cy={groundY - 165 - 44} r={3} fill="rgba(0,212,161,0.45)"
              animate={{ opacity: [0.3, 0.7, 0.3] }} transition={{ duration: 3, repeat: Infinity }} />
          </motion.g>

          {/* Antenna dots */}
          {[0,2,3,6,7,8].map((bldIdx, i) => {
            const b = buildings[bldIdx]
            return (
              <motion.circle key={i} cx={b.x + b.w / 2} cy={groundY - b.h - 5} r={2.5}
                fill={i % 3 === 0 ? '#00D4A1' : '#EF4444'}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.85, 0.2, 0.85, 0] }}
                transition={{ duration: 3.5, repeat: Infinity, delay: 1.2 + i * 0.45, ease: 'easeInOut' }} />
            )
          })}

          {/* Ground */}
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 1.5 }}>
            <rect x={0} y={groundY} width={500} height={svgH - groundY} fill="#040b07"/>
            <line x1={0} y1={groundY} x2={500} y2={groundY} stroke="rgba(0,212,161,0.1)" strokeWidth="0.5"/>
          </motion.g>
        </svg>
      </div>

      {/* Status text at bottom */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8, duration: 1.2 }}
        style={{ textAlign: 'center', paddingBottom: 14, flexShrink: 0, zIndex: 10 }}>
        <motion.p animate={{ opacity: [0.3, 0.65, 0.3] }} transition={{ duration: 3.5, repeat: Infinity, ease: 'easeInOut' }}
          style={{ fontSize: 9, color: 'rgba(0,212,161,0.55)', fontFamily: 'var(--font-mono)', letterSpacing: '2.5px' }}>
          PROCESSING PAYMENT
        </motion.p>
      </motion.div>

      {/* Progress bar — smooth 4.5s fill */}
      <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 4.5, ease: [0.4, 0, 0.15, 1] }}
        style={{ height: 2, background: 'linear-gradient(90deg, var(--jade), rgba(0,212,161,0.5))', position: 'absolute', bottom: 0, left: 0, right: 0, transformOrigin: 'left center', zIndex: 20 }} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PAY SCREEN
// ─────────────────────────────────────────────────────────────
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

  // Track active merchant/amount for the persistent cityscape
  const activeMerchant = txnData?.merchant_name || txnResult?.merchant || ''
  const activeAmount   = txnData?.amount || parseFloat(confirmAmount) || txnResult?.amount || 0

  useEffect(() => {
    const init = async () => {
      try { const r = await getCreditStatus(); setCreditAccount(r.data) } catch(e) {}
      try {
        const r = await getTxnHistory({ limit: 50 })
        const txns = (r.data?.transactions || []).filter(t => t.status === 'SETTLED')
        const byCategory = {}; let total = 0
        txns.forEach(t => {
          const { cat, icon, color } = categorize(t.merchant_name)
          if (!byCategory[cat]) byCategory[cat] = { cat, icon, color, amount: 0, count: 0 }
          byCategory[cat].amount += parseFloat(t.amount || 0); byCategory[cat].count++; total += parseFloat(t.amount || 0)
        })
        setSpendingData({ categories: Object.values(byCategory).sort((a,b) => b.amount - a.amount), total, count: txns.length })
      } catch(e) {}
    }
    init()
  }, [])

  const stopCamera = useCallback(() => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setCameraActive(false)
  }, [])

  const parseUPIQR = (str) => {
    try { const url = new URL(str); const pa = url.searchParams.get('pa'); if (pa) return { merchant_vpa: pa, merchant_name: url.searchParams.get('pn') || pa, amount: parseFloat(url.searchParams.get('am')) || null } } catch(_) {}
    if (str?.includes('@')) return { merchant_vpa: str.trim(), merchant_name: str.trim(), amount: null }
    return null
  }

  const scanFrame = useCallback(() => {
    const video = videoRef.current, canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(scanFrame); return }
    canvas.width = video.videoWidth; canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d'); ctx.drawImage(video, 0, 0)
    if (window.jsQR) {
      try { const code = window.jsQR(ctx.getImageData(0,0,canvas.width,canvas.height).data, canvas.width, canvas.height); if (code?.data) { const p = parseUPIQR(code.data); if (p) { stopCamera(); setTxnData(p); setStep('confirm'); toast.success('QR detected! ✓'); return } } } catch(_) {}
    }
    rafRef.current = requestAnimationFrame(scanFrame)
  }, [stopCamera])

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null)
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); setCameraActive(true); rafRef.current = requestAnimationFrame(scanFrame) }
    } catch(err) { setCameraError(err.name === 'NotAllowedError' ? 'Camera permission denied.' : 'Camera unavailable. Enter UPI ID manually.') }
  }, [scanFrame])

  useEffect(() => {
    if (!window.jsQR) { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'; document.head.appendChild(s) }
    return stopCamera
  }, [stopCamera])

  const handlePayment = async () => {
    const amount = txnData.amount || parseFloat(confirmAmount)
    if (!amount || amount <= 0) return toast.error('Enter payment amount')
    if (amount > available) return toast.error(`Only ${fmt(available)} available`)
    setLoading(true)
    setStep('processing')  // cityscape mounts ONCE here
    try {
      const initRes = await initiatePayment({ merchant_vpa: txnData.merchant_vpa, merchant_name: txnData.merchant_name, amount, mcc: '5812' })
      await mockSettle(initRes.data.txn_id)
      const creditRes = await getCreditStatus(); setCreditAccount(creditRes.data)
      setTxnResult({ amount, merchant: txnData.merchant_name })
      setStep('success')  // cityscape STAYS mounted, success card fades in on top
    } catch(err) { toast.error(err.message); setStep('failed') }
    finally { setLoading(false) }
  }

  const QUICK = [100, 250, 500, 1000]

  const isFullscreen = step === 'processing' || step === 'success'

  return (
    <div style={{ position: 'fixed', inset: 0, paddingTop: TICKER_HEIGHT, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Header — only on scan/confirm/failed */}
      {!isFullscreen && (
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <motion.button whileTap={{ scale: 0.88 }} onClick={() => { stopCamera(); onBack() }}
            style={{ width: 40, height: 40, borderRadius: 13, background: 'var(--bg-surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, cursor: 'pointer' }}>←</motion.button>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 18, fontWeight: 800 }}>{step === 'scan' ? 'Scan & Pay' : step === 'confirm' ? 'Confirm Payment' : 'Failed'}</h2>
            <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 700 }}>{available > 0 ? `${fmt(available)} available` : 'No credit available'}</p>
          </div>
        </motion.div>
      )}

      {/* ── Main content area ── */}
      <div style={{ flex: 1, overflow: isFullscreen ? 'hidden' : 'auto', position: 'relative' }}>

        {/* ── CITYSCAPE — persistent through processing AND success ── */}
        {isFullscreen && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
            <Cityscape merchant={activeMerchant} amount={activeAmount} />
          </div>
        )}

        {/* ── SUCCESS CARD — fades in smoothly on top of cityscape ── */}
        {step === 'success' && (
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.4, duration: 1.0, ease: [0.16, 1, 0.3, 1] }}
            style={{ position: 'absolute', bottom: 36, left: 20, right: 20, zIndex: 10,
              background: 'rgba(4,12,8,0.92)', border: '1px solid rgba(0,212,161,0.22)',
              borderRadius: 24, padding: '24px 20px', textAlign: 'center', backdropFilter: 'blur(20px)' }}>
            <motion.div
              initial={{ scale: 0, rotate: -10 }} animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.7, type: 'spring', stiffness: 180, damping: 16 }}
              style={{ width: 52, height: 52, borderRadius: 18, background: 'rgba(0,212,161,0.12)', border: '1px solid rgba(0,212,161,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <motion.path d="M20 6L9 17L4 12" stroke="var(--jade)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 1.0, duration: 0.6, ease: 'easeOut' }}/>
              </svg>
            </motion.div>
            <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9, duration: 0.7 }}
              style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginBottom: 4, color: '#fff' }}>Payment Sent</motion.p>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 0.45 }} transition={{ delay: 1.1, duration: 0.7 }}
              style={{ fontSize: 12, color: '#ccc', marginBottom: 22 }}>30-day interest-free period started</motion.p>
            <motion.button whileTap={{ scale: 0.97 }} onClick={onSuccess}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3, duration: 0.7 }}
              style={{ width: '100%', height: 50, borderRadius: 16, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-sans)', border: 'none', cursor: 'pointer' }}>Done</motion.button>
          </motion.div>
        )}

        {/* ── SCAN ── */}
        {step === 'scan' && (
          <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '16px 20px 20px' }}>
            <div style={{ position: 'relative', borderRadius: 24, overflow: 'hidden', background: '#0D0D14', aspectRatio: '1', marginBottom: 20 }}>
              <video ref={videoRef} playsInline muted autoPlay style={{ width: '100%', height: '100%', objectFit: 'cover', display: cameraActive ? 'block' : 'none' }} />
              {!cameraActive && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                  {[{top:14,left:14,borderRadius:'8px 0 0 0'},{top:14,right:14,borderRadius:'0 8px 0 0'},{bottom:14,left:14,borderRadius:'0 0 0 8px'},{bottom:14,right:14,borderRadius:'0 0 8px 0'}].map((s,i) => <div key={i} style={{ position:'absolute', ...s, width:36, height:36, border:'2px solid var(--jade)', opacity:0.6 }} />)}
                  {cameraError ? (
                    <div style={{ textAlign:'center', padding:'0 20px' }}>
                      <p style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:14 }}>{cameraError}</p>
                      <motion.button whileTap={{ scale:0.96 }} onClick={startCamera} style={{ padding:'10px 24px', borderRadius:12, background:'var(--jade)', color:'#000', fontSize:13, fontWeight:700, cursor:'pointer' }}>Try Again</motion.button>
                    </div>
                  ) : (
                    <>
                      <p style={{ fontSize:24 }}>📷</p>
                      <p style={{ fontSize:13, color:'var(--text-muted)', textAlign:'center' }}>Point at any UPI QR code</p>
                      <motion.button whileTap={{ scale:0.96 }} onClick={startCamera} style={{ padding:'11px 28px', borderRadius:14, background:'var(--jade)', color:'#000', fontSize:13, fontWeight:700, cursor:'pointer' }}>Start Camera</motion.button>
                    </>
                  )}
                </div>
              )}
              {cameraActive && (
                <>
                  <div style={{ position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)', width:200, height:200 }}>
                    {[{top:0,left:0,borderRadius:'8px 0 0 0'},{top:0,right:0,borderRadius:'0 8px 0 0'},{bottom:0,left:0,borderRadius:'0 0 0 8px'},{bottom:0,right:0,borderRadius:'0 0 8px 0'}].map((s,i) => <div key={i} style={{ position:'absolute', ...s, width:32, height:32, border:'2.5px solid var(--jade)', opacity:0.9 }} />)}
                  </div>
                  <div style={{ position:'absolute', bottom:16, left:0, right:0, textAlign:'center' }}>
                    <span style={{ fontSize:11, color:'var(--jade)', fontFamily:'var(--font-mono)', background:'rgba(0,0,0,0.6)', padding:'4px 12px', borderRadius:8 }}>Scanning…</span>
                  </div>
                </>
              )}
            </div>
            <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', marginBottom: 10 }}>OR ENTER UPI ID MANUALLY</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
              <input id="upi-manual" placeholder="merchant@upi" style={{ flex: 1, height: 46, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '0 14px', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', outline: 'none' }}
                onKeyDown={e => { if (e.key === 'Enter' && e.target.value.includes('@')) { setTxnData({ merchant_vpa: e.target.value.trim(), merchant_name: e.target.value.trim(), amount: null }); setStep('confirm') } }} />
              <motion.button whileTap={{ scale: 0.96 }} onClick={() => { const v = document.getElementById('upi-manual')?.value; if (v?.includes('@')) { setTxnData({ merchant_vpa: v.trim(), merchant_name: v.trim(), amount: null }); setStep('confirm') } else toast.error('Enter valid UPI ID') }}
                style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--jade)', color: '#000', fontSize: 18, fontWeight: 700, flexShrink: 0, cursor: 'pointer' }}>→</motion.button>
            </div>
            {spendingData && spendingData.count > 0 ? (
              <>
                <p style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '2.5px', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>YOUR SPENDING BREAKDOWN</p>
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 18, padding: '16px', marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div><p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Total spent</p><p style={{ fontFamily: 'var(--font-display)', fontSize: 24 }}>{fmt(spendingData.total)}</p></div>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{spendingData.count} transactions</p>
                  </div>
                  {spendingData.categories.slice(0, 4).map((cat, i) => {
                    const pct = spendingData.total > 0 ? (cat.amount / spendingData.total) * 100 : 0
                    return (
                      <div key={i} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 14 }}>{cat.icon}</span><span style={{ fontSize: 12, fontWeight: 600 }}>{cat.cat}</span></div>
                          <span style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{fmt(cat.amount)}</span>
                        </div>
                        <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-elevated)', overflow: 'hidden' }}>
                          <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.8, delay: i * 0.1 }}
                            style={{ height: '100%', background: cat.color, borderRadius: 2 }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '24px', textAlign: 'center' }}>
                <p style={{ fontSize: 28, marginBottom: 8 }}>📊</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>No spending yet</p>
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
                      style={{ fontSize: 40, fontFamily: 'var(--font-display)', color: 'var(--jade)', width: 160, textAlign: 'center', background: 'transparent', border: 'none', outline: 'none' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                    {QUICK.map(a => (<motion.button key={a} whileTap={{ scale: 0.9 }} onClick={() => setConfirmAmount(String(a))} style={{ padding: '5px 12px', borderRadius: 8, background: confirmAmount === String(a) ? 'var(--jade)' : 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--font-mono)', color: confirmAmount === String(a) ? '#000' : 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}>₹{a}</motion.button>))}
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
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>LienPay Credit</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Remaining credit</span>
                <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: available - (txnData.amount || parseFloat(confirmAmount) || 0) >= 0 ? 'var(--jade)' : 'var(--red)' }}>
                  {fmt(available - (txnData.amount || parseFloat(confirmAmount) || 0))}
                </span>
              </div>
            </div>
            <motion.button whileTap={{ scale: 0.97 }} onClick={handlePayment} disabled={loading || available <= 0}
              style={{ width: '100%', height: 54, borderRadius: 16, background: available > 0 ? 'linear-gradient(135deg, var(--jade), #00A878)' : 'var(--bg-elevated)', color: available > 0 ? '#000' : 'var(--text-muted)', fontSize: 15, fontWeight: 800, fontFamily: 'var(--font-sans)', marginBottom: 10, border: 'none', cursor: available > 0 ? 'pointer' : 'not-allowed' }}>Pay Now →</motion.button>
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => { setTxnData(null); setStep('scan') }} style={{ width: '100%', height: 44, borderRadius: 14, background: 'transparent', color: 'var(--text-muted)', fontSize: 13, border: 'none', cursor: 'pointer' }}>Cancel</motion.button>
          </motion.div>
        )}

        {/* ── FAILED ── */}
        {step === 'failed' && (
          <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '40px 20px', textAlign: 'center' }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, background: 'var(--red-dim)', border: '1px solid rgba(224,82,82,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 20px' }}>✕</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, marginBottom: 6 }}>Payment Failed</h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>Something went wrong. Please try again.</p>
            <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep('scan')} style={{ width: '100%', height: 52, borderRadius: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Try Again</motion.button>
          </motion.div>
        )}
      </div>
    </div>
  )
}
