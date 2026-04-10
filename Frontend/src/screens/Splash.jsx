import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { LienzoLogoImage } from '../components/Logo'

// ─── Mobile-safe particle canvas ──────────────────────────────
function ParticleCanvas() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let ctx
    try { ctx = canvas.getContext('2d', { alpha: true }) }
    catch (e) { return } // canvas not supported — graceful skip
    if (!ctx) return

    const isMobile = window.innerWidth < 768
    const COUNT    = isMobile ? 30 : 55   // fewer particles on mobile
    const MAX_FPS  = isMobile ? 30 : 60  // cap framerate on mobile

    let animId
    let lastTime   = 0
    let W = canvas.width  = window.innerWidth
    let H = canvas.height = window.innerHeight

    const particles = Array.from({ length: COUNT }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      r: Math.random() * 1.6 + 0.4,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      alpha: Math.random() * 0.45 + 0.1,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.008 + Math.random() * 0.012,
    }))

    const rings = [
      { x: W * 0.15, y: H * 0.25, r: 80,  speed: 0.0025, phase: 0 },
      { x: W * 0.85, y: H * 0.7,  r: 120, speed: 0.0018, phase: 1 },
      { x: W * 0.5,  y: H * 0.5,  r: 180, speed: 0.0013, phase: 2 },
    ]

    let t = 0

    const draw = (timestamp) => {
      // Frame rate limiting
      const elapsed = timestamp - lastTime
      if (elapsed < 1000 / MAX_FPS) { animId = requestAnimationFrame(draw); return }
      lastTime = timestamp
      t += 0.004

      ctx.clearRect(0, 0, W, H)

      // Background
      ctx.fillStyle = '#050809'
      ctx.fillRect(0, 0, W, H)

      // Nebula glow — top left
      try {
        const g1 = ctx.createRadialGradient(
          W * 0.15 + Math.sin(t * 0.7) * 18, H * 0.2 + Math.cos(t * 0.5) * 12, 0,
          W * 0.15, H * 0.2, W * 0.42
        )
        g1.addColorStop(0, 'rgba(0,212,161,0.09)')
        g1.addColorStop(0.4, 'rgba(0,212,161,0.03)')
        g1.addColorStop(1, 'transparent')
        ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H)
      } catch(e) {}

      // Nebula glow — bottom right
      try {
        const g2 = ctx.createRadialGradient(
          W * 0.85 + Math.sin(t * 0.6) * 22, H * 0.75 + Math.cos(t * 0.8) * 18, 0,
          W * 0.85, H * 0.75, W * 0.38
        )
        g2.addColorStop(0, 'rgba(0,168,120,0.07)')
        g2.addColorStop(0.5, 'rgba(0,168,120,0.02)')
        g2.addColorStop(1, 'transparent')
        ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H)
      } catch(e) {}

      // Grid
      ctx.strokeStyle = 'rgba(0,212,161,0.03)'
      ctx.lineWidth = 0.8
      const step = 64
      for (let x = 0; x < W; x += step) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke()
      }
      for (let y = 0; y < H; y += step) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke()
      }

      // Rings
      rings.forEach(ring => {
        ring.phase += ring.speed
        const pulse = 1 + Math.sin(ring.phase) * 0.05
        ctx.beginPath()
        ctx.arc(ring.x, ring.y, ring.r * pulse, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(0,212,161,${0.035 + Math.sin(ring.phase) * 0.015})`
        ctx.lineWidth = 0.8
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(ring.x, ring.y, ring.r * pulse * 0.62, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(0,212,161,0.02)`
        ctx.stroke()
      })

      // Particles
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

      // Connections — skip on mobile for perf
      if (!isMobile) {
        for (let i = 0; i < particles.length; i++) {
          for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x
            const dy = particles[i].y - particles[j].y
            const d  = Math.sqrt(dx * dx + dy * dy)
            if (d < 90) {
              ctx.beginPath()
              ctx.moveTo(particles[i].x, particles[i].y)
              ctx.lineTo(particles[j].x, particles[j].y)
              ctx.strokeStyle = `rgba(0,212,161,${0.06 * (1 - d / 90)})`
              ctx.lineWidth = 0.4
              ctx.stroke()
            }
          }
        }
      }

      // Scan line
      const scanY = ((t * 60) % H)
      try {
        const sg = ctx.createLinearGradient(0, scanY - 35, 0, scanY + 35)
        sg.addColorStop(0, 'transparent')
        sg.addColorStop(0.5, 'rgba(0,212,161,0.03)')
        sg.addColorStop(1, 'transparent')
        ctx.fillStyle = sg
        ctx.fillRect(0, scanY - 35, W, 70)
      } catch(e) {}

      animId = requestAnimationFrame(draw)
    }

    animId = requestAnimationFrame(draw)

    const onResize = () => {
      W = canvas.width  = window.innerWidth
      H = canvas.height = window.innerHeight
    }
    window.addEventListener('resize', onResize, { passive: true })

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
        zIndex: 0,  // behind everything
        pointerEvents: 'none',
      }}
    />
  )
}

// ─── Market ticker ─────────────────────────────────────────────
const TICKERS = [
  { label: 'NIFTY 50',  val: '+0.84%', up: true },
  { label: 'SENSEX',    val: '+0.76%', up: true },
  { label: 'LTV CAP',   val: '40%',    up: null },
  { label: 'PLEDGE',    val: 'SECURE', up: null },
  { label: 'APR',       val: '12%',    up: null },
  { label: 'GOLD',      val: '+0.22%', up: true },
  { label: 'DEBT LTV',  val: '80%',    up: null },
]

export default function Splash({ onComplete }) {
  useEffect(() => {
    const timer = setTimeout(onComplete, 3000)
    return () => clearTimeout(timer)
  }, [onComplete])

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#050809',
      overflow: 'hidden',
    }}>
      {/* Particle canvas — z-index 0, purely decorative */}
      <ParticleCanvas />

      {/* Grid overlay */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
        backgroundImage: `linear-gradient(rgba(0,212,161,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,161,0.025) 1px, transparent 1px)`,
        backgroundSize: '64px 64px',
      }} />

      {/* Scan line animation */}
      <motion.div
        animate={{ y: ['0%', '100%'] }}
        transition={{ duration: 3.5, repeat: Infinity, ease: 'linear' }}
        style={{ position: 'absolute', left: 0, right: 0, height: 70, background: 'linear-gradient(to bottom, transparent, rgba(0,212,161,0.03), transparent)', pointerEvents: 'none', zIndex: 2 }}
      />

      {/* Market ticker */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 26, overflow: 'hidden', zIndex: 10,
        borderBottom: '1px solid rgba(0,212,161,0.08)',
        background: 'rgba(5,8,9,0.7)',
        display: 'flex', alignItems: 'center',
      }}>
        <motion.div
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          style={{ display: 'flex', gap: 0, whiteSpace: 'nowrap' }}
        >
          {[...TICKERS, ...TICKERS, ...TICKERS, ...TICKERS].map((t, i) => (
            <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 18px', borderRight: '1px solid rgba(0,212,161,0.06)' }}>
              <span style={{ fontSize: 8, color: 'rgba(122,143,133,0.7)', fontFamily: 'monospace', letterSpacing: '0.8px' }}>{t.label}</span>
              <span style={{ fontSize: 9, fontFamily: 'monospace', fontWeight: 700, color: t.up === true ? '#00D4A1' : 'rgba(232,240,236,0.45)' }}>{t.val}</span>
            </div>
          ))}
        </motion.div>
      </div>

      {/* Main content — z-index 10 so it's above canvas */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 10,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
      }}>
        {/* Glow behind logo */}
        <motion.div
          animate={{ opacity: [0.3, 0.65, 0.3], scale: [1, 1.1, 1] }}
          transition={{ duration: 3, repeat: Infinity }}
          style={{ position: 'absolute', width: 130, height: 130, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,212,161,0.18) 0%, transparent 70%)', filter: 'blur(10px)', pointerEvents: 'none' }}
        />

        <motion.div initial={{ opacity: 0, scale: 0.85, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
          style={{ textAlign: 'center', position: 'relative' }}>

          <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.25, duration: 0.8 }}
            style={{ display: 'inline-block', marginBottom: 20 }}>
            <LienzoLogoImage size={76} />
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.7 }}
            style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 300, letterSpacing: '-1px', marginBottom: 6, color: 'var(--text-primary)' }}>
            Lien<span style={{ color: 'var(--jade)', fontWeight: 500 }}>Pay</span>
          </motion.h1>

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.65, duration: 0.7 }}
            style={{ fontSize: 8, letterSpacing: '4.5px', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontWeight: 500, marginBottom: 36 }}>
            WEALTH-BACKED CREDIT
          </motion.p>

          {/* All 4 words highlighted */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85 }}
            style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 40 }}>
            {['Pledge', 'Borrow', 'Repay', 'Repeat'].map((w, i) => (
              <motion.span key={w} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.85 + i * 0.07 }}
                style={{ fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--jade)', padding: '4px 10px', border: '1px solid rgba(0,212,161,0.35)', borderRadius: 4, background: 'rgba(0,212,161,0.06)' }}>
                {w}
              </motion.span>
            ))}
          </motion.div>
        </motion.div>
      </div>

      {/* Loading bar */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
        style={{ position: 'absolute', bottom: 52, left: '50%', transform: 'translateX(-50%)', width: 100, height: 2, background: 'rgba(0,212,161,0.12)', borderRadius: 2, overflow: 'hidden', zIndex: 10 }}>
        <motion.div initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 2.6, ease: [0.4, 0, 0.2, 1], delay: 0.3 }}
          style={{ height: '100%', background: 'linear-gradient(90deg, var(--jade), var(--jade-bright))', borderRadius: 2 }} />
      </motion.div>

      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 0.72 }} transition={{ delay: 1.2, duration: 1 }}
        style={{ position: 'absolute', bottom: 24, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: 'rgba(0,212,161,0.6)', fontFamily: 'var(--font-mono)', letterSpacing: '3px', zIndex: 10 }}>
        BY ARTHASTRA INNOVATIONS PVT LTD
      </motion.p>
    </div>
  )
}
