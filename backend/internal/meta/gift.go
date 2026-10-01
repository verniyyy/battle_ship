package meta

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// Gift is a present from the operators, such as an apology for an outage or
// a celebration: admirals collect it from the harbour's gift box while it is
// open. It goes to everyone, optionally only those who joined before a
// moment (so accounts made after an outage cannot claim its apology), or to
// a list of recipients kept beside it.
type Gift struct {
	ID       string    `json:"id"`
	Title    string    `json:"title"`
	Message  string    `json:"message"`
	Gems     int       `json:"gems,omitempty"`
	Coins    int       `json:"coins,omitempty"`
	Cards    []string  `json:"cards,omitempty"`
	StartsAt time.Time `json:"startsAt"`
	EndsAt   time.Time `json:"endsAt"`
	Everyone bool      `json:"everyone"`
	// JoinedBefore limits a gift for everyone to admirals created before it.
	JoinedBefore *time.Time `json:"joinedBefore,omitempty"`
}

// Limits on one gift, so a slip of the keyboard cannot flood the economy.
const (
	GiftTitleMax      = 30
	GiftMessageMax    = 300
	GiftGemsMax       = 10000
	GiftCoinsMax      = 1000000
	GiftCardsMax      = 5
	GiftRecipientsMax = 500
	GiftPeriodMax     = 180 * 24 * time.Hour
)

// Validate tidies an admin's draft and checks it, along with its recipients
// (player ids, which must be empty for a gift to everyone).
func (g *Gift) Validate(recipients []string, now time.Time) error {
	g.Title, g.Message = strings.TrimSpace(g.Title), strings.TrimSpace(g.Message)
	bad := func(format string, a ...any) error {
		return fmt.Errorf("%w: "+format, append([]any{ErrInvalid}, a...)...)
	}
	switch {
	case g.Title == "" || utf8.RuneCountInString(g.Title) > GiftTitleMax:
		return bad("件名は 1〜%d 文字にしてください", GiftTitleMax)
	case utf8.RuneCountInString(g.Message) > GiftMessageMax:
		return bad("本文は %d 文字までです", GiftMessageMax)
	case g.Gems < 0 || g.Gems > GiftGemsMax:
		return bad("ジェムは 0〜%d にしてください", GiftGemsMax)
	case g.Coins < 0 || g.Coins > GiftCoinsMax:
		return bad("コインは 0〜%d にしてください", GiftCoinsMax)
	case len(g.Cards) > GiftCardsMax:
		return bad("艦カードは %d 枚までです", GiftCardsMax)
	case g.Gems == 0 && g.Coins == 0 && len(g.Cards) == 0:
		return bad("配布するものがありません")
	case !g.EndsAt.After(g.StartsAt):
		return bad("終了日時は開始日時より後にしてください")
	case !g.EndsAt.After(now):
		return bad("終了日時が過ぎています")
	case g.EndsAt.Sub(g.StartsAt) > GiftPeriodMax:
		return bad("受け取り期間は %d 日までです", int(GiftPeriodMax/(24*time.Hour)))
	case g.Everyone && len(recipients) > 0:
		return bad("全員への配布に受取人は指定できません")
	case !g.Everyone && g.JoinedBefore != nil:
		return bad("着任日の条件は全員への配布でのみ使えます")
	case !g.Everyone && len(recipients) == 0:
		return bad("受取人を指定してください")
	case len(recipients) > GiftRecipientsMax:
		return bad("受取人は %d 人までです", GiftRecipientsMax)
	}
	for _, c := range g.Cards {
		if _, ok := CardByID(c); !ok {
			return bad("艦カード %q はありません", c)
		}
	}
	return nil
}

// Open reports whether the gift can be collected at now.
func (g *Gift) Open(now time.Time) bool { return !now.Before(g.StartsAt) && now.Before(g.EndsAt) }

// ReceiveGift hands the gift's contents to the admiral. Cards go through the
// roster as from the gacha: a duplicate limit-breaks the ship it matches.
func (p *Profile) ReceiveGift(g *Gift, now time.Time) Grant {
	gr := Grant{Gems: g.Gems, Coins: g.Coins}
	for _, c := range g.Cards {
		gr.Cards = append(gr.Cards, p.addCard(c, now))
	}
	p.give(&gr)
	return gr
}
