-- Housekeeping schema. Mutable human state lives HERE, never in ClickHouse.
-- Everything is idempotent (IF NOT EXISTS) — applied at API startup.

-- App users and their RCC filesystem identities. app username comes from the
-- login gate; owner_unames maps to `owner` values in filesystem.entries so
-- ownership-based assignment ("suggested reviewer") can join the two worlds.
CREATE TABLE IF NOT EXISTS person (
    username    TEXT PRIMARY KEY,
    display_name TEXT,
    owner_unames TEXT[] NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A target is a SELECTOR, not a file list: (root, path, scope, predicate)
-- resolved against ClickHouse at query time. EXCEPTION: frozen targets
-- (frozen_snapshot set) materialize their member list into target_member,
-- because snapshots are deleted daily — the pinned snapshot will not exist
-- tomorrow. Live targets never store members; do not re-litigate this.
CREATE TABLE IF NOT EXISTS target (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    root        TEXT NOT NULL,               -- storage root, e.g. /cds3/cil; never crosses roots
    path        TEXT NOT NULL,               -- must live under root
    path_hash   TEXT NOT NULL,               -- cityHash64(path) computed IN ClickHouse (single hash impl)
    scope       TEXT NOT NULL CHECK (scope IN ('subtree','shallow','single_file','query')),
    predicate   JSONB NOT NULL DEFAULT '{}',
    frozen_snapshot DATE,                    -- set => members materialized in target_member
    campaign    TEXT,
    created_by  TEXT NOT NULL REFERENCES person(username),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- cached rollup (refreshed on snapshot import; avoids re-scanning per page load)
    cached_bytes    BIGINT,
    cached_files    BIGINT,
    cached_snapshot DATE
);
CREATE INDEX IF NOT EXISTS target_root_idx ON target (root);
CREATE INDEX IF NOT EXISTS target_campaign_idx ON target (campaign);

-- Members of FROZEN targets only (see comment on target).
CREATE TABLE IF NOT EXISTS target_member (
    target_id  BIGINT NOT NULL REFERENCES target(id) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    path_hash  TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (target_id, path_hash)
);

CREATE TABLE IF NOT EXISTS assignment (
    id          BIGSERIAL PRIMARY KEY,
    target_id   BIGINT NOT NULL REFERENCES target(id),
    assignee    TEXT NOT NULL REFERENCES person(username),
    assigned_by TEXT NOT NULL REFERENCES person(username),
    due_date    DATE,
    status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','declined')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assignment_target_idx ON assignment (target_id);
CREATE INDEX IF NOT EXISTS assignment_assignee_idx ON assignment (assignee);

-- A decision records intent. Execution (below) records the separate act of
-- carrying it out — different actor, different timestamp; the gap between
-- them is the main thing the tool tracks.
CREATE TABLE IF NOT EXISTS decision (
    id          BIGSERIAL PRIMARY KEY,
    target_id   BIGINT NOT NULL REFERENCES target(id),
    verdict     TEXT NOT NULL CHECK (verdict IN ('keep','delete','archive','compress','needs_info','not_mine')),
    rationale   TEXT,
    decided_by  TEXT NOT NULL REFERENCES person(username),
    decided_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    destination_path TEXT,
    superseded_by BIGINT REFERENCES decision(id),
    -- archive/moves must say where, or nobody can answer "why did this break"
    CONSTRAINT archive_needs_destination CHECK (verdict <> 'archive' OR destination_path IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS decision_target_idx ON decision (target_id);

-- Execution is claimed by the person who ran the manifest (per-owner: no
-- daemon can delete other users' files on RCC). verified_* is written by a
-- nightly job comparing daily_rollup deltas — passive verification, nobody
-- approves anything.
CREATE TABLE IF NOT EXISTS execution (
    id          BIGSERIAL PRIMARY KEY,
    decision_id BIGINT NOT NULL REFERENCES decision(id),
    executor    TEXT NOT NULL REFERENCES person(username),
    owner_uname TEXT,                        -- RCC owner whose files this chunk covers
    manifest_ref TEXT,                       -- object-storage key of the manifest, when generated
    destination_path TEXT,                   -- actual destination (may differ from intent)
    claimed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at TIMESTAMPTZ,
    verified_delta_bytes BIGINT              -- what the snapshots actually showed
);
CREATE INDEX IF NOT EXISTS execution_decision_idx ON execution (decision_id);

-- Append-only event log. Written in the SAME TRANSACTION as every state
-- change (audit sibling, not event-sourcing). Triggers reject UPDATE/DELETE.
CREATE TABLE IF NOT EXISTS event (
    id        BIGSERIAL PRIMARY KEY,
    at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor     TEXT NOT NULL,
    kind      TEXT NOT NULL,                 -- target_created, assigned, decided, execution_claimed, ...
    target_id BIGINT,
    ref_table TEXT,
    ref_id    BIGINT,
    payload   JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS event_target_idx ON event (target_id);
CREATE INDEX IF NOT EXISTS event_at_idx ON event (at);

CREATE OR REPLACE FUNCTION event_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'event log is append-only';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'event_no_update') THEN
        CREATE TRIGGER event_no_update BEFORE UPDATE OR DELETE ON event
            FOR EACH ROW EXECUTE FUNCTION event_append_only();
    END IF;
END $$;
