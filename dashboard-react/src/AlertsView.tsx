import { useEffect, useState } from "react";
import { fetchAlerts, Alert, actionAlert, fetchPlaybook, Playbook } from "./api";

interface Props { card: React.CSSProperties }
const ACTOR = localStorage.getItem("sot_actor") || "operator";

const SEV_COLOR: Record<string, string> = {
  critical: "var(--danger)",
  high:     "var(--warning)",
  medium:   "#FFD60A",
  low:      "var(--success)",
};

const STATUS_BADGE: Record<string, string> = {
  open:           "var(--danger)",
  acknowledged:   "var(--warning)",
  escalated:      "var(--violet)",
  resolved:       "var(--success)",
  false_positive: "var(--text-3)",
};

// Helper to determine category from description
function getCategory(desc: string): string {
  if (desc.startsWith("New device")) return "New device";
  if (desc.startsWith("Behavioral")) return "Timing anomaly";
  if (desc.includes("outside normal hours")) return "Off-hours";
  if (desc.startsWith("Unauthorized")) return "Unauthorized write";
  if (desc.startsWith("[Suricata")) return "Signature match";
  return "Rule match";
}

export default function AlertsView({ card }: Props) {
  const [alerts, setAlerts]   = useState<Alert[]>([]);
  const [filter, setFilter]   = useState<"open" | "all">("open");
  const [category, setCategory] = useState<string>("All");
  const [search, setSearch]   = useState("");
  
  const [err, setErr]         = useState("");
  const [busy, setBusy]       = useState(false);
  const [detail, setDetail]   = useState<Alert | null>(null);
  const [playbook, setPlaybook] = useState<Playbook | null>(null);
  const [pbLoading, setPbLoading] = useState(false);

  async function refresh() {
    try {
      const a = await fetchAlerts();
      setAlerts(a);
      setErr("");
    } catch (e: any) { setErr(e.message); }
  }
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  async function doAction(a: Alert, action: "acknowledge" | "resolve" | "false_positive" | "escalate") {
    const verb = action === "false_positive" ? "mark as false positive" : action;
    const reason = prompt(`${verb.toUpperCase()} — ${a.description.slice(0, 60)}…\nReason (required):`);
    if (!reason) return;
    setBusy(true);
    try {
      await actionAlert(a.id, { action, actor: ACTOR, reason });
      await refresh();
      if (detail?.id === a.id) {
        const fresh = (await fetchAlerts()).find(x => x.id === a.id);
        setDetail(fresh || null);
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function openDetail(a: Alert) {
    setDetail(a);
    setPlaybook(null);
    setPbLoading(true);
    try {
      const pb = await fetchPlaybook(a.id);
      setPlaybook(pb);
    } catch (e: any) { setErr(e.message); }
    finally { setPbLoading(false); }
  }

  // 1. Filter by queue (open/all)
  let shown = filter === "open"
    ? alerts.filter(a => ["open", "acknowledged", "escalated"].includes(a.status))
    : alerts;

  // 2. Filter by category
  if (category !== "All") {
    shown = shown.filter(a => getCategory(a.description) === category);
  }

  // 3. Filter by search
  if (search) {
    const s = search.toLowerCase();
    shown = shown.filter(a => 
      a.description.toLowerCase().includes(s) || 
      a.severity.toLowerCase().includes(s) ||
      a.status.toLowerCase().includes(s)
    );
  }

  // 4. Group by Date for the UI
  const groupedByDate: Record<string, Alert[]> = {};
  shown.forEach(a => {
    const d = new Date(a.time).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    if (!groupedByDate[d]) groupedByDate[d] = [];
    groupedByDate[d].push(a);
  });

  const categories = ["All", "New device", "Off-hours", "Unauthorized write", "Timing anomaly", "Signature match", "Rule match"];

  return (
    <div className="float-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* HEADER & MAIN FILTERS */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 className="t-h1" style={{ margin: 0 }}>Alerts</h1>
          <div className="t-meta" style={{ marginTop: 8 }}>
            {shown.length} alerts shown · click any row for details
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {(["open", "all"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={filter === f ? "btn btn-primary" : "btn"}>
              {f === "open" ? "Active queue" : "All alerts"}
            </button>
          ))}
        </div>
      </div>

      {/* SEARCH & CATEGORY FILTERS */}
      <div className="glass" style={{ padding: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search IP, description, severity…"
          style={{ background: "var(--glass-2)", border: "1px solid var(--hairline-light)",
                   borderRadius: 8, color: "var(--text-1)", padding: "8px 14px",
                   fontSize: 13, width: 280, outline: "none" }}
        />
        <div style={{ width: 1, height: 24, background: "var(--hairline-light)" }} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {categories.map(c => (
            <button key={c} onClick={() => setCategory(c)}
              style={{ background: category === c ? "var(--text-1)" : "var(--glass-2)",
                       color: category === c ? "var(--bg-0)" : "var(--text-2)",
                       border: "1px solid var(--hairline-light)", padding: "6px 12px",
                       borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* TABLE WITH DATE SEPARATORS */}
      <div className="glass" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ color: "var(--text-3)", textAlign: "left", fontSize: 11, letterSpacing: "0.5px", fontWeight: 600 }}>
              <th style={{ padding: "16px 24px", width: 40 }}>SR</th>
              <th style={{ padding: "16px 8px" }}>SEVERITY</th>
              <th style={{ padding: "16px 8px" }}>STATUS</th>
              <th style={{ padding: "16px 8px" }}>CATEGORY</th>
              <th style={{ padding: "16px 8px" }}>DESCRIPTION</th>
              <th style={{ padding: "16px 8px" }}>TIME</th>
              <th style={{ padding: "16px 24px", textAlign: "right" }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(groupedByDate).map(date => (
              <>
                {/* DATE SEPARATOR */}
                <tr key={date}>
                  <td colSpan={7} style={{ background: "var(--bg-0)", padding: "10px 24px", 
                                           fontSize: 11, fontWeight: 700, color: "var(--text-3)", letterSpacing: "1px",
                                           borderTop: "1px solid var(--hairline-light)", borderBottom: "1px solid var(--hairline-light)" }}>
                    {date.toUpperCase()}
                  </td>
                </tr>
                {/* ROWS FOR THIS DATE */}
                {groupedByDate[date].map((a, i) => (
                  <tr key={a.id} onClick={() => openDetail(a)} style={{ borderTop: "1px solid var(--hairline-soft)", cursor: "pointer" }}>
                    <td className="t-meta" style={{ padding: "16px 24px" }}>{i + 1}</td>
                    <td style={{ padding: "16px 8px" }}>
                      <span style={{ color: SEV_COLOR[a.severity] || "var(--text-3)", fontWeight: 700, textTransform: "uppercase", fontSize: 11, letterSpacing: "0.5px" }}>
                        {a.severity}
                      </span>
                    </td>
                    <td style={{ padding: "16px 8px" }}>
                      <span style={{ color: STATUS_BADGE[a.status] || "var(--text-3)", fontWeight: 600, fontSize: 12 }}>
                        {a.status}
                      </span>
                    </td>
                    <td style={{ padding: "16px 8px" }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-2)", background: "var(--glass-2)", padding: "3px 8px", borderRadius: 4 }}>
                        {getCategory(a.description)}
                      </span>
                    </td>
                    <td style={{ padding: "16px 8px", color: "var(--text-1)" }}>
                      {a.description}
                    </td>
                    <td className="t-mono" style={{ padding: "16px 8px", color: "var(--text-3)", fontSize: 12 }}>
                      {new Date(a.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ padding: "16px 24px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {a.status === "open" && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); doAction(a, "acknowledge"); }} disabled={busy} className="btn" style={{ padding: "6px 12px", fontSize: 12, marginRight: 6 }}>Ack</button>
                          <button onClick={(e) => { e.stopPropagation(); doAction(a, "resolve"); }} disabled={busy} className="btn" style={{ padding: "6px 12px", fontSize: 12, marginRight: 6, color: "var(--success)" }}>Resolve</button>
                        </>
                      )}
                      {a.status === "acknowledged" && (
                        <button onClick={(e) => { e.stopPropagation(); doAction(a, "resolve"); }} disabled={busy} className="btn" style={{ padding: "6px 12px", fontSize: 12, color: "var(--success)" }}>Resolve</button>
                      )}
                      {["resolved", "false_positive", "escalated"].includes(a.status) && (
                        <span className="t-meta">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                  No alerts match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {err && <div style={{ color: "var(--danger)", fontSize: 14 }}>⚠ {err}</div>}

      {/* DETAIL PANEL (Same as before) */}
      {detail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }} onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()} className="glass-3 float-in" style={{ padding: 28, width: 720, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-3)", letterSpacing: "0.5px", fontWeight: 600, marginBottom: 6 }}>{detail.severity.toUpperCase()} · {detail.status.toUpperCase()}</div>
                <div className="t-h2" style={{ margin: 0 }}>Alert details</div>
              </div>
              <button onClick={() => setDetail(null)} className="btn" style={{ padding: "6px 12px", fontSize: 12 }}>Close</button>
            </div>

            <div style={{ background: "var(--glass-2)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div className="t-meta" style={{ marginBottom: 4 }}>What happened</div>
              <div className="t-body" style={{ color: "var(--text-1)" }}>{detail.description}</div>
              <div className="t-meta" style={{ marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 11 }}>{new Date(detail.time).toLocaleString()}</div>
            </div>

            {pbLoading && <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)" }}>Generating analyst playbook…</div>}

            {playbook && (
              <>
                <div style={{ marginBottom: 16 }}><div className="t-h3" style={{ marginBottom: 8, color: "var(--accent)" }}>What</div><div className="t-body">{playbook.what}</div></div>
                <div style={{ marginBottom: 16 }}><div className="t-h3" style={{ marginBottom: 8, color: "var(--warning)" }}>Why it matters</div><div className="t-body">{playbook.why}</div></div>
                <div style={{ marginBottom: 16 }}>
                  <div className="t-h3" style={{ marginBottom: 8, color: "var(--success)" }}>Recommended actions</div>
                  <ol style={{ margin: 0, paddingLeft: 20, color: "var(--text-2)", lineHeight: 1.7 }}>
                    {playbook.actions.map((a, i) => (
                      <li key={i} style={{ marginBottom: 8 }}><strong style={{ color: "var(--text-1)" }}>{a.step}</strong><div className="t-meta" style={{ marginTop: 2 }}>{a.detail}</div></li>
                    ))}
                  </ol>
                </div>
                <div style={{ marginBottom: 16 }}><div className="t-h3" style={{ marginBottom: 8, color: "var(--danger)" }}>When to escalate</div><div className="t-body">{playbook.escalate}</div></div>
                <div className="t-meta" style={{ fontSize: 11, fontStyle: "italic" }}>Generated by {playbook.model} · {playbook.cached ? "cached" : "fresh"}</div>
              </>
            )}

            {!pbLoading && !playbook && <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)" }}>Playbook generation failed. Check that the Ollama container is running.</div>}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--hairline-light)" }}>
              {detail.status === "open" && (
                <>
                  <button onClick={() => doAction(detail, "acknowledge")} disabled={busy} className="btn">Acknowledge</button>
                  <button onClick={() => doAction(detail, "resolve")} disabled={busy} className="btn" style={{ color: "var(--success)" }}>Resolve</button>
                  <button onClick={() => doAction(detail, "false_positive")} disabled={busy} className="btn">False positive</button>
                </>
              )}
              {detail.status === "acknowledged" && (
                <>
                  <button onClick={() => doAction(detail, "escalate")} disabled={busy} className="btn" style={{ color: "var(--violet)" }}>Escalate</button>
                  <button onClick={() => doAction(detail, "resolve")} disabled={busy} className="btn" style={{ color: "var(--success)" }}>Resolve</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
