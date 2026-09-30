package meta

import (
	"slices"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/game"
)

type ShipView struct {
	OwnedShip
	Stats     game.Spec `json:"stats"`
	Power     int       `json:"power"`
	MaxLevel  int       `json:"maxLevel"`
	NextExp   int       `json:"nextExp"`
	TrainCost int       `json:"trainCost"`
}

// Badges are the red dots on the home screen.
type Badges struct {
	Login        bool `json:"login"`
	Missions     int  `json:"missions"`
	Achievements int  `json:"achievements"`
	FreeTen      bool `json:"freeTen"`
}

type ProfileView struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Comment      string          `json:"comment"`
	Level        int             `json:"level"`
	Exp          int             `json:"exp"`
	NextExp      int             `json:"nextExp"`
	Coins        int             `json:"coins"`
	Gems         int             `json:"gems"`
	Ships        []ShipView      `json:"ships"`
	Fleet        []string        `json:"fleet"`
	FleetSlots   int             `json:"fleetSlots"`
	FleetPower   int             `json:"fleetPower"`
	Secretary    string          `json:"secretary"`
	Stages       map[string]int  `json:"stages"`
	TotalStars   int             `json:"totalStars"`
	Endless      int             `json:"endless"`
	Gacha        GachaState      `json:"gacha"`
	PityLeft     int             `json:"pityLeft"`
	Login        LoginState      `json:"login"`
	Daily        DailyState      `json:"daily"`
	Achievements map[string]bool `json:"achievements"`
	Stats        Stats           `json:"stats"`
	Badges       Badges          `json:"badges"`
	Created      time.Time       `json:"created"`
}

func (p *Profile) View(now time.Time) ProfileView {
	p.rollDaily(now)
	v := ProfileView{
		ID: p.ID, Name: p.Name, Comment: p.Comment, Level: p.Level, Exp: p.Exp, NextExp: ExpToNext(p.Level),
		Coins: p.Coins, Gems: p.Gems, Fleet: p.Fleet, FleetSlots: FleetSlots(p.Level),
		Secretary: p.Secretary, Stages: p.Stages, TotalStars: p.TotalStars(), Endless: p.Endless,
		Gacha: p.Gacha, PityLeft: PityPulls - p.Gacha.Pity, Login: p.Login, Daily: p.Daily,
		Achievements: p.Achievements, Stats: p.Stats, Created: p.Created,
		Badges: Badges{
			Login:        p.LoginReady(now),
			Missions:     p.missionsReady(),
			Achievements: p.achievementsReady(),
			FreeTen:      p.FreeTenReady(),
		},
	}
	inFleet := map[string]bool{}
	for _, u := range p.Fleet {
		inFleet[u] = true
	}
	for _, s := range p.Ships {
		sp := s.Spec()
		sv := ShipView{
			OwnedShip: *s, Stats: sp, Power: Power(sp),
			MaxLevel: ShipMaxLevel(s.Stars), NextExp: ShipExpToNext(s.Level), TrainCost: LevelUpCost(s.Level),
		}
		v.Ships = append(v.Ships, sv)
		if inFleet[s.UID] {
			v.FleetPower += sv.Power
		}
	}
	return v
}

// Catalog is the static game data the client needs.
type Catalog struct {
	Cards        []Card      `json:"cards"`
	Areas        []Area      `json:"areas"`
	Stages       []Stage     `json:"stages"`
	Enemies      []game.Spec `json:"enemies"`
	PullRates    [5]int      `json:"pullRates"`
	PullCost     int         `json:"pullCost"`
	TenPullCost  int         `json:"tenPullCost"`
	PityPulls    int         `json:"pityPulls"`
	Missions     []Mission   `json:"missions"`
	DailyAll     Mission     `json:"dailyAll"`
	Achievements []Mission   `json:"achievements"`
	LoginRewards []Grant     `json:"loginRewards"`
}

func BuildCatalog() Catalog {
	keys := make([]string, 0, len(Enemies))
	for k := range Enemies {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	enemies := enemySpecs(keys)
	return Catalog{
		Cards: Cards, Areas: Areas, Stages: Stages, Enemies: enemies,
		PullRates: PullRates, PullCost: PullCost, TenPullCost: TenPullCost, PityPulls: PityPulls,
		Missions: DailyMissions, DailyAll: DailyAll, Achievements: Achievements, LoginRewards: LoginRewards,
	}
}
