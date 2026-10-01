package store

import (
	"context"
	"errors"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/auth"
	"github.com/verniyyy/battle_ship/backend/internal/game"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

func TestDuels(t *testing.T) {
	pg := testDB(t)
	ctx := context.Background()
	host, guest, third := auth.NewPlayerID(), auth.NewPlayerID(), auth.NewPlayerID()
	now := time.Now()
	// Rooms from earlier runs stay open in the scratch database: draw fresh codes.
	rng := rand.New(rand.NewPCG(uint64(now.UnixNano()), 4))
	taken := meta.NewDuelCode(rng)
	codes := []string{taken, taken, meta.NewDuelCode(rng)}
	// Another admiral's open room already holds the first code drawn.
	if _, _, err := pg.CreateDuel(ctx, third, func(p *meta.Profile) (*meta.Duel, error) { return meta.NewDuel(p, codes[0], now) }); err != nil {
		t.Fatal(err)
	}
	drawn := 1
	id, d, err := pg.CreateDuel(ctx, host, func(p *meta.Profile) (*meta.Duel, error) {
		drawn++
		return meta.NewDuel(p, codes[drawn-1], now)
	})
	if err != nil {
		t.Fatal(err)
	}
	if drawn != 3 || d.Code != codes[2] {
		t.Errorf("a taken code was not drawn again: %d draws, code %s", drawn, d.Code)
	}
	if _, _, err := pg.CreateDuel(ctx, host, func(p *meta.Profile) (*meta.Duel, error) { return meta.NewDuel(p, meta.NewDuelCode(rng), now) }); !errors.Is(err, ErrInDuel) {
		t.Errorf("a second room while in one: %v", err)
	}
	join := func(d *meta.Duel, p *meta.Profile) error { return d.Join(p, now) }
	if _, _, err := pg.JoinDuel(ctx, guest, "ZZZZZZ", join); !errors.Is(err, meta.ErrInvalid) {
		t.Errorf("joining a room that does not exist: %v", err)
	}
	jid, _, err := pg.JoinDuel(ctx, guest, d.Code, join)
	if err != nil || jid != id {
		t.Fatalf("join: %v (%s, want %s)", err, jid, id)
	}
	if cid, cur, err := pg.CurrentDuel(ctx, guest); err != nil || cid != id || cur.Phase != meta.DuelPlacing {
		t.Fatalf("guest's current duel: %v %s", err, cid)
	}

	// The battle starts at random deployment and the host surrenders.
	if _, err := pg.UpdateDuel(ctx, id, func(d *meta.Duel) (bool, error) {
		return d.Tick(now.Add(meta.DuelPlaceTime), rng), nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := pg.UpdateDuel(ctx, id, func(d *meta.Duel) (bool, error) { return true, d.Leave(game.SidePlayer) }); err != nil {
		t.Fatal(err)
	}
	if _, _, err := pg.CurrentDuel(ctx, host); !errors.Is(err, ErrNotFound) {
		t.Errorf("a finished duel is still current: %v", err)
	}
	rec, err := pg.DuelRecord(ctx, guest, 5)
	if err != nil {
		t.Fatal(err)
	}
	if rec.Wins != 1 || rec.Losses != 0 || len(rec.Recent) != 1 || rec.Recent[0].Outcome != "win" || rec.Recent[0].EndReason != "surrender" {
		t.Errorf("guest's record: %+v", rec)
	}
	if rec, _ := pg.DuelRecord(ctx, host, 5); rec.Losses != 1 || rec.Wins != 0 {
		t.Errorf("host's record: %+v", rec)
	}
}
