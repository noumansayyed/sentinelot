import { useState } from "react";
import LiveView from "./LiveView";
import HistoryView from "./HistoryView";

export default function App() {
  const [tab, setTab] = useState<"live" | "history">("live");
  const btnStyle = (active: boolean) => ({
    padding: "8px 16px", borderRadius: 6, border: "1px solid #262b36",
    background: active ? "#2563eb" : "#171a21", color: "#e6e6e6",
    cursor: "pointer", fontSize: 13, marginRight: 8,
  });

  return (
    <div style={{ fontFamily: "-apple-system, Segoe UI, Roboto, sans-serif", color: "#e6e6e6", padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>SentinelOT</h1>
      <div style={{ color: "#8a8f98", fontSize: 13, marginBottom: 20 }}>Pune Pilot Plant — OT Security Monitoring</div>
      <div style={{ marginBottom: 20 }}>
        <button style={btnStyle(tab === "live")} onClick={() => setTab("live")}>Live Monitoring</button>
        <button style={btnStyle(tab === "history")} onClick={() => setTab("history")}>History &amp; Trends</button>
        <a href="/reports/compliance_report.html" target="_blank" style={{ color: "#5ea8ff", fontSize: 13, marginLeft: 8 }}>View Compliance Report ↗</a>
      </div>
      {tab === "live" ? <LiveView /> : <HistoryView />}
    </div>
  );
}
