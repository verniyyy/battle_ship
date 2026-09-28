package game

import (
	"errors"
	"math/rand/v2"
	"testing"
)

func mustBoard(t *testing.T, ps ...Pos) *Board {
	t.Helper()
	b, err := NewBoard(ps)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestNewBoardValidation(t *testing.T) {
	cases := map[string][]Pos{
		"too few":       {{0, 0}, {1, 1}},
		"out of bounds": {{0, 0}, {1, 1}, {5, 0}},
		"overlap":       {{0, 0}, {1, 1}, {1, 1}},
	}
	for name, ps := range cases {
		if _, err := NewBoard(ps); !errors.Is(err, ErrInvalidPlacement) {
			t.Errorf("%s: got %v, want ErrInvalidPlacement", name, err)
		}
	}
}

func TestAttackTargetsExcludeFriendlyShips(t *testing.T) {
	b := mustBoard(t, Pos{0, 0}, Pos{0, 1}, Pos{4, 4})
	got := b.AttackTargets(0)
	want := []Pos{{1, 0}, {1, 1}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestMoveTargetsRowAndColumnOnly(t *testing.T) {
	b := mustBoard(t, Pos{2, 2}, Pos{2, 4}, Pos{0, 0})
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
	player := mustBoard(t, Pos{2, 2}, Pos{4, 4}, Pos{0, 4})
	cpu := mustBoard(t, Pos{3, 3}, Pos{0, 0}, Pos{3, 2})
	st := NewState(player, cpu)

	// Hit the CPU battleship; the submarine at (3,2) is adjacent -> splash too.
	res, err := st.Apply(SidePlayer, Action{ActionAttack, 0, Pos{3, 3}})
	if err != nil {
		t.Fatal(err)
	}
	if res.HitShipID == nil || *res.HitShipID != 0 || res.Sunk || !res.Splash {
		t.Fatalf("unexpected result %+v", res)
	}
	if cpu.Ships[0].HP != 2 || player.Ships[0].Ammo != 6 || st.Turn != 1 {
		t.Fatalf("state not updated: cpu hp=%d ammo=%d turn=%d", cpu.Ships[0].HP, player.Ships[0].Ammo, st.Turn)
	}

	// Sink the submarine (1 HP).
	res, err = st.Apply(SidePlayer, Action{ActionAttack, 0, Pos{3, 2}})
	if err != nil {
		t.Fatal(err)
	}
	if !res.Sunk {
		t.Fatalf("expected sink, got %+v", res)
	}

	// Miss with nothing nearby.
	res, err = st.Apply(SidePlayer, Action{ActionAttack, 0, Pos{1, 1}})
	if err != nil {
		t.Fatal(err)
	}
	if res.HitShipID != nil || res.Splash != true { // (0,0) destroyer is adjacent to (1,1)
		t.Fatalf("unexpected result %+v", res)
	}
}

func TestAttackOutOfRangeRejected(t *testing.T) {
	st := NewState(mustBoard(t, Pos{0, 0}, Pos{4, 4}, Pos{0, 4}), mustBoard(t, Pos{2, 2}, Pos{3, 3}, Pos{4, 0}))
	if _, err := st.Apply(SidePlayer, Action{ActionAttack, 0, Pos{2, 2}}); !errors.Is(err, ErrInvalidAction) {
		t.Fatalf("got %v, want ErrInvalidAction", err)
	}
}

func TestMoveReportsDirection(t *testing.T) {
	st := NewState(mustBoard(t, Pos{3, 1}, Pos{4, 4}, Pos{0, 4}), mustBoard(t, Pos{2, 2}, Pos{3, 3}, Pos{4, 0}))
	res, err := st.Apply(SidePlayer, Action{ActionMove, 0, Pos{0, 1}})
	if err != nil {
		t.Fatal(err)
	}
	if res.Direction != North || res.Distance != 3 {
		t.Fatalf("got %s %d", res.Direction, res.Distance)
	}
}

func TestWinByDestroyingFleet(t *testing.T) {
	st := NewState(mustBoard(t, Pos{0, 0}, Pos{4, 4}, Pos{0, 4}), mustBoard(t, Pos{1, 1}, Pos{3, 3}, Pos{4, 0}))
	cpu := st.Boards[SideCPU]
	cpu.Ships[0].HP, cpu.Ships[1].HP = 1, 0
	cpu.Ships[2].HP = 0

	if _, err := st.Apply(SidePlayer, Action{ActionAttack, 0, Pos{1, 1}}); err != nil {
		t.Fatal(err)
	}
	if st.Status != StatusFinished || st.Winner != SidePlayer {
		t.Fatalf("status=%s winner=%s", st.Status, st.Winner)
	}
	if _, err := st.Apply(SideCPU, Action{ActionMove, 0, Pos{1, 0}}); !errors.Is(err, ErrGameOver) {
		t.Fatalf("got %v, want ErrGameOver", err)
	}
}

func TestLoseByRunningOutOfAmmo(t *testing.T) {
	st := NewState(mustBoard(t, Pos{0, 0}, Pos{4, 4}, Pos{0, 4}), mustBoard(t, Pos{2, 2}, Pos{3, 3}, Pos{4, 0}))
	p := st.Boards[SidePlayer]
	p.Ships[0].Ammo, p.Ships[1].Ammo, p.Ships[2].Ammo = 1, 0, 0

	if _, err := st.Apply(SidePlayer, Action{ActionAttack, 0, Pos{1, 1}}); err != nil {
		t.Fatal(err)
	}
	if st.Winner != SideCPU {
		t.Fatalf("winner=%s, want cpu", st.Winner)
	}
}

// TestCPUAlwaysLegal plays many random games and asserts the CPU never picks an illegal action.
func TestCPUAlwaysLegal(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	for i := 0; i < 300; i++ {
		p, _ := NewBoard(RandomPlacement(rng))
		c, _ := NewBoard(RandomPlacement(rng))
		st := NewState(p, c)
		for step := 0; st.Status == StatusInProgress; step++ {
			if step > 1000 {
				t.Fatal("game did not finish")
			}
			side := SidePlayer
			if step%2 == 1 {
				side = SideCPU
			}
			var a Action
			if side == SideCPU {
				a = st.DecideCPU(rng)
			} else {
				a = randomPlayerAction(rng, st.Boards[SidePlayer])
			}
			if _, err := st.Apply(side, a); err != nil {
				t.Fatalf("game %d step %d (%s): %v", i, step, side, err)
			}
		}
	}
}

func randomPlayerAction(rng *rand.Rand, b *Board) Action {
	for {
		s := b.Ships[rng.IntN(len(b.Ships))]
		if ts := b.AttackTargets(s.ID); len(ts) > 0 && rng.IntN(2) == 0 {
			return Action{ActionAttack, s.ID, ts[rng.IntN(len(ts))]}
		}
		if ts := b.MoveTargets(s.ID); len(ts) > 0 {
			return Action{ActionMove, s.ID, ts[rng.IntN(len(ts))]}
		}
	}
}

func TestCPUMemoryTracksMovedShip(t *testing.T) {
	var m CPUMemory
	hit := 1
	m.Observe(Result{Side: SideCPU, Type: ActionAttack, ShipID: 0, Target: &Pos{2, 2}, HitShipID: &hit})
	m.Observe(Result{Side: SidePlayer, Type: ActionMove, ShipID: 1, Direction: East, Distance: 2})
	if got := m.Known["1"]; got != (Pos{2, 4}) {
		t.Fatalf("known position = %v", got)
	}
}

func TestPlayerViewHidesEnemy(t *testing.T) {
	st := NewState(mustBoard(t, Pos{0, 0}, Pos{4, 4}, Pos{0, 4}), mustBoard(t, Pos{2, 2}, Pos{3, 3}, Pos{4, 0}))
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
