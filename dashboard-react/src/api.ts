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
