import { useEffect, useState } from "react";
import {
  SiteAdmin, EnrollmentToken,
  adminListSites, adminCreateSite, adminArchiveSite, adminCreateEnrollmentToken,
} from "./api";

interface Props { card: React.CSSProperties }

// Local user identity (v1 placeholder; will be replaced by Keycloak principal in RBAC phase)
const ACTOR = localStorage.getItem("sot_actor") || "operator";

export default function SiteAdminView({ card }: Props) {
  const [sites, setSites]             = useState<SiteAdmin[]>([]);
  const [loading, setLoading]         = useState(false);
  const [err, setErr]                 = useState("");
  const [showCreate, setShowCreate]   = useState(false);

  // create form state
  const [name, setName]               = useState("");
  const [location, setLocation]       = useState("");
  const [cidr, setCidr]               = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [busy, setBusy]               = useState(false);

  // token modal state
  const [token, setToken]             = useState<EnrollmentToken | null>(null);

  async function refresh() {
    setLoading(true); setErr("");
    try { setSites(await adminListSites()); }
    catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  async function handleCreate() {
    if (name.trim().length < 2) { setErr("Name must be at least 2 chars"); return; }
    setBusy(true); setErr("");
    try {
      await adminCreateSite({
        name: name.trim(),
        location: location.trim() || undefined,
        network_cidr: cidr.trim() || undefined,
        contact_name: contactName.trim() || undefined,
        contact_email: contactEmail.trim() || undefined,
        actor: ACTOR,
      });
      setShowCreate(false);
      setName(""); setLocation(""); setCidr(""); setContactName(""); setContactEmail("");
      await refresh();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function handleArchive(site: SiteAdmin) {
    if (site.device_count > 0) {
      alert(`Cannot archive "${site.name}" — it has ${site.device_count} devices.`);
      return;
    }
    const reason = prompt(`Archive "${site.name}"? Enter reason:`);
    if (!reason) return;
    try {
      await adminArchiveSite(site.id, { actor: ACTOR, reason });
      await refresh();
    } catch (e: any) { setErr(e.message); }
  }

  async function handleToken(site: SiteAdmin) {
    const label = prompt(`Generate enrollment token for "${site.name}"\nOptional label:`, "sensor-1");
    try {
      const t = await adminCreateEnrollmentToken(site.id, { actor: ACTOR, label: label || undefined, ttl_hours: 72 });
      setToken(t);
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#F5F5F7", margin: 0 }}>Sites</h1>
          <div style={{ fontSize: 12, color: "#8E8E93", marginTop: 4 }}>
            Multi-plant tenant administration · operator: {ACTOR}
          </div>
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{ padding: "8px 18px", borderRadius: 8, background: "#007AFF",
                   color: "#fff", fontWeight: 600, fontSize: 13, border: "none", cursor: "pointer" }}>
          + Add site
        </button>
      </div>

      {err && <div style={{ color: "#FF6B61", fontSize: 12 }}>⚠ {err}</div>}

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ color: "#8E8E93", textAlign: "left", fontSize: 10, letterSpacing: "0.5px" }}>
              <th style={{ padding: "12px 20px", fontWeight: 600 }}>SITE</th>
              <th style={{ padding: "12px 8px", fontWeight: 600 }}>LOCATION</th>
              <th style={{ padding: "12px 8px", fontWeight: 600 }}>TIMEZONE</th>
              <th style={{ padding: "12px 8px", fontWeight: 600 }}>DEVICES</th>
              <th style={{ padding: "12px 8px", fontWeight: 600 }}>CONTACT</th>
              <th style={{ padding: "12px 20px", fontWeight: 600 }}>ACTIONS</th>
            </tr>
          </thead>
          <tbody>
            {sites.map(s => (
              <tr key={s.id} style={{ borderTop: "1px solid #2C2C2E" }}>
                <td style={{ padding: "14px 20px", color: "#F5F5F7", fontWeight: 600 }}>{s.name}</td>
                <td style={{ padding: "14px 8px", color: "#D1D1D6" }}>{s.location || "—"}</td>
                <td style={{ padding: "14px 8px", color: "#8E8E93", fontSize: 11 }}>{s.timezone}</td>
                <td style={{ padding: "14px 8px", color: "#D1D1D6" }}>{s.device_count}</td>
                <td style={{ padding: "14px 8px", color: "#8E8E93", fontSize: 11 }}>
                  {s.contact_name || "—"}
                  {s.contact_email && <div style={{ fontSize: 10 }}>{s.contact_email}</div>}
                </td>
                <td style={{ padding: "14px 20px" }}>
                  <button onClick={() => handleToken(s)}
                    style={{ marginRight: 8, padding: "5px 12px", borderRadius: 6,
                             background: "rgba(0,122,255,0.15)", border: "1px solid #007AFF",
                             color: "#007AFF", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                    Get enrollment token
                  </button>
                  <button onClick={() => handleArchive(s)}
                    disabled={s.device_count > 0}
                    title={s.device_count > 0 ? "Cannot archive — site has devices" : "Archive site"}
                    style={{ padding: "5px 12px", borderRadius: 6,
                             background: s.device_count > 0 ? "rgba(142,142,147,0.1)" : "rgba(255,59,48,0.1)",
                             border: `1px solid ${s.device_count > 0 ? "#3A3A3C" : "rgba(255,59,48,0.4)"}`,
                             color: s.device_count > 0 ? "#8E8E93" : "#FF6B61",
                             fontSize: 11, fontWeight: 600,
                             cursor: s.device_count > 0 ? "not-allowed" : "pointer" }}>
                    Archive
                  </button>
                </td>
              </tr>
            ))}
            {sites.length === 0 && !loading && (
              <tr><td colSpan={6} style={{ padding: 40, textAlign: "center", color: "#8E8E93" }}>
                No sites yet. Click "+ Add site" to create the first one.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* CREATE MODAL */}
      {showCreate && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
                      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
             onClick={() => !busy && setShowCreate(false)}>
          <div onClick={e => e.stopPropagation()}
               style={{ background: "#1C1C1E", border: "1px solid #3A3A3C", borderRadius: 14,
                        padding: 24, width: 500, maxWidth: "90vw" }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "#F5F5F7", margin: 0, marginBottom: 16 }}>
              Create new site
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ fontSize: 12, color: "#8E8E93" }}>
                Site name *
                <input value={name} onChange={e => setName(e.target.value)} autoFocus
                  placeholder="e.g. Chennai Plant"
                  style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px",
                           background: "#2C2C2E", border: "1px solid #48484A", borderRadius: 8,
                           color: "#F5F5F7", fontSize: 13, boxSizing: "border-box" }} />
              </label>
              <label style={{ fontSize: 12, color: "#8E8E93" }}>
                Location
                <input value={location} onChange={e => setLocation(e.target.value)}
                  placeholder="e.g. Chennai, Tamil Nadu"
                  style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px",
                           background: "#2C2C2E", border: "1px solid #48484A", borderRadius: 8,
                           color: "#F5F5F7", fontSize: 13, boxSizing: "border-box" }} />
              </label>
              <label style={{ fontSize: 12, color: "#8E8E93" }}>
                Network CIDR (optional)
                <input value={cidr} onChange={e => setCidr(e.target.value)}
                  placeholder="e.g. 10.20.0.0/16"
                  style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px",
                           background: "#2C2C2E", border: "1px solid #48484A", borderRadius: 8,
                           color: "#F5F5F7", fontSize: 13, boxSizing: "border-box" }} />
              </label>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ flex: 1, fontSize: 12, color: "#8E8E93" }}>
                  Contact name
                  <input value={contactName} onChange={e => setContactName(e.target.value)}
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px",
                             background: "#2C2C2E", border: "1px solid #48484A", borderRadius: 8,
                             color: "#F5F5F7", fontSize: 13, boxSizing: "border-box" }} />
                </label>
                <label style={{ flex: 1, fontSize: 12, color: "#8E8E93" }}>
                  Contact email
                  <input value={contactEmail} onChange={e => setContactEmail(e.target.value)}
                    type="email"
                    style={{ display: "block", width: "100%", marginTop: 4, padding: "8px 12px",
                             background: "#2C2C2E", border: "1px solid #48484A", borderRadius: 8,
                             color: "#F5F5F7", fontSize: 13, boxSizing: "border-box" }} />
                </label>
              </div>
            </div>
            {err && <div style={{ color: "#FF6B61", fontSize: 12, marginTop: 12 }}>⚠ {err}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button onClick={() => setShowCreate(false)} disabled={busy}
                style={{ padding: "8px 16px", borderRadius: 8, background: "#2C2C2E",
                         border: "1px solid #48484A", color: "#D1D1D6", fontSize: 13, cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={handleCreate} disabled={busy || name.trim().length < 2}
                style={{ padding: "8px 20px", borderRadius: 8,
                         background: busy || name.trim().length < 2 ? "#3A3A3C" : "#007AFF",
                         color: "#fff", fontSize: 13, fontWeight: 600, border: "none",
                         cursor: busy || name.trim().length < 2 ? "not-allowed" : "pointer" }}>
                {busy ? "Creating…" : "Create site"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ENROLLMENT TOKEN MODAL */}
      {token && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
                      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
             onClick={() => setToken(null)}>
          <div onClick={e => e.stopPropagation()}
               style={{ background: "#1C1C1E", border: "1px solid #3A3A3C", borderRadius: 14,
                        padding: 24, width: 640, maxWidth: "90vw" }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: "#F5F5F7", margin: 0 }}>
              Enrollment token for {token.site_name}
            </h2>
            <div style={{ fontSize: 12, color: "#FF9F0A", marginTop: 6, marginBottom: 16 }}>
              ⚠ Shown only once. Store it securely or regenerate.
            </div>
            <div style={{ fontSize: 11, color: "#8E8E93", marginBottom: 4 }}>Token</div>
            <code style={{ display: "block", padding: 12, background: "#0A0A0A",
                           borderRadius: 8, border: "1px solid #3A3A3C",
                           color: "#32D74B", fontSize: 12, fontFamily: "'JetBrains Mono',monospace",
                           wordBreak: "break-all" }}>{token.token}</code>
            <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 16, marginBottom: 4 }}>
              Install command for the sensor host
            </div>
            <pre style={{ padding: 12, background: "#0A0A0A", borderRadius: 8,
                          border: "1px solid #3A3A3C", color: "#F5F5F7", fontSize: 11,
                          overflow: "auto", margin: 0, whiteSpace: "pre-wrap" }}>{token.install_hint}</pre>
            <div style={{ fontSize: 11, color: "#8E8E93", marginTop: 12 }}>
              Expires: {new Date(token.expires_at).toLocaleString()}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 20 }}>
              <button onClick={() => { navigator.clipboard.writeText(token.token); }}
                style={{ padding: "8px 16px", borderRadius: 8, background: "#2C2C2E",
                         border: "1px solid #48484A", color: "#D1D1D6", fontSize: 13, cursor: "pointer" }}>
                Copy token
              </button>
              <button onClick={() => setToken(null)}
                style={{ padding: "8px 20px", borderRadius: 8, background: "#007AFF",
                         color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
