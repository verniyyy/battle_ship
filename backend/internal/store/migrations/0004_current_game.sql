-- Finding the match to resume after a retreat.
CREATE INDEX games_player_current_idx ON games (player_id, updated_at DESC) WHERE status = 'in_progress';
