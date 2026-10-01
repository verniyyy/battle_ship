package store

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/auth"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

func TestPostgresFriends(t *testing.T) {
	pg := testDB(t)
	ctx := context.Background()
	now := time.Now()
	type admiral struct{ id, code string }
	newAdmiral := func(name string) admiral {
		t.Helper()
		id := auth.NewPlayerID()
		if _, err := pg.UpdatePlayer(ctx, id, func(p *meta.Profile) error { return p.Rename(name, "") }); err != nil {
			t.Fatal(err)
		}
		l, err := pg.FriendList(ctx, id, now)
		if err != nil {
			t.Fatal(err)
		}
		if _, ok := meta.NormalizeFriendCode(l.Code); !ok {
			t.Fatalf("%s got a malformed friend code %q", name, l.Code)
		}
		return admiral{id, l.Code}
	}
	list := func(a admiral) *FriendList {
		t.Helper()
		l, err := pg.FriendList(ctx, a.id, now)
		if err != nil {
			t.Fatal(err)
		}
		return l
	}
	refused := func(what string, err error) {
		t.Helper()
		if !errors.Is(err, meta.ErrInvalid) {
			t.Fatalf("%s: want a refusal, got %v", what, err)
		}
	}

	alice, bob, carol := newAdmiral("アリス"), newAdmiral("ボブ"), newAdmiral("キャロル")

	// Alice asks Bob, by his code as he would read it out.
	bobTyped := bob.code[:4] + "-" + bob.code[4:]
	if mutual, err := pg.RequestFriend(ctx, alice.id, " "+bobTyped+" "); err != nil || mutual {
		t.Fatalf("request: %v %v", mutual, err)
	}
	_, err := pg.RequestFriend(ctx, alice.id, bob.code)
	refused("asking twice", err)
	_, err = pg.RequestFriend(ctx, alice.id, alice.code)
	refused("asking oneself", err)
	_, err = pg.RequestFriend(ctx, alice.id, "ZZZZZZZZ")
	refused("unknown code", err)
	_, err = pg.RequestFriend(ctx, alice.id, "bad")
	refused("malformed code", err)
	if l := list(alice); len(l.Outgoing) != 1 || l.Outgoing[0].Name != "ボブ" || len(l.Friends) != 0 {
		t.Fatalf("alice after asking: %+v", l)
	}
	if l := list(bob); len(l.Incoming) != 1 || l.Incoming[0].Code != alice.code || l.Incoming[0].FleetPower == 0 {
		t.Fatalf("bob's requests: %+v", l)
	}
	// While it is pending Bob may look at who asked; Carol may not.
	if v, err := pg.FriendProfile(ctx, bob.id, alice.code); err != nil || v.Name != "アリス" || len(v.Fleet) != 3 {
		t.Fatalf("bob looks at alice: %+v %v", v, err)
	}
	_, err = pg.FriendProfile(ctx, carol.id, alice.code)
	refused("a stranger looks", err)

	if err := pg.AcceptFriend(ctx, bob.id, alice.code); err != nil {
		t.Fatal(err)
	}
	refused("accepting twice", pg.AcceptFriend(ctx, bob.id, alice.code))
	for _, a := range []admiral{alice, bob} {
		if l := list(a); len(l.Friends) != 1 || len(l.Incoming)+len(l.Outgoing) != 0 {
			t.Fatalf("after accepting: %+v", l)
		}
	}
	_, err = pg.RequestFriend(ctx, bob.id, alice.code)
	refused("asking a friend", err)

	// Asking someone who has already asked you is a yes.
	if _, err := pg.RequestFriend(ctx, carol.id, alice.code); err != nil {
		t.Fatal(err)
	}
	if mutual, err := pg.RequestFriend(ctx, alice.id, carol.code); err != nil || !mutual {
		t.Fatalf("crossed requests: %v %v", mutual, err)
	}
	if l := list(alice); len(l.Friends) != 2 || len(l.Incoming)+len(l.Outgoing) != 0 {
		t.Fatalf("alice with two friends: %+v", l)
	}

	// Cheers: once a day per friend, collected for coins.
	if n, err := pg.CheerFriends(ctx, bob.id, alice.code, now); err != nil || n != 1 {
		t.Fatalf("cheer: %d %v", n, err)
	}
	_, err = pg.CheerFriends(ctx, bob.id, alice.code, now)
	refused("cheering twice a day", err)
	_, err = pg.CheerFriends(ctx, bob.id, carol.code, now)
	refused("cheering a stranger", err)
	if n, err := pg.CheerFriends(ctx, carol.id, "", now); err != nil || n != 1 {
		t.Fatalf("cheer everyone: %d %v", n, err)
	}
	if l := list(alice); l.Cheers != 2 || !l.Friends[0].CheeredMe || l.Friends[0].Cheered {
		t.Fatalf("alice's cheers: %+v", l)
	}
	if l := list(bob); !l.Friends[0].Cheered {
		t.Fatalf("bob sees his cheer: %+v", l)
	}
	before, err := pg.UpdatePlayer(ctx, alice.id, func(*meta.Profile) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	n, g, prof, err := pg.ClaimCheers(ctx, alice.id, now)
	if err != nil || n != 2 || g.Coins != 2*meta.CheerCoins || prof.Coins != before.Coins+2*meta.CheerCoins {
		t.Fatalf("claim: %d %+v %v", n, g, err)
	}
	_, _, _, err = pg.ClaimCheers(ctx, alice.id, now)
	refused("claiming twice", err)
	// A new day, a new cheer.
	if _, err := pg.CheerFriends(ctx, bob.id, alice.code, now.Add(24*time.Hour)); err != nil {
		t.Fatal(err)
	}

	// Declining, cancelling and unfriending.
	dave := newAdmiral("デイブ")
	if _, err := pg.RequestFriend(ctx, dave.id, alice.code); err != nil {
		t.Fatal(err)
	}
	if err := pg.DeclineFriend(ctx, alice.id, dave.code); err != nil {
		t.Fatal(err)
	}
	if _, err := pg.RequestFriend(ctx, dave.id, bob.code); err != nil {
		t.Fatal(err)
	}
	refused("cancelling someone else's request", pg.CancelFriendRequest(ctx, bob.id, dave.code))
	if err := pg.CancelFriendRequest(ctx, dave.id, bob.code); err != nil {
		t.Fatal(err)
	}
	if l := list(dave); len(l.Outgoing)+len(l.Friends) != 0 {
		t.Fatalf("dave after no: %+v", l)
	}
	if err := pg.RemoveFriend(ctx, bob.id, alice.code); err != nil {
		t.Fatal(err)
	}
	refused("removing twice", pg.RemoveFriend(ctx, alice.id, bob.code))
	if l := list(alice); len(l.Friends) != 1 || l.Friends[0].Code != carol.code {
		t.Fatalf("alice after bob left: %+v", l)
	}
	_, err = pg.FriendProfile(ctx, bob.id, alice.code)
	refused("an old friend looks", err)
}

// Two admirals asking each other at the same moment end up friends once,
// without a deadlock or a duplicate.
func TestPostgresFriendsCrossedAtOnce(t *testing.T) {
	pg := testDB(t)
	ctx := context.Background()
	var ids, codes [2]string
	for i := range ids {
		ids[i] = auth.NewPlayerID()
		if _, err := pg.UpdatePlayer(ctx, ids[i], func(*meta.Profile) error { return nil }); err != nil {
			t.Fatal(err)
		}
		l, err := pg.FriendList(ctx, ids[i], time.Now())
		if err != nil {
			t.Fatal(err)
		}
		codes[i] = l.Code
	}
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := range ids {
		wg.Go(func() { _, errs[i] = pg.RequestFriend(ctx, ids[i], codes[1-i]) })
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	for i := range ids {
		l, err := pg.FriendList(ctx, ids[i], time.Now())
		if err != nil {
			t.Fatal(err)
		}
		if len(l.Friends) != 1 || len(l.Incoming)+len(l.Outgoing) != 0 {
			t.Fatalf("admiral %d: %+v", i, l)
		}
	}
}
