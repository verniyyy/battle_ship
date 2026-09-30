// Package store persists players and matches in PostgreSQL.
package store

import (
	"context"
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
}

// Usable reports whether a stored match can be played under the current rules.
func Usable(m *meta.Match) bool {
	return m.Game != nil && m.Game.Version == game.StateVersion
}
