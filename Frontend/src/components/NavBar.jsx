import { motion } from 'framer-motion'
import useStore from '../store/useStore'

const tabs = [
  { id: 'home',      label: 'Home',      icon: (a) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={a?'var(--jade)':'var(--text-muted)'} strokeWidth="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
  { id: 'portfolio', label: 'Portfolio', icon: (a) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={a?'var(--jade)':'var(--text-muted)'} strokeWidth="1.8"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg> },
  { id: 'billing',   label: 'Billing',   icon: (a) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={a?'var(--jade)':'var(--text-muted)'} strokeWidth="1.8"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> },
  { id: 'profile',   label: 'Profile',   icon: (a) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={a?'var(--jade)':'var(--text-muted)'} strokeWidth="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> },
]

export default function NavBar() {
  const { activeTab, setActiveTab } = useStore()

  return (
    <div className="bottom-nav">
      {/*
        FIX: background must be on the OUTER wrapper, not just the inner content div.
        The outer .bottom-nav has padding-bottom: safe-area-inset-bottom — if the
        background is only on the inner div, you see the page through that padding gap.
      */}
      <div style={{
        background: 'rgba(5,8,9,0.97)',      // ← outer bg fills safe area gap
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid var(--border)',
      }}>
        {/* Content row */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          paddingTop: 8,
          paddingBottom: 6,
        }}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 3,
                  padding: '4px 0',
                  position: 'relative',
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

        {/* Safe area fill — explicit bg so no gap shows on devices with home indicator */}
        <div style={{
          height: 'env(safe-area-inset-bottom, 0px)',
          background: 'rgba(5,8,9,0.97)',
          minHeight: 0,
        }} />
      </div>
    </div>
  )
}
