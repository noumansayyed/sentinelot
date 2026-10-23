const API_BASE = "http://localhost:8000";
const KEYCLOAK_URL = "http://localhost:8080";
export const SITE_ID = "22222222-2222-2222-2222-222222222222";
let token: string | null = null;
export async function getToken(force = false): Promise<string> {
  if (token && !force) return token;
  const res = await fetch(`${KEYCLOAK_URL}/realms/sentinelot/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "client_id=sentinelot-dashboard&grant_type=password&username=operator&password=operator123",
  });
  const data = await res.json();
  token = data.access_token;
  return token!;
}
async function authed(url: string, init: RequestInit = {}): Promise<Response> {
  const go = async (force: boolean) => {
    const t = await getToken(force);
    return fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } });
  };
  let res = await go(false);
  if (res.status === 401) res = await go(true);
  return res;
}
export interface Alert {
  id: string; time: string; severity: string; description: string;
  llm_explanation: string | null; status: string;
  acknowledged_by: string | null; acknowledged_at: string | null;
}
export interface Asset {
  ip_address: string; device_role: string; criticality: string;
  first_seen: string; last_seen: string; protocols: string[];
}
export async function fetchAlerts(): Promise<Alert[]> {
  const res = await authed(`${API_BASE}/v1/sites/${SITE_ID}/alerts`);
  if (!res.ok) throw new Error(`alerts HTTP ${res.status}`);
  return (await res.json()).alerts || [];
}
export async function fetchAssets(): Promise<Asset[]> {
  const res = await authed(`${API_BASE}/v1/sites/${SITE_ID}/assets`);
  if (!res.ok) throw new Error(`assets HTTP ${res.status}`);
  return (await res.json()).assets || [];
}
export async function acknowledgeAlert(
  id: string,
  status: "acknowledged" | "resolved" | "false_positive",
  acknowledged_by: string = "operator"
) {
  await authed(`${API_BASE}/v1/alerts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, acknowledged_by }),
  });
}

export interface ProtocolActivityEntry {
  asset_id: string;
  last_seen: string;
  events: number;
}
export interface ProtocolActivity {
  window_sec: number;
  by_protocol: Record<string, ProtocolActivityEntry[]>;
}
export async function fetchProtocolActivity(windowSec = 300): Promise<ProtocolActivity> {
  const res = await authed(`${API_BASE}/v1/sites/${SITE_ID}/protocols/activity?window_sec=${windowSec}`);
  if (!res.ok) throw new Error(`protocols HTTP ${res.status}`);
  return await res.json();
}

// ---------- Operations (Phase B) ----------
export interface OpDevice {
  asset_id: string;
  ip: string;
  mac: string | null;
  vendor_oui: string | null;
  role: string;
  protocols: string[];
  criticality: string;
  first_seen: string | null;
  last_seen: string | null;
  status: "active" | "idle" | "offline";
  hidden: boolean;
  seconds_since_seen: number | null;
}
export interface OpProtocol {
  protocol: string;
  events_5min: number;
  completed_5min: number;
  devices_seen: number;
  successful_devices: number;
  last_event: string | null;
  seconds_since_event: number | null;
  status: "active" | "idle" | "offline";
}
export interface OpAlertSummary {
  open_queue: number;
  critical_high_open: number;
  critical_open: number;
}
export interface Operations {
  site: { id: string; name: string; tenant_id: string };
  devices: OpDevice[];
  device_summary: { total: number; active: number; idle: number; offline: number; unknown: number };
  protocols: OpProtocol[];
  alert_summary: OpAlertSummary;
}
export async function fetchOperations(siteId: string = SITE_ID): Promise<Operations> {
  const res = await authed(`${API_BASE}/v1/sites/${siteId}/operations`);
  if (!res.ok) throw new Error(`operations HTTP ${res.status}`);
  return await res.json();
}
export interface SiteSummary { id: string; name: string; device_count: number }


// ---------- Device registry (static lab metadata) ----------
export const REGISTRY: Record<string, { name: string; role: string; known: boolean }> = {
  "172.28.240.221": { name: "telemetry-api", role: "Dashboard telemetry poller", known: true },
  "172.28.240.220": { name: "opcua-client", role: "OPC-UA node", known: true },
  "172.28.240.218": { name: "dnp3-client", role: "DNP3 traffic generator", known: true },
  "172.28.240.217": { name: "iiot-sensor", role: "IIoT sensor", known: true },
  "172.28.240.214": { name: "s7-client", role: "S7 client", known: true },
  "172.28.240.213": { name: "rogue-device", role: "UNAPPROVED device (rogue)", known: false },
  "172.28.240.212": { name: "hmi-device", role: "HMI operator station", known: true },
  "172.28.240.2":   { name: "plc-relay", role: "PLC relay", known: true },
  "172.28.240.211": { name: "plc-modbus", role: "PLC (Modbus server)", known: true },
};
export const HAS_REG = Object.keys(REGISTRY).length > 0;

const LS_A = "sot_approvals";
type Appr = Record<string, { known: boolean; by: string; at: string }>;
function getApprovals(): Appr {
  try { return JSON.parse(localStorage.getItem(LS_A) || "{}"); }
  catch { return {}; }
}
export function isKnown(ip: string): boolean {
  const o = getApprovals()[ip];
  if (o) return o.known;
  return !HAS_REG || !!REGISTRY[ip]?.known;
}

// ---------- Site Management (C2.5a) ----------
export interface SiteAdmin {
  id: string;
  name: string;
  location: string | null;
  timezone: string;
  network_cidr: string | null;
  contact_name: string | null;
  contact_email: string | null;
  device_count: number;
  archived: boolean;
}
export interface EnrollmentToken {
  id: string;
  site_id: string;
  site_name: string;
  token: string;
  expires_at: string;
  label: string | null;
  install_hint: string;
}
export async function adminListSites(tenantId: string = "11111111-1111-1111-1111-111111111111"): Promise<SiteAdmin[]> {
  const res = await authed(`${API_BASE}/v1/tenants/${tenantId}/sites`);
  if (!res.ok) throw new Error(`sites HTTP ${res.status}`);
  return (await res.json()).sites || [];
}
export async function adminCreateSite(body: {
  name: string; location?: string; timezone?: string;
  network_cidr?: string; contact_name?: string; contact_email?: string;
  actor: string;
}, tenantId: string = "11111111-1111-1111-1111-111111111111"): Promise<SiteAdmin> {
  const res = await authed(`${API_BASE}/v1/tenants/${tenantId}/sites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`create site failed: ${res.status} ${t}`);
  }
  return await res.json();
}
export async function adminArchiveSite(siteId: string, body: { actor: string; reason: string }): Promise<void> {
  const res = await authed(`${API_BASE}/v1/sites/${siteId}/archive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`archive failed: ${res.status} ${t}`);
  }
}
export async function adminCreateEnrollmentToken(siteId: string, body: {
  actor: string; label?: string; ttl_hours?: number;
}): Promise<EnrollmentToken> {
  const res = await authed(`${API_BASE}/v1/sites/${siteId}/enrollment-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`token failed: ${res.status} ${t}`);
  }
  return await res.json();
}

// ---------- Asset administration (C2.5-real) ----------
export interface InboxAsset {
  asset_id: string;
  ip: string;
  mac: string | null;
  device_role: string;
  criticality: string;
  protocols: string[];
  first_seen: string | null;
  last_seen: string | null;
  reason: "unclassified" | "stale" | "attention";
}
export async function fetchAssetInbox(siteId: string = SITE_ID): Promise<InboxAsset[]> {
  const res = await authed(`${API_BASE}/v1/sites/${siteId}/assets/inbox`);
  if (!res.ok) throw new Error(`inbox HTTP ${res.status}`);
  return (await res.json()).inbox || [];
}
export async function classifyAsset(assetId: string, body: {
  actor: string; role?: string; criticality?: string; hidden?: boolean; reason?: string;
}): Promise<void> {
  const res = await authed(`${API_BASE}/v1/assets/${assetId}/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
}
export async function bulkClassify(body: {
  actor: string; asset_ids: string[]; role?: string; criticality?: string; hidden?: boolean; reason?: string;
}): Promise<{ updated: number; requested: number }> {
  const res = await authed(`${API_BASE}/v1/assets/bulk-classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

// ---------- Audit log (used by AuditView) ----------
const LS_L = "sot_approval_log";
export interface AuditLogEntry {
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
export function getApprovalLog(): AuditLogEntry[] {
  try { return JSON.parse(localStorage.getItem(LS_L) || "[]"); }
  catch { return []; }
}

// ---------- Alert actions + LLM playbook (Phase C) ----------
export type AlertAction = "acknowledge" | "resolve" | "false_positive" | "escalate" | "reopen";
export async function takeAlertAction(
  alertId: string,
  action: AlertAction,
  actor: string,
  reason?: string,
  escalation_ref?: string,
): Promise<{ from: string; to: string; actor: string }> {
  const res = await authed(`${API_BASE}/v1/alerts/${alertId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, actor, reason, escalation_ref }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`action failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return await res.json();
}

// ---------- Alert actions + LLM playbook ----------
export async function actionAlert(alertId: string, body: {
  action: "acknowledge" | "resolve" | "false_positive" | "escalate" | "reopen";
  actor: string;
  reason?: string;
  escalation_ref?: string;
}): Promise<{ from: string; to: string }> {
  const res = await authed(`${API_BASE}/v1/alerts/${alertId}/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

export interface Playbook {
  alert_id: string;
  cached: boolean;
  model: string;
  generated_at: string;
  what: string;
  why: string;
  actions: Array<{ step: string; detail: string }>;
  escalate: string;
}

export async function fetchPlaybook(alertId: string, refresh = false): Promise<Playbook> {
  const res = await authed(`${API_BASE}/v1/alerts/${alertId}/playbook${refresh ? "?refresh=true" : ""}`);
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

// ---------- Reports ----------
export interface ReportMeta {
  id: string;
  created_at: string;
  triggered_by: string;
  file_path: string;
}
export async function generateReport(siteId: string = SITE_ID): Promise<void> {
  const res = await authed(`${API_BASE}/v1/sites/${siteId}/reports/generate`, { method: "POST" });
  if (!res.ok) throw new Error(await res.text());
}
export async function listReports(siteId: string = SITE_ID): Promise<ReportMeta[]> {
  const res = await authed(`${API_BASE}/v1/sites/${siteId}/reports`);
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).reports || [];
}

// ---------- Native Report ----------
export interface ReportData {
  site_name: string;
  generated_at: string;
  assets: any[];
  alerts: any[];
  events: any[];
}
export async function fetchReportData(siteId: string = SITE_ID): Promise<ReportData> {
  const res = await authed(`${API_BASE}/v1/sites/${siteId}/report-data`);
  if (!res.ok) throw new Error(`report HTTP ${res.status}`);
  return await res.json();
}

export interface SiteInfo { id: string; name: string }

export async function fetchSites(): Promise<SiteInfo[]> {
  const res = await authed(`http://localhost:8000/v1/tenants/11111111-1111-1111-1111-111111111111/sites`);
  if (!res.ok) return [{id: SITE_ID, name: "Pune Pilot Plant"}];
  return (await res.json()).sites || [];
}

export async function createSite(name: string): Promise<SiteInfo> {
  const res = await authed(`http://localhost:8000/v1/tenants/11111111-1111-1111-1111-111111111111/sites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, actor: "operator" })
  });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

export async function getEnrollmentToken(siteId: string): Promise<string> {
  const res = await authed(`http://localhost:8000/v1/sites/${siteId}/enrollment-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor: "operator" })
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).token;
}

export async function updateSite(siteId: string, name: string): Promise<void> {
  const res = await authed(`http://localhost:8000/v1/sites/${siteId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, actor: "operator" })
  });
  if (!res.ok) throw new Error(await res.text());
}
