package meta

import (
	"testing"
	"time"
)

func TestNormalizeFriendCode(t *testing.T) {
	for in, want := range map[string]string{
		"K7QM4XPA":    "K7QM4XPA",
		"k7qm-4xpa":   "K7QM4XPA",
		" K7QM 4XPA ": "K7QM4XPA",
		"K7QM　4XPA":   "K7QM4XPA",
		"K7QM-4XP":    "",
		"K7QM-4XPAB":  "",
		"O7QM-4XPA":   "", // O and 0 are left out as look-alikes
		"K7QM-4XP!":   "",
		"Ｋ7QM-4XPA":   "",
	} {
		got, ok := NormalizeFriendCode(in)
		if got != want || ok != (want != "") {
			t.Errorf("%q: got %q %v, want %q", in, got, ok, want)
		}
	}
}

func TestFriendProfileShowsTheFleetOnly(t *testing.T) {
	p := NewProfile("p1", t0)
	if _, err := p.Pull(10, rng(1), t0); err != nil {
		t.Fatal(err)
	}
	v := p.FriendProfile("K7QM4XPA", t0)
	if len(v.Fleet) != len(p.Fleet) || v.Ships != len(p.Ships) || v.Secretary != p.Ship(p.Secretary).Card {
		t.Fatalf("view: %+v", v)
	}
	power := 0
	for _, s := range v.Fleet {
		power += s.Power
	}
	if v.FleetPower != power || power == 0 {
		t.Fatalf("fleet power %d, ships add up to %d", v.FleetPower, power)
	}
	coins := p.Coins
	if g := p.ReceiveCheers(3); g.Coins != 3*CheerCoins || p.Coins != coins+3*CheerCoins {
		t.Fatalf("cheers paid %+v", g)
	}
}

func TestScoresKeepUnnamedAdmiralsOffTheBoards(t *testing.T) {
	p := NewProfile("p", time.Now())
	if p.Scores().Ranked {
		t.Fatal("a new admiral is ranked before choosing a name")
	}
	if err := p.Rename("提督A", ""); err != nil {
		t.Fatal(err)
	}
	p.Stats.Wins, p.Endless = 3, 7
	s := p.Scores()
	if !s.Ranked || s.Level != 1 || s.Wins != 3 || s.Endless != 7 || s.FleetPower != p.View(time.Now()).FleetPower {
		t.Fatalf("scores: %+v", s)
	}
}

func TestFriendMissionsAndAchievements(t *testing.T) {
	p := NewProfile("p", t0)
	p.SentCheers(t0, 3)
	if _, err := p.ClaimMission("d_cheer", t0); err != nil {
		t.Fatal(err)
	}
	if p.Stats.Cheers != 3 {
		t.Fatalf("cheers sent: %d", p.Stats.Cheers)
	}
	p.Befriended(5)
	p.Befriended(2) // a friend left; the peak stays
	if _, err := p.ClaimAchievement("a_friends_5"); err != nil {
		t.Fatal(err)
	}
	if _, err := p.ClaimAchievement("a_cheers_10"); err == nil {
		t.Fatal("claimed 10 cheers after sending 3")
	}
}

// The all-clear bonus does not wait on the friend mission, so an admiral
// without friends can still earn it.
func TestDailyAllLeavesOutExtraMissions(t *testing.T) {
	p := NewProfile("p", t0)
	for _, m := range DailyMissions {
		if m.Extra {
			continue
		}
		p.bump(t0, m.Stat, m.Goal)
		if _, err := p.ClaimMission(m.ID, t0); err != nil {
			t.Fatalf("%s: %v", m.ID, err)
		}
	}
	if _, err := p.ClaimMission(DailyAll.ID, t0); err != nil {
		t.Fatal(err)
	}
}
