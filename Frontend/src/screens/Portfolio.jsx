import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getPortfolioSummary, getLTVHealth, getPledgeStatus, initiatePledge, confirmPledgeOTP, notifyNBFC } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const fC = (n) => `\u20b9${parseFloat(n||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`
const fL = (r) => {
  if (!r) return '-'
  if (typeof r === 'string' && r.includes('%')) return r
  const n = parseFloat(r)
  return n > 1 ? `${n.toFixed(0)}%` : `${(n*100).toFixed(0)}%`
}

const COLORS = {
  EQUITY_LARGE_CAP:'#3B82F6', EQUITY_LARGE_MID_CAP:'#06B6D4',
  EQUITY_MID_CAP:'#F59E0B',   EQUITY_SMALL_CAP:'#EF4444',
  EQUITY_FLEXI_CAP:'#8B5CF6', EQUITY_ELSS:'#8B5CF6',
  INDEX_FUND:'#F472B6',        ETF:'#F472B6',
  DEBT_LIQUID:'#22D3EE',       DEBT_SHORT_DUR:'#22D3EE',
  HYBRID_BALANCED:'#FB923C',
}
const sC = (t) => COLORS[t] || '#7A8F85'
const sL = (t) => (t||'').replace(/_/g,' ')

// Eye icons
const EyeOpen = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
)
const EyeClosed = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
)

export default function Portfolio() {
  const { portfolio, setPortfolio, ltvHealth, setLTVHealth, creditAccount } = useStore()
  const [loading,     setLoading]     = useState(true)
  const [pledges,     setPledges]     = useState([])
  const [pledgeModal, setPledgeModal] = useState(null)
  const [pledging,    setPledging]    = useState(false)
  const [showAdd,     setShowAdd]     = useState(false)
  const [search,      setSearch]      = useState('')
  // Privacy mode: hides monetary values, fund count, NAV. Only LTV stays visible.
  const [hidden,      setHidden]      = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [pR, lR, plR] = await Promise.all([
        getPortfolioSummary(),
        getLTVHealth().catch(() => ({ data: {} })),
        getPledgeStatus().catch(() => ({ data: { pledges: [] } })),
      ])
      setPortfolio(pR.data)
      setLTVHealth(lR.data)
      setPledges(plR.data?.pledges || [])
    } catch (_) {}
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  const holdings    = portfolio?.holdings || []
  const totalVal    = parseFloat(portfolio?.summary?.total_value || 0)
  const cLimit      = parseFloat(creditAccount?.credit_limit || 0)
  const outstanding = parseFloat(creditAccount?.outstanding || 0)
  const available   = parseFloat(creditAccount?.available_credit || Math.max(0, cLimit - outstanding) || 0)
  const ltvRatio    = parseFloat(ltvHealth?.ltv_ratio || 0)

  const pledgeMap = {}
  pledges.forEach(p => { pledgeMap[p.folio_number] = p })
  const isPledged = f => { const p = pledgeMap[f]; return p && p.status === 'ACTIVE' }

  const pledgedH   = holdings.filter(h => isPledged(h.folio_number))
  const unpledgedH = holdings.filter(h => !isPledged(h.folio_number))
  const filtered   = search.trim()
    ? unpledgedH.filter(h => (h.scheme_name||'').toLowerCase().includes(search.toLowerCase()) || (h.rta||'').toLowerCase().includes(search.toLowerCase()))
    : unpledgedH

  // Privacy masking helpers
  const maskVal = (val) => hidden ? '\u20b9 \u2022\u2022\u2022\u2022\u2022' : val
  const maskNum = () => hidden ? '\u2022\u2022\u2022\u2022' : ''

  const handlePledge = async (h) => {
    setPledging(true)
    try {
      const res = await initiatePledge([{ folio_number: h.folio_number }])
      const pl  = res.data.pledges?.[0]
      if (pl) {
        await confirmPledgeOTP(pl.pledge_id, pl.rta === 'CAMS' ? '123456' : '654321')
        await notifyNBFC([pl.pledge_id])
        toast.success(`${(h.scheme_name||'Fund').split(' ')[0]} pledged!`)
        await loadData()
        setPledgeModal(null)
        setShowAdd(false)
      }
    } catch (err) { toast.error(err.message || 'Pledge failed') }
    finally { setPledging(false) }
  }

  if (loading) return (
    <div className="screen" style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
      <motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:'linear'}}
        style={{width:32,height:32,border:'2px solid var(--bg-elevated)',borderTopColor:'var(--jade)',borderRadius:'50%'}}/>
    </div>
  )

  if (holdings.length === 0) return (
    <div className="screen">
      <div style={{padding:'16px 20px 0'}}>
        <h1 style={{fontFamily:'var(--font-display)',fontSize:28,fontWeight:400,marginBottom:4}}>Portfolio</h1>
        <p style={{fontSize:13,color:'var(--text-secondary)',marginBottom:24}}>Your collateral health</p>
        <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:18,padding:'48px 24px',textAlign:'center'}}>
          <p style={{fontSize:40,marginBottom:12}}>📊</p>
          <p style={{fontSize:15,fontWeight:600,color:'var(--text-secondary)',marginBottom:8}}>Portfolio not linked</p>
          <p style={{fontSize:13,color:'var(--text-muted)',lineHeight:1.6}}>Complete onboarding to link your mutual fund portfolio.</p>
        </div>
      </div>
    </div>
  )

  return (
    <div className="screen">
      <div style={{padding:'16px 20px 0'}}>

        {/* Header with privacy eye button */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:18}}>
          <div>
            <motion.h1 initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}}
              style={{fontFamily:'var(--font-display)',fontSize:28,fontWeight:400,marginBottom:4}}>
              Portfolio
            </motion.h1>
            <p style={{fontSize:13,color:'var(--text-secondary)'}}>Your collateral health</p>
          </div>

          {/* Eye / privacy toggle */}
          <motion.button
            whileTap={{scale:0.82}}
            onClick={() => setHidden(h => !h)}
            style={{
              width:42, height:42, borderRadius:13,
              background: hidden ? 'rgba(0,212,161,0.10)' : 'var(--bg-surface)',
              border: hidden ? '1px solid var(--jade-border)' : '1px solid var(--border)',
              display:'flex', alignItems:'center', justifyContent:'center',
              cursor:'pointer', marginTop:6, flexShrink:0,
              color: hidden ? 'var(--jade)' : 'var(--text-muted)',
              transition:'all 0.2s',
            }}>
            <motion.div
              key={hidden ? 'closed' : 'open'}
              initial={{scale:0.6, opacity:0, rotate: hidden ? -30 : 30}}
              animate={{scale:1, opacity:1, rotate:0}}
              transition={{type:'spring', stiffness:400, damping:18}}>
              {hidden ? <EyeClosed /> : <EyeOpen />}
            </motion.div>
          </motion.button>
        </div>

        {/* Privacy mode banner */}
        <AnimatePresence>
          {hidden && (
            <motion.div
              initial={{opacity:0, height:0}} animate={{opacity:1, height:'auto'}} exit={{opacity:0, height:0}}
              style={{overflow:'hidden', marginBottom:14}}>
              <div style={{background:'rgba(0,212,161,0.06)',border:'1px solid var(--jade-border)',borderRadius:12,padding:'10px 14px',display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontSize:14}}>🔒</span>
                <p style={{fontSize:12,color:'var(--jade)',fontWeight:600}}>Privacy mode — financial details hidden</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Credit summary card */}
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}}
          style={{background:'linear-gradient(135deg,rgba(0,212,161,0.07),rgba(0,212,161,0.02))',border:'1px solid var(--jade-border)',borderRadius:20,padding:'18px 20px',marginBottom:14}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
            <div>
              <p style={{fontSize:10,color:'var(--text-muted)',letterSpacing:'2px',fontFamily:'var(--font-mono)',marginBottom:4}}>AVAILABLE</p>
              <motion.p key={`av-${hidden}`} initial={{opacity:0}} animate={{opacity:1}}
                style={{fontFamily:'var(--font-display)',fontSize:hidden?20:24,color:'var(--jade)',letterSpacing:hidden?'2px':'-0.5px'}}>
                {cLimit > 0 ? maskVal(fC(available)) : '\u2014'}
              </motion.p>
            </div>
            <div>
              <p style={{fontSize:10,color:'var(--text-muted)',letterSpacing:'2px',fontFamily:'var(--font-mono)',marginBottom:4}}>OUTSTANDING</p>
              <motion.p key={`out-${hidden}`} initial={{opacity:0}} animate={{opacity:1}}
                style={{fontFamily:'var(--font-display)',fontSize:hidden?20:24,color:outstanding>0?'var(--amber)':'var(--text-secondary)',letterSpacing:hidden?'2px':'-0.5px'}}>
                {cLimit > 0 ? maskVal(fC(outstanding)) : '\u2014'}
              </motion.p>
            </div>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',paddingTop:12,borderTop:'1px solid var(--border)'}}>
            <div>
              <p style={{fontSize:9,color:'var(--text-muted)',letterSpacing:'2px',fontFamily:'var(--font-mono)',marginBottom:2}}>CREDIT LIMIT</p>
              <p style={{fontSize:14,fontWeight:600,fontFamily:'var(--font-mono)'}}>
                {cLimit > 0 ? maskVal(fC(cLimit)) : '\u2014'}
              </p>
            </div>
            <div style={{textAlign:'right'}}>
              <p style={{fontSize:9,color:'var(--text-muted)',letterSpacing:'2px',fontFamily:'var(--font-mono)',marginBottom:2}}>PORTFOLIO VALUE</p>
              <p style={{fontSize:14,fontWeight:600,fontFamily:'var(--font-mono)'}}>
                {maskVal(fC(totalVal))}
              </p>
            </div>
          </div>
        </motion.div>

        {/* LTV bar — always visible, even in privacy mode */}
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.1}}
          style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:14,padding:'14px 16px',marginBottom:18}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
            <p style={{fontSize:11,color:'var(--text-muted)'}}>LTV Ratio</p>
            <p style={{fontSize:11,fontWeight:600,fontFamily:'var(--font-mono)',color:outstanding<=0?'var(--jade)':ltvRatio>=90?'#EF4444':ltvRatio>=80?'#F59E0B':'var(--jade)'}}>
              {outstanding<=0 ? 'No outstanding' : `${ltvRatio.toFixed(1)}%`}
            </p>
          </div>
          <div style={{height:6,borderRadius:3,background:'var(--bg-elevated)',overflow:'hidden',position:'relative'}}>
            <div style={{position:'absolute',left:'80%',top:0,bottom:0,width:1,background:'rgba(245,158,11,0.5)'}}/>
            <div style={{position:'absolute',left:'90%',top:0,bottom:0,width:1,background:'rgba(239,68,68,0.5)'}}/>
            <motion.div initial={{width:0}} animate={{width:`${Math.min(outstanding>0?ltvRatio:0,100)}%`}} transition={{duration:1,ease:'easeOut'}}
              style={{height:'100%',borderRadius:3,background:ltvRatio>=90?'linear-gradient(90deg,#EF4444,#DC2626)':ltvRatio>=80?'linear-gradient(90deg,var(--jade),#F59E0B)':'linear-gradient(90deg,var(--jade),#00A878)'}}/>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',marginTop:4}}>
            <p style={{fontSize:9,color:'var(--text-muted)'}}>Safe</p>
            <p style={{fontSize:9,color:'#F59E0B'}}>80% Alert</p>
            <p style={{fontSize:9,color:'#EF4444'}}>90% Call</p>
          </div>
        </motion.div>

        {/* Pledged section header */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <p style={{fontSize:12,color:'var(--text-muted)',letterSpacing:'0.5px',fontFamily:'var(--font-mono)',fontWeight:500}}>PLEDGED COLLATERAL</p>
          <p style={{fontSize:10,color:'var(--jade)',fontFamily:'var(--font-mono)',fontWeight:600}}>
            {hidden ? '\u2022\u2022 funds' : `${pledgedH.length} / ${holdings.length} funds`}
          </p>
        </div>

        {pledgedH.length === 0 ? (
          <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:16,padding:'28px 20px',textAlign:'center',marginBottom:16}}>
            <p style={{fontSize:28,marginBottom:8}}>🔒</p>
            <p style={{fontSize:14,color:'var(--text-secondary)',fontWeight:600,marginBottom:4}}>No funds pledged yet</p>
            <p style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.5}}>Pledge your mutual funds below to activate your credit line.</p>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
            {pledgedH.map((h, i) => {
              const c  = sC(h.scheme_type)
              const el = parseFloat(h.eligible_value || h.eligible_credit || 0)
              return (
                <motion.div key={h.folio_number}
                  initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} transition={{delay:i*0.06}}
                  style={{background:'var(--bg-surface)',border:'1px solid var(--jade-border)',borderRadius:16,padding:'16px',position:'relative',overflow:'hidden'}}>
                  <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:'var(--jade)'}}/>
                  <div style={{marginLeft:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                      <div style={{flex:1,minWidth:0,paddingRight:8}}>
                        <p style={{fontSize:13,fontWeight:600,marginBottom:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',
                          filter: hidden ? 'blur(6px)' : 'none', transition:'filter 0.3s', userSelect: hidden ? 'none' : 'auto'}}>
                          {h.scheme_name}
                        </p>
                        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{fontSize:9,fontWeight:600,padding:'2px 7px',borderRadius:4,background:`${c}15`,color:c}}>{sL(h.scheme_type)}</span>
                          <span style={{fontSize:9,color:'var(--text-muted)'}}>{h.rta}</span>
                          <span style={{fontSize:8,fontWeight:700,padding:'2px 6px',borderRadius:4,background:'var(--jade-dim)',color:'var(--jade)',border:'1px solid var(--jade-border)',fontFamily:'var(--font-mono)'}}>PLEDGED</span>
                        </div>
                      </div>
                      <p style={{fontSize:14,fontWeight:600,fontFamily:'var(--font-mono)',flexShrink:0,
                        filter: hidden ? 'blur(6px)' : 'none', transition:'filter 0.3s', userSelect: hidden ? 'none' : 'auto'}}>
                        {fC(h.value_at_fetch)}
                      </p>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid var(--border)',paddingTop:10}}>
                      <div>
                        <p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>UNITS</p>
                        <p style={{fontSize:12,color:'var(--text-secondary)',filter:hidden?'blur(5px)':'none',transition:'filter 0.3s'}}>
                          {parseFloat(h.units_held||0).toFixed(3)}
                        </p>
                      </div>
                      <div>
                        <p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>NAV</p>
                        <p style={{fontSize:12,color:'var(--text-secondary)',filter:hidden?'blur(5px)':'none',transition:'filter 0.3s'}}>
                          {hidden ? '\u2022\u2022\u2022' : `\u20b9${parseFloat(h.nav_at_fetch||0).toFixed(2)}`}
                        </p>
                      </div>
                      <div>
                        {/* LTV always visible */}
                        <p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>LTV CAP</p>
                        <p style={{fontSize:12,color:c}}>{fL(h.ltv_cap)}</p>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>ELIGIBLE</p>
                        <p style={{fontSize:12,color:'var(--jade)',fontWeight:600,filter:hidden?'blur(5px)':'none',transition:'filter 0.3s'}}>
                          {fC(el)}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* ── ADD MORE COLLATERAL ──────────────────────────────────────────────
            ALWAYS rendered (regardless of unpledgedH.length).
            When all linked funds are already pledged → shows message.
            When unpledged funds exist → shows searchable list.
            This ensures the button is always discoverable.
        ──────────────────────────────────────────────────────────────────── */}
        <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{delay:0.25}} style={{marginBottom:16}}>
          <button onClick={() => setShowAdd(v => !v)}
            style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',
              borderRadius: showAdd ? '14px 14px 0 0' : 14,
              background: showAdd ? 'rgba(0,212,161,0.05)' : 'var(--bg-surface)',
              border: showAdd ? '1px solid var(--jade-border)' : '1px solid var(--border)',
              cursor:'pointer'}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:34,height:34,borderRadius:10,background:'var(--jade-dim)',border:'1px solid var(--jade-border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,color:'var(--jade)',lineHeight:1}}>
                +
              </div>
              <div style={{textAlign:'left'}}>
                <p style={{fontSize:13,fontWeight:600,color:'var(--jade)'}}>Pledge more funds</p>
                <p style={{fontSize:11,color:'var(--text-muted)',marginTop:1}}>
                  {unpledgedH.length > 0
                    ? `${unpledgedH.length} fund${unpledgedH.length!==1?'s':''} available`
                    : 'All your funds are already pledged'}
                </p>
              </div>
            </div>
            <motion.span
              animate={{rotate: showAdd ? 180 : 0}}
              transition={{duration:0.2}}
              style={{fontSize:12,color:'var(--text-muted)',display:'inline-block'}}>
              ▼
            </motion.span>
          </button>

          <AnimatePresence>
            {showAdd && (
              <motion.div
                initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}}
                exit={{height:0,opacity:0}} transition={{duration:0.25}}
                style={{overflow:'hidden',border:'1px solid var(--jade-border)',borderTop:'none',borderRadius:'0 0 14px 14px'}}>

                {unpledgedH.length === 0 ? (
                  /* All funds already pledged */
                  <div style={{background:'var(--bg-surface)',padding:'24px 20px',textAlign:'center'}}>
                    <p style={{fontSize:28,marginBottom:10}}>✅</p>
                    <p style={{fontSize:14,fontWeight:600,color:'var(--text-secondary)',marginBottom:6}}>All your connected funds are already pledged</p>
                    <p style={{fontSize:12,color:'var(--text-muted)',lineHeight:1.6}}>
                      Your full eligible credit limit is active. To add more funds, complete a new portfolio link from your account settings.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Search */}
                    <div style={{padding:'10px 12px',background:'var(--bg-surface)',borderBottom:'1px solid var(--border)'}}>
                      <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search by fund name or RTA..."
                        style={{width:'100%',height:36,background:'var(--bg-elevated)',border:'1px solid var(--border-light)',borderRadius:10,padding:'0 12px',fontSize:13,color:'var(--text-primary)',outline:'none',boxSizing:'border-box'}}
                        onFocus={e => e.target.style.borderColor = 'var(--jade-border)'}
                        onBlur={e => e.target.style.borderColor = 'var(--border-light)'}
                      />
                    </div>

                    {/* Fund list */}
                    <div style={{maxHeight:320,overflowY:'auto',background:'var(--bg-surface)'}}>
                      {filtered.length === 0 ? (
                        <p style={{padding:'20px',textAlign:'center',fontSize:13,color:'var(--text-muted)'}}>No funds match your search</p>
                      ) : filtered.map((h, i) => {
                        const c  = sC(h.scheme_type)
                        const el = parseFloat(h.eligible_value || h.eligible_credit || 0)
                        return (
                          <div key={h.folio_number} onClick={() => setPledgeModal(h)}
                            style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',cursor:'pointer',borderBottom:i<filtered.length-1?'1px solid var(--border)':'none'}}
                            onMouseEnter={e => e.currentTarget.style.background='rgba(0,212,161,0.04)'}
                            onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                            <div style={{width:38,height:38,borderRadius:10,flexShrink:0,background:`${c}12`,border:`1px solid ${c}22`,display:'flex',alignItems:'center',justifyContent:'center'}}>
                              <div style={{width:10,height:10,borderRadius:'50%',background:c}}/>
                            </div>
                            <div style={{flex:1,minWidth:0}}>
                              <p style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:3}}>{h.scheme_name}</p>
                              <div style={{display:'flex',gap:6,alignItems:'center'}}>
                                <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:`${c}15`,color:c,fontWeight:600}}>{sL(h.scheme_type)}</span>
                                <span style={{fontSize:9,color:'var(--text-muted)'}}>{h.rta}</span>
                                <span style={{fontSize:9,color:c,fontFamily:'var(--font-mono)',fontWeight:600}}>{fL(h.ltv_cap)}</span>
                              </div>
                            </div>
                            <div style={{textAlign:'right',flexShrink:0}}>
                              <p style={{fontSize:13,fontWeight:600,fontFamily:'var(--font-mono)'}}>{fC(h.value_at_fetch)}</p>
                              <p style={{fontSize:11,color:'var(--jade)',fontFamily:'var(--font-mono)'}}>→ {fC(el)}</p>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <div style={{height:32}}/>
      </div>

      {/* Pledge confirmation modal */}
      <AnimatePresence>
        {pledgeModal && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            style={{position:'fixed',inset:0,zIndex:50,background:'rgba(5,8,9,0.88)',display:'flex',alignItems:'flex-end'}}
            onClick={() => !pledging && setPledgeModal(null)}>
            <motion.div initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}} transition={{type:'spring',damping:28,stiffness:340}}
              onClick={e => e.stopPropagation()}
              style={{width:'100%',background:'var(--bg-surface)',borderRadius:'24px 24px 0 0',padding:'24px 22px 36px',border:'1px solid var(--border-light)'}}>
              <h3 style={{fontFamily:'var(--font-display)',fontSize:22,fontWeight:400,marginBottom:16}}>Pledge this fund?</h3>
              {(() => {
                const h  = pledgeModal
                const c  = sC(h.scheme_type)
                const el = parseFloat(h.eligible_value || h.eligible_credit || 0)
                return (
                  <div style={{background:'var(--bg-elevated)',borderRadius:14,padding:'16px',marginBottom:16,border:'1px solid var(--border)'}}>
                    <p style={{fontSize:14,fontWeight:600,marginBottom:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.scheme_name}</p>
                    <div style={{display:'flex',gap:6,marginBottom:12}}>
                      <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:`${c}15`,color:c,fontWeight:600}}>{sL(h.scheme_type)}</span>
                      <span style={{fontSize:9,color:'var(--text-muted)'}}>{h.rta}</span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <div><p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>VALUE</p><p style={{fontSize:15,fontWeight:600,fontFamily:'var(--font-mono)'}}>{fC(h.value_at_fetch)}</p></div>
                      <div><p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>LTV</p><p style={{fontSize:15,fontWeight:600,fontFamily:'var(--font-mono)',color:c}}>{fL(h.ltv_cap)}</p></div>
                      <div style={{textAlign:'right'}}><p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>ELIGIBLE</p><p style={{fontSize:15,fontWeight:700,fontFamily:'var(--font-mono)',color:'var(--jade)'}}>{fC(el)}</p></div>
                    </div>
                  </div>
                )
              })()}
              <p style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.6,marginBottom:18}}>
                Units will be lien-marked, not sold. Investment keeps growing. Release by repaying.
              </p>
              <div style={{display:'flex',gap:10}}>
                <motion.button whileTap={{scale:0.96}} onClick={() => setPledgeModal(null)} disabled={pledging}
                  style={{flex:1,height:52,borderRadius:14,background:'var(--bg-elevated)',border:'1px solid var(--border)',color:'var(--text-primary)',fontSize:15,fontWeight:600,cursor:'pointer'}}>
                  Cancel
                </motion.button>
                <motion.button whileTap={{scale:0.96}} onClick={() => handlePledge(pledgeModal)} disabled={pledging}
                  style={{flex:1,height:52,borderRadius:14,background:'linear-gradient(135deg,var(--jade),#00A878)',color:'var(--bg-void)',fontSize:15,fontWeight:700,border:'none',cursor:'pointer',boxShadow:'0 6px 20px rgba(0,212,161,0.2)',opacity:pledging?0.6:1}}>
                  {pledging ? 'Pledging...' : 'Confirm Pledge'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
