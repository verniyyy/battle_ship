CREATE TABLE games (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status      TEXT        NOT NULL,
    winner      TEXT,
    turn        INTEGER     NOT NULL DEFAULT 0,
    state       JSONB       NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX games_finished_at_idx ON games (finished_at DESC) WHERE status = 'finished';
