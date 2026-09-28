// Package game implements the naval battle rules as pure, storage-agnostic logic.
//
// Both fleets hide on one shared N×N sea. On its turn a side picks one living
// ship and does one of:
//
//   - attack: shell one of the 8 cells around the ship (1 ammo);
//   - move: sail any distance along the ship's row or column (announced to the
//     opponent as ship + direction + distance, except for submarines, which
//     move submerged);
//   - skill: the ship's class skill, a limited number of times per battle;
//   - ultimate: once the fleet gauge is full, any living ship calls a 3×3
//     all-fleet barrage anywhere on the sea.
//
// A shot reports hit (possibly critical, possibly evaded) and "splash" when a
// surface ship lies on one of the 8 cells around it. Hits and scouting skills
// give the shooter intel on where enemy ships are, which then follows their
// announced moves.
//
// A side loses when every ship is sunk, or when it can no longer deal damage.
// When the turn limit runs out the fleet with the larger share of its hull
// left wins; ties go to the defender (the CPU).
package game

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"strconv"
)

const (
	MinBoardSize = 5
	MaxBoardSize = 8
	GaugeMax     = 100
	// StateVersion is bumped whenever State stops being readable by older code.
	StateVersion = 2
)

type Side string

const (
	SidePlayer Side = "player"
	SideCPU    Side = "cpu"
)

func (s Side) Opponent() Side {
	if s == SidePlayer {
		return SideCPU
	}
	return SidePlayer
}

type ShipClass string

const (
	Battleship ShipClass = "battleship"
	Cruiser    ShipClass = "cruiser"
	Destroyer  ShipClass = "destroyer"
	Submarine  ShipClass = "submarine"
	Carrier    ShipClass = "carrier"
)

type SkillKind string

const (
	// SkillBarrage shells a plus shape centred up to 2 cells away.
	SkillBarrage SkillKind = "barrage"
	// SkillFlare lights a 3×3 area up to 3 cells away, revealing surface ships.
	SkillFlare SkillKind = "flare"
	// SkillSonar pings the ship's whole row and column, revealing every ship, submarines included.
	SkillSonar SkillKind = "sonar"
	// SkillTorpedo runs straight from the ship and hits the first enemy in its path for 2 damage.
	SkillTorpedo SkillKind = "torpedo"
	// SkillAirstrike hits any single cell on the sea.
	SkillAirstrike SkillKind = "airstrike"
)

var ClassSkill = map[ShipClass]SkillKind{
	Battleship: SkillBarrage,
	Cruiser:    SkillFlare,
	Destroyer:  SkillSonar,
	Submarine:  SkillTorpedo,
	Carrier:    SkillAirstrike,
}

// Offensive reports whether the skill can deal damage.
func (k SkillKind) Offensive() bool {
	return k == SkillBarrage || k == SkillTorpedo || k == SkillAirstrike
}

// Spec is one ship's fully resolved stats for a battle (catalog card plus
// level and limit-break bonuses, or an enemy template).
type Spec struct {
	Key     string    `json:"key"`
	Class   ShipClass `json:"class"`
	Name    string    `json:"name"`
	Rarity  int       `json:"rarity"`
	HP      int       `json:"hp"`
	Ammo    int       `json:"ammo"`
	Skill   int       `json:"skill"`   // skill uses per battle
	Crit    int       `json:"crit"`    // percent
	Evasion int       `json:"evasion"` // percent
	Boss    bool      `json:"boss,omitempty"`
}

func (s Spec) SkillKind() SkillKind { return ClassSkill[s.Class] }

type Pos struct {
	Row int `json:"row"`
	Col int `json:"col"`
}

func (p Pos) InBounds(size int) bool {
	return p.Row >= 0 && p.Row < size && p.Col >= 0 && p.Col < size
}

// Adjacent reports whether q is one of the 8 cells surrounding p.
func (p Pos) Adjacent(q Pos) bool {
	return p.Dist(q) == 1
}

// Dist is the Chebyshev (king-move) distance.
func (p Pos) Dist(q Pos) int {
	return max(abs(p.Row-q.Row), abs(p.Col-q.Col))
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

type Ship struct {
	ID    int  `json:"id"`
	Spec  Spec `json:"spec"`
	Pos   Pos  `json:"pos"`
	HP    int  `json:"hp"`
	Ammo  int  `json:"ammo"`
	Skill int  `json:"skill"` // remaining skill uses
}

func (s *Ship) Alive() bool { return s.HP > 0 }

// CanStrike reports whether the ship can still deal damage on its own.
func (s *Ship) CanStrike() bool {
	return s.Alive() && (s.Ammo > 0 || (s.Skill > 0 && s.Spec.SkillKind().Offensive()))
}

type Board struct {
	Size  int     `json:"size"`
	Ships []*Ship `json:"ships"`
}

func (b *Board) shipAt(p Pos) *Ship {
	for _, s := range b.Ships {
		if s.Pos == p && s.Alive() {
			return s
		}
	}
	return nil
}

func (b *Board) ship(id int) (*Ship, error) {
	if id < 0 || id >= len(b.Ships) {
		return nil, fmt.Errorf("%w: unknown ship %d", ErrInvalidAction, id)
	}
	return b.Ships[id], nil
}

func (b *Board) alive() int {
	n := 0
	for _, s := range b.Ships {
		if s.Alive() {
			n++
		}
	}
	return n
}

// hull is the share of total hit points left, used to judge a timed-out battle.
func (b *Board) hull() float64 {
	hp, maxHP := 0, 0
	for _, s := range b.Ships {
		hp += max(s.HP, 0)
		maxHP += s.Spec.HP
	}
	if maxHP == 0 {
		return 0
	}
	return float64(hp) / float64(maxHP)
}

func (b *Board) canStrike() bool {
	for _, s := range b.Ships {
		if s.CanStrike() {
			return true
		}
	}
	return false
}

func (b *Board) cells() []Pos {
	out := make([]Pos, 0, b.Size*b.Size)
	for r := 0; r < b.Size; r++ {
		for c := 0; c < b.Size; c++ {
			out = append(out, Pos{r, c})
		}
	}
	return out
}

// AttackTargets lists cells the ship can shell: surrounding cells that are
// on the sea and not occupied by a friendly living ship.
func (b *Board) AttackTargets(id int) []Pos {
	s, err := b.ship(id)
	if err != nil || !s.Alive() || s.Ammo <= 0 {
		return []Pos{}
	}
	out := []Pos{}
	for _, p := range b.cells() {
		if s.Pos.Adjacent(p) && b.shipAt(p) == nil {
			out = append(out, p)
		}
	}
	return out
}

// MoveTargets lists cells in the same row or column not occupied by a friendly living ship.
func (b *Board) MoveTargets(id int) []Pos {
	s, err := b.ship(id)
	if err != nil || !s.Alive() {
		return []Pos{}
	}
	out := []Pos{}
	for _, p := range b.cells() {
		if p != s.Pos && (p.Row == s.Pos.Row || p.Col == s.Pos.Col) && b.shipAt(p) == nil {
			out = append(out, p)
		}
	}
	return out
}

// SkillTargets lists the cells the ship's skill can be aimed at. For sonar the
// only target is the ship itself; for torpedoes it is the neighbouring cell in
// the direction of travel.
func (b *Board) SkillTargets(id int) []Pos {
	s, err := b.ship(id)
	if err != nil || !s.Alive() || s.Skill <= 0 {
		return []Pos{}
	}
	out := []Pos{}
	for _, p := range b.cells() {
		d := s.Pos.Dist(p)
		ok := false
		switch s.Spec.SkillKind() {
		case SkillBarrage:
			ok = d >= 1 && d <= 2
		case SkillFlare:
			ok = d <= 3
		case SkillSonar:
			ok = d == 0
		case SkillTorpedo:
			ok = d == 1 && (p.Row == s.Pos.Row || p.Col == s.Pos.Col)
		case SkillAirstrike:
			ok = true
		}
		if ok {
			out = append(out, p)
		}
	}
	return out
}

// Footprint returns the cells an action affects, in the order they resolve.
// Frontends mirror this to preview an aim.
func Footprint(size int, t ActionType, kind SkillKind, from, target Pos) []Pos {
	var out []Pos
	add := func(p Pos) {
		if p.InBounds(size) {
			out = append(out, p)
		}
	}
	area := func() {
		for dr := -1; dr <= 1; dr++ {
			for dc := -1; dc <= 1; dc++ {
				add(Pos{target.Row + dr, target.Col + dc})
			}
		}
	}
	switch {
	case t == ActionUltimate:
		area()
	case t == ActionSkill && kind == SkillBarrage:
		add(target)
		for _, d := range []Pos{{-1, 0}, {1, 0}, {0, -1}, {0, 1}} {
			add(Pos{target.Row + d.Row, target.Col + d.Col})
		}
	case t == ActionSkill && kind == SkillFlare:
		area()
	case t == ActionSkill && kind == SkillSonar:
		for i := 0; i < size; i++ {
			if i != from.Col {
				add(Pos{from.Row, i})
			}
			if i != from.Row {
				add(Pos{i, from.Col})
			}
		}
	case t == ActionSkill && kind == SkillTorpedo:
		dr, dc := target.Row-from.Row, target.Col-from.Col
		for p := target; p.InBounds(size); p = (Pos{p.Row + dr, p.Col + dc}) {
			out = append(out, p)
		}
	default:
		add(target)
	}
	return out
}

var (
	ErrInvalidPlacement = errors.New("invalid placement")
	ErrInvalidAction    = errors.New("invalid action")
	ErrGameOver         = errors.New("game is already over")
)

// NewBoard validates placements (index = ship ID) and builds a fresh board.
func NewBoard(size int, specs []Spec, placements []Pos) (*Board, error) {
	if size < MinBoardSize || size > MaxBoardSize {
		return nil, fmt.Errorf("%w: board size %d", ErrInvalidPlacement, size)
	}
	if len(specs) == 0 || len(placements) != len(specs) {
		return nil, fmt.Errorf("%w: need exactly %d ships", ErrInvalidPlacement, len(specs))
	}
	seen := map[Pos]bool{}
	b := &Board{Size: size}
	for id, p := range placements {
		if !p.InBounds(size) {
			return nil, fmt.Errorf("%w: ship %d out of bounds", ErrInvalidPlacement, id)
		}
		if seen[p] {
			return nil, fmt.Errorf("%w: ships overlap at (%d,%d)", ErrInvalidPlacement, p.Row, p.Col)
		}
		seen[p] = true
		sp := specs[id]
		b.Ships = append(b.Ships, &Ship{ID: id, Spec: sp, Pos: p, HP: sp.HP, Ammo: sp.Ammo, Skill: sp.Skill})
	}
	return b, nil
}

type ActionType string

const (
	ActionAttack   ActionType = "attack"
	ActionMove     ActionType = "move"
	ActionSkill    ActionType = "skill"
	ActionUltimate ActionType = "ultimate"
)

type Action struct {
	Type   ActionType `json:"type"`
	ShipID int        `json:"shipId"`
	Target Pos        `json:"target"`
}

type Direction string

const (
	North Direction = "north"
	South Direction = "south"
	East  Direction = "east"
	West  Direction = "west"
)

// Shot is the outcome of one shell, torpedo or bomb landing on a cell.
type Shot struct {
	Target    Pos  `json:"target"`
	HitShipID *int `json:"hitShipId,omitempty"`
	Damage    int  `json:"damage,omitempty"`
	Crit      bool `json:"crit,omitempty"`
	Evaded    bool `json:"evaded,omitempty"`
	Sunk      bool `json:"sunk,omitempty"`
	Splash    bool `json:"splash,omitempty"`
}

// Sighting is an enemy ship located by a hit or a scouting skill.
type Sighting struct {
	ShipID int `json:"shipId"`
	Pos    Pos `json:"pos"`
	Turn   int `json:"turn"`
}

// Result is what both sides learn about an action.
type Result struct {
	Side   Side       `json:"side"`
	Type   ActionType `json:"type"`
	ShipID int        `json:"shipId"`
	Skill  SkillKind  `json:"skill,omitempty"`

	// Target is where the action was aimed (attack, skill, ultimate).
	Target *Pos `json:"target,omitempty"`
	// Shots lists every cell that took fire, in order.
	Shots []Shot `json:"shots,omitempty"`
	// Path is the torpedo track up to where it stopped.
	Path []Pos `json:"path,omitempty"`
	// Scanned and Revealed are the area a scouting skill covered and what it found.
	Scanned  []Pos      `json:"scanned,omitempty"`
	Revealed []Sighting `json:"revealed,omitempty"`

	// Move fields. Hidden moves (submarines) carry no direction or distance.
	Direction Direction `json:"direction,omitempty"`
	Distance  int       `json:"distance,omitempty"`
	Hidden    bool      `json:"hidden,omitempty"`

	// The acting side's combo and gauge after the action.
	Combo int `json:"combo"`
	Gauge int `json:"gauge"`
}

// Hits counts shots that dealt damage.
func (r Result) Hits() int {
	n := 0
	for _, s := range r.Shots {
		if s.Damage > 0 {
			n++
		}
	}
	return n
}

// Sinks counts shots that sank a ship.
func (r Result) Sinks() int {
	n := 0
	for _, s := range r.Shots {
		if s.Sunk {
			n++
		}
	}
	return n
}

// Crits counts critical hits.
func (r Result) Crits() int {
	n := 0
	for _, s := range r.Shots {
		if s.Crit {
			n++
		}
	}
	return n
}

type Status string

const (
	StatusInProgress Status = "in_progress"
	StatusFinished   Status = "finished"
)

type EndReason string

const (
	EndAnnihilated EndReason = "annihilated" // every ship sunk
	EndDisarmed    EndReason = "disarmed"    // no way left to deal damage
	EndJudgment    EndReason = "judgment"    // turn limit reached
)

// AI tunes the CPU opponent. Level 0 is the gentlest, 3 the sharpest.
type AI struct {
	Level int `json:"level"`
}

// State is the full game state, persisted as JSON.
type State struct {
	Version   int             `json:"version"`
	Size      int             `json:"size"`
	MaxTurns  int             `json:"maxTurns"`
	Boards    map[Side]*Board `json:"boards"`
	Turn      int             `json:"turn"`
	Status    Status          `json:"status"`
	Winner    Side            `json:"winner,omitempty"`
	EndReason EndReason       `json:"endReason,omitempty"`
	History   []Result        `json:"history"`
	Gauge     map[Side]int    `json:"gauge"`
	Combo     map[Side]int    `json:"combo"`
	MaxCombo  map[Side]int    `json:"maxCombo"`
	// Intel[s] is what side s knows about the opponent's ship positions, keyed by ship ID.
	Intel map[Side]map[string]Sighting `json:"intel"`
	CPU   CPUMemory                    `json:"cpu"`
	AI    AI                           `json:"ai"`
}

func NewState(player, cpu *Board, maxTurns int, ai AI) *State {
	return &State{
		Version:  StateVersion,
		Size:     player.Size,
		MaxTurns: maxTurns,
		Boards:   map[Side]*Board{SidePlayer: player, SideCPU: cpu},
		Status:   StatusInProgress,
		History:  []Result{},
		Gauge:    map[Side]int{},
		Combo:    map[Side]int{},
		MaxCombo: map[Side]int{},
		Intel:    map[Side]map[string]Sighting{SidePlayer: {}, SideCPU: {}},
		AI:       ai,
	}
}

// Gauge gains. Shooting gains are scaled by the running combo.
const (
	gaugeHit    = 14
	gaugeSink   = 22
	gaugeSplash = 5
	gaugeScout  = 8
	gaugeHurt   = 12
)

// Apply executes one action for side and returns its public result. rng
// decides critical hits and evasion.
func (st *State) Apply(side Side, a Action, rng *rand.Rand) (Result, error) {
	if st.Status != StatusInProgress {
		return Result{}, ErrGameOver
	}
	own := st.Boards[side]
	ship, err := own.ship(a.ShipID)
	if err != nil {
		return Result{}, err
	}
	if !ship.Alive() {
		return Result{}, fmt.Errorf("%w: ship %d is sunk", ErrInvalidAction, a.ShipID)
	}
	if !a.Target.InBounds(st.Size) {
		return Result{}, fmt.Errorf("%w: target (%d,%d) is off the sea", ErrInvalidAction, a.Target.Row, a.Target.Col)
	}

	res := Result{Side: side, Type: a.Type, ShipID: a.ShipID}
	t := a.Target
	switch a.Type {
	case ActionAttack:
		if !contains(own.AttackTargets(a.ShipID), t) {
			return Result{}, fmt.Errorf("%w: cannot attack (%d,%d) with ship %d", ErrInvalidAction, t.Row, t.Col, a.ShipID)
		}
		ship.Ammo--
		res.Target = &t
		res.Shots = []Shot{st.fire(side, t, 1, ship.Spec.Crit, true, rng)}

	case ActionMove:
		if !contains(own.MoveTargets(a.ShipID), t) {
			return Result{}, fmt.Errorf("%w: cannot move ship %d to (%d,%d)", ErrInvalidAction, a.ShipID, t.Row, t.Col)
		}
		if ship.Spec.Class == Submarine {
			res.Hidden = true
		} else {
			res.Direction, res.Distance = direction(ship.Pos, t)
		}
		ship.Pos = t

	case ActionSkill:
		if !contains(own.SkillTargets(a.ShipID), t) {
			return Result{}, fmt.Errorf("%w: cannot use skill of ship %d at (%d,%d)", ErrInvalidAction, a.ShipID, t.Row, t.Col)
		}
		ship.Skill--
		kind := ship.Spec.SkillKind()
		res.Skill = kind
		res.Target = &t
		cells := Footprint(st.Size, ActionSkill, kind, ship.Pos, t)
		switch kind {
		case SkillBarrage:
			for _, c := range cells {
				res.Shots = append(res.Shots, st.fire(side, c, 1, ship.Spec.Crit, true, rng))
			}
		case SkillAirstrike:
			res.Shots = []Shot{st.fire(side, t, 1, ship.Spec.Crit+10, true, rng)}
		case SkillTorpedo:
			for _, c := range cells {
				res.Path = append(res.Path, c)
				if st.Boards[side.Opponent()].shipAt(c) != nil {
					res.Shots = []Shot{st.fire(side, c, 2, ship.Spec.Crit, true, rng)}
					break
				}
			}
		case SkillFlare, SkillSonar:
			res.Scanned = cells
			for _, e := range st.Boards[side.Opponent()].Ships {
				if e.Alive() && contains(cells, e.Pos) && (kind == SkillSonar || e.Spec.Class != Submarine) {
					res.Revealed = append(res.Revealed, Sighting{ShipID: e.ID, Pos: e.Pos, Turn: st.Turn})
				}
			}
		}

	case ActionUltimate:
		if st.Gauge[side] < GaugeMax {
			return Result{}, fmt.Errorf("%w: gauge is not full", ErrInvalidAction)
		}
		st.Gauge[side] = 0
		res.Target = &t
		for _, c := range Footprint(st.Size, ActionUltimate, "", ship.Pos, t) {
			res.Shots = append(res.Shots, st.fire(side, c, 1, 0, false, rng))
		}

	default:
		return Result{}, fmt.Errorf("%w: unknown action type %q", ErrInvalidAction, a.Type)
	}

	st.score(side, &res)
	if side == SidePlayer {
		st.Turn++
	}
	st.learn(res)
	st.History = append(st.History, res)
	st.CPU.Observe(res)
	st.checkEnd(side)
	return res, nil
}

// fire lands one shot from side on cell t.
func (st *State) fire(side Side, t Pos, dmg, crit int, evadable bool, rng *rand.Rand) Shot {
	enemy := st.Boards[side.Opponent()]
	sh := Shot{Target: t}
	if hit := enemy.shipAt(t); hit != nil {
		id := hit.ID
		sh.HitShipID = &id
		switch {
		case evadable && rng.IntN(100) < hit.Spec.Evasion:
			sh.Evaded = true
		default:
			if crit > 0 && rng.IntN(100) < crit {
				sh.Crit = true
				dmg++
			}
			hit.HP = max(hit.HP-dmg, 0)
			sh.Damage = dmg
			sh.Sunk = !hit.Alive()
		}
	}
	for _, s := range enemy.Ships {
		if s.Alive() && s.Spec.Class != Submarine && s.Pos.Adjacent(t) {
			sh.Splash = true
		}
	}
	return sh
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

// learn updates both sides' intel from a public result.
func (st *State) learn(r Result) {
	mine, theirs := st.Intel[r.Side], st.Intel[r.Side.Opponent()]
	for _, s := range r.Shots {
		if s.HitShipID == nil {
			continue
		}
		key := strconv.Itoa(*s.HitShipID)
		if s.Sunk {
			delete(mine, key)
		} else {
			mine[key] = Sighting{ShipID: *s.HitShipID, Pos: s.Target, Turn: st.Turn}
		}
	}
	for _, s := range r.Revealed {
		mine[strconv.Itoa(s.ShipID)] = Sighting{ShipID: s.ShipID, Pos: s.Pos, Turn: st.Turn}
	}
	if r.Type == ActionMove {
		key := strconv.Itoa(r.ShipID)
		if seen, ok := theirs[key]; ok {
			if r.Hidden {
				delete(theirs, key)
			} else {
				seen.Pos = shift(seen.Pos, r.Direction, r.Distance)
				theirs[key] = seen
			}
		}
	}
}

// checkEnd decides the winner; the acting side's opponent is checked first so
// that landing the final blow wins even if the attacker just spent its last shell.
func (st *State) checkEnd(actor Side) {
	for _, s := range []Side{actor.Opponent(), actor} {
		b := st.Boards[s]
		switch {
		case b.alive() == 0:
			st.finish(s.Opponent(), EndAnnihilated)
			return
		case !b.canStrike() && st.Gauge[s] < GaugeMax:
			st.finish(s.Opponent(), EndDisarmed)
			return
		}
	}
	// A round ends with the CPU's reply.
	if actor == SideCPU && st.MaxTurns > 0 && st.Turn >= st.MaxTurns {
		if st.Boards[SidePlayer].hull() > st.Boards[SideCPU].hull() {
			st.finish(SidePlayer, EndJudgment)
		} else {
			st.finish(SideCPU, EndJudgment)
		}
	}
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

func contains(ps []Pos, p Pos) bool {
	for _, q := range ps {
		if q == p {
			return true
		}
	}
	return false
}
