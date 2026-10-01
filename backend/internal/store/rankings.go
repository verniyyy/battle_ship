package store

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

// Rankings orders admirals on the boards by the scores saved beside each
// profile.
type Rankings interface {
	// Ranking is the board's top admirals and where playerID stands on it.
	Ranking(ctx context.Context, playerID string, board meta.Board, limit int) (*meta.Ranking, error)
}

// boardKeys are the columns each board orders by, best first; the first is
// the score shown. An admiral is on a board once the score is above zero.
var boardKeys = map[meta.Board][]string{
	meta.BoardLevel:   {"level", "exp"},
	meta.BoardPower:   {"fleet_power"},
	meta.BoardWins:    {"wins"},
	meta.BoardEndless: {"endless"},
}

// setScores assigns the scores in scoreArgs ($1 is the player id).
const setScores = `ranked = $2, level = $3, exp = $4, fleet_power = $5, wins = $6, endless = $7, scores_version = $8`

func scoreArgs(prof *meta.Profile) []any {
	s := prof.Scores()
	return []any{prof.ID, s.Ranked, s.Level, s.Exp, s.FleetPower, s.Wins, s.Endless, meta.ScoresVersion}
}

// backfillScores works out the scores of admirals saved before the current
// meta.ScoresVersion, a batch at a time, leaving profiles and updated_at as
// they are. Rows another transaction holds are left for it to save.
func (p *Postgres) backfillScores(ctx context.Context) error {
	const batch = 200
	for {
		n := 0
		err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
			rows, err := tx.Query(ctx, `
				SELECT profile FROM players WHERE scores_version < $1
				ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`, meta.ScoresVersion, batch)
			if err != nil {
				return err
			}
			profs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (*meta.Profile, error) {
				var data []byte
				if err := r.Scan(&data); err != nil {
					return nil, err
				}
				var prof meta.Profile
				return &prof, json.Unmarshal(data, &prof)
			})
			if err != nil {
				return err
			}
			for _, prof := range profs {
				if _, err := tx.Exec(ctx, `UPDATE players SET `+setScores+` WHERE id = $1`, scoreArgs(prof)...); err != nil {
					return err
				}
			}
			n = len(profs)
			return nil
		})
		if err != nil || n < batch {
			return err
		}
	}
}

func (p *Postgres) Ranking(ctx context.Context, playerID string, board meta.Board, limit int) (*meta.Ranking, error) {
	keys, ok := boardKeys[board]
	if !ok {
		return nil, meta.Refusal("そのランキングはありません")
	}
	score := keys[0]
	prefixed := func(alias string) string {
		cols := make([]string, len(keys))
		for i, k := range keys {
			cols[i] = alias + "." + k
		}
		return "(" + strings.Join(cols, ", ") + ")"
	}
	order := "p." + strings.Join(keys, " DESC, p.") + " DESC, p.id"
	// The card of the admiral's secretary ship, found by uid in the roster.
	const card = `
		p.profile->>'name', COALESCE(p.profile->>'comment', ''), (p.profile->>'level')::int,
		COALESCE((SELECT s->>'card' FROM jsonb_array_elements(p.profile->'ships') s WHERE s->>'uid' = p.profile->>'secretary' LIMIT 1), '')`
	const friend = `EXISTS (SELECT 1 FROM friends f WHERE f.player_id = $1 AND f.friend_id = p.id)`

	r := &meta.Ranking{Board: board, Entries: []meta.RankEntry{}}
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		rows, err := tx.Query(ctx, `
			SELECT p.`+score+`, `+prefixed("p")+`::text, p.id = $1, `+friend+`, `+card+`
			FROM players p WHERE p.ranked AND p.`+score+` > 0
			ORDER BY `+order+` LIMIT $2`, playerID, limit)
		if err != nil {
			return err
		}
		// Admirals level on every key share a rank, and the next one down
		// skips the places they took (1, 2, 2, 4).
		var (
			prev    string
			n, rank int
		)
		r.Entries, err = pgx.CollectRows(rows, func(row pgx.CollectableRow) (meta.RankEntry, error) {
			var (
				e   meta.RankEntry
				key string
			)
			if err := row.Scan(&e.Score, &key, &e.Me, &e.Friend, &e.Name, &e.Comment, &e.Level, &e.Secretary); err != nil {
				return e, err
			}
			if n++; key != prev {
				rank, prev = n, key
			}
			e.Rank = rank
			return e, nil
		})
		if err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM players WHERE ranked AND `+score+` > 0`).Scan(&r.Total); err != nil {
			return err
		}
		var on bool
		err = tx.QueryRow(ctx, `
			SELECT p.`+score+`, p.ranked AND p.`+score+` > 0,
			       1 + (SELECT count(*) FROM players o WHERE o.ranked AND o.`+score+` > 0 AND `+prefixed("o")+` > `+prefixed("p")+`),
			       `+card+`
			FROM players p WHERE p.id = $1`, playerID).
			Scan(&r.Me.Score, &on, &r.Me.Rank, &r.Me.Name, &r.Me.Comment, &r.Me.Level, &r.Me.Secretary)
		if err != nil {
			if isNotFound(err) {
				return ErrNotFound
			}
			return err
		}
		r.Me.Me = true
		if !on {
			r.Me.Rank = 0
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r, nil
}
