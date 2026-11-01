import { useState } from "react";
import { useSite } from "./SiteContext";

const API = "http://localhost:8000";
const DEMO_TENANT = "11111111-1111-1111-1111-111111111111";

export default function OnboardingView({ card }: { card: React.CSSProperties }) {
  const { refreshSites } = useSite();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createSite() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API}/v1/tenants/${DEMO_TENANT}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), actor: "admin" }),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`${r.status} ${txt.slice(0, 200)}`);
      }
      await r.json();
      setName("");
      await refreshSites();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="float-in" style={{ display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 24, padding: "80px 24px", minHeight: "60vh" }}>
      <div style={{ maxWidth: 480, textAlign: "center" }}>
        <h1 className="t-h1" style={{ margin: 0, marginBottom: 12 }}>Welcome to SentinelOT</h1>
        <div className="t-meta" style={{ marginBottom: 32 }}>
          No sites configured yet. A site is where sensors report from — a plant,
          a network segment, or a lab. Create one to get started.
        </div>

        <div className="glass" style={{ padding: 24, textAlign: "left" }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700,
            color: "var(--text-3)", letterSpacing: 0.5, marginBottom: 6 }}>
            SITE NAME
          </label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") createSite(); }}
            placeholder="e.g. Plant A — Packaging Line"
            autoFocus
            style={{
              width: "100%", padding: "10px 12px", borderRadius: 6,
              border: "1px solid var(--hairline)", background: "var(--bg-1)",
              color: "var(--text-1)", fontSize: 14, marginBottom: 16,
            }}
          />
          <button
            className="btn btn-primary"
            onClick={createSite}
            disabled={busy || !name.trim()}
            style={{ width: "100%", padding: "10px 16px", fontSize: 14, fontWeight: 600 }}
          >
            {busy ? "Creating…" : "Create site"}
          </button>
          {error && (
            <div style={{ marginTop: 12, color: "#ef4444", fontSize: 13 }}>
              ✗ {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
