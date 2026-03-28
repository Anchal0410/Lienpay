import { motion } from 'framer-motion'
import useStore from '../store/useStore'
import { logout, getMe } from '../api/client'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

export default function Profile({ onSettings }) {
  const { user, creditAccount, clearAuth } = useStore()
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    const load = async () => {
      try { const res = await getMe(); setProfile(res.data) } catch(e) {}
    }
    load()
  }, [])

  const handleLogout = async () => {
    // Call backend to blacklist the JWT
    try { await logout() } catch (_) {}

    // Clear all localStorage and Zustand state
    clearAuth()

    // Force a full page reload — this is the only reliable way to
    // reset React's component tree and AnimatePresence state.
    // After reload, lp_token is gone so App.jsx shows <Auth />.
    window.location.href = '/'
  }

  const items = [
    { icon: '📱', label: 'Mobile',       value: user?.mobile ? `+91 ${user.mobile}` : (profile?.mobile ? `+91 ${profile.mobile}` : '—') },
    { icon: '💳', label: 'UPI ID',       value: creditAccount?.upi_vpa || '—' },
    { icon: '🏦', label: 'PSP Bank',     value: creditAccount?.psp_bank || '—' },
    { icon: '💰', label: 'Credit Limit', value: creditAccount?.credit_limit ? `₹${parseFloat(creditAccount.credit_limit).toLocaleString('en-IN')}` : '—' },
    { icon: '📊', label: 'Monthly Rate', value: creditAccount?.apr ? `${(parseFloat(creditAccount.apr)/12).toFixed(2)}%/month` : '—' },
  ]

  return (
    <div className="screen">
      <div style={{ padding: '20px 20px 0' }}>

        {/* Avatar + name */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28, paddingTop: 8 }}>
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
            style={{ width: 76, height: 76, borderRadius: 24,
              background: 'linear-gradient(135deg, var(--jade-dim), rgba(201,164,73,0.1))',
              border: '1.5px solid var(--border-jade)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, fontFamily: 'var(--font-display)', color: 'var(--jade)', marginBottom: 14 }}>
            {(profile?.full_name || user?.full_name || '')[0]?.toUpperCase() || '👤'}
          </motion.div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 400, marginBottom: 4 }}>
            {profile?.full_name || user?.full_name || 'User'}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {profile?.mobile ? `+91 ${profile.mobile}` : '—'}
          </p>
        </motion.div>

        {/* Account details */}
        <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10 }}>ACCOUNT</p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', marginBottom: 20 }}>
          {items.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '14px 18px',
              borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontSize: 16, marginRight: 14, width: 24 }}>{item.icon}</span>
              <p style={{ flex: 1, fontSize: 14, color: 'var(--text-secondary)' }}>{item.label}</p>
              <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', maxWidth: 160, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {item.value}
              </p>
            </div>
          ))}
        </motion.div>

        {/* Settings */}
        <motion.button whileTap={{ scale: 0.97 }} onClick={onSettings}
          style={{ width: '100%', height: 52, borderRadius: 16, background: 'var(--bg-surface)',
            border: '1px solid var(--border)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 600,
            fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 10, marginBottom: 12, cursor: 'pointer' }}>
          <span style={{ fontSize: 18 }}>⚙️</span>
          Settings & Legal
        </motion.button>

        {/* Logout */}
        <motion.button whileTap={{ scale: 0.97 }} onClick={handleLogout}
          style={{ width: '100%', height: 52, borderRadius: 16, background: 'rgba(239,68,68,0.07)',
            border: '1px solid rgba(239,68,68,0.18)', color: '#EF4444', fontSize: 14, fontWeight: 700,
            fontFamily: 'var(--font-sans)', marginBottom: 16, cursor: 'pointer' }}>
          Log Out
        </motion.button>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          LienPay v1.0 • Arthastra Innovations Pvt Ltd
        </p>

      </div>
    </div>
  )
}
