package meta

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/verniyyy/battle_ship/backend/internal/game"
)

var (
	ErrInvalid      = errors.New("invalid request")
	ErrInsufficient = errors.New("not enough resources")
)

// OwnedShip is one card in the admiral's roster.
type OwnedShip struct {
	UID      string    `json:"uid"`
	Card     string    `json:"card"`
	Level    int       `json:"level"`
	Exp      int       `json:"exp"`
	Stars    int       `json:"stars"` // limit breaks, 0..MaxStars
	Obtained time.Time `json:"obtained"`
}

// Spec resolves the ship's battle stats from its card, level and limit breaks.
//
// Levels grow the main numbers continuously (+0.6% per level, so Lv.50 is
// about +30% over Lv.1) and add a salvo, a torpedo or a skill use at
// milestones. Limit breaks mostly raise the level cap; on their own they add
// only a little crit and, at ★5, one more skill use, so duplicates from the
// gacha never decide a battle.
func (o *OwnedShip) Spec() game.Spec {
	c := cardIndex[o.Card]
	sp := game.Spec{Key: c.ID, Class: c.Class, Name: c.Name, Rarity: int(c.Rarity), Stats: c.Stats}
	lv, st := o.Level, o.Stars
	grow := func(v int) int { return v * (1000 + 6*(lv-1)) / 1000 }
	for _, f := range []*int{&sp.HP, &sp.Firepower, &sp.Torpedo, &sp.Air, &sp.AA} {
		*f = grow(*f)
	}
	for _, b := range []struct {
		ok    bool
		field *int
	}{
		{lv >= 10 && sp.Ammo > 0, &sp.Ammo}, {lv >= 20 && sp.Torps > 0, &sp.Torps}, {lv >= 25, &sp.Skill},
		{lv >= 30 && sp.Ammo > 0, &sp.Ammo}, {st >= 5, &sp.Skill},
	} {
		if b.ok {
			*b.field++
		}
	}
	sp.Crit += lv/10 + st
	return sp
}

// Power is a single number summarising a ship, shown as 戦力.
func Power(sp game.Spec) int {
	return sp.HP/2 + sp.Firepower + sp.Torpedo*3/5 + sp.Air*4/5 + sp.AA + sp.Armor*3 + sp.Speed*3 +
		sp.Ammo*20 + sp.Torps*30 + sp.Skill*40 + sp.Crit*4 + sp.Evasion*4
}

type GachaState struct {
	Pity    int  `json:"pity"`  // pulls since the last SSR or better
	Pulls   int  `json:"pulls"` // lifetime
	FreeTen bool `json:"freeTenUsed"`
}

type LoginState struct {
	Last  string `json:"last"`  // JST date of the last claim
	Day   int    `json:"day"`   // day in the 7-day cycle last claimed, 1..7
	Total int    `json:"total"` // lifetime login days
}

type DailyState struct {
	Date     string          `json:"date"`
	Progress map[string]int  `json:"progress"`
	Claimed  map[string]bool `json:"claimed"`
}

type Stats struct {
	Battles    int `json:"battles"`
	Wins       int `json:"wins"`
	Losses     int `json:"losses"`
	Streak     int `json:"streak"`
	BestStreak int `json:"bestStreak"`
	Sunk       int `json:"sunk"`
	Hits       int `json:"hits"`
	Crits      int `json:"crits"`
	MaxCombo   int `json:"maxCombo"`
	Ultimates  int `json:"ultimates"`
	Skills     int `json:"skills"`
	SSRs       int `json:"ssrs"`
}

// Profile is everything persistent about one admiral.
type Profile struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Comment      string          `json:"comment,omitempty"` // one line shown on the admiral's card
	Unnamed      bool            `json:"unnamed,omitempty"` // a new admiral who has yet to choose a name
	Level        int             `json:"level"`
	Exp          int             `json:"exp"`
	Coins        int             `json:"coins"`
	Gems         int             `json:"gems"`
	Ships        []*OwnedShip    `json:"ships"`
	Fleet        []string        `json:"fleet"`
	Secretary    string          `json:"secretary"`
	Stages       map[string]int  `json:"stages"`  // star bitmask per stage
	Endless      int             `json:"endless"` // deepest endless floor cleared
	Gacha        GachaState      `json:"gacha"`
	Login        LoginState      `json:"login"`
	Daily        DailyState      `json:"daily"`
	Achievements map[string]bool `json:"achievements"` // claimed
	Stats        Stats           `json:"stats"`
	NextUID      int             `json:"nextUid"`
	Created      time.Time       `json:"created"`
}

const (
	StartGems  = 1500
	StartCoins = 2000
)

func NewProfile(id string, now time.Time) *Profile {
	p := &Profile{
		ID: id, Name: "提督", Unnamed: true, Level: 1, Coins: StartCoins, Gems: StartGems,
		Stages: map[string]int{}, Achievements: map[string]bool{}, Created: now,
	}
	for _, c := range StarterCards {
		g := p.addCard(c, now)
		p.Fleet = append(p.Fleet, g.UID)
	}
	p.Secretary = p.Fleet[1]
	p.rollDaily(now)
	return p
}

// normalize fills maps that old or hand-edited profiles may lack.
func (p *Profile) normalize() {
	if p.Stages == nil {
		p.Stages = map[string]int{}
	}
	if p.Achievements == nil {
		p.Achievements = map[string]bool{}
	}
	if p.Daily.Progress == nil {
		p.Daily.Progress = map[string]int{}
	}
	if p.Daily.Claimed == nil {
		p.Daily.Claimed = map[string]bool{}
	}
}

func (p *Profile) Ship(uid string) *OwnedShip {
	for _, s := range p.Ships {
		if s.UID == uid {
			return s
		}
	}
	return nil
}

func (p *Profile) shipByCard(card string) *OwnedShip {
	for _, s := range p.Ships {
		if s.Card == card {
			return s
		}
	}
	return nil
}

// Gain is a card obtained from gacha, a drop or a chest.
type Gain struct {
	Card   string `json:"card"`
	UID    string `json:"uid"`
	Rarity Rarity `json:"rarity"`
	New    bool   `json:"new"`
	Stars  int    `json:"stars"`          // limit breaks after this gain
	Gems   int    `json:"gems,omitempty"` // compensation when already maxed
}

// addCard adds a card to the roster; duplicates limit-break the owned copy.
func (p *Profile) addCard(card string, now time.Time) Gain {
	c := cardIndex[card]
	if c.Rarity >= SSR {
		p.Stats.SSRs++
	}
	if s := p.shipByCard(card); s != nil {
		g := Gain{Card: card, UID: s.UID, Rarity: c.Rarity}
		if s.Stars < MaxStars {
			s.Stars++
		} else {
			g.Gems = OverflowGems
			p.Gems += OverflowGems
		}
		g.Stars = s.Stars
		return g
	}
	p.NextUID++
	s := &OwnedShip{UID: "s" + strconv.Itoa(p.NextUID), Card: card, Level: 1, Obtained: now}
	p.Ships = append(p.Ships, s)
	return Gain{Card: card, UID: s.UID, Rarity: c.Rarity, New: true}
}

// Grant is a bundle of currencies and cards handed to the admiral.
type Grant struct {
	Coins int    `json:"coins,omitempty"`
	Gems  int    `json:"gems,omitempty"`
	Exp   int    `json:"exp,omitempty"`
	Cards []Gain `json:"cards,omitempty"`
}

func (p *Profile) give(g *Grant) *LevelUp {
	p.Coins += g.Coins
	p.Gems += g.Gems
	return p.gainExp(g.Exp)
}

// LevelUp reports an admiral level-up and the bonus it paid out.
type LevelUp struct {
	From  int `json:"from"`
	To    int `json:"to"`
	Gems  int `json:"gems"`
	Coins int `json:"coins"`
}

const (
	levelUpGems  = 100
	levelUpCoins = 500
)

func (p *Profile) gainExp(n int) *LevelUp {
	if n <= 0 {
		return nil
	}
	from := p.Level
	p.Exp += n
	for p.Exp >= ExpToNext(p.Level) {
		p.Exp -= ExpToNext(p.Level)
		p.Level++
	}
	if p.Level == from {
		return nil
	}
	up := &LevelUp{From: from, To: p.Level, Gems: levelUpGems * (p.Level - from), Coins: levelUpCoins * (p.Level - from)}
	p.Gems += up.Gems
	p.Coins += up.Coins
	return up
}

// shipGainExp levels a ship up to its cap and returns the levels before and after.
func shipGainExp(s *OwnedShip, n int) (int, int) {
	from := s.Level
	s.Exp += n
	for s.Level < ShipMaxLevel(s.Stars) && s.Exp >= ShipExpToNext(s.Level) {
		s.Exp -= ShipExpToNext(s.Level)
		s.Level++
	}
	if s.Level >= ShipMaxLevel(s.Stars) {
		s.Exp = 0
	}
	return from, s.Level
}

// SetFleet replaces the formation. Order is deployment order; the first ship is the flagship.
func (p *Profile) SetFleet(uids []string) error {
	if len(uids) == 0 || len(uids) > FleetSlots(p.Level) {
		return fmt.Errorf("%w: fleet needs 1 to %d ships", ErrInvalid, FleetSlots(p.Level))
	}
	seen := map[string]bool{}
	for _, u := range uids {
		if p.Ship(u) == nil || seen[u] {
			return fmt.Errorf("%w: bad ship %q", ErrInvalid, u)
		}
		seen[u] = true
	}
	p.Fleet = append([]string{}, uids...)
	return nil
}

const (
	MaxNameLen    = 12
	MaxCommentLen = 40
)

// Rename sets the admiral's name and one-line comment, both trimmed.
func (p *Profile) Rename(name, comment string) error {
	name, comment = strings.TrimSpace(name), strings.TrimSpace(comment)
	switch n := utf8.RuneCountInString(name); {
	case n == 0 || n > MaxNameLen:
		return fmt.Errorf("%w: name needs 1 to %d characters", ErrInvalid, MaxNameLen)
	case utf8.RuneCountInString(comment) > MaxCommentLen:
		return fmt.Errorf("%w: comment is over %d characters", ErrInvalid, MaxCommentLen)
	case !printable(name) || !printable(comment):
		return fmt.Errorf("%w: control characters are not allowed", ErrInvalid)
	}
	p.Name, p.Comment, p.Unnamed = name, comment, false
	return nil
}

func printable(s string) bool {
	return utf8.ValidString(s) && !strings.ContainsFunc(s, unicode.IsControl)
}

func (p *Profile) SetSecretary(uid string) error {
	if p.Ship(uid) == nil {
		return fmt.Errorf("%w: unknown ship %q", ErrInvalid, uid)
	}
	p.Secretary = uid
	return nil
}

// Train buys up to levels ship levels with coins, stopping at the level cap
// or when the coins run out; levels <= 0 buys as many as that allows. It
// returns how many levels were bought, and fails when not even one was.
func (p *Profile) Train(uid string, levels int, now time.Time) (int, error) {
	s := p.Ship(uid)
	if s == nil {
		return 0, fmt.Errorf("%w: unknown ship %q", ErrInvalid, uid)
	}
	if s.Level >= ShipMaxLevel(s.Stars) {
		return 0, fmt.Errorf("%w: ship is at its level cap", ErrInvalid)
	}
	to, cost := TrainReach(s.Level, ShipMaxLevel(s.Stars), p.Coins, levels)
	if to == s.Level {
		return 0, ErrInsufficient
	}
	n := to - s.Level
	p.Coins -= cost
	s.Level = to
	s.Exp = 0
	p.bump(now, StatTrain, n)
	return n, nil
}

// TrainReach is the level training from lv reaches with coins, at most
// levels levels (all when levels <= 0) and never past maxLv, and its price.
func TrainReach(lv, maxLv, coins, levels int) (int, int) {
	to, cost := lv, 0
	for to < maxLv && (levels <= 0 || to-lv < levels) && cost+LevelUpCost(to) <= coins {
		cost += LevelUpCost(to)
		to++
	}
	return to, cost
}

// FleetSpecs resolves the formation into battle specs.
func (p *Profile) FleetSpecs() []game.Spec {
	out := make([]game.Spec, len(p.Fleet))
	for i, u := range p.Fleet {
		out[i] = p.Ship(u).Spec()
	}
	return out
}

// Unlocked reports whether a campaign stage (or endless) is open.
func (p *Profile) Unlocked(id string) bool {
	if id == EndlessID {
		return p.Stages[Stages[len(Stages)-1].ID]&1 != 0
	}
	for i, s := range Stages {
		if s.ID == id {
			return i == 0 || p.Stages[Stages[i-1].ID]&1 != 0
		}
	}
	return false
}

// TotalStars counts campaign stars earned.
func (p *Profile) TotalStars() int {
	n := 0
	for _, s := range Stages {
		m := p.Stages[s.ID]
		for m > 0 {
			n += m & 1
			m >>= 1
		}
	}
	return n
}
