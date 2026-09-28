package meta

import (
	"fmt"
	"math/rand/v2"
	"time"
)

var cardsByRarity = func() [5][]string {
	var out [5][]string
	for _, c := range Cards {
		out[c.Rarity] = append(out[c.Rarity], c.ID)
	}
	return out
}()

func rollRarity(rng *rand.Rand, weights [5]int, floor Rarity) Rarity {
	total := 0
	for r := floor; r <= UR; r++ {
		total += weights[r]
	}
	if total == 0 {
		return floor
	}
	n := rng.IntN(total)
	for r := floor; r <= UR; r++ {
		if n < weights[r] {
			return r
		}
		n -= weights[r]
	}
	return UR
}

func randomCard(rng *rand.Rand, r Rarity) string {
	pool := cardsByRarity[r]
	return pool[rng.IntN(len(pool))]
}

// FreeTenReady reports whether the welcome 10-pull is still unused.
func (p *Profile) FreeTenReady() bool { return !p.Gacha.FreeTen }

// Pull builds count (1 or 10) ships. A 10-pull guarantees at least one SR,
// and PityPulls pulls without an SSR guarantee one.
func (p *Profile) Pull(count int, rng *rand.Rand, now time.Time) ([]Gain, error) {
	cost := 0
	switch {
	case count == 10 && p.FreeTenReady():
		p.Gacha.FreeTen = true
	case count == 10:
		cost = TenPullCost
	case count == 1:
		cost = PullCost
	default:
		return nil, fmt.Errorf("%w: pull 1 or 10", ErrInvalid)
	}
	if p.Gems < cost {
		return nil, ErrInsufficient
	}
	p.Gems -= cost

	out := make([]Gain, 0, count)
	bestSoFar := N
	for i := 0; i < count; i++ {
		floor := N
		switch {
		case p.Gacha.Pity+1 >= PityPulls:
			floor = SSR
		case count == 10 && i == count-1 && bestSoFar < SR:
			floor = SR
		}
		r := rollRarity(rng, PullRates, floor)
		bestSoFar = max(bestSoFar, r)
		p.Gacha.Pulls++
		if r >= SSR {
			p.Gacha.Pity = 0
		} else {
			p.Gacha.Pity++
		}
		out = append(out, p.addCard(randomCard(rng, r), now))
	}
	p.bump(now, StatPulls, count)
	return out, nil
}
