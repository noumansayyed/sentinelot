-- Per-tenant settings. JSONB blob so we can add keys without migrations.
CREATE TABLE IF NOT EXISTS settings (
    tenant_id uuid NOT NULL,
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, key)
);

-- Seed defaults (idempotent)
INSERT INTO settings (tenant_id, key, value) VALUES
  ('11111111-1111-1111-1111-111111111111', 'detection.off_hours_start', '"22:00"'::jsonb),
  ('11111111-1111-1111-1111-111111111111', 'detection.off_hours_end',   '"06:00"'::jsonb),
  ('11111111-1111-1111-1111-111111111111', 'detection.zscore_threshold', '3.0'::jsonb),
  ('11111111-1111-1111-1111-111111111111', 'detection.baseline_min_samples', '30'::jsonb),
  ('11111111-1111-1111-1111-111111111111', 'detection.enabled_protocols', '["modbus_tcp","s7comm","dnp3","opcua"]'::jsonb),
  ('11111111-1111-1111-1111-111111111111', 'capture.interface', '"eth0"'::jsonb),
  ('11111111-1111-1111-1111-111111111111', 'retention.events_days', '30'::jsonb)
ON CONFLICT (tenant_id, key) DO NOTHING;
