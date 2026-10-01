package store

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/auth"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

func TestPostgresGifts(t *testing.T) {
	pg := testDB(t)
	ctx := context.Background()
	newPlayer := func() string {
		id := auth.NewPlayerID()
		if _, err := pg.UpdatePlayer(ctx, id, func(*meta.Profile) error { return nil }); err != nil {
			t.Fatal(err)
		}
		return id
	}
	// The database is shared, so only this test's gifts are looked at.
	ids := func(gs []meta.Gift) (out []string) {
		for _, g := range gs {
			out = append(out, g.ID)
		}
		return out
	}

	veteran := newPlayer()
	time.Sleep(20 * time.Millisecond)
	cutoff := time.Now()
	time.Sleep(20 * time.Millisecond)
	rookie := newPlayer()
	friend := newPlayer()

	now := time.Now()
	window := func(g meta.Gift) meta.Gift {
		g.StartsAt, g.EndsAt = now.Add(-time.Hour), now.Add(time.Hour)
		return g
	}
	apology, err := pg.CreateGift(ctx, &meta.Gift{Title: "お詫び", Gems: 300, Everyone: true, JoinedBefore: &cutoff,
		StartsAt: now.Add(-time.Hour), EndsAt: now.Add(time.Hour)}, nil, "test")
	if err != nil {
		t.Fatal(err)
	}
	g := window(meta.Gift{Title: "個別補償", Coins: 1000, Cards: []string{"dd_asanagi"}})
	personal, err := pg.CreateGift(ctx, &g, []string{friend}, "test")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pg.CreateGift(ctx, &g, []string{auth.NewPlayerID()}, "test"); !errors.Is(err, meta.ErrInvalid) {
		t.Fatalf("unknown recipient: %v", err)
	}
	future := meta.Gift{Title: "予約", Gems: 1, Everyone: true, StartsAt: now.Add(time.Hour), EndsAt: now.Add(2 * time.Hour)}
	later, err := pg.CreateGift(ctx, &future, nil, "test")
	if err != nil {
		t.Fatal(err)
	}

	pending := func(pid string) []string {
		t.Helper()
		gs, err := pg.PendingGifts(ctx, pid, now)
		if err != nil {
			t.Fatal(err)
		}
		return slices.DeleteFunc(ids(gs), func(id string) bool { return id != apology && id != personal && id != later })
	}
	if got := pending(veteran); !slices.Equal(got, []string{apology}) {
		t.Fatalf("veteran: %v", got)
	}
	if got := pending(rookie); len(got) != 0 {
		t.Fatalf("an admiral who joined after the cutoff: %v", got)
	}
	if got := pending(friend); !slices.Equal(got, []string{personal}) {
		t.Fatalf("recipient: %v", got)
	}

	// Claiming one by id, then not again.
	claimed, prof, err := pg.ClaimGifts(ctx, friend, personal, now)
	if err != nil || len(claimed) != 1 || claimed[0].Grant.Coins != 1000 || len(claimed[0].Grant.Cards) != 1 || prof.Coins != meta.StartCoins+1000 {
		t.Fatalf("claim: %v %+v", err, claimed)
	}
	if _, _, err := pg.ClaimGifts(ctx, friend, personal, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second claim: %v", err)
	}
	if _, _, err := pg.ClaimGifts(ctx, rookie, apology, now); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ineligible claim: %v", err)
	}

	// A stopped gift can no longer be collected.
	if err := pg.RevokeGift(ctx, apology, "test"); err != nil {
		t.Fatal(err)
	}
	if err := pg.RevokeGift(ctx, apology, "test"); !errors.Is(err, meta.ErrInvalid) {
		t.Fatalf("second revoke: %v", err)
	}
	if err := pg.RevokeGift(ctx, "nope", "test"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("revoke unknown: %v", err)
	}
	if got := pending(veteran); len(got) != 0 {
		t.Fatalf("revoked gift still pending: %v", got)
	}

	list, err := pg.ListGifts(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	i := slices.IndexFunc(list, func(r GiftRecord) bool { return r.ID == personal })
	if i < 0 || list[i].Recipients != 1 || list[i].Claims != 1 || list[i].Title != "個別補償" || list[i].CreatedBy != "test" {
		t.Fatalf("listed: %+v", list)
	}
	j := slices.IndexFunc(list, func(r GiftRecord) bool { return r.ID == apology })
	if j < 0 || list[j].RevokedAt == nil || list[j].RevokedBy != "test" {
		t.Fatalf("revoked gift listed as %+v", list[j])
	}

	found, err := pg.FindPlayers(ctx, friend, 5)
	if err != nil || len(found) != 1 || found[0].ID != friend || found[0].Name != "提督" {
		t.Fatalf("find by id: %v %+v", err, found)
	}
	if found, err := pg.FindPlayers(ctx, "100%_no_such", 5); err != nil || len(found) != 0 {
		t.Fatalf("wildcards are literal: %v %+v", err, found)
	}

	log, err := pg.AuditLog(ctx, 10)
	if err != nil || len(log) < 4 || log[0].Action != "gift.revoke" || log[0].Target != apology {
		t.Fatalf("audit: %v %+v", err, log)
	}
}
