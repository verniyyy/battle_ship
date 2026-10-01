-- Presents from the operators, collected from the harbour's gift box. The
-- gift itself is kept as JSON (meta.Gift); the columns beside it are what
-- deciding who may collect it needs.
CREATE TABLE gifts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gift          JSONB       NOT NULL,
    everyone      BOOLEAN     NOT NULL,
    joined_before TIMESTAMPTZ,
    starts_at     TIMESTAMPTZ NOT NULL,
    ends_at       TIMESTAMPTZ NOT NULL,
    created_by    TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_by    TEXT,
    revoked_at    TIMESTAMPTZ
);
CREATE INDEX gifts_open_idx ON gifts (ends_at) WHERE revoked_at IS NULL;

-- The admirals a gift that is not for everyone goes to.
CREATE TABLE gift_recipients (
    gift_id   UUID NOT NULL REFERENCES gifts (id),
    player_id UUID NOT NULL REFERENCES players (id),
    PRIMARY KEY (gift_id, player_id)
);
CREATE INDEX gift_recipients_player_idx ON gift_recipients (player_id);

-- One row per gift an admiral has collected; the key stops a second claim.
CREATE TABLE gift_claims (
    gift_id    UUID        NOT NULL REFERENCES gifts (id),
    player_id  UUID        NOT NULL REFERENCES players (id),
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (gift_id, player_id)
);

-- Everything done from the admin console, for looking back on.
CREATE TABLE admin_audit (
    id     BIGSERIAL PRIMARY KEY,
    at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor  TEXT        NOT NULL,
    action TEXT        NOT NULL,
    target TEXT        NOT NULL DEFAULT '',
    detail JSONB       NOT NULL DEFAULT '{}'
);
