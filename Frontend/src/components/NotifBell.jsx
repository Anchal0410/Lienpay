import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'

const PREF_KEY = 'lp_notif_prefs'
const DEFAULT_PREFS = {
  margin_calls: true, ltv_warnings: true,
  repayment_reminders: true, nav_drops: false, credit_activity: true,
}
const MOCK_NOTIFS = [
  { id: 'n1', type: 'ltv_warnings', icon: '⚡', color: '#E0A030', title: 'LTV at 82% — Approaching Limit', body: 'Portfolio collateral dropped. Add funds or repay to avoid a margin call.', ts: Date.now() - 2 * 3600000, read: false },
  { id: 'n2', type: 'repayment_reminders', icon: '💳', color: '#00D4A1', title: 'Interest Due in 3 Days', body: '₹1,240 interest payment due on Apr 1. Auto-debit is set up.', ts: Date.now() - 5 * 3600000, read: false },
  { id: 'n3', type: 'credit_activity', icon: '↗', color: '#4DA8FF', title: 'Payment of ₹8,500 Processed', body: 'UPI payment to Swiggy via LienPay credit line.', ts: Date.now() - 22 * 3600000, read: true },
]
const PREF_CONFIG = [
  { key: 'margin_calls', icon: '🔴', label: 'Margin Call Alerts', sub: 'LTV > 90% — immediate action needed', critical: true },
  { key: 'ltv_warnings', icon: '⚡', label: 'LTV Warnings', sub: 'When collateral drops near threshold' },
  { key: 'repayment_reminders', icon: '💳', label: 'Repayment Reminders', sub: 'Due dates, overdue, auto-debit alerts' },
  { key: 'nav_drops', icon: '📉', label: 'NAV Movement', sub: 'Daily fund value updates and drops' },
  { key: 'credit_activity', icon: '↗', label: 'Credit Line Activity', sub: 'Transactions and limit changes' },
]
const fmtAge = ts => { const m = Math.floor((Date.now()-ts)/60000); if(m<60) return `${m}m ago`; const h=Math.floor(m/60); return h<24?`${h}h ago`:`${Math.floor(h/24)}d ago` }

export default function NotifBell({ ltvStatus }) {
  const [open, setOpen]   = useState(false)
  const [prefs, setPrefs] = useState(DEFAULT_PREFS)
  const [notifs, setNotifs] = useState(MOCK_NOTIFS)
  const [tab, setTab]     = useState('notifications')

  useEffect(() => {
    try { const s = localStorage.getItem(PREF_KEY); if(s) setPrefs({...DEFAULT_PREFS,...JSON.parse(s)}) } catch {}
  }, [])

  useEffect(() => {
    // Prevent body scroll when sheet is open
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const savePrefs = next => { setPrefs(next); try { localStorage.setItem(PREF_KEY, JSON.stringify(next)) } catch {} }
  const togglePref = async key => {
    if (!prefs[key] && Notification?.permission === 'default') await Notification.requestPermission()
    savePrefs({ ...prefs, [key]: !prefs[key] })
  }
  const markAllRead = () => setNotifs(n => n.map(x => ({...x, read:true})))

  const unread = notifs.filter(n => !n.read && prefs[n.type]).length
  const showBadge = unread > 0 || ltvStatus === 'RED' || ltvStatus === 'AMBER'
  const badgeColor = ltvStatus === 'RED' ? '#E05252' : ltvStatus === 'AMBER' ? '#E0A030' : '#00D4A1'

  const overlay = (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div key="bd"
            initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} transition={{duration:0.2}}
            onClick={() => setOpen(false)}
            style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(5,8,9,0.78)', backdropFilter:'blur(4px)' }}
          />

          {/* ── BOTTOM SHEET ──────────────────────────────────────────
              THE FIX:
              1. overflow:'hidden' on the sheet — clips overflowing children
              2. minHeight:0 on the scrollable div — lets flex child shrink
                 so the parent can respect its maxHeight
              Without these, flex children ignore maxHeight and push the
              sheet taller than the screen, spilling content off the top.
          ─────────────────────────────────────────────────────────── */}
          <motion.div key="sheet"
            initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}}
            transition={{type:'spring', damping:30, stiffness:360}}
            style={{
              position: 'fixed',
              bottom: 0, left: 0, right: 0,
              zIndex: 9999,
              maxHeight: '78vh',       // cap height
              overflow: 'hidden',      // FIX 1: clip overflowing children
              display: 'flex',
              flexDirection: 'column',
              background: '#0C1014',
              borderTop: '1px solid rgba(0,212,161,0.10)',
              borderRadius: '24px 24px 0 0',
              paddingBottom: 'env(safe-area-inset-bottom, 12px)',
            }}
          >
            {/* Drag handle — fixed height */}
            <div style={{display:'flex',justifyContent:'center',padding:'12px 0 4px',flexShrink:0}}>
              <div style={{width:36,height:4,borderRadius:2,background:'#12181D'}}/>
            </div>

            {/* Header — fixed height */}
            <div style={{padding:'6px 22px 10px',display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
              <div>
                <h2 style={{fontFamily:'var(--font-display)',fontSize:22,fontWeight:400,color:'#E8F0EC'}}>Notifications</h2>
                {unread > 0 && <p style={{fontSize:11,color:'#3A4A44',marginTop:2,fontFamily:'var(--font-mono)'}}>{unread} UNREAD</p>}
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                {tab==='notifications' && unread>0 && (
                  <button onClick={markAllRead} style={{fontSize:11,color:'#00D4A1',fontWeight:600,background:'none',border:'none',cursor:'pointer',fontFamily:'var(--font-sans)'}}>
                    Mark all read
                  </button>
                )}
                <button onClick={()=>setOpen(false)}
                  style={{width:30,height:30,borderRadius:8,background:'#12181D',border:'none',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7A8F85" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Tabs — fixed height */}
            <div style={{display:'flex',padding:'0 22px',marginBottom:4,gap:4,flexShrink:0}}>
              {['notifications','settings'].map(t => (
                <button key={t} onClick={()=>setTab(t)} style={{
                  flex:1, height:34, borderRadius:8, fontSize:12, fontWeight:600,
                  fontFamily:'var(--font-sans)', cursor:'pointer',
                  background: tab===t ? 'rgba(0,212,161,0.08)' : 'transparent',
                  border: tab===t ? '1px solid rgba(0,212,161,0.16)' : '1px solid transparent',
                  color: tab===t ? '#00D4A1' : '#3A4A44', transition:'all 0.2s', textTransform:'capitalize',
                }}>{t}</button>
              ))}
            </div>

            {/* Scrollable content — FIX 2: minHeight:0 lets this shrink */}
            <div style={{flex:1, overflowY:'auto', minHeight:0, padding:'4px 22px 20px'}}>

              {tab === 'notifications' && (
                <div>
                  {notifs.map(n => {
                    if (!prefs[n.type]) return null
                    return (
                      <div key={n.id} style={{display:'flex',gap:12,padding:'13px 0',borderBottom:'1px solid rgba(0,212,161,0.06)',opacity:n.read?0.5:1}}>
                        <div style={{width:40,height:40,borderRadius:12,flexShrink:0,background:`${n.color}12`,border:`1px solid ${n.color}20`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15}}>
                          {n.icon}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                            <p style={{fontSize:13,fontWeight:n.read?400:600,color:'#E8F0EC',lineHeight:1.3,flex:1}}>{n.title}</p>
                            {!n.read && <div style={{width:6,height:6,borderRadius:'50%',background:n.color,flexShrink:0,marginTop:3,marginLeft:8}}/>}
                          </div>
                          <p style={{fontSize:12,color:'#7A8F85',lineHeight:1.5,marginBottom:4}}>{n.body}</p>
                          <p style={{fontSize:10,color:'#3A4A44',fontFamily:'var(--font-mono)'}}>{fmtAge(n.ts)}</p>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {tab === 'settings' && (
                <div>
                  {Notification?.permission !== 'granted' && (
                    <div style={{background:'rgba(0,212,161,0.08)',border:'1px solid rgba(0,212,161,0.16)',borderRadius:14,padding:'12px 14px',marginBottom:14,display:'flex',gap:10}}>
                      <span style={{fontSize:18,flexShrink:0}}>🔔</span>
                      <div>
                        <p style={{fontSize:13,fontWeight:600,color:'#00D4A1',marginBottom:3}}>Enable push notifications</p>
                        <p style={{fontSize:12,color:'#7A8F85',lineHeight:1.5}}>Real-time alerts for margin calls and repayments.</p>
                        <button onClick={()=>Notification?.requestPermission()}
                          style={{marginTop:10,padding:'7px 16px',borderRadius:8,fontSize:12,fontWeight:700,background:'#00D4A1',color:'#050809',border:'none',cursor:'pointer'}}>
                          Allow Notifications
                        </button>
                      </div>
                    </div>
                  )}
                  {PREF_CONFIG.map(p => (
                    <div key={p.key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'13px 0',borderBottom:'1px solid rgba(0,212,161,0.06)'}}>
                      <div style={{display:'flex',gap:11,alignItems:'center',flex:1}}>
                        <div style={{width:36,height:36,borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,background:prefs[p.key]?'rgba(0,212,161,0.08)':'#12181D',border:prefs[p.key]?'1px solid rgba(0,212,161,0.16)':'1px solid rgba(0,212,161,0.06)',transition:'all 0.2s'}}>
                          {p.icon}
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <span style={{fontSize:13,fontWeight:500,color:'#E8F0EC'}}>{p.label}</span>
                            {p.critical && <span style={{fontSize:8,padding:'2px 6px',borderRadius:4,background:'rgba(224,82,82,0.10)',color:'#E05252',fontFamily:'var(--font-mono)',fontWeight:600}}>CRITICAL</span>}
                          </div>
                          <p style={{fontSize:11,color:'#3A4A44',marginTop:2,lineHeight:1.4}}>{p.sub}</p>
                        </div>
                      </div>
                      <button onClick={()=>togglePref(p.key)} style={{width:46,height:26,borderRadius:13,flexShrink:0,position:'relative',cursor:'pointer',background:prefs[p.key]?'#00D4A1':'#12181D',border:prefs[p.key]?'none':'1px solid rgba(0,212,161,0.10)',transition:'background 0.25s'}}>
                        <motion.div animate={{x:prefs[p.key]?22:2}} transition={{type:'spring',damping:18,stiffness:300}}
                          style={{position:'absolute',top:2,width:20,height:20,borderRadius:'50%',background:prefs[p.key]?'#050809':'#3A4A44'}}/>
                      </button>
                    </div>
                  ))}
                  <p style={{fontSize:10,color:'#3A4A44',marginTop:16,lineHeight:1.6,fontFamily:'var(--font-mono)'}}>CRITICAL alerts are recommended at all times.</p>
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  return (
    <>
      <motion.button whileTap={{scale:0.88}} onClick={()=>{setOpen(true);setTab('notifications')}}
        style={{width:38,height:38,borderRadius:12,background:'var(--bg-surface)',border:'1px solid var(--border-light)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',position:'relative'}}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <AnimatePresence>
          {showBadge && (
            <motion.div key="badge" initial={{scale:0}} animate={{scale:1}} exit={{scale:0}}
              style={{position:'absolute',top:7,right:7,width:8,height:8,borderRadius:'50%',background:badgeColor,border:'1.5px solid var(--bg-void)'}}/>
          )}
        </AnimatePresence>
      </motion.button>
      {typeof document !== 'undefined' && createPortal(overlay, document.body)}
    </>
  )
}
