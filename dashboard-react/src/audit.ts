import { acknowledgeAlert } from "./api";

export type AuditEntry = {
  id?: number;
  time?: string;   // backend
  at?: string;     // legacy localStorage shape
  by?: string;
  actor?: string;
  action?: string;
  kind?: "device" | "alert";
  target: string;
  target_type?: string;
  target_id?: string;
  from?: string;
  to?: string;
  detail?: string;
  reason?: string;
  details?: any;
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

export async function fetchAudit(limit = 200): Promise<AuditEntry[]> {
  try {
    const r = await fetch(`${API_BASE}/v1/audit?limit=${limit}`);
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}

// Kept for the alert action flow below; backend now records the canonical entry.
export function who(): string | null {
  let n = localStorage.getItem("sot_user");
  if (!n) {
    n = (window.prompt("Your name (recorded in the audit report):") || "").trim();
    if (n) localStorage.setItem("sot_user", n);
  }
  return n || null;
}

export function why(): string | null {
  const r = (window.prompt("Reason / terms for this change (required):") || "").trim();
  return r || null;
}

export async function actAlert(
  a: { id: string; status: string; description: string },
  to: "acknowledged" | "resolved" | "false_positive",
  reload: () => void,
) {
  const by = who();
  if (!by) return;
  const reason = why();
  if (!reason) return;
  // Backend (PATCH /v1/alerts) writes audit_log itself; just send actor+reason.
  await acknowledgeAlert(a.id, to, by, reason);
  reload();
}
