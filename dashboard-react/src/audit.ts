import { acknowledgeAlert } from "./api";
export type AuditEntry = { at:string; by:string; kind:"device"|"alert"; target:string; from:string; to:string; reason:string };
const K = "sot_audit";
export function getAudit(): AuditEntry[] { try { return JSON.parse(localStorage.getItem(K)||"[]"); } catch { return []; } }
export function addAudit(e: AuditEntry) { const l = getAudit(); l.push(e); localStorage.setItem(K, JSON.stringify(l)); }
export function who(): string | null {
  let n = localStorage.getItem("sot_user");
  if (!n) { n = (window.prompt("Your name (recorded in the audit report):") || "").trim(); if (n) localStorage.setItem("sot_user", n); }
  return n || null;
}
export function why(): string | null {
  const r = (window.prompt("Reason / terms for this change (required):") || "").trim();
  return r || null;
}
export async function actAlert(a:{id:string;status:string;description:string}, to:"acknowledged"|"resolved"|"false_positive", reload:()=>void) {
  const by = who(); if (!by) return;
  const reason = why(); if (!reason) return;
  addAudit({ at:new Date().toISOString(), by, kind:"alert", target:a.id.slice(0,8)+" · "+a.description.slice(0,70), from:a.status, to, reason });
  await acknowledgeAlert(a.id, to, by);
  reload();
}
