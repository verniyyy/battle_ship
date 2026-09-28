// Package store persists players and matches in PostgreSQL.
package store

import (
	"context"
	"errors"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/game"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

var ErrNotFound = errors.New("not found")

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
	CreateMatch(ctx context.Context, m *meta.Match) (string, error)
	GetMatch(ctx context.Context, id string) (*meta.Match, error)
	// UpdateMatch locks the match and its player's profile, applies fn and saves both atomically.
	UpdateMatch(ctx context.Context, id string, fn func(*meta.Match, *meta.Profile) error) (*meta.Match, *meta.Profile, error)
	ListFinished(ctx context.Context, playerID string, limit int) ([]Summary, error)
}

// Usable reports whether a stored match can be played under the current rules.
func Usable(m *meta.Match) bool {
	return m.Game != nil && m.Game.Version == game.StateVersion
}
