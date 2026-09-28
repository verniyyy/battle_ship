// Package game implements the battleship rules as pure, storage-agnostic logic.
//
// Rules (ported from the original Ruby engine):
//   - Each side secretly places 3 ships on its own 5x5 board.
//   - On a turn, a side picks one living ship and either
//     attacks one of the 8 cells around it (costs 1 ammo), or
//     moves it any distance along its row or column.
//   - An attack reports "hit" if an enemy ship is on the target cell and
//     "splash" if an enemy ship is on any of the 8 surrounding cells.
//   - Moves are announced to the opponent as ship + direction + distance.
//   - A side is defeated when every ship is sunk or out of ammo.
package game

import (
	"errors"
	"fmt"
)

const BoardSize = 5

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
	Destroyer  ShipClass = "destroyer"
	Submarine  ShipClass = "submarine"
)

// ShipSpec describes a ship's base stats. Ship IDs are indexes into Fleet.
type ShipSpec struct {
	Class ShipClass `json:"class"`
	Name  string    `json:"name"`
	HP    int       `json:"hp"`
	Ammo  int       `json:"ammo"`
}

var Fleet = []ShipSpec{
	{Class: Battleship, Name: "戦艦", HP: 3, Ammo: 7},
	{Class: Destroyer, Name: "駆逐艦", HP: 2, Ammo: 3},
	{Class: Submarine, Name: "潜水艦", HP: 1, Ammo: 1},
}

type Pos struct {
	Row int `json:"row"`
	Col int `json:"col"`
}

func (p Pos) InBounds() bool {
	return p.Row >= 0 && p.Row < BoardSize && p.Col >= 0 && p.Col < BoardSize
}

// Adjacent reports whether q is one of the 8 cells surrounding p.
func (p Pos) Adjacent(q Pos) bool {
	dr, dc := abs(p.Row-q.Row), abs(p.Col-q.Col)
	return dr <= 1 && dc <= 1 && (dr+dc) > 0
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

type Ship struct {
	ID   int `json:"id"`
	Pos  Pos `json:"pos"`
	HP   int `json:"hp"`
	Ammo int `json:"ammo"`
}

func (s *Ship) Alive() bool { return s.HP > 0 }

func (s *Ship) Spec() ShipSpec { return Fleet[s.ID] }

type Board struct {
	Ships []*Ship `json:"ships"`
}

func (b *Board) shipAt(p Pos, alive bool) *Ship {
	for _, s := range b.Ships {
		if s.Pos == p && (!alive || s.Alive()) {
			return s
		}
	}
	return nil
}

// Defeated reports whether the side can no longer fight.
func (b *Board) Defeated() bool {
	for _, s := range b.Ships {
		if s.Alive() && s.Ammo > 0 {
			return false
		}
	}
	return true
}

func (b *Board) ship(id int) (*Ship, error) {
	if id < 0 || id >= len(b.Ships) {
		return nil, fmt.Errorf("%w: unknown ship %d", ErrInvalidAction, id)
	}
	return b.Ships[id], nil
}

// AttackTargets lists cells the ship can attack: surrounding cells that are
// on the board and not occupied by a friendly living ship.
func (b *Board) AttackTargets(id int) []Pos {
	s, err := b.ship(id)
	if err != nil || !s.Alive() || s.Ammo <= 0 {
		return []Pos{}
	}
	out := []Pos{}
	for dr := -1; dr <= 1; dr++ {
		for dc := -1; dc <= 1; dc++ {
			p := Pos{s.Pos.Row + dr, s.Pos.Col + dc}
			if (dr == 0 && dc == 0) || !p.InBounds() || b.shipAt(p, true) != nil {
				continue
			}
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
	for r := 0; r < BoardSize; r++ {
		for c := 0; c < BoardSize; c++ {
			p := Pos{r, c}
			if p == s.Pos || (r != s.Pos.Row && c != s.Pos.Col) || b.shipAt(p, true) != nil {
				continue
			}
			out = append(out, p)
		}
	}
	return out
}

var (
	ErrInvalidPlacement = errors.New("invalid placement")
	ErrInvalidAction    = errors.New("invalid action")
	ErrGameOver         = errors.New("game is already over")
)

// NewBoard validates placements (index = ship ID) and builds a fresh board.
func NewBoard(placements []Pos) (*Board, error) {
	if len(placements) != len(Fleet) {
		return nil, fmt.Errorf("%w: need exactly %d ships", ErrInvalidPlacement, len(Fleet))
	}
	seen := map[Pos]bool{}
	b := &Board{}
	for id, p := range placements {
		if !p.InBounds() {
			return nil, fmt.Errorf("%w: ship %d out of bounds", ErrInvalidPlacement, id)
		}
		if seen[p] {
			return nil, fmt.Errorf("%w: ships overlap at (%d,%d)", ErrInvalidPlacement, p.Row, p.Col)
		}
		seen[p] = true
		spec := Fleet[id]
		b.Ships = append(b.Ships, &Ship{ID: id, Pos: p, HP: spec.HP, Ammo: spec.Ammo})
	}
	return b, nil
}

type ActionType string

const (
	ActionAttack ActionType = "attack"
	ActionMove   ActionType = "move"
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

// Result is what both sides learn about an action.
type Result struct {
	Side   Side       `json:"side"`
	Type   ActionType `json:"type"`
	ShipID int        `json:"shipId"`

	// Attack fields.
	Target    *Pos `json:"target,omitempty"`
	HitShipID *int `json:"hitShipId,omitempty"`
	Sunk      bool `json:"sunk,omitempty"`
	Splash    bool `json:"splash,omitempty"`

	// Move fields.
	Direction Direction `json:"direction,omitempty"`
	Distance  int       `json:"distance,omitempty"`
}

type Status string

const (
	StatusInProgress Status = "in_progress"
	StatusFinished   Status = "finished"
)

// State is the full game state, persisted as JSON.
type State struct {
	Boards  map[Side]*Board `json:"boards"`
	Turn    int             `json:"turn"`
	Status  Status          `json:"status"`
	Winner  Side            `json:"winner,omitempty"`
	History []Result        `json:"history"`
	CPU     CPUMemory       `json:"cpu"`
}

func NewState(player, cpu *Board) *State {
	return &State{
		Boards:  map[Side]*Board{SidePlayer: player, SideCPU: cpu},
		Status:  StatusInProgress,
		History: []Result{},
	}
}

// Apply executes one action for side and returns its public result.
func (st *State) Apply(side Side, a Action) (Result, error) {
	if st.Status != StatusInProgress {
		return Result{}, ErrGameOver
	}
	own, enemy := st.Boards[side], st.Boards[side.Opponent()]
	ship, err := own.ship(a.ShipID)
	if err != nil {
		return Result{}, err
	}
	if !ship.Alive() {
		return Result{}, fmt.Errorf("%w: ship %d is sunk", ErrInvalidAction, a.ShipID)
	}

	res := Result{Side: side, Type: a.Type, ShipID: a.ShipID}
	switch a.Type {
	case ActionAttack:
		if !contains(own.AttackTargets(a.ShipID), a.Target) {
			return Result{}, fmt.Errorf("%w: cannot attack (%d,%d) with ship %d", ErrInvalidAction, a.Target.Row, a.Target.Col, a.ShipID)
		}
		ship.Ammo--
		t := a.Target
		res.Target = &t
		if hit := enemy.shipAt(t, true); hit != nil {
			hit.HP--
			id := hit.ID
			res.HitShipID = &id
			res.Sunk = !hit.Alive()
		}
		for _, s := range enemy.Ships {
			if s.Alive() && s.Pos.Adjacent(t) {
				res.Splash = true
			}
		}
	case ActionMove:
		if !contains(own.MoveTargets(a.ShipID), a.Target) {
			return Result{}, fmt.Errorf("%w: cannot move ship %d to (%d,%d)", ErrInvalidAction, a.ShipID, a.Target.Row, a.Target.Col)
		}
		res.Direction, res.Distance = direction(ship.Pos, a.Target)
		ship.Pos = a.Target
	default:
		return Result{}, fmt.Errorf("%w: unknown action type %q", ErrInvalidAction, a.Type)
	}

	if side == SidePlayer {
		st.Turn++
	}
	st.History = append(st.History, res)
	st.CPU.Observe(res)
	st.checkEnd(side)
	return res, nil
}

// checkEnd decides the winner; the acting side's opponent is checked first so
// that landing the final blow wins even if the attacker just spent its last shell.
func (st *State) checkEnd(actor Side) {
	for _, s := range []Side{actor.Opponent(), actor} {
		if st.Boards[s].Defeated() {
			st.Status = StatusFinished
			st.Winner = s.Opponent()
			return
		}
	}
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

func contains(ps []Pos, p Pos) bool {
	for _, q := range ps {
		if q == p {
			return true
		}
	}
	return false
}
