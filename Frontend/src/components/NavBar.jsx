import { motion } from 'framer-motion'
import useStore from '../store/useStore'

const NAV_BG = 'rgba(5,8,9,0.98)'

const tabs = [
  {
    id: 'home', label: 'Home',
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke={a ? 'var(--jade)' : 'var(--text-muted)'} strokeWidth="1.8">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
        <polyline points="9 22 9 12 15 12 15 22"/>
      </svg>
    ),
  },
  {
    id: 'portfolio', label: 'Portfolio',
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke={a ? 'var(--jade)' : 'var(--text-muted)'} strokeWidth="1.8">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
    ),
  },
  {
    id: 'billing', label: 'Billing',
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke={a ? 'var(--jade)' : 'var(--text-muted)'} strokeWidth="1.8">
        <rect x="1" y="4" width="22" height="16" rx="2"/>
        <line x1="1" y1="10" x2="23" y2="10"/>
      </svg>
    ),
  },
  {
    id: 'profile', label: 'Profile',
    icon: (a) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke={a ? 'var(--jade)' : 'var(--text-muted)'} strokeWidth="1.8">
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
        <circle cx="12" cy="7" r="4"/>
      </svg>
    ),
  },
]

export default function NavBar() {
  const { activeTab, setActiveTab } = useStore()

  return (
    /*
      THE FIX:
      - background is on the OUTER wrapper, not inner
      - outer wrapper has no padding (we removed it from CSS too)
      - inner content div has the tab buttons
      - a dedicated fill div at the bottom covers safe-area-inset-bottom
      - nothing can show through because every pixel has a background
      - position: fixed with willChange: transform prevents scroll repaints
    */
    <div
      className="bottom-nav"
      style={{
        background: NAV_BG,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderTop: '1px solid var(--border)',
        willChange: 'transform',   // prevents GPU compositing flicker on scroll
      }}
    >
      {/* Tab buttons row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        paddingTop: 8,
        paddingBottom: 6,
        background: NAV_BG,
      }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                padding: '4px 0',
                position: 'relative',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {isActive && (
                <motion.div
                  layoutId="nav-indicator"
                  style={{
                    position: 'absolute', top: 0,
                    width: 20, height: 2,
                    background: 'var(--jade)',
                    borderRadius: 1,
                  }}
                />
              )}
              {tab.icon(isActive)}
              <span style={{
                fontSize: 9,
                color: isActive ? 'var(--jade)' : 'var(--text-muted)',
                fontWeight: isActive ? 600 : 400,
                transition: 'color 0.2s',
                letterSpacing: '0.3px',
                fontFamily: 'var(--font-mono)',
              }}>
                {tab.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Safe-area fill — same background so home indicator area is solid */}
      <div style={{
        height: 'env(safe-area-inset-bottom, 0px)',
        background: NAV_BG,
        flexShrink: 0,
      }} />
    </div>
  )
}
