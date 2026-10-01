package meta

import "testing"

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
