import { useEffect, useRef, useState } from "react";
import { fetchAlerts, fetchAssets, acknowledgeAlert, Alert, Asset } from "./api";
import PLCChart from "./components/PLCChart";

function timeAgo(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
function detectionMethod(desc: string) {
  if (desc.startsWith("[Suricata")) return "Suricata — signature match";
  if (desc.startsWith("Behavioral")) return "Welford — statistical baseline deviation";
  if (desc.startsWith("New device")) return "Zeek — new device discovery";
  if (desc.startsWith("Unauthorized")) return "Zeek — unauthorized write rule";
  return "Zeek — rule-based detection";
}
function recommendedAction(a: Alert) {
  if (a.llm_explanation) {
    const s = a.llm_explanation.split(/(?<=[.!?])\s+/);
    const last = s[s.length-1];
    return last && last.length > 15 ? last : a.llm_explanation;
  }
  return "Triage pending from local LLM…";
}

const SEV: Record<string,{text:string;border:string;bg:string;label:string}> = {
  critical:{ text:"#CC2A20", border:"rgba(255,59,48,0.35)",  bg:"rgba(255,59,48,0.07)",  label:"CRITICAL" },
  high:    { text:"#B25000", border:"rgba(255,149,0,0.35)",  bg:"rgba(255,149,0,0.07)",  label:"HIGH"     },
  medium:  { text:"#7A6000", border:"rgba(255,214,10,0.4)",  bg:"rgba(255,214,10,0.07)", label:"MEDIUM"   },
  low:     { text:"#1A7A34", border:"rgba(52,199,89,0.35)",  bg:"rgba(52,199,89,0.07)",  label:"LOW"      },
};

const PROTOCOLS = [
  { name:"Modbus TCP", port:"TCP 502",   flow:"PLC .211 → HMI .212",  color:"#007AFF", icon:"⚡" },
  { name:"S7comm",     port:"TCP 102",   flow:"S7-PLC → Client",       color:"#FF9500", icon:"🔧" },
  { name:"DNP3",       port:"TCP 20000", flow:"DNP3 Client .218",       color:"#34C759", icon:"📡" },
  { name:"OPC-UA",     port:"TCP 4840",  flow:"OPC-UA Client .220",    color:"#AF52DE", icon:"🔗" },
];

function ProtocolCard({ p }: { p: typeof PROTOCOLS[0] }) {
  return (
    <div style={{ background:"#FFFFFF", border:"1px solid #D1D1D6", borderRadius:14, padding:16, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16 }}>{p.icon}</span>
          <span style={{ fontSize:13, fontWeight:700, color:"#1C1C1E" }}>{p.name}</span>
        </div>
        <span style={{ fontSize:10, color:p.color, background:`${p.color}15`, border:`1px solid ${p.color}40`, padding:"3px 8px", borderRadius:6, fontFamily:"'JetBrains Mono',monospace", fontWeight:600 }}>{p.port}</span>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:10, fontSize:10, color:"#1A7A34", fontWeight:600 }}>
        <span style={{ width:6, height:6, borderRadius:"50%", background:"#34C759", boxShadow:"0 0 6px rgba(52,199,89,0.6)", display:"inline-block", animation:"blink 1.5s infinite" }}/>
        ICSNPP PARSER ACTIVE
      </div>
      <div style={{ height:44, marginTop:10, background:"#F2F2F7", border:"1px solid #E5E5EA", borderRadius:8, position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", left:"8%", right:"8%", top:"50%", height:2, background:`${p.color}30`, transform:"translateY(-50%)" }}/>
        {[0, 0.7, 1.4].map((delay,i) => (
          <div key={i} style={{ position:"absolute", top:"calc(50% - 4px)", width:8, height:8, borderRadius:"50%", background:p.color, boxShadow:`0 0 8px ${p.color}80`, animation:`packetTravel 2.2s linear ${delay}s infinite` }}/>
        ))}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:8, fontSize:10, color:"#6C6C70" }}>
        <span>{p.flow}</span>
        <span style={{ color:"#1A7A34", fontWeight:600 }}>● ACTIVE</span>
      </div>
    </div>
  );
}

interface Props { card: React.CSSProperties }

export default function LiveView({ card }: Props) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [lastUpdated, setLastUpdated] = useState("");
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string|null>(null);

  async function refresh() {
    try {
      const [a, s] = await Promise.all([fetchAlerts(), fetchAssets()]);
      setAlerts(a); setAssets(s);
      setLastUpdated(new Date().toLocaleTimeString());
      setError("");
    } catch(e:any) { setError(e.message); }
  }
  useEffect(() => { refresh(); const id = setInterval(refresh, 3000); return () => clearInterval(id); }, []);

  const open = alerts.filter(a => a.status==="open");
  const counts = { critical:0, high:0, medium:0, low:0 } as Record<string,number>;
  open.forEach(a => { counts[a.severity] = (counts[a.severity]||0)+1; });
  const liveDevices = assets.filter(a => (Date.now()-new Date(a.last_seen).getTime())/1000 < 15).length;

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      {/* header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:700, color:"#1C1C1E" }}>Live Command</h1>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4 }}>
            <span style={{ position:"relative", display:"inline-flex", width:8, height:8 }}>
              <span style={{ position:"absolute", inset:0, borderRadius:"50%", background:"#34C759", opacity:0.6, animation:"ping 1.2s infinite" }}/>
              <span style={{ position:"relative", display:"inline-block", borderRadius:"50%", width:8, height:8, background:"#34C759" }}/>
            </span>
            <span style={{ color:"#1A7A34", fontSize:12, fontWeight:600 }}>LIVE</span>
            <span style={{ color:"#6C6C70", fontSize:12 }}>· refreshing every 3s · {lastUpdated}</span>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {(counts.critical+counts.high) > 0 && (
            <span style={{ background:"rgba(255,59,48,0.08)", color:"#CC2A20", border:"1px solid rgba(255,59,48,0.3)", padding:"8px 16px", borderRadius:999, fontSize:12, fontWeight:600 }}>
              🔔 {counts.critical+counts.high} critical/high alert{counts.critical+counts.high>1?"s":""} need attention
            </span>
          )}
          {error && <span style={{ color:"#CC2A20", fontSize:12 }}>⚠ {error}</span>}
        </div>
      </div>

      {/* stat cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:14 }}>
        {[
          { label:"DEVICES MONITORED", value:assets.length,    color:"#007AFF", bg:"rgba(0,122,255,0.06)"   },
          { label:"ACTIVE NOW",        value:liveDevices,      color:"#1A7A34", bg:"rgba(52,199,89,0.06)"   },
          { label:"OPEN ALERTS",       value:open.length,      color:"#1C1C1E", bg:"#FFFFFF"                },
          { label:"CRITICAL",          value:counts.critical,  color:"#CC2A20", bg:"rgba(255,59,48,0.06)"   },
          { label:"HIGH",              value:counts.high,      color:"#B25000", bg:"rgba(255,149,0,0.06)"   },
        ].map(c => (
          <div key={c.label} style={{ ...card, padding:18, background:c.bg }}>
            <div style={{ fontSize:10, color:"#6C6C70", fontWeight:600, letterSpacing:"0.5px" }}>{c.label}</div>
            <div style={{ fontSize:30, fontWeight:700, marginTop:6, color:c.color, fontFamily:"'JetBrains Mono',monospace" }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* PLC live chart */}
      <PLCChart />

      {/* protocol matrix */}
      <div style={{ ...card, padding:20 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"#1C1C1E", marginBottom:4 }}>Industrial Protocol Parser Matrix</div>
        <div style={{ fontSize:12, color:"#6C6C70", marginBottom:16 }}>Passive Zeek + ICSNPP inspection · no packets injected onto OT network</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
          {PROTOCOLS.map(p => <ProtocolCard key={p.name} p={p} />)}
        </div>
      </div>

      {/* device grid */}
      <div style={{ fontSize:14, fontWeight:700, color:"#1C1C1E" }}>Device Status & Alerts</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
        {assets.map(asset => {
          const devAlerts = open.filter(a => a.description.includes(asset.ip_address));
          const isLive = (Date.now()-new Date(asset.last_seen).getTime())/1000 < 15;
          const worst = devAlerts.reduce((w,a) => {
            const rank:Record<string,number> = {critical:4,high:3,medium:2,low:1};
            return (rank[a.severity]||0)>(rank[w]||0) ? a.severity : w;
          }, "");
          const sc = worst ? SEV[worst] : null;
          const isExp = expanded===asset.ip_address;

          return (
            <div key={asset.ip_address} style={{
              background:"#FFFFFF",
              border:`1px solid ${sc ? sc.border : "#D1D1D6"}`,
              borderRadius:14, padding:18,
              boxShadow: sc ? `0 0 0 3px ${sc.bg}` : "0 1px 3px rgba(0,0,0,0.06)",
              transition:"all 0.2s",
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ position:"relative", display:"inline-flex", width:8, height:8 }}>
                      {isLive && <span style={{ position:"absolute", inset:0, borderRadius:"50%", background:"#34C759", opacity:0.6, animation:"ping 1.2s infinite" }}/>}
                      <span style={{ position:"relative", display:"inline-block", borderRadius:"50%", width:8, height:8, background: isLive ? "#34C759" : "#C7C7CC" }}/>
                    </span>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:14, color:"#1C1C1E" }}>{asset.ip_address}</span>
                  </div>
                  <div style={{ fontSize:11, color:"#6C6C70", marginTop:4 }}>
                    {(asset.protocols||[]).join(", ") || "unknown"} · {isLive ? <span style={{color:"#1A7A34",fontWeight:600}}>active now</span> : `last seen ${timeAgo(asset.last_seen)}`}
                  </div>
                </div>
                {devAlerts.length>0 ? (
                  <span style={{ fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:999, background:sc!.bg, color:sc!.text, border:`1px solid ${sc!.border}`, textTransform:"uppercase" }}>
                    {devAlerts.length} alert{devAlerts.length>1?"s":""}
                  </span>
                ) : (
                  <span style={{ fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:999, background:"rgba(52,199,89,0.08)", color:"#1A7A34", border:"1px solid rgba(52,199,89,0.3)" }}>Normal</span>
                )}
              </div>

              {devAlerts.length>0 && (
                <button onClick={() => setExpanded(isExp ? null : asset.ip_address)} style={{
                  marginTop:12, width:"100%", fontSize:12, color:"#6C6C70",
                  background:"#F2F2F7", border:"1px solid #E5E5EA",
                  borderRadius:10, padding:"7px 0", cursor:"pointer",
                }}>
                  {isExp ? "Hide details ▲" : "View alert details ▼"}
                </button>
              )}

              {isExp && devAlerts.map(a => {
                const asc = SEV[a.severity] || SEV.low;
                return (
                  <div key={a.id} style={{ marginTop:12, paddingTop:12, borderTop:"1px solid #E5E5EA" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <span style={{ fontSize:11, fontWeight:700, color:asc.text, textTransform:"uppercase", background:asc.bg, border:`1px solid ${asc.border}`, padding:"2px 8px", borderRadius:5 }}>{a.severity}</span>
                      <span style={{ fontSize:11, color:"#6C6C70" }}>{timeAgo(a.time)}</span>
                    </div>
                    <div style={{ fontSize:12, marginBottom:6, color:"#3A3A3C", lineHeight:1.5 }}>{a.description}</div>
                    <div style={{ fontSize:11, color:"#007AFF", marginBottom:6, fontWeight:500 }}>🔍 {detectionMethod(a.description)}</div>
                    <div style={{ fontSize:11, background:"#F2F2F7", border:"1px solid #E5E5EA", borderRadius:8, padding:"10px 12px", color:"#3A3A3C", lineHeight:1.6 }}>
                      <span style={{ color:"#1C1C1E", fontWeight:600 }}>Recommended fix: </span>{recommendedAction(a)}
                    </div>
                    <div style={{ display:"flex", gap:8, marginTop:10 }}>
                      {[
                        { label:"Acknowledge", status:"acknowledged" as const, bg:"rgba(255,149,0,0.08)", color:"#B25000", border:"rgba(255,149,0,0.3)" },
                        { label:"Resolve",     status:"resolved"     as const, bg:"rgba(52,199,89,0.08)", color:"#1A7A34", border:"rgba(52,199,89,0.3)" },
                        { label:"False +",     status:"false_positive" as const, bg:"#F2F2F7", color:"#6C6C70", border:"#D1D1D6" },
                      ].map(btn => (
                        <button key={btn.label} onClick={() => acknowledgeAlert(a.id, btn.status).then(refresh)} style={{
                          flex:1, fontSize:11, background:btn.bg, color:btn.color,
                          border:`1px solid ${btn.border}`, borderRadius:8,
                          padding:"7px 0", cursor:"pointer", fontWeight:500,
                        }}>{btn.label}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {assets.length===0 && <div style={{ color:"#6C6C70", fontStyle:"italic", textAlign:"center", padding:40 }}>No devices discovered yet.</div>}
    </div>
  );
}
