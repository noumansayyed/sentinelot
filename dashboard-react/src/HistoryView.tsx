import { useEffect, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { fetchAlerts, Alert } from "./api";
import { REGISTRY, HAS_REG, isKnown } from "./api";

export default function HistoryView({ card }: { card: React.CSSProperties }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    fetchAlerts().then(setAlerts).catch(() => setAlerts([]));
  }, []);

  const bySeverity: Record<string, number> = {};
  alerts.forEach(a => { bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1; });
  const severityData = Object.entries(bySeverity).map(([severity, count]) => ({ severity, count }));

  const byDay: Record<string, number> = {};
  alerts.forEach(a => {
    const d = new Date(a.time).toLocaleDateString();
    byDay[d] = (byDay[d] || 0) + 1;
  });
  const trendData = Object.entries(byDay)
    .map(([day, count]) => ({ day, count }))
    .reverse();
  const firstDate = alerts.length
    ? new Date(Math.min(...alerts.map(a => new Date(a.time).getTime()))).toLocaleDateString()
    : "-";

  return (
    <div className="float-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      <div>
        <h1 className="t-h1" style={{ margin: 0 }}>History &amp; Trends</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span className="status-dot" style={{ background: "var(--accent)", color: "var(--accent)" }}/>
          <span style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>HISTORICAL RECORD</span>
          <span className="t-meta">recorded since {firstDate} — not live, does not auto-refresh</span>
        </div>
      </div>

      <div className="glass" style={{ padding: 24 }}>
        <div className="t-h3" style={{ marginBottom: 16 }}>Alert Volume Over Time</div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={trendData}>
            <CartesianGrid stroke="var(--hairline-light)" strokeDasharray="3 3"/>
            <XAxis dataKey="day" stroke="var(--text-3)" fontSize={12}/>
            <YAxis stroke="var(--text-3)" fontSize={12} allowDecimals={false}/>
            <Tooltip
              contentStyle={{
                background: "var(--glass-3)",
                border: "1px solid var(--hairline-strong)",
                borderRadius: 10,
                color: "var(--text-1)",
              }}
            />
            <Line type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }}/>
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="glass" style={{ padding: 24 }}>
        <div className="t-h3" style={{ marginBottom: 16 }}>Alerts by Severity (total, all recorded)</div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={severityData}>
            <CartesianGrid stroke="var(--hairline-light)" strokeDasharray="3 3"/>
            <XAxis dataKey="severity" stroke="var(--text-3)" fontSize={12}/>
            <YAxis stroke="var(--text-3)" fontSize={12} allowDecimals={false}/>
            <Tooltip
              contentStyle={{
                background: "var(--glass-3)",
                border: "1px solid var(--hairline-strong)",
                borderRadius: 10,
                color: "var(--text-1)",
              }}
            />
            <Bar dataKey="count" fill="var(--warning)" radius={[6, 6, 0, 0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="glass" style={{ padding: 24 }}>
        <div className="t-h3" style={{ marginBottom: 16 }}>
          Full Alert History ({alerts.length} records)
        </div>
        <div style={{ maxHeight: 420, overflowY: "auto" }}>
          {alerts.map((a, i) => {
            const dev = REGISTRY[a.description.match(/\b(172\.\d+\.\d+\.\d+)\b/)?.[1] || ""];
            const known = isKnown(a.description.match(/\b(172\.\d+\.\d+\.\d+)\b/)?.[1] || "");
            return (
              <div key={a.id}
                   style={{ display: "flex", gap: 14, padding: "12px 0",
                            borderTop: i === 0 ? "none" : "1px solid var(--hairline-soft)",
                            alignItems: "flex-start" }}>
                <span className="t-meta" style={{ width: 32, flexShrink: 0 }}>{i + 1}</span>
                <span className="t-mono" style={{ color: "var(--text-3)", width: 170, flexShrink: 0, fontSize: 13 }}>
                  {new Date(a.time).toLocaleString()}
                </span>
                <span style={{ width: 70, flexShrink: 0,
                                fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                                color: a.severity === "critical" ? "var(--danger)"
                                     : a.severity === "high" ? "var(--warning)"
                                     : "var(--text-3)" }}>
                  {a.severity}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "var(--text-1)", fontSize: 14 }}>{a.description}</div>
                  {dev && HAS_REG && (
                    <div style={{ marginTop: 4, fontSize: 12, color: "var(--text-3)" }}>
                      {dev.role}
                      {known ? (
                        <span style={{ color: "var(--success)", marginLeft: 8, fontWeight: 600 }}>KNOWN</span>
                      ) : (
                        <span style={{ color: "var(--danger)", marginLeft: 8, fontWeight: 600 }}>UNKNOWN</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {alerts.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
              No alert history yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
