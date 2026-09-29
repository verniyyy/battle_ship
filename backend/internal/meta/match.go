package meta

import (
	"fmt"
	"math/rand/v2"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/game"
)

// Match is one sortie: the battle plus who fought it, where, and what it paid.
type Match struct {
	Game     *game.State `json:"game"`
	PlayerID string      `json:"playerId"`
	Stage    Stage       `json:"stage"`
	// Fleet maps player ship IDs to roster UIDs.
	Fleet  []string `json:"fleet"`
	Reward *Reward  `json:"reward,omitempty"`
}

// NewMatch sets up a battle on stageID with the admiral's current formation.
func NewMatch(p *Profile, stageID string, placements []game.Pos, rng *rand.Rand) (*Match, error) {
	var stage Stage
	switch s, ok := StageByID(stageID); {
	case stageID == EndlessID && p.Unlocked(EndlessID):
		stage = EndlessStage(p.Endless + 1)
	case ok && p.Unlocked(stageID):
		stage = *s
	default:
		return nil, fmt.Errorf("%w: stage %q is locked or unknown", ErrInvalid, stageID)
	}
	player, err := game.NewBoard(stage.Size, p.FleetSpecs(), placements)
	if err != nil {
		return nil, err
	}
	enemies := stage.EnemySpecs()
	cpu, err := game.NewBoard(stage.Size, enemies, game.RandomPlacement(rng, stage.Size, len(enemies), placements...))
	if err != nil {
		return nil, err
	}
	return &Match{
		Game:     game.NewState(player, cpu, stage.MaxTurns, game.AI{Level: stage.AI}, rollWeather(rng)),
		PlayerID: p.ID,
		Stage:    stage,
		Fleet:    append([]string{}, p.Fleet...),
	}, nil
}

// rollWeather picks the sea condition: calm about half the time, otherwise
// fog, storm or night, so the same stage never plays out the same way twice.
func rollWeather(rng *rand.Rand) game.Weather {
	if rng.IntN(100) < 46 {
		return game.Clear
	}
	return game.Weathers[1+rng.IntN(len(game.Weathers)-1)]
}

type Rank string

// Line is one itemised row of the reward breakdown.
type Line struct {
	Label string `json:"label"`
	Coins int    `json:"coins,omitempty"`
	Gems  int    `json:"gems,omitempty"`
}

type ShipGrowth struct {
	UID  string `json:"uid"`
	Card string `json:"card"`
	From int    `json:"from"`
	To   int    `json:"to"`
	Exp  int    `json:"exp"`
	MVP  bool   `json:"mvp,omitempty"`
}

// Chest tiers: 0 common, 1 rare, 2 jackpot.
type Chest struct {
	Tier  int   `json:"tier"`
	Grant Grant `json:"grant"`
}

type BattleStats struct {
	Hits      int `json:"hits"`
	Shots     int `json:"shots"`
	Crits     int `json:"crits"`
	Sunk      int `json:"sunk"`
	Lost      int `json:"lost"`
	Skills    int `json:"skills"`
	Ultimates int `json:"ultimates"`
	MaxCombo  int `json:"maxCombo"`
}

type Reward struct {
	Win       bool           `json:"win"`
	Rank      Rank           `json:"rank"`
	EndReason game.EndReason `json:"endReason"`
	Turns     int            `json:"turns"`
	Stars     int            `json:"stars"`    // bitmask earned this battle
	NewStars  int            `json:"newStars"` // bits earned for the first time
	Floor     int            `json:"floor,omitempty"`
	Record    bool           `json:"record,omitempty"` // new deepest endless floor
	Streak    int            `json:"streak"`
	Stats     BattleStats    `json:"stats"`
	MVP       int            `json:"mvp"` // player ship ID, -1 for none

	Lines []Line `json:"lines"`
	Coins int    `json:"coins"`
	Gems  int    `json:"gems"`
	Exp   int    `json:"exp"`

	FromLevel int      `json:"fromLevel"`
	FromExp   int      `json:"fromExp"`
	ToLevel   int      `json:"toLevel"`
	ToExp     int      `json:"toExp"`
	LevelUp   *LevelUp `json:"levelUp,omitempty"`

	Ships []ShipGrowth `json:"ships"`
	Drop  *Gain        `json:"drop,omitempty"`

	Chests []Chest `json:"chests"` // only a win offers chests
	Picked int     `json:"picked"` // -1 until a chest is opened
}

var rankMult = map[Rank]float64{"S": 1.5, "A": 1.25, "B": 1, "C": 1, "D": 1, "E": 1}

func battleStats(st *game.State) (BattleStats, []int) {
	var bs BattleStats
	score := make([]int, len(st.Boards[game.SidePlayer].Ships))
	for _, r := range st.History {
		if r.Side != game.SidePlayer {
			continue
		}
		bs.Shots += len(r.Shots)
		bs.Hits += r.Hits()
		bs.Crits += r.Crits()
		bs.Sunk += r.Sinks()
		switch r.Type {
		case game.ActionSkill:
			bs.Skills++
		case game.ActionUltimate:
			bs.Ultimates++
		}
		score[r.ShipID] += 2*r.Hits() + 3*r.Sinks() + r.Crits() + len(r.Revealed)
	}
	bs.MaxCombo = st.MaxCombo[game.SidePlayer]
	for _, s := range st.Boards[game.SidePlayer].Ships {
		if !s.Alive() {
			bs.Lost++
		}
	}
	return bs, score
}

func rankOf(win bool, bs BattleStats, fast bool, enemies int) Rank {
	switch {
	case win && bs.Lost == 0 && fast:
		return "S"
	case win && (bs.Lost == 0 || fast):
		return "A"
	case win:
		return "B"
	case bs.Sunk*2 >= enemies:
		return "C"
	case bs.Sunk > 0:
		return "D"
	default:
		return "E"
	}
}

// Settle computes and pays out the reward for a finished match. It is a no-op
// once the reward exists, so it is safe to call on every request.
func Settle(m *Match, p *Profile, rng *rand.Rand, now time.Time) *Reward {
	st := m.Game
	if st.Status != game.StatusFinished || m.Reward != nil {
		return m.Reward
	}
	p.normalize()
	stage := m.Stage
	win := st.Winner == game.SidePlayer
	bs, score := battleStats(st)
	fast := st.Turn <= stage.StarTurns
	rw := &Reward{
		Win: win, EndReason: st.EndReason, Turns: st.Turn, Stats: bs, MVP: -1, Picked: -1,
		Rank:      rankOf(win, bs, fast, len(st.Boards[game.SideCPU].Ships)),
		FromLevel: p.Level, FromExp: p.Exp,
	}
	best := 0
	for i, s := range score {
		if s > best {
			best, rw.MVP = s, i
		}
	}

	// ---- lifetime stats and daily missions ----
	p.Stats.Battles++
	if win {
		p.Stats.Wins++
		p.Stats.Streak++
		p.Stats.BestStreak = max(p.Stats.BestStreak, p.Stats.Streak)
	} else {
		p.Stats.Losses++
		p.Stats.Streak = 0
	}
	rw.Streak = p.Stats.Streak
	p.Stats.Hits += bs.Hits
	p.Stats.Crits += bs.Crits
	p.Stats.Sunk += bs.Sunk
	p.Stats.Skills += bs.Skills
	p.Stats.Ultimates += bs.Ultimates
	p.Stats.MaxCombo = max(p.Stats.MaxCombo, bs.MaxCombo)
	for stat, n := range map[string]int{
		StatBattles: 1, StatHits: bs.Hits, StatSunk: bs.Sunk, StatCrits: bs.Crits,
		StatSkills: bs.Skills, StatUltimates: bs.Ultimates,
	} {
		p.bump(now, stat, n)
	}
	if win {
		p.bump(now, StatWins, 1)
	}

	// ---- currencies ----
	add := func(label string, coins, gems int) {
		if coins == 0 && gems == 0 {
			return
		}
		rw.Lines = append(rw.Lines, Line{label, coins, gems})
		rw.Coins += coins
		rw.Gems += gems
	}
	if win {
		base := stage.Coins
		add("作戦報酬", base, 0)
		add(fmt.Sprintf("評価 %s ボーナス", rw.Rank), int(float64(base)*(rankMult[rw.Rank]-1)), 0)
		if s := min(p.Stats.Streak, 11); s > 1 {
			add(fmt.Sprintf("%d 連勝ボーナス", p.Stats.Streak), base*(s-1)/10, 0)
		}
	} else {
		add("参加報酬", stage.Coins/5, 0)
	}
	if bs.MaxCombo >= 2 {
		add(fmt.Sprintf("最大 %d コンボ", bs.MaxCombo), bs.MaxCombo*bs.MaxCombo*25, 0)
	}
	add(fmt.Sprintf("クリティカル ×%d", bs.Crits), bs.Crits*40, 0)

	if stage.ID == EndlessID {
		rw.Floor = stage.Floor
		if win && stage.Floor > p.Endless {
			p.Endless = stage.Floor
			rw.Record = true
			add("最深記録更新", 0, 30+stage.FirstGems)
		}
	} else {
		if win {
			rw.Stars = 1
			if fast {
				rw.Stars |= 2
			}
			if bs.Lost == 0 {
				rw.Stars |= 4
			}
		}
		prev := p.Stages[stage.ID]
		rw.NewStars = rw.Stars &^ prev
		p.Stages[stage.ID] = prev | rw.Stars
		if rw.NewStars&1 != 0 {
			add("初回クリア", 0, stage.FirstGems)
		}
		if n := popcount(rw.NewStars &^ 1); n > 0 {
			add(fmt.Sprintf("★ 達成 ×%d", n), 0, 50*n)
		}
	}

	// ---- experience ----
	rw.Exp = stage.Exp * 2 / 5
	if win {
		rw.Exp = int(float64(stage.Exp) * rankMult[rw.Rank])
	}
	for i, uid := range m.Fleet {
		s := p.Ship(uid)
		if s == nil {
			continue
		}
		exp := stage.Exp * 3 / 10
		if win {
			exp = stage.Exp * 3 / 5
		}
		if i == rw.MVP {
			exp = exp * 3 / 2
		}
		from, to := shipGainExp(s, exp)
		rw.Ships = append(rw.Ships, ShipGrowth{UID: uid, Card: s.Card, From: from, To: to, Exp: exp, MVP: i == rw.MVP})
	}

	// ---- drop ----
	if win && rng.IntN(100) < stage.DropRate {
		g := p.addCard(randomCard(rng, rollRarity(rng, stage.DropWeights, N)), now)
		rw.Drop = &g
	}

	rw.LevelUp = p.give(&Grant{Coins: rw.Coins, Gems: rw.Gems, Exp: rw.Exp})
	rw.ToLevel, rw.ToExp = p.Level, p.Exp
	if win {
		rw.Chests = rollChests(rng, stage)
	}
	m.Reward = rw
	return rw
}

func popcount(n int) int {
	c := 0
	for ; n > 0; n >>= 1 {
		c += n & 1
	}
	return c
}

func rollChest(rng *rand.Rand, stage Stage, tier int) Chest {
	c := Chest{Tier: tier}
	switch tier {
	case 0:
		if rng.IntN(3) == 0 {
			c.Grant.Gems = 10 * (1 + rng.IntN(3))
		} else {
			c.Grant.Coins = stage.Coins * (2 + rng.IntN(3)) / 5
		}
	case 1:
		if rng.IntN(2) == 0 {
			c.Grant.Gems = 50
		} else {
			c.Grant.Coins = stage.Coins * 2
		}
	default:
		if rng.IntN(3) == 0 {
			c.Grant.Cards = []Gain{{Card: randomCard(rng, rollRarity(rng, PullRates, SR))}}
		} else {
			c.Grant.Gems = 200
		}
	}
	return c
}

// rollChests fills the three chests a win offers. When none is a jackpot, one often is
// swapped in so the chests left unopened keep the next pick tempting.
func rollChests(rng *rand.Rand, stage Stage) []Chest {
	out := make([]Chest, 3)
	jackpot := false
	for i := range out {
		n := rng.IntN(100)
		tier := 0
		switch {
		case n < 6:
			tier = 2
		case n < 30:
			tier = 1
		}
		jackpot = jackpot || tier == 2
		out[i] = rollChest(rng, stage, tier)
	}
	if !jackpot && rng.IntN(100) < 45 {
		out[rng.IntN(3)] = rollChest(rng, stage, 2)
	}
	return out
}

// OpenChest opens chest i and pays it out.
func OpenChest(m *Match, p *Profile, i int, now time.Time) (*Chest, error) {
	rw := m.Reward
	switch {
	case rw == nil:
		return nil, fmt.Errorf("%w: battle is not over", ErrInvalid)
	case rw.Picked >= 0:
		return nil, fmt.Errorf("%w: a chest was already opened", ErrInvalid)
	case i < 0 || i >= len(rw.Chests):
		return nil, fmt.Errorf("%w: no chest %d", ErrInvalid, i)
	}
	rw.Picked = i
	c := &rw.Chests[i]
	for j, g := range c.Grant.Cards {
		c.Grant.Cards[j] = p.addCard(g.Card, now)
	}
	p.give(&c.Grant)
	return c, nil
}

// Public hides unopened chest contents.
func (r *Reward) Public() *Reward {
	if r == nil || r.Picked >= 0 {
		return r
	}
	cp := *r
	cp.Chests = make([]Chest, len(r.Chests))
	return &cp
}
