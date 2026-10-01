-- Duels between two admirals (beta). The whole duel, battle included, is the
-- state (meta.Duel); the columns are what lookups need. An admiral is in at
-- most one active duel: Postgres.CreateDuel and JoinDuel check that with the
-- admiral's player row locked.
CREATE TABLE duels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        TEXT        NOT NULL,
    host_id     UUID        NOT NULL REFERENCES players (id),
    guest_id    UUID        REFERENCES players (id),
    phase       TEXT        NOT NULL,
    state       JSONB       NOT NULL,
    -- NULL for a draw, or while undecided.
    winner_id   UUID        REFERENCES players (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

-- Codes only need to be unique among the rooms still taking an opponent.
CREATE UNIQUE INDEX duels_open_code_idx ON duels (code) WHERE phase = 'open';
CREATE INDEX duels_host_active_idx  ON duels (host_id)  WHERE phase IN ('open', 'placing', 'battle');
CREATE INDEX duels_guest_active_idx ON duels (guest_id) WHERE phase IN ('placing', 'battle');
CREATE INDEX duels_host_finished_idx  ON duels (host_id, finished_at DESC)  WHERE phase = 'finished';
CREATE INDEX duels_guest_finished_idx ON duels (guest_id, finished_at DESC) WHERE phase = 'finished';
