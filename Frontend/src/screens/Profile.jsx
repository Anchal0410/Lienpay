import { motion } from 'framer-motion'
import useStore from '../store/useStore'
import { logout, getMe } from '../api/client'
import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'

export default function Profile({ onSettings }) {
  const { user, creditAccount, riskDecision, clearAuth, setOnboardingStep } = useStore()
  const [profile, setProfile] = useState(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await getMe()
        setProfile(res.data)
      } catch(e) {}
    }
    load()
  }, [])

  const handleLogout = async () => {
    try { await logout() } catch (_) {}
    clearAuth()
    setOnboardingStep('AUTH')
    toast.success('Logged out')
  }

  // ── FIX: backend getMe already returns "+91 XXXXX12345" — don't re-prefix ──
  const displayMobile = profile?.mobile
    ? profile.mobile  // already has +91 from backend
    : user?.mobile
    ? `+91 ${user.mobile}`  // raw 10-digit from store — add prefix once
    : '—'

  const items = [
    { icon: '📱', label: 'Mobile',       value: displayMobile },
    { icon: '💳', label: 'UPI ID',       value: creditAccount?.upi_vpa || '—' },
    { icon: '🏦', label: 'PSP Bank',     value: creditAccount?.psp_bank || '—' },
    { icon: '💰', label: 'Credit Limit', value: creditAccount?.credit_limit ? `₹${parseFloat(creditAccount.credit_limit).toLocaleString('en-IN')}` : '—' },
    { icon: '📊', label: 'Monthly Rate', value: creditAccount?.apr ? `${(parseFloat(creditAccount.apr)/12).toFixed(2)}%/month` : '—' },
  ]

  const displayName = profile?.full_name || user?.full_name || 'User'
  const initials    = displayName[0]?.toUpperCase() || '👤'

  return (
    <div className="screen">
      <div style={{ padding: '20px 20px 0' }}>

        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 28, paddingTop: 8 }}>
          {/* Avatar */}
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200 }}
            style={{
              width: 76, height: 76, borderRadius: 24,
              background: 'linear-gradient(135deg, var(--jade-dim), rgba(201,164,73,0.1))',
              border: '1.5px solid var(--border-jade)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 28, fontFamily: 'var(--font-display)', color: 'var(--jade)',
              marginBottom: 14,
            }}>
            {initials}
          </motion.div>

          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 400, marginBottom: 4 }}>
            {displayName}
          </h2>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {displayMobile}
          </p>

          {/* KYC badge */}
          {profile?.kyc_status === 'COMPLETE' && (
            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '4px 12px', borderRadius: 10, background: 'var(--jade-dim)', border: '1px solid var(--jade-border)' }}>
              <span style={{ fontSize: 10 }}>✓</span>
              <span style={{ fontSize: 9, color: 'var(--jade)', fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '1px' }}>KYC VERIFIED</span>
            </motion.div>
          )}
        </motion.div>

        {/* Account details */}
        <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>ACCOUNT</p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', marginBottom: 24 }}>
          {items.map((item, i) => (
            <div key={item.label} style={{
              display: 'flex', alignItems: 'center', padding: '15px 18px',
              borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{ fontSize: 16, marginRight: 12, width: 22, textAlign: 'center' }}>{item.icon}</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{item.label}</p>
                <p style={{ fontSize: 13, fontWeight: 600, fontFamily: item.label === 'UPI ID' ? 'var(--font-mono)' : 'var(--font-sans)' }}>
                  {item.value}
                </p>
              </div>
            </div>
          ))}
        </motion.div>

        {/* Actions */}
        <p style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '2px', marginBottom: 10, fontFamily: 'var(--font-mono)' }}>ACTIONS</p>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 20, overflow: 'hidden', marginBottom: 24 }}>

          <motion.div whileTap={{ scale: 0.99 }} onClick={onSettings}
            style={{ display: 'flex', alignItems: 'center', padding: '16px 18px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
            <span style={{ fontSize: 16, marginRight: 12, width: 22, textAlign: 'center' }}>⚙️</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600 }}>Settings</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Notifications, documents, help</p>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 16 }}>›</span>
          </motion.div>

          <motion.div whileTap={{ scale: 0.99 }} onClick={handleLogout}
            style={{ display: 'flex', alignItems: 'center', padding: '16px 18px', cursor: 'pointer' }}>
            <span style={{ fontSize: 16, marginRight: 12, width: 22, textAlign: 'center' }}>🚪</span>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--red)' }}>Log Out</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sign out of this device</p>
            </div>
          </motion.div>
        </motion.div>

        {/* App version */}
        <p style={{ textAlign: 'center', fontSize: 10, color: 'var(--text-hint)', fontFamily: 'var(--font-mono)', marginBottom: 20 }}>
          LienPay v1.0 · Arthastra Innovations Pvt Ltd
        </p>

      </div>
    </div>
  )
}
