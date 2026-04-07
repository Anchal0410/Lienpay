import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { LienzoLogoImage } from '../components/Logo'

// ─── Animated particle canvas background ───────────────────────
function ParticleCanvas() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let animId
    let W = canvas.width = window.innerWidth
    let H = canvas.height = window.innerHeight

    const JADE   = '#00D4A1'
    const JADE2  = '#00A878'
    const COUNT  = 55

    // Particles
    const particles = Array.from({ length: COUNT }, (_, i) => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() * 1.8 + 0.4,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      alpha: Math.random() * 0.5 + 0.15,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.01 + Math.random() * 0.015,
    }))

    // Grid lines
    const gridLines = []
    for (let x = 0; x < W; x += 64) gridLines.push({ type: 'v', pos: x })
    for (let y = 0; y < H; y += 64) gridLines.push({ type: 'h', pos: y })

    // Floating geometric rings
    const rings = [
      { x: W * 0.15, y: H * 0.25, r: 90, speed: 0.003, phase: 0 },
      { x: W * 0.85, y: H * 0.7,  r: 140, speed: 0.002, phase: 1 },
      { x: W * 0.5,  y: H * 0.5,  r: 200, speed: 0.0015, phase: 2 },
    ]

    // Nebula blobs (static radial gradients that shift)
    let t = 0

    const draw = () => {
      t += 0.005
      ctx.clearRect(0, 0, W, H)

      // Background
      ctx.fillStyle = '#050809'
      ctx.fillRect(0, 0, W, H)

      // Nebula glow 1 — top-left jade
      const g1 = ctx.createRadialGradient(W * 0.15 + Math.sin(t * 0.7) * 20, H * 0.2 + Math.cos(t * 0.5) * 15, 0, W * 0.15, H * 0.2, W * 0.45)
      g1.addColorStop(0, 'rgba(0,212,161,0.10)')
      g1.addColorStop(0.4, 'rgba(0,212,161,0.04)')
      g1.addColorStop(1, 'transparent')
      ctx.fillStyle = g1
      ctx.fillRect(0, 0, W, H)

      // Nebula glow 2 — bottom-right teal
      const g2 = ctx.createRadialGradient(W * 0.85 + Math.sin(t * 0.6) * 25, H * 0.75 + Math.cos(t * 0.8) * 20, 0, W * 0.85, H * 0.75, W * 0.4)
      g2.addColorStop(0, 'rgba(0,168,120,0.08)')
      g2.addColorStop(0.5, 'rgba(0,168,120,0.03)')
      g2.addColorStop(1, 'transparent')
      ctx.fillStyle = g2
      ctx.fillRect(0, 0, W, H)

      // Grid
      ctx.strokeStyle = 'rgba(0,212,161,0.035)'
      ctx.lineWidth = 1
      gridLines.forEach(l => {
        ctx.beginPath()
        if (l.type === 'v') { ctx.moveTo(l.pos, 0); ctx.lineTo(l.pos, H) }
        else { ctx.moveTo(0, l.pos); ctx.lineTo(W, l.pos) }
        ctx.stroke()
      })

      // Geometric rings
      rings.forEach(ring => {
        ring.phase += ring.speed
        const pulse = 1 + Math.sin(ring.phase) * 0.06
        ctx.beginPath()
        ctx.arc(ring.x, ring.y, ring.r * pulse, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(0,212,161,${0.04 + Math.sin(ring.phase) * 0.02})`
        ctx.lineWidth = 1
        ctx.stroke()

        // Inner ring
        ctx.beginPath()
        ctx.arc(ring.x, ring.y, ring.r * pulse * 0.65, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(0,212,161,${0.025 + Math.sin(ring.phase + 1) * 0.01})`
        ctx.stroke()
      })

      // Particles with connections
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy
        p.pulse += p.pulseSpeed
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0
        if (p.y < 0) p.y = H; if (p.y > H) p.y = 0
        const a = p.alpha * (0.7 + 0.3 * Math.sin(p.pulse))
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(0,212,161,${a})`
        ctx.fill()
      })

      // Connections between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const d = Math.sqrt(dx * dx + dy * dy)
          if (d < 100) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(0,212,161,${0.08 * (1 - d / 100)})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }

      // Scanning line — horizontal sweep
      const scanY = ((t * 80) % H)
      const sg = ctx.createLinearGradient(0, scanY - 40, 0, scanY + 40)
      sg.addColorStop(0, 'transparent')
      sg.addColorStop(0.5, 'rgba(0,212,161,0.04)')
      sg.addColorStop(1, 'transparent')
      ctx.fillStyle = sg
      ctx.fillRect(0, scanY - 40, W, 80)

      animId = requestAnimationFrame(draw)
    }

    draw()

    const onResize = () => {
      W = canvas.width = window.innerWidth
      H = canvas.height = window.innerHeight
    }
    window.addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', onResize) }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  )
}

// ─── Floating data ticker ──────────────────────────────────────
const TICKERS = [
  { label: 'NIFTY 50', val: '+0.84%', up: true },
  { label: 'SENSEX', val: '+0.76%', up: true },
  { label: 'LTV CAP', val: '40%', up: null },
  { label: 'PLEDGE', val: 'SECURE', up: null },
  { label: 'APR', val: '12%', up: null },
  { label: 'GOLD', val: '+0.22%', up: true },
  { label: 'DEBT', val: '80% LTV', up: null },
]

export default function Splash({ onComplete }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 3200)
    return () => clearTimeout(timer)
  }, [onComplete])

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#050809',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      {/* Canvas background */}
      <ParticleCanvas />

      {/* Scrolling market ticker at top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        overflow: 'hidden', height: 28,
        borderBottom: '1px solid rgba(0,212,161,0.08)',
        background: 'rgba(5,8,9,0.6)',
        display: 'flex', alignItems: 'center',
      }}>
        <motion.div
          animate={{ x: [0, -(TICKERS.length * 120)] }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear', repeatType: 'loop' }}
          style={{ display: 'flex', gap: 0, whiteSpace: 'nowrap' }}
        >
          {[...TICKERS, ...TICKERS, ...TICKERS].map((t, i) => (
            <div key={i} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '0 20px', borderRight: '1px solid rgba(0,212,161,0.06)',
            }}>
              <span style={{ fontSize: 9, color: 'rgba(122,143,133,0.7)', fontFamily: 'var(--font-mono)', letterSpacing: '1px' }}>{t.label}</span>
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
                color: t.up === true ? '#00D4A1' : t.up === false ? '#E05252' : 'rgba(232,240,236,0.5)',
              }}>{t.val}</span>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Main content */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        style={{ position: 'relative', textAlign: 'center', zIndex: 10 }}
      >
        {/* Glow ring behind logo */}
        <motion.div
          animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.08, 1] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -70%)',
            width: 120, height: 120,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,212,161,0.18) 0%, transparent 70%)',
            filter: 'blur(8px)',
          }}
        />

        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.25, duration: 0.9, ease: 'easeOut' }}
          style={{ display: 'inline-block', marginBottom: 20, position: 'relative' }}
        >
          <LienzoLogoImage size={76} />
        </motion.div>

        {/* Wordmark */}
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.7 }}
          style={{
            fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 300,
            letterSpacing: '-1px', marginBottom: 6,
            color: 'var(--text-primary)',
          }}
        >
          Lien<span style={{ color: 'var(--jade)', fontWeight: 500 }}>Pay</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.65, duration: 0.7 }}
          style={{
            fontSize: 8, letterSpacing: '4.5px', textTransform: 'uppercase',
            color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
            fontWeight: 500, marginBottom: 36,
          }}
        >
          WEALTH-BACKED CREDIT
        </motion.p>

        {/* Tag line pills */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.85, duration: 0.6 }}
          style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 40 }}
        >
          {['Pledge', 'Borrow', 'Repay', 'Repeat'].map((w, i) => (
            <motion.span
              key={w}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.85 + i * 0.07 }}
              style={{
                fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
                color: i === 1 ? 'var(--jade)' : 'var(--text-muted)',
                padding: '3px 8px',
                border: `1px solid ${i === 1 ? 'rgba(0,212,161,0.3)' : 'rgba(122,143,133,0.12)'}`,
                borderRadius: 4,
                letterSpacing: '0.5px',
              }}
            >
              {w}
            </motion.span>
          ))}
        </motion.div>
      </motion.div>

      {/* Loading bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        style={{
          position: 'absolute', bottom: 52,
          width: 100, height: 2,
          background: 'rgba(0,212,161,0.1)',
          borderRadius: 2, overflow: 'hidden',
        }}
      >
        <motion.div
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 2.6, ease: [0.4, 0, 0.2, 1], delay: 0.3 }}
          style={{
            height: '100%',
            background: 'linear-gradient(90deg, var(--jade), var(--jade-bright), var(--jade))',
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.5s ease-in-out infinite',
            borderRadius: 2,
          }}
        />
      </motion.div>

      {/* Bottom brand */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.35 }}
        transition={{ delay: 1, duration: 0.8 }}
        style={{
          position: 'absolute', bottom: 24,
          fontSize: 8, color: 'var(--text-muted)',
          fontFamily: 'var(--font-mono)', letterSpacing: '2px',
        }}
      >
        BY ARTHASTRA INNOVATIONS
      </motion.p>
    </div>
  )
}
