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
  const open = alerts.filter(a => a.status === "open");
  const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
  open.forEach(a => { counts[a.severity] = (counts[a.severity] || 0) + 1; });

  const card = (label: string, value: string | number, color: string) => (
    <div style={{ background: "#171a21", border: "1px solid #262b36", borderRadius: 8, padding: "16px 20px", flex: 1, minWidth: 140 }}>
      <div style={{ color: "#8a8f98", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ color, fontSize: 28, fontWeight: 700, marginTop: 4 }}>{value}</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
        <span style={{ color: "#4ade80", fontWeight: 600, fontSize: 13 }}>LIVE</span>
        <span style={{ color: "#8a8f98", fontSize: 12 }}>auto-refreshing every 5s — last updated {lastUpdated}</span>
      </div>
      {error && <div style={{ color: "#ff6b81", marginBottom: 12 }}>Error: {error}</div>}

      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        {card("Devices Monitored", assets.length, "#5ea8ff")}
        {card("Open Alerts", open.length, "#e6e6e6")}
        {card("Critical", counts.critical || 0, "#ff6b81")}
        {card("High", counts.high || 0, "#ffab5e")}
        {card("Medium", counts.medium || 0, "#ffd85e")}
      </div>

      <div style={{ background: "#171a21", border: "1px solid #262b36", borderRadius: 8, padding: 16, marginBottom: 20 }}>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "#8a8f98", marginBottom: 12 }}>Current Open Alerts</h2>
        <div>
          {open.map((a, i) => (
            <div key={a.id} style={{ display: "flex", gap: 16, padding: "12px 0", borderTop: i === 0 ? "none" : "1px solid #1e222b" }}>
              <div style={{ width: 28, color: "#5a5f68", fontSize: 12, paddingTop: 2 }}>{i + 1}</div>
              <div style={{ width: 160, flexShrink: 0 }}>
                <div style={{ fontSize: 12, color: "#8a8f98" }}>{new Date(a.time).toLocaleDateString()}</div>
                <div style={{ fontSize: 12, color: "#8a8f98" }}>{new Date(a.time).toLocaleTimeString()}</div>
                <span style={{ display: "inline-block", marginTop: 4, color: sevColor[a.severity], fontWeight: 600, textTransform: "uppercase", fontSize: 11, border: `1px solid ${sevColor[a.severity]}`, borderRadius: 4, padding: "1px 6px" }}>{a.severity}</span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: "#e6e6e6", marginBottom: 4 }}>{a.description}</div>
                <div style={{ fontSize: 13, color: "#8a8f98", lineHeight: 1.5 }}>{a.llm_explanation || <em>explanation pending...</em>}</div>
              </div>
            </div>
          ))}
          {open.length === 0 && <div style={{ color: "#5a5f68", fontStyle: "italic", padding: "12px 0" }}>No open alerts.</div>}
        </div>
      </div>

      <div style={{ background: "#171a21", border: "1px solid #262b36", borderRadius: 8, padding: 16 }}>
        <h2 style={{ fontSize: 14, textTransform: "uppercase", color: "#8a8f98", marginBottom: 12 }}>Current Asset Inventory</h2>
        <table style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ color: "#8a8f98", textAlign: "left" }}>
            <th style={{ padding: 8, width: "4%" }}>#</th>
            <th style={{ padding: 8, width: "18%" }}>IP Address</th>
            <th style={{ padding: 8, width: "14%" }}>Role</th>
            <th style={{ padding: 8, width: "24%" }}>Protocols</th>
            <th style={{ padding: 8, width: "20%" }}>First Seen</th>
            <th style={{ padding: 8, width: "20%" }}>Last Seen</th>
          </tr></thead>
          <tbody>
            {assets.map((a, i) => (
              <tr key={a.ip_address} style={{ borderTop: "1px solid #1e222b" }}>
                <td style={{ padding: 8, color: "#5a5f68" }}>{i + 1}</td>
                <td style={{ padding: 8 }}>{a.ip_address}</td>
                <td style={{ padding: 8 }}>{a.device_role}</td>
                <td style={{ padding: 8 }}>{(a.protocols || []).join(", ") || "-"}</td>
                <td style={{ padding: 8 }}>{new Date(a.first_seen).toLocaleString()}</td>
                <td style={{ padding: 8 }}>{new Date(a.last_seen).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
