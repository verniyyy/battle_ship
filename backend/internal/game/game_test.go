package game

import (
	"errors"
	"math/rand/v2"
	"testing"
)

// Plain specs without crits or evasion keep outcomes deterministic.
var (
	bb  = Spec{Key: "bb", Class: Battleship, Name: "戦艦", HP: 3, Ammo: 7, Skill: 1}
	ca  = Spec{Key: "ca", Class: Cruiser, Name: "巡洋艦", HP: 3, Ammo: 5, Skill: 2}
	dd  = Spec{Key: "dd", Class: Destroyer, Name: "駆逐艦", HP: 2, Ammo: 3, Skill: 2}
	ss  = Spec{Key: "ss", Class: Submarine, Name: "潜水艦", HP: 1, Ammo: 1, Skill: 2}
	cv  = Spec{Key: "cv", Class: Carrier, Name: "空母", HP: 3, Ammo: 1, Skill: 3}
	std = []Spec{bb, dd, ss}
)

func rng() *rand.Rand { return rand.New(rand.NewPCG(1, 2)) }

func mustBoard(t *testing.T, specs []Spec, ps ...Pos) *Board {
	t.Helper()
	b, err := NewBoard(5, specs, ps)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func newGame(t *testing.T, player, cpu []Pos) *State {
	t.Helper()
	return NewState(mustBoard(t, std, player...), mustBoard(t, std, cpu...), 0, AI{})
}

func apply(t *testing.T, st *State, side Side, a Action) Result {
	t.Helper()
	res, err := st.Apply(side, a, rng())
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestNewBoardValidation(t *testing.T) {
	cases := map[string][]Pos{
		"too few":       {{0, 0}, {1, 1}},
		"out of bounds": {{0, 0}, {1, 1}, {5, 0}},
		"overlap":       {{0, 0}, {1, 1}, {1, 1}},
	}
	for name, ps := range cases {
		if _, err := NewBoard(5, std, ps); !errors.Is(err, ErrInvalidPlacement) {
			t.Errorf("%s: got %v, want ErrInvalidPlacement", name, err)
		}
	}
	if _, err := NewBoard(4, std, []Pos{{0, 0}, {1, 1}, {2, 2}}); !errors.Is(err, ErrInvalidPlacement) {
		t.Errorf("tiny board accepted")
	}
}

func TestAttackTargetsExcludeFriendlyShips(t *testing.T) {
	b := mustBoard(t, std, Pos{0, 0}, Pos{0, 1}, Pos{4, 4})
	got := b.AttackTargets(0)
	want := []Pos{{1, 0}, {1, 1}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestMoveTargetsRowAndColumnOnly(t *testing.T) {
	b := mustBoard(t, std, Pos{2, 2}, Pos{2, 4}, Pos{0, 0})
	got := b.MoveTargets(0)
	if len(got) != 7 { // 4 in column + 3 in row (one blocked by ship 1)
		t.Fatalf("got %d targets: %v", len(got), got)
	}
	for _, p := range got {
		if p.Row != 2 && p.Col != 2 {
			t.Errorf("diagonal target %v", p)
		}
		if p == (Pos{2, 4}) {
			t.Errorf("target occupied by friendly ship")
		}
	}
}

func TestAttackHitSplashAndSink(t *testing.T) {
	st := newGame(t, []Pos{{2, 2}, {4, 4}, {0, 4}}, []Pos{{3, 3}, {0, 0}, {3, 1}})
	cpu := st.Boards[SideCPU]

	// Hit the CPU battleship. The submarine at (3,1) is not adjacent to (3,3), and nothing else is near.
	res := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{3, 3}})
	sh := res.Shots[0]
	if sh.HitShipID == nil || *sh.HitShipID != 0 || sh.Damage != 1 || sh.Sunk || sh.Splash {
		t.Fatalf("unexpected shot %+v", sh)
	}
	if cpu.Ships[0].HP != 2 || st.Boards[SidePlayer].Ships[0].Ammo != 6 || st.Turn != 1 {
		t.Fatalf("state not updated")
	}

	// Submarines never raise a splash: (3,2) touches the sub at (3,1) and the battleship at (3,3).
	res = apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{3, 2}})
	if !res.Shots[0].Splash {
		t.Fatal("battleship next door should splash")
	}
	cpu.Ships[0].Pos = Pos{4, 4}
	res = apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{3, 2}})
	if res.Shots[0].Splash {
		t.Fatal("a lone submarine must not splash")
	}

	// Sink the submarine (1 HP).
	res = apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{3, 1}})
	if !res.Shots[0].Sunk {
		t.Fatalf("expected sink, got %+v", res.Shots[0])
	}
}

func TestCritAndEvasion(t *testing.T) {
	sharp := bb
	sharp.Crit = 100
	slippery := dd
	slippery.Evasion = 100
	st := NewState(mustBoard(t, []Spec{sharp, dd, ss}, Pos{0, 0}, Pos{4, 4}, Pos{0, 4}),
		mustBoard(t, []Spec{bb, slippery, ss}, Pos{1, 1}, Pos{1, 0}, Pos{3, 3}), 0, AI{})

	res := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{1, 1}})
	if sh := res.Shots[0]; !sh.Crit || sh.Damage != 2 || st.Boards[SideCPU].Ships[0].HP != 1 {
		t.Fatalf("crit expected: %+v", sh)
	}
	res = apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{1, 0}})
	if sh := res.Shots[0]; !sh.Evaded || sh.Damage != 0 || st.Boards[SideCPU].Ships[1].HP != 2 {
		t.Fatalf("evasion expected: %+v", sh)
	}
	// An evaded shell still gives away the ship's position.
	if st.Intel[SidePlayer]["1"].Pos != (Pos{1, 0}) {
		t.Fatal("evading ship should be spotted")
	}
}

func TestAttackOutOfRangeRejected(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{2, 2}, {3, 3}, {4, 0}})
	if _, err := st.Apply(SidePlayer, Action{ActionAttack, 0, Pos{2, 2}}, rng()); !errors.Is(err, ErrInvalidAction) {
		t.Fatalf("got %v, want ErrInvalidAction", err)
	}
}

func TestMoveReportsDirectionExceptSubmarines(t *testing.T) {
	st := newGame(t, []Pos{{3, 1}, {4, 4}, {0, 4}}, []Pos{{2, 2}, {3, 3}, {4, 0}})
	res := apply(t, st, SidePlayer, Action{ActionMove, 0, Pos{0, 1}})
	if res.Direction != North || res.Distance != 3 || res.Hidden {
		t.Fatalf("got %+v", res)
	}
	res = apply(t, st, SidePlayer, Action{ActionMove, 2, Pos{0, 2}})
	if !res.Hidden || res.Direction != "" || res.Distance != 0 {
		t.Fatalf("submarine move leaked: %+v", res)
	}
}

func TestBarrageHitsPlusShape(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{2, 2}, {2, 1}, {1, 2}})
	res := apply(t, st, SidePlayer, Action{ActionSkill, 0, Pos{2, 2}})
	if res.Skill != SkillBarrage || len(res.Shots) != 5 || res.Hits() != 3 || res.Sinks() != 1 {
		t.Fatalf("barrage: hits=%d sinks=%d shots=%+v", res.Hits(), res.Sinks(), res.Shots)
	}
	if st.Boards[SidePlayer].Ships[0].Skill != 0 {
		t.Fatal("skill use not spent")
	}
	if _, err := st.Apply(SidePlayer, Action{ActionSkill, 0, Pos{2, 2}}, rng()); !errors.Is(err, ErrInvalidAction) {
		t.Fatal("skill should be exhausted")
	}
}

func TestBarrageRange(t *testing.T) {
	b := mustBoard(t, std, Pos{0, 0}, Pos{4, 4}, Pos{0, 4})
	for _, p := range b.SkillTargets(0) {
		if d := p.Dist(Pos{0, 0}); d < 1 || d > 2 {
			t.Fatalf("barrage target %v at distance %d", p, d)
		}
	}
	if n := len(b.SkillTargets(0)); n != 8 {
		t.Fatalf("got %d barrage targets", n)
	}
}

func TestTorpedoStopsAtFirstShip(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {2, 0}}, []Pos{{2, 3}, {2, 4}, {0, 4}})
	res := apply(t, st, SidePlayer, Action{ActionSkill, 2, Pos{2, 1}})
	if len(res.Shots) != 1 || res.Shots[0].Target != (Pos{2, 3}) || res.Shots[0].Damage != 2 {
		t.Fatalf("torpedo: %+v", res)
	}
	if len(res.Path) != 3 {
		t.Fatalf("path %v", res.Path)
	}
	// A miss runs to the edge.
	res = apply(t, st, SidePlayer, Action{ActionSkill, 2, Pos{3, 0}})
	if len(res.Shots) != 0 || len(res.Path) != 2 {
		t.Fatalf("torpedo miss: %+v", res)
	}
}

func TestFlareMissesSubmarinesSonarDoesNot(t *testing.T) {
	player := mustBoard(t, []Spec{ca, dd, ss}, Pos{0, 0}, Pos{4, 2}, Pos{0, 4})
	cpu := mustBoard(t, std, Pos{2, 2}, Pos{4, 4}, Pos{3, 2})
	st := NewState(player, cpu, 0, AI{})

	res := apply(t, st, SidePlayer, Action{ActionSkill, 0, Pos{2, 2}})
	if len(res.Scanned) != 9 || len(res.Revealed) != 1 || res.Revealed[0].ShipID != 0 {
		t.Fatalf("flare: %+v", res)
	}
	// Sonar from (4,2) covers row 4 and column 2: battleship (2,2), destroyer (4,4), submarine (3,2).
	res = apply(t, st, SidePlayer, Action{ActionSkill, 1, Pos{4, 2}})
	if len(res.Revealed) != 3 {
		t.Fatalf("sonar revealed %v", res.Revealed)
	}
	v := st.PlayerView()
	for _, s := range v.EnemyShips {
		if s.Pos == nil || !s.Spotted {
			t.Fatalf("ship %d should be spotted", s.ID)
		}
	}
	if res.Combo != 2 {
		t.Fatalf("scouting twice should chain a combo, got %d", res.Combo)
	}
}

func TestIntelFollowsAnnouncedMoves(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{1, 1}, {3, 3}, {4, 0}})
	apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{1, 1}})
	apply(t, st, SideCPU, Action{ActionMove, 0, Pos{1, 4}})
	if got := st.Intel[SidePlayer]["0"].Pos; got != (Pos{1, 4}) {
		t.Fatalf("tracked position = %v", got)
	}
	// Submerged moves shake off pursuit.
	st.Intel[SidePlayer]["2"] = Sighting{ShipID: 2, Pos: Pos{4, 0}}
	apply(t, st, SideCPU, Action{ActionMove, 2, Pos{4, 2}})
	if _, ok := st.Intel[SidePlayer]["2"]; ok {
		t.Fatal("submarine should be lost after diving")
	}
}

func TestGaugeComboAndUltimate(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{1, 1}, {2, 2}, {3, 3}})
	if _, err := st.Apply(SidePlayer, Action{ActionUltimate, 0, Pos{2, 2}}, rng()); !errors.Is(err, ErrInvalidAction) {
		t.Fatal("ultimate should need a full gauge")
	}
	r1 := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{1, 1}})
	r2 := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{1, 1}})
	if r1.Combo != 1 || r2.Combo != 2 || r2.Gauge <= r1.Gauge*2 {
		t.Fatalf("combo should snowball the gauge: %d/%d → %d/%d", r1.Combo, r1.Gauge, r2.Combo, r2.Gauge)
	}
	if st.Gauge[SideCPU] != 2*gaugeHurt {
		t.Fatalf("taking damage should charge the victim's gauge, got %d", st.Gauge[SideCPU])
	}
	r3 := apply(t, st, SidePlayer, Action{ActionMove, 0, Pos{0, 1}})
	if r3.Combo != 0 {
		t.Fatal("moving should break the combo")
	}

	st.Gauge[SidePlayer] = GaugeMax
	res := apply(t, st, SidePlayer, Action{ActionUltimate, 1, Pos{2, 2}})
	if len(res.Shots) != 9 || res.Hits() != 3 || st.Gauge[SidePlayer] != 0 {
		t.Fatalf("ultimate: hits=%d gauge=%d", res.Hits(), st.Gauge[SidePlayer])
	}
}

func TestWinByDestroyingFleet(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{1, 1}, {3, 3}, {4, 0}})
	cpu := st.Boards[SideCPU]
	cpu.Ships[0].HP, cpu.Ships[1].HP, cpu.Ships[2].HP = 1, 0, 0

	apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{1, 1}})
	if st.Status != StatusFinished || st.Winner != SidePlayer || st.EndReason != EndAnnihilated {
		t.Fatalf("status=%s winner=%s reason=%s", st.Status, st.Winner, st.EndReason)
	}
	if _, err := st.Apply(SideCPU, Action{ActionMove, 0, Pos{1, 0}}, rng()); !errors.Is(err, ErrGameOver) {
		t.Fatalf("got %v, want ErrGameOver", err)
	}
}

func TestLoseByRunningOutOfFirepower(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{2, 2}, {3, 3}, {4, 0}})
	for _, s := range st.Boards[SidePlayer].Ships {
		s.Ammo, s.Skill = 0, 0
	}
	st.Boards[SidePlayer].Ships[0].Ammo = 1

	apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{1, 1}})
	if st.Winner != SideCPU || st.EndReason != EndDisarmed {
		t.Fatalf("winner=%s reason=%s, want cpu disarmed", st.Winner, st.EndReason)
	}
}

func TestFullGaugeKeepsDisarmedFleetFighting(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{2, 2}, {3, 3}, {4, 0}})
	for _, s := range st.Boards[SidePlayer].Ships {
		s.Ammo, s.Skill = 0, 0
	}
	st.Boards[SidePlayer].Ships[0].Ammo = 1
	st.Gauge[SidePlayer] = GaugeMax - 1
	apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{1, 1}}) // splash on (2,2) tops the gauge up
	if st.Status != StatusInProgress {
		t.Fatalf("a full gauge is still firepower: %s", st.EndReason)
	}
}

func TestTurnLimitJudgment(t *testing.T) {
	st := NewState(mustBoard(t, std, Pos{0, 0}, Pos{4, 4}, Pos{0, 4}), mustBoard(t, std, Pos{1, 1}, Pos{3, 2}, Pos{4, 0}), 1, AI{})
	apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{1, 1}})
	if st.Status != StatusInProgress {
		t.Fatal("the round is not over until the CPU replies")
	}
	apply(t, st, SideCPU, Action{ActionMove, 1, Pos{3, 0}})
	if st.Status != StatusFinished || st.Winner != SidePlayer || st.EndReason != EndJudgment {
		t.Fatalf("status=%s winner=%s reason=%s", st.Status, st.Winner, st.EndReason)
	}
}

func TestFootprintClipsToBoard(t *testing.T) {
	if n := len(Footprint(5, ActionUltimate, "", Pos{}, Pos{0, 0})); n != 4 {
		t.Fatalf("corner ultimate covers %d cells", n)
	}
	if n := len(Footprint(5, ActionSkill, SkillSonar, Pos{2, 2}, Pos{2, 2})); n != 8 {
		t.Fatalf("sonar covers %d cells", n)
	}
}

// TestCPUAlwaysLegal plays many random games with every class and asserts
// the CPU never picks an illegal action and every game ends.
func TestCPUAlwaysLegal(t *testing.T) {
	r := rng()
	fleets := [][]Spec{std, {bb, ca, dd, ss}, {cv, ca, ss}, {cv, bb, dd, ss}}
	for i := 0; i < 400; i++ {
		size := 5 + i%3
		pf, cf := fleets[i%len(fleets)], fleets[(i+1)%len(fleets)]
		p, err := NewBoard(size, pf, RandomPlacement(r, size, len(pf)))
		if err != nil {
			t.Fatal(err)
		}
		c, err := NewBoard(size, cf, RandomPlacement(r, size, len(cf)))
		if err != nil {
			t.Fatal(err)
		}
		st := NewState(p, c, 30*(i%2), AI{Level: i % 4})
		for step := 0; st.Status == StatusInProgress; step++ {
			if step > 2000 {
				t.Fatal("game did not finish")
			}
			side := SidePlayer
			if step%2 == 1 {
				side = SideCPU
			}
			var a Action
			if side == SideCPU {
				a = st.DecideCPU(r)
			} else {
				a = randomPlayerAction(r, st)
			}
			if _, err := st.Apply(side, a, r); err != nil {
				t.Fatalf("game %d step %d (%s): %v", i, step, side, err)
			}
		}
	}
}

func randomPlayerAction(r *rand.Rand, st *State) Action {
	b := st.Boards[SidePlayer]
	for {
		s := b.Ships[r.IntN(len(b.Ships))]
		if !s.Alive() {
			continue
		}
		if st.Gauge[SidePlayer] >= GaugeMax && r.IntN(2) == 0 {
			return Action{ActionUltimate, s.ID, Pos{r.IntN(b.Size), r.IntN(b.Size)}}
		}
		if ts := b.SkillTargets(s.ID); len(ts) > 0 && r.IntN(4) == 0 {
			return Action{ActionSkill, s.ID, ts[r.IntN(len(ts))]}
		}
		if ts := b.AttackTargets(s.ID); len(ts) > 0 && r.IntN(2) == 0 {
			return Action{ActionAttack, s.ID, ts[r.IntN(len(ts))]}
		}
		if ts := b.MoveTargets(s.ID); len(ts) > 0 {
			return Action{ActionMove, s.ID, ts[r.IntN(len(ts))]}
		}
	}
}

// TestCPUFindsKnownShip checks the CPU shoots a sighted ship it can reach.
func TestCPUFindsKnownShip(t *testing.T) {
	st := newGame(t, []Pos{{2, 2}, {4, 4}, {0, 4}}, []Pos{{3, 3}, {0, 0}, {4, 0}})
	st.Intel[SideCPU]["0"] = Sighting{ShipID: 0, Pos: Pos{2, 2}}
	for i := 0; i < 20; i++ {
		a := st.DecideCPU(rand.New(rand.NewPCG(uint64(i), 9)))
		if a.Type == ActionMove {
			t.Fatalf("CPU ran instead of shooting a known ship: %+v", a)
		}
	}
}

func TestPlayerViewHidesEnemy(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{2, 2}, {3, 3}, {4, 0}})
	v := st.PlayerView()
	for _, s := range v.EnemyShips {
		if s.Pos != nil {
			t.Fatalf("enemy ship %d position leaked", s.ID)
		}
	}
	st.Status = StatusFinished
	if st.PlayerView().EnemyShips[0].Pos == nil {
		t.Fatal("enemy position should be revealed after the game")
	}
}
