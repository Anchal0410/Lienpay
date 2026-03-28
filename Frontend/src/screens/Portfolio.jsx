import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getPortfolioSummary, getLTVHealth, getPledgeStatus, initiatePledge, confirmPledgeOTP, notifyNBFC } from '../api/client'
import useStore from '../store/useStore'
import toast from 'react-hot-toast'

const fC = (n) => `\u20b9${parseFloat(n||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`
const fL = (r) => { if(!r) return '\u2014'; if(typeof r==='string'&&r.includes('%')) return r; const n=parseFloat(r); return n>1?`${n.toFixed(0)}%`:`${(n*100).toFixed(0)}%` }
const SC = { EQUITY_LARGE_CAP:'#3B82F6',EQUITY_LARGE_MID_CAP:'#06B6D4',EQUITY_MID_CAP:'#F59E0B',EQUITY_SMALL_CAP:'#EF4444',EQUITY_FLEXI_CAP:'#8B5CF6',INDEX_FUND:'#F472B6',ETF:'#F472B6',DEBT_LIQUID:'#22D3EE',DEBT_SHORT_DUR:'#22D3EE',HYBRID_BALANCED:'#FB923C' }
const sColor = (t) => SC[t]||'#7A8F85'
const sLabel = (t) => (t||'').replace(/_/g,' ')

export default function Portfolio() {
  const { portfolio, setPortfolio, ltvHealth, setLTVHealth, creditAccount } = useStore()
  const [loading,     setLoading]     = useState(true)
  const [pledges,     setPledges]     = useState([])
  const [pledgeModal, setPledgeModal] = useState(null)
  const [pledging,    setPledging]    = useState(false)
  const [showAdd,     setShowAdd]     = useState(false)
  const [search,      setSearch]      = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const [pR,lR,plR] = await Promise.all([
          getPortfolioSummary(),
          getLTVHealth().catch(()=>({data:{}})),
          getPledgeStatus().catch(()=>({data:{pledges:[]}})),
        ])
        setPortfolio(pR.data); setLTVHealth(lR.data); setPledges(plR.data?.pledges||[])
      } catch(_) {}
      setLoading(false)
    })()
  }, [])

  const holdings  = portfolio?.holdings || []
  const totalVal  = parseFloat(portfolio?.summary?.total_value||0)
  const cLimit    = parseFloat(creditAccount?.credit_limit||0)
  const outstanding = parseFloat(creditAccount?.outstanding||0)
  const available = parseFloat(creditAccount?.available_credit||(cLimit-outstanding)||0)
  const ltvRatio  = parseFloat(ltvHealth?.ltv_ratio||0)

  const pledgeMap = {}
  pledges.forEach(p => { pledgeMap[p.folio_number] = p })
  const isPledged = f => { const p=pledgeMap[f]; return p&&p.status==='ACTIVE' }

  const pledgedH   = holdings.filter(h => isPledged(h.folio_number))
  const unpledgedH = holdings.filter(h => !isPledged(h.folio_number) && h.is_eligible)
  const filtered   = search.trim()
    ? unpledgedH.filter(h => (h.scheme_name||'').toLowerCase().includes(search.toLowerCase()))
    : unpledgedH

  const handlePledge = async (h) => {
    setPledging(true)
    try {
      const res = await initiatePledge([{folio_number:h.folio_number}])
      const pl = res.data.pledges?.[0]
      if (pl) {
        await confirmPledgeOTP(pl.pledge_id, pl.rta==='CAMS'?'123456':'654321')
        await notifyNBFC([pl.pledge_id])
        toast.success(`${(h.scheme_name||'Fund').split(' ')[0]} pledged!`)
        const u = await getPledgeStatus(); setPledges(u.data?.pledges||[])
        setPledgeModal(null); setShowAdd(false)
      }
    } catch(err) { toast.error(err.message||'Pledge failed') }
    finally { setPledging(false) }
  }

  if (loading) return (
    <div className="screen" style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
      <motion.div animate={{rotate:360}} transition={{duration:1,repeat:Infinity,ease:'linear'}}
        style={{width:32,height:32,border:'2px solid var(--bg-elevated)',borderTopColor:'var(--jade)',borderRadius:'50%'}}/>
    </div>
  )

  return (
    <div className="screen">
      <div style={{padding:'16px 20px 0'}}>
        <motion.h1 initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}}
          style={{fontFamily:'var(--font-display)',fontSize:28,fontWeight:400,marginBottom:4}}>
          Portfolio
        </motion.h1>
        <p style={{fontSize:13,color:'var(--text-secondary)',marginBottom:18}}>Your collateral health</p>

        {/* Credit summary */}
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}}
          style={{background:'linear-gradient(135deg,rgba(0,212,161,0.07),rgba(0,212,161,0.02))',border:'1px solid var(--jade-border)',borderRadius:20,padding:'18px 20px',marginBottom:14}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
            <div>
              <p style={{fontSize:10,color:'var(--text-muted)',letterSpacing:'2px',fontFamily:'var(--font-mono)',marginBottom:4}}>AVAILABLE</p>
              <p style={{fontFamily:'var(--font-display)',fontSize:24,color:'var(--jade)'}}>{cLimit>0?fC(available):'\u2014'}</p>
            </div>
            <div>
              <p style={{fontSize:10,color:'var(--text-muted)',letterSpacing:'2px',fontFamily:'var(--font-mono)',marginBottom:4}}>OUTSTANDING</p>
              <p style={{fontFamily:'var(--font-display)',fontSize:24,color:outstanding>0?'var(--amber)':'var(--text-secondary)'}}>{cLimit>0?fC(outstanding):'\u2014'}</p>
            </div>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',paddingTop:12,borderTop:'1px solid var(--border)'}}>
            <div>
              <p style={{fontSize:9,color:'var(--text-muted)',letterSpacing:'2px',fontFamily:'var(--font-mono)',marginBottom:2}}>CREDIT LIMIT</p>
              <p style={{fontSize:14,fontWeight:600,fontFamily:'var(--font-mono)'}}>{cLimit>0?fC(cLimit):'\u2014'}</p>
            </div>
            <div style={{textAlign:'right'}}>
              <p style={{fontSize:9,color:'var(--text-muted)',letterSpacing:'2px',fontFamily:'var(--font-mono)',marginBottom:2}}>PORTFOLIO VALUE</p>
              <p style={{fontSize:14,fontWeight:600,fontFamily:'var(--font-mono)'}}>{fC(totalVal)}</p>
            </div>
          </div>
        </motion.div>

        {/* LTV bar */}
        <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:0.1}}
          style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:14,padding:'14px 16px',marginBottom:18}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
            <p style={{fontSize:11,color:'var(--text-muted)'}}>LTV Ratio</p>
            <p style={{fontSize:11,fontWeight:600,fontFamily:'var(--font-mono)',color:outstanding<=0?'var(--jade)':ltvRatio>=90?'#EF4444':ltvRatio>=80?'#F59E0B':'var(--jade)'}}>
              {outstanding<=0?'No outstanding':`${ltvRatio.toFixed(1)}%`}
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

        {/* Pledged section */}
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <p style={{fontSize:12,color:'var(--text-muted)',letterSpacing:'0.5px',fontFamily:'var(--font-mono)',fontWeight:500}}>PLEDGED COLLATERAL</p>
          <p style={{fontSize:10,color:'var(--jade)',fontFamily:'var(--font-mono)',fontWeight:600}}>{pledgedH.length} fund{pledgedH.length!==1?'s':''}</p>
        </div>

        {pledgedH.length===0 ? (
          <div style={{background:'var(--bg-surface)',border:'1px solid var(--border)',borderRadius:18,padding:'32px 20px',textAlign:'center',marginBottom:16}}>
            <p style={{fontSize:32,marginBottom:10}}>🔒</p>
            <p style={{fontSize:14,color:'var(--text-secondary)',fontWeight:600}}>No funds pledged yet</p>
            <p style={{fontSize:12,color:'var(--text-muted)',marginTop:6,lineHeight:1.5}}>Use "Add more collateral" below to pledge your mutual funds.</p>
          </div>
        ) : (
          <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:16}}>
            {pledgedH.map((h,i) => {
              const c = sColor(h.scheme_type)
              const el = parseFloat(h.eligible_value||h.eligible_credit||0)
              return (
                <motion.div key={h.folio_number} initial={{opacity:0,x:-10}} animate={{opacity:1,x:0}} transition={{delay:i*0.06}}
                  style={{background:'var(--bg-surface)',border:'1px solid var(--jade-border)',borderRadius:16,padding:'16px',position:'relative',overflow:'hidden'}}>
                  <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:'var(--jade)'}}/>
                  <div style={{marginLeft:8}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
                      <div style={{flex:1,minWidth:0,paddingRight:8}}>
                        <p style={{fontSize:14,fontWeight:600,marginBottom:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.scheme_name}</p>
                        <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{fontSize:9,fontWeight:600,padding:'2px 7px',borderRadius:4,background:`${c}15`,color:c}}>{sLabel(h.scheme_type)}</span>
                          <span style={{fontSize:9,color:'var(--text-muted)'}}>{h.rta}</span>
                          <span style={{fontSize:8,fontWeight:700,padding:'2px 6px',borderRadius:4,background:'var(--jade-dim)',color:'var(--jade)',border:'1px solid var(--jade-border)',fontFamily:'var(--font-mono)'}}>PLEDGED</span>
                        </div>
                      </div>
                      <p style={{fontSize:15,fontWeight:600,fontFamily:'var(--font-mono)',flexShrink:0}}>{fC(h.value_at_fetch)}</p>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid var(--border)',paddingTop:10}}>
                      <div><p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>UNITS</p><p style={{fontSize:12,color:'var(--text-secondary)'}}>{parseFloat(h.units_held||0).toFixed(3)}</p></div>
                      <div><p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>NAV</p><p style={{fontSize:12,color:'var(--text-secondary)'}}>&#8377;{parseFloat(h.nav_at_fetch||0).toFixed(2)}</p></div>
                      <div><p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>LTV CAP</p><p style={{fontSize:12,color:c}}>{fL(h.ltv_cap)}</p></div>
                      <div style={{textAlign:'right'}}><p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>ELIGIBLE</p><p style={{fontSize:12,color:'var(--jade)',fontWeight:600}}>{fC(el)}</p></div>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* Add more collateral expandable */}
        {unpledgedH.length>0 && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} transition={{delay:0.2}} style={{marginBottom:16}}>
            <button onClick={()=>setShowAdd(v=>!v)}
              style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 16px',borderRadius:showAdd?'14px 14px 0 0':14,background:'var(--bg-surface)',border:'1px solid var(--border)',cursor:'pointer'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:32,height:32,borderRadius:10,background:'var(--jade-dim)',border:'1px solid var(--jade-border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,color:'var(--jade)'}}>+</div>
                <div style={{textAlign:'left'}}>
                  <p style={{fontSize:13,fontWeight:600,color:'var(--jade)'}}>Add more collateral</p>
                  <p style={{fontSize:11,color:'var(--text-muted)',marginTop:1}}>{unpledgedH.length} eligible fund{unpledgedH.length!==1?'s':''} available</p>
                </div>
              </div>
              <span style={{fontSize:12,color:'var(--text-muted)',display:'inline-block',transition:'transform 0.2s',transform:showAdd?'rotate(180deg)':'none'}}>&#9660;</span>
            </button>
            <AnimatePresence>
              {showAdd && (
                <motion.div initial={{height:0,opacity:0}} animate={{height:'auto',opacity:1}} exit={{height:0,opacity:0}} transition={{duration:0.25}}
                  style={{overflow:'hidden',border:'1px solid var(--border)',borderTop:'none',borderRadius:'0 0 14px 14px'}}>
                  <div style={{padding:'12px 14px 8px',background:'var(--bg-surface)',borderBottom:'1px solid var(--border)'}}>
                    <input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search funds by name or RTA..."
                      style={{width:'100%',height:36,background:'var(--bg-elevated)',border:'1px solid var(--border-light)',borderRadius:10,padding:'0 14px',fontSize:13,color:'var(--text-primary)',outline:'none',boxSizing:'border-box'}}
                      onFocus={e=>e.target.style.borderColor='var(--jade-border)'}
                      onBlur={e=>e.target.style.borderColor='var(--border-light)'}
                    />
                  </div>
                  <div style={{maxHeight:300,overflowY:'auto',background:'var(--bg-surface)'}}>
                    {filtered.length===0 ? (
                      <p style={{padding:'20px',textAlign:'center',fontSize:13,color:'var(--text-muted)'}}>No funds match your search</p>
                    ) : filtered.map((h,i) => {
                      const c = sColor(h.scheme_type)
                      const el = parseFloat(h.eligible_value||h.eligible_credit||0)
                      return (
                        <div key={h.folio_number} onClick={()=>setPledgeModal(h)}
                          style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderBottom:i<filtered.length-1?'1px solid var(--border)':'none',cursor:'pointer'}}
                          onMouseEnter={e=>e.currentTarget.style.background='rgba(0,212,161,0.04)'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          <div style={{width:36,height:36,borderRadius:10,flexShrink:0,background:`${c}12`,border:`1px solid ${c}20`,display:'flex',alignItems:'center',justifyContent:'center'}}>
                            <div style={{width:10,height:10,borderRadius:'50%',background:c}}/>
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <p style={{fontSize:13,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:3}}>{h.scheme_name}</p>
                            <div style={{display:'flex',gap:6,alignItems:'center'}}>
                              <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:`${c}15`,color:c,fontWeight:600}}>{sLabel(h.scheme_type)}</span>
                              <span style={{fontSize:9,color:'var(--text-muted)'}}>{h.rta}</span>
                              <span style={{fontSize:9,color:c,fontFamily:'var(--font-mono)',fontWeight:600}}>{fL(h.ltv_cap)}</span>
                            </div>
                          </div>
                          <div style={{textAlign:'right',flexShrink:0}}>
                            <p style={{fontSize:13,fontWeight:600,fontFamily:'var(--font-mono)'}}>{fC(h.value_at_fetch)}</p>
                            <p style={{fontSize:11,color:'var(--jade)',fontFamily:'var(--font-mono)'}}>&#8594; {fC(el)}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        <div style={{height:8}}/>
      </div>

      {/* Pledge confirmation modal */}
      <AnimatePresence>
        {pledgeModal && (
          <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
            style={{position:'fixed',inset:0,zIndex:50,background:'rgba(5,8,9,0.88)',display:'flex',alignItems:'flex-end'}}
            onClick={()=>!pledging&&setPledgeModal(null)}>
            <motion.div initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}} transition={{type:'spring',damping:28,stiffness:340}}
              onClick={e=>e.stopPropagation()}
              style={{width:'100%',background:'var(--bg-surface)',borderRadius:'24px 24px 0 0',padding:'24px 22px 32px',border:'1px solid var(--border-light)'}}>
              <h3 style={{fontFamily:'var(--font-display)',fontSize:22,fontWeight:400,marginBottom:16}}>Pledge this fund?</h3>
              {(() => {
                const h = pledgeModal; const c = sColor(h.scheme_type); const el = parseFloat(h.eligible_value||h.eligible_credit||0)
                return (
                  <div style={{background:'var(--bg-elevated)',borderRadius:14,padding:'16px',marginBottom:16,border:'1px solid var(--border)'}}>
                    <p style={{fontSize:14,fontWeight:600,marginBottom:3,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.scheme_name}</p>
                    <div style={{display:'flex',gap:6,marginBottom:12}}>
                      <span style={{fontSize:9,padding:'2px 6px',borderRadius:4,background:`${c}15`,color:c,fontWeight:600}}>{sLabel(h.scheme_type)}</span>
                      <span style={{fontSize:9,color:'var(--text-muted)'}}>{h.rta}</span>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between'}}>
                      <div><p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>FUND VALUE</p><p style={{fontSize:15,fontWeight:600,fontFamily:'var(--font-mono)'}}>{fC(h.value_at_fetch)}</p></div>
                      <div><p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>LTV CAP</p><p style={{fontSize:15,fontWeight:600,fontFamily:'var(--font-mono)',color:c}}>{fL(h.ltv_cap)}</p></div>
                      <div style={{textAlign:'right'}}><p style={{fontSize:9,color:'var(--text-muted)',fontFamily:'var(--font-mono)',marginBottom:3}}>ELIGIBLE</p><p style={{fontSize:15,fontWeight:700,fontFamily:'var(--font-mono)',color:'var(--jade)'}}>{fC(el)}</p></div>
                    </div>
                  </div>
                )
              })()}
              <p style={{fontSize:12,color:'var(--text-secondary)',lineHeight:1.6,marginBottom:18}}>
                Units will be lien-marked, not sold. Investments keep growing. Release anytime by repaying.
              </p>
              <div style={{display:'flex',gap:10}}>
                <motion.button whileTap={{scale:0.96}} onClick={()=>setPledgeModal(null)} disabled={pledging}
                  style={{flex:1,height:52,borderRadius:14,background:'var(--bg-elevated)',border:'1px solid var(--border)',color:'var(--text-primary)',fontSize:15,fontWeight:600,cursor:'pointer'}}>
                  Cancel
                </motion.button>
                <motion.button whileTap={{scale:0.96}} onClick={()=>handlePledge(pledgeModal)} disabled={pledging}
                  style={{flex:1,height:52,borderRadius:14,background:'linear-gradient(135deg,var(--jade),#00A878)',color:'var(--bg-void)',fontSize:15,fontWeight:700,border:'none',cursor:'pointer',boxShadow:'0 6px 20px rgba(0,212,161,0.2)',opacity:pledging?0.6:1}}>
                  {pledging?'Pledging\u2026':'Confirm Pledge'}
                </motion.button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
