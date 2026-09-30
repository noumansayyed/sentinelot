import { useEffect, useState } from "react";
import { fetchAlerts, fetchAssets, acknowledgeAlert, Alert, Asset } from "./api";
import { cleanDesc } from "./App";

const SEV_COLOR: Record<string,{text:string;bg:string;border:string}> = {
  critical:{ text:"#CC2A20", bg:"rgba(255,59,48,0.07)",  border:"rgba(255,59,48,0.3)"  },
  high:    { text:"#B25000", bg:"rgba(255,149,0,0.07)",  border:"rgba(255,149,0,0.3)"  },
  medium:  { text:"#7A6000", bg:"rgba(255,214,10,0.07)", border:"rgba(255,214,10,0.35)" },
  low:     { text:"#1A7A34", bg:"rgba(52,199,89,0.07)",  border:"rgba(52,199,89,0.3)"  },
};
const STATUS_STYLE: Record<string,{text:string;bg:string}> = {
  open:          { text:"#CC2A20", bg:"rgba(255,59,48,0.07)"  },
  acknowledged:  { text:"#B25000", bg:"rgba(255,149,0,0.07)"  },
  resolved:      { text:"#1A7A34", bg:"rgba(52,199,89,0.07)"  },
  false_positive:{ text:"#6C6C70", bg:"rgba(0,0,0,0.04)"      },
};

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
    if (search && !a.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const selStyle: React.CSSProperties = {
    background:"#FFFFFF", border:"1px solid #D1D1D6", color:"#1C1C1E",
    borderRadius:8, padding:"6px 12px", fontSize:12, outline:"none", cursor:"pointer",
    boxShadow:"0 1px 2px rgba(0,0,0,0.05)",
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
      <div>
        <h1 style={{ fontSize:20, fontWeight:700, color:"#1C1C1E" }}>Historical Analytics</h1>
        <div style={{ fontSize:12, color:"#6C6C70", marginTop:4 }}>
          Multi-indexed time-series records · TimescaleDB · last refreshed {lastUpdated}
        </div>
      </div>

      {/* summary row */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12 }}>
        {[
          { label:"TOTAL",        value:alerts.length,                                        color:"#1C1C1E", bg:"#FFFFFF" },
          { label:"OPEN",         value:alerts.filter(a=>a.status==="open").length,           color:"#CC2A20", bg:"rgba(255,59,48,0.06)" },
          { label:"ACKNOWLEDGED", value:alerts.filter(a=>a.status==="acknowledged").length,   color:"#B25000", bg:"rgba(255,149,0,0.06)" },
          { label:"RESOLVED",     value:alerts.filter(a=>a.status==="resolved").length,       color:"#1A7A34", bg:"rgba(52,199,89,0.06)" },
          { label:"FALSE +",      value:alerts.filter(a=>a.status==="false_positive").length, color:"#6C6C70", bg:"#F2F2F7" },
        ].map(c => (
          <div key={c.label} style={{ ...card, padding:16, background:c.bg }}>
            <div style={{ fontSize:10, color:"#6C6C70", fontWeight:600, letterSpacing:"0.5px" }}>{c.label}</div>
            <div style={{ fontSize:26, fontWeight:700, marginTop:4, color:c.color, fontFamily:"'JetBrains Mono',monospace" }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* filters */}
      <div style={{ ...card, padding:16, display:"flex", gap:12, flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:12, color:"#6C6C70", fontWeight:600 }}>FILTER BY</span>
        <select value={filterSev} onChange={e=>setFilterSev(e.target.value)} style={selStyle}>
          <option value="all">All Severities</option>
          {["critical","high","medium","low"].map(s=><option key={s} value={s}>{s[0].toUpperCase()+s.slice(1)}</option>)}
        </select>
        <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={selStyle}>
          <option value="all">All Statuses</option>
          {["open","acknowledged","resolved","false_positive"].map(s=><option key={s} value={s}>{s.replace("_"," ")}</option>)}
        </select>
        <select value={filterDevice} onChange={e=>setFilterDevice(e.target.value)} style={selStyle}>
          <option value="all">All Devices</option>
          {ips.map(ip=><option key={ip} value={ip}>{ip}</option>)}
        </select>
        <select value={filterProto} onChange={e=>setFilterProto(e.target.value)} style={selStyle}>
          <option value="all">All Protocols</option>
          {protos.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
        <input placeholder="Search description…" value={search} onChange={e=>setSearch(e.target.value)}
          style={{ ...selStyle, flex:1, minWidth:180 }} />
        <span style={{ fontSize:12, color:"#6C6C70", marginLeft:"auto" }}>{filtered.length} / {alerts.length} records</span>
        {(filterSev!=="all"||filterStatus!=="all"||filterDevice!=="all"||filterProto!=="all"||search) && (
          <button onClick={()=>{setFilterSev("all");setFilterStatus("all");setFilterDevice("all");setFilterProto("all");setSearch("");}}
            style={{ ...selStyle, color:"#CC2A20", borderColor:"rgba(255,59,48,0.3)" }}>✕ Clear filters</button>
        )}
      </div>

      {/* table */}
      <div style={{ ...card, overflow:"hidden" }}>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
            <thead>
              <tr style={{ background:"#F2F2F7", borderBottom:"1px solid #D1D1D6" }}>
                {["DATE & TIME","SEVERITY","STATUS","DESCRIPTION","DETECTION METHOD","ACTION"].map(h=>(
                  <th key={h} style={{ padding:"12px 16px", textAlign:"left", color:"#6C6C70", fontWeight:600, fontSize:11, letterSpacing:"0.3px", whiteSpace:"nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length===0 && (
                <tr><td colSpan={6} style={{ padding:40, textAlign:"center", color:"#6C6C70" }}>No records match current filters.</td></tr>
              )}
              {filtered.map((a,i) => {
                const sc = SEV_COLOR[a.severity] || SEV_COLOR.low;
                const st = STATUS_STYLE[a.status] || STATUS_STYLE.open;
                return (
                  <tr key={a.id} style={{ background: i%2===0 ? "#FFFFFF" : "#FAFAFA", borderBottom:"1px solid #F2F2F7" }}>
                    <td style={{ padding:"12px 16px", color:"#6C6C70", whiteSpace:"nowrap", fontFamily:"'JetBrains Mono',monospace", fontSize:11 }}>
                      {new Date(a.time).toLocaleString()}
                    </td>
                    <td style={{ padding:"12px 16px" }}>
                      <span style={{ color:sc.text, background:sc.bg, border:`1px solid ${sc.border}`, padding:"3px 8px", borderRadius:6, fontWeight:700, fontSize:10, textTransform:"uppercase" }}>{a.severity}</span>
                    </td>
                    <td style={{ padding:"12px 16px" }}>
                      <span style={{ color:st.text, background:st.bg, padding:"3px 8px", borderRadius:6, fontSize:11, fontWeight:500 }}>{a.status.replace("_"," ")}</span>
                    </td>
                    <td style={{ padding:"12px 16px", color:"#3A3A3C", maxWidth:300 }}>{cleanDesc(a.description)}</td>
                    <td style={{ padding:"12px 16px", color:"#007AFF", fontSize:11 }}>
                      {a.description.startsWith("[Suricata") ? "Suricata — signature"
                       : a.description.startsWith("Behavioral") ? "Welford baseline"
                       : a.description.startsWith("New device") ? "Zeek — new device"
                       : a.description.startsWith("Unauthorized") ? "Zeek — write rule"
                       : "Zeek — rule"}
                    </td>
                    <td style={{ padding:"12px 16px" }}>
                      {a.status==="open" ? (
                        <div style={{ display:"flex", gap:6 }}>
                          <button onClick={()=>acknowledgeAlert(a.id,"acknowledged").then(load)} style={{ fontSize:10, background:"rgba(255,149,0,0.08)", color:"#B25000", border:"1px solid rgba(255,149,0,0.3)", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontWeight:500 }}>Ack</button>
                          <button onClick={()=>acknowledgeAlert(a.id,"resolved").then(load)} style={{ fontSize:10, background:"rgba(52,199,89,0.08)", color:"#1A7A34", border:"1px solid rgba(52,199,89,0.3)", borderRadius:6, padding:"4px 10px", cursor:"pointer", fontWeight:500 }}>Resolve</button>
                        </div>
                      ) : <span style={{ color:"#C7C7CC", fontSize:11 }}>—</span>}
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
