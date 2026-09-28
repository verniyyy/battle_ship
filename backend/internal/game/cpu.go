package game

import (
	"math/rand/v2"
	"strconv"
)

// CPUMemory is what the CPU has deduced about the player's fleet from public results only.
type CPUMemory struct {
	// Known maps a player ship ID (as string, for JSON) to its last known position.
	Known map[string]Pos `json:"known"`
	// Hints are cells with at least one player ship in their 8 neighbours.
	Hints []Pos `json:"hints"`
	// Cleared cells are known to be empty.
	Cleared []Pos `json:"cleared"`
}

// Observe updates the CPU memory with a public action result.
func (m *CPUMemory) Observe(r Result) {
	if m.Known == nil {
		m.Known = map[string]Pos{}
	}
	switch {
	case r.Side == SideCPU && r.Type == ActionAttack:
		t := *r.Target
		if r.HitShipID != nil {
			key := strconv.Itoa(*r.HitShipID)
			if r.Sunk {
				delete(m.Known, key)
			} else {
				m.Known[key] = t
			}
		} else {
			m.Cleared = append(m.Cleared, t)
		}
		if r.Splash {
			m.Hints = append(m.Hints, t)
		} else {
			m.Cleared = append(m.Cleared, neighbours(t)...)
		}
	case r.Side == SidePlayer && r.Type == ActionAttack:
		// The attacking ship must be next to the target cell.
		m.Hints = append(m.Hints, *r.Target)
	case r.Side == SidePlayer && r.Type == ActionMove:
		key := strconv.Itoa(r.ShipID)
		if p, ok := m.Known[key]; ok {
			m.Known[key] = shift(p, r.Direction, r.Distance)
		}
		// We cannot tell which hints came from the moved ship, so forget them all.
		m.Hints = nil
		m.Cleared = nil
	}
}

func shift(p Pos, d Direction, n int) Pos {
	switch d {
	case North:
		p.Row -= n
	case South:
		p.Row += n
	case East:
		p.Col += n
	case West:
		p.Col -= n
	}
	return p
}

func neighbours(p Pos) []Pos {
	out := []Pos{}
	for dr := -1; dr <= 1; dr++ {
		for dc := -1; dc <= 1; dc++ {
			q := Pos{p.Row + dr, p.Col + dc}
			if (dr != 0 || dc != 0) && q.InBounds() {
				out = append(out, q)
			}
		}
	}
	return out
}

// score estimates how likely a player ship sits on p.
func (m *CPUMemory) score(p Pos) float64 {
	s := 0.0
	for _, k := range m.Known {
		if k == p {
			s += 100
		}
	}
	for _, h := range m.Hints {
		if h.Adjacent(p) {
			s += 10
		}
	}
	for _, c := range m.Cleared {
		if c == p {
			s -= 20
		}
	}
	return s
}

// DecideCPU picks the CPU's next action.
func (st *State) DecideCPU(rng *rand.Rand) Action {
	own := st.Boards[SideCPU]

	type cand struct {
		action Action
		score  float64
	}
	var attacks []cand
	for _, s := range own.Ships {
		for _, t := range own.AttackTargets(s.ID) {
			// Small jitter breaks ties; prefer spending ammo from the best-stocked ship.
			sc := st.CPU.score(t) + rng.Float64() + float64(s.Ammo)*0.05
			attacks = append(attacks, cand{Action{ActionAttack, s.ID, t}, sc})
		}
	}
	var best *cand
	for i := range attacks {
		if best == nil || attacks[i].score > best.score {
			best = &attacks[i]
		}
	}

	// A promising lead: take the shot.
	if best != nil && best.score >= 10 {
		return best.action
	}
	// If the player just found one of our ships, try to slip away.
	if len(st.History) > 0 {
		last := st.History[len(st.History)-1]
		if last.Side == SidePlayer && last.Type == ActionAttack && (last.HitShipID != nil || last.Splash) && rng.Float64() < 0.7 {
			if a, ok := st.evade(rng, *last.Target); ok {
				return a
			}
		}
	}
	if best != nil && best.score > 0 && rng.Float64() < 0.55 {
		return best.action
	}
	if a, ok := st.randomMove(rng); ok {
		return a
	}
	if best != nil {
		return best.action
	}
	// Unreachable while the game is in progress: a non-defeated side always has a living ship with ammo.
	return Action{Type: ActionMove}
}

func (st *State) evade(rng *rand.Rand, danger Pos) (Action, bool) {
	own := st.Boards[SideCPU]
	for _, s := range own.Ships {
		if !s.Alive() || (s.Pos != danger && !s.Pos.Adjacent(danger)) {
			continue
		}
		var safe []Pos
		for _, t := range own.MoveTargets(s.ID) {
			if t != danger && !t.Adjacent(danger) {
				safe = append(safe, t)
			}
		}
		if len(safe) > 0 {
			return Action{ActionMove, s.ID, safe[rng.IntN(len(safe))]}, true
		}
	}
	return Action{}, false
}

func (st *State) randomMove(rng *rand.Rand) (Action, bool) {
	own := st.Boards[SideCPU]
	var ids []int
	for _, s := range own.Ships {
		if s.Alive() && len(own.MoveTargets(s.ID)) > 0 {
			ids = append(ids, s.ID)
		}
	}
	if len(ids) == 0 {
		return Action{}, false
	}
	id := ids[rng.IntN(len(ids))]
	ts := own.MoveTargets(id)
	return Action{ActionMove, id, ts[rng.IntN(len(ts))]}, true
}

// RandomPlacement places the fleet on distinct random cells.
func RandomPlacement(rng *rand.Rand) []Pos {
	cells := rng.Perm(BoardSize * BoardSize)[:len(Fleet)]
	out := make([]Pos, len(cells))
	for i, c := range cells {
		out[i] = Pos{c / BoardSize, c % BoardSize}
	}
	return out
}
