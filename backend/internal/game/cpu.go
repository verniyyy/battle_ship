package game

import (
	"math/rand/v2"
)

// CPUMemory is what the CPU has inferred about the player's fleet from public
// results, on top of the exact sightings in State.Intel.
type CPUMemory struct {
	// Hints are cells with at least one player ship in their 8 neighbours.
	Hints []Pos `json:"hints"`
	// Cleared cells are believed to be empty.
	Cleared []Pos `json:"cleared"`
}

// Observe updates the CPU memory with a public action result.
func (m *CPUMemory) Observe(r Result) {
	switch {
	case r.Side == SideCPU:
		for _, s := range r.Shots {
			if s.HitShipID == nil {
				m.Cleared = append(m.Cleared, s.Target)
			}
			if s.Splash {
				m.Hints = append(m.Hints, s.Target)
			} else {
				m.Cleared = append(m.Cleared, neighbours(s.Target)...)
			}
		}
		if r.Skill == SkillTorpedo && len(r.Shots) == 0 {
			m.Cleared = append(m.Cleared, r.Path...)
		}
		for _, c := range r.Scanned {
			found := false
			for _, s := range r.Revealed {
				found = found || s.Pos == c
			}
			if !found {
				m.Cleared = append(m.Cleared, c)
			}
		}
	case r.Type == ActionAttack:
		// A gun can only reach the 8 cells around the ship that fired it.
		m.Hints = append(m.Hints, *r.Target)
	case r.Type == ActionMove:
		// We cannot tell which hints came from the moved ship, so forget them all.
		m.Hints = nil
		m.Cleared = nil
	}
}

func neighbours(p Pos) []Pos {
	out := []Pos{}
	for dr := -1; dr <= 1; dr++ {
		for dc := -1; dc <= 1; dc++ {
			if dr != 0 || dc != 0 {
				out = append(out, Pos{p.Row + dr, p.Col + dc})
			}
		}
	}
	return out
}

// heat estimates, per cell, how likely a player ship sits there.
func (st *State) heat() map[Pos]float64 {
	h := map[Pos]float64{}
	for _, s := range st.Intel[SideCPU] {
		if ship := st.Boards[SidePlayer].Ships[s.ShipID]; ship.Alive() {
			h[s.Pos] += 100
		}
	}
	for _, hint := range st.CPU.Hints {
		for _, n := range neighbours(hint) {
			h[n] += 10
		}
	}
	for _, c := range st.CPU.Cleared {
		h[c] -= 20
	}
	return h
}

func sumHeat(h map[Pos]float64, cells []Pos) float64 {
	s := 0.0
	for _, c := range cells {
		s += max(h[c], 0)
	}
	return s
}

// DecideCPU picks the CPU's next action.
func (st *State) DecideCPU(rng *rand.Rand) Action {
	own := st.Boards[SideCPU]
	h := st.heat()
	lvl := st.AI.Level
	jitter := func() float64 { return rng.Float64() * float64(4-min(lvl, 3)) }

	type cand struct {
		action Action
		score  float64
	}
	var best *cand
	consider := func(a Action, sc float64) {
		if best == nil || sc > best.score {
			best = &cand{a, sc}
		}
	}

	leads := 0
	for _, v := range h {
		if v >= 10 {
			leads++
		}
	}

	flagship := -1
	for _, s := range own.Ships {
		if s.Alive() {
			flagship = s.ID
			break
		}
	}
	if st.Gauge[SideCPU] >= GaugeMax && flagship >= 0 {
		for _, c := range own.cells() {
			sc := sumHeat(h, Footprint(st.Size, ActionUltimate, "", Pos{}, c))
			// Hold the barrage until there is something worth hitting, unless out of other options.
			if sc >= 20 || !own.canStrike() {
				consider(Action{ActionUltimate, flagship, c}, sc*1.3+10+jitter())
			}
		}
	}

	for _, s := range own.Ships {
		if !s.Alive() {
			continue
		}
		for _, t := range own.AttackTargets(s.ID) {
			// Prefer spending ammo from the best-stocked ship.
			consider(Action{ActionAttack, s.ID, t}, h[t]+jitter()+float64(s.Ammo)*0.05)
		}
		kind := s.Spec.SkillKind()
		for _, t := range own.SkillTargets(s.ID) {
			cells := Footprint(st.Size, ActionSkill, kind, s.Pos, t)
			var sc float64
			switch kind {
			case SkillBarrage:
				sc = sumHeat(h, cells) * 0.9
			case SkillAirstrike:
				sc = h[t] * 0.95
			case SkillTorpedo:
				for _, c := range cells {
					sc = max(sc, h[c]*0.9)
				}
			case SkillFlare, SkillSonar:
				// Scouting pays off when we know little.
				if leads > 0 {
					continue
				}
				unknown := 0
				for _, c := range cells {
					if h[c] > -20 {
						unknown++
					}
				}
				sc = 4 + float64(unknown)*0.6 + float64(lvl)
			}
			consider(Action{ActionSkill, s.ID, t}, sc+jitter())
		}
	}

	// A promising lead: take the shot.
	if best != nil && best.score >= 10 {
		return best.action
	}
	// If the player just found one of our ships, try to slip away.
	if len(st.History) > 0 {
		last := st.History[len(st.History)-1]
		if last.Side == SidePlayer && last.Target != nil && threatened(last) && rng.Float64() < 0.55+0.1*float64(lvl) {
			if a, ok := st.evade(rng, *last.Target); ok {
				return a
			}
		}
	}
	if best != nil && best.score > 0 && rng.Float64() < 0.5+0.1*float64(lvl) {
		return best.action
	}
	if a, ok := st.randomMove(rng); ok {
		return a
	}
	if best != nil {
		return best.action
	}
	// Unreachable while the game is in progress: a living ship can always move
	// or, failing that, strike.
	return Action{Type: ActionMove}
}

func threatened(r Result) bool {
	for _, s := range r.Shots {
		if s.HitShipID != nil || s.Splash {
			return true
		}
	}
	return len(r.Revealed) > 0
}

func (st *State) evade(rng *rand.Rand, danger Pos) (Action, bool) {
	own := st.Boards[SideCPU]
	for _, s := range own.Ships {
		if !s.Alive() || s.Pos.Dist(danger) > 1 {
			continue
		}
		var safe []Pos
		for _, t := range own.MoveTargets(s.ID) {
			if t.Dist(danger) > 1 {
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

// RandomPlacement places n ships on distinct random cells of a size×size sea.
func RandomPlacement(rng *rand.Rand, size, n int) []Pos {
	cells := rng.Perm(size * size)[:n]
	out := make([]Pos, n)
	for i, c := range cells {
		out[i] = Pos{c / size, c % size}
	}
	return out
}
