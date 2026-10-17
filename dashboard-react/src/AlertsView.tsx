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

export default function AlertsView({ card }: Props) {
  const [alerts, setAlerts]   = useState<Alert[]>([]);
  const [filter, setFilter]   = useState<"open" | "all">("open");
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
        // refresh detail
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

  const shown = filter === "open"
    ? alerts.filter(a => ["open", "acknowledged", "escalated"].includes(a.status))
    : alerts;

  return (
    <div className="float-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="t-h1" style={{ margin: 0 }}>Alerts</h1>
          <div className="t-meta" style={{ marginTop: 8 }}>
            {shown.length} {filter === "open" ? "in active queue" : "total"} · click any row to see details and take action
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

      {/* table */}
      <div className="glass" style={{ padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{
              color: "var(--text-3)",
              textAlign: "left",
              fontSize: 11,
              letterSpacing: "0.5px",
              fontWeight: 600,
            }}>
              <th style={{ padding: "16px 24px", width: 40 }}>SR</th>
              <th style={{ padding: "16px 8px" }}>SEVERITY</th>
              <th style={{ padding: "16px 8px" }}>STATUS</th>
              <th style={{ padding: "16px 8px" }}>DESCRIPTION</th>
              <th style={{ padding: "16px 8px" }}>TIME</th>
              <th style={{ padding: "16px 24px", textAlign: "right" }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((a, i) => (
              <tr key={a.id}
                  onClick={() => openDetail(a)}
                  style={{ borderTop: "1px solid var(--hairline-soft)", cursor: "pointer" }}>
                <td className="t-meta" style={{ padding: "16px 24px" }}>{i + 1}</td>
                <td style={{ padding: "16px 8px" }}>
                  <span style={{
                    color: SEV_COLOR[a.severity] || "var(--text-3)",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    fontSize: 11,
                    letterSpacing: "0.5px",
                  }}>
                    {a.severity}
                  </span>
                </td>
                <td style={{ padding: "16px 8px" }}>
                  <span style={{
                    color: STATUS_BADGE[a.status] || "var(--text-3)",
                    fontWeight: 600,
                    fontSize: 12,
                  }}>
                    {a.status}
                  </span>
                </td>
                <td style={{ padding: "16px 8px", color: "var(--text-1)" }}>
                  {a.description}
                </td>
                <td className="t-mono" style={{ padding: "16px 8px", color: "var(--text-3)", fontSize: 12 }}>
                  {new Date(a.time).toLocaleString()}
                </td>
                <td style={{ padding: "16px 24px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {a.status === "open" && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); doAction(a, "acknowledge"); }}
                              disabled={busy} className="btn"
                              style={{ padding: "6px 12px", fontSize: 12, marginRight: 6 }}>
                        Ack
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); doAction(a, "resolve"); }}
                              disabled={busy} className="btn"
                              style={{ padding: "6px 12px", fontSize: 12, marginRight: 6,
                                       color: "var(--success)" }}>
                        Resolve
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); doAction(a, "false_positive"); }}
                              disabled={busy} className="btn"
                              style={{ padding: "6px 12px", fontSize: 12 }}>
                        False +
                      </button>
                    </>
                  )}
                  {a.status === "acknowledged" && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); doAction(a, "resolve"); }}
                              disabled={busy} className="btn"
                              style={{ padding: "6px 12px", fontSize: 12, marginRight: 6,
                                       color: "var(--success)" }}>
                        Resolve
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); doAction(a, "escalate"); }}
                              disabled={busy} className="btn"
                              style={{ padding: "6px 12px", fontSize: 12,
                                       color: "var(--violet)" }}>
                        Escalate
                      </button>
                    </>
                  )}
                  {["resolved", "false_positive", "escalated"].includes(a.status) && (
                    <span className="t-meta">—</span>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                  No alerts in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {err && <div style={{ color: "var(--danger)", fontSize: 14 }}>⚠ {err}</div>}

      {/* DETAIL PANEL */}
      {detail && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
                      backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
             onClick={() => setDetail(null)}>
          <div onClick={(e) => e.stopPropagation()}
               className="glass-3 float-in"
               style={{ padding: 28, width: 720, maxWidth: "92vw", maxHeight: "85vh", overflowY: "auto" }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--text-3)", letterSpacing: "0.5px", fontWeight: 600, marginBottom: 6 }}>
                  {detail.severity.toUpperCase()} · {detail.status.toUpperCase()}
                </div>
                <div className="t-h2" style={{ margin: 0 }}>Alert details</div>
              </div>
              <button onClick={() => setDetail(null)} className="btn" style={{ padding: "6px 12px", fontSize: 12 }}>
                Close
              </button>
            </div>

            <div style={{ background: "var(--glass-2)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
              <div className="t-meta" style={{ marginBottom: 4 }}>What happened</div>
              <div className="t-body" style={{ color: "var(--text-1)" }}>{detail.description}</div>
              <div className="t-meta" style={{ marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 11 }}>
                {new Date(detail.time).toLocaleString()}
              </div>
            </div>

            {pbLoading && (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)" }}>
                Generating analyst playbook…
              </div>
            )}

            {playbook && (
              <>
                <div style={{ marginBottom: 16 }}>
                  <div className="t-h3" style={{ marginBottom: 8, color: "var(--accent)" }}>What</div>
                  <div className="t-body">{playbook.what}</div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div className="t-h3" style={{ marginBottom: 8, color: "var(--warning)" }}>Why it matters</div>
                  <div className="t-body">{playbook.why}</div>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div className="t-h3" style={{ marginBottom: 8, color: "var(--success)" }}>Recommended actions</div>
                  <ol style={{ margin: 0, paddingLeft: 20, color: "var(--text-2)", lineHeight: 1.7 }}>
                    {playbook.actions.map((a, i) => (
                      <li key={i} style={{ marginBottom: 8 }}>
                        <strong style={{ color: "var(--text-1)" }}>{a.step}</strong>
                        <div className="t-meta" style={{ marginTop: 2 }}>{a.detail}</div>
                      </li>
                    ))}
                  </ol>
                </div>
                <div style={{ marginBottom: 16 }}>
                  <div className="t-h3" style={{ marginBottom: 8, color: "var(--danger)" }}>When to escalate</div>
                  <div className="t-body">{playbook.escalate}</div>
                </div>
                <div className="t-meta" style={{ fontSize: 11, fontStyle: "italic" }}>
                  Generated by {playbook.model} · {playbook.cached ? "cached" : "fresh"}
                </div>
              </>
            )}

            {!pbLoading && !playbook && (
              <div style={{ padding: 20, textAlign: "center", color: "var(--text-3)" }}>
                Playbook generation failed. Check that the Ollama container is running.
              </div>
            )}

            {/* actions in detail */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 24,
                          paddingTop: 16, borderTop: "1px solid var(--hairline-light)" }}>
              {detail.status === "open" && (
                <>
                  <button onClick={() => doAction(detail, "acknowledge")} disabled={busy} className="btn">
                    Acknowledge
                  </button>
                  <button onClick={() => doAction(detail, "resolve")} disabled={busy} className="btn"
                          style={{ color: "var(--success)" }}>
                    Resolve
                  </button>
                  <button onClick={() => doAction(detail, "false_positive")} disabled={busy} className="btn">
                    False positive
                  </button>
                </>
              )}
              {detail.status === "acknowledged" && (
                <>
                  <button onClick={() => doAction(detail, "escalate")} disabled={busy} className="btn"
                          style={{ color: "var(--violet)" }}>
                    Escalate
                  </button>
                  <button onClick={() => doAction(detail, "resolve")} disabled={busy} className="btn"
                          style={{ color: "var(--success)" }}>
                    Resolve
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
