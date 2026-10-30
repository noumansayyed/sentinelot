-- ---------------------------------------------------------------------------
-- Audit triggers — write audit_log on every INSERT/UPDATE/DELETE.
-- Apply once. Survives rebuilds.
--
-- Actor resolution: the app may call
--     SELECT set_config('app.actor', 'operator', true);
-- at the start of a request (transaction-scoped). If unset, actor is NULL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION audit_trigger_fn() RETURNS TRIGGER AS $$
DECLARE
    v_action      text;
    v_target_id   uuid;
    v_target_type text;
    v_tenant_id   uuid;
    v_site_id     uuid;
    v_details     jsonb;
    v_actor       text;
BEGIN
    -- IGNORE TimescaleDB internal chunks
    IF TG_TABLE_NAME LIKE '\_hyper\_%' OR TG_TABLE_NAME LIKE '\_timescaledb\_%' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    v_action := TG_TABLE_NAME || '.' || lower(TG_OP);
    v_target_type := TG_TABLE_NAME;
    v_actor := NULLIF(current_setting('app.actor', true), '');

    IF TG_OP = 'DELETE' THEN
        v_details := to_jsonb(OLD);
        v_target_id := (to_jsonb(OLD) ->> 'id')::uuid;
    ELSIF TG_OP = 'UPDATE' THEN
        v_details := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
        v_target_id := (to_jsonb(NEW) ->> 'id')::uuid;
    ELSE
        v_details := to_jsonb(NEW);
        v_target_id := (to_jsonb(NEW) ->> 'id')::uuid;
    END IF;

    -- pull tenant_id and site_id if the row has them
    v_tenant_id := COALESCE(
        (to_jsonb(COALESCE(NEW, OLD)) ->> 'tenant_id')::uuid,
        (SELECT tenant_id FROM sites WHERE id = (to_jsonb(COALESCE(NEW, OLD)) ->> 'site_id')::uuid)
    );
    v_site_id := (to_jsonb(COALESCE(NEW, OLD)) ->> 'site_id')::uuid;

    -- tenant_id is NOT NULL in audit_log; if we can't resolve it, skip (with a warning)
    IF v_tenant_id IS NULL THEN
        RAISE WARNING 'audit_trigger: cannot resolve tenant_id for %.% (id=%)',
            TG_TABLE_SCHEMA, TG_TABLE_NAME, v_target_id;
        RETURN COALESCE(NEW, OLD);
    END IF;

    INSERT INTO audit_log (tenant_id, site_id, actor, action, target,
                           target_type, target_id, details)
    VALUES (v_tenant_id, v_site_id, v_actor, v_action,
            v_target_id::text, v_target_type, v_target_id, v_details);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Attach to the tables that matter.
DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'assets',
        'alerts',
        'sites',
        'compliance_reports',
        'enrollment_tokens'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS audit_%I ON %I', tbl, tbl);
        IF tbl = 'assets' THEN
            EXECUTE 'CREATE TRIGGER audit_assets
                     AFTER UPDATE OF device_role, role_manual, criticality, hidden, hidden_reason
                        ON assets
                     FOR EACH ROW
                     WHEN (OLD.device_role IS DISTINCT FROM NEW.device_role
                        OR OLD.role_manual IS DISTINCT FROM NEW.role_manual
                        OR OLD.criticality IS DISTINCT FROM NEW.criticality
                        OR OLD.hidden      IS DISTINCT FROM NEW.hidden
                        OR OLD.hidden_reason IS DISTINCT FROM NEW.hidden_reason)
                     EXECUTE FUNCTION audit_trigger_fn()';
        ELSE
            EXECUTE format(
                'CREATE TRIGGER audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I '
                'FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn()',
                tbl, tbl
            );
        END IF;
    END LOOP;
END $$;
