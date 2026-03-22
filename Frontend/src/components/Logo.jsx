/* Lienzo Logo — geometric angular mark */
import lienzoLogo from '../assets/lienzo-logo.png'

export function LienzoLogoImage({ size = 48 }) {
  return <img src={lienzoLogo} alt="Lienzo" style={{ width: size, height: size, objectFit: 'contain' }} />
}

export function LienzoMark({ size = 40, color = 'var(--jade)' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer circle */}
      <circle cx="40" cy="40" r="37" stroke={color} strokeWidth="2.5" opacity="0.9" />
      <circle cx="40" cy="40" r="33" stroke={color} strokeWidth="0.5" opacity="0.3" />
      {/* Angular geometric mark — interlocking arrows/chevrons */}
      <path d="M28 52 L40 22 L46 38 L40 38 L52 52 L46 52 L40 40 L34 52 Z" fill={color} opacity="0.95" />
      <path d="M32 52 L40 28 L44 38" stroke={color} strokeWidth="1" fill="none" opacity="0.4" />
    </svg>
  )
}

export function LienzoLogo({ size = 28, showText = true }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <LienzoMark size={size} />
      {showText && (
        <span style={{
          fontFamily: 'var(--font-sans)',
          fontSize: size * 0.55,
          fontWeight: 800,
          letterSpacing: '3px',
          color: 'var(--text-primary)',
        }}>
          LIEN<span style={{ color: 'var(--jade)' }}>PAY</span>
        </span>
      )}
    </div>
  )
}

export function LienzoIcon({ size = 32 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.25,
      background: 'linear-gradient(135deg, var(--jade), #008F6B)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: '0 4px 16px rgba(0,212,161,0.15)',
    }}>
      <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 22 22" fill="none">
        <path d="M6 16L11 6L16 16" stroke="#050809" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M8 12.5H14" stroke="#050809" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    </div>
  )
}

export default LienzoLogo
