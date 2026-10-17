import { useEffect, useState } from "react";
import { getApprovalLog } from "./api";

interface AuditEntry {
  ip: string;
  action: string;
  by: string;
  at: string;
  reason?: string;
  from?: string;
  to?: string;
  target?: string;
  kind?: string;
}

export default function AuditView({ card }: { card: React.CSSProperties }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    const log = getApprovalLog() as AuditEntry[];
    // Sort by timestamp descending
    const sorted = [...log].sort((a, b) =>
      new Date(b.at).getTime() - new Date(a.at).getTime()
    );
    setEntries(sorted);
  }, []);

  function downloadCSV() {
    const headers = ["Time", "Actor", "Kind", "Target", "Action", "Reason"];
    const rows = entries.map(e => [
      e.at,
      e.by,
      e.kind || "device",
      e.target || e.ip || "",
      e.action || "",
      (e.reason || "").replace(/"/g, '""'),
    ]);
    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${v}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sentinelot-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="float-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* header */}
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
              <tr key={i} style={{ borderTop: "1px solid var(--hairline-soft)" }}>
                <td className="t-meta" style={{ padding: "14px 24px" }}>{i + 1}</td>
                <td className="t-mono" style={{ padding: "14px 8px", color: "var(--text-3)", fontSize: 13 }}>
                  {new Date(e.at).toLocaleString()}
                </td>
                <td style={{ padding: "14px 8px", color: "var(--text-1)", fontWeight: 500 }}>
                  {e.by}
                </td>
                <td style={{ padding: "14px 8px", color: "var(--text-2)" }}>
                  {e.kind || "device"}
                </td>
                <td className="t-mono" style={{ padding: "14px 8px", color: "var(--text-1)" }}>
                  {e.target || e.ip || "—"}
                </td>
                <td style={{ padding: "14px 8px", color: "var(--accent)" }}>
                  {e.action}
                </td>
                <td style={{ padding: "14px 24px", color: "var(--text-3)", fontSize: 13 }}>
                  {e.reason || "—"}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 40, textAlign: "center", color: "var(--text-3)" }}>
                  No audit entries yet. Approve a device or action an alert to generate an entry.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
