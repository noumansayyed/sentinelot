const API_BASE = "http://localhost:8000";
const KEYCLOAK_URL = "http://localhost:8080";
export const SITE_ID = "22222222-2222-2222-2222-222222222222";

let token: string | null = null;

export async function getToken(): Promise<string> {
  if (token) return token;
  const res = await fetch(`${KEYCLOAK_URL}/realms/sentinelot/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "client_id=sentinelot-dashboard&grant_type=password&username=operator&password=operator123",
  });
  const data = await res.json();
  token = data.access_token;
  return token!;
}

export interface Alert {
  id: string; time: string; severity: string; description: string;
  llm_explanation: string | null; status: string;
}
export interface Asset {
  ip_address: string; device_role: string; criticality: string;
  first_seen: string; last_seen: string; protocols: string[];
}

export async function fetchAlerts(): Promise<Alert[]> {
  const t = await getToken();
  const res = await fetch(`${API_BASE}/v1/sites/${SITE_ID}/alerts`, { headers: { Authorization: `Bearer ${t}` } });
  return (await res.json()).alerts;
}
export async function fetchAssets(): Promise<Asset[]> {
  const t = await getToken();
  const res = await fetch(`${API_BASE}/v1/sites/${SITE_ID}/assets`, { headers: { Authorization: `Bearer ${t}` } });
  return (await res.json()).assets;
}

export async function acknowledgeAlert(id: string, status: "acknowledged" | "resolved" | "false_positive") {
  const t = await getToken();
  await fetch(`${API_BASE}/v1/alerts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify({ status }),
  });
}
