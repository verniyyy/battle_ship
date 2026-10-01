package meta

import (
	"fmt"
	"time"
)

// Days roll over at midnight Japan time.
var JST = time.FixedZone("JST", 9*60*60)

func dateOf(t time.Time) string { return t.In(JST).Format("2006-01-02") }

// ---- login bonus ----

// LoginRewards is the 7-day cycle; it advances once per day logged in, not per calendar day.
var LoginRewards = []Grant{
	{Gems: 100},
	{Coins: 1500},
	{Gems: 150},
	{Coins: 3000},
	{Gems: 200},
	{Coins: 5000, Gems: 100},
	{Gems: 500},
}

func (p *Profile) LoginReady(now time.Time) bool { return p.Login.Last != dateOf(now) }

// ClaimLogin pays today's login bonus and returns the cycle day it was for.
func (p *Profile) ClaimLogin(now time.Time) (int, Grant, error) {
	if !p.LoginReady(now) {
		return 0, Grant{}, fmt.Errorf("%w: already claimed today", ErrInvalid)
	}
	day := p.Login.Day%len(LoginRewards) + 1
	g := LoginRewards[day-1]
	p.Login = LoginState{Last: dateOf(now), Day: day, Total: p.Login.Total + 1}
	p.give(&g)
	return day, g, nil
}

// ---- daily missions ----
//
// When a feature lands, consider a mission or achievement for it here; see
// "機能追加時の任務" in CLAUDE.md for the rules.

// Stat keys shared by missions, achievements and battle settlement.
const (
	StatBattles   = "battles"
	StatWins      = "wins"
	StatHits      = "hits"
	StatSunk      = "sunk"
	StatCrits     = "crits"
	StatSkills    = "skills"
	StatUltimates = "ultimates"
	StatPulls     = "pulls"
	StatTrain     = "train"
	StatCombo     = "combo"
	StatCollect   = "collection"
	StatStars     = "stars"
	StatLevel     = "level"
	StatEndless   = "endless"
	StatCheers    = "cheers"
	StatFriends   = "friends"
)

type Mission struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Stat  string `json:"stat"`
	Goal  int    `json:"goal"`
	Gems  int    `json:"gems,omitempty"`
	Coins int    `json:"coins,omitempty"`
	// Extra marks a daily mission that needs a friend, so an admiral without
	// one is not kept from the all-clear bonus: DailyAll leaves it out.
	Extra bool `json:"extra,omitempty"`
}

var DailyMissions = []Mission{
	{ID: "d_sortie", Title: "出撃する", Stat: StatBattles, Goal: 3, Gems: 50},
	{ID: "d_win", Title: "戦闘に勝利する", Stat: StatWins, Goal: 2, Gems: 80},
	{ID: "d_hit", Title: "敵艦に命中させる", Stat: StatHits, Goal: 10, Gems: 50},
	{ID: "d_sink", Title: "敵艦を撃沈する", Stat: StatSunk, Goal: 5, Gems: 60},
	{ID: "d_skill", Title: "スキルを使う", Stat: StatSkills, Goal: 3, Coins: 1500},
	{ID: "d_crit", Title: "クリティカルを出す", Stat: StatCrits, Goal: 3, Gems: 40},
	{ID: "d_ult", Title: "全艦斉射を放つ", Stat: StatUltimates, Goal: 1, Gems: 50},
	{ID: "d_train", Title: "艦を強化する", Stat: StatTrain, Goal: 3, Coins: 1000},
	{ID: "d_pull", Title: "建造する", Stat: StatPulls, Goal: 1, Gems: 30},
	{ID: "d_cheer", Title: "フレンドにエールを送る", Stat: StatCheers, Goal: 1, Coins: 1000, Extra: true},
}

// DailyAll pays out once every other daily mission but the extra ones has been claimed.
var DailyAll = Mission{ID: "d_all", Title: "デイリー任務をすべて達成", Goal: countCore(DailyMissions), Gems: 200}

func countCore(ms []Mission) int {
	n := 0
	for _, m := range ms {
		if !m.Extra {
			n++
		}
	}
	return n
}

func (p *Profile) rollDaily(now time.Time) {
	p.normalize()
	if d := dateOf(now); p.Daily.Date != d {
		p.Daily = DailyState{Date: d, Progress: map[string]int{}, Claimed: map[string]bool{}}
	}
}

// bump records daily progress on a stat.
func (p *Profile) bump(now time.Time, stat string, n int) {
	if n <= 0 {
		return
	}
	p.rollDaily(now)
	p.Daily.Progress[stat] += n
}

func (p *Profile) dailyDone() int {
	n := 0
	for _, m := range DailyMissions {
		if !m.Extra && p.Daily.Claimed[m.ID] {
			n++
		}
	}
	return n
}

// MissionProgress returns progress toward a daily mission.
func (p *Profile) MissionProgress(m Mission) int {
	if m.ID == DailyAll.ID {
		return p.dailyDone()
	}
	return p.Daily.Progress[m.Stat]
}

func (p *Profile) ClaimMission(id string, now time.Time) (Grant, error) {
	p.rollDaily(now)
	var m *Mission
	for i := range DailyMissions {
		if DailyMissions[i].ID == id {
			m = &DailyMissions[i]
		}
	}
	if id == DailyAll.ID {
		m = &DailyAll
	}
	switch {
	case m == nil:
		return Grant{}, fmt.Errorf("%w: unknown mission %q", ErrInvalid, id)
	case p.Daily.Claimed[id]:
		return Grant{}, fmt.Errorf("%w: already claimed", ErrInvalid)
	case p.MissionProgress(*m) < m.Goal:
		return Grant{}, fmt.Errorf("%w: mission not complete", ErrInvalid)
	}
	p.Daily.Claimed[id] = true
	g := Grant{Gems: m.Gems, Coins: m.Coins}
	p.give(&g)
	return g, nil
}

func (p *Profile) missionsReady() int {
	n := 0
	for _, m := range append(DailyMissions[:len(DailyMissions):len(DailyMissions)], DailyAll) {
		if !p.Daily.Claimed[m.ID] && p.MissionProgress(m) >= m.Goal {
			n++
		}
	}
	return n
}

// ---- achievements ----

var Achievements = func() []Mission {
	var out []Mission
	add := func(stat, title string, goals, gems []int) {
		for i, g := range goals {
			out = append(out, Mission{ID: fmt.Sprintf("a_%s_%d", stat, g), Title: fmt.Sprintf(title, g), Stat: stat, Goal: g, Gems: gems[i]})
		}
	}
	add(StatWins, "通算 %d 勝", []int{1, 5, 10, 25, 50, 100}, []int{50, 100, 150, 250, 400, 800})
	add(StatSunk, "敵艦を通算 %d 隻撃沈", []int{5, 20, 50, 100, 300}, []int{50, 100, 200, 300, 600})
	add(StatCrits, "クリティカル通算 %d 回", []int{5, 25, 100}, []int{50, 150, 400})
	add(StatCombo, "%d コンボを達成", []int{3, 5, 8}, []int{80, 200, 500})
	add(StatUltimates, "全艦斉射を通算 %d 回", []int{1, 10, 30}, []int{50, 150, 400})
	add(StatPulls, "建造を通算 %d 回", []int{10, 50, 100, 300}, []int{100, 200, 300, 800})
	add(StatCollect, "%d 種類の艦を集める", []int{5, 10, 15, len(Cards)}, []int{100, 200, 400, 1500})
	add(StatStars, "海域の★を %d 個集める", []int{6, 18, 30, 3 * len(Stages)}, []int{100, 200, 400, 1000})
	add(StatLevel, "提督レベル %d に到達", []int{5, 10, 20, 30}, []int{100, 200, 400, 800})
	add(StatEndless, "無限海域 第 %d 層を突破", []int{5, 10, 20, 30}, []int{200, 400, 800, 1500})
	add(StatFriends, "フレンドを %d 人つくる", []int{1, 5, 10, 20}, []int{50, 100, 200, 400})
	add(StatCheers, "フレンドにエールを通算 %d 回送る", []int{10, 50, 150, 300}, []int{50, 150, 300, 600})
	return out
}()

func (p *Profile) statValue(stat string) int {
	switch stat {
	case StatWins:
		return p.Stats.Wins
	case StatSunk:
		return p.Stats.Sunk
	case StatCrits:
		return p.Stats.Crits
	case StatCombo:
		return p.Stats.MaxCombo
	case StatUltimates:
		return p.Stats.Ultimates
	case StatPulls:
		return p.Gacha.Pulls
	case StatCollect:
		return len(p.Ships)
	case StatStars:
		return p.TotalStars()
	case StatLevel:
		return p.Level
	case StatEndless:
		return p.Endless
	case StatFriends:
		return p.Stats.PeakFriends
	case StatCheers:
		return p.Stats.Cheers
	}
	return 0
}

// AchievementProgress returns lifetime progress toward an achievement.
func (p *Profile) AchievementProgress(m Mission) int { return p.statValue(m.Stat) }

func (p *Profile) ClaimAchievement(id string) (Grant, error) {
	p.normalize()
	for _, m := range Achievements {
		if m.ID != id {
			continue
		}
		if p.Achievements[id] {
			return Grant{}, fmt.Errorf("%w: already claimed", ErrInvalid)
		}
		if p.statValue(m.Stat) < m.Goal {
			return Grant{}, fmt.Errorf("%w: achievement not reached", ErrInvalid)
		}
		p.Achievements[id] = true
		g := Grant{Gems: m.Gems, Coins: m.Coins}
		p.give(&g)
		return g, nil
	}
	return Grant{}, fmt.Errorf("%w: unknown achievement %q", ErrInvalid, id)
}

func (p *Profile) achievementsReady() int {
	n := 0
	for _, m := range Achievements {
		if !p.Achievements[m.ID] && p.statValue(m.Stat) >= m.Goal {
			n++
		}
	}
	return n
}
