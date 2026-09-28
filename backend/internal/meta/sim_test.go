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
}

// simulate plays n battles of stage. The player side is driven by the AI at
// its sharpest; kite makes it run from every sighting instead of trading.
func simulate(stage Stage, n int, kite bool, seed uint64) simResult {
	r := rand.New(rand.NewPCG(seed, 11))
	res := simResult{specials: map[game.Special]int{}}
	for i := 0; i < n; i++ {
		fleet := simFleet(stage)
		p, _ := game.NewBoard(stage.Size, fleet, game.RandomPlacement(r, stage.Size, len(fleet)))
		enemies := stage.EnemySpecs()
		c, _ := game.NewBoard(stage.Size, enemies, game.RandomPlacement(r, stage.Size, len(enemies)))
		st := game.NewState(p, c, stage.MaxTurns, game.AI{Level: stage.AI}, rollWeather(r))
		for st.Status == game.StatusInProgress {
			a := st.Decide(game.SidePlayer, r)
			if kite && a.Type != game.ActionMove {
				// Run whenever a spotted ship can: the old "keep moving" strategy.
				for _, seen := range st.Intel[game.SideCPU] {
					if ts := st.Boards[game.SidePlayer].MoveTargets(seen.ShipID); len(ts) > 0 {
						a = game.Action{Type: game.ActionMove, ShipID: seen.ShipID, Target: ts[r.IntN(len(ts))]}
						break
					}
				}
			}
			st.Resolve(map[game.Side]game.Action{game.SidePlayer: a, game.SideCPU: st.Decide(game.SideCPU, r)}, r)
		}
		for _, h := range st.History {
			if h.Special != "" && h.Side == game.SidePlayer {
				res.specials[h.Special]++
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
	fmt.Fprintf(&b, "\n%-5s %6s %6s %6s %6s %6s %6s %6s | %6s %6s  specials\n", "stage", "win%", "rounds", "judge%", "pOut%", "cOut%", "star", "limit", "kite%", "kRnds")
	for i, s := range Stages {
		a := simulate(s, n, false, uint64(i))
		k := simulate(s, n, true, uint64(i))
		fmt.Fprintf(&b, "%-5s %6.1f %6.1f %6.1f %6.1f %6.1f %6d %6d | %6.1f %6.1f  %v\n", s.ID,
			pct(a.wins, n), float64(a.rounds)/n, pct(a.judged, n), pct(a.playerOut, n), pct(a.cpuOut, n), s.StarTurns, s.MaxTurns,
			pct(k.wins, n), float64(k.rounds)/n, a.specials)
	}
	t.Log(b.String())
}

func pct(a, n int) float64 { return 100 * float64(a) / float64(n) }
