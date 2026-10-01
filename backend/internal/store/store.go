// Package store persists players and matches in PostgreSQL.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/auth"
	"github.com/verniyyy/battle_ship/backend/internal/game"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

var ErrNotFound = errors.New("not found")

// ErrInBattle refuses a new battle while the admiral has one suspended: only
// one may wait at a time, to be resumed or abandoned.
var ErrInBattle = errors.New("中断中の戦闘があります。復帰するか撤退してから出撃してください")

// Summary is a finished match as listed in the battle log.
type Summary struct {
	ID         string    `json:"id"`
	StageID    string    `json:"stageId"`
	Turn       int       `json:"turn"`
	Winner     game.Side `json:"winner"`
	Rank       string    `json:"rank"`
	FinishedAt time.Time `json:"finishedAt"`
}

type Store interface {
	// UpdatePlayer locks the profile (creating it on first use), applies fn and saves it.
	UpdatePlayer(ctx context.Context, id string, fn func(*meta.Profile) error) (*meta.Profile, error)
	// CreateMatch fails with ErrInBattle while the player has an unfinished match.
	CreateMatch(ctx context.Context, m *meta.Match) (string, error)
	GetMatch(ctx context.Context, id string) (*meta.Match, error)
	// UpdateMatch locks the match and its player's profile, applies fn and saves both atomically.
	UpdateMatch(ctx context.Context, id string, fn func(*meta.Match, *meta.Profile) error) (*meta.Match, *meta.Profile, error)
	ListFinished(ctx context.Context, playerID string, limit int) ([]Summary, error)
	// CurrentMatch returns the player's unfinished match; there is at most one.
	CurrentMatch(ctx context.Context, playerID string) (string, *meta.Match, error)
	auth.Accounts
	Gifts
}

// Gifts keeps the operators' presents and who has collected them.
type Gifts interface {
	// PendingGifts lists the gifts the player may collect at now, oldest first.
	PendingGifts(ctx context.Context, playerID string, now time.Time) ([]meta.Gift, error)
	// ClaimGifts collects the player's pending gifts, or only gift id when it
	// is not empty (ErrNotFound when that one is not pending), in one
	// transaction with the profile.
	ClaimGifts(ctx context.Context, playerID, id string, now time.Time) ([]Claimed, *meta.Profile, error)

	// CreateGift saves a validated gift and its recipients, who must exist.
	CreateGift(ctx context.Context, g *meta.Gift, recipients []string, actor string) (string, error)
	// RevokeGift stops a gift from being collected any further.
	RevokeGift(ctx context.Context, id, actor string) error
	// ListGifts returns the newest gifts with how far they have gone out.
	ListGifts(ctx context.Context, limit int) ([]GiftRecord, error)
	// FindPlayers looks admirals up by id, or by part of their name or email.
	FindPlayers(ctx context.Context, query string, limit int) ([]PlayerSummary, error)
	// AuditLog returns the newest admin actions.
	AuditLog(ctx context.Context, limit int) ([]AuditEntry, error)
}

// Claimed is a gift collected and what it paid out.
type Claimed struct {
	Gift  meta.Gift  `json:"gift"`
	Grant meta.Grant `json:"grant"`
}

// GiftRecord is a gift as the admin console lists it.
type GiftRecord struct {
	meta.Gift
	CreatedBy  string     `json:"createdBy"`
	CreatedAt  time.Time  `json:"createdAt"`
	RevokedBy  string     `json:"revokedBy,omitempty"`
	RevokedAt  *time.Time `json:"revokedAt,omitempty"`
	Recipients int        `json:"recipients"`
	Claims     int        `json:"claims"`
}

// PlayerSummary is an admiral as the admin console finds them.
type PlayerSummary struct {
	ID      string    `json:"id"`
	Name    string    `json:"name"`
	Level   int       `json:"level"`
	Email   string    `json:"email,omitempty"`
	Gems    int       `json:"gems"`
	Coins   int       `json:"coins"`
	Created time.Time `json:"created"`
}

// AuditEntry is one admin action.
type AuditEntry struct {
	ID     int64           `json:"id"`
	At     time.Time       `json:"at"`
	Actor  string          `json:"actor"`
	Action string          `json:"action"`
	Target string          `json:"target"`
	Detail json.RawMessage `json:"detail"`
}

// Usable reports whether a stored match can be played under the current rules.
func Usable(m *meta.Match) bool {
	return m.Game != nil && m.Game.Version == game.StateVersion
}
