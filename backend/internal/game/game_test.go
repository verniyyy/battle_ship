package game

import (
	"errors"
	"math/rand/v2"
	"slices"
	"testing"
)

// Plain specs without crits or evasion keep outcomes deterministic up to the damage roll.
var (
	bb  = Spec{Key: "bb", Class: Battleship, Name: "戦艦", Stats: Stats{HP: 600, Firepower: 200, AA: 40, Armor: 20, Speed: 10, Ammo: 6, Skill: 1}}
	ca  = Spec{Key: "ca", Class: Cruiser, Name: "巡洋艦", Stats: Stats{HP: 400, Firepower: 120, Torpedo: 200, AA: 40, Armor: 10, Speed: 20, Ammo: 6, Torps: 2, Skill: 2}}
	dd  = Spec{Key: "dd", Class: Destroyer, Name: "駆逐艦", Stats: Stats{HP: 250, Firepower: 80, Torpedo: 250, AA: 20, Speed: 30, Ammo: 6, Torps: 2, Skill: 2}}
	ss  = Spec{Key: "ss", Class: Submarine, Name: "潜水艦", Stats: Stats{HP: 100, Torpedo: 300, Speed: 15, Torps: 4, Skill: 1}}
	cv  = Spec{Key: "cv", Class: Carrier, Name: "空母", Stats: Stats{HP: 400, Firepower: 50, Air: 300, AA: 30, Armor: 10, Speed: 15, Ammo: 2, Skill: 3}}
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
	return fleetGame(t, std, std, player, cpu)
}

func fleetGame(t *testing.T, pf, cf []Spec, player, cpu []Pos) *State {
	t.Helper()
	return NewState(mustBoard(t, pf, player...), mustBoard(t, cf, cpu...), 0, AI{}, Clear)
}

func apply(t *testing.T, st *State, side Side, a Action) Result {
	t.Helper()
	res, err := st.Apply(side, a, rng())
	if err != nil {
		t.Fatal(err)
	}
	return res
}

// between reports whether dmg is a legal roll of power through armor% (×mult).
func between(dmg, power, armor int, mult float64) bool {
	lo := float64(power) * 0.85 * mult * float64(100-armor) / 100
	hi := float64(power) * 1.15 * mult * float64(100-armor) / 100
	return float64(dmg) >= lo-1 && float64(dmg) <= hi+1
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

func TestSpeedHasClassFloor(t *testing.T) {
	slow := dd
	slow.Speed = 1
	b := mustBoard(t, []Spec{slow}, Pos{0, 0})
	if got := b.Ships[0].Spec.Speed; got != Classes[Destroyer].MinSpeed {
		t.Fatalf("destroyer speed %d, want the class floor", got)
	}
}

func TestAttackTargetsFollowGunRange(t *testing.T) {
	b := mustBoard(t, []Spec{bb, dd, ss}, Pos{2, 2}, Pos{2, 3}, Pos{4, 4})
	bt := b.AttackTargets(0)
	if len(bt) != 22 { // 5×5 minus itself, the destroyer and the submarine
		t.Fatalf("battleship reaches %d cells, want 22", len(bt))
	}
	// columns 1–4 of every row, minus itself, the battleship and the submarine
	if dt := b.AttackTargets(1); len(dt) != 17 {
		t.Fatalf("destroyer reaches %d cells, want 17", len(dt))
	}
	if st := b.AttackTargets(2); len(st) != 0 {
		t.Fatal("submarines have no guns")
	}
}

func TestMoveTargetsAreCappedByClass(t *testing.T) {
	b := mustBoard(t, std, Pos{2, 2}, Pos{0, 0}, Pos{4, 4})
	if got := b.MoveTargets(0); len(got) != 4 {
		t.Fatalf("battleship moves to %v, want the 4 cells next to it", got)
	}
	if got := b.MoveTargets(1); len(got) != 6 { // 3 along the row, 3 down the column
		t.Fatalf("destroyer moves to %d cells, want 6", len(got))
	}
	b.Weather = Storm
	if got := b.MoveTargets(1); len(got) != 4 {
		t.Fatalf("destroyer in a storm moves to %d cells, want 4", len(got))
	}
	b.Ships[0].Pinned = 1
	if len(b.MoveTargets(0)) != 0 {
		t.Fatal("a pinned ship moved")
	}
}

func TestBattleshipShellsLandInAPlus(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{2, 2}, {2, 3}, {4, 0}})
	res := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{2, 2}})
	if len(res.Shots) != 5 {
		t.Fatalf("got %d shots, want 5", len(res.Shots))
	}
	center, arm := res.Shots[0], res.Shots[4] // (2,3) is the east arm
	if center.HitShipID == nil || *center.HitShipID != 0 || !between(center.Damage, 200*centerPct/100, 20, 1) {
		t.Fatalf("centre shot %+v", center)
	}
	if arm.Target != (Pos{2, 3}) || !between(arm.Damage, 200*armCellPct/100, 0, 1) {
		t.Fatalf("arm shot %+v, want reduced power on the destroyer", arm)
	}
	if st.Boards[SidePlayer].Ships[0].Ammo != bb.Ammo-1 {
		t.Fatal("a salvo costs one shell")
	}
}

func TestCriticalHitDoubles(t *testing.T) {
	sharp := dd
	sharp.Crit = 100
	st := fleetGame(t, []Spec{sharp}, []Spec{bb}, []Pos{{2, 2}}, []Pos{{2, 3}})
	res := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{2, 3}})
	if s := res.Shots[0]; !s.Crit || !between(s.Damage, 80, 20, 2) {
		t.Fatalf("crit shot %+v", s)
	}
}

func TestEvasion(t *testing.T) {
	slippery := dd
	slippery.Evasion = 100
	st := fleetGame(t, std, []Spec{slippery}, []Pos{{2, 2}, {0, 0}, {4, 4}}, []Pos{{2, 3}})
	res := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{2, 3}})
	if s := res.Shots[0]; !s.Evaded || s.Damage != 0 || s.HitShipID == nil {
		t.Fatalf("shot %+v, want evaded", s)
	}
	if _, ok := st.Intel[SidePlayer]["0"]; !ok {
		t.Fatal("a dodged shell still gives the ship away")
	}
}

func TestDestroyerGunsHuntSubmarines(t *testing.T) {
	st := fleetGame(t, []Spec{dd}, []Spec{ss}, []Pos{{2, 2}}, []Pos{{2, 3}})
	res := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{2, 3}})
	if s := res.Shots[0]; !s.Sunk || !between(s.Damage, 80, 0, 2) {
		t.Fatalf("anti-sub shot %+v", s)
	}
}

func TestWaterColumnsPinNearMisses(t *testing.T) {
	st := fleetGame(t, std, []Spec{dd, ss}, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{2, 2}, {1, 1}})
	res := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{0, 2}})
	if len(res.Columns) == 0 {
		t.Fatal("no water column next to the destroyer")
	}
	cpu := st.Boards[SideCPU]
	if cpu.Ships[0].Pinned == 0 || cpu.Ships[1].Pinned != 0 {
		t.Fatalf("pinned = %d/%d, want the destroyer only (submarines run deep)", cpu.Ships[0].Pinned, cpu.Ships[1].Pinned)
	}
	if len(cpu.MoveTargets(0)) != 0 {
		t.Fatal("pinned destroyer can still move")
	}
	st.endRound(nil)
	if len(cpu.MoveTargets(0)) != 0 {
		t.Fatal("the column should hold through the next round")
	}
	st.endRound(nil)
	if len(cpu.MoveTargets(0)) == 0 {
		t.Fatal("the column never settled")
	}
}

func TestSpottingFireCrits(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{3, 3}, {4, 0}, {3, 0}})
	first := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{2, 2}})
	if first.Special != "" {
		t.Fatal("the first salvo is not spotting fire")
	}
	if *st.LastGun[SidePlayer] != (Pos{2, 2}) {
		t.Fatal("last gun target not recorded")
	}
	second := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{2, 2}})
	if second.Special != SpecialSpotting {
		t.Fatalf("special = %q, want spotting", second.Special)
	}
	st.Boards[SideCPU].Ships[0].Pos = Pos{2, 2}
	third := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{2, 2}})
	if !third.Shots[0].Crit {
		t.Fatal("spotting fire must crit")
	}
	apply(t, st, SidePlayer, Action{ActionMove, 1, Pos{4, 3}})
	if st.LastGun[SidePlayer] != nil {
		t.Fatal("any other action breaks the spotting chain")
	}
}

func TestTorpedoRunsToTheFirstSurfaceShip(t *testing.T) {
	// Torpedo runs east along row 2; the submarine at (2,2) is passed under.
	st := fleetGame(t, []Spec{dd}, []Spec{ss, bb, ca}, []Pos{{2, 0}}, []Pos{{2, 2}, {2, 4}, {4, 4}})
	res := apply(t, st, SidePlayer, Action{ActionTorpedo, 0, Pos{2, 1}})
	if len(res.Shots) != 1 || *res.Shots[0].HitShipID != 1 {
		t.Fatalf("shots %+v, want the battleship", res.Shots)
	}
	if !between(res.Shots[0].Damage, 250, 10, 1) {
		t.Fatalf("torpedo damage %d ignores half the armour", res.Shots[0].Damage)
	}
	if len(res.Paths) != 1 || len(res.Paths[0]) != 4 {
		t.Fatalf("path %v", res.Paths)
	}
	if !res.Late {
		t.Fatal("torpedoes always resolve late")
	}
	if seen, ok := st.Intel[SideCPU]["0"]; !ok || seen.Pos != (Pos{2, 0}) {
		t.Fatal("the wake must give the launcher away")
	}
}

func TestPointBlankTorpedoCrits(t *testing.T) {
	st := fleetGame(t, []Spec{dd}, []Spec{bb}, []Pos{{2, 0}}, []Pos{{2, 2}})
	res := apply(t, st, SidePlayer, Action{ActionTorpedo, 0, Pos{2, 1}})
	if res.Special != SpecialPointBlank || !res.Shots[0].Crit {
		t.Fatalf("%+v, want a point-blank crit", res)
	}
}

func TestSpreadFiresThreeLanes(t *testing.T) {
	st := fleetGame(t, []Spec{ss}, []Spec{bb, dd, ca}, []Pos{{2, 0}}, []Pos{{1, 4}, {2, 4}, {3, 4}})
	res := apply(t, st, SidePlayer, Action{ActionSkill, 0, Pos{2, 1}})
	if len(res.Paths) != 3 || len(res.Shots) != 3 {
		t.Fatalf("paths %v shots %v, want three hits", res.Paths, res.Shots)
	}
}

func TestAirstrikeAntiAirAndPrecision(t *testing.T) {
	st := fleetGame(t, []Spec{cv}, []Spec{bb, dd}, []Pos{{0, 0}}, []Pos{{4, 4}, {3, 3}})
	res := apply(t, st, SidePlayer, Action{ActionSkill, 0, Pos{4, 4}})
	aa := float64(aaScale) / float64(aaScale+bb.AA+dd.AA)
	air := cv.Air * airPct / 100
	if !between(res.Shots[0].Damage, air, 20, aa) || res.Special != "" {
		t.Fatalf("blind bombing %+v, want anti-air reduced", res)
	}
	// Now tracked: precision bombing ignores anti-air.
	res = apply(t, st, SidePlayer, Action{ActionSkill, 0, Pos{4, 4}})
	if res.Special != SpecialPrecision || !between(res.Shots[0].Damage, air, 20, 1) {
		t.Fatalf("precision bombing %+v", res)
	}
}

func TestFlareMissesSubmarinesSonarDoesNot(t *testing.T) {
	st := fleetGame(t, []Spec{ca, dd}, std, []Pos{{0, 0}, {2, 0}}, []Pos{{1, 1}, {0, 1}, {2, 3}})
	res := apply(t, st, SidePlayer, Action{ActionSkill, 0, Pos{1, 1}})
	if len(res.Revealed) != 2 {
		t.Fatalf("flare revealed %v, want the two surface ships", res.Revealed)
	}
	// The sonar pings row 2 (the submarine) and the ring around the destroyer (the battleship).
	res = apply(t, st, SidePlayer, Action{ActionSkill, 1, Pos{2, 0}})
	if len(res.Revealed) != 2 || !slices.ContainsFunc(res.Revealed, func(s Sighting) bool { return s.ShipID == 2 }) {
		t.Fatalf("sonar revealed %v, want the submarine and the battleship", res.Revealed)
	}
}

func TestSonarThatFindsGivesItselfAway(t *testing.T) {
	st := fleetGame(t, []Spec{ca, dd}, std, []Pos{{0, 0}, {2, 0}}, []Pos{{1, 1}, {0, 1}, {2, 3}})
	res := apply(t, st, SidePlayer, Action{ActionSkill, 1, Pos{2, 0}})
	if res.Emitter == nil || *res.Emitter != (Pos{2, 0}) {
		t.Fatalf("sonar that found ships emitted from %v, want the destroyer's cell", res.Emitter)
	}
	// Heard, not tracked: the enemy gets no intel on the destroyer.
	if _, ok := st.Intel[SideCPU][key(1)]; ok {
		t.Fatal("the pinging destroyer is tracked")
	}
	if v := st.ViewFor(SideCPU); v.EnemyShips[1].Pos != nil {
		t.Fatal("the pinging destroyer is shown to the enemy")
	}
	if h := st.heat(SideCPU); h[Pos{2, 0}] <= 0 {
		t.Fatal("the CPU did not hear the ping")
	}
	// A ping that finds nothing goes unheard.
	st = fleetGame(t, []Spec{dd}, []Spec{ca}, []Pos{{0, 0}}, []Pos{{4, 4}})
	if res := apply(t, st, SidePlayer, Action{ActionSkill, 0, Pos{0, 0}}); res.Emitter != nil {
		t.Fatalf("an empty ping gave the destroyer away: %v", res.Emitter)
	}
}

func TestScoutingLocksOn(t *testing.T) {
	dodgy := dd
	dodgy.Evasion = 100
	st := fleetGame(t, []Spec{ca, dd}, []Spec{dodgy, ss}, []Pos{{0, 0}, {4, 4}}, []Pos{{2, 2}, {4, 0}})
	// A flare reaches anywhere on the sea.
	if res := apply(t, st, SidePlayer, Action{ActionSkill, 0, Pos{3, 1}}); len(res.Revealed) != 1 {
		t.Fatalf("flare revealed %v", res.Revealed)
	}
	if v := st.PlayerView(); !v.EnemyShips[0].Marked {
		t.Fatal("the lit destroyer is not shown locked on")
	}
	res := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{2, 2}})
	sh := res.Shots[0]
	if res.Special != SpecialMarked || sh.Evaded || !sh.Crit || !sh.Marked || !between(sh.Damage, 120, 0, critMult) {
		t.Fatalf("shot on a locked-on ship %+v (%s)", sh, res.Special)
	}
	st.endRound(nil)
	if st.Boards[SideCPU].Ships[0].Marked == 0 {
		t.Fatal("the lock-on should hold through the next round")
	}
	st.endRound(nil)
	if st.Boards[SideCPU].Ships[0].Marked != 0 {
		t.Fatal("the lock-on should wear off after the next round")
	}
}

func TestIntelFollowsMovesUntilASubDives(t *testing.T) {
	st := fleetGame(t, []Spec{ca, dd}, []Spec{dd, ss}, []Pos{{0, 0}, {4, 0}}, []Pos{{1, 1}, {4, 2}})
	apply(t, st, SidePlayer, Action{ActionSkill, 0, Pos{1, 1}})
	apply(t, st, SidePlayer, Action{ActionSkill, 1, Pos{4, 0}})
	apply(t, st, SideCPU, Action{ActionMove, 0, Pos{1, 4}})
	if seen := st.Intel[SidePlayer]["0"]; seen.Pos != (Pos{1, 4}) {
		t.Fatalf("intel %v, want the announced move followed", seen)
	}
	apply(t, st, SideCPU, Action{ActionMove, 1, Pos{2, 2}})
	if _, ok := st.Intel[SidePlayer]["1"]; ok {
		t.Fatal("a submerged move must shake off contact")
	}
}

func TestMoveStopsShortOfAnEnemyShip(t *testing.T) {
	// The destroyer sails east from (2,0) toward (2,3); an enemy sits on (2,2).
	st := fleetGame(t, []Spec{dd}, []Spec{bb}, []Pos{{2, 0}}, []Pos{{2, 2}})
	res := apply(t, st, SidePlayer, Action{ActionMove, 0, Pos{2, 3}})
	if got := st.Boards[SidePlayer].Ships[0].Pos; got != (Pos{2, 1}) {
		t.Fatalf("destroyer ended on %v, want (2,1) just short of the enemy", got)
	}
	if !res.Blocked || res.Direction != East || res.Distance != 1 {
		t.Fatalf("result %+v, want a blocked 1-cell move east", res)
	}
	if seen, ok := st.Intel[SidePlayer]["0"]; !ok || seen.Pos != (Pos{2, 2}) || !res.Contact {
		t.Fatal("running into the enemy must spot it")
	}
	if seen, ok := st.Intel[SideCPU]["0"]; !ok || seen.Pos != (Pos{2, 1}) {
		t.Fatalf("the enemy must spot the destroyer beside it, got %v", seen)
	}
}

func TestBlockedMoveStaysOffFriendlyShips(t *testing.T) {
	// A friendly battleship on (2,1) and an enemy on (2,2): nowhere to stop.
	st := fleetGame(t, []Spec{dd, bb}, []Spec{ss}, []Pos{{2, 0}, {2, 1}}, []Pos{{2, 2}})
	res := apply(t, st, SidePlayer, Action{ActionMove, 0, Pos{2, 3}})
	if got := st.Boards[SidePlayer].Ships[0].Pos; got != (Pos{2, 0}) || !res.Blocked || res.Distance != 0 {
		t.Fatalf("destroyer on %v (%+v), want it held at (2,0)", got, res)
	}
}

func TestMoveIntoAnEnemyThatArrivedFirst(t *testing.T) {
	st := fleetGame(t, []Spec{dd}, []Spec{bb}, []Pos{{0, 2}}, []Pos{{3, 0}})
	st.Resolve(map[Side]Action{SidePlayer: {ActionMove, 0, Pos{3, 2}}, SideCPU: {ActionMove, 0, Pos{3, 1}}}, rng())
	p, c := st.Boards[SidePlayer].Ships[0].Pos, st.Boards[SideCPU].Ships[0].Pos
	if p == c || p != (Pos{3, 2}) || c != (Pos{3, 1}) {
		t.Fatalf("player %v cpu %v", p, c)
	}
	st.Resolve(map[Side]Action{SidePlayer: {ActionMove, 0, Pos{3, 0}}, SideCPU: {ActionAttack, 0, Pos{1, 1}}}, rng())
	if p := st.Boards[SidePlayer].Ships[0].Pos; p != (Pos{3, 2}) {
		t.Fatalf("destroyer passed through the battleship to %v", p)
	}
}

func TestShipsSideBySideSpotEachOther(t *testing.T) {
	st := fleetGame(t, []Spec{dd, bb}, []Spec{ss, bb}, []Pos{{0, 0}, {4, 4}}, []Pos{{1, 0}, {3, 3}})
	if seen, ok := st.Intel[SidePlayer]["0"]; !ok || seen.Pos != (Pos{1, 0}) {
		t.Fatal("a submarine right beside the destroyer must be spotted from the start")
	}
	if _, ok := st.Intel[SidePlayer]["1"]; ok {
		t.Fatal("a diagonal neighbour is not beside the ship")
	}
	if len(st.PlayerView().EnemyShips) != 2 || st.PlayerView().EnemyShips[0].Pos == nil {
		t.Fatal("the spotted submarine must show in the player view")
	}
	// Diving to a cell no enemy is beside shakes off contact again.
	apply(t, st, SideCPU, Action{ActionMove, 0, Pos{1, 1}})
	if _, ok := st.Intel[SidePlayer]["0"]; ok {
		t.Fatal("diving clear of the destroyer must shake off contact")
	}
	res := apply(t, st, SideCPU, Action{ActionMove, 1, Pos{3, 4}})
	if !res.Contact {
		t.Fatal("sailing beside an enemy ship is a contact")
	}
	if seen := st.Intel[SidePlayer]["1"]; seen.Pos != (Pos{3, 4}) {
		t.Fatalf("intel %v, want the battleship beside (4,4)", seen)
	}
}

func TestRandomPlacementAvoidsTheOtherFleet(t *testing.T) {
	r := rng()
	taken := RandomPlacement(r, 5, 20)
	for i := 0; i < 50; i++ {
		for _, p := range RandomPlacement(r, 5, 5, taken...) {
			if slices.Contains(taken, p) {
				t.Fatalf("placed on the other fleet's cell %v", p)
			}
		}
	}
}

func TestInitiativeFasterFirstTorpedoesLast(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{2, 2}, {3, 3}, {4, 0}})
	r := rng()
	order := st.Initiative(map[Side]Action{SidePlayer: {Type: ActionAttack, ShipID: 1}, SideCPU: {Type: ActionAttack, ShipID: 0}}, r)
	if order[0] != SidePlayer {
		t.Fatal("the faster destroyer should act first")
	}
	order = st.Initiative(map[Side]Action{SidePlayer: {Type: ActionTorpedo, ShipID: 1}, SideCPU: {Type: ActionAttack, ShipID: 0}}, r)
	if order[0] != SideCPU {
		t.Fatal("a torpedo launch always goes last")
	}
}

func TestShipSunkBeforeActingIsCancelled(t *testing.T) {
	sharp := dd
	sharp.Firepower = 1000
	st := fleetGame(t, []Spec{sharp}, []Spec{bb, dd}, []Pos{{2, 2}}, []Pos{{2, 3}, {0, 0}})
	out := st.Resolve(map[Side]Action{
		SidePlayer: {ActionAttack, 0, Pos{2, 3}},
		SideCPU:    {ActionAttack, 0, Pos{2, 2}},
	}, rng())
	if len(out) != 2 || out[0].Side != SidePlayer || !out[1].Cancelled {
		t.Fatalf("results %+v, want the battleship's salvo cancelled", out)
	}
	if st.Turn != 1 || st.Boards[SidePlayer].Ships[0].HP != sharp.HP {
		t.Fatal("round not closed cleanly")
	}
}

func TestGaugeComboAndUltimate(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{1, 1}, {3, 3}, {4, 0}})
	if _, err := st.Apply(SidePlayer, Action{ActionUltimate, 0, Pos{2, 2}}, rng()); !errors.Is(err, ErrInvalidAction) {
		t.Fatal("ultimate allowed with an empty gauge")
	}
	res := apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{1, 1}})
	if res.Combo != 1 || res.Gauge == 0 || st.Gauge[SideCPU] == 0 {
		t.Fatalf("combo %d gauge %d enemy gauge %d", res.Combo, res.Gauge, st.Gauge[SideCPU])
	}
	st.Gauge[SidePlayer] = GaugeMax
	res = apply(t, st, SidePlayer, Action{ActionUltimate, 2, Pos{3, 3}})
	if len(res.Shots) != 11 || res.Hits() != 1 || st.Gauge[SidePlayer] != 0 {
		t.Fatalf("ultimate shots %d hits %d", len(res.Shots), res.Hits())
	}
}

func TestUltimateFallsOffAndPinsSurvivors(t *testing.T) {
	// Three big guns aimed at a battleship, with a cruiser two cells out and a
	// destroyer just outside the reach (two out diagonally).
	st := fleetGame(t, []Spec{bb, bb, bb}, []Spec{bb, ca, dd}, []Pos{{0, 0}, {0, 4}, {4, 4}}, []Pos{{2, 2}, {2, 4}, {4, 0}})
	st.Gauge[SidePlayer] = GaugeMax
	res := apply(t, st, SidePlayer, Action{ActionUltimate, 0, Pos{2, 2}})
	if len(res.Shots) != 13 || res.Shots[0].Target != (Pos{2, 2}) {
		t.Fatalf("ultimate shots %d, first at %v", len(res.Shots), res.Shots[0].Target)
	}
	byCell := map[Pos]Shot{}
	for _, s := range res.Shots {
		byCell[s.Target] = s
	}
	// Armour-piercing: enemy armour counts half.
	if s := byCell[Pos{2, 2}]; s.Evaded || !between(s.Damage, 200*ultCenterPct/100, bb.Armor/2, 1) {
		t.Fatalf("centre shot %+v", s)
	}
	if s := byCell[Pos{2, 4}]; s.Evaded || !between(s.Damage, 200*ultOuterPct/100, ca.Armor/2, 1) {
		t.Fatalf("outer shot %+v", s)
	}
	if _, ok := byCell[Pos{4, 0}]; ok {
		t.Fatal("the reach is a diamond on a small sea, not the 5×5")
	}
	// The destroyer sits next to (3,1), a shell that missed: it is pinned.
	if st.Boards[SideCPU].Ships[2].Pinned == 0 || len(res.Columns) == 0 {
		t.Fatalf("columns %v, destroyer pinned %d", res.Columns, st.Boards[SideCPU].Ships[2].Pinned)
	}
}

func TestUltimateOnALockedOnShipKeepsItsCutIn(t *testing.T) {
	st := fleetGame(t, []Spec{bb, ca}, []Spec{dd}, []Pos{{0, 0}, {4, 4}}, []Pos{{2, 2}})
	apply(t, st, SidePlayer, Action{ActionSkill, 1, Pos{2, 2}}) // the cruiser's flare locks on
	st.Gauge[SidePlayer] = GaugeMax
	res := apply(t, st, SidePlayer, Action{ActionUltimate, 0, Pos{2, 2}})
	if sh := res.Shots[0]; !sh.Marked || !sh.Crit {
		t.Fatalf("locked-on shot %+v", sh)
	}
	if res.Special != "" {
		t.Fatalf("ultimate billed as %q", res.Special)
	}
}

func TestWinByDestroyingFleet(t *testing.T) {
	sharp := bb
	sharp.Firepower = 5000
	st := fleetGame(t, []Spec{sharp}, []Spec{dd}, []Pos{{0, 0}}, []Pos{{1, 1}})
	apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{1, 1}})
	if st.Status != StatusFinished || st.Winner != SidePlayer || st.EndReason != EndAnnihilated {
		t.Fatalf("status %s winner %s reason %s", st.Status, st.Winner, st.EndReason)
	}
	if _, err := st.Apply(SidePlayer, Action{ActionAttack, 0, Pos{1, 1}}, rng()); !errors.Is(err, ErrGameOver) {
		t.Fatal("actions accepted after game over")
	}
}

func TestWithdrawWhenOutOfWeapons(t *testing.T) {
	dry := bb
	dry.Ammo, dry.Skill = 1, 0
	st := fleetGame(t, []Spec{dry}, []Spec{dd}, []Pos{{0, 0}}, []Pos{{4, 4}})
	apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{2, 2}})
	if st.Winner != SideCPU || st.EndReason != EndDisarmed {
		t.Fatalf("winner %s reason %s, want strategic withdrawal", st.Winner, st.EndReason)
	}
}

func TestFullGaugeKeepsDisarmedFleetFighting(t *testing.T) {
	dry := bb
	dry.Ammo, dry.Skill = 1, 0
	st := fleetGame(t, []Spec{dry}, []Spec{dd}, []Pos{{0, 0}}, []Pos{{4, 4}})
	st.Gauge[SidePlayer] = GaugeMax
	apply(t, st, SidePlayer, Action{ActionAttack, 0, Pos{2, 2}})
	if st.Status != StatusInProgress {
		t.Fatal("a full gauge is still a weapon")
	}
}

func TestTurnLimitJudgment(t *testing.T) {
	st := newGame(t, []Pos{{0, 0}, {4, 4}, {0, 4}}, []Pos{{1, 1}, {3, 3}, {4, 0}})
	st.MaxTurns = 1
	st.Boards[SideCPU].Ships[0].HP = 100
	st.Resolve(map[Side]Action{SidePlayer: {ActionMove, 0, Pos{0, 1}}, SideCPU: {ActionMove, 1, Pos{3, 2}}}, rng())
	if st.Status != StatusFinished || st.Winner != SidePlayer || st.EndReason != EndJudgment {
		t.Fatalf("status %s winner %s reason %s", st.Status, st.Winner, st.EndReason)
	}
}

func TestFootprintClipsToBoard(t *testing.T) {
	if n := len(Footprint(5, ActionUltimate, "", "", Pos{}, Pos{0, 0})); n != 6 {
		t.Fatalf("corner ultimate covers %d cells", n)
	}
	if n := len(Footprint(WideSea, ActionUltimate, "", "", Pos{}, Pos{3, 3})); n != 25 {
		t.Fatalf("ultimate on a wide sea covers %d cells", n)
	}
	if n := len(Footprint(5, ActionAttack, "", Battleship, Pos{}, Pos{0, 0})); n != 3 {
		t.Fatalf("corner battleship salvo covers %d cells", n)
	}
	if n := len(Footprint(5, ActionSkill, SkillSonar, Destroyer, Pos{2, 2}, Pos{2, 2})); n != 12 {
		t.Fatalf("sonar covers %d cells", n)
	}
	if n := len(Footprint(5, ActionSkill, SkillFlare, Cruiser, Pos{}, Pos{2, 2})); n != 13 {
		t.Fatalf("flare covers %d cells", n)
	}
	// A wide sea widens both: the flare to 5×5, the sonar to three-cell lanes.
	if n := len(Footprint(WideSea, ActionSkill, SkillFlare, Cruiser, Pos{}, Pos{3, 3})); n != 25 {
		t.Fatalf("flare on a wide sea covers %d cells", n)
	}
	if n := len(Footprint(WideSea, ActionSkill, SkillSonar, Destroyer, Pos{3, 3}, Pos{3, 3})); n != 3*WideSea*2-9-1 {
		t.Fatalf("sonar on a wide sea covers %d cells", n)
	}
}

// TestAIAlwaysLegalAndGamesEnd plays many AI-vs-AI games with every class
// and asserts neither side ever picks an illegal action and every game ends.
func TestAIAlwaysLegalAndGamesEnd(t *testing.T) {
	r := rng()
	fleets := [][]Spec{std, {bb, ca, dd, ss}, {cv, ca, ss}, {cv, bb, dd, ss}}
	for i := 0; i < 300; i++ {
		size := 5 + i%3
		pf, cf := fleets[i%len(fleets)], fleets[(i+1)%len(fleets)]
		pp := RandomPlacement(r, size, len(pf))
		p, err := NewBoard(size, pf, pp)
		if err != nil {
			t.Fatal(err)
		}
		c, err := NewBoard(size, cf, RandomPlacement(r, size, len(cf), pp...))
		if err != nil {
			t.Fatal(err)
		}
		st := NewState(p, c, 30*(i%2), AI{Level: i % 4}, Weathers[i%len(Weathers)])
		for round := 0; st.Status == StatusInProgress; round++ {
			if round > 400 {
				t.Fatal("game did not finish")
			}
			acts := map[Side]Action{}
			for _, side := range []Side{SidePlayer, SideCPU} {
				a := st.Decide(side, r)
				if err := st.Legal(side, a); err != nil && len(st.Actions(side)) > 0 {
					t.Fatalf("game %d round %d (%s): %v", i, round, side, err)
				}
				acts[side] = a
			}
			st.Resolve(acts, r)
			for _, a := range st.Boards[SidePlayer].Ships {
				for _, b := range st.Boards[SideCPU].Ships {
					if a.Alive() && b.Alive() && a.Pos == b.Pos {
						t.Fatalf("game %d round %d: ships share %v", i, round, a.Pos)
					}
				}
			}
		}
	}
}

// TestCPUShootsKnownShip checks the CPU shoots a sighted ship it can reach.
func TestCPUShootsKnownShip(t *testing.T) {
	st := newGame(t, []Pos{{2, 2}, {4, 4}, {0, 4}}, []Pos{{3, 3}, {0, 0}, {4, 0}})
	st.Intel[SideCPU]["0"] = Sighting{ShipID: 0, Pos: Pos{2, 2}}
	for i := 0; i < 20; i++ {
		a := st.Decide(SideCPU, rand.New(rand.NewPCG(uint64(i), 9)))
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
	if v.AA != bb.AA+dd.AA || v.Weather != Clear {
		t.Fatalf("view AA %d weather %s", v.AA, v.Weather)
	}
	st.Status = StatusFinished
	if st.PlayerView().EnemyShips[0].Pos == nil {
		t.Fatal("enemy position should be revealed after the game")
	}
}

func TestShipUnderWayMovesLate(t *testing.T) {
	st := fleetGame(t, []Spec{ca}, []Spec{dd}, []Pos{{0, 0}}, []Pos{{2, 2}})
	// The faster destroyer slips away from the first shot...
	out := st.Resolve(map[Side]Action{SidePlayer: {ActionAttack, 0, Pos{2, 2}}, SideCPU: {ActionMove, 0, Pos{2, 1}}}, rng())
	if out[0].Side != SideCPU || out[1].Shots[0].HitShipID != nil {
		t.Fatalf("a destroyer at rest should outrun the cruiser's guns: %+v", out)
	}
	// ...but still under way, it cannot dodge the next one.
	out = st.Resolve(map[Side]Action{SidePlayer: {ActionAttack, 0, Pos{2, 1}}, SideCPU: {ActionMove, 0, Pos{2, 4}}}, rng())
	if out[0].Side != SidePlayer || out[0].Shots[0].Damage == 0 || !out[1].Late {
		t.Fatalf("a second move in a row must resolve after the shot: %+v", out)
	}
	// A round at rest lets it dodge again.
	st.Resolve(map[Side]Action{SidePlayer: {ActionMove, 0, Pos{0, 1}}, SideCPU: {ActionAttack, 0, Pos{3, 4}}}, rng())
	out = st.Resolve(map[Side]Action{SidePlayer: {ActionAttack, 0, Pos{2, 3}}, SideCPU: {ActionMove, 0, Pos{3, 4}}}, rng())
	if out[0].Side != SideCPU || out[0].Late {
		t.Fatalf("a rested destroyer moves at its own speed: %+v", out)
	}
}

func TestScoutPlanesBreakAQuietSpell(t *testing.T) {
	// The submarine is nearest but only sonar finds it; the battleship is next.
	st := fleetGame(t, []Spec{bb}, []Spec{ss, dd, bb}, []Pos{{0, 0}}, []Pos{{1, 1}, {4, 4}, {2, 3}})
	quiet := map[Side]Action{SidePlayer: {ActionAttack, 0, Pos{2, 0}}, SideCPU: {ActionAttack, 1, Pos{4, 3}}}
	for round := 1; round <= 2; round++ {
		if out := st.Resolve(quiet, rng()); len(out) != 2 {
			t.Fatalf("round %d: scout planes flew too early: %+v", round, out)
		}
	}
	out := st.Resolve(quiet, rng())
	if len(out) != 4 || out[2].Type != ActionRecon || out[3].Type != ActionRecon {
		t.Fatalf("no scout reports after three quiet rounds: %+v", out)
	}
	if seen, ok := st.Intel[SidePlayer]["2"]; !ok || seen.Pos != (Pos{2, 3}) || len(st.Intel[SidePlayer]) != 1 {
		t.Fatalf("player intel %v, want the battleship only", st.Intel[SidePlayer])
	}
	if _, ok := st.Intel[SideCPU]["0"]; !ok {
		t.Fatal("the CPU's scouts must find the player's battleship too")
	}
	// Tracked ships are not reported again: the next report finds the destroyer.
	for round := 1; round <= 3; round++ {
		st.Resolve(quiet, rng())
	}
	if _, ok := st.Intel[SidePlayer]["1"]; !ok {
		t.Fatalf("player intel %v, want the destroyer found next", st.Intel[SidePlayer])
	}
}

func TestAntiAirWatchInterceptsAirstrikes(t *testing.T) {
	st := fleetGame(t, []Spec{cv, dd}, []Spec{ca, dd}, []Pos{{0, 0}, {0, 4}}, []Pos{{4, 4}, {3, 0}})
	// Only battleships and cruisers stand watch.
	if err := st.Legal(SideCPU, Action{ActionWatch, 1, Pos{3, 0}}); err == nil {
		t.Fatal("a destroyer stood anti-air watch")
	}
	// The player tracks the destroyer, so a precision strike on it is due.
	st.Intel[SidePlayer]["1"] = Sighting{ShipID: 1, Pos: Pos{3, 0}}
	out := st.Resolve(map[Side]Action{
		SidePlayer: {ActionSkill, 0, Pos{3, 0}},
		SideCPU:    {ActionWatch, 0, Pos{4, 4}},
	}, rng())
	watch, strike := out[0], out[1]
	if watch.Side != SideCPU || !watch.Early || !watch.Hidden {
		t.Fatalf("watch %+v, want it first and unseen", watch)
	}
	air := cv.Air * airPct / 100
	if !strike.Intercepted || strike.Special != SpecialPrecision || !between(strike.Shots[0].Damage, air, 0, interceptPct/100.0) {
		t.Fatalf("strike %+v, want precision bombing intercepted", strike)
	}
	carrier, cruiser := st.Boards[SidePlayer].Ships[0], st.Boards[SideCPU].Ships[0]
	if carrier.Skill != cv.Skill-2 || carrier.Marked == 0 {
		t.Fatalf("carrier skill %d marked %d, want two sorties lost and a lock-on", carrier.Skill, carrier.Marked)
	}
	if seen, ok := st.Intel[SideCPU]["0"]; !ok || seen.Pos != carrier.Pos {
		t.Fatal("the intercept did not give the carrier away")
	}
	if cruiser.Watches != 1 || st.Gauge[SideCPU] < gaugeScout || st.Combo[SideCPU] != 1 {
		t.Fatalf("watches %d gauge %d combo %d, want the order back and a scouting reward", cruiser.Watches, st.Gauge[SideCPU], st.Combo[SideCPU])
	}
	// On watch the cruiser can only sail, and the watch cannot be stacked.
	v := st.ViewFor(SideCPU)
	cs := v.PlayerShips[0]
	if cs.Watch != watchRounds-1 || len(cs.AttackTargets)+len(cs.TorpedoTargets)+len(cs.SkillTargets)+len(cs.WatchTargets) > 0 || len(cs.MoveTargets) == 0 {
		t.Fatalf("cruiser on watch %+v", cs)
	}
	// The player saw an unknown order, not the watch.
	if r := st.PlayerView().History[0]; r.Type != ActionUnknown || r.ShipID != -1 || r.Early {
		t.Fatalf("player saw %+v", r)
	}
	if r := st.ViewFor(SideCPU).History[0]; r.Type != ActionWatch {
		t.Fatalf("the watch is hidden from its own side: %+v", r)
	}
	// The watch holds two more rounds, then runs out.
	for i := 0; i < 2; i++ {
		st.Resolve(map[Side]Action{SidePlayer: {ActionMove, 1, Pos{0, 3 - i}}}, rng())
	}
	if cruiser.onWatch() || len(st.Boards[SideCPU].AttackTargets(0)) == 0 {
		t.Fatal("the watch did not run out")
	}
	strike = apply(t, st, SidePlayer, Action{ActionSkill, 0, Pos{3, 0}})
	if strike.Intercepted {
		t.Fatal("an airstrike was intercepted after the watch ran out")
	}
}

func TestAntiAirWatchSeenWhenTracked(t *testing.T) {
	st := fleetGame(t, []Spec{cv}, []Spec{bb}, []Pos{{0, 0}}, []Pos{{4, 4}})
	st.Intel[SidePlayer]["0"] = Sighting{ShipID: 0, Pos: Pos{4, 4}}
	res := apply(t, st, SideCPU, Action{ActionWatch, 0, Pos{4, 4}})
	if res.Hidden {
		t.Fatal("a watch by a tracked ship went unseen")
	}
	v := st.PlayerView()
	if v.History[0].Type != ActionWatch || v.EnemyShips[0].Watch != watchRounds {
		t.Fatalf("player view %+v / %+v", v.History[0], v.EnemyShips[0])
	}
	// An unspotted watcher does not show its watch.
	delete(st.Intel[SidePlayer], "0")
	if st.PlayerView().EnemyShips[0].Watch != 0 {
		t.Fatal("watch shown on an unspotted ship")
	}
}

func TestUnusedWatchIsSpent(t *testing.T) {
	st := fleetGame(t, []Spec{ca}, []Spec{cv}, []Pos{{0, 0}}, []Pos{{4, 4}})
	for i := 0; i < watchRounds; i++ {
		a := Action{ActionMove, 0, Pos{1 - i%2, 0}}
		if i == 0 {
			a = Action{ActionWatch, 0, Pos{0, 0}}
		}
		st.Resolve(map[Side]Action{SidePlayer: a}, rng())
	}
	if s := st.Boards[SidePlayer].Ships[0]; s.onWatch() || s.Watches != 0 || len(st.Boards[SidePlayer].WatchTargets(0)) != 0 {
		t.Fatalf("watch %d left %d, want it spent", s.Watch, s.Watches)
	}
}

func TestInitiativeWatchFirst(t *testing.T) {
	st := fleetGame(t, []Spec{dd}, []Spec{ca}, []Pos{{0, 0}}, []Pos{{4, 4}})
	order := st.Initiative(map[Side]Action{SidePlayer: {Type: ActionAttack, ShipID: 0}, SideCPU: {Type: ActionWatch, ShipID: 0}}, rng())
	if order[0] != SideCPU {
		t.Fatal("anti-air watch should go before a faster ship's action")
	}
}

func TestCPUStandsWatchAgainstTrackingCarrier(t *testing.T) {
	st := fleetGame(t, []Spec{cv, dd}, []Spec{ca, dd}, []Pos{{0, 0}, {0, 4}}, []Pos{{4, 4}, {3, 0}})
	st.AI.Level = 3
	st.Intel[SidePlayer]["1"] = Sighting{ShipID: 1, Pos: Pos{3, 0}}
	st.History = append(st.History, Result{Side: SidePlayer, Type: ActionSkill, Skill: SkillAirstrike, ShipID: 0})
	watched := 0
	for i := 0; i < 20; i++ {
		if a := st.Decide(SideCPU, rand.New(rand.NewPCG(uint64(i), 3))); a.Type == ActionWatch {
			watched++
		}
	}
	if watched == 0 {
		t.Fatal("the CPU never stood watch against a carrier that was bombing it")
	}
}
