"""Heuristic device classifier."""
import asyncio, asyncpg, os

DATABASE_URL = os.environ["DATABASE_URL"]

async def classify(pool, site_id):
    # Gateway: no protocol events in 24h -> hidden
    await pool.execute("""
        UPDATE assets a
        SET hidden = true,
            hidden_reason = 'no protocol events in 24h — infrastructure (gateway/switch)'
        WHERE a.site_id = $1
          AND a.role_manual IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM protocol_events pe
              WHERE (pe.src_asset_id = a.id OR pe.dst_asset_id = a.id)
                AND pe.time > now() - interval '24 hours'
          )
    """, site_id)

    # Unhide anything active again
    await pool.execute("""
        UPDATE assets a
        SET hidden = false, hidden_reason = NULL
        WHERE a.site_id = $1 AND a.hidden = true
          AND EXISTS (
              SELECT 1 FROM protocol_events pe
              WHERE (pe.src_asset_id = a.id OR pe.dst_asset_id = a.id)
                AND pe.time > now() - interval '5 minutes'
          )
    """, site_id)


    # Gateway/relay detection: appears overwhelmingly as destination, rarely as source
    await pool.execute("""
        UPDATE assets a
        SET hidden = true,
            hidden_reason = 'appears as destination in most traffic — infrastructure (relay/gateway)'
        WHERE a.site_id = $1
          AND a.role_manual IS NULL
          AND (
            SELECT CASE WHEN count(*) FILTER (WHERE pe.src_asset_id = a.id) > 0
                        THEN count(*) FILTER (WHERE pe.dst_asset_id = a.id)::float
                             / count(*) FILTER (WHERE pe.src_asset_id = a.id OR pe.dst_asset_id = a.id)
                        ELSE 0 END
            FROM protocol_events pe
            WHERE (pe.src_asset_id = a.id OR pe.dst_asset_id = a.id)
              AND pe.time > now() - interval '24 hours'
          ) > 0.8
          AND EXISTS (
            SELECT 1 FROM protocol_events pe
            WHERE (pe.src_asset_id = a.id OR pe.dst_asset_id = a.id)
              AND pe.time > now() - interval '24 hours'
          )
    """, site_id)

    # PLC: receives WRITE
    await pool.execute("""
        UPDATE assets a SET device_role = 'plc', criticality = COALESCE(NULLIF(criticality, 'unclassified'), 'critical')
        WHERE a.site_id = $1 AND a.role_manual IS NULL
          AND EXISTS (
              SELECT 1 FROM protocol_events pe
              WHERE pe.dst_asset_id = a.id
                AND pe.function_code ILIKE '%WRITE%'
                AND pe.time > now() - interval '24 hours'
          )
    """, site_id)

    # HMI: sends many Modbus READs
    await pool.execute("""
        UPDATE assets a SET device_role = 'hmi', criticality = COALESCE(NULLIF(criticality, 'unclassified'), 'high')
        WHERE a.site_id = $1 AND a.role_manual IS NULL AND a.device_role <> 'plc'
          AND (
              SELECT count(*) FROM protocol_events pe
              WHERE pe.src_asset_id = a.id AND pe.protocol = 'modbus_tcp'
                AND pe.function_code ILIKE '%READ%'
                AND pe.time > now() - interval '24 hours'
          ) > 100
    """, site_id)

    # Protocol-only roles for unknowns
    await pool.execute("""
        UPDATE assets a SET device_role = 'engineering_workstation', criticality = COALESCE(NULLIF(criticality, 'unclassified'), 'medium')
        WHERE a.site_id = $1 AND a.role_manual IS NULL AND a.device_role = 'unknown'
          AND EXISTS (SELECT 1 FROM protocol_events pe
                      WHERE pe.src_asset_id = a.id AND pe.protocol = 's7comm'
                        AND pe.time > now() - interval '24 hours')
    """, site_id)
    await pool.execute("""
        UPDATE assets a SET device_role = 'rtu', criticality = COALESCE(NULLIF(criticality, 'unclassified'), 'high')
        WHERE a.site_id = $1 AND a.role_manual IS NULL AND a.device_role = 'unknown'
          AND EXISTS (SELECT 1 FROM protocol_events pe
                      WHERE pe.src_asset_id = a.id AND pe.protocol = 'dnp3'
                        AND pe.time > now() - interval '24 hours')
    """, site_id)
    await pool.execute("""
        UPDATE assets a SET device_role = 'sensor', criticality = COALESCE(NULLIF(criticality, 'unclassified'), 'medium')
        WHERE a.site_id = $1 AND a.role_manual IS NULL AND a.device_role = 'unknown'
          AND EXISTS (SELECT 1 FROM protocol_events pe
                      WHERE pe.src_asset_id = a.id AND pe.protocol = 'opcua'
                        AND pe.time > now() - interval '24 hours')
    """, site_id)

    return await pool.fetch("""
        SELECT ip_address::text AS ip, device_role, hidden, hidden_reason
        FROM assets WHERE site_id = $1 ORDER BY last_seen DESC
    """, site_id)

async def main():
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=2)
    try:
        site_id = await pool.fetchval("SELECT id FROM sites LIMIT 1")
        rows = await classify(pool, site_id)
        print(f"classified {len(rows)} devices:")
        for r in rows:
            mark = " (hidden)" if r["hidden"] else ""
            print(f"  {r['ip']:18} role={r['device_role']}{mark}")
    finally:
        await pool.close()

if __name__ == "__main__":
    asyncio.run(main())
