package meta

import (
	"strings"
	"time"
)

// Friends are admirals who have agreed to be on each other's list. They find
// each other by friend code, a short code each admiral is given, so the
// player id itself never has to be shared. Once a day an admiral may send each
// friend a cheer, which the friend collects for coins.
const (
	MaxFriends = 30
	// MaxOutgoing caps the requests an admiral has waiting for an answer, and
	// MaxIncoming those waiting on one admiral, so nobody can be flooded.
	MaxOutgoing = 20
	MaxIncoming = 50
	CheerCoins  = 200

	// FriendCodeLen is a friend code's length; the alphabet leaves out the
	// look-alikes 0/O and 1/I, and the database draws codes from it.
	FriendCodeLen      = 8
	friendCodeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
)

// Refusal is a request turned down for a reason shown to the admiral as is.
type Refusal string

func (r Refusal) Error() string { return string(r) }

// Is makes a refusal an invalid request, answered with 400.
func (r Refusal) Is(target error) bool { return target == ErrInvalid }

// NormalizeFriendCode reads a code as typed, in either case and with or
// without the hyphen and spaces it is shown with.
func NormalizeFriendCode(s string) (string, bool) {
	s = strings.ToUpper(strings.NewReplacer("-", "", " ", "", "　", "").Replace(strings.TrimSpace(s)))
	if len(s) != FriendCodeLen {
		return "", false
	}
	for _, c := range s {
		if !strings.ContainsRune(friendCodeAlphabet, c) {
			return "", false
		}
	}
	return s, true
}

// CheerDay is the JST day a cheer sent at t counts for.
func CheerDay(t time.Time) string { return dateOf(t) }

// FriendCard is an admiral as other admirals see them in friend lists.
type FriendCard struct {
	Code    string `json:"code"`
	Name    string `json:"name"`
	Comment string `json:"comment"`
	Level   int    `json:"level"`
	// Secretary is the card of the admiral's secretary ship.
	Secretary  string    `json:"secretary"`
	FleetPower int       `json:"fleetPower"`
	LastActive time.Time `json:"lastActive"`
}

// FriendCard shows the admiral under their friend code.
func (p *Profile) FriendCard(code string, lastActive time.Time) FriendCard {
	c := FriendCard{Code: code, Name: p.Name, Comment: p.Comment, Level: p.Level, FleetPower: p.FleetPower(), LastActive: lastActive}
	if s := p.Ship(p.Secretary); s != nil {
		c.Secretary = s.Card
	}
	return c
}

// FriendShip is a ship in a friend's fleet.
type FriendShip struct {
	Card  string `json:"card"`
	Level int    `json:"level"`
	Stars int    `json:"stars"`
	Power int    `json:"power"`
}

// FriendProfile is what a friend may look at: the card, the fleet in
// formation order and a few records. Currencies and the rest of the roster
// stay private.
type FriendProfile struct {
	FriendCard
	Fleet      []FriendShip `json:"fleet"`
	Ships      int          `json:"ships"`
	TotalStars int          `json:"totalStars"`
	Endless    int          `json:"endless"`
	Battles    int          `json:"battles"`
	Wins       int          `json:"wins"`
	BestStreak int          `json:"bestStreak"`
	Sunk       int          `json:"sunk"`
	LoginDays  int          `json:"loginDays"`
	Created    time.Time    `json:"created"`
}

func (p *Profile) FriendProfile(code string, lastActive time.Time) FriendProfile {
	v := FriendProfile{
		FriendCard: p.FriendCard(code, lastActive), Fleet: []FriendShip{}, Ships: len(p.Ships),
		TotalStars: p.TotalStars(), Endless: p.Endless, Battles: p.Stats.Battles, Wins: p.Stats.Wins,
		BestStreak: p.Stats.BestStreak, Sunk: p.Stats.Sunk, LoginDays: p.Login.Total, Created: p.Created,
	}
	for _, u := range p.Fleet {
		if s := p.Ship(u); s != nil {
			v.Fleet = append(v.Fleet, FriendShip{Card: s.Card, Level: s.Level, Stars: s.Stars, Power: Power(s.Spec())})
		}
	}
	return v
}

// SentCheers records n cheers sent to friends, for missions and achievements.
func (p *Profile) SentCheers(now time.Time, n int) {
	p.Stats.Cheers += n
	p.bump(now, StatCheers, n)
}

// Befriended records that the admiral now has n friends.
func (p *Profile) Befriended(n int) { p.Stats.PeakFriends = max(p.Stats.PeakFriends, n) }

// ReceiveCheers pays out n cheers from friends.
func (p *Profile) ReceiveCheers(n int) Grant {
	g := Grant{Coins: n * CheerCoins}
	p.give(&g)
	return g
}
