package store

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/verniyyy/battle_ship/backend/internal/game"
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

func (p *Postgres) Create(ctx context.Context, st *game.State) (string, error) {
	data, err := json.Marshal(st)
	if err != nil {
		return "", err
	}
	var id string
	err = p.pool.QueryRow(ctx,
		`INSERT INTO games (status, turn, state) VALUES ($1, $2, $3) RETURNING id::text`,
		st.Status, st.Turn, data,
	).Scan(&id)
	return id, err
}

func (p *Postgres) Get(ctx context.Context, id string) (*game.State, error) {
	return scanState(p.pool.QueryRow(ctx, `SELECT state FROM games WHERE id = $1`, id))
}

func (p *Postgres) Update(ctx context.Context, id string, fn func(*game.State) error) (*game.State, error) {
	var st *game.State
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		var err error
		st, err = scanState(tx.QueryRow(ctx, `SELECT state FROM games WHERE id = $1 FOR UPDATE`, id))
		if err != nil {
			return err
		}
		if err := fn(st); err != nil {
			return err
		}
		data, err := json.Marshal(st)
		if err != nil {
			return err
		}
		var winner *string
		if st.Winner != "" {
			w := string(st.Winner)
			winner = &w
		}
		_, err = tx.Exec(ctx, `
			UPDATE games
			SET state = $2, status = $3, winner = $4, turn = $5, updated_at = now(),
			    finished_at = CASE WHEN $3 = 'finished' THEN COALESCE(finished_at, now()) END
			WHERE id = $1`,
			id, data, st.Status, winner, st.Turn)
		return err
	})
	if err != nil {
		return nil, err
	}
	return st, nil
}

func (p *Postgres) ListFinished(ctx context.Context, limit int) ([]Summary, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT id::text, turn, winner, finished_at
		FROM games WHERE status = 'finished'
		ORDER BY finished_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Summary, error) {
		var s Summary
		err := r.Scan(&s.ID, &s.Turn, &s.Winner, &s.FinishedAt)
		return s, err
	})
}

func (p *Postgres) Stats(ctx context.Context) (Stats, error) {
	var s Stats
	err := p.pool.QueryRow(ctx, `
		SELECT count(*),
		       count(*) FILTER (WHERE winner = 'player'),
		       count(*) FILTER (WHERE winner = 'cpu')
		FROM games WHERE status = 'finished'`).Scan(&s.Played, &s.Wins, &s.Losses)
	return s, err
}

func scanState(row pgx.Row) (*game.State, error) {
	var data []byte
	if err := row.Scan(&data); err != nil {
		var pgErr *pgconn.PgError
		// A malformed UUID is just as "not found" as a missing row.
		if errors.Is(err, pgx.ErrNoRows) || (errors.As(err, &pgErr) && pgErr.Code == "22P02") {
			return nil, ErrNotFound
		}
		return nil, err
	}
	var st game.State
	if err := json.Unmarshal(data, &st); err != nil {
		return nil, err
	}
	return &st, nil
}
