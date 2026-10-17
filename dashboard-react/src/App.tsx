import { useState, useEffect } from "react";
import "./index.css";
import "./theme.css";
import OperationsView from "./OperationsView";
import AlertsView from "./AlertsView";
import HistoryView from "./HistoryView";
import AuditView from "./AuditView";
import ThemeToggle, { useTheme } from "./ThemeToggle";
import { fetchOperations, SITE_ID } from "./api";

type Tab = "operations" | "alerts" | "history" | "compliance" | "audit";

const card: React.CSSProperties = {};   // legacy — operations uses .glass now

const TAB_LABELS: Record<Tab, string> = {
  operations: "Operations",
  alerts:     "Alerts",
  history:    "History",
  compliance: "Compliance",
  audit:      "Audit Log",
};

export default function App() {
  useTheme();  // sets data-theme on <html>
  const [tab, setTab]           = useState<Tab>("operations");
  const [siteName, setSite]     = useState("…");
  const [alertBadge, setBadge]  = useState<number>(0);

  useEffect(() => {
    let mounted = true;
    async function tick() {
      try {
        const ops = await fetchOperations(SITE_ID);
        if (mounted) {
          setSite(ops.site.name);
          setBadge(ops.alert_summary.critical_high_open);
        }
      } catch {}
    }
    tick();
    const id = setInterval(tick, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  return (
    <div style={{ minHeight: "100vh", color: "var(--text-1)",
                  fontFamily: "var(--font-sans)", position: "relative" }}>
      <div className="app-bg" />

      {/* ---- top bar ---- */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "16px 28px", borderBottom: "1px solid var(--border-soft)",
                    background: "var(--surface-1)", backdropFilter: "blur(40px)",
                    WebkitBackdropFilter: "blur(40px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8,
                          background: "linear-gradient(135deg, var(--accent), var(--violet))",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 14, fontWeight: 800, color: "var(--text-1)" }}>S</div>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.4px" }}>SentinelOT</span>
          </div>
          <div style={{ width: 1, height: 20, background: "var(--border-light)" }} />
          <span style={{ color: "var(--text-2)", fontSize: 13 }}>{siteName}</span>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center", fontSize: 11, color: "var(--text-3)" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%",
                                                  background: "var(--success)", color: "var(--success)" }} />
            Zeek
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%",
                                                  background: "var(--success)", color: "var(--success)" }} />
            Kafka
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="pulse-dot" style={{ width: 6, height: 6, borderRadius: "50%",
                                                  background: "var(--success)", color: "var(--success)" }} />
            LLM
          </span>
          <ThemeToggle />
        </div>
      </div>

      {/* ---- tabs ---- */}
      <div style={{ display: "flex", gap: 4, padding: "0 24px",
                    borderBottom: "1px solid var(--border-soft)",
                    background: "var(--surface-1)", backdropFilter: "blur(40px)",
                    WebkitBackdropFilter: "blur(40px)", position: "sticky", top: 61, zIndex: 99 }}>
        {(["operations","alerts","history","compliance","audit"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "14px 20px", background: "transparent", border: "none",
                     color: tab === t ? "var(--accent)" : "var(--text-3)",
                     fontWeight: tab === t ? 700 : 500, fontSize: 13, cursor: "pointer",
                     borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                     marginBottom: "-1px", position: "relative", transition: "color 120ms" }}>
            {TAB_LABELS[t]}
            {t === "alerts" && alertBadge > 0 && (
              <span style={{ display: "inline-block", marginLeft: 8, padding: "1px 7px",
                             borderRadius: 999, background: "var(--danger)", color: "var(--text-1)",
                             fontSize: 10, fontWeight: 700 }}>{alertBadge}</span>
            )}
          </button>
        ))}
      </div>

      {/* ---- view ---- */}
      <div key={tab} className="tab-view"
           style={{ padding: 28, maxWidth: 1600, margin: "0 auto" }}>
        {tab === "operations" && <OperationsView card={card} />}
        {tab === "alerts"     && <AlertsView     card={card} />}
        {tab === "history"    && <HistoryView    card={card} />}
        {tab === "audit"      && <AuditView      card={card} />}
        {tab === "compliance" && (
          <div className="glass float-in" style={{ padding: 0, overflow: "hidden", minHeight: "80vh" }}>
            <div style={{ padding: "14px 22px", borderBottom: "1px solid var(--border-light)",
                          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 700 }}>CERT-In / DPDPA-aligned Compliance Report</span>
              <a href="/reports/compliance_report.html" target="_blank" rel="noreferrer"
                 style={{ color: "var(--accent)", fontSize: 12 }}>Open in new tab ↗</a>
            </div>
            <iframe src="/reports/compliance_report.html"
              style={{ width: "100%", height: "calc(100vh - 180px)", border: "none", background: "var(--text-1)" }}
              title="Compliance Report" />
          </div>
        )}
      </div>
    </div>
  );
}
