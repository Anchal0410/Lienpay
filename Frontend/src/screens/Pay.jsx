import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { initiatePayment, mockSettle, getCreditStatus, getTxnHistory } from '../api/client'
import useStore from '../store/useStore'
import { TICKER_HEIGHT } from '../App'

const fmt = (n) => `₹${parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`

const categorize = (name) => {
  const n = (name || '').toLowerCase()
  if (n.includes('zomato') || n.includes('swiggy') || n.includes('food') || n.includes('blinkit')) return { cat: 'Food & Dining', icon: '🍕', color: '#EF8B2C' }
  if (n.includes('uber') || n.includes('ola') || n.includes('rapido') || n.includes('petrol'))    return { cat: 'Transport', icon: '🚗', color: '#4DA8FF' }
  if (n.includes('amazon') || n.includes('flipkart') || n.includes('myntra'))                      return { cat: 'Shopping', icon: '🛍️', color: '#8B7BD4' }
  if (n.includes('netflix') || n.includes('spotify') || n.includes('hotstar'))                     return { cat: 'Subscriptions', icon: '🎬', color: '#E05252' }
  if (n.includes('pharma') || n.includes('medic') || n.includes('apollo'))                        return { cat: 'Health', icon: '💊', color: '#00D4A1' }
  return { cat: 'Other', icon: '💳', color: '#7A8F85' }
}

// ─────────────────────────────────────────────────────────────
// CITYSCAPE PAYMENT ANIMATION — matching Lovable design
// ─────────────────────────────────────────────────────────────
function CityscapeProcessing({ merchant, amount }) {
  const progressRef = useRef(null)

  // Buildings data — heights and window patterns
  const buildings = [
    { x: 0,   w: 38, h: 160, windows: [[8,20],[18,20],[28,20],[8,35],[18,35],[28,35],[8,50],[18,50]] },
    { x: 44,  w: 30, h: 120, windows: [[7,15],[17,15],[7,28],[17,28],[7,41],[17,41]] },
    { x: 80,  w: 42, h: 190, windows: [[8,18],[20,18],[32,18],[8,33],[20,33],[32,33],[8,48],[20,48],[32,48],[8,63],[20,63]] },
    { x: 128, w: 36, h: 140, windows: [[8,16],[20,16],[8,30],[20,30],[8,44],[20,44],[8,58],[20,58]] },
    { x: 170, w: 28, h: 100, windows: [[7,14],[17,14],[7,26],[17,26],[7,38],[17,38]] },
    // central tall LienPay building — will be rendered separately
    { x: 260, w: 32, h: 130, windows: [[7,15],[17,15],[7,28],[17,28],[7,41],[17,41],[7,54],[17,54]] },
    { x: 298, w: 44, h: 170, windows: [[8,18],[20,18],[32,18],[8,33],[20,33],[32,33],[8,48],[20,48],[32,48]] },
    { x: 348, w: 30, h: 115, windows: [[7,14],[17,14],[7,27],[17,27],[7,40],[17,40]] },
    { x: 384, w: 36, h: 155, windows: [[8,16],[20,16],[8,30],[20,30],[8,44],[20,44],[8,58],[20,58],[8,72],[20,72]] },
    { x: 426, w: 28, h: 95,  windows: [[7,12],[17,12],[7,24],[17,24],[7,36],[17,36]] },
    { x: 460, w: 40, h: 145, windows: [[8,16],[20,16],[30,16],[8,30],[20,30],[30,30],[8,44],[20,44]] },
  ]

  // Stars
  const stars = Array.from({ length: 40 }, (_, i) => ({
    cx: (i * 97 + 13) % 500,
    cy: (i * 61 + 7) % 200,
    r:  i % 3 === 0 ? 1.5 : 1,
  }))

  // Antenna dots on buildings
  const antennaDots = [
    { x: 19, y: 0,   color: '#EF4444' },
    { x: 99, y: 0,   color: '#EF4444' },
    { x: 184, y: 0,  color: '#EF4444' },
    { x: 314, y: 0,  color: '#EF4444' },
    { x: 366, y: 0,  color: '#EF4444' },
    { x: 404, y: 0,  color: '#EF4444' },
    { x: 446, y: 0,  color: '#00D4A1' },
    { x: 480, y: 0,  color: '#EF4444' },
  ]

  const groundY = 220  // SVG ground level (building bases)
  const svgH = 260

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#060d0b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Amount + merchant at top */}
      <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
        style={{ textAlign: 'center', paddingTop: 32, paddingBottom: 8, position: 'relative', zIndex: 10 }}>
        <p style={{ fontSize: 9, color: 'var(--jade)', fontFamily: 'var(--font-mono)', letterSpacing: '4px', fontWeight: 700, marginBottom: 8 }}>LIENPAY</p>
        <p style={{ fontFamily: 'var(--font-display)', fontSize: 44, fontWeight: 400, color: '#fff', letterSpacing: '-1px', marginBottom: 4 }}>{fmt(amount)}</p>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.45)', fontFamily: 'var(--font-sans)' }}>to {merchant}</p>
      </motion.div>

      {/* Cityscape SVG */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <svg viewBox={`0 0 500 ${svgH}`} preserveAspectRatio="xMidYMax meet"
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, width: '100%', height: '100%' }}>

          {/* Night sky gradient */}
          <defs>
            <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#050e09"/>
              <stop offset="100%" stopColor="#081510"/>
            </linearGradient>
            <linearGradient id="buildingGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0e2018"/>
              <stop offset="100%" stopColor="#09140f"/>
            </linearGradient>
            <linearGradient id="centerBuildingGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0e3020"/>
              <stop offset="100%" stopColor="#061a10"/>
            </linearGradient>
            <radialGradient id="lGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(0,212,161,0.4)"/>
              <stop offset="100%" stopColor="rgba(0,212,161,0)"/>
            </radialGradient>
          </defs>

          {/* Sky background */}
          <rect width="500" height={svgH} fill="url(#skyGrad)"/>

          {/* Stars */}
          {stars.map((s, i) => (
            <motion.circle key={i} cx={s.cx} cy={s.cy} r={s.r} fill="rgba(255,255,255,0.6)"
              animate={{ opacity: [0.3, 0.9, 0.3] }}
              transition={{ duration: 2 + (i % 3), repeat: Infinity, delay: (i * 0.15) % 3 }} />
          ))}

          {/* Regular buildings */}
          {buildings.map((b, i) => (
            <g key={i}>
              <rect x={b.x} y={groundY - b.h} width={b.w} height={b.h} fill="url(#buildingGrad)"/>
              {/* Windows - random amber/off lights */}
              {b.windows.map((w, j) => (
                <rect key={j} x={b.x + w[0]} y={groundY - b.h + w[1]} width={6} height={5}
                  fill={j % 3 === 0 ? 'rgba(255,185,60,0.6)' : j % 5 === 0 ? 'rgba(255,220,100,0.4)' : 'rgba(255,255,255,0.08)'} rx={0.5}/>
              ))}
            </g>
          ))}

          {/* Central LienPay building */}
          <g>
            {/* Building body */}
            <rect x={204} y={groundY - 220} width={72} height={220} fill="url(#centerBuildingGrad)" rx={1}/>
            {/* Glow around center building */}
            <rect x={196} y={groundY - 228} width={88} height={236} fill="url(#lGlow)" rx={4}/>
            {/* Building windows */}
            {[30, 55, 80, 105, 130, 155].map((wy, i) => (
              [8, 22, 38, 52].map((wx, j) => (
                <rect key={`${i}-${j}`} x={204 + wx} y={groundY - 220 + wy} width={8} height={7}
                  fill={i % 2 === 0 && j % 2 === 0 ? 'rgba(0,212,161,0.25)' : 'rgba(255,255,255,0.04)'} rx={1}/>
              ))
            ))}
            {/* "L" logo in center */}
            <text x={240} y={groundY - 60} textAnchor="middle" fill="#00D4A1" fontSize="28" fontFamily="Georgia, serif" fontWeight="400">L</text>
            {/* Glow behind L */}
            <circle cx={240} cy={groundY - 70} r={22} fill="rgba(0,212,161,0.08)"/>
          </g>

          {/* Orbital circle around center building */}
          <motion.circle cx={240} cy={groundY - 135} r={72} fill="none" stroke="rgba(0,212,161,0.18)" strokeWidth="0.8"
            animate={{ opacity: [0.5, 0.9, 0.5] }} transition={{ duration: 3, repeat: Infinity }} />

          {/* Orbiting dot */}
          <motion.g
            animate={{ rotate: 360 }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            style={{ transformOrigin: '240px ' + (groundY - 135) + 'px' }}>
            <circle cx={240} cy={groundY - 135 - 72} r={6} fill="var(--jade)"/>
            <circle cx={240} cy={groundY - 135 - 72} r={10} fill="rgba(0,212,161,0.2)"/>
          </motion.g>

          {/* Secondary orbit dots */}
          {[0.33, 0.66].map((frac, i) => (
            <motion.circle key={i} cx={240 + 48 * Math.cos(frac * Math.PI * 2)} cy={(groundY - 135) + 48 * Math.sin(frac * Math.PI * 2)} r={3} fill="rgba(0,212,161,0.5)"
              animate={{ opacity: [0.3, 0.8, 0.3] }} transition={{ duration: 2, repeat: Infinity, delay: i * 0.7 }} />
          ))}

          {/* Antenna dots on buildings */}
          {antennaDots.map((d, i) => (
            <motion.circle key={i} cx={d.x} cy={groundY - (buildings[i % buildings.length]?.h || 100) - 6}
              r={3} fill={d.color}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.3 }} />
          ))}

          {/* Ground line */}
          <rect x={0} y={groundY} width={500} height={svgH - groundY} fill="#06100c"/>
          <line x1={0} y1={groundY} x2={500} y2={groundY} stroke="rgba(0,212,161,0.15)" strokeWidth="0.5"/>
        </svg>
      </div>

      {/* Progress bar at bottom */}
      <div style={{ height: 3, background: 'rgba(0,212,161,0.15)', position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 20 }}>
        <motion.div initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 2.5, ease: [0.4, 0, 0.2, 1] }}
          style={{ height: '100%', background: 'linear-gradient(90deg, var(--jade), var(--jade-bright))' }} />
      </div>
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
        const sorted = Object.values(byCategory).sort((a, b) => b.amount - a.amount)
        setSpendingData({ categories: sorted, total, count: txns.length, freePeriodCount: txns.filter(t => t.is_in_free_period).length })
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
    setLoading(true); setStep('processing')
    try {
      const initRes = await initiatePayment({ merchant_vpa: txnData.merchant_vpa, merchant_name: txnData.merchant_name, amount, mcc: '5812' })
      await mockSettle(initRes.data.txn_id)
      const creditRes = await getCreditStatus(); setCreditAccount(creditRes.data)
      setTxnResult({ amount, merchant: txnData.merchant_name }); setStep('success')
    } catch(err) { toast.error(err.message); setStep('failed') }
    finally { setLoading(false) }
  }

  const QUICK = [100, 250, 500, 1000]

  return (
    <div style={{ position: 'fixed', inset: 0, paddingTop: TICKER_HEIGHT, background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {step !== 'processing' && step !== 'success' && (
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

      <div style={{ flex: 1, overflow: step === 'processing' || step === 'success' ? 'hidden' : 'auto', position: 'relative' }}>
        <AnimatePresence mode="wait">

          {/* SCAN */}
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
                      <div>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Total spent</p>
                        <p style={{ fontFamily: 'var(--font-display)', fontSize: 24 }}>{fmt(spendingData.total)}</p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{spendingData.count} transactions</p>
                        {spendingData.freePeriodCount > 0 && <p style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 600 }}>{spendingData.freePeriodCount} interest-free</p>}
                      </div>
                    </div>
                    {spendingData.categories.slice(0, 4).map((cat, i) => {
                      const pct = spendingData.total > 0 ? (cat.amount / spendingData.total) * 100 : 0
                      return (
                        <div key={i} style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: 14 }}>{cat.icon}</span>
                              <span style={{ fontSize: 12, fontWeight: 600 }}>{cat.cat}</span>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{cat.count}</span>
                            </div>
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

          {/* CONFIRM */}
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
                      {QUICK.map(a => (
                        <motion.button key={a} whileTap={{ scale: 0.9 }} onClick={() => setConfirmAmount(String(a))}
                          style={{ padding: '5px 12px', borderRadius: 8, background: confirmAmount === String(a) ? 'var(--jade)' : 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--font-mono)', color: confirmAmount === String(a) ? '#000' : 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}>₹{a}</motion.button>
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
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => { setTxnData(null); setStep('scan') }}
                style={{ width: '100%', height: 44, borderRadius: 14, background: 'transparent', color: 'var(--text-muted)', fontSize: 13, border: 'none', cursor: 'pointer' }}>Cancel</motion.button>
            </motion.div>
          )}

          {/* PROCESSING — Cityscape */}
          {step === 'processing' && txnData && (
            <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ position: 'absolute', inset: 0 }}>
              <CityscapeProcessing merchant={txnData.merchant_name} amount={txnData.amount || parseFloat(confirmAmount) || 0} />
            </motion.div>
          )}

          {/* SUCCESS */}
          {step === 'success' && txnResult && (
            <motion.div key="success" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{ position: 'absolute', inset: 0 }}>
              <CityscapeProcessing merchant={txnResult.merchant} amount={txnResult.amount} />
              {/* Success overlay */}
              <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5, type: 'spring' }}
                style={{ position: 'absolute', bottom: 40, left: 20, right: 20, background: 'rgba(6,13,11,0.9)', border: '1px solid var(--jade-border)', borderRadius: 24, padding: '24px 20px', textAlign: 'center', backdropFilter: 'blur(10px)' }}>
                <div style={{ width: 56, height: 56, borderRadius: 18, background: 'var(--jade-dim)', border: '1.5px solid var(--jade)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17L4 12" stroke="var(--jade)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </div>
                <p style={{ fontFamily: 'var(--font-display)', fontSize: 22, marginBottom: 4 }}>Payment Sent</p>
                <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>30-day interest-free period started</p>
                <motion.button whileTap={{ scale: 0.97 }} onClick={onSuccess}
                  style={{ width: '100%', height: 50, borderRadius: 16, background: 'linear-gradient(135deg, var(--jade), #00A878)', color: '#000', fontSize: 14, fontWeight: 800, fontFamily: 'var(--font-sans)', border: 'none', cursor: 'pointer' }}>Done</motion.button>
              </motion.div>
            </motion.div>
          )}

          {/* FAILED */}
          {step === 'failed' && (
            <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ width: 72, height: 72, borderRadius: 20, background: 'var(--red-dim)', border: '1px solid rgba(224,82,82,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, margin: '0 auto 20px' }}>✕</div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, marginBottom: 6 }}>Payment Failed</h2>
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>Something went wrong.</p>
              <motion.button whileTap={{ scale: 0.97 }} onClick={() => setStep('scan')}
                style={{ width: '100%', height: 52, borderRadius: 16, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Try Again</motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
