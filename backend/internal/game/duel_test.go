package game

import (
	"reflect"
	"slices"
	"testing"
)

func duelGame(t *testing.T) *State {
	t.Helper()
	player, err := NewBoard(8, std, []Pos{{7, 0}, {7, 3}, {6, 5}})
	if err != nil {
		t.Fatal(err)
	}
	cpu, err := NewBoard(8, std, []Pos{{0, 0}, {1, 4}, {2, 6}})
	if err != nil {
		t.Fatal(err)
	}
	st := NewState(player, cpu, 30, AI{}, Clear)
	st.Duel = true
	return st
}

func TestViewForSecondAdmiralIsMirrored(t *testing.T) {
	st := duelGame(t)
	r := rng()
	// The second admiral's destroyer sails south toward the first admiral's fleet.
	st.Resolve(map[Side]Action{SideCPU: {Type: ActionMove, ShipID: 1, Target: Pos{3, 4}}}, r)

	v := st.ViewFor(SideCPU)
	if got := *v.PlayerShips[0].Pos; got != (Pos{7, 0}) {
		t.Errorf("own battleship at %v, want it mirrored to (7,0)", got)
	}
	if got := *v.PlayerShips[1].Pos; got != (Pos{4, 4}) {
		t.Errorf("own destroyer at %v, want (4,4) after sailing", got)
	}
	for _, p := range v.PlayerShips[1].MoveTargets {
		if !slices.Contains(st.Boards[SideCPU].MoveTargets(1), p.Mirror(8)) {
			t.Errorf("move target %v does not mirror a real one", p)
		}
	}
	last := v.History[len(v.History)-1]
	if last.Side != SidePlayer || last.Direction != North {
		t.Errorf("own move shows as %s sailing %s, want player sailing north", last.Side, last.Direction)
	}
	if v.EnemyShips[0].Pos != nil {
		t.Error("an untracked enemy ship's position leaked")
	}

	// The first admiral's view is the plain one.
	if !reflect.DeepEqual(st.ViewFor(SidePlayer), st.PlayerView()) {
		t.Error("ViewFor(player) differs from PlayerView")
	}
}

func TestMirroredResultRoundTrips(t *testing.T) {
	tgt, origin := Pos{1, 2}, Pos{3, 2}
	id := 0
	r := Result{
		Side: SidePlayer, Type: ActionTorpedo, Target: &tgt, Origin: &origin, Direction: North,
		Shots:    []Shot{{Target: Pos{0, 2}, HitShipID: &id, Damage: 10}},
		Paths:    [][]Pos{{{2, 2}, {1, 2}, {0, 2}}},
		Columns:  []Pos{{4, 4}},
		Scanned:  []Pos{{5, 5}},
		Revealed: []Sighting{{ShipID: 1, Pos: Pos{6, 1}}},
	}
	m := r.mirrored(8)
	if m.Side != SideCPU || *m.Target != (Pos{6, 2}) || m.Shots[0].Target != (Pos{7, 2}) || m.Direction != South {
		t.Errorf("mirrored = %+v", m)
	}
	if *r.Target != tgt || r.Shots[0].Target != (Pos{0, 2}) {
		t.Error("mirroring changed the original result")
	}
	if back := m.mirrored(8); !reflect.DeepEqual(back, r) {
		t.Errorf("mirroring twice = %+v, want %+v", back, r)
	}
}

func TestDuelJudgmentTieIsADraw(t *testing.T) {
	st := duelGame(t)
	st.judge()
	if st.Winner != "" || st.EndReason != EndJudgment {
		t.Errorf("tie judged as %q (%s), want a draw", st.Winner, st.EndReason)
	}
	st = duelGame(t)
	st.Duel = false
	st.judge()
	if st.Winner != SideCPU {
		t.Errorf("tie against the CPU went to %q, want the CPU", st.Winner)
	}
}

func TestForfeit(t *testing.T) {
	st := duelGame(t)
	if err := st.Forfeit(SideCPU, EndSurrender); err != nil {
		t.Fatal(err)
	}
	if st.Winner != SidePlayer || st.EndReason != EndSurrender || st.Status != StatusFinished {
		t.Errorf("after forfeit: %s won by %s (%s)", st.Winner, st.EndReason, st.Status)
	}
	if err := st.Forfeit(SidePlayer, EndSurrender); err == nil {
		t.Error("forfeiting a finished battle should fail")
	}
	st = duelGame(t)
	_ = st.Forfeit("", EndTimeout)
	if st.Winner != "" {
		t.Errorf("both timing out should be a draw, got %q", st.Winner)
	}
}
