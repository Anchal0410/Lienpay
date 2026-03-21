import { useRef, useEffect } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'

export default function CreditCard3D({ creditLimit, available, vpa, tier }) {
  const cardRef  = useRef(null)
  const mouseX   = useMotionValue(0)
  const mouseY   = useMotionValue(0)

  const springX  = useSpring(mouseX, { stiffness: 150, damping: 20 })
  const springY  = useSpring(mouseY, { stiffness: 150, damping: 20 })

  const rotateX  = useTransform(springY, [-0.5, 0.5], ['12deg', '-12deg'])
  const rotateY  = useTransform(springX, [-0.5, 0.5], ['-12deg', '12deg'])
  const glareX   = useTransform(springX, [-0.5, 0.5], ['0%', '100%'])
  const glareY   = useTransform(springY, [-0.5, 0.5], ['0%', '100%'])

  const handleMouseMove = (e) => {
    if (!cardRef.current) return
    const rect = cardRef.current.getBoundingClientRect()
    const x    = (e.clientX - rect.left) / rect.width  - 0.5
    const y    = (e.clientY - rect.top)  / rect.height - 0.5
    mouseX.set(x)
    mouseY.set(y)
  }

  const handleMouseLeave = () => {
    mouseX.set(0)
    mouseY.set(0)
  }

  const utilised   = creditLimit - available
  const usedPct    = creditLimit > 0 ? (utilised / creditLimit) * 100 : 0
  const vpaDisplay = vpa || '---- ---- ----'

  return (
    <div
      ref={cardRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ perspective: '1000px', cursor: 'default' }}
    >
      <motion.div
        style={{
          rotateX, rotateY,
          transformStyle: 'preserve-3d',
          width: '100%',
          aspectRatio: '1.586',
          borderRadius: 20,
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #0D1F1A 0%, #0A1510 40%, #0D0D0D 100%)',
          border: '1px solid rgba(0,200,150,0.2)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(0,200,150,0.08)',
        }}
      >
        {/* Grid lines */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: `
            linear-gradient(rgba(0,200,150,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,200,150,0.04) 1px, transparent 1px)
          `,
          backgroundSize: '40px 40px',
        }} />

        {/* Glow orb */}
        <div style={{
          position: 'absolute', top: -40, right: -40,
          width: 160, height: 160,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,200,150,0.15) 0%, transparent 70%)',
        }} />

        {/* Glare effect */}
        <motion.div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(circle at ${glareX} ${glareY}, rgba(255,255,255,0.06) 0%, transparent 60%)`,
          pointerEvents: 'none',
        }} />

        {/* Content */}
        <div style={{
          position: 'relative', zIndex: 1,
          padding: '20px 22px',
          height: '100%',
          display: 'flex', flexDirection: 'column',
          justifyContent: 'space-between',
        }}>
          {/* Top row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <p style={{
                fontFamily: 'var(--font-serif)',
                fontSize: 20,
                color: 'var(--text-primary)',
                letterSpacing: '-0.5px',
              }}>
                Lien<span style={{ color: 'var(--jade)' }}>Pay</span>
              </p>
              <p style={{
                fontSize: 9,
                color: 'var(--text-muted)',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                marginTop: 2,
              }}>
                Wealth Credit
              </p>
            </div>

            {/* Tier badge */}
            <div style={{
              padding: '3px 10px',
              borderRadius: 20,
              background: tier === 'A'
                ? 'linear-gradient(135deg, var(--gold), #8B6914)'
                : 'var(--bg-elevated)',
              border: '1px solid rgba(201,164,73,0.3)',
            }}>
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '1px',
                color: tier === 'A' ? 'var(--gold)' : 'var(--text-secondary)',
              }}>
                TIER {tier || 'B'}
              </span>
            </div>
          </div>

          {/* Middle - chip + limit */}
          <div>
            {/* Chip */}
            <div style={{
              width: 32, height: 24,
              borderRadius: 4,
              background: 'linear-gradient(135deg, var(--gold), #8B6914)',
              marginBottom: 14,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gridTemplateRows: '1fr 1fr 1fr',
              gap: 1.5,
              padding: 4,
              opacity: 0.8,
            }}>
              {[...Array(6)].map((_, i) => (
                <div key={i} style={{
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: 1,
                }} />
              ))}
            </div>

            {/* Credit limit */}
            <p style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              letterSpacing: '0.5px',
              marginBottom: 2,
            }}>
              CREDIT LIMIT
            </p>
            <p style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 26,
              color: 'var(--text-primary)',
              letterSpacing: '-0.5px',
            }}>
              ₹{(creditLimit || 0).toLocaleString('en-IN')}
            </p>
          </div>

          {/* Bottom row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <div>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>UPI ID</p>
              <p style={{
                fontSize: 12,
                color: 'var(--jade)',
                letterSpacing: '0.5px',
                fontWeight: 500,
              }}>
                {vpaDisplay}
              </p>
            </div>

            {/* Usage indicator */}
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>USED</p>
              <div style={{
                width: 60, height: 3,
                background: 'rgba(255,255,255,0.1)',
                borderRadius: 2,
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${usedPct}%`,
                  background: usedPct > 80
                    ? 'linear-gradient(90deg, #FF6B6B, #FF4444)'
                    : 'linear-gradient(90deg, var(--jade), #00A878)',
                  borderRadius: 2,
                  transition: 'width 0.8s ease',
                }} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3 }}>
                {usedPct.toFixed(0)}%
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
