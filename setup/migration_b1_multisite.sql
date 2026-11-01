-- ===========================================================================
-- B1 — Multi-site fan-out + per-site settings
-- Safe: adds columns/tables, backfills existing data, nothing dropped.
-- Run once. Idempotent (uses IF NOT EXISTS / IF NOT EXISTS on ALTER).
-- ===========================================================================

BEGIN;

-- ── 1. sites: archived_at for soft delete ─────────────────────────────────
ALTER TABLE sites ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS archived_by text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS archived_reason text;

-- ── 2. settings: site_id, per-site key uniqueness ─────────────────────────
ALTER TABLE settings ADD COLUMN IF NOT EXISTS site_id uuid;

-- Backfill existing settings to the first non-archived site (Lab Site)
UPDATE settings
   SET site_id = (
        SELECT id FROM sites WHERE archived_at IS NULL ORDER BY created_at LIMIT 1
   )
 WHERE site_id IS NULL;

-- Only enforce NOT NULL if at least one site exists (fresh install has none)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM sites WHERE archived_at IS NULL) THEN
    ALTER TABLE settings ALTER COLUMN site_id SET NOT NULL;
  END IF;
END $$;

-- Drop the tenant-scoped PK, create site-scoped PK. Guarded by IF NOT EXISTS on constraint names.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'settings_pkey' AND conrelid = 'settings'::regclass
  ) THEN
    ALTER TABLE settings DROP CONSTRAINT settings_pkey;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'settings_site_key_pkey' AND conrelid = 'settings'::regclass
  ) THEN
    -- Only add if site_id is fully populated (no NULLs would fail this)
    IF NOT EXISTS (SELECT 1 FROM settings WHERE site_id IS NULL) THEN
      ALTER TABLE settings ADD CONSTRAINT settings_site_key_pkey PRIMARY KEY (site_id, key);
    ELSE
      RAISE NOTICE 'Skipping settings PK change: site_id still has NULLs (fresh install)';
    END IF;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_settings_site ON settings(site_id);

-- ── 3. sensor_site_subscriptions (fan-out table) ──────────────────────────
CREATE TABLE IF NOT EXISTS sensor_site_subscriptions (
    sensor_id       uuid        NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
    site_id         uuid        NOT NULL REFERENCES sites(id)   ON DELETE CASCADE,
    subscribed_at   timestamptz NOT NULL DEFAULT now(),
    subscribed_by   text,
    PRIMARY KEY (sensor_id, site_id)
);

CREATE INDEX IF NOT EXISTS idx_sensor_site_site ON sensor_site_subscriptions(site_id);

-- Backfill: every existing sensor → auto-subscribe to the first non-archived site
INSERT INTO sensor_site_subscriptions (sensor_id, site_id, subscribed_by)
SELECT s.id, (SELECT id FROM sites WHERE archived_at IS NULL ORDER BY created_at LIMIT 1), 'migration'
  FROM sensors s
 WHERE EXISTS (SELECT 1 FROM sites WHERE archived_at IS NULL)
   AND NOT EXISTS (
        SELECT 1 FROM sensor_site_subscriptions x
         WHERE x.sensor_id = s.id
           AND x.site_id  = (SELECT id FROM sites WHERE archived_at IS NULL ORDER BY created_at LIMIT 1)
   );

COMMIT;

-- ── Report ────────────────────────────────────────────────────────────────
SELECT 'sites with archived_at column' AS what, count(*)::text AS n FROM information_schema.columns
 WHERE table_name='sites' AND column_name='archived_at';
SELECT 'settings rows backfilled' AS what, count(*)::text AS n FROM settings WHERE site_id IS NOT NULL;
SELECT 'subscriptions created' AS what, count(*)::text AS n FROM sensor_site_subscriptions;
