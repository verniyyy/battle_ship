package store

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/verniyyy/battle_ship/backend/internal/auth"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Postgres struct {
	pool *pgxpool.Pool
}

func NewPostgres(pool *pgxpool.Pool) *Postgres { return &Postgres{pool: pool} }

// Migrate applies pending migrations in lexical order.
func (p *Postgres) Migrate(ctx context.Context) error {
	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return err
	}
	sort.Strings(files)

	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		// Serialise concurrent migrators (e.g. several replicas starting at once).
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(727274)`); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
			return err
		}
		for _, f := range files {
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, f).Scan(&exists); err != nil {
				return err
			}
			if exists {
				continue
			}
			sql, err := migrations.ReadFile(f)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, string(sql)); err != nil {
				return fmt.Errorf("apply %s: %w", f, err)
			}
			if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, f); err != nil {
				return err
			}
		}
		return nil
	})
}

func (p *Postgres) UpdatePlayer(ctx context.Context, id string, fn func(*meta.Profile) error) (*meta.Profile, error) {
	var prof *meta.Profile
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		var err error
		prof, err = lockPlayer(ctx, tx, id)
		if errors.Is(err, ErrNotFound) {
			data, err := json.Marshal(meta.NewProfile(id, time.Now()))
			if err != nil {
				return err
			}
			// A concurrent first request may have created the row; either way it exists now.
			if _, err := tx.Exec(ctx, `INSERT INTO players (id, profile) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, id, data); err != nil {
				return err
			}
			if prof, err = lockPlayer(ctx, tx, id); err != nil {
				return err
			}
		} else if err != nil {
			return err
		}
		if err := fn(prof); err != nil {
			return err
		}
		return savePlayer(ctx, tx, prof)
	})
	if err != nil {
		return nil, err
	}
	return prof, nil
}

func lockPlayer(ctx context.Context, tx pgx.Tx, id string) (*meta.Profile, error) {
	var prof meta.Profile
	if err := scanJSON(tx.QueryRow(ctx, `SELECT profile FROM players WHERE id = $1 FOR UPDATE`, id), &prof); err != nil {
		return nil, err
	}
	return &prof, nil
}

func savePlayer(ctx context.Context, tx pgx.Tx, prof *meta.Profile) error {
	data, err := json.Marshal(prof)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE players SET profile = $2, updated_at = now() WHERE id = $1`, prof.ID, data)
	return err
}

func (p *Postgres) CreateMatch(ctx context.Context, m *meta.Match) (string, error) {
	data, err := json.Marshal(m)
	if err != nil {
		return "", err
	}
	var id string
	err = p.pool.QueryRow(ctx,
		`INSERT INTO games (status, turn, state, player_id, stage_id) VALUES ($1, $2, $3, $4, $5) RETURNING id::text`,
		m.Game.Status, m.Game.Turn, data, m.PlayerID, m.Stage.ID,
	).Scan(&id)
	return id, err
}

func (p *Postgres) GetMatch(ctx context.Context, id string) (*meta.Match, error) {
	return scanMatch(p.pool.QueryRow(ctx, `SELECT state FROM games WHERE id = $1`, id))
}

func (p *Postgres) UpdateMatch(ctx context.Context, id string, fn func(*meta.Match, *meta.Profile) error) (*meta.Match, *meta.Profile, error) {
	var (
		m    *meta.Match
		prof *meta.Profile
	)
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		var err error
		if m, err = scanMatch(tx.QueryRow(ctx, `SELECT state FROM games WHERE id = $1 FOR UPDATE`, id)); err != nil {
			return err
		}
		if prof, err = lockPlayer(ctx, tx, m.PlayerID); err != nil {
			return err
		}
		if err := fn(m, prof); err != nil {
			return err
		}
		data, err := json.Marshal(m)
		if err != nil {
			return err
		}
		var winner, rank *string
		if w := string(m.Game.Winner); w != "" {
			winner = &w
		}
		if m.Reward != nil {
			r := string(m.Reward.Rank)
			rank = &r
		}
		if _, err := tx.Exec(ctx, `
			UPDATE games
			SET state = $2, status = $3, winner = $4, turn = $5, rank = $6, updated_at = now(),
			    finished_at = CASE WHEN $3 = 'finished' THEN COALESCE(finished_at, now()) END
			WHERE id = $1`,
			id, data, m.Game.Status, winner, m.Game.Turn, rank); err != nil {
			return err
		}
		return savePlayer(ctx, tx, prof)
	})
	if err != nil {
		return nil, nil, err
	}
	return m, prof, nil
}

func (p *Postgres) ListFinished(ctx context.Context, playerID string, limit int) ([]Summary, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id::text, COALESCE(stage_id, ''), turn, winner, COALESCE(rank, ''), finished_at
		FROM games WHERE status = 'finished' AND player_id = $1
		ORDER BY finished_at DESC LIMIT $2`, playerID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Summary, error) {
		var s Summary
		err := r.Scan(&s.ID, &s.StageID, &s.Turn, &s.Winner, &s.Rank, &s.FinishedAt)
		return s, err
	})
}

func (p *Postgres) CurrentMatch(ctx context.Context, playerID string) (string, *meta.Match, error) {
	var (
		id   string
		data []byte
	)
	err := p.pool.QueryRow(ctx, `
		SELECT id::text, state FROM games WHERE status = 'in_progress' AND player_id = $1
		ORDER BY updated_at DESC LIMIT 1`, playerID).Scan(&id, &data)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil, ErrNotFound
	}
	if err != nil {
		return "", nil, err
	}
	var m meta.Match
	if err := json.Unmarshal(data, &m); err != nil {
		return "", nil, err
	}
	if !Usable(&m) {
		return "", nil, ErrNotFound
	}
	return id, &m, nil
}

func scanMatch(row pgx.Row) (*meta.Match, error) {
	var m meta.Match
	if err := scanJSON(row, &m); err != nil {
		return nil, err
	}
	if !Usable(&m) {
		return nil, ErrNotFound
	}
	return &m, nil
}

func scanJSON(row pgx.Row, v any) error {
	var data []byte
	if err := row.Scan(&data); err != nil {
		var pgErr *pgconn.PgError
		// A malformed UUID is just as "not found" as a missing row.
		if errors.Is(err, pgx.ErrNoRows) || (errors.As(err, &pgErr) && pgErr.Code == "22P02") {
			return ErrNotFound
		}
		return err
	}
	return json.Unmarshal(data, v)
}

func (p *Postgres) Resolve(ctx context.Context, id auth.Identity, guestID string) (string, error) {
	var pid string
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			UPDATE accounts SET email = $3, last_login_at = now()
			WHERE provider = $1 AND subject = $2 RETURNING player_id::text`,
			id.Provider, id.Subject, id.Email).Scan(&pid)
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		// First sign-in: carry over the guest's progress if it exists and is
		// unclaimed, otherwise start afresh. ON CONFLICT covers both a guest
		// that is already owned and a concurrent first sign-in.
		candidates := []string{auth.NewPlayerID()}
		if guestID != "" {
			var exists bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM players WHERE id = $1)`, guestID).Scan(&exists); err != nil {
				return err
			}
			if exists {
				candidates = append([]string{guestID}, candidates...)
			}
		}
		for _, c := range candidates {
			if _, err := tx.Exec(ctx, `
				INSERT INTO accounts (provider, subject, player_id, email) VALUES ($1, $2, $3, $4)
				ON CONFLICT DO NOTHING`, id.Provider, id.Subject, c, id.Email); err != nil {
				return err
			}
			err := tx.QueryRow(ctx, `SELECT player_id::text FROM accounts WHERE provider = $1 AND subject = $2`, id.Provider, id.Subject).Scan(&pid)
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		return errors.New("could not create account")
	})
	return pid, err
}
