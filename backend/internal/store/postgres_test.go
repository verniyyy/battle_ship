package store

import (
	"context"
	"errors"
	"math/rand/v2"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/verniyyy/battle_ship/backend/internal/game"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

// These tests need a scratch database: TEST_DATABASE_URL=postgres://... go test ./internal/store
func testDB(t *testing.T) *Postgres {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	pg := NewPostgres(pool)
	if err := pg.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := pg.Migrate(ctx); err != nil {
		t.Fatal("migrations must be idempotent:", err)
	}
	return pg
}

func TestPostgresRoundTrip(t *testing.T) {
	pg := testDB(t)
	ctx := context.Background()
	pid := "33333333-3333-4333-8333-" + time.Now().Format("150405000000")

	p, err := pg.UpdatePlayer(ctx, pid, func(p *meta.Profile) error { p.Gems += 1; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if p.Gems != meta.StartGems+1 || len(p.Ships) != 3 {
		t.Fatalf("new profile: %+v", p)
	}
	if p, err = pg.UpdatePlayer(ctx, pid, func(*meta.Profile) error { return nil }); err != nil || p.Gems != meta.StartGems+1 {
		t.Fatalf("profile not persisted: %v %d", err, p.Gems)
	}

	rng := rand.New(rand.NewPCG(1, 1))
	m, err := meta.NewMatch(p, "1-1", []game.Pos{{Row: 0, Col: 0}, {Row: 1, Col: 1}, {Row: 2, Col: 2}}, rng)
	if err != nil {
		t.Fatal(err)
	}
	id, err := pg.CreateMatch(ctx, m)
	if err != nil {
		t.Fatal(err)
	}
	got, err := pg.GetMatch(ctx, id)
	if err != nil || got.PlayerID != pid || got.Stage.ID != "1-1" {
		t.Fatalf("get: %v %+v", err, got)
	}

	// Finish the battle and settle it in one transaction.
	_, prof, err := pg.UpdateMatch(ctx, id, func(m *meta.Match, p *meta.Profile) error {
		m.Game.Status, m.Game.Winner, m.Game.EndReason = game.StatusFinished, game.SidePlayer, game.EndAnnihilated
		meta.Settle(m, p, rng, time.Now())
		return nil
	})
	if err != nil || prof.Stats.Wins != 1 {
		t.Fatalf("update: %v", err)
	}
	list, err := pg.ListFinished(ctx, pid, 10)
	if err != nil || len(list) != 1 || list[0].Rank == "" || list[0].StageID != "1-1" {
		t.Fatalf("list: %v %+v", err, list)
	}

	if _, err := pg.GetMatch(ctx, "not-a-uuid"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("malformed id: %v", err)
	}
	// Rows written by the first version (bare game state) are not playable.
	var oldID string
	if err := pg.pool.QueryRow(ctx, `INSERT INTO games (status, state) VALUES ('abandoned', '{"boards":{},"turn":3}') RETURNING id::text`).Scan(&oldID); err != nil {
		t.Fatal(err)
	}
	if _, err := pg.GetMatch(ctx, oldID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("legacy row: %v", err)
	}
}
