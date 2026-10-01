package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/auth"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

func TestPostgresRanking(t *testing.T) {
	pg := testDB(t)
	ctx := context.Background()
	now := time.Now()
	// The scratch database keeps admirals from earlier runs, so these ones
	// go deeper into the endless sea than any of them did.
	base := int(now.Unix())
	newAdmiral := func(name string, endless int) string {
		t.Helper()
		id := auth.NewPlayerID()
		if _, err := pg.UpdatePlayer(ctx, id, func(p *meta.Profile) error {
			p.Endless = endless
			if name == "" {
				return nil
			}
			return p.Rename(name, "深海へ")
		}); err != nil {
			t.Fatal(err)
		}
		return id
	}
	ranking := func(id string, b meta.Board) *meta.Ranking {
		t.Helper()
		r, err := pg.Ranking(ctx, id, b, meta.RankingSize)
		if err != nil {
			t.Fatal(err)
		}
		return r
	}

	alice := newAdmiral("アリス", base+2)
	bob := newAdmiral("ボブ", base+1)
	carol := newAdmiral("キャロル", base+1)
	// Unnamed admirals and those with nothing to show stay off the board.
	nameless := newAdmiral("", base+5)
	stayHome := newAdmiral("留守番", 0)

	codeOf := func(id string) string {
		l, err := pg.FriendList(ctx, id, now)
		if err != nil {
			t.Fatal(err)
		}
		return l.Code
	}
	if _, err := pg.RequestFriend(ctx, alice, codeOf(bob)); err != nil {
		t.Fatal(err)
	}
	if err := pg.AcceptFriend(ctx, bob, codeOf(alice)); err != nil {
		t.Fatal(err)
	}

	r := ranking(alice, meta.BoardEndless)
	if len(r.Entries) < 3 || r.Total < 3 {
		t.Fatalf("board: %+v", r)
	}
	top := r.Entries[:3]
	if top[0].Name != "アリス" || top[0].Rank != 1 || !top[0].Me || top[0].Score != base+2 || top[0].Comment != "深海へ" {
		t.Fatalf("first: %+v", top[0])
	}
	if top[0].Secretary == "" || top[0].Level != 1 {
		t.Fatalf("first's card: %+v", top[0])
	}
	// Bob and Carol tie for second, and whoever comes next is fourth.
	if top[1].Rank != 2 || top[2].Rank != 2 || top[1].Score != base+1 {
		t.Fatalf("tie: %+v", top)
	}
	if len(r.Entries) > 3 && r.Entries[3].Rank != 4 {
		t.Fatalf("after the tie: %+v", r.Entries[3])
	}
	for _, e := range top[1:] {
		if e.Me || e.Friend != (e.Name == "ボブ") {
			t.Fatalf("flags: %+v", e)
		}
	}
	for _, e := range r.Entries {
		if e.Name == "提督" || e.Name == "留守番" {
			t.Fatalf("should not be on the board: %+v", e)
		}
	}
	if r.Me.Rank != 1 || r.Me.Name != "アリス" || !r.Me.Me {
		t.Fatalf("me: %+v", r.Me)
	}
	if m := ranking(carol, meta.BoardEndless).Me; m.Rank != 2 || m.Score != base+1 {
		t.Fatalf("carol's place: %+v", m)
	}
	for _, id := range []string{nameless, stayHome} {
		if m := ranking(id, meta.BoardEndless).Me; m.Rank != 0 {
			t.Fatalf("off the board yet placed: %+v", m)
		}
	}

	// Every board answers; the level board breaks ties on experience.
	for _, b := range meta.Boards {
		if m := ranking(alice, b).Me; m.Rank == 0 && b != meta.BoardWins {
			t.Fatalf("%s: alice is not on it: %+v", b, m)
		}
	}
	lv := ranking(alice, meta.BoardLevel).Me
	if _, err := pg.UpdatePlayer(ctx, bob, func(p *meta.Profile) error { p.Level, p.Exp = lv.Level, 1; return nil }); err != nil {
		t.Fatal(err)
	}
	if b, a := ranking(bob, meta.BoardLevel).Me, ranking(alice, meta.BoardLevel).Me; b.Rank >= a.Rank || b.Score != a.Score {
		t.Fatalf("experience breaks the tie: bob %+v alice %+v", b, a)
	}
	_, err := pg.Ranking(ctx, alice, "gems", 10)
	if !errors.Is(err, meta.ErrInvalid) {
		t.Fatalf("unknown board: %v", err)
	}

	// Rows from before the scores were kept are filled in at start-up,
	// leaving the profile's last activity alone.
	var before time.Time
	if err := pg.pool.QueryRow(ctx, `
		UPDATE players SET ranked = false, endless = 0, scores_version = 0 WHERE id = $1
		RETURNING updated_at`, alice).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if m := ranking(alice, meta.BoardEndless).Me; m.Rank != 0 {
		t.Fatalf("stale row is on the board: %+v", m)
	}
	if err := pg.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if m := ranking(alice, meta.BoardEndless).Me; m.Rank != 1 || m.Score != base+2 {
		t.Fatalf("after backfill: %+v", m)
	}
	var after time.Time
	if err := pg.pool.QueryRow(ctx, `SELECT updated_at FROM players WHERE id = $1`, alice).Scan(&after); err != nil || !after.Equal(before) {
		t.Fatalf("backfill touched updated_at: %v → %v (%v)", before, after, err)
	}
}
