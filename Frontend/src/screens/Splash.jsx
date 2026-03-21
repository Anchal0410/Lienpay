import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

export default function Splash({ onComplete }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight

    // Particle system
    const particles = Array.from({ length: 60 }, () => ({
      x:    Math.random() * canvas.width,
      y:    Math.random() * canvas.height,
      vx:   (Math.random() - 0.5) * 0.4,
      vy:   (Math.random() - 0.5) * 0.4,
      r:    Math.random() * 1.5 + 0.5,
      o:    Math.random() * 0.4 + 0.1,
      jade: Math.random() > 0.6,
    }))

    let raf
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy
        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = p.jade
          ? `rgba(0,200,150,${p.o})`
          : `rgba(201,164,73,${p.o * 0.5})`
        ctx.fill()
      })

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const d  = Math.sqrt(dx * dx + dy * dy)
          if (d < 80) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(0,200,150,${0.08 * (1 - d/80)})`
            ctx.lineWidth   = 0.5
            ctx.stroke()
          }
        }
      }

      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const timer = setTimeout(onComplete, 3200)
    return () => clearTimeout(timer)
  }, [onComplete])

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'var(--bg-base)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
    }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0 }} />

      <motion.div
        initial={{ opacity: 0, scale: 0.8, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        style={{ position: 'relative', textAlign: 'center' }}
      >
        {/* Logo mark */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          style={{
            width: 72, height: 72,
            margin: '0 auto 24px',
            position: 'relative',
          }}
        >
          <svg viewBox="0 0 72 72" fill="none">
            <circle cx="36" cy="36" r="34" stroke="#00C896" strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
            <circle cx="36" cy="36" r="24" stroke="#C9A449" strokeWidth="0.5" opacity="0.3" />
            <path d="M36 14 L42 28 L36 24 L30 28 Z" fill="#00C896" />
            <path d="M36 58 L30 44 L36 48 L42 44 Z" fill="#00C896" opacity="0.4" />
            <circle cx="36" cy="36" r="6" fill="#00C896" />
            <circle cx="36" cy="36" r="3" fill="#0A0A0F" />
          </svg>
        </motion.div>

        {/* Wordmark */}
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.6 }}
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: 42,
            fontWeight: 400,
            letterSpacing: '-1px',
            color: 'var(--text-primary)',
            marginBottom: 8,
          }}
        >
          Lien<span style={{ color: 'var(--jade)' }}>Pay</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6, duration: 0.6 }}
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            letterSpacing: '3px',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
          }}
        >
          Wealth-Backed Payments
        </motion.p>
      </motion.div>

      {/* Loading bar */}
      <motion.div
        style={{
          position: 'absolute', bottom: 60,
          width: 120, height: 1,
          background: 'var(--bg-elevated)',
          borderRadius: 1,
          overflow: 'hidden',
        }}
      >
        <motion.div
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 2.8, ease: 'easeInOut' }}
          style={{
            height: '100%',
            background: 'linear-gradient(90deg, var(--jade), var(--gold))',
          }}
        />
      </motion.div>
    </div>
  )
}
