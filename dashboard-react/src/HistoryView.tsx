import { useEffect, useState } from "react";
import { REGISTRY, HAS_REG, isKnown } from "./LiveView";
import { fetchAlerts, fetchAssets, Alert, Asset } from "./api";
import { actAlert } from "./audit";

export function cleanDesc(desc: string): string {
  return desc.replace(/\s+at\s+\d{4}-\d{2}-\d{2}T[\d:.]+([+-]\d{2}:\d{2}|Z)/g, "").replace(/\s{2,}/g," ").trim();
}

const SEV: Record<string,{text:string;bg:string;border:string}> = {
  critical:{ text:"#FF6B61", bg:"rgba(255,59,48,0.07)",  border:"rgba(255,59,48,0.3)"  },
  high:    { text:"#FF9F0A", bg:"rgba(255,149,0,0.07)",  border:"rgba(255,149,0,0.3)"  },
  medium:  { text:"#FFD60A", bg:"rgba(255,214,10,0.07)", border:"rgba(255,214,10,0.35)"},
  low:     { text:"#32D74B", bg:"rgba(52,199,89,0.07)",  border:"rgba(52,199,89,0.3)"  },
};
const STS: Record<string,{text:string;bg:string}> = {
  open:          { text:"#FF6B61", bg:"rgba(255,59,48,0.07)"  },
  acknowledged:  { text:"#FF9F0A", bg:"rgba(255,149,0,0.07)"  },
  resolved:      { text:"#32D74B", bg:"rgba(52,199,89,0.07)"  },
  false_positive:{ text:"#D1D1D6", bg:"rgba(0,0,0,0.04)"      },
};

function detMethod(desc: string) {
  if (desc.startsWith("[Suricata")) return "Suricata — signature";
  if (desc.startsWith("Behavioral")) return "Welford baseline";
  if (desc.startsWith("New device")) return "Zeek — new device";
  if (desc.startsWith("Unauthorized")) return "Zeek — write rule";
  return "Zeek — rule";
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { day:"2-digit", month:"short", year:"numeric" });
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
}

interface Props { card: React.CSSProperties }

export default function HistoryView({ card }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [filterSev, setFilterSev] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDevice, setFilterDevice] = useState("all");
  const [filterProto, setFilterProto] = useState("all");
  const [search, setSearch] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");

  async function load() {
    try {
      const [a,s] = await Promise.all([fetchAlerts(), fetchAssets()]);
      setAlerts(a); setAssets(s);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch {}
  }
  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, []);

  const ips = [...new Set(assets.map(a => a.ip_address))];
  const protos = [...new Set(assets.flatMap(a => a.protocols||[]))];

  const filtered = alerts.filter(a => {
    if (filterSev!=="all" && a.severity!==filterSev) return false;
    if (filterStatus!=="all" && a.status!==filterStatus) return false;
    if (filterDevice!=="all" && !a.description.includes(filterDevice)) return false;
    if (filterProto!=="all" && !a.description.toLowerCase().includes(filterProto.toLowerCase())) return false;
    if (search && !cleanDesc(a.description).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const sel: React.CSSProperties = {
    background:"#1C1C1E", border:"1px solid #48484A", color:"#F5F5F7",
    borderRadius:8, padding:"6px 12px", fontSize:12, outline:"none", cursor:"pointer",
    boxShadow:"0 1px 2px rgba(0,0,0,0.05)",
  };

  // Group by date for separator rows
  const rows: Array<{type:"date";date:string} | {type:"alert";alert:Alert;idx:number}> = [];
  let lastDate = "";
  filtered.forEach((a, idx) => {
    const d = fmtDate(a.time);
    if (d !== lastDate) { rows.push({type:"date", date:d}); lastDate = d; }
    rows.push({type:"alert", alert:a, idx});
  });

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div>
        <h1 style={{ fontSize:20, fontWeight:700, color:"#F5F5F7" }}>Historical Analytics</h1>
        <div style={{ fontSize:12, color:"#D1D1D6", marginTop:4 }}>
          TimescaleDB · last refreshed {lastUpdated}
        </div>
      </div>

      {/* summary */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12 }}>
        {[
          { label:"TOTAL",   value:alerts.length,                                        color:"#F5F5F7", bg:"#1C1C1E" },
          { label:"OPEN",    value:alerts.filter(a=>a.status==="open").length,           color:"#FF6B61", bg:"rgba(255,59,48,0.06)" },
          { label:"ACK'D",   value:alerts.filter(a=>a.status==="acknowledged").length,   color:"#FF9F0A", bg:"rgba(255,149,0,0.06)" },
          { label:"RESOLVED",value:alerts.filter(a=>a.status==="resolved").length,       color:"#32D74B", bg:"rgba(52,199,89,0.06)" },
          { label:"FALSE +", value:alerts.filter(a=>a.status==="false_positive").length, color:"#D1D1D6", bg:"#2C2C2E" },
        ].map(c => (
          <div key={c.label} style={{ ...card, padding:16, background:c.bg }}>
            <div style={{ fontSize:10, color:"#D1D1D6", fontWeight:600, letterSpacing:"0.5px" }}>{c.label}</div>
            <div style={{ fontSize:26, fontWeight:700, marginTop:4, color:c.color, fontFamily:"'JetBrains Mono',monospace" }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* filters */}
      <div style={{ ...card, padding:16, display:"flex", gap:10, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:12, color:"#D1D1D6", fontWeight:600 }}>FILTER</span>
        <select value={filterSev} onChange={e=>setFilterSev(e.target.value)} style={sel}>
          <option value="all">All Severities</option>
          {["critical","high","medium","low"].map(s=><option key={s} value={s}>{s[0].toUpperCase()+s.slice(1)}</option>)}
        </select>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={sel}>
          <option value="all">All Statuses</option>
          {["open","acknowledged","resolved","false_positive"].map(s=><option key={s} value={s}>{s.replace("_"," ")}</option>)}
        </select>
        <select value={filterDevice} onChange={e=>setFilterDevice(e.target.value)} style={sel}>
          <option value="all">All Devices</option>
          {ips.map(ip=><option key={ip} value={ip}>{ip}</option>)}
        </select>
        <select value={filterProto} onChange={e=>setFilterProto(e.target.value)} style={sel}>
          <option value="all">All Protocols</option>
          {protos.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
        <input placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{ ...sel, flex:1, minWidth:160 }} />
        <span style={{ fontSize:12, color:"#D1D1D6" }}>{filtered.length}/{alerts.length}</span>
        {(filterSev!=="all"||filterStatus!=="all"||filterDevice!=="all"||filterProto!=="all"||search) && (
          <button onClick={()=>{setFilterSev("all");setFilterStatus("all");setFilterDevice("all");setFilterProto("all");setSearch("");}}
            style={{ ...sel, color:"#FF6B61", borderColor:"rgba(255,59,48,0.3)" }}>✕ Clear</button>
        )}
      </div>

      {/* table */}
      <div style={{ ...card, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:"#2C2C2E", borderBottom:"1px solid #48484A" }}>
                {["SR","DATE","TIME","SEVERITY","STATUS","DEVICE","DESCRIPTION","METHOD","ACTION / BY"].map(h=>(
                  <th key={h} style={{ padding:"11px 14px", textAlign:"left", color:"#D1D1D6", fontWeight:600, fontSize:11, whiteSpace:"nowrap", letterSpacing:"0.3px" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length===0 && (
                <tr><td colSpan={9} style={{ padding:40, textAlign:"center", color:"#D1D1D6" }}>No records match filters.</td></tr>
              )}
              {rows.map((row, ri) => {
                if (row.type==="date") return (
                  <tr key={`date-${ri}`}>
                    <td colSpan={9} style={{ padding:"8px 14px", background:"#242426", borderTop:"1px solid #3A3A3C", borderBottom:"1px solid #3A3A3C" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                        <div style={{ flex:1, height:1, background:"#48484A" }}/>
                        <span style={{ fontSize:11, fontWeight:700, color:"#D1D1D6", whiteSpace:"nowrap" }}>── {row.date} ──</span>
                        <div style={{ flex:1, height:1, background:"#48484A" }}/>
                      </div>
                    </td>
                  </tr>
                );
                const {alert:a, idx} = row;
                const sc = SEV[a.severity] || SEV.low;
                const st = STS[a.status] || STS.open;
                return (
                  <tr key={a.id} style={{ background: idx%2===0 ? "#1C1C1E" : "#202022", borderBottom:"1px solid #2C2C2E" }}>
                    <td style={{ padding:"11px 14px", color:"#D1D1D6", fontFamily:"'JetBrains Mono',monospace", fontSize:11, whiteSpace:"nowrap" }}>
                      {idx+1}
                    </td>
                    <td style={{ padding:"11px 14px", color:"#D1D1D6", fontFamily:"'JetBrains Mono',monospace", fontSize:11, whiteSpace:"nowrap" }}>
                      {fmtDate(a.time)}
                    </td>
                    <td style={{ padding:"11px 14px", color:"#D1D1D6", fontFamily:"'JetBrains Mono',monospace", fontSize:11, whiteSpace:"nowrap" }}>
                      {fmtTime(a.time)}
                    </td>
                    <td style={{ padding:"11px 14px" }}>
                      <span style={{ color:sc.text, background:sc.bg, border:`1px solid ${sc.border}`, padding:"3px 8px", borderRadius:6, fontWeight:700, fontSize:10, textTransform:"uppercase" }}>{a.severity}</span>
                    </td>
                    <td style={{ padding:"11px 14px" }}>
                      <span style={{ color:st.text, background:st.bg, padding:"3px 8px", borderRadius:6, fontSize:11, fontWeight:500 }}>{a.status.replace("_"," ")}</span>
                    </td>
                    <td style={{ padding:"11px 14px", fontSize:11, whiteSpace:"nowrap" }}>
                      {(() => {
                        const ip = (a.description.match(/\d+\.\d+\.\d+\.\d+/) || [""])[0];
                        const r = REGISTRY[ip];
                        const known = isKnown(ip);
                        return ip ? (
                          <div>
                            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>{ip}</div>
                            <div style={{ color:"#D1D1D6" }}>{r ? r.role : "Not in approved baseline"}</div>
                            {HAS_REG && <span style={{ fontSize:10, fontWeight:700, color:known?"#32D74B":"#FF6B61" }}>{known?"KNOWN":"UNKNOWN"}</span>}
                          </div>
                        ) : "—";
                      })()}
                    </td>
                    <td style={{ padding:"11px 14px", color:"#D1D1D6", maxWidth:280 }}>{cleanDesc(a.description)}</td>
                    <td style={{ padding:"11px 14px", color:"#007AFF", fontSize:11, whiteSpace:"nowrap" }}>{detMethod(a.description)}</td>
                    <td style={{ padding:"11px 14px", minWidth:160 }}>
                      {a.status==="open" ? (
                        <div style={{ display:"flex", gap:6 }}>
                          <button title="I have seen this alert and am investigating. Alert stays open." onClick={()=>actAlert(a,"acknowledged",load)}
                            style={{ fontSize:10, background:"rgba(255,149,0,0.08)", color:"#FF9F0A", border:"1px solid rgba(255,149,0,0.3)", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>Ack</button>
                          <button title="Problem fixed or confirmed harmless. Alert is closed." onClick={()=>actAlert(a,"resolved",load)}
                            style={{ fontSize:10, background:"rgba(52,199,89,0.08)", color:"#32D74B", border:"1px solid rgba(52,199,89,0.3)", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>Resolve</button>
                          <button title="Not a real threat: normal behaviour flagged by mistake." onClick={()=>actAlert(a,"false_positive",load)}
                            style={{ fontSize:10, background:"#2C2C2E", color:"#D1D1D6", border:"1px solid #48484A", borderRadius:6, padding:"4px 10px", cursor:"pointer" }}>False +</button>
                        </div>
                      ) : (
                        <div style={{ fontSize:11, color:"#D1D1D6", lineHeight:1.5 }}>
                          <div style={{ fontWeight:600, color: a.status==="resolved" ? "#32D74B" : a.status==="acknowledged" ? "#FF9F0A" : "#D1D1D6" }}>
                            {a.status==="false_positive" ? "Marked FP" : a.status==="resolved" ? "✓ Resolved" : "⏸ Acknowledged"}
                          </div>
                          <select value="" onChange={e=>{ if(e.target.value) actAlert(a, e.target.value as any, load); }} style={{ fontSize:10, marginTop:4, background:"#2C2C2E", color:"#F5F5F7", border:"1px solid #48484A", borderRadius:6, padding:"2px 6px" }}>
                            <option value="">Change action…</option><option value="acknowledged">Acknowledged</option><option value="resolved">Resolved</option><option value="false_positive">False positive</option>
                          </select>
                          {a.acknowledged_by && (
                            <div style={{ fontSize:10, color:"#D1D1D6", marginTop:2 }}>
                              by {a.acknowledged_by}
                              {a.acknowledged_at && <span> · {fmtTime(a.acknowledged_at)}</span>}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
