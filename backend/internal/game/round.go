package game

import (
	"cmp"
	"math/rand/v2"
	"slices"
)

// Round plays one round: the player's action and the CPU's, which the CPU
// commits without seeing the player's, resolved in initiative order. It
// returns the results in the order they happened.
func (st *State) Round(player Action, rng *rand.Rand) ([]Result, error) {
	if err := st.Legal(SidePlayer, player); err != nil {
		return nil, err
	}
	cpu := st.Decide(SideCPU, rng)
	return st.Resolve(map[Side]Action{SidePlayer: player, SideCPU: cpu}, rng), nil
}

// Resolve plays both committed actions in initiative order and closes the round.
func (st *State) Resolve(acts map[Side]Action, rng *rand.Rand) []Result {
	var out []Result
	for _, side := range st.Initiative(acts, rng) {
		if st.Status != StatusInProgress {
			break
		}
		a := acts[side]
		res, err := st.Apply(side, a, rng)
		if err != nil {
			// The ship went down before it could act, or the move was blocked.
			res = st.cancel(side, a)
		}
		out = append(out, res)
	}
	return append(out, st.endRound(out)...)
}

// Initiative orders the sides: late actions (torpedo launches, moves by a
// ship still under way) go last, then faster ships first; ties are a coin flip.
func (st *State) Initiative(acts map[Side]Action, rng *rand.Rand) []Side {
	type entry struct {
		side  Side
		late  bool
		speed int
		coin  int
	}
	var es []entry
	for _, side := range []Side{SidePlayer, SideCPU} {
		a, ok := acts[side]
		if !ok {
			continue
		}
		e := entry{side: side, coin: rng.IntN(1 << 16)}
		if s, err := st.Boards[side].ship(a.ShipID); err == nil {
			e.late, e.speed = a.Late(s), s.Spec.Speed
		}
		es = append(es, e)
	}
	slices.SortFunc(es, func(a, b entry) int {
		switch {
		case a.late != b.late:
			if a.late {
				return 1
			}
			return -1
		case a.speed != b.speed:
			return cmp.Compare(b.speed, a.speed)
		}
		return cmp.Compare(a.coin, b.coin)
	})
	out := make([]Side, len(es))
	for i, e := range es {
		out[i] = e.side
	}
	return out
}

func (st *State) cancel(side Side, a Action) Result {
	res := Result{Side: side, Type: a.Type, ShipID: a.ShipID, Round: st.Turn + 1, Cancelled: true,
		Combo: st.Combo[side], Gauge: st.Gauge[side]}
	if s, err := st.Boards[side].ship(a.ShipID); err == nil {
		res.Speed, res.Late = s.Spec.Speed, a.Late(s)
	}
	st.History = append(st.History, res)
	return res
}

// endRound counts the round, lets water columns settle and ships come to
// rest, sends scout planes out after a quiet spell and, when the turn limit
// is reached, judges the battle on the share of hull left. It returns the
// scout reports.
func (st *State) endRound(played []Result) []Result {
	var reports []Result
	if st.Status == StatusInProgress {
		reports = st.recon(played)
	}
	st.Turn++
	for _, b := range st.Boards {
		for _, s := range b.Ships {
			s.Pinned = max(s.Pinned-1, 0)
			s.Sailed = max(s.Sailed-1, 0)
			s.Marked = max(s.Marked-1, 0)
		}
	}
	if st.Status == StatusInProgress && st.MaxTurns > 0 && st.Turn >= st.MaxTurns {
		st.judge()
	}
	return reports
}

// recon counts quiet rounds and, once reconAfter of them pass in a row, has
// each side's scout planes spot the untracked enemy surface ship nearest to
// its fleet. Submarines stay hidden: only sonar finds them.
func (st *State) recon(played []Result) []Result {
	st.Quiet++
	for _, r := range played {
		if r.Damage() > 0 {
			st.Quiet = 0
		}
	}
	if st.Quiet < reconAfter {
		return nil
	}
	st.Quiet = 0
	var out []Result
	for _, side := range []Side{SidePlayer, SideCPU} {
		own, enemy := st.Boards[side], st.Boards[side.Opponent()]
		var found *Ship
		best := 0
		for _, e := range enemy.Ships {
			if _, tracked := st.Intel[side][key(e.ID)]; tracked || !e.Alive() || !e.Spec.Surface() {
				continue
			}
			d := own.distance(e.Pos)
			if found == nil || d < best {
				found, best = e, d
			}
		}
		if found == nil {
			continue
		}
		res := Result{Side: side, Type: ActionRecon, ShipID: -1, Round: st.Turn + 1,
			Revealed: []Sighting{{ShipID: found.ID, Pos: found.Pos, Turn: st.Turn + 1}},
			Combo:    st.Combo[side], Gauge: st.Gauge[side]}
		st.learn(res)
		st.History = append(st.History, res)
		out = append(out, res)
	}
	return out
}
