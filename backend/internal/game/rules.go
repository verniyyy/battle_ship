package game

import (
	"fmt"
	"math/rand/v2"
	"slices"
	"strconv"
)

// Tuning for how actions turn power into damage.
const (
	critMult      = 2   // critical hits double the damage
	rollSpread    = 15  // damage rolls within ±15% of the power
	centerPct     = 130 // battleship shell on the aim point
	armCellPct    = 40  // battleship shells landing beside the aim point
	barragePct    = 70  // per cell of the battleship barrage
	spreadPct     = 80  // per torpedo of a submarine spread
	ultCenterPct  = 150 // all-fleet barrage on the aim point
	ultInnerPct   = 100 // all-fleet barrage on the 3×3 around it
	ultOuterPct   = 60  // all-fleet barrage on its outer reach
	antiSubMult   = 2   // destroyer guns on submarines
	aaScale       = 200 // aircraft damage × aaScale / (aaScale + fleet AA)
	airEvasionDiv = 4   // aircraft are hard to dodge
	pointBlank    = 2   // torpedo hits this close always crit
	pinRounds     = 2   // a water column holds for the rest of this round and the next
	sailRounds    = 2   // a ship that moved is under way for the rest of this round and the next
	reconAfter    = 3   // quiet rounds before scout planes report an enemy ship
	markRounds    = 2   // a scouting lock-on holds for the rest of this round and the next
)

// Gauge gains. Shooting gains are scaled by the running combo.
const (
	gaugeHit    = 14
	gaugeSink   = 22
	gaugeSplash = 5
	gaugeScout  = 15
	gaugeHurt   = 12
)

// strike describes one weapon landing on the enemy fleet.
type strike struct {
	power     int
	crit      int  // percent
	forceCrit bool // spotting fire and point-blank torpedoes
	// evadeDiv divides the target's evasion: 1 normal, 4 aircraft; 0 means unavoidable.
	evadeDiv  int
	halfArmor bool // torpedoes strike below the belt
	aircraft  bool // reduced by the defending fleet's anti-air
	antiSub   bool // destroyer guns hit submarines harder
}

// Legal reports whether side may take action a right now.
func (st *State) Legal(side Side, a Action) error {
	if st.Status != StatusInProgress {
		return ErrGameOver
	}
	own := st.Boards[side]
	ship, err := own.ship(a.ShipID)
	if err != nil {
		return err
	}
	if !ship.Alive() {
		return fmt.Errorf("%w: ship %d is sunk", ErrInvalidAction, a.ShipID)
	}
	t := a.Target
	if !t.InBounds(st.Size) {
		return fmt.Errorf("%w: target (%d,%d) is off the sea", ErrInvalidAction, t.Row, t.Col)
	}
	var targets []Pos
	switch a.Type {
	case ActionAttack:
		targets = own.AttackTargets(a.ShipID)
	case ActionTorpedo:
		targets = own.TorpedoTargets(a.ShipID)
	case ActionMove:
		targets = own.MoveTargets(a.ShipID)
	case ActionSkill:
		targets = own.SkillTargets(a.ShipID)
	case ActionUltimate:
		if st.Gauge[side] < GaugeMax {
			return fmt.Errorf("%w: gauge is not full", ErrInvalidAction)
		}
		return nil
	default:
		return fmt.Errorf("%w: unknown action type %q", ErrInvalidAction, a.Type)
	}
	if !slices.Contains(targets, t) {
		return fmt.Errorf("%w: ship %d cannot %s (%d,%d)", ErrInvalidAction, a.ShipID, a.Type, t.Row, t.Col)
	}
	return nil
}

// Apply executes one action for side and returns its public result. rng
// rolls damage, critical hits and evasion. Rounds are driven by Round; Apply
// on its own resolves a single action.
func (st *State) Apply(side Side, a Action, rng *rand.Rand) (Result, error) {
	if err := st.Legal(side, a); err != nil {
		return Result{}, err
	}
	st.syncWeather()
	ship := st.Boards[side].Ships[a.ShipID]
	sp := ship.Spec
	t := a.Target
	res := Result{Side: side, Type: a.Type, ShipID: a.ShipID, Round: st.Turn + 1, Speed: sp.Speed, Late: a.Late(ship)}
	gun := func() strike {
		return strike{power: sp.Firepower, crit: sp.Crit, evadeDiv: 1, antiSub: sp.Class == Destroyer}
	}
	torpedo := func(pct int) strike {
		return strike{power: st.torpedoPower(sp) * pct / 100, crit: sp.Crit, evadeDiv: 1, halfArmor: true}
	}
	var lastGun *Pos

	switch a.Type {
	case ActionAttack:
		ship.Ammo--
		res.Target = &t
		lastGun = &t
		s := gun()
		if prev := st.LastGun[side]; prev != nil && *prev == t && (sp.Class == Battleship || sp.Class == Cruiser) {
			res.Special = SpecialSpotting
			s.forceCrit = true
		}
		for i, c := range Footprint(st.Size, ActionAttack, "", sp.Class, ship.Pos, t) {
			cs := s
			if sp.Class == Battleship {
				cs.power = s.power * gunPct(i) / 100
			}
			res.Shots = append(res.Shots, st.fire(side, c, cs, rng))
		}
		if sp.Class == Battleship {
			st.waterColumns(side, &res)
		}

	case ActionTorpedo:
		ship.Torps--
		st.launch(side, ship, &res, ActionTorpedo, "", t, torpedo(100), rng)

	case ActionMove:
		dest, blocked := st.sail(side, ship, t)
		res.Blocked = blocked
		if sp.Class == Submarine {
			res.Hidden = true
		} else {
			res.Direction, _ = direction(ship.Pos, t)
			res.Distance = ship.Pos.Dist(dest)
		}
		ship.Pos = dest
		ship.Sailed = sailRounds

	case ActionSkill:
		ship.Skill--
		kind := sp.SkillKind()
		res.Skill = kind
		switch kind {
		case SkillBarrage:
			res.Target = &t
			lastGun = &t
			s := gun()
			s.power = s.power * barragePct / 100
			for _, c := range Footprint(st.Size, ActionSkill, kind, sp.Class, ship.Pos, t) {
				res.Shots = append(res.Shots, st.fire(side, c, s, rng))
			}
			st.waterColumns(side, &res)
		case SkillAirstrike:
			res.Target = &t
			s := strike{power: st.airPower(sp), crit: sp.Crit, evadeDiv: airEvasionDiv, aircraft: true}
			if st.Weather == Fog {
				s.evadeDiv = 1
			}
			if st.tracking(side, t) {
				res.Special = SpecialPrecision
				s.evadeDiv, s.aircraft = 0, false
			}
			res.Shots = []Shot{st.fire(side, t, s, rng)}
		case SkillSpread:
			st.launch(side, ship, &res, ActionSkill, kind, t, torpedo(spreadPct), rng)
		case SkillFlare, SkillSonar:
			res.Target = &t
			cells := Footprint(st.Size, ActionSkill, kind, sp.Class, ship.Pos, t)
			res.Scanned = cells
			for _, e := range st.Boards[side.Opponent()].Ships {
				if e.Alive() && slices.Contains(cells, e.Pos) && (kind == SkillSonar || e.Spec.Surface()) {
					res.Revealed = append(res.Revealed, Sighting{ShipID: e.ID, Pos: e.Pos, Turn: st.Turn + 1})
					e.Marked = markRounds
				}
			}
		}

	case ActionUltimate:
		// Every gun in the fleet at once: armour-piercing, impossible to dodge,
		// and the misses throw up water columns like a battleship's.
		st.Gauge[side] = 0
		res.Target = &t
		s := strike{power: st.Boards[side].ultimatePower(), halfArmor: true}
		for _, c := range Footprint(st.Size, ActionUltimate, "", sp.Class, ship.Pos, t) {
			cs := s
			cs.power = s.power * ultPct(t, c) / 100
			res.Shots = append(res.Shots, st.fire(side, c, cs, rng))
		}
		st.waterColumns(side, &res)
	}

	// The all-fleet barrage keeps its own cut-in: locked-on shells still crit,
	// but the finishing move is never billed as a mere locked-on shot.
	if res.Special == "" && a.Type != ActionUltimate && slices.ContainsFunc(res.Shots, func(s Shot) bool { return s.Marked && s.Damage > 0 }) {
		res.Special = SpecialMarked
	}
	st.LastGun[side] = lastGun
	st.score(side, &res)
	st.learn(res)
	res.Contact = st.sense(res.Round)
	st.History = append(st.History, res)
	st.observe(res)
	st.checkEnd(side)
	return res, nil
}

// gunPct is the share of firepower the i-th shell of a battleship salvo
// carries: the aim point takes the heaviest shell, the four around it less.
func gunPct(i int) int {
	if i == 0 {
		return centerPct
	}
	return armCellPct
}

// ultPct is the share of the all-fleet barrage's power landing on cell c of
// a barrage aimed at aim.
func ultPct(aim, c Pos) int {
	switch aim.Dist(c) {
	case 0:
		return ultCenterPct
	case 1:
		return ultInnerPct
	}
	return ultOuterPct
}

// launch runs torpedoes from ship along the lanes of its aim. Each stops at
// the first surface ship in its lane; submarines run too deep to be hit.
func (st *State) launch(side Side, ship *Ship, res *Result, t ActionType, kind SkillKind, aim Pos, s strike, rng *rand.Rand) {
	origin := ship.Pos
	res.Target = &aim
	res.Origin = &origin
	enemy := st.Boards[side.Opponent()]
	for _, lane := range footprintLanes(st.Size, t, kind, ship.Spec.Class, origin, aim) {
		var path []Pos
		for _, c := range lane {
			path = append(path, c)
			if e := enemy.shipAt(c); e != nil && e.Spec.Surface() {
				ls := s
				if origin.Dist(c) <= pointBlank {
					ls.forceCrit = true
					res.Special = SpecialPointBlank
				}
				res.Shots = append(res.Shots, st.fire(side, c, ls, rng))
				break
			}
		}
		res.Paths = append(res.Paths, path)
	}
}

// sail steers ship toward t one cell at a time. Two ships never share a
// cell, so it stops short of the first enemy ship in its way, on the last
// cell no friendly ship holds, and reports that it was blocked.
func (st *State) sail(side Side, ship *Ship, t Pos) (Pos, bool) {
	own, enemy := st.Boards[side], st.Boards[side.Opponent()]
	d, n := direction(ship.Pos, t)
	stop := ship.Pos
	for i := 1; i <= n; i++ {
		c := shift(ship.Pos, d, i)
		if enemy.shipAt(c) != nil {
			return stop, true
		}
		if own.shipAt(c) == nil {
			stop = c
		}
	}
	return stop, false
}

// sense lets enemy ships side by side along a row or column spot each other.
// It reports whether either side made a new contact.
func (st *State) sense(turn int) bool {
	found := false
	spot := func(side Side, s *Ship) {
		k := key(s.ID)
		if seen, ok := st.Intel[side][k]; !ok || seen.Pos != s.Pos {
			found = true
		}
		st.Intel[side][k] = Sighting{ShipID: s.ID, Pos: s.Pos, Turn: turn}
	}
	for _, a := range st.Boards[SidePlayer].Ships {
		for _, b := range st.Boards[SideCPU].Ships {
			if a.Alive() && b.Alive() && a.Pos.Beside(b.Pos) {
				spot(SidePlayer, b)
				spot(SideCPU, a)
			}
		}
	}
	return found
}

// waterColumns pins every surface ship next to a heavy shell (a battleship's
// or the all-fleet barrage's) that missed.
func (st *State) waterColumns(side Side, res *Result) {
	enemy := st.Boards[side.Opponent()]
	hit := map[int]bool{}
	for _, sh := range res.Shots {
		if sh.HitShipID != nil && sh.Damage > 0 {
			hit[*sh.HitShipID] = true
		}
	}
	for _, sh := range res.Shots {
		if sh.Damage > 0 {
			continue
		}
		column := false
		for _, e := range enemy.Ships {
			if e.Alive() && e.Spec.Surface() && !hit[e.ID] && e.Pos.Dist(sh.Target) <= 1 {
				e.Pinned = pinRounds
				column = true
			}
		}
		if column {
			res.Columns = append(res.Columns, sh.Target)
		}
	}
}

func (st *State) torpedoPower(sp Spec) int {
	switch st.Weather {
	case Storm:
		return sp.Torpedo * 3 / 4
	case Night:
		return sp.Torpedo * 5 / 4
	}
	return sp.Torpedo
}

func (st *State) airPower(sp Spec) int {
	if st.Weather == Night {
		return sp.Air / 2
	}
	return sp.Air
}

// ultimatePower is the per-cell power of the all-fleet barrage: the average
// best weapon of the living fleet.
func (b *Board) ultimatePower() int {
	sum, n := 0, 0
	for _, s := range b.Ships {
		if s.Alive() {
			sum += max(s.Spec.Firepower, s.Spec.Torpedo, s.Spec.Air)
			n++
		}
	}
	if n == 0 {
		return 0
	}
	return sum / n
}

// tracking reports whether side has a living enemy ship located at p.
func (st *State) tracking(side Side, p Pos) bool {
	enemy := st.Boards[side.Opponent()]
	for _, s := range st.Intel[side] {
		if s.Pos == p && enemy.Ships[s.ShipID].Alive() && enemy.Ships[s.ShipID].Pos == p {
			return true
		}
	}
	return false
}

// lockedOn reports whether side tracks, at p, an enemy ship its scouting has
// locked on to: shots there cannot miss and always crit.
func (st *State) lockedOn(side Side, p Pos) bool {
	s := st.Boards[side.Opponent()].shipAt(p)
	return s != nil && s.Marked > 0 && st.tracking(side, p)
}

// fire lands one strike from side on cell t.
func (st *State) fire(side Side, t Pos, s strike, rng *rand.Rand) Shot {
	enemy := st.Boards[side.Opponent()]
	sh := Shot{Target: t}
	if hit := enemy.shipAt(t); hit != nil {
		id := hit.ID
		sh.HitShipID = &id
		if hit.Marked > 0 {
			sh.Marked = true
			s.forceCrit, s.evadeDiv = true, 0
		}
		evasion := hit.Spec.Evasion
		if st.Weather == Fog {
			evasion += 10
		}
		if s.evadeDiv > 0 && rng.IntN(100) < evasion/s.evadeDiv {
			sh.Evaded = true
		} else {
			sh.Damage, sh.Crit = st.damage(s, hit, enemy, rng)
			hit.HP = max(hit.HP-sh.Damage, 0)
			sh.Sunk = !hit.Alive()
		}
	}
	for _, e := range enemy.Ships {
		if e.Alive() && e.Spec.Surface() && e.Pos.Adjacent(t) {
			sh.Splash = true
		}
	}
	return sh
}

func (st *State) damage(s strike, target *Ship, fleet *Board, rng *rand.Rand) (int, bool) {
	dmg := float64(s.power) * float64(100-rollSpread+rng.IntN(2*rollSpread+1)) / 100
	crit := s.forceCrit || (s.crit > 0 && rng.IntN(100) < s.crit)
	if crit {
		dmg *= critMult
	}
	if s.antiSub && target.Spec.Class == Submarine {
		dmg *= antiSubMult
	}
	armor := target.Spec.Armor
	if s.halfArmor {
		armor /= 2
	}
	dmg = dmg * float64(100-armor) / 100
	if s.aircraft {
		dmg = dmg * aaScale / float64(aaScale+fleet.AA())
	}
	return max(int(dmg+0.5), 1), crit
}

// score updates combos and gauges after an action.
func (st *State) score(side Side, res *Result) {
	hits, sinks, splash := 0, 0, false
	for _, s := range res.Shots {
		if s.Damage > 0 {
			hits++
		}
		if s.Sunk {
			sinks++
		}
		splash = splash || s.Splash
	}
	opp := side.Opponent()
	st.Gauge[opp] = min(st.Gauge[opp]+hits*gaugeHurt, GaugeMax)

	switch {
	case hits > 0 || len(res.Revealed) > 0:
		st.Combo[side]++
	case res.Type == ActionMove:
		// Repositioning keeps the streak alive but does not extend it.
	default:
		st.Combo[side] = 0
	}
	st.MaxCombo[side] = max(st.MaxCombo[side], st.Combo[side])

	if res.Type != ActionUltimate {
		gain := hits*gaugeHit + sinks*gaugeSink + len(res.Revealed)*gaugeScout
		if hits == 0 && splash {
			gain += gaugeSplash
		}
		if c := st.Combo[side]; c > 1 {
			gain = gain * (10 + 3*(c-1)) / 10
		}
		st.Gauge[side] = min(st.Gauge[side]+gain, GaugeMax)
	}
	res.Combo = st.Combo[side]
	res.Gauge = st.Gauge[side]
}

func key(id int) string { return strconv.Itoa(id) }

// learn updates both sides' intel from a public result.
func (st *State) learn(r Result) {
	mine, theirs := st.Intel[r.Side], st.Intel[r.Side.Opponent()]
	for _, s := range r.Shots {
		if s.HitShipID == nil {
			continue
		}
		if s.Sunk {
			delete(mine, key(*s.HitShipID))
		} else {
			mine[key(*s.HitShipID)] = Sighting{ShipID: *s.HitShipID, Pos: s.Target, Turn: r.Round}
		}
	}
	for _, s := range r.Revealed {
		mine[key(s.ShipID)] = Sighting{ShipID: s.ShipID, Pos: s.Pos, Turn: r.Round}
	}
	if r.Origin != nil {
		theirs[key(r.ShipID)] = Sighting{ShipID: r.ShipID, Pos: *r.Origin, Turn: r.Round}
	}
	if r.Type == ActionMove {
		if seen, ok := theirs[key(r.ShipID)]; ok {
			if r.Hidden {
				delete(theirs, key(r.ShipID))
			} else {
				seen.Pos = shift(seen.Pos, r.Direction, r.Distance)
				theirs[key(r.ShipID)] = seen
			}
		}
	}
}

// checkEnd decides the winner; the acting side's opponent is checked first so
// that landing the final blow wins even if the attacker just spent its last shell.
// When neither fleet can hurt the other any more, the battle is judged.
func (st *State) checkEnd(actor Side) {
	armed := func(s Side) bool {
		return st.Boards[s].canStrike(st.Boards[s.Opponent()]) || st.Gauge[s] >= GaugeMax
	}
	for _, s := range []Side{actor.Opponent(), actor} {
		if st.Boards[s].alive() == 0 {
			st.finish(s.Opponent(), EndAnnihilated)
			return
		}
	}
	switch opp := actor.Opponent(); {
	case !armed(opp) && !armed(actor):
		st.judge()
	case !armed(opp):
		st.finish(actor, EndDisarmed)
	case !armed(actor):
		st.finish(opp, EndDisarmed)
	}
}

// judge ends the battle on the share of hull left; ties go to the CPU.
func (st *State) judge() {
	if st.Boards[SidePlayer].hull() > st.Boards[SideCPU].hull() {
		st.finish(SidePlayer, EndJudgment)
	} else {
		st.finish(SideCPU, EndJudgment)
	}
}

// Abandon ends the battle as the player's defeat, without another shot fired.
func (st *State) Abandon() error {
	if st.Status != StatusInProgress {
		return ErrGameOver
	}
	st.finish(SideCPU, EndAbandoned)
	return nil
}

func (st *State) finish(winner Side, why EndReason) {
	st.Status = StatusFinished
	st.Winner = winner
	st.EndReason = why
}

func direction(from, to Pos) (Direction, int) {
	switch {
	case to.Row < from.Row:
		return North, from.Row - to.Row
	case to.Row > from.Row:
		return South, to.Row - from.Row
	case to.Col > from.Col:
		return East, to.Col - from.Col
	default:
		return West, from.Col - to.Col
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
