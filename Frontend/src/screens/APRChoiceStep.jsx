// ─────────────────────────────────────────────────────────────
// APR PRODUCT CHOICE — Onboarding patch
//
// Add this step BETWEEN pledge confirmation and credit activation
// in your existing Onboarding.jsx.
//
// HOW TO INTEGRATE:
//   1. Import this component into Onboarding.jsx
//   2. Add 'APR_CHOICE' to your STEPS array after 'PLEDGE':
//      { id: 'APR_CHOICE', title: 'Choose Your Plan', icon: '💳', sub: 'Pick how you repay' }
//   3. After pledge is confirmed (handleConfirmPledges), navigate to APR_CHOICE
//   4. After APR choice is confirmed, call setAprChoice and proceed to CREDIT step
//
// The selected choice is stored in:
//   - Local state (passed to credit activation)
//   - Backend via POST /api/users/apr-product (update users.apr_product_choice)
//
// ─────────────────────────────────────────────────────────────

import { useState } from 'react'
import { motion } from 'framer-motion'
import toast from 'react-hot-toast'
// POST /api/users/apr-product directly
const postAprProduct = (data) => fetch(
  (import.meta.env.VITE_API_URL || 'https://lienpay-production.up.railway.app') + '/api/users/apr-product',
  { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${localStorage.getItem('lp_token')}`}, body:JSON.stringify(data) }
).then(r=>r.json())

export default function APRChoiceStep({ onChoose, creditLimit }) {
  const [selected, setSelected] = useState(null)
  const [loading, setLoading]   = useState(false)

  const fmtL = (n) => {
    const v = parseFloat(n || 0)
    return v >= 100000 ? `₹${(v / 100000).toFixed(2)}L` : `₹${v.toLocaleString('en-IN')}`
  }

  const plans = [
    {
      id:    'STANDARD',
      label: 'Standard',
      apr:   '12% p.a.',
      badge: '0% for 30 days',
      badgeColor: 'var(--jade)',
      desc:  `Get 30 days interest-free on every payment. Pay back within 30 days → no interest. After 30 days, 12% p.a. on outstanding.`,
      bestFor: 'Best for: Regular payers who clear dues monthly',
      icon:  '🟢',
    },
    {
      id:    'INTEREST_ONLY',
      label: 'Interest-Only',
      apr:   '18% p.a.',
      badge: 'Pay whenever',
      badgeColor: 'var(--amber)',
      desc:  `Pay just the interest each month — as low as 1.5%/mo. Repay the principal whenever you have the money. No pressure, no deadlines.`,
      bestFor: 'Best for: Business owners or anyone who needs flexible repayment',
      icon:  '🔄',
    },
  ]

  const handleConfirm = async () => {
    if (!selected) return toast.error('Please select a plan')
    setLoading(true)
    try {
      await postAprProduct({ apr_product: selected })
      onChoose(selected)
    } catch (err) {
      // Non-blocking — even if this fails, we pass choice locally
      onChoose(selected)
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
    >
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>
        You have {fmtL(creditLimit)} available. Choose how you want to use and repay your credit line.
      </p>

      {plans.map((plan) => (
        <motion.button
          key={plan.id}
          whileTap={{ scale: 0.97 }}
          onClick={() => setSelected(plan.id)}
          style={{
            width: '100%', textAlign: 'left',
            background: selected === plan.id ? 'var(--bg-elevated)' : 'var(--bg-surface)',
            border: selected === plan.id ? `2px solid ${plan.id === 'STANDARD' ? 'var(--jade)' : 'var(--amber)'}` : '2px solid var(--border)',
            borderRadius: 18, padding: '16px 18px', marginBottom: 12,
            transition: 'border-color 0.2s',
          }}
        >
          {/* Header row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ fontSize: 22 }}>{plan.icon}</span>
              <div>
                <p style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 17, fontWeight: 800,
                  color: selected === plan.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}>
                  {plan.label}
                </p>
                <p style={{
                  fontFamily: 'var(--font-mono)', fontSize: 13,
                  fontWeight: 700, color: plan.id === 'STANDARD' ? 'var(--jade)' : 'var(--amber)',
                }}>
                  {plan.apr}
                </p>
              </div>
            </div>
            {/* Badge */}
            <div style={{
              background: `${plan.badgeColor}15`,
              border: `1px solid ${plan.badgeColor}30`,
              borderRadius: 8, padding: '3px 8px',
            }}>
              <p style={{
                fontFamily: 'var(--font-mono)', fontSize: 10,
                fontWeight: 700, color: plan.badgeColor,
              }}>
                {plan.badge}
              </p>
            </div>
          </div>

          {/* Description */}
          <p style={{
            fontSize: 13, color: 'var(--text-secondary)',
            lineHeight: 1.5, marginBottom: 8,
          }}>
            {plan.desc}
          </p>

          {/* Best for */}
          <p style={{
            fontFamily: 'var(--font-mono)', fontSize: 10,
            color: plan.id === 'STANDARD' ? 'var(--jade)' : 'var(--amber)',
            letterSpacing: '0.5px',
          }}>
            {plan.bestFor}
          </p>

          {/* Example calculation */}
          <div style={{
            marginTop: 10, padding: '8px 10px',
            background: 'var(--bg-card)', borderRadius: 10,
            borderTop: `2px solid ${plan.badgeColor}20`,
          }}>
            {plan.id === 'STANDARD' ? (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Example: Spend ₹10,000. Pay within 30 days → ₹0 interest.
                Pay on day 45 → interest on 15 days only = ₹49.
              </p>
            ) : (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Example: Use ₹1L. Pay ₹1,500/month in interest.
                Pay back principal whenever — in 3 months or 3 years. No penalty.
              </p>
            )}
          </div>
        </motion.button>
      ))}

      {/* Note */}
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '10px 14px', marginBottom: 20,
      }}>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          ℹ Your choice affects the interest structure. Both products use the same credit limit.
          You can switch products when you renew your credit line annually.
        </p>
      </div>

      {/* CTA */}
      <motion.button
        className="btn-primary"
        whileTap={{ scale: 0.97 }}
        onClick={handleConfirm}
        disabled={loading || !selected}
      >
        {loading ? 'Confirming…' : 'Confirm & Continue →'}
      </motion.button>
    </motion.div>
  )
}
