-- Sign-in accounts at identity providers, each owning one player.
CREATE TABLE accounts (
    provider      TEXT        NOT NULL,
    subject       TEXT        NOT NULL,
    player_id     UUID        NOT NULL UNIQUE,
    email         TEXT        NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider, subject)
);
