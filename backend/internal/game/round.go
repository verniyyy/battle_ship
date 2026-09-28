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
	st.endRound()
	return out
}

// Initiative orders the sides: torpedo launches go last, then faster ships
// first; ties are a coin flip.
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
			e.late, e.speed = a.Late(s.Spec), s.Spec.Speed
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
		res.Speed, res.Late = s.Spec.Speed, a.Late(s.Spec)
	}
	st.History = append(st.History, res)
	return res
}

// endRound counts the round, lets water columns settle and, when the turn
// limit is reached, judges the battle on the share of hull left.
func (st *State) endRound() {
	st.Turn++
	for _, b := range st.Boards {
		for _, s := range b.Ships {
			s.Pinned = max(s.Pinned-1, 0)
		}
	}
	if st.Status == StatusInProgress && st.MaxTurns > 0 && st.Turn >= st.MaxTurns {
		st.judge()
	}
}
