// Package game implements the naval battle rules as pure, storage-agnostic logic.
//
// Both fleets hide on one shared N×N sea. The battle is played in rounds: each
// side secretly commits one action for one living ship, then the two actions
// resolve in initiative order — the faster acting ship first, except that
// torpedo launches always resolve last. An action is one of:
//
//   - attack: fire the main guns at a cell within the class's gun range (1
//     ammo). Battleship shells land in a plus shape;
//   - torpedo: launch along a row or column; the torpedo runs to the edge of
//     the sea and hits the first surface ship in its path (1 torpedo). The wake
//     gives the launcher's position away;
//   - move: sail up to the class's move range along the ship's row or column
//     (announced as ship + direction + distance, except for submarines). Two
//     ships never share a cell: a move stops just short of an enemy ship in
//     its way. A ship that moved in the previous round is still under way:
//     moving again resolves late, after the other side's action, so it cannot
//     dodge a shot aimed at where it is;
//   - skill: the ship's class skill, a limited number of times per battle;
//   - ultimate: once the fleet gauge is full, an all-fleet barrage anywhere:
//     the 3×3 around the aim point and two cells out along its row and column
//     (on a wide sea the whole 5×5), heaviest at the centre.
//
// Damage is rolled around the attacker's power, reduced by armour (and, for
// aircraft, by the defending fleet's total anti-air) and doubled on a
// critical hit. A battleship shell that misses throws up a water column that
// pins the ships next to it in place until the end of the next round.
//
// Four situational attacks always crit or cannot miss, and get a cut-in:
// firing the main guns at the cell the fleet just shelled (spotting fire),
// bombing a ship the fleet is tracking (precision bombing), torpedoing a
// ship at most two cells away (point-blank torpedo), and hitting a ship a
// scouting skill has locked on to (marked fire).
//
// Flares and sonar lock on to every ship they find: until the end of the
// next round, shots on a locked-on ship cannot be dodged and always crit.
//
// Enemy ships side by side along a row or column always spot each other.
// When no ship has taken damage for three rounds in a row, each side's
// scout planes find the untracked enemy surface ship nearest to its fleet.
//
// Hits and scouting give the shooter intel on where enemy ships are, which
// then follows their announced moves. Only a submarine can shake off contact,
// by moving submerged.
//
// A side loses when every ship is sunk, or withdraws when it can no longer
// deal damage. When the turn limit runs out the fleet with the larger share of
// its hull left wins; ties go to the defender (the CPU), or in a duel between
// two admirals end in a draw.
package game

import (
	"errors"
	"fmt"
)

const (
	MinBoardSize = 5
	MaxBoardSize = 8
	// WideSea is the board size from which scouting skills cover more.
	WideSea  = 7
	GaugeMax = 100
	// StateVersion is bumped whenever State stops being readable by older code.
	StateVersion = 3
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

// ClassRule is what a hull type can physically do, whatever the card.
type ClassRule struct {
	// GunRange is how far (king moves) the main guns reach; 0 means no guns.
	GunRange int `json:"gunRange"`
	// MoveRange caps how many cells the ship sails in one move.
	MoveRange int `json:"moveRange"`
	// MinSpeed is the floor for the ship's speed.
	MinSpeed int `json:"minSpeed"`
}

var Classes = map[ShipClass]ClassRule{
	Battleship: {GunRange: 2, MoveRange: 1, MinSpeed: 10},
	Cruiser:    {GunRange: 2, MoveRange: 2, MinSpeed: 20},
	Destroyer:  {GunRange: 1, MoveRange: 3, MinSpeed: 30},
	Submarine:  {GunRange: 0, MoveRange: 2, MinSpeed: 15},
	Carrier:    {GunRange: 1, MoveRange: 1, MinSpeed: 15},
}

type SkillKind string

const (
	// SkillBarrage shells a 3×3 area centred up to 3 cells away.
	SkillBarrage SkillKind = "barrage"
	// SkillFlare lights an area anywhere on the sea, revealing surface ships:
	// a diamond of cells up to 2 steps from the aim point, or on a wide sea a
	// 5×5 square.
	SkillFlare SkillKind = "flare"
	// SkillSonar pings the ship's whole row and column and the cells around
	// it, revealing every ship, submarines included. On a wide sea the row and
	// column are three cells wide.
	SkillSonar SkillKind = "sonar"
	// SkillSpread launches three torpedoes side by side along parallel lanes.
	SkillSpread SkillKind = "spread"
	// SkillAirstrike bombs any single cell on the sea.
	SkillAirstrike SkillKind = "airstrike"
)

var ClassSkill = map[ShipClass]SkillKind{
	Battleship: SkillBarrage,
	Cruiser:    SkillFlare,
	Destroyer:  SkillSonar,
	Submarine:  SkillSpread,
	Carrier:    SkillAirstrike,
}

// Offensive reports whether the skill can deal damage.
func (k SkillKind) Offensive() bool {
	return k == SkillBarrage || k == SkillSpread || k == SkillAirstrike
}

// Stats are a ship's battle numbers.
type Stats struct {
	HP        int `json:"hp"`
	Firepower int `json:"firepower"` // main gun power
	Torpedo   int `json:"torpedo"`   // torpedo power
	Air       int `json:"air"`       // airstrike power
	AA        int `json:"aa"`        // anti-air, summed over the living fleet
	Armor     int `json:"armor"`     // percent of damage absorbed
	Speed     int `json:"speed"`     // initiative
	Ammo      int `json:"ammo"`      // gun salvos per battle
	Torps     int `json:"torps"`     // torpedo launches per battle
	Skill     int `json:"skill"`     // skill uses per battle
	Crit      int `json:"crit"`      // percent
	Evasion   int `json:"evasion"`   // percent
}

// Spec is one ship's fully resolved stats for a battle (catalog card plus
// level and limit-break bonuses, or an enemy template).
type Spec struct {
	Key    string    `json:"key"`
	Class  ShipClass `json:"class"`
	Name   string    `json:"name"`
	Rarity int       `json:"rarity"`
	Boss   bool      `json:"boss,omitempty"`
	Stats
}

func (s Spec) SkillKind() SkillKind { return ClassSkill[s.Class] }
func (s Spec) Rule() ClassRule      { return Classes[s.Class] }
func (s Spec) Surface() bool        { return s.Class != Submarine }

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

// Beside reports whether q is next to p along its row or column.
func (p Pos) Beside(q Pos) bool {
	return abs(p.Row-q.Row)+abs(p.Col-q.Col) == 1
}

// Dist is the Chebyshev (king-move) distance.
func (p Pos) Dist(q Pos) int {
	return max(abs(p.Row-q.Row), abs(p.Col-q.Col))
}

func (p Pos) add(d Pos) Pos { return Pos{p.Row + d.Row, p.Col + d.Col} }

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
	Torps int  `json:"torps"`
	Skill int  `json:"skill"` // remaining skill uses
	// Pinned counts the round ends left before a water column stops holding the ship in place.
	Pinned int `json:"pinned,omitempty"`
	// Sailed counts the round ends left during which another move resolves late.
	Sailed int `json:"sailed,omitempty"`
	// Marked counts the round ends left during which a scouting skill's lock-on
	// makes every shot on the ship unavoidable and critical.
	Marked int `json:"marked,omitempty"`
}

func (s *Ship) Alive() bool { return s.HP > 0 }

func (s *Ship) canGun() bool { return s.Ammo > 0 && s.Spec.Rule().GunRange > 0 }

// CanStrike reports whether the ship can still deal damage on its own.
// Torpedoes only count while the enemy has a surface ship for them to hit.
func (s *Ship) CanStrike(enemySurface bool) bool {
	if !s.Alive() {
		return false
	}
	kind := s.Spec.SkillKind()
	skill := s.Skill > 0 && kind.Offensive() && (kind != SkillSpread || enemySurface)
	return s.canGun() || skill || (s.Torps > 0 && enemySurface)
}

type Board struct {
	Size  int     `json:"size"`
	Ships []*Ship `json:"ships"`
	// Weather is copied from the state so target lists can honour it.
	Weather Weather `json:"weather,omitempty"`
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

// distance is how far p lies from the nearest living ship of the fleet.
func (b *Board) distance(p Pos) int {
	d := 2 * b.Size
	for _, s := range b.Ships {
		if s.Alive() {
			d = min(d, s.Pos.Dist(p))
		}
	}
	return d
}

// AA is the fleet's anti-air: the sum over its living ships.
func (b *Board) AA() int {
	n := 0
	for _, s := range b.Ships {
		if s.Alive() {
			n += s.Spec.AA
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

// surface reports whether the fleet still has a surface ship afloat.
func (b *Board) surface() bool {
	for _, s := range b.Ships {
		if s.Alive() && s.Spec.Surface() {
			return true
		}
	}
	return false
}

// canStrike reports whether the fleet can still damage the enemy fleet.
func (b *Board) canStrike(enemy *Board) bool {
	surface := enemy.surface()
	for _, s := range b.Ships {
		if s.CanStrike(surface) {
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

var orthogonal = []Pos{{-1, 0}, {1, 0}, {0, -1}, {0, 1}}

// neighbours4 lists the in-bounds cells next to p along its row and column.
func (b *Board) neighbours4(p Pos) []Pos {
	out := []Pos{}
	for _, d := range orthogonal {
		if q := p.add(d); q.InBounds(b.Size) {
			out = append(out, q)
		}
	}
	return out
}

// AttackTargets lists cells the ship's guns can reach: within its class's
// gun range, and not occupied by a friendly living ship.
func (b *Board) AttackTargets(id int) []Pos {
	s, err := b.ship(id)
	if err != nil || !s.Alive() || !s.canGun() {
		return []Pos{}
	}
	out := []Pos{}
	for _, p := range b.cells() {
		if d := s.Pos.Dist(p); d >= 1 && d <= s.Spec.Rule().GunRange && b.shipAt(p) == nil {
			out = append(out, p)
		}
	}
	return out
}

// TorpedoTargets lists the cells next to the ship along its row and column;
// each picks the direction the torpedo runs.
func (b *Board) TorpedoTargets(id int) []Pos {
	s, err := b.ship(id)
	if err != nil || !s.Alive() || s.Torps <= 0 {
		return []Pos{}
	}
	return b.neighbours4(s.Pos)
}

// MoveRange is how far the ship may sail this round.
func (b *Board) MoveRange(s *Ship) int {
	r := s.Spec.Rule().MoveRange
	if b.Weather == Storm {
		r = max(r-1, 1)
	}
	return r
}

// MoveTargets lists cells in the same row or column within the ship's move
// range that no friendly living ship occupies. A pinned ship cannot move.
func (b *Board) MoveTargets(id int) []Pos {
	s, err := b.ship(id)
	if err != nil || !s.Alive() || s.Pinned > 0 {
		return []Pos{}
	}
	out := []Pos{}
	reach := b.MoveRange(s)
	for _, p := range b.cells() {
		if d := s.Pos.Dist(p); d >= 1 && d <= reach && (p.Row == s.Pos.Row || p.Col == s.Pos.Col) && b.shipAt(p) == nil {
			out = append(out, p)
		}
	}
	return out
}

// SkillTargets lists the cells the ship's skill can be aimed at. For sonar the
// only target is the ship itself; for a torpedo spread it is the neighbouring
// cell in the direction of travel.
func (b *Board) SkillTargets(id int) []Pos {
	s, err := b.ship(id)
	if err != nil || !s.Alive() || s.Skill <= 0 {
		return []Pos{}
	}
	switch s.Spec.SkillKind() {
	case SkillSonar:
		return []Pos{s.Pos}
	case SkillSpread:
		return b.neighbours4(s.Pos)
	}
	out := []Pos{}
	for _, p := range b.cells() {
		d := s.Pos.Dist(p)
		ok := false
		switch s.Spec.SkillKind() {
		case SkillBarrage:
			ok = d >= 1 && d <= 3
		case SkillFlare:
			ok = true
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
// class is the acting ship's class (it shapes gunfire). Frontends mirror
// this to preview an aim.
func Footprint(size int, t ActionType, kind SkillKind, class ShipClass, from, target Pos) []Pos {
	var out []Pos
	for _, lane := range footprintLanes(size, t, kind, class, from, target) {
		out = append(out, lane...)
	}
	return out
}

// footprintLanes splits a footprint into lanes: torpedo lanes each stop at
// the first ship they meet, every other footprint is a single lane of
// independent cells.
func footprintLanes(size int, t ActionType, kind SkillKind, class ShipClass, from, target Pos) [][]Pos {
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
	lane := func(start, dir Pos) []Pos {
		var l []Pos
		for p := start; p.InBounds(size); p = p.add(dir) {
			l = append(l, p)
		}
		return l
	}
	switch {
	case t == ActionUltimate:
		// Centre first, then ring by ring outward: the barrage walks out from the aim.
		for ring := 0; ring <= 2; ring++ {
			for dr := -ring; dr <= ring; dr++ {
				for dc := -ring; dc <= ring; dc++ {
					if max(abs(dr), abs(dc)) == ring && (size >= WideSea || abs(dr)+abs(dc) <= 2) {
						add(Pos{target.Row + dr, target.Col + dc})
					}
				}
			}
		}
	case t == ActionAttack && class == Battleship:
		add(target)
		for _, d := range orthogonal {
			add(target.add(d))
		}
	case t == ActionTorpedo:
		return [][]Pos{lane(target, Pos{target.Row - from.Row, target.Col - from.Col})}
	case t == ActionSkill && kind == SkillSpread:
		dir := Pos{target.Row - from.Row, target.Col - from.Col}
		side := Pos{dir.Col, dir.Row}
		var lanes [][]Pos
		for _, k := range []int{-1, 0, 1} {
			if l := lane(Pos{target.Row + k*side.Row, target.Col + k*side.Col}, dir); len(l) > 0 {
				lanes = append(lanes, l)
			}
		}
		return lanes
	case t == ActionSkill && kind == SkillBarrage:
		area()
	case t == ActionSkill && kind == SkillFlare:
		for dr := -2; dr <= 2; dr++ {
			for dc := -2; dc <= 2; dc++ {
				if size >= WideSea || abs(dr)+abs(dc) <= 2 {
					add(Pos{target.Row + dr, target.Col + dc})
				}
			}
		}
	case t == ActionSkill && kind == SkillSonar:
		// Half the width of the pinged row and column.
		w := 0
		if size >= WideSea {
			w = 1
		}
		for r := 0; r < size; r++ {
			for c := 0; c < size; c++ {
				p := Pos{r, c}
				if p != from && (abs(r-from.Row) <= w || abs(c-from.Col) <= w || p.Dist(from) <= 1) {
					add(p)
				}
			}
		}
	default:
		add(target)
	}
	return [][]Pos{out}
}

var (
	ErrInvalidPlacement = errors.New("invalid placement")
	ErrInvalidAction    = errors.New("invalid action")
	ErrGameOver         = errors.New("game is already over")
)

// NewBoard validates placements (index = ship ID) and builds a fresh board.
// Speeds below the class floor are raised to it.
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
		sp.Speed = max(sp.Speed, sp.Rule().MinSpeed)
		b.Ships = append(b.Ships, &Ship{ID: id, Spec: sp, Pos: p, HP: sp.HP, Ammo: sp.Ammo, Torps: sp.Torps, Skill: sp.Skill})
	}
	return b, nil
}

type ActionType string

const (
	ActionAttack   ActionType = "attack"
	ActionTorpedo  ActionType = "torpedo"
	ActionMove     ActionType = "move"
	ActionSkill    ActionType = "skill"
	ActionUltimate ActionType = "ultimate"
	// ActionRecon is not chosen by a player: it reports what scout planes
	// found after a quiet spell. Its ShipID is -1.
	ActionRecon ActionType = "recon"
)

type Action struct {
	Type   ActionType `json:"type"`
	ShipID int        `json:"shipId"`
	Target Pos        `json:"target"`
}

// Late reports whether the action resolves after the other side's: torpedo
// launches, and a move by a ship still under way from the previous round.
func (a Action) Late(s *Ship) bool {
	switch a.Type {
	case ActionTorpedo:
		return true
	case ActionSkill:
		return s.Spec.SkillKind() == SkillSpread
	case ActionMove:
		return s.Sailed > 0
	}
	return false
}

type Direction string

const (
	North Direction = "north"
	South Direction = "south"
	East  Direction = "east"
	West  Direction = "west"
)

// Special names a situational attack that gets a cut-in.
type Special string

const (
	// SpecialSpotting: main guns fired at the cell the fleet shelled with its previous action. Always crits.
	SpecialSpotting Special = "spotting"
	// SpecialPrecision: an airstrike on a tracked ship. Ignores anti-air and evasion.
	SpecialPrecision Special = "precision"
	// SpecialPointBlank: a torpedo hit within 2 cells of the launcher. Always crits.
	SpecialPointBlank Special = "pointblank"
	// SpecialMarked: a hit on a ship a flare or sonar locked on to. Unavoidable and always crits.
	SpecialMarked Special = "marked"
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
	// Marked: the ship hit was locked on to by a scouting skill.
	Marked bool `json:"marked,omitempty"`
}

// Sighting is an enemy ship located by a hit, a scouting skill or a torpedo wake.
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
	// Round is the 1-based round the action was played in.
	Round int `json:"round"`
	// Speed is the acting ship's speed; Late marks torpedoes and moves by a
	// ship still under way, which go after the other side's action.
	Speed int  `json:"speed"`
	Late  bool `json:"late,omitempty"`
	// Cancelled actions never happened: the ship was sunk earlier in the round.
	Cancelled bool    `json:"cancelled,omitempty"`
	Special   Special `json:"special,omitempty"`

	// Target is where the action was aimed (attack, torpedo, skill, ultimate).
	Target *Pos `json:"target,omitempty"`
	// Shots lists every cell that took fire, in order.
	Shots []Shot `json:"shots,omitempty"`
	// Origin is where torpedoes were launched from; their wake gives it away.
	Origin *Pos `json:"origin,omitempty"`
	// Paths are the torpedo tracks up to where each one stopped.
	Paths [][]Pos `json:"paths,omitempty"`
	// Columns are the cells where a battleship shell threw up a water column.
	Columns []Pos `json:"columns,omitempty"`
	// Scanned and Revealed are the area a scouting skill covered and what it found.
	Scanned  []Pos      `json:"scanned,omitempty"`
	Revealed []Sighting `json:"revealed,omitempty"`

	// Move fields. Hidden moves (submarines) carry no direction or distance.
	// Distance is how far the ship actually sailed: Blocked moves stop short
	// of the enemy ship in the way, possibly without leaving their cell.
	Direction Direction `json:"direction,omitempty"`
	Distance  int       `json:"distance,omitempty"`
	Hidden    bool      `json:"hidden,omitempty"`
	Blocked   bool      `json:"blocked,omitempty"`

	// Contact marks that the action left enemy ships side by side, which
	// spots them to each other.
	Contact bool `json:"contact,omitempty"`

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

// Damage totals the damage dealt.
func (r Result) Damage() int {
	n := 0
	for _, s := range r.Shots {
		n += s.Damage
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
	EndDisarmed    EndReason = "disarmed"    // no way left to deal damage: strategic withdrawal
	EndJudgment    EndReason = "judgment"    // turn limit reached
	EndAbandoned   EndReason = "abandoned"   // the player walked away from a suspended battle
	EndSurrender   EndReason = "surrender"   // a duellist struck their colours
	EndTimeout     EndReason = "timeout"     // a duellist let too many rounds pass without orders
)

// Weather is the sea condition of a battle, rolled per sortie.
type Weather string

const (
	Clear Weather = "clear" // no modifiers
	Fog   Weather = "fog"   // every ship +10 evasion; bombs lose their accuracy edge
	Storm Weather = "storm" // move range -1 (min 1); torpedoes -25%
	Night Weather = "night" // torpedoes +25%; airstrikes -50%
)

var Weathers = []Weather{Clear, Fog, Storm, Night}

// AI tunes the CPU opponent. Level 0 is the gentlest, 3 the sharpest.
type AI struct {
	Level int `json:"level"`
}

// State is the full game state, persisted as JSON.
type State struct {
	Version   int             `json:"version"`
	Size      int             `json:"size"`
	MaxTurns  int             `json:"maxTurns"`
	Weather   Weather         `json:"weather"`
	Boards    map[Side]*Board `json:"boards"`
	Turn      int             `json:"turn"` // rounds completed
	Status    Status          `json:"status"`
	Winner    Side            `json:"winner,omitempty"`
	EndReason EndReason       `json:"endReason,omitempty"`
	History   []Result        `json:"history"`
	Gauge     map[Side]int    `json:"gauge"`
	Combo     map[Side]int    `json:"combo"`
	MaxCombo  map[Side]int    `json:"maxCombo"`
	// LastGun is where each side's previous action fired its guns, if it did.
	LastGun map[Side]*Pos `json:"lastGun"`
	// Quiet counts the rounds in a row in which no ship took damage.
	Quiet int `json:"quiet,omitempty"`
	// Intel[s] is what side s knows about the opponent's ship positions, keyed by ship ID.
	Intel  map[Side]map[string]Sighting `json:"intel"`
	Memory map[Side]*Memory             `json:"memory"`
	AI     AI                           `json:"ai"`
	// Duel marks a battle between two admirals: SideCPU is the second admiral,
	// and a judgment on equal hulls is a draw (Winner stays empty).
	Duel bool `json:"duel,omitempty"`
}

func NewState(player, cpu *Board, maxTurns int, ai AI, weather Weather) *State {
	if weather == "" {
		weather = Clear
	}
	st := &State{
		Version:  StateVersion,
		Size:     player.Size,
		MaxTurns: maxTurns,
		Weather:  weather,
		Boards:   map[Side]*Board{SidePlayer: player, SideCPU: cpu},
		Status:   StatusInProgress,
		History:  []Result{},
		Gauge:    map[Side]int{},
		Combo:    map[Side]int{},
		MaxCombo: map[Side]int{},
		LastGun:  map[Side]*Pos{},
		Intel:    map[Side]map[string]Sighting{SidePlayer: {}, SideCPU: {}},
		Memory:   map[Side]*Memory{SidePlayer: {}, SideCPU: {}},
		AI:       ai,
	}
	st.syncWeather()
	st.sense(0)
	return st
}

// syncWeather hands the weather to the boards.
func (st *State) syncWeather() {
	for _, b := range st.Boards {
		b.Weather = st.Weather
	}
}
