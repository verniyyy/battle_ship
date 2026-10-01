package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

// Friends keeps who is friends with whom, the requests on the way and the
// daily cheers. Other admirals are named by friend code throughout.
type Friends interface {
	// FriendList is the admiral's code, friends, requests and uncollected cheers.
	FriendList(ctx context.Context, playerID string, now time.Time) (*FriendList, error)
	// RequestFriend asks the admiral with code to be friends. When they had
	// already asked in return, the two become friends at once (true).
	RequestFriend(ctx context.Context, playerID, code string) (bool, error)
	// AcceptFriend answers a request from code with yes.
	AcceptFriend(ctx context.Context, playerID, code string) error
	// DeclineFriend turns a request from code down, and CancelFriendRequest
	// takes back one sent to code.
	DeclineFriend(ctx context.Context, playerID, code string) error
	CancelFriendRequest(ctx context.Context, playerID, code string) error
	RemoveFriend(ctx context.Context, playerID, code string) error
	// CheerFriends sends today's cheer to the friend with code, or to every
	// friend not yet cheered today when code is empty, and returns how many went.
	CheerFriends(ctx context.Context, playerID, code string, now time.Time) (int, error)
	// ClaimCheers collects every cheer received, in one transaction with the profile.
	ClaimCheers(ctx context.Context, playerID string, now time.Time) (int, meta.Grant, *meta.Profile, error)
	// FriendProfile shows a friend, or an admiral a request is pending with.
	FriendProfile(ctx context.Context, playerID, code string) (*meta.FriendProfile, error)
}

// FriendList is the friends screen.
type FriendList struct {
	Code     string          `json:"code"`
	Friends  []Friend        `json:"friends"`
	Incoming []FriendRequest `json:"incoming"`
	Outgoing []FriendRequest `json:"outgoing"`
	// Cheers counts the cheers received and not yet collected.
	Cheers int `json:"cheers"`
}

type Friend struct {
	meta.FriendCard
	Since time.Time `json:"since"`
	// Cheered is whether the admiral has cheered this friend today, and
	// CheeredMe whether the friend has cheered them.
	Cheered   bool `json:"cheered"`
	CheeredMe bool `json:"cheeredMe"`
}

type FriendRequest struct {
	meta.FriendCard
	At time.Time `json:"at"`
}

var (
	errNoSuchCode = meta.Refusal("そのフレンドコードの提督は見つかりません")
	errNoRequest  = meta.Refusal("その申請は見つかりません（取り消されたか、すでに返事済みです）")
	errNotFriends = meta.Refusal("フレンドではありません")
)

// playerByCode finds the admiral a friend code belongs to.
func playerByCode(ctx context.Context, tx pgx.Tx, code string) (string, error) {
	code, ok := meta.NormalizeFriendCode(code)
	if !ok {
		return "", meta.Refusal(fmt.Sprintf("フレンドコードは %d 文字の英数字です", meta.FriendCodeLen))
	}
	var id string
	err := tx.QueryRow(ctx, `SELECT id::text FROM players WHERE friend_code = $1`, code).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errNoSuchCode
	}
	return id, err
}

// lockPair locks both admirals' rows, always in the same order so two
// admirals asking each other at once wait rather than deadlock.
func lockPair(ctx context.Context, tx pgx.Tx, a, b string) error {
	rows, err := tx.Query(ctx, `SELECT id FROM players WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, []string{a, b})
	if err != nil {
		return err
	}
	rows.Close()
	return rows.Err()
}

func count(ctx context.Context, tx pgx.Tx, sql string, args ...any) (int, error) {
	var n int
	err := tx.QueryRow(ctx, sql, args...).Scan(&n)
	return n, err
}

func exists(ctx context.Context, tx pgx.Tx, sql string, args ...any) (bool, error) {
	var ok bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (`+sql+`)`, args...).Scan(&ok)
	return ok, err
}

func areFriends(ctx context.Context, tx pgx.Tx, a, b string) (bool, error) {
	return exists(ctx, tx, `SELECT 1 FROM friends WHERE player_id = $1 AND friend_id = $2`, a, b)
}

func requested(ctx context.Context, tx pgx.Tx, from, to string) (bool, error) {
	return exists(ctx, tx, `SELECT 1 FROM friend_requests WHERE from_id = $1 AND to_id = $2`, from, to)
}

func friendCount(ctx context.Context, tx pgx.Tx, id string) (int, error) {
	return count(ctx, tx, `SELECT count(*) FROM friends WHERE player_id = $1`, id)
}

// befriend makes a and b friends, with room on both lists, and clears the
// requests between them. Both rows must be locked.
func befriend(ctx context.Context, tx pgx.Tx, a, b string) error {
	for _, side := range []struct {
		id      string
		refusal meta.Refusal
	}{
		{a, meta.Refusal(fmt.Sprintf("フレンドが上限の %d 人に達しています", meta.MaxFriends))},
		{b, meta.Refusal("相手のフレンドが上限に達しています")},
	} {
		n, err := friendCount(ctx, tx, side.id)
		if err != nil {
			return err
		}
		if n >= meta.MaxFriends {
			return side.refusal
		}
	}
	if _, err := tx.Exec(ctx, `DELETE FROM friend_requests WHERE (from_id, to_id) IN (($1, $2), ($2, $1))`, a, b); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `INSERT INTO friends (player_id, friend_id) VALUES ($1, $2), ($2, $1)`, a, b)
	return err
}

func (p *Postgres) RequestFriend(ctx context.Context, playerID, code string) (bool, error) {
	var mutual bool
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		target, err := playerByCode(ctx, tx, code)
		if err != nil {
			return err
		}
		if target == playerID {
			return meta.Refusal("自分自身には申請できません")
		}
		if err := lockPair(ctx, tx, playerID, target); err != nil {
			return err
		}
		if ok, err := areFriends(ctx, tx, playerID, target); err != nil || ok {
			return orRefuse(err, meta.Refusal("すでにフレンドです"))
		}
		// They asked first: this is a yes.
		if ok, err := requested(ctx, tx, target, playerID); err != nil {
			return err
		} else if ok {
			mutual = true
			return befriend(ctx, tx, playerID, target)
		}
		if ok, err := requested(ctx, tx, playerID, target); err != nil || ok {
			return orRefuse(err, meta.Refusal("すでに申請しています。返事をお待ちください"))
		}
		for _, limit := range []struct {
			sql     string
			id      string
			max     int
			refusal meta.Refusal
		}{
			{`SELECT count(*) FROM friends WHERE player_id = $1`, playerID, meta.MaxFriends,
				meta.Refusal(fmt.Sprintf("フレンドが上限の %d 人に達しています", meta.MaxFriends))},
			{`SELECT count(*) FROM friend_requests WHERE from_id = $1`, playerID, meta.MaxOutgoing,
				meta.Refusal(fmt.Sprintf("返事待ちの申請は %d 件までです", meta.MaxOutgoing))},
			{`SELECT count(*) FROM friends WHERE player_id = $1`, target, meta.MaxFriends,
				meta.Refusal("相手のフレンドが上限に達しています")},
			{`SELECT count(*) FROM friend_requests WHERE to_id = $1`, target, meta.MaxIncoming,
				meta.Refusal("相手は現在、申請を受け付けられません")},
		} {
			n, err := count(ctx, tx, limit.sql, limit.id)
			if err != nil {
				return err
			}
			if n >= limit.max {
				return limit.refusal
			}
		}
		_, err = tx.Exec(ctx, `INSERT INTO friend_requests (from_id, to_id) VALUES ($1, $2)`, playerID, target)
		return err
	})
	return mutual, err
}

// orRefuse returns err when there is one, otherwise the refusal.
func orRefuse(err error, refusal meta.Refusal) error {
	if err != nil {
		return err
	}
	return refusal
}

func (p *Postgres) AcceptFriend(ctx context.Context, playerID, code string) error {
	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		from, err := playerByCode(ctx, tx, code)
		if err != nil {
			return err
		}
		if err := lockPair(ctx, tx, playerID, from); err != nil {
			return err
		}
		if ok, err := requested(ctx, tx, from, playerID); err != nil || !ok {
			return orRefuse(err, errNoRequest)
		}
		return befriend(ctx, tx, playerID, from)
	})
}

// deleteBetween runs a DELETE naming the admiral ($1) and the one with code
// ($2), and refuses with refusal when it removed nothing.
func (p *Postgres) deleteBetween(ctx context.Context, playerID, code, sql string, refusal meta.Refusal) error {
	return pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		other, err := playerByCode(ctx, tx, code)
		if err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, sql, playerID, other)
		if err == nil && tag.RowsAffected() == 0 {
			return refusal
		}
		return err
	})
}

func (p *Postgres) DeclineFriend(ctx context.Context, playerID, code string) error {
	return p.deleteBetween(ctx, playerID, code, `DELETE FROM friend_requests WHERE from_id = $2 AND to_id = $1`, errNoRequest)
}

func (p *Postgres) CancelFriendRequest(ctx context.Context, playerID, code string) error {
	return p.deleteBetween(ctx, playerID, code, `DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2`, errNoRequest)
}

func (p *Postgres) RemoveFriend(ctx context.Context, playerID, code string) error {
	return p.deleteBetween(ctx, playerID, code, `DELETE FROM friends WHERE (player_id, friend_id) IN (($1, $2), ($2, $1))`, errNotFriends)
}

func (p *Postgres) CheerFriends(ctx context.Context, playerID, code string, now time.Time) (int, error) {
	var sent int
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		// An empty target matches every friend.
		var target *string
		if code != "" {
			id, err := playerByCode(ctx, tx, code)
			if err != nil {
				return err
			}
			if ok, err := areFriends(ctx, tx, playerID, id); err != nil || !ok {
				return orRefuse(err, errNotFriends)
			}
			target = &id
		}
		tag, err := tx.Exec(ctx, `
			INSERT INTO friend_cheers (from_id, to_id, day, sent_at)
			SELECT $1, friend_id, $3::date, $4 FROM friends
			WHERE player_id = $1 AND ($2::uuid IS NULL OR friend_id = $2::uuid)
			ON CONFLICT DO NOTHING`, playerID, target, meta.CheerDay(now), now)
		if err != nil {
			return err
		}
		sent = int(tag.RowsAffected())
		switch {
		case sent > 0:
			return nil
		case target != nil:
			return meta.Refusal("今日はもうエールを送りました")
		default:
			return meta.Refusal("今日エールを送れるフレンドはいません")
		}
	})
	return sent, err
}

func (p *Postgres) ClaimCheers(ctx context.Context, playerID string, now time.Time) (int, meta.Grant, *meta.Profile, error) {
	var (
		n     int
		grant meta.Grant
		prof  *meta.Profile
	)
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		var err error
		// The profile lock serialises claims by the same admiral.
		if prof, err = lockOrCreatePlayer(ctx, tx, playerID); err != nil {
			return err
		}
		tag, err := tx.Exec(ctx, `UPDATE friend_cheers SET claimed_at = $2 WHERE to_id = $1 AND claimed_at IS NULL`, playerID, now)
		if err != nil {
			return err
		}
		if n = int(tag.RowsAffected()); n == 0 {
			return meta.Refusal("受け取れるエールはありません")
		}
		grant = prof.ReceiveCheers(n)
		return savePlayer(ctx, tx, prof)
	})
	if err != nil {
		return 0, meta.Grant{}, nil, err
	}
	return n, grant, prof, nil
}

func (p *Postgres) FriendList(ctx context.Context, playerID string, now time.Time) (*FriendList, error) {
	l := &FriendList{Friends: []Friend{}, Incoming: []FriendRequest{}, Outgoing: []FriendRequest{}}
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `SELECT friend_code FROM players WHERE id = $1`, playerID).Scan(&l.Code)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return err
		}
		day := meta.CheerDay(now)
		rows, err := tx.Query(ctx, `
			SELECT p.friend_code, p.profile, p.updated_at, f.since,
			       EXISTS (SELECT 1 FROM friend_cheers c WHERE c.from_id = $1 AND c.to_id = p.id AND c.day = $2::date),
			       EXISTS (SELECT 1 FROM friend_cheers c WHERE c.from_id = p.id AND c.to_id = $1 AND c.day = $2::date)
			FROM friends f JOIN players p ON p.id = f.friend_id
			WHERE f.player_id = $1 ORDER BY p.updated_at DESC`, playerID, day)
		if err != nil {
			return err
		}
		if l.Friends, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (Friend, error) {
			var f Friend
			card, err := scanCard(r, &f.Since, &f.Cheered, &f.CheeredMe)
			f.FriendCard = card
			return f, err
		}); err != nil {
			return err
		}
		for _, side := range []struct {
			into       *[]FriendRequest
			them, mine string
		}{{&l.Incoming, "from_id", "to_id"}, {&l.Outgoing, "to_id", "from_id"}} {
			rows, err := tx.Query(ctx, `
				SELECT p.friend_code, p.profile, p.updated_at, r.created_at
				FROM friend_requests r JOIN players p ON p.id = r.`+side.them+`
				WHERE r.`+side.mine+` = $1 ORDER BY r.created_at DESC`, playerID)
			if err != nil {
				return err
			}
			if *side.into, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (FriendRequest, error) {
				var q FriendRequest
				card, err := scanCard(r, &q.At)
				q.FriendCard = card
				return q, err
			}); err != nil {
				return err
			}
		}
		return tx.QueryRow(ctx, `SELECT count(*) FROM friend_cheers WHERE to_id = $1 AND claimed_at IS NULL`, playerID).Scan(&l.Cheers)
	})
	if err != nil {
		return nil, err
	}
	return l, nil
}

// scanCard reads a row starting with friend_code, profile and updated_at into
// the admiral's card, and the columns after them into rest.
func scanCard(r pgx.CollectableRow, rest ...any) (meta.FriendCard, error) {
	prof, code, at, err := scanOther(r, rest...)
	if err != nil {
		return meta.FriendCard{}, err
	}
	return prof.FriendCard(code, at), nil
}

func scanOther(r pgx.Row, rest ...any) (*meta.Profile, string, time.Time, error) {
	var (
		code string
		data []byte
		at   time.Time
		prof meta.Profile
	)
	if err := r.Scan(append([]any{&code, &data, &at}, rest...)...); err != nil {
		return nil, "", at, err
	}
	return &prof, code, at, json.Unmarshal(data, &prof)
}

func (p *Postgres) FriendProfile(ctx context.Context, playerID, code string) (*meta.FriendProfile, error) {
	var v meta.FriendProfile
	err := pgx.BeginFunc(ctx, p.pool, func(tx pgx.Tx) error {
		other, err := playerByCode(ctx, tx, code)
		if err != nil {
			return err
		}
		// Friends, and admirals deciding on a request either way, may look.
		ok, err := exists(ctx, tx, `
			SELECT 1 FROM friends WHERE player_id = $1 AND friend_id = $2
			UNION ALL SELECT 1 FROM friend_requests WHERE (from_id, to_id) IN (($1, $2), ($2, $1))`, playerID, other)
		if err != nil || !ok {
			return orRefuse(err, errNotFriends)
		}
		prof, code, at, err := scanOther(tx.QueryRow(ctx, `SELECT friend_code, profile, updated_at FROM players WHERE id = $1`, other))
		if err != nil {
			return err
		}
		v = prof.FriendProfile(code, at)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &v, nil
}
