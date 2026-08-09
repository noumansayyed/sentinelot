-- SentinelOT database schema
-- PostgreSQL 16 + TimescaleDB extension

CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT NOT NULL,
    plan_tier           TEXT NOT NULL DEFAULT 'starter' CHECK (plan_tier IN ('starter', 'growth', 'enterprise')),
    billing_status      TEXT NOT NULL DEFAULT 'trial' CHECK (billing_status IN ('trial', 'active', 'past_due', 'cancelled')),
    dpdpa_data_fiduciary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    address     TEXT,
    timezone    TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    region      TEXT NOT NULL DEFAULT 'ap-south-1',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sensors (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    label               TEXT NOT NULL,
    mtls_cert_fingerprint TEXT NOT NULL UNIQUE,
    software_version    TEXT,
    status              TEXT NOT NULL DEFAULT 'provisioned' CHECK (status IN ('provisioned', 'online', 'offline', 'decommissioned')),
    last_heartbeat_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sensors_site ON sensors(site_id);

CREATE TABLE assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    mac_address     MACADDR,
    ip_address      INET,
    vendor_oui      TEXT,
    device_role     TEXT CHECK (device_role IN ('plc', 'hmi', 'rtu', 'sensor', 'engineering_workstation', 'switch', 'unknown')),
    protocols       TEXT[] NOT NULL DEFAULT '{}',
    criticality     TEXT NOT NULL DEFAULT 'unclassified' CHECK (criticality IN ('critical', 'high', 'medium', 'low', 'unclassified')),
    first_seen      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (site_id, mac_address)
);

CREATE INDEX idx_assets_site ON assets(site_id);

CREATE TABLE protocol_events (
    time            TIMESTAMPTZ NOT NULL,
    sensor_id       UUID NOT NULL,
    site_id         UUID NOT NULL,
    src_asset_id    UUID,
    dst_asset_id    UUID,
    protocol        TEXT NOT NULL,
    function_code   TEXT,
    payload_summary JSONB,
    zeek_uid        TEXT
);

SELECT create_hypertable('protocol_events', 'time');
CREATE INDEX idx_protocol_events_site_time ON protocol_events (site_id, time DESC);
CREATE INDEX idx_protocol_events_src_asset ON protocol_events (src_asset_id, time DESC);

ALTER TABLE protocol_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'site_id, protocol'
);
SELECT add_compression_policy('protocol_events', INTERVAL '7 days');

CREATE TABLE detection_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_key            TEXT NOT NULL,
    version             INT NOT NULL DEFAULT 1,
    description         TEXT NOT NULL,
    severity            TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    mitre_attack_ics_id TEXT,
    rule_type           TEXT NOT NULL CHECK (rule_type IN ('suricata_signature', 'zeek_script', 'ml_model', 'heuristic')),
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (rule_key, version)
);

CREATE TABLE alerts (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    time            TIMESTAMPTZ NOT NULL DEFAULT now(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    site_id         UUID NOT NULL REFERENCES sites(id),
    asset_id        UUID REFERENCES assets(id),
    rule_id         UUID REFERENCES detection_rules(id),
    severity        TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    description     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'false_positive')),
    evidence        JSONB,
    PRIMARY KEY (id, time)
);

SELECT create_hypertable('alerts', 'time');
CREATE INDEX idx_alerts_tenant_status ON alerts (tenant_id, status, time DESC);

CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email       TEXT NOT NULL UNIQUE,
    keycloak_subject_id TEXT NOT NULL UNIQUE,
    role        TEXT NOT NULL CHECK (role IN ('admin', 'security_viewer', 'auditor_readonly')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE compliance_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    site_id         UUID NOT NULL REFERENCES sites(id),
    report_type     TEXT NOT NULL CHECK (report_type IN ('cert_in_aligned', 'dpdpa_safeguards', 'monthly_summary')),
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    s3_object_key   TEXT NOT NULL,
    generated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id          BIGSERIAL PRIMARY KEY,
    time        TIMESTAMPTZ NOT NULL DEFAULT now(),
    tenant_id   UUID NOT NULL,
    user_id     UUID,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   UUID,
    details     JSONB
);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_alerts ON alerts
    USING (tenant_id = current_setting('app.current_tenant')::uuid);
