import { useEffect, useState } from "react";
import { fetchAudit, type AuditEntry, type AuditFilters } from "./audit";

const ACTION_OPTIONS = [
  "asset.classify", "asset.bulk_classify", "asset.update", "assets.update",
  "alert.acknowledged", "alert.resolved", "alert.false_positive", "alert.open",
  "site.create", "site.update", "site.enrollment_token.create", "report.generate",
  "compliance_reports.insert", "enrollment_tokens.insert", "sensors.insert", "sensors.update",
];

const TARGET_OPTIONS = [
  "asset", "alert", "site", "report", "assets", "alerts", "sites",
  "compliance_reports", "enrollment_tokens", "sensors",
];

export default function AuditView({ card }: { card: React.CSSProperties }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<AuditFilters>({});
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters({
        q: q || undefined,
        actor: actor || undefined,
        action: action || undefined,
        target_type: targetType || undefined,
        since: since ? new Date(since).toISOString() : undefined,
        until: until ? new Date(until).toISOString() : undefined,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [q, actor, action, targetType, since, until]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const log = await fetchAudit(500, filters);
      if (!alive) return;
      setEntries(log);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [filters]);

  function downloadCSV() {
    const headers = ["Time", "Actor", "Kind", "Target", "Action", "Reason"];
    const rows = entries.map(e => [
      e.time ?? e.at ?? "",
      e.actor ?? e.by ?? "system",
      e.kind ?? (e.target_type === "asset" ? "device" : e.target_type ?? "—"),
      e.target ?? "",
      e.action ?? "",
      (e.detail ?? e.reason ?? "").replace(/"/g, '""'),
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sentinelot-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function resetFilters() {
    setQ(""); setActor(""); setAction(""); setTargetType(""); setSince(""); setUntil("");
  }

  const activeFilterCount = [q, actor, action, targetType, since, until].filter(Boolean).length;

  // Shared styles for inputs to keep them clean and consistent
  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid var(--hairline)",
    background: "var(--bg-1)",
    color: "var(--text-1)",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-3)",
    letterSpacing: "0.5px",
  };

  return (
    <div className="float-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div>
          <h1 className="t-h1" style={{ margin: 0 }}>Audit Report</h1>
          <div className="t-meta" style={{ marginTop: 8 }}>
            Every change to device approval status and alert actions: who, what, why, when.
          </div>
        </div>
        <button onClick={downloadCSV} className="btn btn-primary" disabled={entries.length === 0}>
          Download CSV
        </button>
      </div>

      {/* Filter Bar - Two Rows */}
      <div className="glass" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
        
        {/* Row 1: Search + Reset */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
          <label style={{ ...labelStyle, flex: 1 }}>
            SEARCH
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search actor, target, action, or reason…"
              style={inputStyle}
            />
          </label>
          <button
            onClick={resetFilters}
            className="btn"
            disabled={activeFilterCount === 0}
            style={{ padding: "10px 20px", height: 38, fontSize: 13, whiteSpace: "nowrap" }}
          >
            Reset {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
          </button>
        </div>

        {/* Row 2: Dropdowns + Dates */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 12 }}>
          <label style={labelStyle}>
            ACTOR
            <input
              value={actor}
              onChange={e => setActor(e.target.value)}
              placeholder="Any actor"
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            ACTION
            <select value={action} onChange={e => setAction(e.target.value)} style={inputStyle}>
              <option value="">All actions</option>
              {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            TARGET TYPE
            <select value={targetType} onChange={e => setTargetType(e.target.value)} style={inputStyle}>
              <option value="">All types</option>
              {TARGET_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            FROM DATE
            <input
              type="datetime-local"
              value={since}
              onChange={e => setSince(e.target.value)}
              style={inputStyle}
            />
          </label>
          <label style={labelStyle}>
            TO DATE
            <input
              type="datetime-local"
              value={until}
              onChange={e => setUntil(e.target.value)}
              style={inputStyle}
            />
          </label>
        </div>
      </div>

      {/* Table */}
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
              <th style={{ padding: "16px 8px" }}>TIME</th>
              <th style={{ padding: "16px 8px" }}>BY</th>
              <th style={{ padding: "16px 8px" }}>TYPE</th>
              <th style={{ padding: "16px 8px" }}>TARGET</th>
              <th style={{ padding: "16px 8px" }}>ACTION</th>
              <th style={{ padding: "16px 24px" }}>REASON</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.id ?? i} style={{ borderTop: "1px solid var(--hairline-soft)" }}>
                <td className="t-meta" style={{ padding: "14px 24px" }}>{i + 1}</td>
                <td className="t-mono" style={{ padding: "14px 8px", color: "var(--text-3)", fontSize: 13 }}>
                  {new Date((e.time ?? e.at ?? "") as string).toLocaleString()}
                </td>
                <td style={{ padding: "14px 8px", color: "var(--text-1)", fontWeight: 500 }}>
                  {e.actor ?? e.by ?? "system"}
                </td>
                <td style={{ padding: "14px 8px", color: "var(--text-2)" }}>
                  {e.kind ?? (e.target_type === "asset" ? "device" : e.target_type ?? "—")}
                </td>
                <td className="t-mono" style={{ padding: "14px 8px", color: "var(--text-1)" }}>
                  {e.target ?? "—"}
                </td>
                <td style={{ padding: "14px 8px", color: "var(--accent)" }}>
                  {e.action}
                </td>
                <td style={{ padding: "14px 24px", color: "var(--text-3)", fontSize: 13 }}>
                  {e.detail ?? e.reason ?? "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                  {loading ? "Loading…" : "No audit entries match the current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
