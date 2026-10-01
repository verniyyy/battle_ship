package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

// ErrInDuel refuses a new duel while the admiral is still in another one.
var ErrInDuel = errors.New("参加中の対戦があります。終えてから新しい対戦をしてください")

var errNoRoom = meta.Refusal("その部屋番号の部屋は見つかりません（締め切られたか、番号が違います）")

// Duels keeps duels between admirals (beta).
type Duels interface {
	// CreateDuel locks the admiral's profile and saves the duel build makes
	// from it, failing with ErrInDuel while they are in another active duel.
	// build is called again when its room code is already taken.
	CreateDuel(ctx context.Context, playerID string, build func(*meta.Profile) (*meta.Duel, error)) (string, *meta.Duel, error)
	// JoinDuel seats the admiral, through join, in the open room with code.
	JoinDuel(ctx context.Context, playerID, code string, join func(*meta.Duel, *meta.Profile) error) (string, *meta.Duel, error)
	// CurrentDuel is the admiral's active duel (ErrNotFound when there is none).
	CurrentDuel(ctx context.Context, playerID string) (string, *meta.Duel, error)
	GetDuel(ctx context.Context, id string) (*meta.Duel, error)
	// UpdateDuel locks the duel, applies fn and saves the duel when fn reports a change.
	UpdateDuel(ctx context.Context, id string, fn func(*meta.Duel) (bool, error)) (*meta.Duel, error)
	// DuelRecord is the admiral's tally and latest finished duels.
	DuelRecord(ctx context.Context, playerID string, limit int) (*DuelRecord, error)
}

type DuelRecord struct {
	Wins   int           `json:"wins"`
	Losses int           `json:"losses"`
	Draws  int           `json:"draws"`
	Recent []DuelSummary `json:"recent"`
}

// DuelSummary is a finished duel from one admiral's side.
type DuelSummary struct {
	Opponent   string    `json:"opponent"`
	Outcome    string    `json:"outcome"`
	EndReason  string    `json:"endReason"`
	Turns      int       `json:"turns"`
	FinishedAt time.Time `json:"finishedAt"`
}

const activePhases = `phase IN ('open', 'placing', 'battle')`

// activeDuel finds the admiral's active duel, as host or guest.
func activeDuel(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, playerID string) (string, *meta.Duel, error) {
	var (
		id   string
		data []byte
	)
	err := q.QueryRow(ctx, `
		SELECT id::text, state FROM duels
		WHERE (host_id = $1 OR guest_id = $1) AND `+activePhases+`
		ORDER BY created_at DESC LIMIT 1`, playerID).Scan(&id, &data)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, ErrNotFound
	}
	if err != nil {
		return "", nil, err
	}
	var d meta.Duel
	return id, &d, json.Unmarshal(data, &d)
}

func (p *Postgres) CreateDuel(ctx context.Context, playerID string, build func(*meta.Profile) (*meta.Duel, error)) (string, *meta.Duel, error) {
	var (
		id string
		d  *meta.Duel
	)
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		prof, err := lockOrCreatePlayer(ctx, tx, playerID)
		if err != nil {
			return err
		}
		if _, _, err := activeDuel(ctx, tx, playerID); !errors.Is(err, ErrNotFound) {
			if err == nil {
				err = ErrInDuel
			}
			return err
		}
		for range 5 {
			if d, err = build(prof); err != nil {
				return err
			}
			data, err := json.Marshal(d)
			if err != nil {
				return err
			}
			// A savepoint, so a taken code does not abort the transaction.
			err = pgx.BeginFunc(ctx, tx, func(sp pgx.Tx) error {
				return sp.QueryRow(ctx, `
					INSERT INTO duels (code, host_id, phase, state) VALUES ($1, $2, $3, $4) RETURNING id::text`,
					d.Code, playerID, d.Phase, data).Scan(&id)
			})
			if pgErr := (*pgconn.PgError)(nil); errors.As(err, &pgErr) && pgErr.ConstraintName == "duels_open_code_idx" {
				continue
			}
			return err
		}
		return errors.New("could not draw a free room code")
	})
	if err != nil {
		return "", nil, err
	}
	return id, d, nil
}

func (p *Postgres) JoinDuel(ctx context.Context, playerID, code string, join func(*meta.Duel, *meta.Profile) error) (string, *meta.Duel, error) {
	code, ok := meta.NormalizeDuelCode(code)
	if !ok {
		return "", nil, errNoRoom
	}
	var (
		id string
		d  *meta.Duel
	)
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		prof, err := lockOrCreatePlayer(ctx, tx, playerID)
		if err != nil {
			return err
		}
		if _, _, err := activeDuel(ctx, tx, playerID); !errors.Is(err, ErrNotFound) {
			if err == nil {
				err = ErrInDuel
			}
			return err
		}
		var data []byte
		err = tx.QueryRow(ctx, `SELECT id::text, state FROM duels WHERE code = $1 AND phase = 'open' FOR UPDATE`, code).Scan(&id, &data)
		if errors.Is(err, pgx.ErrNoRows) {
			return errNoRoom
		}
		if err != nil {
			return err
		}
		d = &meta.Duel{}
		if err := json.Unmarshal(data, d); err != nil {
			return err
		}
		if err := join(d, prof); err != nil {
			return err
		}
		return saveDuel(ctx, tx, id, d)
	})
	if err != nil {
		return "", nil, err
	}
	return id, d, nil
}

func (p *Postgres) CurrentDuel(ctx context.Context, playerID string) (string, *meta.Duel, error) {
	return activeDuel(ctx, p.pool, playerID)
}

func (p *Postgres) GetDuel(ctx context.Context, id string) (*meta.Duel, error) {
	var d meta.Duel
	if err := scanJSON(p.pool.QueryRow(ctx, `SELECT state FROM duels WHERE id = $1`, id), &d); err != nil {
		return nil, err
	}
	return &d, nil
}

func (p *Postgres) UpdateDuel(ctx context.Context, id string, fn func(*meta.Duel) (bool, error)) (*meta.Duel, error) {
	var d meta.Duel
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		if err := scanJSON(tx.QueryRow(ctx, `SELECT state FROM duels WHERE id = $1 FOR UPDATE`, id), &d); err != nil {
			return err
		}
		changed, err := fn(&d)
		if err != nil || !changed {
			return err
		}
		return saveDuel(ctx, tx, id, &d)
	})
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func saveDuel(ctx context.Context, tx pgx.Tx, id string, d *meta.Duel) error {
	data, err := json.Marshal(d)
	if err != nil {
		return err
	}
	var guest, winner *string
	if d.Guest != nil {
		guest = &d.Guest.ID
	}
	if w := d.WinnerID(); w != "" {
		winner = &w
	}
	_, err = tx.Exec(ctx, `
		UPDATE duels
		SET state = $2, phase = $3, guest_id = $4, winner_id = $5, updated_at = now(),
		    finished_at = CASE WHEN $3 = 'finished' THEN COALESCE(finished_at, now()) END
		WHERE id = $1`, id, data, d.Phase, guest, winner)
	return err
}

func (p *Postgres) DuelRecord(ctx context.Context, playerID string, limit int) (*DuelRecord, error) {
	rec := &DuelRecord{Recent: []DuelSummary{}}
	err := p.pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE winner_id = $1),
		       count(*) FILTER (WHERE winner_id <> $1),
		       count(*) FILTER (WHERE winner_id IS NULL)
		FROM duels WHERE (host_id = $1 OR guest_id = $1) AND phase = 'finished'`, playerID).
		Scan(&rec.Wins, &rec.Losses, &rec.Draws)
	if err != nil {
		return nil, err
	}
	rows, err := p.pool.Query(ctx, `
		SELECT state, finished_at FROM duels
		WHERE (host_id = $1 OR guest_id = $1) AND phase = 'finished'
		ORDER BY finished_at DESC LIMIT $2`, playerID, limit)
	if err != nil {
		return nil, err
	}
	rec.Recent, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (DuelSummary, error) {
		var (
			data []byte
			s    DuelSummary
			d    meta.Duel
		)
		if err := r.Scan(&data, &s.FinishedAt); err != nil {
			return s, err
		}
		if err := json.Unmarshal(data, &d); err != nil {
			return s, err
		}
		side, _ := d.SideOf(playerID)
		s.Opponent, s.Outcome, s.EndReason, s.Turns = d.Opponent(side).Name, d.Outcome(side), string(d.Game.EndReason), d.Game.Turn
		return s, nil
	})
	return rec, err
}
