import { useEffect, useState } from "react";

export default function ReportsView({ card }: { card: React.CSSProperties }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [empty, setEmpty] = useState(false);

  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);

  async function generateReport() {
    setLoading(true);
    setErr("");
    setEmpty(false);
    setData(null);
    try {
      const res = await fetch(`http://localhost:8000/v1/sites/22222222-2222-2222-2222-222222222222/reports/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_date: new Date(startDate).toISOString(),
          end_date: new Date(endDate + "T23:59:59").toISOString(),
          actor: "operator"
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();

      // CHECK: if assets and alerts are both empty, show "no data"
      if (json.assets.length === 0 && json.alerts.length === 0) {
        setEmpty(true);
        setData(null);
      } else {
        setData(json);
        setEmpty(false);
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="float-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 className="t-h1" style={{ margin: 0 }}>Compliance Reports</h1>
      </div>

      {err && <div style={{ color: "var(--danger)", fontSize: 14 }}>⚠ {err}</div>}

      {/* CONTROLS */}
      <div className="glass no-print" style={{ padding: 20, display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
        <div>
          <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 6 }}>Start Date</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            style={{ background: "var(--glass-2)", border: "1px solid var(--hairline-light)", padding: "10px 14px", borderRadius: 10, color: "var(--text-1)", fontSize: 14 }} />
        </div>
        <div>
          <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 6 }}>End Date</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            style={{ background: "var(--glass-2)", border: "1px solid var(--hairline-light)", padding: "10px 14px", borderRadius: 10, color: "var(--text-1)", fontSize: 14 }} />
        </div>
        <button onClick={generateReport} disabled={loading} className="btn btn-primary" style={{ padding: "12px 28px", fontSize: 14 }}>
          {loading ? "Generating…" : "Generate Report"}
        </button>
        <div style={{ flex: 1 }} />
        {data && <button onClick={() => window.print()} className="btn" style={{ padding: "12px 20px", fontSize: 14 }}>🖨 Print / Save as PDF</button>}
      </div>

      {/* EMPTY STATE */}
      {empty && (
        <div className="glass" style={{ padding: 60, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
          <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text-1)", marginBottom: 8 }}>
            No data available for this period
          </div>
          <div style={{ fontSize: 14, color: "var(--text-3)" }}>
            There were no assets, alerts, or events recorded between <strong>{new Date(startDate).toLocaleDateString()}</strong> and <strong>{new Date(endDate).toLocaleDateString()}</strong>.
          </div>
          <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 12 }}>
            Try selecting a different date range.
          </div>
        </div>
      )}

      {/* DETAILED REPORT */}
      {data && (
        <div className="glass print-target" style={{ padding: 48 }}>
          {/* Header */}
          <div style={{ borderBottom: "3px solid var(--accent)", paddingBottom: 20, marginBottom: 36 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: "#fff" }}>S</div>
              <span style={{ fontSize: 22, fontWeight: 800 }}>SentinelOT</span>
            </div>
            <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700 }}>Compliance Report</h1>
            <div style={{ color: "var(--text-3)", fontSize: 13, marginTop: 10 }}>
              <strong>Period:</strong> {new Date(data.period.start).toLocaleDateString()} – {new Date(data.period.end).toLocaleDateString()} · <strong>Generated:</strong> {new Date().toLocaleString()} · <strong>By:</strong> operator
            </div>
            <div style={{ color: "var(--text-3)", fontSize: 12, marginTop: 6 }}>
              Framework: CERT-In Guidelines · DPDPA (Digital Personal Data Protection Act)
            </div>
          </div>

          {/* Summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 40 }}>
            {[
              { label: "MONITORED ASSETS", value: data.assets.length, color: "var(--accent)" },
              { label: "SECURITY ALERTS", value: data.alerts.length, color: "var(--warning)" },
              { label: "PROTOCOL EVENTS", value: data.events.reduce((a: number, e: any) => a + Number(e.cnt), 0), color: "var(--success)" },
              { label: "PERIOD (DAYS)", value: Math.ceil((new Date(data.period.end).getTime() - new Date(data.period.start).getTime()) / 86400000), color: "var(--violet)" },
            ].map(c => (
              <div key={c.label} style={{ border: "1px solid var(--hairline-light)", borderRadius: 12, padding: 20, background: "var(--glass-2)" }}>
                <div style={{ fontSize: 10, color: "var(--text-3)", fontWeight: 600, letterSpacing: "0.5px" }}>{c.label}</div>
                <div style={{ fontSize: 36, fontWeight: 700, marginTop: 8, color: c.color, fontFamily: "'JetBrains Mono', monospace" }}>{c.value.toLocaleString()}</div>
              </div>
            ))}
          </div>

          {/* Section 1: Assets */}
          <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 40, marginBottom: 16, paddingBottom: 10, borderBottom: "1px solid var(--hairline-light)" }}>
            1. Monitored Asset Inventory
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--glass-2)", textAlign: "left" }}>
                <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>IP Address</th>
                <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>MAC</th>
                <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>Role</th>
                <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>Protocols</th>
                <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>Criticality</th>
                <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>First Seen</th>
                <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {data.assets.map((a: any, i: number) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--hairline-light)" }}>
                  <td style={{ padding: 12, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace" }}>{a.ip.replace('/32','')}</td>
                  <td style={{ padding: 12, fontFamily: "'JetBrains Mono', monospace" }}>{a.mac || "—"}</td>
                  <td style={{ padding: 12 }}>{a.role}</td>
                  <td style={{ padding: 12 }}>{a.protocols.join(", ")}</td>
                  <td style={{ padding: 12 }}>{a.criticality}</td>
                  <td style={{ padding: 12, color: "var(--text-3)" }}>{a.first_seen ? new Date(a.first_seen).toLocaleDateString() : "—"}</td>
                  <td style={{ padding: 12, color: "var(--text-3)" }}>{a.last_seen ? new Date(a.last_seen).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Section 2: Alerts */}
          <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 40, marginBottom: 16, paddingBottom: 10, borderBottom: "1px solid var(--hairline-light)" }}>
            2. Security Alerts ({data.alerts.length})
          </h2>
          {data.alerts.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)", fontStyle: "italic", background: "var(--glass-2)", borderRadius: 10 }}>
              No security alerts recorded in this period. The network was clean.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "var(--glass-2)", textAlign: "left" }}>
                  <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>Time</th>
                  <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>Severity</th>
                  <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>Status</th>
                  <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {data.alerts.map((a: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--hairline-light)" }}>
                    <td style={{ padding: 12, whiteSpace: "nowrap", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{new Date(a.time).toLocaleString()}</td>
                    <td style={{ padding: 12 }}>
                      <span style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                        background: a.severity === "critical" ? "rgba(255,69,58,0.15)" : a.severity === "high" ? "rgba(255,159,10,0.15)" : "rgba(255,214,10,0.15)",
                        color: a.severity === "critical" ? "var(--danger)" : a.severity === "high" ? "var(--warning)" : "#FFD60A" }}>
                        {a.severity}
                      </span>
                    </td>
                    <td style={{ padding: 12 }}>{a.status}</td>
                    <td style={{ padding: 12 }}>{a.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Section 3: Protocol Events */}
          <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 40, marginBottom: 16, paddingBottom: 10, borderBottom: "1px solid var(--hairline-light)" }}>
            3. Protocol Activity
          </h2>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--glass-2)", textAlign: "left" }}>
                <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>Protocol</th>
                <th style={{ padding: 12, color: "var(--text-2)", fontWeight: 600 }}>Events</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e: any, i: number) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--hairline-light)" }}>
                  <td style={{ padding: 12, fontWeight: 600 }}>{e.protocol}</td>
                  <td style={{ padding: 12, fontFamily: "'JetBrains Mono', monospace" }}>{Number(e.cnt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Footer */}
          <div style={{ marginTop: 48, paddingTop: 20, borderTop: "1px solid var(--hairline-light)", fontSize: 11, color: "var(--text-3)" }}>
            <p><strong>Scope:</strong> This report documents OT network monitoring activity and security events captured by SentinelOT. It supports CERT-In incident-reporting guidelines and DPDPA breach-notification relevance.</p>
            <p><strong>Methodology:</strong> Passive network monitoring via Zeek + Suricata with ICS protocol parsers. No active scanning or packet injection.</p>
            <p style={{ marginTop: 12 }}>Generated by SentinelOT · {new Date().toLocaleString()}</p>
          </div>
        </div>
      )}
    </div>
  );
}
