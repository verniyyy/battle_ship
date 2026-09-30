-- An admiral may leave only one battle suspended. Older unfinished battles from
-- before this rule are set aside (not listed, not resumable) so it can hold.
UPDATE games g SET status = 'abandoned', updated_at = now()
WHERE status = 'in_progress' AND EXISTS (
    SELECT 1 FROM games n
    WHERE n.player_id = g.player_id AND n.status = 'in_progress'
      AND (n.updated_at, n.id) > (g.updated_at, g.id)
);

DROP INDEX games_player_current_idx;
CREATE UNIQUE INDEX games_player_in_progress_idx ON games (player_id) WHERE status = 'in_progress';
