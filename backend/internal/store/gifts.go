package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

// querier is what both the pool and a transaction can run queries on.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// pendingGifts lists the open, unrevoked gifts the player may collect and has
// not: those for everyone (who joined in time) and those addressed to them.
func pendingGifts(ctx context.Context, q querier, playerID string, now time.Time) ([]meta.Gift, error) {
	rows, err := q.Query(ctx, `
		SELECT g.id::text, g.gift FROM gifts g
		WHERE g.revoked_at IS NULL AND g.starts_at <= $2 AND g.ends_at > $2
		  AND NOT EXISTS (SELECT 1 FROM gift_claims c WHERE c.gift_id = g.id AND c.player_id = $1)
		  AND (
		    (g.everyone AND (g.joined_before IS NULL OR
		      EXISTS (SELECT 1 FROM players p WHERE p.id = $1 AND p.created_at < g.joined_before)))
		    OR EXISTS (SELECT 1 FROM gift_recipients r WHERE r.gift_id = g.id AND r.player_id = $1))
		ORDER BY g.starts_at, g.created_at`, playerID, now)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanGift)
}

func scanGift(r pgx.CollectableRow) (meta.Gift, error) {
	var (
		g    meta.Gift
		id   string
		data []byte
	)
	if err := r.Scan(&id, &data); err != nil {
		return g, err
	}
	err := json.Unmarshal(data, &g)
	g.ID = id
	return g, err
}

func (p *Postgres) PendingGifts(ctx context.Context, playerID string, now time.Time) ([]meta.Gift, error) {
	return pendingGifts(ctx, p.pool, playerID, now)
}

func (p *Postgres) ClaimGifts(ctx context.Context, playerID, id string, now time.Time) ([]Claimed, *meta.Profile, error) {
	var (
		out  []Claimed
		prof *meta.Profile
	)
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		var err error
		// The profile lock serialises claims by the same admiral.
		if prof, err = lockOrCreatePlayer(ctx, tx, playerID); err != nil {
			return err
		}
		gifts, err := pendingGifts(ctx, tx, playerID, now)
		if err != nil {
			return err
		}
		for _, g := range gifts {
			if id != "" && g.ID != id {
				continue
			}
			if _, err := tx.Exec(ctx, `INSERT INTO gift_claims (gift_id, player_id, claimed_at) VALUES ($1, $2, $3)`, g.ID, playerID, now); err != nil {
				return err
			}
			out = append(out, Claimed{Gift: g, Grant: prof.ReceiveGift(&g, now)})
		}
		if id != "" && len(out) == 0 {
			return ErrNotFound
		}
		return savePlayer(ctx, tx, prof)
	})
	if err != nil {
		return nil, nil, err
	}
	return out, prof, nil
}

func (p *Postgres) CreateGift(ctx context.Context, g *meta.Gift, recipients []string, actor string) (string, error) {
	var id string
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		if len(recipients) > 0 {
			rows, err := tx.Query(ctx, `SELECT r::text FROM unnest($1::uuid[]) r WHERE NOT EXISTS (SELECT 1 FROM players WHERE id = r)`, recipients)
			if err != nil {
				return err
			}
			missing, err := pgx.CollectRows(rows, pgx.RowTo[string])
			if err != nil {
				return err
			}
			if len(missing) > 0 {
				return fmt.Errorf("%w: 提督が見つかりません: %s", meta.ErrInvalid, strings.Join(missing, ", "))
			}
		}
		data, err := json.Marshal(g)
		if err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `
			INSERT INTO gifts (gift, everyone, joined_before, starts_at, ends_at, created_by)
			VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
			data, g.Everyone, g.JoinedBefore, g.StartsAt, g.EndsAt, actor).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO gift_recipients (gift_id, player_id) SELECT $1, unnest($2::uuid[])`, id, recipients); err != nil {
			return err
		}
		return audit(ctx, tx, actor, "gift.create", id, map[string]any{"gift": g, "recipients": recipients})
	})
	return id, err
}

func (p *Postgres) RevokeGift(ctx context.Context, id, actor string) error {
	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		var revoked bool
		err := tx.QueryRow(ctx, `SELECT revoked_at IS NOT NULL FROM gifts WHERE id = $1 FOR UPDATE`, id).Scan(&revoked)
		switch {
		case isNotFound(err):
			return ErrNotFound
		case err != nil:
			return err
		case revoked:
			return fmt.Errorf("%w: すでに停止しています", meta.ErrInvalid)
		}
		if _, err := tx.Exec(ctx, `UPDATE gifts SET revoked_at = now(), revoked_by = $2 WHERE id = $1`, id, actor); err != nil {
			return err
		}
		return audit(ctx, tx, actor, "gift.revoke", id, map[string]any{})
	})
}

func (p *Postgres) ListGifts(ctx context.Context, limit int) ([]GiftRecord, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT g.id::text, g.gift, g.created_by, g.created_at, COALESCE(g.revoked_by, ''), g.revoked_at,
		       (SELECT count(*) FROM gift_recipients r WHERE r.gift_id = g.id),
		       (SELECT count(*) FROM gift_claims c WHERE c.gift_id = g.id)
		FROM gifts g ORDER BY g.created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (GiftRecord, error) {
		var (
			g    GiftRecord
			data []byte
		)
		if err := r.Scan(&g.ID, &data, &g.CreatedBy, &g.CreatedAt, &g.RevokedBy, &g.RevokedAt, &g.Recipients, &g.Claims); err != nil {
			return g, err
		}
		id := g.ID
		err := json.Unmarshal(data, &g.Gift)
		g.ID = id
		return g, err
	})
}

func (p *Postgres) FindPlayers(ctx context.Context, query string, limit int) ([]PlayerSummary, error) {
	like := "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(query) + "%"
	rows, err := p.pool.Query(ctx, `
		SELECT p.id::text, COALESCE(p.profile->>'name', ''), COALESCE((p.profile->>'level')::int, 0), COALESCE(a.email, ''),
		       COALESCE((p.profile->>'gems')::int, 0), COALESCE((p.profile->>'coins')::int, 0), p.created_at
		FROM players p LEFT JOIN accounts a ON a.player_id = p.id
		WHERE p.id::text = lower($1) OR p.profile->>'name' ILIKE $2 OR a.email ILIKE $2
		ORDER BY p.updated_at DESC LIMIT $3`, query, like, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PlayerSummary, error) {
		var s PlayerSummary
		err := r.Scan(&s.ID, &s.Name, &s.Level, &s.Email, &s.Gems, &s.Coins, &s.Created)
		return s, err
	})
}

func (p *Postgres) AuditLog(ctx context.Context, limit int) ([]AuditEntry, error) {
	rows, err := p.pool.Query(ctx, `SELECT id, at, actor, action, target, detail FROM admin_audit ORDER BY id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (AuditEntry, error) {
		var e AuditEntry
		err := r.Scan(&e.ID, &e.At, &e.Actor, &e.Action, &e.Target, &e.Detail)
		return e, err
	})
}

// audit records an admin action in the same transaction as the action itself.
func audit(ctx context.Context, tx pgx.Tx, actor, action, target string, detail any) error {
	data, err := json.Marshal(detail)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO admin_audit (actor, action, target, detail) VALUES ($1, $2, $3, $4)`, actor, action, target, data)
	return err
}
