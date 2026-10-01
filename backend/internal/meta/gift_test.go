package meta

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestGiftValidate(t *testing.T) {
	ok := func() Gift {
		return Gift{Title: " お詫び ", Gems: 300, StartsAt: t0, EndsAt: t0.Add(7 * 24 * time.Hour), Everyone: true}
	}
	g := ok()
	if err := g.Validate(nil, t0); err != nil || g.Title != "お詫び" {
		t.Fatalf("valid gift: %v %q", err, g.Title)
	}
	before := t0
	for name, c := range map[string]struct {
		edit       func(*Gift)
		recipients []string
	}{
		"no title":        {edit: func(g *Gift) { g.Title = "  " }},
		"long title":      {edit: func(g *Gift) { g.Title = strings.Repeat("あ", GiftTitleMax+1) }},
		"long message":    {edit: func(g *Gift) { g.Message = strings.Repeat("あ", GiftMessageMax+1) }},
		"nothing to give": {edit: func(g *Gift) { g.Gems = 0 }},
		"negative coins":  {edit: func(g *Gift) { g.Coins = -1 }},
		"too many gems":   {edit: func(g *Gift) { g.Gems = GiftGemsMax + 1 }},
		"unknown card":    {edit: func(g *Gift) { g.Cards = []string{"nope"} }},
		"too many cards": {edit: func(g *Gift) {
			g.Cards = []string{"dd_asanagi", "dd_asanagi", "dd_asanagi", "dd_asanagi", "dd_asanagi", "dd_asanagi"}
		}},
		"ends before start": {edit: func(g *Gift) { g.EndsAt = g.StartsAt }},
		"already over":      {edit: func(g *Gift) { g.StartsAt, g.EndsAt = t0.Add(-48*time.Hour), t0.Add(-time.Hour) }},
		"too long":          {edit: func(g *Gift) { g.EndsAt = g.StartsAt.Add(GiftPeriodMax + time.Hour) }},
		"everyone and list": {edit: func(*Gift) {}, recipients: []string{"p1"}},
		"list but empty":    {edit: func(g *Gift) { g.Everyone = false }},
		"joined on a list":  {edit: func(g *Gift) { g.Everyone, g.JoinedBefore = false, &before }, recipients: []string{"p1"}},
		"too many people":   {edit: func(g *Gift) { g.Everyone = false }, recipients: make([]string, GiftRecipientsMax+1)},
	} {
		g := ok()
		c.edit(&g)
		if err := g.Validate(c.recipients, t0); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: got %v", name, err)
		}
	}
	g = ok()
	g.Everyone = false
	if err := g.Validate([]string{"p1"}, t0); err != nil {
		t.Fatalf("gift to a list: %v", err)
	}
}

func TestGiftOpenAndReceive(t *testing.T) {
	g := Gift{Gems: 300, Coins: 1000, Cards: []string{"dd_asanagi", "cv_kosame"}, StartsAt: t0, EndsAt: t0.Add(time.Hour)}
	if g.Open(t0.Add(-time.Second)) || !g.Open(t0) || g.Open(t0.Add(time.Hour)) {
		t.Fatal("open window is [start, end)")
	}
	p := NewProfile("p1", t0)
	gems, coins, ships := p.Gems, p.Coins, len(p.Ships)
	gr := p.ReceiveGift(&g, t0)
	if p.Gems != gems+300 || p.Coins != coins+1000 || len(p.Ships) != ships+1 || len(gr.Cards) != 2 {
		t.Fatalf("received %+v: gems %d coins %d ships %d", gr, p.Gems-gems, p.Coins-coins, len(p.Ships)-ships)
	}
	// The starter destroyer is a duplicate, so it limit-breaks; the carrier is new.
	if gr.Cards[0].New || gr.Cards[0].Stars != 1 || !gr.Cards[1].New {
		t.Fatalf("cards: %+v", gr.Cards)
	}
}
