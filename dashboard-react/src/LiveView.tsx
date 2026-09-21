import { useEffect, useState } from "react";
import { fetchAlerts, fetchAssets, Alert, Asset } from "./api";

export default function LiveView() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [lastUpdated, setLastUpdated] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function refresh() {
    try {
      const [a, s] = await Promise.all([fetchAlerts(), fetchAssets()]);
      setAlerts(a); setAssets(s);
      setLastUpdated(new Date().toLocaleTimeString());
      setError("");
    } catch (e: any) { setError(e.message); }
  }

  useEffect(() => { refresh(); const id = setInterval(refresh, 5000); return () => clearInterval(id); }, []);

  const sevColor: Record<string, string> = { critical: "#ff6b81", high: "#ffab5e", medium: "#ffd85e", low: "#5ea8ff" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
        <span style={{ color: "#4ade80", fontWeight: 600, fontSize: 13 }}>LIVE</span>
        <span style={{ color: "#8a8f98", fontSize: 12 }}>auto-refreshing every 5s — last updated {lastUpdated}</span>
      </div>
      {error && <div style={{ color: "#ff6b81" }}>Error: {error}</div>}

      <div style={{ background: "#171a21", border: "1px solid #262b36", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "#8a8f98" }}>Current Open Alerts ({alerts.filter(a => a.status === "open").length})</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ color: "#8a8f98", textAlign: "left" }}>
            <th style={{ padding: 8 }}>Time</th><th>Severity</th><th>Description</th><th>Explanation</th><th>Status</th>
          </tr></thead>
          <tbody>
            {alerts.filter(a => a.status === "open").map(a => (
              <tr key={a.id} style={{ borderTop: "1px solid #1e222b" }}>
                <td style={{ padding: 8 }}>{new Date(a.time).toLocaleString()}</td>
                <td><span style={{ color: sevColor[a.severity], fontWeight: 600, textTransform: "uppercase", fontSize: 11 }}>{a.severity}</span></td>
                <td>{a.description}</td>
                <td style={{ maxWidth: 300 }}>{a.llm_explanation || <em>pending...</em>}</td>
                <td>{a.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ background: "#171a21", border: "1px solid #262b36", borderRadius: 8, padding: 16 }}>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "#8a8f98" }}>Current Asset Inventory ({assets.length} devices)</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ color: "#8a8f98", textAlign: "left" }}>
            <th style={{ padding: 8 }}>IP Address</th><th>Role</th><th>Protocols</th><th>First Seen</th><th>Last Seen</th>
          </tr></thead>
          <tbody>
            {assets.map(a => (
              <tr key={a.ip_address} style={{ borderTop: "1px solid #1e222b" }}>
                <td style={{ padding: 8 }}>{a.ip_address}</td><td>{a.device_role}</td>
                <td>{(a.protocols || []).join(", ") || "-"}</td>
                <td>{new Date(a.first_seen).toLocaleString()}</td>
                <td>{new Date(a.last_seen).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
