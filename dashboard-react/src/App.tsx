import { useState, useEffect } from "react";
import { SiteProvider, useSite } from "./SiteContext";
import "./index.css";
import "./theme.css";
import OperationsView from "./OperationsView";
import AlertsView from "./AlertsView";
import HistoryView from "./HistoryView";
import AuditView from "./AuditView";
import SettingsView from "./SettingsView";
import SitesView from "./SitesView";
import ReportsView from "./ReportsView";
import OnboardingView from "./OnboardingView";
import ThemeToggle, { useTheme } from "./ThemeToggle";
import { fetchOperations, getSiteId } from "./api";

type Tab = "operations" | "alerts" | "history" | "compliance" | "audit" | "settings" | "sites";

const card: React.CSSProperties = {};

const TAB_LABELS: Record<Tab, string> = {
  operations: "Operations",
  alerts:     "Alerts",
  history:    "History",
  compliance: "Reports",
  audit:      "Audit Log",
  settings:   "Settings",
  sites:      "Sites",
};

function AppShell() {
  useTheme();
  const { sites, currentSite, loading, error, selectSite, refreshSites } = useSite();
  const [tab, setTab] = useState<Tab>("operations");
  const [alertBadge, setBadge] = useState<number>(0);
  const [health, setHealth] = useState<any>(null);

  // Poll operations / health only when a site is selected
  useEffect(() => {
    if (!currentSite) return;
    let mounted = true;
    async function tick() {
      try {
        const sid = currentSite.id;
        const ops = await fetchOperations(sid);
        if (mounted) setBadge(ops.alert_summary?.critical_high_open ?? 0);
      } catch {}
    }
    tick();
    const id = setInterval(tick, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, [currentSite]);

  useEffect(() => {
    const poll = () => {
      fetch("http://localhost:8000/health/components")
        .then(r => r.json())
        .then(setHealth)
        .catch(() => {});
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return <div style={{ padding: 80, textAlign: "center" }}>Loading…</div>;
  }
  if (error) {
    return <div style={{ padding: 80, textAlign: "center", color: "#ef4444" }}>Error: {error}</div>;
  }
  if (sites.length === 0) {
    return <OnboardingView card={card} />;
  }
  if (!currentSite) {
    return (
      <div style={{ padding: 80, display: "flex", flexDirection: "column",
        alignItems: "center", gap: 16 }}>
        <h2>Select a site</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 320 }}>
          {sites.map(s => (
            <button key={s.id} className="btn" onClick={() => selectSite(s.id)}
              style={{ padding: "12px 16px", textAlign: "left" }}>
              {s.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* header */}
      <div className="no-print" style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 24px", borderBottom: "1px solid var(--border-soft)",
        background: "var(--surface-1)",
        backdropFilter: "blur(40px) saturate(180%)",
        WebkitBackdropFilter: "blur(40px) saturate(180%)",
        position: "fixed", top: 0, left: 0, right: 0,
        zIndex: 200, height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>SentinelOT</div>
          <div style={{ color: "var(--text-3)", fontSize: 13 }}>{currentSite.name}</div>
          {sites.length > 1 && (
            <select
              value={currentSite.id}
              onChange={e => { selectSite(e.target.value); }}
              style={{ padding: "4px 8px", fontSize: 12, borderRadius: 6,
                border: "1px solid var(--hairline)", background: "var(--bg-1)",
                color: "var(--text-1)" }}
            >
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 12 }}>
          {[
            { key: "zeek",        label: "Zeek"        },
            { key: "kafka",       label: "Kafka"       },
            { key: "zeek_bridge", label: "zeek-bridge" },
            { key: "conn_bridge", label: "conn-bridge" },
            { key: "llm",         label: "LLM"         },
          ].map(({ key, label }) => {
            const s = health?.[key as keyof typeof health];
            const state = (s as any)?.state || "offline";
            const color =
              state === "active" ? "var(--success)" :
              state === "idle"   ? "var(--warning)" :
                                   "var(--danger)";
            return (
              <span key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="status-dot" data-live={state === "active" ? "true" : "false"}
                  style={{ background: color, color }} />
                {label}
              </span>
            );
          })}
          <ThemeToggle />
        </div>
      </div>

      {/* tabs */}
      <div className="no-print" style={{
        display: "flex", gap: 4, padding: "0 24px",
        borderBottom: "1px solid var(--border-soft)",
        background: "var(--surface-1)", backdropFilter: "blur(40px) saturate(180%)",
        WebkitBackdropFilter: "blur(40px) saturate(180%)",
        position: "fixed", top: 56, left: 0, right: 0, zIndex: 199 }}>
        {(["operations","alerts","history","compliance","audit","settings","sites"] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: "14px 20px", background: "transparent", border: "none",
              color: tab === t ? "var(--accent)" : "var(--text-3)",
              fontWeight: tab === t ? 700 : 500, fontSize: 13, cursor: "pointer",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: "-1px", position: "relative", transition: "color 120ms" }}>
            {TAB_LABELS[t]}
            {t === "alerts" && alertBadge > 0 && (
              <span style={{ display: "inline-block", marginLeft: 8, padding: "1px 7px",
                borderRadius: 999, background: "var(--danger)", color: "#fff",
                fontSize: 10, fontWeight: 700 }}>{alertBadge}</span>
            )}
          </button>
        ))}
      </div>

      {/* view */}
      <div key={tab} className="tab-view"
        style={{ padding: 28, maxWidth: 1600, margin: "0 auto", paddingTop: 144 }}>
        {tab === "operations" && <OperationsView card={card} />}
        {tab === "alerts"     && <AlertsView     card={card} />}
        {tab === "history"    && <HistoryView    card={card} />}
        {tab === "audit"      && <AuditView      card={card} />}
        {tab === "settings"   && <SettingsView   card={card} />}
        {tab === "sites"      && <SitesView      card={card} />}
        {tab === "compliance" && <ReportsView    card={card} />}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <SiteProvider>
      <AppShell />
    </SiteProvider>
  );
}
