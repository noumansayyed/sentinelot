import { useEffect, useState } from "react";
import { fetchAlerts, Alert } from "./api";
import LiveView from "./LiveView";
import HistoryView from "./HistoryView";

type Tab = "live" | "history";

// Strip " at 2026-09-26T05:56:47+00:00" or " at 2026-09-26T05:56:47Z" anywhere in string
export function cleanDesc(desc: string): string {
  return desc
    .replace(/\s+at\s+\d{4}-\d{2}-\d{2}T[\d:.]+([+-]\d{2}:\d{2}|Z)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export default function App() {
  const [tab, setTab] = useState<Tab>("live");
  const [topAlert, setTopAlert] = useState<Alert | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const alerts = await fetchAlerts();
        const top = alerts.find(a => a.status==="open" && a.severity==="critical")
          || alerts.find(a => a.status==="open" && a.severity==="high")
          || alerts.find(a => a.status==="open");
        setTopAlert(top || null);
      } catch {}
    };
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  const card: React.CSSProperties = {
    background:"#FFFFFF", border:"1px solid #D1D1D6",
    borderRadius:14, boxShadow:"0 1px 4px rgba(0,0,0,0.07)",
  };

  const bannerH = topAlert ? 43 : 0;

  return (
    <div style={{ display:"flex", flexDirection:"column", minHeight:"100vh", background:"#F2F2F7" }}>

      {/* URGENT BANNER — solid bg so scroll content never shows through */}
      {topAlert && (
        <div style={{
          background:"#FFF0EF",
          borderBottom:"2px solid rgba(255,59,48,0.45)",
          padding:"9px 24px",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          position:"sticky", top:0, zIndex:100,
        }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0, overflow:"hidden" }}>
            <span style={{
              width:9, height:9, flexShrink:0, borderRadius:"50%",
              background:"#FF3B30", boxShadow:"0 0 8px rgba(255,59,48,0.7)",
              display:"inline-block", animation:"blink 1.2s infinite",
            }}/>
            <span style={{
              flexShrink:0, background:"rgba(255,59,48,0.15)", color:"#CC2A20",
              border:"1px solid rgba(255,59,48,0.35)", padding:"2px 8px",
              borderRadius:4, fontSize:10, fontWeight:700, textTransform:"uppercase",
            }}>{topAlert.severity}</span>
            <span style={{
              fontSize:13, fontWeight:500, color:"#3A0A08",
              whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
            }}>
              {cleanDesc(topAlert.description).slice(0,100)}
            </span>
          </div>
          <button onClick={() => setModalOpen(true)} style={{
            flexShrink:0, marginLeft:16,
            background:"#FF3B30", color:"#fff", border:"none",
            padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
            boxShadow:"0 2px 8px rgba(255,59,48,0.4)",
          }}>🛡 Tackle Threat</button>
        </div>
      )}

      {/* NAVBAR — solid white, no transparency */}
      <header style={{
        background:"#FFFFFF",
        borderBottom:"1px solid #D1D1D6",
        padding:"11px 24px",
        display:"flex", alignItems:"center", justifyContent:"space-between",
        position:"sticky", top:bannerH, zIndex:90,
        boxShadow:"0 1px 4px rgba(0,0,0,0.06)",
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{
            width:32, height:32,
            background:"rgba(0,122,255,0.1)", border:"1px solid rgba(0,122,255,0.25)",
            borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center",
            color:"#007AFF", fontWeight:700, fontSize:12,
          }}>SOT</div>
          <span style={{ fontSize:17, fontWeight:700, letterSpacing:"-0.3px", color:"#1C1C1E" }}>SentinelOT</span>
          <span style={{
            fontSize:11, padding:"3px 10px", borderRadius:20,
            background:"rgba(52,199,89,0.10)", color:"#1A7A34",
            border:"1px solid rgba(52,199,89,0.3)", fontWeight:600,
          }}>● LIVE</span>
        </div>

        <nav style={{ display:"flex", background:"#F2F2F7", padding:4, borderRadius:12, border:"1px solid #D1D1D6", gap:4 }}>
          {(["live","history"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: tab===t ? "#FFFFFF" : "transparent",
              border: tab===t ? "1px solid #D1D1D6" : "1px solid transparent",
              color: tab===t ? "#1C1C1E" : "#6C6C70",
              padding:"6px 20px", borderRadius:8, fontSize:13,
              fontWeight: tab===t ? 600 : 500, cursor:"pointer",
              boxShadow: tab===t ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
            }}>
              {t==="live" ? "Live Command" : "Historical Analytics"}
            </button>
          ))}
        </nav>

        <div style={{ display:"flex", gap:20, fontSize:11, color:"#6C6C70", fontFamily:"'JetBrains Mono',monospace" }}>
          <span>ZEEK <span style={{ color:"#007AFF", fontWeight:700 }}>ACTIVE</span></span>
          <span>KAFKA <span style={{ color:"#34C759", fontWeight:700 }}>OK</span></span>
          <span>LLM <span style={{ color:"#FF9500", fontWeight:700 }}>LOCAL</span></span>
        </div>
      </header>

      <main style={{ padding:24, maxWidth:1600, margin:"0 auto", width:"100%", flex:1 }}>
        {tab==="live" ? <LiveView card={card} /> : <HistoryView card={card} />}
      </main>

      {/* MODAL */}
      {modalOpen && topAlert && (
        <div onClick={() => setModalOpen(false)} style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.35)",
          display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:16,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background:"#FFFFFF", border:"1px solid #D1D1D6", borderRadius:20,
            maxWidth:640, width:"100%", padding:28,
            boxShadow:"0 20px 60px rgba(0,0,0,0.18)",
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", borderBottom:"1px solid #E5E5EA", paddingBottom:16, marginBottom:20 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <span style={{ fontSize:22 }}>🚨</span>
                <div>
                  <div style={{ fontSize:15, fontWeight:700, color:"#1C1C1E" }}>Alert Triage — LLM Analysis</div>
                  <div style={{ fontSize:11, color:"#6C6C70" }}>AI explanation layer · detection grounded in sensor rules</div>
                </div>
              </div>
              <button onClick={() => setModalOpen(false)} style={{
                background:"#F2F2F7", border:"1px solid #D1D1D6", color:"#1C1C1E",
                width:32, height:32, borderRadius:8, cursor:"pointer", fontSize:16,
              }}>✕</button>
            </div>
            {[
              { color:"#CC2A20", bg:"rgba(255,59,48,0.06)",  border:"rgba(255,59,48,0.2)",  label:"WHAT IS OCCURRING?",  body: cleanDesc(topAlert.description) },
              { color:"#0055CC", bg:"rgba(0,122,255,0.05)",  border:"rgba(0,122,255,0.2)",  label:"LLM EXPLANATION",     body: topAlert.llm_explanation || "Triage pending from local LLM…" },
              { color:"#1A7A34", bg:"rgba(52,199,89,0.06)",  border:"rgba(52,199,89,0.2)",  label:"RECOMMENDED ACTION",  body:"1. Verify source device authorization.\n2. Review recent config changes against approved baseline.\n3. If unauthorized, isolate endpoint and follow incident-response runbook." },
            ].map(s => (
              <div key={s.label} style={{ padding:14, borderRadius:10, fontSize:13, marginBottom:12, lineHeight:1.6, background:s.bg, border:`1px solid ${s.border}` }}>
                <div style={{ color:s.color, fontSize:10, fontWeight:700, letterSpacing:"0.5px", marginBottom:6 }}>{s.label}</div>
                <span style={{ color:"#3A3A3C", whiteSpace:"pre-line" }}>{s.body}</span>
              </div>
            ))}
            <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:20 }}>
              <button onClick={() => setModalOpen(false)} style={{ background:"#F2F2F7", border:"1px solid #D1D1D6", color:"#1C1C1E", padding:"8px 18px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer" }}>Dismiss</button>
              <button onClick={() => setModalOpen(false)} style={{ background:"#FF3B30", color:"#fff", border:"none", padding:"8px 18px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer" }}>Acknowledge & Log</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
