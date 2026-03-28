import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ─────────────────────────────────────────────────────────────
// LIENPAY NOTIFICATION BELL
// Drop into Dashboard.jsx header — replaces the empty <div>
//
// Usage:
//   import NotifBell from '../components/NotifBell'
//   <NotifBell ltvStatus={ltv?.status} />
//
// Prefs stored in localStorage under key 'lp_notif_prefs'
// ─────────────────────────────────────────────────────────────

const PREF_KEY = 'lp_notif_prefs'

const DEFAULT_PREFS = {
  margin_calls:       true,   // LTV > 90% — margin call issued
  ltv_warnings:       true,   // LTV > 80% — amber zone
  repayment_reminders: true,  // due date / overdue alerts
  nav_drops:          false,  // daily NAV movement alerts
  credit_activity:    true,   // transactions on credit line
}

// Mock notifications — replace with real API call later
const MOCK_NOTIFS = [
  {
    id: 'n1',
    type: 'ltv_warning',
    icon: '⚡',
    color: '#E0A030',
    title: 'LTV at 82% — Approaching Limit',
    body: 'Your portfolio collateral has dropped. Add funds or repay to avoid a margin call.',
    ts: Date.now() - 2 * 60 * 60 * 1000,
    read: false,
    action: 'portfolio',
  },
  {
    id: 'n2',
    type: 'repayment_reminders',
    icon: '💳',
    color: '#00D4A1',
    title: 'Interest Due in 3 Days',
    body: '₹1,240 interest payment due on Apr 1. Auto-debit is set up.',
    ts: Date.now() - 5 * 60 * 60 * 1000,
    read: false,
    action: 'billing',
  },
  {
    id: 'n3',
    type: 'credit_activity',
    icon: '↗',
    color: '#4DA8FF',
    title: 'Payment of ₹8,500 Processed',
    body: 'UPI payment to Swiggy via LienPay credit line.',
    ts: Date.now() - 22 * 60 * 60 * 1000,
    read: true,
    action: null,
  },
]

const PREF_CONFIG = [
  {
    key: 'margin_calls',
    icon: '🔴',
    label: 'Margin Call Alerts',
    sub: 'LTV > 90% — immediate action needed',
    critical: true,
  },
  {
    key: 'ltv_warnings',
    icon: '⚡',
    label: 'LTV Warnings',
    sub: 'When collateral value drops near threshold',
    critical: false,
  },
  {
    key: 'repayment_reminders',
    icon: '💳',
    label: 'Repayment Reminders',
    sub: 'Due dates, overdue notices, auto-debit alerts',
    critical: false,
  },
  {
    key: 'nav_drops',
    icon: '📉',
    label: 'NAV Movement',
    sub: 'Daily fund value updates and drops',
    critical: false,
  },
  {
    key: 'credit_activity',
    icon: '↗',
    label: 'Credit Line Activity',
    sub: 'Transactions and limit changes',
    critical: false,
  },
]

const fmtAge = (ts) => {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotifBell({ ltvStatus }) {
  const [open, setOpen]     = useState(false)
  const [prefs, setPrefs]   = useState(DEFAULT_PREFS)
  const [notifs, setNotifs] = useState(MOCK_NOTIFS)
  const [tab, setTab]       = useState('notifications') // 'notifications' | 'settings'
  const [permGranted, setPermGranted] = useState(false)

  // Load saved prefs on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PREF_KEY)
      if (saved) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(saved) })
    } catch {}
    setPermGranted(Notification?.permission === 'granted')
  }, [])

  const savePrefs = (next) => {
    setPrefs(next)
    localStorage.setItem(PREF_KEY, JSON.stringify(next))
  }

  const togglePref = async (key) => {
    const next = { ...prefs, [key]: !prefs[key] }
    // If enabling any pref, request push permission
    if (!prefs[key] && Notification?.permission === 'default') {
      const result = await Notification.requestPermission()
      setPermGranted(result === 'granted')
    }
    savePrefs(next)
  }

  const markAllRead = () => {
    setNotifs(n => n.map(x => ({ ...x, read: true })))
  }

  const unread = notifs.filter(n => !n.read && prefs[n.type]).length
  // Badge logic: always show badge if LTV is amber/red, even if read
  const showBadge = unread > 0 || ltvStatus === 'RED' || ltvStatus === 'AMBER'
  const badgeColor = ltvStatus === 'RED' ? '#E05252' : '#E0A030'

  return (
    <>
      {/* ── Bell Button ──────────────────────────────────────── */}
      <motion.button
        whileTap={{ scale: 0.88 }}
        onClick={() => setOpen(true)}
        style={{
          position: 'relative',
          width: 38, height: 38,
          borderRadius: 12,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer',
        }}
        aria-label="Notifications"
      >
        <BellIcon />
        <AnimatePresence>
          {showBadge && (
            <motion.div
              key="badge"
              initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
              style={{
                position: 'absolute', top: 7, right: 7,
                width: 8, height: 8, borderRadius: '50%',
                background: ltvStatus === 'RED' || ltvStatus === 'AMBER' ? badgeColor : '#00D4A1',
                border: '1.5px solid var(--bg-void)',
              }}
            />
          )}
        </AnimatePresence>
      </motion.button>

      {/* ── Backdrop ─────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 90,
              background: 'rgba(5,8,9,0.7)',
              backdropFilter: 'blur(4px)',
            }}
          />
        )}
      </AnimatePresence>

      {/* ── Bottom Sheet ─────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="sheet"
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0,
              zIndex: 100,
              background: 'var(--bg-surface)',
              borderTop: '1px solid var(--border-light)',
              borderRadius: '24px 24px 0 0',
              maxHeight: '82vh',
              display: 'flex', flexDirection: 'column',
              paddingBottom: 'env(safe-area-inset-bottom, 16px)',
            }}
          >
            {/* Drag handle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--bg-elevated)' }} />
            </div>

            {/* Header */}
            <div style={{ padding: '8px 22px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400 }}>Notifications</h2>
                {unread > 0 && (
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
                    {unread} UNREAD
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {tab === 'notifications' && unread > 0 && (
                  <button onClick={markAllRead}
                    style={{ fontSize: 11, color: 'var(--jade)', fontWeight: 600, fontFamily: 'var(--font-sans)' }}>
                    Mark all read
                  </button>
                )}
                <button onClick={() => setOpen(false)}
                  style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-elevated)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <CloseIcon />
                </button>
              </div>
            </div>

            {/* Tab switcher */}
            <div style={{ display: 'flex', gap: 0, marginBottom: 4, padding: '0 22px' }}>
              {['notifications', 'settings'].map(t => (
                <button key={t} onClick={() => setTab(t)}
                  style={{
                    flex: 1, height: 34, borderRadius: 8, fontSize: 12, fontWeight: 600,
                    fontFamily: 'var(--font-sans)',
                    background: tab === t ? 'var(--jade-dim)' : 'transparent',
                    border: tab === t ? '1px solid var(--jade-border)' : '1px solid transparent',
                    color: tab === t ? 'var(--jade)' : 'var(--text-muted)',
                    transition: 'all 0.2s',
                    textTransform: 'capitalize',
                  }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '4px 22px 20px' }}>

              {/* ── NOTIFICATIONS TAB ── */}
              {tab === 'notifications' && (
                <div>
                  {notifs.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: 32, marginBottom: 12 }}>🔔</div>
                      <p style={{ fontSize: 13 }}>No notifications yet</p>
                    </div>
                  ) : (
                    notifs.map((n, i) => {
                      // Only show notifs for enabled pref types
                      if (!prefs[n.type]) return null
                      return (
                        <motion.div
                          key={n.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.05 }}
                          style={{
                            display: 'flex', gap: 12,
                            padding: '14px 0',
                            borderBottom: '1px solid var(--border)',
                            opacity: n.read ? 0.55 : 1,
                          }}
                        >
                          <div style={{
                            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
                            background: `${n.color}12`,
                            border: `1px solid ${n.color}20`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 16,
                          }}>
                            {n.icon}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 3 }}>
                              <p style={{ fontSize: 13, fontWeight: n.read ? 400 : 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                                {n.title}
                              </p>
                              {!n.read && (
                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: n.color, flexShrink: 0, marginTop: 3, marginLeft: 8 }} />
                              )}
                            </div>
                            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 6 }}>
                              {n.body}
                            </p>
                            <p style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                              {fmtAge(n.ts)}
                            </p>
                          </div>
                        </motion.div>
                      )
                    })
                  )}
                </div>
              )}

              {/* ── SETTINGS TAB ── */}
              {tab === 'settings' && (
                <div>
                  {/* Push permission banner */}
                  {!permGranted && (
                    <motion.div
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      style={{
                        background: 'var(--jade-dim)',
                        border: '1px solid var(--jade-border)',
                        borderRadius: 14, padding: '12px 14px', marginBottom: 16,
                        display: 'flex', gap: 10, alignItems: 'flex-start',
                      }}
                    >
                      <span style={{ fontSize: 18, flexShrink: 0 }}>🔔</span>
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--jade)', marginBottom: 3 }}>
                          Enable push notifications
                        </p>
                        <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                          Get real-time alerts for margin calls and repayments — even when the app is closed.
                        </p>
                        <button
                          onClick={async () => {
                            const r = await Notification?.requestPermission()
                            setPermGranted(r === 'granted')
                          }}
                          style={{
                            marginTop: 10, padding: '7px 16px',
                            borderRadius: 8, fontSize: 12, fontWeight: 700,
                            background: 'var(--jade)', color: 'var(--bg-void)',
                            fontFamily: 'var(--font-sans)',
                          }}
                        >
                          Allow Notifications
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* Pref toggles */}
                  {PREF_CONFIG.map((p, i) => (
                    <motion.div
                      key={p.key}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04 }}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '14px 0',
                        borderBottom: '1px solid var(--border)',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1 }}>
                        <div style={{
                          width: 38, height: 38, borderRadius: 10,
                          background: prefs[p.key] ? 'var(--jade-dim)' : 'var(--bg-elevated)',
                          border: `1px solid ${prefs[p.key] ? 'var(--jade-border)' : 'var(--border)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 16, transition: 'all 0.25s',
                        }}>
                          {p.icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                              {p.label}
                            </p>
                            {p.critical && (
                              <span style={{
                                fontSize: 8, padding: '2px 6px', borderRadius: 4,
                                background: 'rgba(224,82,82,0.1)', color: '#E05252',
                                fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.5px',
                              }}>
                                CRITICAL
                              </span>
                            )}
                          </div>
                          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>
                            {p.sub}
                          </p>
                        </div>
                      </div>
                      {/* Toggle */}
                      <button
                        onClick={() => togglePref(p.key)}
                        style={{
                          width: 46, height: 26, borderRadius: 13, flexShrink: 0,
                          background: prefs[p.key] ? 'var(--jade)' : 'var(--bg-elevated)',
                          border: `1px solid ${prefs[p.key] ? 'var(--jade)' : 'var(--border-light)'}`,
                          position: 'relative', cursor: 'pointer',
                          transition: 'background 0.25s, border 0.25s',
                        }}
                        aria-checked={prefs[p.key]}
                        role="switch"
                      >
                        <motion.div
                          animate={{ x: prefs[p.key] ? 20 : 2 }}
                          transition={{ type: 'spring', damping: 18, stiffness: 300 }}
                          style={{
                            position: 'absolute', top: 2,
                            width: 20, height: 20, borderRadius: '50%',
                            background: prefs[p.key] ? 'var(--bg-void)' : 'var(--text-muted)',
                          }}
                        />
                      </button>
                    </motion.div>
                  ))}

                  <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 16, lineHeight: 1.6, fontFamily: 'var(--font-mono)' }}>
                    CRITICAL alerts (margin calls) are recommended at all times. Disabling them may result in missed collateral breach notices.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ── Icons ─────────────────────────────────────────────────────
function BellIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
