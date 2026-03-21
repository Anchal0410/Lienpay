import { motion } from 'framer-motion'
import useStore from '../store/useStore'

const tabs = [
  { id: 'home',      icon: '⊞', label: 'Home' },
  { id: 'portfolio', icon: '◈', label: 'Portfolio' },
  { id: 'billing',   icon: '◎', label: 'Billing' },
  { id: 'profile',   icon: '○', label: 'Profile' },
]

export default function NavBar({ onPayTap }) {
  const { activeTab, setActiveTab } = useStore()

  return (
    <div className="bottom-nav">
      <div style={{
        background: 'rgba(17,17,24,0.9)',
        backdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        padding: '8px 0 4px',
        display: 'flex',
        alignItems: 'center',
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 3,
              padding: '6px 0',
              position: 'relative',
            }}
          >
            {activeTab === tab.id && (
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
            <span style={{
              fontSize: 18,
              opacity: activeTab === tab.id ? 1 : 0.35,
              transition: 'opacity 0.2s',
            }}>
              {tab.icon}
            </span>
            <span style={{
              fontSize: 10,
              color: activeTab === tab.id ? 'var(--jade)' : 'var(--text-muted)',
              fontWeight: activeTab === tab.id ? 600 : 400,
              transition: 'color 0.2s',
              letterSpacing: '0.3px',
            }}>
              {tab.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
