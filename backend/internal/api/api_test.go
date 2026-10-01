package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/auth"
	"github.com/verniyyy/battle_ship/backend/internal/game"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
	"github.com/verniyyy/battle_ship/backend/internal/store"
)

// memStore is an in-memory store.Store for handler tests. Values are kept as
// JSON so every request sees a fresh copy, as with the real database.
type memStore struct {
	// Friends live in SQL alone and are tested against PostgreSQL in the store.
	store.Friends

	mu      sync.Mutex
	players map[string][]byte
	games   map[string][]byte
	gifts   []*memGift
	audit   []store.AuditEntry
	n       int
}

func newMemStore() *memStore {
	return &memStore{players: map[string][]byte{}, games: map[string][]byte{}}
}

func (m *memStore) UpdatePlayer(_ context.Context, id string, fn func(*meta.Profile) error) (*meta.Profile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p := meta.NewProfile(id, time.Now())
	if data, ok := m.players[id]; ok {
		p = &meta.Profile{}
		if err := json.Unmarshal(data, p); err != nil {
			return nil, err
		}
	}
	if err := fn(p); err != nil {
		return nil, err
	}
	m.players[id], _ = json.Marshal(p)
	return p, nil
}

func (m *memStore) CreateMatch(_ context.Context, mt *meta.Match) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, _, err := m.current(mt.PlayerID); err == nil {
		return "", store.ErrInBattle
	}
	m.n++
	id := fmt.Sprintf("g%d", m.n)
	m.games[id], _ = json.Marshal(mt)
	return id, nil
}

func (m *memStore) GetMatch(_ context.Context, id string) (*meta.Match, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.load(id)
}

func (m *memStore) load(id string) (*meta.Match, error) {
	data, ok := m.games[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	var mt meta.Match
	return &mt, json.Unmarshal(data, &mt)
}

func (m *memStore) UpdateMatch(_ context.Context, id string, fn func(*meta.Match, *meta.Profile) error) (*meta.Match, *meta.Profile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	mt, err := m.load(id)
	if err != nil {
		return nil, nil, err
	}
	var p meta.Profile
	if err := json.Unmarshal(m.players[mt.PlayerID], &p); err != nil {
		return nil, nil, err
	}
	if err := fn(mt, &p); err != nil {
		return nil, nil, err
	}
	m.games[id], _ = json.Marshal(mt)
	m.players[p.ID], _ = json.Marshal(&p)
	return mt, &p, nil
}

func (m *memStore) ListFinished(context.Context, string, int) ([]store.Summary, error) {
	return nil, nil
}

func (m *memStore) CurrentMatch(_ context.Context, pid string) (string, *meta.Match, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.current(pid)
}

func (m *memStore) current(pid string) (string, *meta.Match, error) {
	for n := m.n; n > 0; n-- {
		id := fmt.Sprintf("g%d", n)
		mt, err := m.load(id)
		if err == nil && mt.PlayerID == pid && mt.Game.Status == game.StatusInProgress {
			return id, mt, nil
		}
	}
	return "", nil, store.ErrNotFound
}

func (m *memStore) Resolve(context.Context, auth.Identity, string) (string, error) {
	return auth.NewPlayerID(), nil
}

// memGift is a gift in memStore; eligibility mirrors the database's query.
type memGift struct {
	store.GiftRecord
	to      []string
	claimed map[string]bool
}

func (m *memStore) pending(pid string, now time.Time) []meta.Gift {
	var out []meta.Gift
	for _, g := range m.gifts {
		created := time.Time{}
		if data, ok := m.players[pid]; ok {
			var p meta.Profile
			_ = json.Unmarshal(data, &p)
			created = p.Created
		}
		joined := g.JoinedBefore == nil || (!created.IsZero() && created.Before(*g.JoinedBefore))
		if g.RevokedAt == nil && g.Open(now) && !g.claimed[pid] && ((g.Everyone && joined) || slices.Contains(g.to, pid)) {
			out = append(out, g.Gift)
		}
	}
	return out
}

func (m *memStore) PendingGifts(_ context.Context, pid string, now time.Time) ([]meta.Gift, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.pending(pid, now), nil
}

func (m *memStore) ClaimGifts(ctx context.Context, pid, id string, now time.Time) ([]store.Claimed, *meta.Profile, error) {
	m.mu.Lock()
	gifts := m.pending(pid, now)
	m.mu.Unlock()
	var out []store.Claimed
	p, err := m.UpdatePlayer(ctx, pid, func(p *meta.Profile) error {
		for _, g := range gifts {
			if id == "" || g.ID == id {
				out = append(out, store.Claimed{Gift: g, Grant: p.ReceiveGift(&g, now)})
			}
		}
		if id != "" && len(out) == 0 {
			return store.ErrNotFound
		}
		return nil
	})
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, c := range out {
		for _, g := range m.gifts {
			if g.ID == c.Gift.ID {
				g.claimed[pid] = true
				g.Claims++
			}
		}
	}
	return out, p, err
}

func (m *memStore) CreateGift(_ context.Context, g *meta.Gift, to []string, actor string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, pid := range to {
		if _, ok := m.players[pid]; !ok {
			return "", fmt.Errorf("%w: no admiral %s", meta.ErrInvalid, pid)
		}
	}
	m.n++
	rec := &memGift{GiftRecord: store.GiftRecord{Gift: *g, CreatedBy: actor, Recipients: len(to)}, to: to, claimed: map[string]bool{}}
	rec.ID = fmt.Sprintf("gift%d", m.n)
	m.gifts = append([]*memGift{rec}, m.gifts...)
	m.audit = append([]store.AuditEntry{{Actor: actor, Action: "gift.create", Target: rec.ID}}, m.audit...)
	return rec.ID, nil
}

func (m *memStore) RevokeGift(_ context.Context, id, actor string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, g := range m.gifts {
		if g.ID == id {
			now := time.Now()
			g.RevokedAt, g.RevokedBy = &now, actor
			m.audit = append([]store.AuditEntry{{Actor: actor, Action: "gift.revoke", Target: id}}, m.audit...)
			return nil
		}
	}
	return store.ErrNotFound
}

func (m *memStore) ListGifts(context.Context, int) ([]store.GiftRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []store.GiftRecord
	for _, g := range m.gifts {
		out = append(out, g.GiftRecord)
	}
	return out, nil
}

func (m *memStore) FindPlayers(_ context.Context, q string, _ int) ([]store.PlayerSummary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.players[q]; ok {
		return []store.PlayerSummary{{ID: q}}, nil
	}
	return nil, nil
}

func (m *memStore) AuditLog(context.Context, int) ([]store.AuditEntry, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.audit, nil
}

const (
	alice = "11111111-1111-4111-8111-111111111111"
	bob   = "22222222-2222-4222-8222-222222222222"
)

var sessions = auth.NewSessions([]byte("test-secret-test-secret-test-secret"), false, time.Now)

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	now := func() time.Time { return time.Date(2026, 9, 28, 12, 0, 0, 0, meta.JST) }
	st := newMemStore()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	s := New(st, auth.New(auth.Config{DevLogin: true, AdminSubjects: []string{adminSubject}}, sessions, st, log), log, rand.New(rand.NewPCG(1, 1)), now)
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts
}

const adminSubject = "google:admin"

func do(t *testing.T, ts *httptest.Server, player, method, path string, body any, out any) int {
	t.Helper()
	return doAs(t, ts, auth.Session{PlayerID: player}, nil, method, path, body, out)
}

// doAs calls the API as sess (no cookie when it has no player), with extra headers.
func doAs(t *testing.T, ts *httptest.Server, sess auth.Session, header http.Header, method, path string, body any, out any) int {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, ts.URL+path, r)
	for k, v := range header {
		req.Header[k] = v
	}
	if sess.PlayerID != "" {
		token, _ := sessions.Token(sess)
		req.AddCookie(&http.Cookie{Name: "session", Value: token})
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if out != nil {
		if err := json.NewDecoder(res.Body).Decode(out); err != nil {
			t.Fatal(err)
		}
	}
	return res.StatusCode
}

var placements = []game.Pos{{Row: 0, Col: 0}, {Row: 2, Col: 2}, {Row: 4, Col: 4}}

func TestGameFlow(t *testing.T) {
	ts := newTestServer(t)

	var created matchResponse
	code := do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "1-1", Placements: placements}, &created)
	if code != http.StatusCreated || created.ID == "" || created.Stage.ID != "1-1" {
		t.Fatalf("create: status %d, %+v", code, created)
	}
	for _, s := range created.Game.EnemyShips {
		if s.Pos != nil {
			t.Fatal("enemy position leaked")
		}
	}

	target := created.Game.PlayerShips[1].AttackTargets[0]
	var resp actionResponse
	code = do(t, ts, alice, "POST", "/api/games/"+created.ID+"/actions", game.Action{Type: game.ActionAttack, ShipID: 1, Target: target}, &resp)
	if code != http.StatusOK {
		t.Fatalf("action: status %d", code)
	}
	if len(resp.Results) != 2 || resp.Game.Turn != 1 {
		t.Fatalf("unexpected response %+v", resp)
	}
	sides := map[game.Side]game.Result{}
	for _, r := range resp.Results {
		sides[r.Side] = r
	}
	if sides[game.SidePlayer].Type != game.ActionAttack || sides[game.SideCPU].Side != game.SideCPU {
		t.Fatalf("expected the player's salvo and a CPU action, got %+v", resp.Results)
	}
	if resp.Game.PlayerShips[1].Ammo != resp.Game.PlayerShips[1].MaxAmmo-1 {
		t.Fatalf("ammo not spent: %d", resp.Game.PlayerShips[1].Ammo)
	}

	// Another admiral cannot see or play this match.
	if code := do(t, ts, bob, "GET", "/api/games/"+created.ID, nil, nil); code != http.StatusNotFound {
		t.Fatalf("foreign match: got %d", code)
	}
}

// TestCurrentGame finds the battle to resume after a retreat, per admiral.
func TestCurrentGame(t *testing.T) {
	ts := newTestServer(t)
	if code := do(t, ts, alice, "GET", "/api/games/current", nil, nil); code != http.StatusNotFound {
		t.Fatalf("no battle yet: got %d", code)
	}
	var created, current matchResponse
	do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "1-1", Placements: placements}, &created)
	if code := do(t, ts, alice, "GET", "/api/games/current", nil, &current); code != http.StatusOK || current.ID != created.ID {
		t.Fatalf("current: status %d, id %q, want %q", code, current.ID, created.ID)
	}
	if code := do(t, ts, bob, "GET", "/api/games/current", nil, nil); code != http.StatusNotFound {
		t.Fatalf("another admiral's battle: got %d", code)
	}
	if code := do(t, ts, alice, "POST", "/api/games/"+created.ID+"/rematch", nil, nil); code != http.StatusBadRequest {
		t.Fatalf("rematch mid-battle: got %d", code)
	}
}

// TestAbandon holds a second sortie back while one battle is suspended, then
// withdraws from it for good as a defeat that pays nothing.
func TestAbandon(t *testing.T) {
	ts := newTestServer(t)
	var created matchResponse
	do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "1-1", Placements: placements}, &created)
	if code := do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "1-1", Placements: placements}, nil); code != http.StatusConflict {
		t.Fatalf("second battle while one is suspended: got %d", code)
	}
	if code := do(t, ts, bob, "POST", "/api/games/"+created.ID+"/abandon", nil, nil); code != http.StatusNotFound {
		t.Fatalf("abandoning another admiral's battle: got %d", code)
	}
	var res actionResponse
	if code := do(t, ts, alice, "POST", "/api/games/"+created.ID+"/abandon", nil, &res); code != http.StatusOK {
		t.Fatalf("abandon: got %d", code)
	}
	if res.Game.Status != game.StatusFinished || res.Game.Winner != game.SideCPU || res.Game.EndReason != game.EndAbandoned {
		t.Fatalf("abandoned game: %+v", res.Game)
	}
	if res.Reward == nil || res.Reward.Win || res.Reward.Coins != 0 || res.Reward.Exp != 0 {
		t.Fatalf("abandon reward: %+v", res.Reward)
	}
	if st := res.Profile.Stats; st.Battles != 1 || st.Losses != 1 {
		t.Fatalf("abandon not counted as a loss: %+v", st)
	}
	if code := do(t, ts, alice, "POST", "/api/games/"+created.ID+"/abandon", nil, nil); code != http.StatusConflict {
		t.Fatalf("abandoning twice: got %d", code)
	}
	if code := do(t, ts, alice, "GET", "/api/games/current", nil, nil); code != http.StatusNotFound {
		t.Fatalf("abandoned battle is still current: got %d", code)
	}
	if code := do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "1-1", Placements: placements}, nil); code != http.StatusCreated {
		t.Fatalf("sortie after abandoning: got %d", code)
	}
}

// TestStaleTurnIsRefused: a second device still showing an earlier turn must
// not have its action applied to a board it has not seen.
func TestStaleTurnIsRefused(t *testing.T) {
	ts := newTestServer(t)
	var m matchResponse
	do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "1-1", Placements: placements}, &m)
	target := m.Game.PlayerShips[1].AttackTargets[0]
	at := func(turn int) actRequest {
		return actRequest{Action: game.Action{Type: game.ActionAttack, ShipID: 1, Target: target}, Turn: &turn}
	}
	var resp actionResponse
	if code := do(t, ts, alice, "POST", "/api/games/"+m.ID+"/actions", at(0), &resp); code != http.StatusOK || resp.Game.Turn != 1 {
		t.Fatalf("first device: %d, turn %d", code, resp.Game.Turn)
	}
	// The other device still shows turn 0.
	if code := do(t, ts, alice, "POST", "/api/games/"+m.ID+"/actions", at(0), nil); code != http.StatusConflict {
		t.Fatalf("stale action: got %d", code)
	}
	var now matchResponse
	if do(t, ts, alice, "GET", "/api/games/"+m.ID, nil, &now); now.Game.Turn != 1 {
		t.Fatalf("the stale action was played: turn %d", now.Game.Turn)
	}
	if code := do(t, ts, alice, "POST", "/api/games/"+m.ID+"/actions", at(1), nil); code != http.StatusOK {
		t.Fatalf("up-to-date action: got %d", code)
	}
}

// TestPlayToTheEnd plays random legal moves until the battle ends, then checks
// the reward, the chest and the profile it paid into.
func TestPlayToTheEnd(t *testing.T) {
	ts := newTestServer(t)
	var m matchResponse
	do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "1-1", Placements: placements}, &m)
	g := m.Game
	r := rand.New(rand.NewPCG(3, 3))
	var resp actionResponse
	for step := 0; g.Status == game.StatusInProgress; step++ {
		if step > 300 {
			t.Fatal("battle never ended")
		}
		a := randomAction(r, g)
		resp = actionResponse{}
		if code := do(t, ts, alice, "POST", "/api/games/"+m.ID+"/actions", a, &resp); code != http.StatusOK {
			t.Fatalf("step %d: %d for %+v", step, code, a)
		}
		g = resp.Game
	}
	if resp.Reward == nil || resp.Profile == nil || resp.Profile.Stats.Battles != 1 {
		t.Fatalf("finished battle was not settled: %+v", resp.Reward)
	}
	if len(resp.Reward.Chests) != 3 || resp.Reward.Chests[0].Grant.Coins+resp.Reward.Chests[0].Grant.Gems != 0 {
		t.Fatal("chests should be offered sealed")
	}
	var opened struct {
		Chest   meta.Chest       `json:"chest"`
		Reward  meta.Reward      `json:"reward"`
		Profile meta.ProfileView `json:"profile"`
	}
	if code := do(t, ts, alice, "POST", "/api/games/"+m.ID+"/chest", map[string]int{"index": 2}, &opened); code != http.StatusOK {
		t.Fatalf("chest: %d", code)
	}
	if opened.Reward.Picked != 2 {
		t.Fatalf("picked %d", opened.Reward.Picked)
	}
	if code := do(t, ts, alice, "POST", "/api/games/"+m.ID+"/chest", map[string]int{"index": 0}, nil); code != http.StatusBadRequest {
		t.Fatalf("second chest: got %d", code)
	}
	if code := do(t, ts, alice, "POST", "/api/games/"+m.ID+"/actions", game.Action{Type: game.ActionMove}, nil); code != http.StatusConflict {
		t.Fatalf("acting after the end: got %d", code)
	}

	// A rematch deploys the fleet where it stood at the start of this one.
	if code := do(t, ts, bob, "POST", "/api/games/"+m.ID+"/rematch", nil, nil); code != http.StatusNotFound {
		t.Fatalf("rematch of another admiral's battle: got %d", code)
	}
	var again matchResponse
	if code := do(t, ts, alice, "POST", "/api/games/"+m.ID+"/rematch", nil, &again); code != http.StatusCreated || again.ID == m.ID || again.Stage.ID != "1-1" {
		t.Fatalf("rematch: status %d, %+v", code, again)
	}
	for i, s := range again.Game.PlayerShips {
		if s.Pos == nil || *s.Pos != placements[i] {
			t.Fatalf("ship %d deployed at %v, want %v", i, s.Pos, placements[i])
		}
	}
	// Not once the formation has changed.
	var prof struct{ Profile meta.ProfileView }
	do(t, ts, alice, "GET", "/api/profile", nil, &prof)
	do(t, ts, alice, "POST", "/api/profile/fleet", map[string][]string{"uids": prof.Profile.Fleet[:2]}, nil)
	if code := do(t, ts, alice, "POST", "/api/games/"+m.ID+"/rematch", nil, nil); code != http.StatusBadRequest {
		t.Fatalf("rematch with another fleet: got %d", code)
	}
}

func randomAction(r *rand.Rand, g game.View) game.Action {
	for {
		s := g.PlayerShips[r.IntN(len(g.PlayerShips))]
		if s.HP <= 0 {
			continue
		}
		pick := func(ts []game.Pos) game.Pos { return ts[r.IntN(len(ts))] }
		switch {
		case g.Gauge >= game.GaugeMax:
			return game.Action{Type: game.ActionUltimate, ShipID: s.ID, Target: game.Pos{Row: 2, Col: 2}}
		case len(s.SkillTargets) > 0 && r.IntN(3) == 0:
			return game.Action{Type: game.ActionSkill, ShipID: s.ID, Target: pick(s.SkillTargets)}
		case len(s.TorpedoTargets) > 0 && r.IntN(4) == 0:
			return game.Action{Type: game.ActionTorpedo, ShipID: s.ID, Target: pick(s.TorpedoTargets)}
		case len(s.AttackTargets) > 0 && r.IntN(3) > 0:
			return game.Action{Type: game.ActionAttack, ShipID: s.ID, Target: pick(s.AttackTargets)}
		case len(s.MoveTargets) > 0:
			return game.Action{Type: game.ActionMove, ShipID: s.ID, Target: pick(s.MoveTargets)}
		}
	}
}

func TestProfileGachaAndFleet(t *testing.T) {
	ts := newTestServer(t)
	var out struct {
		Profile meta.ProfileView `json:"profile"`
		Gains   []meta.Gain      `json:"gains"`
		Levels  int              `json:"levels"`
	}
	if code := do(t, ts, alice, "GET", "/api/profile", nil, &out); code != http.StatusOK || len(out.Profile.Ships) != 3 {
		t.Fatalf("profile: %d %+v", code, out.Profile)
	}
	if !out.Profile.Badges.Login || !out.Profile.Badges.FreeTen {
		t.Fatalf("new admirals should have a login bonus and a free pull waiting: %+v", out.Profile.Badges)
	}
	if code := do(t, ts, alice, "POST", "/api/profile/login", nil, &out); code != http.StatusOK || out.Profile.Badges.Login {
		t.Fatalf("login bonus: %d", code)
	}
	if code := do(t, ts, alice, "POST", "/api/profile/login", nil, nil); code != http.StatusBadRequest {
		t.Fatalf("second login bonus: %d", code)
	}
	gems := out.Profile.Gems
	if code := do(t, ts, alice, "POST", "/api/gacha", map[string]int{"count": 10}, &out); code != http.StatusOK || len(out.Gains) != 10 || out.Profile.Gems != gems {
		t.Fatalf("free ten: %d gains=%d gems %d→%d", code, len(out.Gains), gems, out.Profile.Gems)
	}
	fleet := []string{out.Gains[0].UID, out.Profile.Fleet[0]}
	if code := do(t, ts, alice, "POST", "/api/profile/fleet", map[string]any{"uids": fleet}, &out); code != http.StatusOK || len(out.Profile.Fleet) != 2 {
		t.Fatalf("fleet: %d", code)
	}
	if code := do(t, ts, alice, "POST", "/api/ships/"+fleet[1]+"/train", nil, &out); code != http.StatusOK {
		t.Fatalf("train: %d", code)
	}
	ship := func() meta.ShipView {
		i := slices.IndexFunc(out.Profile.Ships, func(s meta.ShipView) bool { return s.UID == fleet[1] })
		return out.Profile.Ships[i]
	}
	want := ship().MaxTrainLevel
	if code := do(t, ts, alice, "POST", "/api/ships/"+fleet[1]+"/train?max=1", nil, &out); code != http.StatusOK || ship().Level != want || out.Levels < 1 {
		t.Fatalf("train max: %d, level %d want %d (%d levels)", code, ship().Level, want, out.Levels)
	}
	// A two-ship fleet needs two placements.
	if code := do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "1-1", Placements: placements}, nil); code != http.StatusBadRequest {
		t.Fatalf("placement count: got %d", code)
	}
	if code := do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "1-1", Placements: placements[:2]}, nil); code != http.StatusCreated {
		t.Fatalf("two-ship sortie: got %d", code)
	}
}

func TestValidationErrors(t *testing.T) {
	ts := newTestServer(t)

	if code := do(t, ts, "", "GET", "/api/profile", nil, nil); code != http.StatusUnauthorized {
		t.Fatalf("signed out: got %d", code)
	}
	if code := do(t, ts, "", "GET", "/api/catalog", nil, nil); code != http.StatusOK {
		t.Fatalf("catalog: got %d", code)
	}
	if code := do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "1-1", Placements: placements[:1]}, nil); code != http.StatusBadRequest {
		t.Fatalf("bad placement: got %d", code)
	}
	if code := do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "4-4", Placements: placements}, nil); code != http.StatusBadRequest {
		t.Fatalf("locked stage: got %d", code)
	}
	if code := do(t, ts, alice, "GET", "/api/games/nope", nil, nil); code != http.StatusNotFound {
		t.Fatalf("missing game: got %d", code)
	}
	if code := do(t, ts, alice, "POST", "/api/gacha", map[string]int{"count": 3}, nil); code != http.StatusBadRequest {
		t.Fatalf("odd pull count: got %d", code)
	}

	var created matchResponse
	do(t, ts, alice, "POST", "/api/games", createGameRequest{StageID: "1-1", Placements: placements}, &created)
	far := game.Action{Type: game.ActionAttack, ShipID: 0, Target: game.Pos{Row: 4, Col: 0}}
	if code := do(t, ts, alice, "POST", "/api/games/"+created.ID+"/actions", far, nil); code != http.StatusBadRequest {
		t.Fatalf("out-of-range attack: got %d", code)
	}
}
