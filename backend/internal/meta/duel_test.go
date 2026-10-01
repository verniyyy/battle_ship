package meta

import (
	"errors"
	"testing"

	"github.com/verniyyy/battle_ship/backend/internal/game"
)

func admiral(id string) *Profile {
	p := NewProfile(id, t0)
	p.Name = "提督" + id
	return p
}

// placedDuel is a duel with both fleets deployed along each admiral's back row.
func placedDuel(t *testing.T) *Duel {
	t.Helper()
	d, err := NewDuel(admiral("a"), "ABCDEF", t0)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Join(admiral("b"), t0); err != nil {
		t.Fatal(err)
	}
	for _, side := range []game.Side{game.SidePlayer, game.SideCPU} {
		var ps []game.Pos
		for i := range d.of(side).Fleet {
			ps = append(ps, game.Pos{Row: 7, Col: i * 2})
		}
		if err := d.Place(side, ps, t0, rng(8)); err != nil {
			t.Fatal(err)
		}
	}
	return d
}

func TestDuelSetUp(t *testing.T) {
	d, err := NewDuel(admiral("a"), "ABCDEF", t0)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.Join(admiral("a"), t0); !errors.Is(err, ErrInvalid) {
		t.Errorf("joining one's own room: %v", err)
	}
	if err := d.Join(admiral("b"), t0); err != nil {
		t.Fatal(err)
	}
	if d.Phase != DuelPlacing {
		t.Fatalf("phase %s after joining", d.Phase)
	}
	if err := d.Join(admiral("c"), t0); !errors.Is(err, ErrInvalid) {
		t.Errorf("a third admiral joined: %v", err)
	}
	n := len(d.Host.Fleet)
	if err := d.Place(game.SidePlayer, make([]game.Pos, n), t0, rng(8)); !errors.Is(err, ErrInvalid) {
		t.Errorf("deploying outside the zone: %v", err)
	}
	ps := []game.Pos{{Row: 5, Col: 0}, {Row: 6, Col: 1}, {Row: 7, Col: 2}}[:n]
	if err := d.Place(game.SidePlayer, ps, t0, rng(8)); err != nil {
		t.Fatal(err)
	}
	if err := d.Place(game.SideCPU, ps, t0, rng(8)); err != nil {
		t.Fatal(err)
	}
	if d.Phase != DuelBattle || !d.Game.Duel || d.Game.Size != DuelSize {
		t.Fatalf("battle did not begin: %s", d.Phase)
	}
	// The guest deployed in their own bottom rows, which is the top of the real sea.
	if got := d.Game.Boards[game.SideCPU].Ships[0].Pos; got != (game.Pos{Row: 2, Col: 0}) {
		t.Errorf("guest's first ship on the real sea at %v, want (2,0)", got)
	}
	if v := d.View(game.SideCPU, t0); v.Placement[0] != ps[0] || *v.Game.PlayerShips[0].Pos != ps[0] {
		t.Errorf("guest sees their ship at %v / %v, want %v", v.Placement[0], *v.Game.PlayerShips[0].Pos, ps[0])
	}
}

func TestDuelRoundWaitsForBothOrders(t *testing.T) {
	d := placedDuel(t)
	host := d.View(game.SidePlayer, t0).Game.PlayerShips[0]
	guest := d.View(game.SideCPU, t0).Game.PlayerShips[0]
	if err := d.Act(game.SidePlayer, game.Action{Type: game.ActionMove, ShipID: 0, Target: host.MoveTargets[0]}, 0, t0, rng(8)); err != nil {
		t.Fatal(err)
	}
	if d.Game.Turn != 0 || d.View(game.SideCPU, t0).Opponent.Ready != true {
		t.Fatal("the round played before the guest's order, or the guest cannot see the host is ready")
	}
	if err := d.Act(game.SidePlayer, game.Action{Type: game.ActionMove, ShipID: 0, Target: host.MoveTargets[0]}, 0, t0, rng(8)); !errors.Is(err, ErrInvalid) {
		t.Errorf("a second order in one round: %v", err)
	}
	// Orders are given as each admiral sees the sea.
	if err := d.Act(game.SideCPU, game.Action{Type: game.ActionMove, ShipID: 0, Target: guest.MoveTargets[0]}, 0, t0, rng(8)); err != nil {
		t.Fatal(err)
	}
	if d.Game.Turn != 1 || d.Host.Pending != nil || d.Guest.Pending != nil {
		t.Fatalf("round not played: turn %d", d.Game.Turn)
	}
	if got := *d.View(game.SideCPU, t0).Game.PlayerShips[0].Pos; got != guest.MoveTargets[0] {
		t.Errorf("guest's ship at %v, want %v", got, guest.MoveTargets[0])
	}
	if err := d.Act(game.SideCPU, game.Action{Type: game.ActionMove, ShipID: 0, Target: guest.MoveTargets[0]}, 0, t0, rng(8)); !errors.Is(err, ErrDuelMoved) {
		t.Errorf("an order chosen on the previous round: %v", err)
	}
}

func TestDuelTimeouts(t *testing.T) {
	d := placedDuel(t)
	now := t0
	for i := range DuelMaxMisses {
		if d.Tick(now, rng(8)) {
			t.Fatal("ticked before the deadline")
		}
		// The host keeps giving orders, the guest never does.
		a := game.Action{Type: game.ActionMove, ShipID: 0, Target: d.View(game.SidePlayer, now).Game.PlayerShips[0].MoveTargets[0]}
		if err := d.Act(game.SidePlayer, a, i, now, rng(8)); err != nil {
			t.Fatal(err)
		}
		now = now.Add(DuelRoundTime)
		if !d.Tick(now, rng(8)) {
			t.Fatal("deadline passed without a tick")
		}
	}
	if d.Phase != DuelFinished || d.Outcome(game.SidePlayer) != "win" || d.Game.EndReason != game.EndTimeout {
		t.Errorf("after %d missed rounds: %s, host %q (%s)", DuelMaxMisses, d.Phase, d.Outcome(game.SidePlayer), d.Game.EndReason)
	}
	if d.Game.Turn != DuelMaxMisses-1 {
		t.Errorf("played %d rounds, want %d skipped by the guest before they lost", d.Game.Turn, DuelMaxMisses-1)
	}
}

func TestDuelPlacementTimeoutDeploysAtRandom(t *testing.T) {
	d, _ := NewDuel(admiral("a"), "ABCDEF", t0)
	_ = d.Join(admiral("b"), t0)
	d.Tick(t0.Add(DuelPlaceTime), rng(8))
	if d.Phase != DuelBattle {
		t.Fatalf("phase %s", d.Phase)
	}
	for _, s := range d.Game.Boards[game.SideCPU].Ships {
		if s.Pos.Row >= DuelZoneRows {
			t.Errorf("guest's random ship at %v, outside their zone", s.Pos)
		}
	}
	for _, s := range d.Game.Boards[game.SidePlayer].Ships {
		if !InZone(s.Pos) {
			t.Errorf("host's random ship at %v, outside their zone", s.Pos)
		}
	}
}

func TestDuelLeave(t *testing.T) {
	d, _ := NewDuel(admiral("a"), "ABCDEF", t0)
	if d.Tick(t0.Add(DuelOpenFor), rng(8)); d.Phase != DuelCancelled {
		t.Errorf("an unjoined room stayed %s", d.Phase)
	}
	d = placedDuel(t)
	if err := d.Leave(game.SideCPU); err != nil {
		t.Fatal(err)
	}
	if d.Outcome(game.SideCPU) != "lose" || d.Outcome(game.SidePlayer) != "win" || d.Game.EndReason != game.EndSurrender {
		t.Errorf("surrender: guest %q, host %q", d.Outcome(game.SideCPU), d.Outcome(game.SidePlayer))
	}
	if err := d.Leave(game.SidePlayer); err == nil {
		t.Error("left a finished duel")
	}
}

func TestNormalizeDuelCode(t *testing.T) {
	for in, want := range map[string]string{"abc-def": "ABCDEF", " k7qm4x ": "K7QM4X"} {
		if got, ok := NormalizeDuelCode(in); !ok || got != want {
			t.Errorf("NormalizeDuelCode(%q) = %q, %v", in, got, ok)
		}
	}
	for _, in := range []string{"ABCDE", "ABCDE0", "ABCDEFG"} {
		if _, ok := NormalizeDuelCode(in); ok {
			t.Errorf("NormalizeDuelCode(%q) accepted", in)
		}
	}
	if c := NewDuelCode(rng(8)); len(c) != DuelCodeLen {
		t.Errorf("NewDuelCode = %q", c)
	}
}
