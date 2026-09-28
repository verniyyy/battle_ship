CREATE TABLE players (
    id         UUID PRIMARY KEY,
    profile    JSONB       NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE games
    ADD COLUMN player_id UUID,
    ADD COLUMN stage_id  TEXT,
    ADD COLUMN rank      TEXT;

-- Games from the first version cannot be resumed under the new rules.
UPDATE games SET status = 'abandoned' WHERE status = 'in_progress';

CREATE INDEX games_player_finished_idx ON games (player_id, finished_at DESC) WHERE status = 'finished';
