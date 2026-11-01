import { useEffect, useState } from "react";
import { useSite } from "./SiteContext";

const API = "http://localhost:8000";
const DEMO_TENANT = "11111111-1111-1111-1111-111111111111";

type SiteRow = {
  id: string;
  name: string;
  created_at: string | null;
  last_event_at: string | null;
  event_count: number;
  asset_count: number;
  alert_count: number;
};

function fmtRel(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export default function SitesView({ card }: { card: React.CSSProperties }) {
  const { currentSite, selectSite, refreshSites } = useSite();
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // create / rename
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`${API}/v1/sites`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows(j.sites || []);
      setError(null);
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createSite() {
    if (!newName.trim()) return;
    setBusy("create");
    try {
      const r = await fetch(`${API}/v1/tenants/${DEMO_TENANT}/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), actor: "admin" }),
      });
      if (!r.ok) throw new Error(await r.text());
      setNewName("");
      setShowCreate(false);
      await load();
      await refreshSites();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function renameSite(id: string) {
    if (!editName.trim()) return;
    setBusy(id);
    try {
      const r = await fetch(`${API}/v1/sites/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim(), actor: "admin" }),
      });
      if (!r.ok) throw new Error(await r.text());
      setEditing(null);
      await load();
      await refreshSites();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(null);
    }
  }

  async function deleteSite(id: string, name: string) {
    if (!confirm(`Delete site "${name}"? This only works if the site is empty.`)) return;
    setBusy(id);
    try {
      const r = await fetch(`${API}/v1/sites/${id}?actor=admin`, { method: "DELETE" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      await load();
      await refreshSites();
    } catch (e: any) {
      setError(String(e.message || e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="float-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1 className="t-h1" style={{ margin: 0 }}>Sites</h1>
          <div className="t-meta" style={{ marginTop: 8 }}>
            Sites are engagement scopes — each has its own sensors, assets, events, and alerts.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(v => !v)}
          style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600 }}>
          {showCreate ? "Cancel" : "+ New Site"}
        </button>
      </div>

      {showCreate && (
        <div className="glass" style={{ padding: 16, display: "flex", gap: 12, alignItems: "center" }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") createSite(); }}
            placeholder="New site name"
            autoFocus
            style={{ flex: 1, padding: "10px 12px", borderRadius: 6,
              border: "1px solid var(--hairline)", background: "var(--bg-1)",
              color: "var(--text-1)", fontSize: 13 }}
          />
          <button className="btn btn-primary" onClick={createSite}
            disabled={busy === "create" || !newName.trim()}
            style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600 }}>
            {busy === "create" ? "Creating…" : "Create"}
          </button>
        </div>
      )}

      {error && (
        <div style={{ padding: 12, borderRadius: 6, background: "rgba(239,68,68,0.1)",
          border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", fontSize: 13 }}>
          {error}
        </div>
      )}

      {loading && <div style={{ padding: 24, textAlign: "center", color: "var(--text-3)" }}>Loading…</div>}

      {!loading && rows.map(r => {
        const isCurrent = currentSite?.id === r.id;
        const isEditing = editing === r.id;
        const hasData = r.event_count > 0 || r.asset_count > 0 || r.alert_count > 0;
        return (
          <div key={r.id} className="glass" style={{
            padding: 20, position: "relative",
            borderLeft: isCurrent ? "3px solid var(--accent)" : undefined,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              {isCurrent && (
                <span style={{ padding: "2px 8px", borderRadius: 999,
                  background: "var(--accent)", color: "#000", fontSize: 10, fontWeight: 700,
                  textTransform: "uppercase", letterSpacing: 0.5 }}>
                  Current
                </span>
              )}
              {isEditing ? (
                <>
                  <input value={editName} onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") renameSite(r.id);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    autoFocus
                    style={{ flex: 1, padding: "6px 10px", borderRadius: 6,
                      border: "1px solid var(--hairline)", background: "var(--bg-1)",
                      color: "var(--text-1)", fontSize: 14, fontWeight: 600 }} />
                  <button className="btn btn-primary" onClick={() => renameSite(r.id)}
                    disabled={busy === r.id}
                    style={{ padding: "6px 14px", fontSize: 12 }}>
                    {busy === r.id ? "Saving…" : "Save"}
                  </button>
                  <button className="btn" onClick={() => setEditing(null)}
                    style={{ padding: "6px 14px", fontSize: 12 }}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 18, fontWeight: 600, flex: 1 }}>{r.name}</div>
                  {!isCurrent && (
                    <button className="btn" onClick={() => selectSite(r.id)}
                      style={{ padding: "6px 14px", fontSize: 12 }}>
                      Switch to
                    </button>
                  )}
                  <button className="btn" onClick={() => { setEditing(r.id); setEditName(r.name); }}
                    style={{ padding: "6px 14px", fontSize: 12 }}>
                    Rename
                  </button>
                  <button className="btn" onClick={() => deleteSite(r.id, r.name)}
                    disabled={hasData || busy === r.id}
                    title={hasData ? "Site has data — purge events first via Settings" : "Delete this site"}
                    style={{ padding: "6px 14px", fontSize: 12,
                      borderColor: hasData ? "var(--hairline)" : "#ef4444",
                      color: hasData ? "var(--text-3)" : "#ef4444" }}>
                    {busy === r.id ? "…" : "Delete"}
                  </button>
                </>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "8px 24px", fontSize: 12, color: "var(--text-2)" }}>
              <div><span style={{ color: "var(--text-3)" }}>ID:</span> <code style={{ fontFamily: "monospace" }}>{r.id}</code></div>
              <div><span style={{ color: "var(--text-3)" }}>Created:</span> {r.created_at ? new Date(r.created_at).toLocaleString() : "—"} ({fmtRel(r.created_at)})</div>
              <div><span style={{ color: "var(--text-3)" }}>Last data:</span> {fmtRel(r.last_event_at)}</div>
              <div><span style={{ color: "var(--text-3)" }}>Events:</span> {r.event_count.toLocaleString()}</div>
              <div><span style={{ color: "var(--text-3)" }}>Assets:</span> {r.asset_count.toLocaleString()}</div>
              <div><span style={{ color: "var(--text-3)" }}>Open alerts:</span> {r.alert_count.toLocaleString()}</div>
            </div>

            {hasData && (
              <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 6,
                background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
                fontSize: 12, color: "var(--text-2)" }}>
                ⚠ This site has data — delete is disabled. Purge events first via Settings → Retention.
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
