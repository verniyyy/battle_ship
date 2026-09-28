// Package store persists games in PostgreSQL.
package store

import (
	"context"
	"errors"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/game"
)

var ErrNotFound = errors.New("not found")

// Summary is a finished game as listed in the battle log.
type Summary struct {
	ID         string    `json:"id"`
	Turn       int       `json:"turn"`
	Winner     game.Side `json:"winner"`
	FinishedAt time.Time `json:"finishedAt"`
}

type Stats struct {
	Played int `json:"played"`
	Wins   int `json:"wins"`
	Losses int `json:"losses"`
}

type Store interface {
	Create(ctx context.Context, st *game.State) (string, error)
	Get(ctx context.Context, id string) (*game.State, error)
	// Update loads the game with a row lock, applies fn and saves the result atomically.
	Update(ctx context.Context, id string, fn func(*game.State) error) (*game.State, error)
	ListFinished(ctx context.Context, limit int) ([]Summary, error)
	Stats(ctx context.Context) (Stats, error)
}
