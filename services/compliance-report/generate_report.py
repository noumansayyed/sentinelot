import os
import sys
import psycopg2
from datetime import datetime, timezone
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ["DATABASE_URL"]

def fetch(pool, query, params=None):
    with pool.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(query, params)
        return cur.fetchall()

def generate(target_site_id=None):
    conn = psycopg2.connect(DATABASE_URL)
    try:
        # Find the target site (default to Pune if not specified)
        if target_site_id:
            site = fetch(conn, "SELECT id, name FROM sites WHERE id = %s", (target_site_id,))
        else:
            site = fetch(conn, "SELECT id, name FROM sites ORDER BY name LIMIT 1")
        
        if not site:
            site = fetch(conn, "SELECT id, name FROM sites ORDER BY name LIMIT 1")
        
        if not site:
            raise RuntimeError("No sites configured")

        site_id = site[0]["id"]
        site_name = site[0]["name"]

        assets = fetch(conn, "SELECT ip_address::text AS ip, mac_address::text AS mac, COALESCE(role_manual, device_role) AS role, protocols, criticality, first_seen, last_seen FROM assets WHERE site_id = %s ORDER BY ip_address", (site_id,))
        alerts = fetch(conn, "SELECT time, severity, status, description FROM alerts WHERE site_id = %s AND time > now() - interval '30 days' ORDER BY time DESC", (site_id,))
        events = fetch(conn, "SELECT protocol, count(*) AS cnt FROM protocol_events WHERE site_id = %s AND time > now() - interval '7 days' GROUP BY protocol ORDER BY protocol", (site_id,))

        now = datetime.now(timezone.utc)

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>SentinelOT — Compliance Report</title>
<style>
  @page {{ size: A4; margin: 20mm; }}
  * {{ box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 0; padding: 32px; background: #ffffff; color: #1c1c1e; font-size: 14px; line-height: 1.6; }}
  .header {{ border-bottom: 3px solid #0a84ff; padding-bottom: 16px; margin-bottom: 32px; }}
  .header h1 {{ margin: 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px; }}
  .header .meta {{ color: #6e6e73; font-size: 12px; margin-top: 8px; }}
  .summary {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }}
  .summary-box {{ border: 1px solid #e5e5ea; border-radius: 10px; padding: 16px; }}
  .summary-box .label {{ font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #6e6e73; font-weight: 600; }}
  .summary-box .value {{ font-size: 28px; font-weight: 700; margin-top: 8px; }}
  h2 {{ font-size: 18px; font-weight: 700; margin-top: 36px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #e5e5ea; }}
  table {{ width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }}
  th {{ background: #f5f5f7; text-align: left; padding: 10px 12px; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px; color: #3a3a3c; border-bottom: 2px solid #e5e5ea; }}
  td {{ padding: 10px 12px; border-bottom: 1px solid #f0f0f2; }}
  tr:last-child td {{ border-bottom: none; }}
  .badge {{ display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; }}
  .badge-critical {{ background: #ffe5e3; color: #c0392b; }}
  .badge-high     {{ background: #fff3e0; color: #e67e22; }}
  .badge-medium   {{ background: #fff9c4; color: #b7950b; }}
  .badge-low      {{ background: #e8f5e9; color: #2e7d32; }}
  .empty {{ color: #6e6e73; font-style: italic; padding: 20px; text-align: center; }}
  .footer {{ margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e5ea; font-size: 11px; color: #6e6e73; }}
</style>
</head>
<body>
  <div class="header">
    <h1>SentinelOT — Compliance Report</h1>
    <div class="meta">
      Site: <strong>{site_name}</strong> · Generated: {now.strftime('%Y-%m-%d %H:%M UTC')}<br>
      Framework: CERT-In Guidelines · DPDPA · 30-day window
    </div>
  </div>

  <div class="summary">
    <div class="summary-box"><div class="label">Monitored Assets</div><div class="value">{len(assets)}</div></div>
    <div class="summary-box"><div class="label">Alerts (30d)</div><div class="value">{len(alerts)}</div></div>
    <div class="summary-box"><div class="label">Open Alerts</div><div class="value">{sum(1 for a in alerts if a['status'] in ('open','acknowledged','escalated'))}</div></div>
    <div class="summary-box"><div class="label">Protocol Events (7d)</div><div class="value">{sum(e['cnt'] for e in events)}</div></div>
  </div>

  <h2>1. Monitored Asset Inventory</h2>
  <table>
    <thead><tr><th>IP Address</th><th>MAC</th><th>Role</th><th>Protocols</th><th>Criticality</th><th>First Seen</th><th>Last Seen</th></tr></thead>
    <tbody>
"""
        if not assets:
            html += '<tr><td colspan="7" class="empty">No assets discovered.</td></tr>'
        else:
            for a in assets:
                html += f"<tr><td><strong>{(a['ip'] or '').replace('/32','')}</strong></td><td>{a['mac'] or '—'}</td><td>{a['role'] or 'unknown'}</td><td>{', '.join(a['protocols'] or []) or '—'}</td><td>{a['criticality'] or 'unclassified'}</td><td>{a['first_seen'].strftime('%Y-%m-%d') if a['first_seen'] else '—'}</td><td>{a['last_seen'].strftime('%Y-%m-%d %H:%M') if a['last_seen'] else '—'}</td></tr>"

        html += """</tbody></table><h2>2. Security Alerts (last 30 days)</h2><table><thead><tr><th>Time</th><th>Severity</th><th>Status</th><th>Description</th></tr></thead><tbody>"""
        
        if not alerts:
            html += '<tr><td colspan="4" class="empty">No alerts in the last 30 days.</td></tr>'
        else:
            for a in alerts[:50]:
                sev = a['severity'] or 'info'
                html += f"<tr><td style='white-space:nowrap;'>{a['time'].strftime('%Y-%m-%d %H:%M')}</td><td><span class='badge badge-{sev}'>{sev}</span></td><td>{a['status']}</td><td>{a['description']}</td></tr>"

        html += """</tbody></table><h2>3. Protocol Activity (last 7 days)</h2><table><thead><tr><th>Protocol</th><th>Events</th></tr></thead><tbody>"""
        if not events:
            html += '<tr><td colspan="2" class="empty">No protocol events in the last 7 days.</td></tr>'
        else:
            for e in events:
                html += f"<tr><td>{e['protocol']}</td><td>{e['cnt']:,}</td></tr>"

        html += f"""</tbody></table><div class="footer"><p><strong>Scope note:</strong> This report documents OT network monitoring activity and security events captured by SentinelOT for the reporting period. It supports CERT-In incident-reporting guidelines and DPDPA's breach-notification relevance where applicable.</p><p><strong>Methodology:</strong> Passive network monitoring via Zeek and Suricata with ICS protocol parsers. No active scanning or packet injection is performed.</p><p>Generated by SentinelOT · {now.strftime('%Y-%m-%d %H:%M:%S UTC')}</p></div></body></html>"""

        out_path = f"/reports/compliance_report_{site_id}.html"
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(html)
        
        # Log to archive table
        with conn.cursor() as cur:
            cur.execute("INSERT INTO report_archive (site_id, site_name, file_path, triggered_by) VALUES (%s, %s, %s, %s)",
                        (site_id, site_name, out_path, os.environ.get("TRIGGERED_BY", "manual")))
        conn.commit()
        
        print(f"Report generated for {site_name} → {out_path}")
        return out_path

    finally:
        conn.close()

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else None
    generate(target)
