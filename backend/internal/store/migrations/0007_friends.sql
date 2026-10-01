-- Friend codes: short codes admirals swap to become friends, so the player id
-- itself is never shared. 8 characters from an alphabet without 0/O and 1/I
-- (meta.NormalizeFriendCode reads them).
CREATE FUNCTION new_friend_code() RETURNS TEXT LANGUAGE sql VOLATILE AS $$
    SELECT string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::int, 1), '')
    FROM generate_series(1, 8)
$$;

ALTER TABLE players ADD COLUMN friend_code TEXT NOT NULL DEFAULT new_friend_code();
CREATE UNIQUE INDEX players_friend_code_idx ON players (friend_code);

-- Requests waiting for an answer.
CREATE TABLE friend_requests (
    from_id    UUID        NOT NULL REFERENCES players (id),
    to_id      UUID        NOT NULL REFERENCES players (id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (from_id, to_id),
    CHECK (from_id <> to_id)
);
CREATE INDEX friend_requests_to_idx ON friend_requests (to_id);

-- A friendship is two rows, one from each side, so either lists it alone.
CREATE TABLE friends (
    player_id UUID        NOT NULL REFERENCES players (id),
    friend_id UUID        NOT NULL REFERENCES players (id),
    since     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (player_id, friend_id),
    CHECK (player_id <> friend_id)
);

-- One cheer per friend per JST day; the recipient collects it for coins.
CREATE TABLE friend_cheers (
    from_id    UUID        NOT NULL REFERENCES players (id),
    to_id      UUID        NOT NULL REFERENCES players (id),
    day        DATE        NOT NULL,
    sent_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,
    PRIMARY KEY (from_id, to_id, day)
);
CREATE INDEX friend_cheers_unclaimed_idx ON friend_cheers (to_id) WHERE claimed_at IS NULL;
