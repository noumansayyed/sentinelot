import { cleanDesc } from "./HistoryView";
import { useEffect, useRef, useState } from "react";
import { who, why, addAudit, actAlert } from "./audit";
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
  critical:{ text:"#FF6B61", border:"rgba(255,59,48,0.35)",  bg:"rgba(255,59,48,0.07)",  label:"CRITICAL" },
  high:    { text:"#FF9F0A", border:"rgba(255,149,0,0.35)",  bg:"rgba(255,149,0,0.07)",  label:"HIGH"     },
  medium:  { text:"#FFD60A", border:"rgba(255,214,10,0.4)",  bg:"rgba(255,214,10,0.07)", label:"MEDIUM"   },
  low:     { text:"#32D74B", border:"rgba(52,199,89,0.35)",  bg:"rgba(52,199,89,0.07)",  label:"LOW"      },
};

export const REGISTRY: Record<string,{name:string;role:string;known:boolean}> = {"172.28.240.221": {"name": "telemetry-api", "role": "Dashboard telemetry poller", "known": true}, "172.28.240.220": {"name": "opcua-client", "role": "OPC-UA node", "known": true}, "172.28.240.218": {"name": "dnp3-client", "role": "DNP3 traffic generator (our counter program)", "known": true}, "172.28.240.217": {"name": "iiot-sensor", "role": "IIoT sensor", "known": true}, "172.28.240.214": {"name": "s7-client", "role": "S7 client", "known": true}, "172.28.240.213": {"name": "rogue-device", "role": "UNAPPROVED device (rogue)", "known": false}, "172.28.240.212": {"name": "hmi-device", "role": "HMI operator station", "known": true}, "172.28.240.2": {"name": "plc-relay", "role": "PLC relay", "known": true}, "172.28.240.211": {"name": "plc-modbus", "role": "PLC (Modbus server)", "known": true}};
export const HAS_REG = Object.keys(REGISTRY).length>0;
function alertReason(d:string){
  if(d.startsWith("New device")) return "New device";
  if(d.startsWith("Behavioral")) return "Timing anomaly";
  if(d.includes("outside normal hours")) return "Off-hours activity";
  if(d.startsWith("Unauthorized")) return "Unauthorized write";
  if(d.startsWith("[Suricata")) return "Signature match";
  return "Rule match";
}

const TIPS: Record<string,string> = {
  "Acknowledge":"I have seen this alert and am investigating. Alert stays open.",
  "Resolve":"Problem fixed or confirmed harmless. Alert is closed.",
  "False +":"Not a real threat: normal behaviour that was flagged by mistake."
};
const LS_A="sot_approvals", LS_L="sot_approval_log";
type Appr = Record<string,{known:boolean;by:string;at:string}>;
export function getApprovals():Appr{ try{return JSON.parse(localStorage.getItem(LS_A)||"{}");}catch{return {};} }
export function getApprovalLog():{ip:string;action:string;by:string;at:string}[]{ try{return JSON.parse(localStorage.getItem(LS_L)||"[]");}catch{return [];} }
export function isKnown(ip:string):boolean{ const o=getApprovals()[ip]; if(o) return o.known; return !HAS_REG || !!REGISTRY[ip]?.known; }
export function setKnown(ip:string, known:boolean){
  const a=getApprovals(); const at=new Date().toISOString();
  a[ip]={known,by:"operator",at}; localStorage.setItem(LS_A,JSON.stringify(a));
  const l=getApprovalLog(); l.push({ip,action:known?"Approved (UNKNOWN to KNOWN)":"Revoked (KNOWN to UNKNOWN)",by:"operator",at});
  localStorage.setItem(LS_L,JSON.stringify(l));
}
function changeKnown(ip:string, wasKnown:boolean){
  const by=who(); if(!by) return;
  const reason=why(); if(!reason) return;
  setKnown(ip,!wasKnown);
  addAudit({at:new Date().toISOString(),by,kind:"device",target:ip,from:wasKnown?"KNOWN":"UNKNOWN",to:wasKnown?"UNKNOWN":"KNOWN",reason});
}
const PROTOCOLS = [
  { name:"Modbus TCP", port:"TCP 502",   flow:"PLC .211 → HMI .212",  color:"#007AFF", icon:"⚡" },
  { name:"S7comm",     port:"TCP 102",   flow:"S7-PLC → Client",       color:"#FF9500", icon:"🔧" },
  { name:"DNP3",       port:"TCP 20000", flow:"DNP3 Client .218",       color:"#34C759", icon:"📡" },
  { name:"OPC-UA",     port:"TCP 4840",  flow:"OPC-UA Client .220",    color:"#AF52DE", icon:"🔗" },
];

export function ProtocolCard({ p }: { p: typeof PROTOCOLS[0] }) {
  return (
    <div style={{ background:"#1C1C1E", border:"1px solid #48484A", borderRadius:14, padding:16, boxShadow:"0 1px 3px rgba(0,0,0,0.06)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:16 }}>{p.icon}</span>
          <span style={{ fontSize:13, fontWeight:700, color:"#F5F5F7" }}>{p.name}</span>
        </div>
        <span style={{ fontSize:10, color:p.color, background:`${p.color}15`, border:`1px solid ${p.color}40`, padding:"3px 8px", borderRadius:6, fontFamily:"'JetBrains Mono',monospace", fontWeight:600 }}>{p.port}</span>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:10, fontSize:10, color:"#32D74B", fontWeight:600 }}>
        <span style={{ width:6, height:6, borderRadius:"50%", background:"#34C759", boxShadow:"0 0 6px rgba(52,199,89,0.6)", display:"inline-block", animation:"blink 1.5s infinite" }}/>
        ICSNPP PARSER ACTIVE
      </div>
      <div style={{ height:44, marginTop:10, background:"#2C2C2E", border:"1px solid #3A3A3C", borderRadius:8, position:"relative", overflow:"hidden" }}>
        <div style={{ position:"absolute", left:"8%", right:"8%", top:"50%", height:2, background:`${p.color}30`, transform:"translateY(-50%)" }}/>
        {[0, 0.7, 1.4].map((delay,i) => (
          <div key={i} style={{ position:"absolute", top:"calc(50% - 4px)", width:8, height:8, borderRadius:"50%", background:p.color, boxShadow:`0 0 8px ${p.color}80`, opacity:0.5 }}/>
        ))}
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:8, fontSize:10, color:"#D1D1D6" }}>
        <span>{p.flow}</span>
        <span style={{ color:"#32D74B", fontWeight:600 }}>● ACTIVE</span>
      </div>
    </div>
  );
}

function ProtoMatrixCard({ p, assets, open }: { p: typeof PROTOCOLS[0]; assets: Asset[]; open: Alert[] }) {
  const keys: Record<string,string> = { "Modbus TCP":"modbus", "S7comm":"s7", "DNP3":"dnp3", "OPC-UA":"opc" };
  const k = keys[p.name];
  const devs = assets.filter(a => (a.protocols||[]).some(x => x.toLowerCase().replace(/[^a-z0-9]/g,"").includes(k)));
  const seen = devs.length > 0;
  const [,force] = useState(0);
  return (
    <div style={{ background:"#1C1C1E", border:"1px solid #48484A", borderRadius:14, padding:16, maxHeight:300, overflowY:"auto" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:13, fontWeight:700, color:"#F5F5F7" }}>{p.icon} {p.name}</span>
        <span style={{ fontSize:10, color:p.color, background:`${p.color}15`, border:`1px solid ${p.color}40`, padding:"3px 8px", borderRadius:6, fontWeight:600 }}>{p.port}</span>
      </div>
      <div style={{ fontSize:11, fontWeight:600, marginTop:8, color: seen ? "#32D74B" : "#C7C7CC" }}>
        {seen ? `● ACTIVE · ${devs.length} device${devs.length>1?"s":""} seen${k!=="modbus"?" · connection-level":""}` : "○ NO TRAFFIC SEEN"}
      </div>
      {false && Object.entries(REGISTRY).filter(([ip,v]) => v.name.toLowerCase().includes(k==="opc"?"opcua":k==="s7"?"s7":k==="dnp3"?"dnp3":"zzz")).map(([ip,v]) => (
        <div key={ip} style={{ marginTop:8, fontSize:11, color:"#D1D1D6" }}><b style={{fontFamily:"monospace"}}>{ip}</b> · {v.role}<br/>connections seen on {p.port} (Zeek conn.log), no parsed messages</div>
      ))}
      {devs.map((d, idx) => {
        const r = REGISTRY[d.ip_address];
        const known = isKnown(d.ip_address);
        const da = open.filter(a => a.description.includes(d.ip_address));
        const live = (Date.now()-new Date(d.last_seen).getTime())/1000 < 15;
        return (
          <div key={d.ip_address} style={{ marginTop:10, paddingTop:10, borderTop:"1px solid #3A3A3C", fontSize:11, color:"#D1D1D6", lineHeight:1.6 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:12 }}>{idx+1}. {d.ip_address}</span>
              {HAS_REG && <span style={{ fontSize:10, fontWeight:700, padding:"1px 8px", borderRadius:999, color:known?"#32D74B":"#FF6B61", background:known?"rgba(52,199,89,0.1)":"rgba(255,59,48,0.1)" }}>{known?"KNOWN":"UNKNOWN"}</span>}
            </div>
            <div>{r ? r.role : "Not in approved baseline"}</div>
            <button title={known?"Remove from approved list":"Add to approved list"} onClick={()=>{changeKnown(d.ip_address,known);force(x=>x+1);}} style={{marginTop:4,fontSize:10,padding:"2px 8px",borderRadius:6,border:"1px solid #48484A",background:"#2C2C2E",cursor:"pointer"}}>{known?"Mark UNKNOWN":"Approve as KNOWN"}</button>
            <div style={{ color:"#D1D1D6" }}>{live ? "active now" : `last seen ${timeAgo(d.last_seen)}`} · {da.length ? `${da.length} alert${da.length>1?"s":""}: ${Array.from(new Set(da.map(a=>alertReason(a.description)))).join(", ")}` : "no alerts"}</div>
          </div>
        );
      })}
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
          <h1 style={{ fontSize:20, fontWeight:700, color:"#F5F5F7" }}>Live Command</h1>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4 }}>
            <span style={{ position:"relative", display:"inline-flex", width:8, height:8 }}>
              <span style={{ position:"absolute", inset:0, borderRadius:"50%", background:"#34C759", opacity:0.6, animation:"ping 1.2s infinite" }}/>
              <span style={{ position:"relative", display:"inline-block", borderRadius:"50%", width:8, height:8, background:"#34C759" }}/>
            </span>
            <span style={{ color:"#32D74B", fontSize:12, fontWeight:600 }}>LIVE</span>
            <span style={{ color:"#D1D1D6", fontSize:12 }}>· refreshing every 3s · {lastUpdated}</span>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {(counts.critical+counts.high) > 0 && (
            <span style={{ background:"rgba(255,59,48,0.08)", color:"#FF6B61", border:"1px solid rgba(255,59,48,0.3)", padding:"8px 16px", borderRadius:999, fontSize:12, fontWeight:600 }}>
              🔔 {counts.critical+counts.high} critical/high alert{counts.critical+counts.high>1?"s":""} need attention
            </span>
          )}
          {error && <span style={{ color:"#FF6B61", fontSize:12 }}>⚠ {error}</span>}
        </div>
      </div>

      {/* stat cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:14 }}>
        {[
          { label:"DEVICES MONITORED", value:assets.length,    color:"#007AFF", bg:"rgba(0,122,255,0.06)"   },
          { label:"ACTIVE NOW",        value:liveDevices,      color:"#32D74B", bg:"rgba(52,199,89,0.06)"   },
          { label:"OPEN ALERTS",       value:open.length,      color:"#F5F5F7", bg:"#1C1C1E"                },
          { label:"CRITICAL",          value:counts.critical,  color:"#FF6B61", bg:"rgba(255,59,48,0.06)"   },
          { label:"HIGH",              value:counts.high,      color:"#FF9F0A", bg:"rgba(255,149,0,0.06)"   },
        ].map(c => (
          <div key={c.label} style={{ ...card, padding:18, background:c.bg }}>
            <div style={{ fontSize:10, color:"#D1D1D6", fontWeight:600, letterSpacing:"0.5px" }}>{c.label}</div>
            <div style={{ fontSize:30, fontWeight:700, marginTop:6, color:c.color, fontFamily:"'JetBrains Mono',monospace" }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* PLC live chart */}
      <PLCChart />

      {/* protocol matrix */}
      <div style={{ ...card, padding:20 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"#F5F5F7", marginBottom:4 }}>Industrial Protocol Parser Matrix</div>
        <div style={{ fontSize:12, color:"#D1D1D6", marginBottom:16 }}>Devices discovered per protocol · passive Zeek + ICSNPP inspection · no packets injected onto OT network</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14 }}>
          {PROTOCOLS.map(p => <ProtoMatrixCard key={p.name} p={p} assets={assets} open={open} />)}
        </div>
      </div>

      {HAS_REG && (
        <div style={{ ...card, padding:16, display:"flex", gap:24, alignItems:"center", fontSize:13, color:"#F5F5F7" }}>
          <span><b>{assets.filter(a=>isKnown(a.ip_address)).length}</b> known devices</span>
          <span style={{color:"#FF6B61"}}><b>{assets.filter(a=>!isKnown(a.ip_address)).length}</b> unknown / unapproved</span>
          <span><b>{open.length}</b> open alerts</span>
          <span style={{color:"#D1D1D6",fontSize:11}}>KNOWN = on approved baseline · UNKNOWN = appeared after baseline</span>
        </div>
      )}
      <div style={{ fontSize:14, fontWeight:700, color:"#F5F5F7" }}>Alerts by Type</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:14 }}>
        {[
          { key:"New device", color:"#FF6B61", meaning:"A device appeared on the network that was not seen before." },
          { key:"Off-hours activity", color:"#FF9F0A", meaning:"Machines are communicating outside normal working hours." },
          { key:"Unauthorized write", color:"#FF6B61", meaning:"Someone tried to change a value inside a PLC." },
          { key:"Timing anomaly", color:"#FFD60A", meaning:"A device is behaving differently from its own normal pattern." },
          { key:"Signature match", color:"#FF6B61", meaning:"Traffic matched a known attack pattern (Suricata)." },
          { key:"Rule match", color:"#D1D1D6", meaning:"Other rule-based detections." },
        ].map(cat => {
          const list = open.filter(a => alertReason(a.description)===cat.key);
          return (
            <div key={cat.key} style={{ ...card, padding:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ fontSize:13, fontWeight:700, color:cat.color }}>{cat.key}</span>
                <span style={{ fontSize:20, fontWeight:700, fontFamily:"'JetBrains Mono',monospace" }}>{list.length}</span>
              </div>
              <div style={{ fontSize:11, color:"#D1D1D6", marginTop:4 }}>{cat.meaning}</div>
              {list.length===0 && <div style={{ fontSize:11, color:"#32D74B", marginTop:10 }}>None right now.</div>}
              {list.slice(0,3).map(a => {
                const dev = assets.find(x => a.description.includes(x.ip_address));
                const ip = dev?.ip_address || "";
                const r = REGISTRY[ip];
                return (
                  <div key={a.id} style={{ marginTop:10, paddingTop:10, borderTop:"1px solid #3A3A3C", fontSize:11, color:"#D1D1D6", lineHeight:1.6 }}>
                    <div><b>{ip||"device"}</b> {r ? "· "+r.role : ""} · {(dev?.protocols||[]).join(", ")||"protocol n/a"} · {timeAgo(a.time)}</div>
                    <div><b>What happened:</b> {cleanDesc(a.description)}</div>
                    <div><b>Detected by:</b> {detectionMethod(a.description)}</div>
                    <div><b>AI advice:</b> {recommendedAction(a)}</div>
                    <div style={{ display:"flex", gap:6, marginTop:6 }}>
                      {[["Acknowledge","acknowledged"],["Resolve","resolved"],["False +","false_positive"]].map(([l,st]) => (
                        <button key={l} title={TIPS[l]} onClick={() => actAlert(a, st as any, refresh)} style={{ flex:1, fontSize:11, background:"#2C2C2E", border:"1px solid #48484A", borderRadius:8, padding:"5px 0", cursor:"pointer" }}>{l}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {list.length>3 && <div style={{ fontSize:11, color:"#D1D1D6", marginTop:8 }}>+ {list.length-3} more (see Historical Analytics)</div>}
            </div>
          );
        })}
      </div>
      {/* device grid */}
      <div style={{ fontSize:14, fontWeight:700, color:"#F5F5F7" }}></div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14 }}>
        {([] as Asset[]).map(asset => {
          const devAlerts = open.filter(a => a.description.includes(asset.ip_address));
          const isLive = (Date.now()-new Date(asset.last_seen).getTime())/1000 < 15;
          const worst = devAlerts.reduce((w,a) => {
            const rank:Record<string,number> = {critical:4,high:3,medium:2,low:1};
            return (rank[a.severity]||0)>(rank[w]||0) ? a.severity : w;
          }, "");
          const sc = worst ? SEV[worst] : null;
          const isExp = expanded===asset.ip_address;
          const reg = REGISTRY[asset.ip_address];
          const known = !HAS_REG || !!reg?.known;

          return (
            <div key={asset.ip_address} style={{
              background:"#1C1C1E",
              border:`1px solid ${!known ? "rgba(255,59,48,0.6)" : sc ? sc.border : "#48484A"}`,
              borderRadius:14, padding:18,
              boxShadow: sc ? `0 0 0 3px ${sc.bg}` : "0 1px 3px rgba(0,0,0,0.06)",
              transition:"all 0.2s",
            }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ position:"relative", display:"inline-flex", width:8, height:8 }}>
                      {isLive && <span style={{ position:"absolute", inset:0, borderRadius:"50%", background:"#34C759", opacity:0.6, animation:"ping 1.2s infinite" }}/>}
                      <span style={{ position:"relative", display:"inline-block", borderRadius:"50%", width:8, height:8, background: isLive ? "#34C759" : "#636366" }}/>
                    </span>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:700, fontSize:14, color:"#F5F5F7" }}>{asset.ip_address}</span>
                    {HAS_REG && <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:999, color:known?"#32D74B":"#FF6B61", background:known?"rgba(52,199,89,0.1)":"rgba(255,59,48,0.1)", border:`1px solid ${known?"rgba(52,199,89,0.4)":"rgba(255,59,48,0.4)"}` }}>{known?"KNOWN":"UNKNOWN"}</span>}
                  </div>
                  {HAS_REG && <div style={{ fontSize:12, fontWeight:600, color:"#F5F5F7", marginTop:4 }}>{reg ? `${reg.role}` : "Unrecognised device — not in approved baseline"}</div>}
                  <div style={{ fontSize:11, color:"#D1D1D6", marginTop:4 }}>
                    {(asset.protocols||[]).join(", ") || "unknown"} · {isLive ? <span style={{color:"#32D74B",fontWeight:600}}>active now</span> : `last seen ${timeAgo(asset.last_seen)}`}
                  </div>
                </div>
                {devAlerts.length>0 ? (
                  <span style={{ fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:999, background:sc!.bg, color:sc!.text, border:`1px solid ${sc!.border}`, textTransform:"uppercase" }}>
                    {devAlerts.length} alert{devAlerts.length>1?"s":""}
                  </span>
                ) : (
                  <span style={{ fontSize:11, fontWeight:700, padding:"4px 12px", borderRadius:999, background:"rgba(52,199,89,0.08)", color:"#32D74B", border:"1px solid rgba(52,199,89,0.3)" }}>Normal</span>
                )}
              </div>

              {false && (
                <button onClick={() => setExpanded(isExp ? null : asset.ip_address)} style={{
                  marginTop:12, width:"100%", fontSize:12, color:"#D1D1D6",
                  background:"#2C2C2E", border:"1px solid #3A3A3C",
                  borderRadius:10, padding:"7px 0", cursor:"pointer",
                }}>
                  {isExp ? "Hide details ▲" : "View alert details ▼"}
                </button>
              )}

              {false && (
                <div style={{ marginTop:10, fontSize:11, color:"#D1D1D6", lineHeight:1.6 }}>
                  <div><b>Why flagged:</b> {Array.from(new Set(devAlerts.map(a=>alertReason(a.description)))).join(", ")} · protocol: {(asset.protocols||[]).join(", ")||"unknown"}</div>
                  <div><b>Action:</b> Detected → LLM explained → Awaiting operator (Acknowledge / Resolve)</div>
                </div>
              )}
              {isExp && devAlerts.map(a => {
                const asc = SEV[a.severity] || SEV.low;
                return (
                  <div key={a.id} style={{ marginTop:12, paddingTop:12, borderTop:"1px solid #3A3A3C" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                      <span style={{ fontSize:11, fontWeight:700, color:asc.text, textTransform:"uppercase", background:asc.bg, border:`1px solid ${asc.border}`, padding:"2px 8px", borderRadius:5 }}>{a.severity}</span>
                      <span style={{ fontSize:11, color:"#D1D1D6" }}>{timeAgo(a.time)}</span>
                    </div>
                    <div style={{ fontSize:12, marginBottom:6, color:"#D1D1D6", lineHeight:1.5 }}>{a.description}</div>
                    <div style={{ fontSize:11, color:"#007AFF", marginBottom:6, fontWeight:500 }}>🔍 {detectionMethod(a.description)}</div>
                    <div style={{ fontSize:11, background:"#2C2C2E", border:"1px solid #3A3A3C", borderRadius:8, padding:"10px 12px", color:"#D1D1D6", lineHeight:1.6 }}>
                      <span style={{ color:"#F5F5F7", fontWeight:600 }}>Recommended fix: </span>{recommendedAction(a)}
                    </div>
                    <div style={{ display:"flex", gap:8, marginTop:10 }}>
                      {[
                        { label:"Acknowledge", status:"acknowledged" as const, bg:"rgba(255,149,0,0.08)", color:"#FF9F0A", border:"rgba(255,149,0,0.3)" },
                        { label:"Resolve",     status:"resolved"     as const, bg:"rgba(52,199,89,0.08)", color:"#32D74B", border:"rgba(52,199,89,0.3)" },
                        { label:"False +",     status:"false_positive" as const, bg:"#2C2C2E", color:"#D1D1D6", border:"#48484A" },
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
      {assets.length===0 && <div style={{ color:"#D1D1D6", fontStyle:"italic", textAlign:"center", padding:40 }}>No devices discovered yet.</div>}
    </div>
  );
}
