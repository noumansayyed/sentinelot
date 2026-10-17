import { useEffect, useState } from "react";
import { fetchReportData, ReportData, SITE_ID } from "./api";

export default function ReportsView({ card }: { card: React.CSSProperties }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    try {
      setData(await fetchReportData(SITE_ID));
      setErr("");
    } catch (e: any) { setErr(e.message); }
  }

  useEffect(() => { load(); }, []);

  if (err) return <div style={{ color: "var(--danger)", padding: 20 }}>⚠ {err}</div>;
  if (!data) return <div style={{ color: "var(--text-3)", padding: 20 }}>Loading report data…</div>;

  return (
    <div className="float-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      
      {/* HEADER */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="t-h1" style={{ margin: 0 }}>Compliance Report</h1>
          <div className="t-meta" style={{ marginTop: 8 }}>CERT-In / DPDPA aligned snapshot · {new Date(data.generated_at).toLocaleString()}</div>
        </div>
        <button onClick={() => window.print()} className="btn btn-primary">
          Print / Save as PDF
        </button>
      </div>

      {/* REPORT BODY */}
      <div className="glass print-target" style={{ padding: 40, background: "#fff", color: "#1c1c1e" }}>
        
        <div style={{ borderBottom: "3px solid #0a84ff", paddingBottom: 16, marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "#0a84ff",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 16, fontWeight: 800, color: "#fff" }}>S</div>
            <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.4px", color: "#1c1c1e" }}>SentinelOT</span>
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: "-0.5px" }}>SentinelOT — Compliance Report</h1>
          <div style={{ color: "#6e6e73", fontSize: 12, marginTop: 8 }}>
            Site: <strong>{data.site_name}</strong> · Generated: {new Date(data.generated_at).toUTCString()}<br/>
            Framework: CERT-In Guidelines · DPDPA · 30-day window
          </div>
        </div>

        {/* SUMMARY */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
          <div style={{ border: "1px solid #e5e5ea", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#6e6e73", fontWeight: 600 }}>Monitored Assets</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{data.assets.length}</div>
          </div>
          <div style={{ border: "1px solid #e5e5ea", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#6e6e73", fontWeight: 600 }}>Alerts (30d)</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{data.alerts.length}</div>
          </div>
          <div style={{ border: "1px solid #e5e5ea", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#6e6e73", fontWeight: 600 }}>Open Alerts</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{data.alerts.filter((a:any) => a.status === 'open').length}</div>
          </div>
          <div style={{ border: "1px solid #e5e5ea", borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "#6e6e73", fontWeight: 600 }}>Protocol Events (7d)</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 8 }}>{data.events.reduce((acc:number, e:any) => acc + parseInt(e.cnt), 0)}</div>
          </div>
        </div>

        {/* ASSETS */}
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 36, marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #e5e5ea" }}>1. Monitored Asset Inventory</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f5f5f7", textAlign: "left" }}>
              <th style={{ padding: "10px 12px", color: "#3a3a3c", borderBottom: "2px solid #e5e5ea" }}>IP Address</th>
              <th style={{ padding: "10px 12px", color: "#3a3a3c", borderBottom: "2px solid #e5e5ea" }}>MAC</th>
              <th style={{ padding: "10px 12px", color: "#3a3a3c", borderBottom: "2px solid #e5e5ea" }}>Role</th>
              <th style={{ padding: "10px 12px", color: "#3a3a3c", borderBottom: "2px solid #e5e5ea" }}>Protocols</th>
              <th style={{ padding: "10px 12px", color: "#3a3a3c", borderBottom: "2px solid #e5e5ea" }}>Criticality</th>
            </tr>
          </thead>
          <tbody>
            {data.assets.length === 0 ? <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#6e6e73" }}>No assets discovered.</td></tr> :
              data.assets.map((a:any, i:number) => (
                <tr key={i} style={{ borderBottom: "1px solid #f0f0f2" }}>
                  <td style={{ padding: "10px 12px", fontWeight: 600 }}>{a.ip.replace('/32','')}</td>
                  <td style={{ padding: "10px 12px" }}>{a.mac || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{a.role}</td>
                  <td style={{ padding: "10px 12px" }}>{a.protocols.join(", ")}</td>
                  <td style={{ padding: "10px 12px" }}>{a.criticality}</td>
                </tr>
              ))
            }
          </tbody>
        </table>

        {/* ALERTS */}
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 36, marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid #e5e5ea" }}>2. Security Alerts (last 30 days)</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f5f5f7", textAlign: "left" }}>
              <th style={{ padding: "10px 12px", color: "#3a3a3c", borderBottom: "2px solid #e5e5ea" }}>Time</th>
              <th style={{ padding: "10px 12px", color: "#3a3a3c", borderBottom: "2px solid #e5e5ea" }}>Severity</th>
              <th style={{ padding: "10px 12px", color: "#3a3a3c", borderBottom: "2px solid #e5e5ea" }}>Status</th>
              <th style={{ padding: "10px 12px", color: "#3a3a3c", borderBottom: "2px solid #e5e5ea" }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {data.alerts.length === 0 ? <tr><td colSpan={4} style={{ padding: 20, textAlign: "center", color: "#6e6e73" }}>No alerts.</td></tr> :
              data.alerts.map((a:any, i:number) => (
                <tr key={i} style={{ borderBottom: "1px solid #f0f0f2" }}>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>{new Date(a.time).toLocaleString()}</td>
                  <td style={{ padding: "10px 12px", fontWeight: 700 }}>{a.severity.toUpperCase()}</td>
                  <td style={{ padding: "10px 12px" }}>{a.status}</td>
                  <td style={{ padding: "10px 12px" }}>{a.description}</td>
                </tr>
              ))
            }
          </tbody>
        </table>

        {/* FOOTER */}
        <div style={{ marginTop: 48, paddingTop: 16, borderTop: "1px solid #e5e5ea", fontSize: 11, color: "#6e6e73" }}>
          <p><strong>Scope note:</strong> This report documents OT network monitoring activity and security events. It is designed to support compliance documentation under CERT-In and DPDPA.</p>
          <p><strong>Methodology:</strong> Passive network monitoring via Zeek and Suricata. No active scanning is performed.</p>
        </div>

      </div>
    </div>
  );
}
