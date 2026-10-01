package game

// Mirroring turns the sea upside down and swaps the side labels, so that the
// second admiral of a duel (SideCPU) is shown the battle as if they were the
// player. Every shape on the sea is symmetric under the flip, so actions
// mean the same on either side of it.

// Mirror flips p to the other end of a size×size sea (row-wise).
func (p Pos) Mirror(size int) Pos { return Pos{size - 1 - p.Row, p.Col} }

// Mirror flips the action's target; an action chosen on a mirrored view is
// played on the real sea through it (and back).
func (a Action) Mirror(size int) Action {
	a.Target = a.Target.Mirror(size)
	return a
}

func mirrorPtr(p *Pos, size int) *Pos {
	if p == nil {
		return nil
	}
	q := p.Mirror(size)
	return &q
}

func mirrorAll(ps []Pos, size int) []Pos {
	if ps == nil {
		return nil
	}
	out := make([]Pos, len(ps))
	for i, p := range ps {
		out[i] = p.Mirror(size)
	}
	return out
}

func (s Side) mirrored() Side {
	switch s {
	case SidePlayer:
		return SideCPU
	case SideCPU:
		return SidePlayer
	}
	return s
}

func (d Direction) mirrored() Direction {
	switch d {
	case North:
		return South
	case South:
		return North
	}
	return d
}

func (r Result) mirrored(size int) Result {
	r.Side = r.Side.mirrored()
	r.Target = mirrorPtr(r.Target, size)
	r.Origin = mirrorPtr(r.Origin, size)
	r.Emitter = mirrorPtr(r.Emitter, size)
	r.Direction = r.Direction.mirrored()
	r.Columns = mirrorAll(r.Columns, size)
	r.Scanned = mirrorAll(r.Scanned, size)
	if r.Shots != nil {
		shots := make([]Shot, len(r.Shots))
		for i, s := range r.Shots {
			s.Target = s.Target.Mirror(size)
			shots[i] = s
		}
		r.Shots = shots
	}
	if r.Paths != nil {
		paths := make([][]Pos, len(r.Paths))
		for i, p := range r.Paths {
			paths[i] = mirrorAll(p, size)
		}
		r.Paths = paths
	}
	if r.Revealed != nil {
		seen := make([]Sighting, len(r.Revealed))
		for i, s := range r.Revealed {
			s.Pos = s.Pos.Mirror(size)
			seen[i] = s
		}
		r.Revealed = seen
	}
	return r
}

func (sv ShipView) mirrored(size int) ShipView {
	sv.Pos = mirrorPtr(sv.Pos, size)
	sv.AttackTargets = mirrorAll(sv.AttackTargets, size)
	sv.TorpedoTargets = mirrorAll(sv.TorpedoTargets, size)
	sv.MoveTargets = mirrorAll(sv.MoveTargets, size)
	sv.SkillTargets = mirrorAll(sv.SkillTargets, size)
	sv.WatchTargets = mirrorAll(sv.WatchTargets, size)
	return sv
}

// mirrored turns a view built for SideCPU into one where that side is the
// player, on the flipped sea.
func (v View) mirrored() View {
	n := v.BoardSize
	v.Winner = v.Winner.mirrored()
	v.LastGun = mirrorPtr(v.LastGun, n)
	ships := func(in []ShipView) []ShipView {
		out := make([]ShipView, len(in))
		for i, s := range in {
			out[i] = s.mirrored(n)
		}
		return out
	}
	v.PlayerShips, v.EnemyShips = ships(v.PlayerShips), ships(v.EnemyShips)
	history := make([]Result, len(v.History))
	for i, r := range v.History {
		history[i] = r.mirrored(n)
	}
	v.History = history
	return v
}
