package meta

import (
	"fmt"
	"math/rand/v2"
	"os"
	"strings"
	"testing"

	"github.com/verniyyy/battle_ship/backend/internal/game"
)

// simFleet is a representative fleet for a stage: the starter trio early on,
// a mixed four-ship fleet later, at a level a steady player would have.
func simFleet(stage Stage) []game.Spec {
	cards := []string{"bb_kurogane", "dd_asanagi", "ss_senryu"}
	lv := 1 + 3*(stage.Area-1) + stage.No
	if stage.Area >= 2 {
		cards = []string{"bb_kurogane", "ca_shirasagi", "dd_asanagi", "cv_kosame"}
	}
	if stage.Area >= 3 {
		cards = []string{"bb_tsurugi", "ca_soyo", "dd_hayate", "cv_hoyoku"}
		lv += 4
	}
	if stage.Area >= 4 {
		cards = []string{"bb_guren", "ca_raimei", "dd_byakuya", "cv_amagi"}
		lv += 4
	}
	out := make([]game.Spec, len(cards))
	for i, c := range cards {
		out[i] = (&OwnedShip{Card: c, Level: lv}).Spec()
	}
	return out
}

type simResult struct {
	wins, rounds, judged, playerOut, cpuOut int
	specials                                map[game.Special]int
	// quiet counts rounds in which neither fleet dealt damage, opening the
	// rounds before the first damage, and lastRounds the rounds played while
	// the CPU was down to its last ship.
	quiet, opening, lastRounds int
	// ults counts the player's all-fleet barrages, ultDmg the damage they
	// dealt and cpuUlts the CPU's.
	ults, ultDmg, cpuUlts int
}

// kiteSide is the fleet, if any, that runs from every sighting instead of trading.
type kiteSide int

const (
	noKite kiteSide = iota
	playerKites
	cpuKites
)

// kite replaces a with a run by one of side's spotted ships, if any can move:
// the old "keep moving" strategy.
func kite(st *game.State, side game.Side, a game.Action, r *rand.Rand) game.Action {
	if a.Type == game.ActionMove {
		return a
	}
	for _, seen := range st.Intel[side.Opponent()] {
		if ts := st.Boards[side].MoveTargets(seen.ShipID); len(ts) > 0 {
			return game.Action{Type: game.ActionMove, ShipID: seen.ShipID, Target: ts[r.IntN(len(ts))]}
		}
	}
	return a
}

// simulate plays n battles of stage. The player side is driven by the AI at
// its sharpest; k makes one fleet run from every sighting instead of trading.
func simulate(stage Stage, n int, k kiteSide, seed uint64) simResult {
	r := rand.New(rand.NewPCG(seed, 11))
	res := simResult{specials: map[game.Special]int{}}
	for i := 0; i < n; i++ {
		fleet := simFleet(stage)
		placements := game.RandomPlacement(r, stage.Size, len(fleet))
		p, _ := game.NewBoard(stage.Size, fleet, placements)
		enemies := stage.EnemySpecs()
		c, _ := game.NewBoard(stage.Size, enemies, game.RandomPlacement(r, stage.Size, len(enemies), placements...))
		st := game.NewState(p, c, stage.MaxTurns, game.AI{Level: stage.AI}, rollWeather(r))
		engaged := false
		for st.Status == game.StatusInProgress {
			a, c := st.Decide(game.SidePlayer, r), st.Decide(game.SideCPU, r)
			switch k {
			case playerKites:
				a = kite(st, game.SidePlayer, a, r)
			case cpuKites:
				c = kite(st, game.SideCPU, c, r)
			}
			last := alive(st.Boards[game.SideCPU]) == 1
			dealt := 0
			for _, h := range st.Resolve(map[game.Side]game.Action{game.SidePlayer: a, game.SideCPU: c}, r) {
				dealt += h.Damage()
			}
			if dealt == 0 {
				res.quiet++
				if !engaged {
					res.opening++
				}
			}
			engaged = engaged || dealt > 0
			if last {
				res.lastRounds++
			}
		}
		for _, h := range st.History {
			if h.Special != "" && h.Side == game.SidePlayer {
				res.specials[h.Special]++
			}
			if h.Type == game.ActionUltimate {
				if h.Side == game.SidePlayer {
					res.ults++
					res.ultDmg += h.Damage()
				} else {
					res.cpuUlts++
				}
			}
		}
		if st.Winner == game.SidePlayer {
			res.wins++
		}
		res.rounds += st.Turn
		switch st.EndReason {
		case game.EndJudgment:
			res.judged++
		case game.EndDisarmed:
			if st.Winner == game.SidePlayer {
				res.cpuOut++
			} else {
				res.playerOut++
			}
		}
	}
	return res
}

// TestSimulateBalance prints a balance report for every campaign stage.
// It is opt-in: SIM=1 go test ./internal/meta -run Simulate -v
func TestSimulateBalance(t *testing.T) {
	if os.Getenv("SIM") == "" {
		t.Skip("set SIM=1 to run the balance simulation")
	}
	const n = 400
	var b strings.Builder
	fmt.Fprintf(&b, "\n%-5s %6s %6s %6s %6s %6s %6s %6s %6s %6s %6s | %6s %6s | %6s %6s  specials\n", "stage", "win%", "rounds", "quiet%", "open", "last", "judge%", "pOut%", "cOut%", "star", "limit", "kite%", "kRnds", "eKite%", "eRnds")
	for i, s := range Stages {
		a := simulate(s, n, noKite, uint64(i))
		k := simulate(s, n, playerKites, uint64(i))
		e := simulate(s, n, cpuKites, uint64(i))
		fmt.Fprintf(&b, "%-5s %6.1f %6.1f %6.1f %6.1f %6.1f %6.1f %6.1f %6.1f %6d %6d | %6.2f %6.0f %6.2f | %6.1f %6.1f | %6.1f %6.1f  %v\n", s.ID,
			pct(a.wins, n), float64(a.rounds)/n, pct(a.quiet, a.rounds), float64(a.opening)/n, float64(a.lastRounds)/n, pct(a.judged, n), pct(a.playerOut, n), pct(a.cpuOut, n), s.StarTurns, s.MaxTurns,
			float64(a.ults)/n, float64(a.ultDmg)/float64(max(a.ults, 1)), float64(a.cpuUlts)/n,
			pct(k.wins, n), float64(k.rounds)/n, pct(e.wins, n), float64(e.rounds)/n, a.specials)
	}
	t.Log(b.String())
}

func pct(a, n int) float64 { return 100 * float64(a) / float64(n) }

func alive(b *game.Board) int {
	n := 0
	for _, s := range b.Ships {
		if s.Alive() {
			n++
		}
	}
	return n
}
