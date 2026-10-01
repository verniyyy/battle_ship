-- What the rankings order admirals by (meta.Scores), kept beside the profile
-- on every save so a board is an index scan. Fleet power can only be worked
-- out in Go, so rows saved under an older scores_version are filled in at
-- start-up (Postgres.backfillScores); until then they stay off the boards.
ALTER TABLE players
    ADD COLUMN ranked         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN level          INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN exp            INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN fleet_power    INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN wins           INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN endless        INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN scores_version INTEGER NOT NULL DEFAULT 0;

CREATE INDEX players_rank_level_idx   ON players (level DESC, exp DESC, id) WHERE ranked;
CREATE INDEX players_rank_power_idx   ON players (fleet_power DESC, id) WHERE ranked;
CREATE INDEX players_rank_wins_idx    ON players (wins DESC, id) WHERE ranked;
CREATE INDEX players_rank_endless_idx ON players (endless DESC, id) WHERE ranked;
