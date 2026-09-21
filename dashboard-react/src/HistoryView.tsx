import { useEffect, useState } from "react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { fetchAlerts, Alert } from "./api";

export default function HistoryView() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  useEffect(() => { fetchAlerts().then(setAlerts); }, []);

  const bySeverity: Record<string, number> = {};
  alerts.forEach(a => { bySeverity[a.severity] = (bySeverity[a.severity] || 0) + 1; });
  const severityData = Object.entries(bySeverity).map(([severity, count]) => ({ severity, count }));

  const byDay: Record<string, number> = {};
  alerts.forEach(a => {
    const day = new Date(a.time).toLocaleDateString();
    byDay[day] = (byDay[day] || 0) + 1;
  });
  const trendData = Object.entries(byDay).map(([day, count]) => ({ day, count })).reverse();

  const firstDate = alerts.length ? new Date(Math.min(...alerts.map(a => new Date(a.time).getTime()))).toLocaleDateString() : "-";

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#5ea8ff", display: "inline-block" }} />
        <span style={{ color: "#5ea8ff", fontWeight: 600, fontSize: 13 }}>HISTORICAL RECORD</span>
        <span style={{ color: "#8a8f98", fontSize: 12 }}>data recorded since {firstDate} — not live, does not auto-refresh</span>
      </div>

      <div style={{ background: "#171a21", border: "1px solid #262b36", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "#8a8f98" }}>Alert Volume Over Time (actual recorded counts)</h2>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={trendData}>
            <CartesianGrid stroke="#262b36" />
            <XAxis dataKey="day" stroke="#8a8f98" fontSize={11} />
            <YAxis stroke="#8a8f98" fontSize={11} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#171a21", border: "1px solid #262b36" }} />
            <Line type="monotone" dataKey="count" stroke="#5ea8ff" strokeWidth={2} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div style={{ background: "#171a21", border: "1px solid #262b36", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "#8a8f98" }}>Alerts by Severity (total, all recorded)</h2>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={severityData}>
            <CartesianGrid stroke="#262b36" />
            <XAxis dataKey="severity" stroke="#8a8f98" fontSize={11} />
            <YAxis stroke="#8a8f98" fontSize={11} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "#171a21", border: "1px solid #262b36" }} />
            <Bar dataKey="count" fill="#ffab5e" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{ background: "#171a21", border: "1px solid #262b36", borderRadius: 8, padding: 16 }}>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "#8a8f98" }}>Full Alert History ({alerts.length} records)</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ color: "#8a8f98", textAlign: "left" }}><th style={{ padding: 8 }}>Time</th><th>Severity</th><th>Description</th><th>Status</th></tr></thead>
          <tbody>
            {alerts.map(a => (
              <tr key={a.id} style={{ borderTop: "1px solid #1e222b" }}>
                <td style={{ padding: 8 }}>{new Date(a.time).toLocaleString()}</td>
                <td>{a.severity}</td><td>{a.description}</td><td>{a.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
