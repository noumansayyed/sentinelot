import { useState, useEffect } from "react";
import "./index.css";
import "./theme.css";
import OperationsView from "./OperationsView";
import AlertsView from "./AlertsView";
import HistoryView from "./HistoryView";
import AuditView from "./AuditView";
import ReportsView from "./ReportsView";
import ThemeToggle, { useTheme } from "./ThemeToggle";
import { fetchOperations, fetchSites, createSite, getEnrollmentToken, updateSite, SITE_ID } from "./api";

type Tab = "operations" | "alerts" | "history" | "compliance" | "audit";

const card: React.CSSProperties = {};

const TAB_LABELS: Record<Tab, string> = {
  operations: "Operations",
  alerts:     "Alerts",
  history:    "History",
  compliance: "Reports",
  audit:      "Audit Log",
};

export default function App() {
  useTheme();
  const [tab, setTab]           = useState<Tab>("operations");
  const [siteName, setSite]     = useState("…");
  const [sites, setSites] = useState<any[]>([]);
  const [showAddSite, setShowAddSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState("");
  const [newToken, setNewToken] = useState<string | null>(null);
  const [showEditSite, setShowEditSite] = useState(false);
  const [editSiteName, setEditSiteName] = useState("");
  const [selectedSite, setSelectedSite] = useState(SITE_ID);
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
    fetchSites().then(setSites);
    tick();
    const id = setInterval(tick, 5000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  return (
    <div style={{ minHeight: "100vh", color: "var(--text-1)",
                  fontFamily: "var(--font-sans)", position: "relative" }}>
      <div className="app-bg" />

      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "16px 28px", borderBottom: "1px solid var(--border-soft)",
                    background: "var(--surface-1)", backdropFilter: "blur(40px)",
                    WebkitBackdropFilter: "blur(40px)", position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8,
                          background: "linear-gradient(135deg, var(--accent), var(--violet))",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 14, fontWeight: 800, color: "#fff" }}>S</div>
            <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: "-0.4px" }}>SentinelOT</span>
          </div>
          <div style={{ width: 1, height: 20, background: "var(--border-light)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <select value={selectedSite} onChange={(e) => { setSelectedSite(e.target.value); window.location.reload(); }}
              style={{ background: "var(--glass-2)", color: "var(--text-1)", border: "1px solid var(--hairline-light)", borderRadius: 8, padding: "6px 12px", fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={() => { setEditSiteName(siteName); setShowEditSite(true); }} title="Manage Sites" style={{ background: "transparent", border: "none", color: "var(--text-2)", cursor: "pointer", fontSize: 16 }}>⚙</button>
            {tab === "operations" && (
              <button onClick={() => setShowAddSite(true)} style={{ background: "transparent", border: "1px solid var(--hairline-light)", borderRadius: 6, padding: "4px 10px", fontSize: 11, color: "var(--text-1)", cursor: "pointer", fontWeight: 600 }}>+ Add Site</button>
            )}
          </div>
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

      {/* tabs */}
      <div className="no-print" style={{ display: "flex", gap: 4, padding: "0 24px",
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
                             borderRadius: 999, background: "var(--danger)", color: "#fff",
                             fontSize: 10, fontWeight: 700 }}>{alertBadge}</span>
            )}
          </button>
        ))}
      </div>

      {/* view */}
      <div key={tab} className="tab-view"
           style={{ padding: 28, maxWidth: 1600, margin: "0 auto" }}>
        {tab === "operations" && <OperationsView card={card} />}
        {tab === "alerts"     && <AlertsView     card={card} />}
        {tab === "history"    && <HistoryView    card={card} />}
        {tab === "audit"      && <AuditView      card={card} />}
        {tab === "compliance" && <ReportsView    card={card} />}
      </div>
    
      {showEditSite && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div className="glass-3" style={{ padding: 24, width: 400, borderRadius: 16 }}>
            <h3 style={{ marginTop: 0 }}>Edit Site Name</h3>
            <input value={editSiteName} onChange={e => setEditSiteName(e.target.value)} 
                   style={{ width: "100%", padding: 8, marginBottom: 16, borderRadius: 8, border: "1px solid var(--hairline-light)", background: "var(--glass-2)", color: "var(--text-1)" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowEditSite(false)} className="btn">Cancel</button>
              <button onClick={async () => {
                try {
                  await updateSite(selectedSite, editSiteName);
                  window.location.reload();
                } catch(e) { alert("Error: " + e); }
              }} className="btn btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}

      {showAddSite && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div className="glass-3" style={{ padding: 24, width: 400, borderRadius: 16 }}>
            <h3 style={{ marginTop: 0 }}>Add New Site</h3>
            <input value={newSiteName} onChange={e => setNewSiteName(e.target.value)} placeholder="e.g. Lab Network" 
                   style={{ width: "100%", padding: 8, marginBottom: 16, borderRadius: 8, border: "1px solid var(--hairline-light)", background: "var(--glass-2)", color: "var(--text-1)" }} />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowAddSite(false)} className="btn">Cancel</button>
              <button onClick={async () => { 
                try {
                  const s = await createSite(newSiteName); 
                  const tok = await getEnrollmentToken(s.id);
                  setNewToken(tok);
                  setSites([...sites, s]);
                } catch(e) { alert("Error: " + e); }
              }} className="btn btn-primary">Create</button>
            </div>
            {newToken && (
              <div style={{ marginTop: 16, padding: 12, background: "var(--glass-2)", borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: "var(--text-3)" }}>Enrollment Token (copy this):</div>
                <code style={{ display: "block", marginTop: 4, wordBreak: "break-all" }}>{newToken}</code>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
