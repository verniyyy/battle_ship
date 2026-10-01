package game

import (
	"math/rand/v2"
	"slices"
)

// Hint says at least one enemy ship was within R cells of Pos.
type Hint struct {
	Pos Pos `json:"pos"`
	R   int `json:"r"`
}

// Memory is what one side has inferred about the other's fleet from public
// results, on top of the exact sightings in State.Intel.
type Memory struct {
	Hints []Hint `json:"hints"`
	// Cleared cells are believed to be empty.
	Cleared []Pos `json:"cleared"`
}

// observe updates both sides' memories with a public action result.
func (st *State) observe(r Result) {
	if r.Cancelled {
		return
	}
	for side, m := range st.Memory {
		if r.Side == side {
			m.ownResult(r)
			continue
		}
		switch r.Type {
		case ActionAttack:
			// Guns only reach so far from the ship that fired them.
			m.Hints = append(m.Hints, Hint{*r.Target, st.Boards[r.Side].Ships[r.ShipID].Spec.Rule().GunRange})
		case ActionSkill:
			// A sonar that found us was heard: the destroyer was right there.
			if r.Emitter != nil {
				m.Hints = append(m.Hints, Hint{*r.Emitter, 0})
			}
		case ActionMove:
			// We cannot tell which hints came from the moved ship, so forget them all.
			m.Hints = nil
			m.Cleared = nil
		}
	}
}

func (m *Memory) ownResult(r Result) {
	for _, s := range r.Shots {
		if s.HitShipID == nil {
			m.Cleared = append(m.Cleared, s.Target)
		}
		if s.Splash {
			m.Hints = append(m.Hints, Hint{s.Target, 1})
		} else {
			m.Cleared = append(m.Cleared, ring(s.Target, 1)...)
		}
	}
	if r.Origin != nil && len(r.Shots) == 0 {
		for _, p := range r.Paths {
			m.Cleared = append(m.Cleared, p...)
		}
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
}

// ring lists the cells at most r king moves from p, excluding p.
func ring(p Pos, r int) []Pos {
	out := []Pos{}
	for dr := -r; dr <= r; dr++ {
		for dc := -r; dc <= r; dc++ {
			if dr != 0 || dc != 0 {
				out = append(out, Pos{p.Row + dr, p.Col + dc})
			}
		}
	}
	return out
}

// heat estimates, per cell, how likely an enemy ship of side's sits there
// (100 = certain).
func (st *State) heat(side Side) map[Pos]float64 {
	h := map[Pos]float64{}
	enemy := st.Boards[side.Opponent()]
	for _, s := range st.Intel[side] {
		if enemy.Ships[s.ShipID].Alive() {
			h[s.Pos] += 100
		}
	}
	m := st.Memory[side]
	for _, hint := range m.Hints {
		cells := ring(hint.Pos, hint.R)
		if hint.R == 0 {
			cells = []Pos{hint.Pos}
		}
		for _, n := range cells {
			h[n] += 80 / float64(len(cells))
		}
	}
	for _, c := range m.Cleared {
		h[c] -= 20
	}
	return h
}

func pos(h map[Pos]float64, p Pos) float64 { return max(h[p], 0) }

// Decide picks side's next action from what that side knows. The CPU uses it
// every round; simulations use it for both fleets.
func (st *State) Decide(side Side, rng *rand.Rand) Action {
	st.syncWeather()
	own := st.Boards[side]
	enemy := st.Boards[side.Opponent()]
	h := st.heat(side)
	lvl := st.AI.Level
	if side == SidePlayer {
		lvl = 3
	}
	jitter := func() float64 { return rng.Float64() * 6 * float64(4-min(lvl, 3)) }
	// lock weighs a cell up when a scouting lock-on makes any hit there crit.
	lock := func(p Pos) float64 {
		if lvl >= 1 && st.lockedOn(side, p) {
			return critMult
		}
		return 1
	}
	aa := float64(aaScale) / float64(aaScale+enemy.AA())
	// A watch the enemy is seen standing intercepts every airstrike.
	guarded := false
	for _, seen := range st.Intel[side] {
		if enemy.Ships[seen.ShipID].onWatch() {
			guarded = true
		}
	}

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

	known := 0
	for _, s := range st.Intel[side] {
		if enemy.Ships[s.ShipID].Alive() {
			known++
		}
	}
	leads := known
	for _, v := range h {
		if v >= 8 {
			leads++
		}
	}

	// torpedoValue scores lanes by the first likely target in each. Torpedoes
	// are scarce and the wake gives the launcher away, so faint hints are ignored.
	torpedoValue := func(from Pos, lanes [][]Pos, power float64) float64 {
		sum := 0.0
		for _, lane := range lanes {
			for _, c := range lane {
				if v := pos(h, c); v >= 25 {
					p := power * lock(c)
					if from.Dist(c) <= pointBlank {
						p = power * critMult
					}
					sum += v / 100 * p
					break
				}
			}
		}
		return sum
	}

	flagship := -1
	for _, s := range own.Ships {
		if s.Alive() {
			flagship = s.ID
			break
		}
	}
	if st.Gauge[side] >= GaugeMax && flagship >= 0 {
		power := float64(own.ultimatePower())
		for _, c := range own.cells() {
			sum := 0.0
			for _, f := range Footprint(st.Size, ActionUltimate, "", "", Pos{}, c) {
				sum += pos(h, f) * float64(ultPct(c, f)) / 100
			}
			// Hold the barrage until there is something worth hitting, unless out of other options.
			if sum >= 30 || !own.canStrike(enemy) {
				consider(Action{ActionUltimate, flagship, c}, sum/100*power*1.2+10+jitter())
			}
		}
	}

	// Waiting for a lead can take forever — with nothing but torpedoes left, or
	// when neither fleet has found the other for a while. Then fire blind at
	// cells nobody has cleared yet.
	onlyTorps := true
	for _, s := range own.Ships {
		kind := s.Spec.SkillKind()
		if s.Alive() && (s.canGun() || (s.Skill > 0 && kind.Offensive() && kind != SkillSpread)) {
			onlyTorps = false
		}
	}
	idle := 0
	for i := len(st.History) - 1; i >= 0; i-- {
		if r := st.History[i]; r.Side == side {
			if len(r.Shots) > 0 || len(r.Scanned) > 0 {
				break
			}
			idle++
		}
	}
	blindMode := onlyTorps || idle >= 3
	blind := func(lanes ...[]Pos) float64 {
		if !blindMode {
			return 0
		}
		open := 0
		for _, lane := range lanes {
			for _, c := range lane {
				if h[c] > -20 {
					open++
				}
			}
		}
		return float64(open) * 5
	}

	for _, s := range own.Ships {
		if !s.Alive() {
			continue
		}
		sp := s.Spec
		for _, t := range own.AttackTargets(s.ID) {
			sc := 0.0
			cells := Footprint(st.Size, ActionAttack, "", sp.Class, s.Pos, t)
			for i, c := range cells {
				p := float64(sp.Firepower)
				if sp.Class == Battleship {
					p = p * float64(gunPct(i)) / 100
				}
				sc += pos(h, c) / 100 * p * lock(c)
			}
			sc = max(sc, blind(cells))
			if prev := st.LastGun[side]; prev != nil && *prev == t && (sp.Class == Battleship || sp.Class == Cruiser) && lvl >= 1 {
				sc *= critMult
			}
			// Prefer spending ammo from the best-stocked ship.
			consider(Action{ActionAttack, s.ID, t}, sc+jitter()+float64(s.Ammo))
		}
		for _, t := range own.TorpedoTargets(s.ID) {
			lanes := footprintLanes(st.Size, ActionTorpedo, "", sp.Class, s.Pos, t)
			sc := max(torpedoValue(s.Pos, lanes, float64(st.torpedoPower(sp))), blind(lanes...))
			if sc > 0 {
				// The wake gives the launcher away; weigh that against the hit.
				consider(Action{ActionTorpedo, s.ID, t}, sc*0.9+jitter()-8)
			}
		}
		kind := sp.SkillKind()
		for _, t := range own.SkillTargets(s.ID) {
			var sc float64
			switch kind {
			case SkillBarrage:
				for _, c := range Footprint(st.Size, ActionSkill, kind, sp.Class, s.Pos, t) {
					sc += pos(h, c) / 100 * float64(sp.Firepower) * barragePct / 100 * lock(c)
				}
				sc *= 0.9
			case SkillAirstrike:
				p := float64(st.airPower(sp))
				if st.tracking(side, t) && lvl >= 1 {
					sc = pos(h, t) / 100 * p * lock(t)
				} else {
					sc = max(pos(h, t)/100*p*aa, blind([]Pos{t})*2)
				}
				if guarded && lvl >= 1 {
					// Flying into a watch costs two sorties and gives the carrier away.
					sc = sc*interceptPct/100 - 20
				}
			case SkillSpread:
				lanes := footprintLanes(st.Size, ActionSkill, kind, sp.Class, s.Pos, t)
				sc = max(torpedoValue(s.Pos, lanes, float64(st.torpedoPower(sp))*spreadPct/100), blind(lanes...))*0.9 - 8
			case SkillFlare, SkillSonar:
				// Scouting pays off when we know little.
				if known > 0 && leads > 1 {
					continue
				}
				unknown := 0
				for _, c := range Footprint(st.Size, ActionSkill, kind, sp.Class, s.Pos, t) {
					if h[c] > -20 {
						unknown++
					}
				}
				sc = 25 + float64(unknown)*3 + float64(lvl)*4
			}
			if sc > 0 {
				consider(Action{ActionSkill, s.ID, t}, sc+jitter())
			}
		}
	}

	if a, sc, ok := st.watchValue(side, lvl); ok {
		consider(a, sc+jitter())
	}

	// A promising lead: take the shot.
	if best != nil && best.score >= 70 {
		return best.action
	}
	// A spotted submarine dives away; a badly hurt ship slips out of a known position.
	if a, ok := st.evade(side, rng, lvl); ok {
		return a
	}
	if best != nil && best.score > 25 && rng.Float64() < 0.55+0.1*float64(lvl) {
		return best.action
	}
	if a, ok := st.approach(side, h, rng); ok && (best == nil || rng.Float64() < 0.6) {
		return a
	}
	if best != nil {
		return best.action
	}
	if a, ok := st.randomMove(side, rng); ok {
		return a
	}
	if all := st.Actions(side); len(all) > 0 {
		return all[rng.IntN(len(all))]
	}
	// Nothing is legal; Resolve cancels this.
	return Action{Type: ActionMove, ShipID: max(flagship, 0)}
}

// Actions lists every legal action for side except the ultimate.
func (st *State) Actions(side Side) []Action {
	own := st.Boards[side]
	var out []Action
	for _, s := range own.Ships {
		add := func(t ActionType, targets []Pos) {
			for _, p := range targets {
				out = append(out, Action{t, s.ID, p})
			}
		}
		add(ActionAttack, own.AttackTargets(s.ID))
		add(ActionTorpedo, own.TorpedoTargets(s.ID))
		add(ActionMove, own.MoveTargets(s.ID))
		add(ActionSkill, own.SkillTargets(s.ID))
		add(ActionWatch, own.WatchTargets(s.ID))
	}
	return out
}

// watchValue scores standing anti-air watch: the airstrikes it could blunt
// while it holds, weighed up when the enemy carriers can bomb our ships
// precisely or have just bombed us. The ship with the fewest shells left
// stands it, since it cannot fire meanwhile.
func (st *State) watchValue(side Side, lvl int) (Action, float64, bool) {
	own, enemy := st.Boards[side], st.Boards[side.Opponent()]
	if lvl < 1 {
		return Action{}, 0, false
	}
	sorties, air := 0, 0
	for _, e := range enemy.Ships {
		if e.Alive() && e.Spec.SkillKind() == SkillAirstrike && e.Skill > 0 {
			sorties += e.Skill
			air = max(air, st.airPower(e.Spec))
		}
	}
	var by *Ship
	for _, s := range own.Ships {
		if len(own.WatchTargets(s.ID)) > 0 && (by == nil || s.Ammo < by.Ammo) {
			by = s
		}
	}
	if sorties == 0 || by == nil {
		return Action{}, 0, false
	}
	through := float64(aaScale) / float64(aaScale+own.AA())
	for _, seen := range st.Intel[side.Opponent()] {
		if own.Ships[seen.ShipID].Alive() {
			through = 1 // a tracked ship invites precision bombing
		}
	}
	sc := float64(min(sorties, watchRounds)*air) * through * (100 - interceptPct) / 100 * 0.12
	for i := len(st.History) - 1; i >= 0 && i >= len(st.History)-4; i-- {
		if r := st.History[i]; r.Side != side && r.Skill == SkillAirstrike {
			sc *= 1.5
			break
		}
	}
	return Action{ActionWatch, by.ID, by.Pos}, sc, true
}

// evade moves a ship the enemy is tracking when that is worth a turn:
// submarines (which vanish when they move) and badly damaged surface ships.
// Sharper CPUs know a ship still under way would move too late to dodge.
func (st *State) evade(side Side, rng *rand.Rand, lvl int) (Action, bool) {
	own := st.Boards[side]
	for _, seen := range st.Intel[side.Opponent()] {
		s := own.Ships[seen.ShipID]
		if !s.Alive() {
			continue
		}
		sub := s.Spec.Class == Submarine
		hurt := s.HP*100/s.Spec.HP < 35
		if (!sub && !hurt) || (s.Sailed > 0 && lvl >= 2) {
			continue
		}
		chance := 0.25 + 0.15*float64(lvl)
		if sub && s.Torps == 0 && s.Skill == 0 {
			chance = 1
		}
		if rng.Float64() >= chance {
			continue
		}
		var far []Pos
		for _, t := range own.MoveTargets(s.ID) {
			if t.Dist(seen.Pos) > 1 || sub {
				far = append(far, t)
			}
		}
		if len(far) > 0 {
			return Action{ActionMove, s.ID, far[rng.IntN(len(far))]}, true
		}
	}
	return Action{}, false
}

// approach closes in on where the enemy probably is, with the ship that has
// the most shells left, so that its guns come into range.
func (st *State) approach(side Side, h map[Pos]float64, rng *rand.Rand) (Action, bool) {
	own := st.Boards[side]
	var goal *Pos
	bestHeat := 0.0
	for p, v := range h {
		if v > bestHeat && p.InBounds(st.Size) {
			q := p
			goal, bestHeat = &q, v
		}
	}
	if goal == nil {
		c := Pos{st.Size / 2, st.Size / 2}
		goal = &c
	}
	var mover *Ship
	for _, s := range own.Ships {
		if s.Alive() && s.canGun() && len(own.MoveTargets(s.ID)) > 0 && s.Pos.Dist(*goal) > s.Spec.Rule().GunRange {
			if mover == nil || s.Ammo > mover.Ammo {
				mover = s
			}
		}
	}
	if mover == nil {
		return Action{}, false
	}
	var steps []Pos
	bestD := mover.Pos.Dist(*goal)
	for _, t := range own.MoveTargets(mover.ID) {
		switch d := t.Dist(*goal); {
		case d < bestD:
			steps, bestD = []Pos{t}, d
		case d == bestD && len(steps) > 0:
			steps = append(steps, t)
		}
	}
	if len(steps) == 0 {
		return Action{}, false
	}
	return Action{ActionMove, mover.ID, steps[rng.IntN(len(steps))]}, true
}

func (st *State) randomMove(side Side, rng *rand.Rand) (Action, bool) {
	own := st.Boards[side]
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

// RandomPlacement places n ships on distinct random cells of a size×size sea,
// keeping clear of the cells in avoid (the other fleet).
func RandomPlacement(rng *rand.Rand, size, n int, avoid ...Pos) []Pos {
	var free []Pos
	for _, c := range rng.Perm(size * size) {
		if p := (Pos{c / size, c % size}); !slices.Contains(avoid, p) {
			free = append(free, p)
		}
	}
	return free[:min(n, len(free))]
}
