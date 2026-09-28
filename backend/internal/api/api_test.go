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
	"sync"
	"testing"

	"github.com/verniyyy/battle_ship/backend/internal/game"
	"github.com/verniyyy/battle_ship/backend/internal/store"
)

// memStore is an in-memory store.Store for handler tests.
type memStore struct {
	mu    sync.Mutex
	games map[string][]byte
	n     int
}

func (m *memStore) Create(_ context.Context, st *game.State) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.n++
	id := fmt.Sprintf("g%d", m.n)
	m.games[id], _ = json.Marshal(st)
	return id, nil
}

func (m *memStore) Get(_ context.Context, id string) (*game.State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.load(id)
}

func (m *memStore) load(id string) (*game.State, error) {
	data, ok := m.games[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	var st game.State
	return &st, json.Unmarshal(data, &st)
}

func (m *memStore) Update(_ context.Context, id string, fn func(*game.State) error) (*game.State, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	st, err := m.load(id)
	if err != nil {
		return nil, err
	}
	if err := fn(st); err != nil {
		return nil, err
	}
	m.games[id], _ = json.Marshal(st)
	return st, nil
}

func (m *memStore) ListFinished(context.Context, int) ([]store.Summary, error) { return nil, nil }
func (m *memStore) Stats(context.Context) (store.Stats, error)                 { return store.Stats{}, nil }

func newTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	s := New(&memStore{games: map[string][]byte{}}, slog.New(slog.NewTextHandler(io.Discard, nil)), rand.New(rand.NewPCG(1, 1)))
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return ts
}

func do(t *testing.T, ts *httptest.Server, method, path string, body any, out any) int {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		r = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, ts.URL+path, r)
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

func TestGameFlow(t *testing.T) {
	ts := newTestServer(t)

	var created gameResponse
	code := do(t, ts, "POST", "/api/games", map[string]any{
		"placements": []game.Pos{{Row: 0, Col: 0}, {Row: 2, Col: 2}, {Row: 4, Col: 4}},
	}, &created)
	if code != http.StatusCreated || created.ID == "" {
		t.Fatalf("create: status %d, %+v", code, created)
	}
	for _, s := range created.Game.EnemyShips {
		if s.Pos != nil {
			t.Fatal("enemy position leaked")
		}
	}

	target := created.Game.PlayerShips[1].AttackTargets[0]
	var resp actionResponse
	code = do(t, ts, "POST", "/api/games/"+created.ID+"/actions", game.Action{Type: game.ActionAttack, ShipID: 1, Target: target}, &resp)
	if code != http.StatusOK {
		t.Fatalf("action: status %d", code)
	}
	if resp.Player.Type != game.ActionAttack || resp.Game.Turn != 1 {
		t.Fatalf("unexpected response %+v", resp)
	}
	if resp.Game.Status == game.StatusInProgress && resp.CPU == nil {
		t.Fatal("expected a CPU reply")
	}
	if resp.Game.PlayerShips[1].Ammo != game.Fleet[1].Ammo-1 {
		t.Fatalf("ammo not spent: %d", resp.Game.PlayerShips[1].Ammo)
	}
}

func TestValidationErrors(t *testing.T) {
	ts := newTestServer(t)

	if code := do(t, ts, "POST", "/api/games", map[string]any{"placements": []game.Pos{{Row: 0, Col: 0}}}, nil); code != http.StatusBadRequest {
		t.Fatalf("bad placement: got %d", code)
	}
	if code := do(t, ts, "GET", "/api/games/nope", nil, nil); code != http.StatusNotFound {
		t.Fatalf("missing game: got %d", code)
	}

	var created gameResponse
	do(t, ts, "POST", "/api/games", map[string]any{
		"placements": []game.Pos{{Row: 0, Col: 0}, {Row: 2, Col: 2}, {Row: 4, Col: 4}},
	}, &created)
	far := game.Action{Type: game.ActionAttack, ShipID: 0, Target: game.Pos{Row: 4, Col: 0}}
	if code := do(t, ts, "POST", "/api/games/"+created.ID+"/actions", far, nil); code != http.StatusBadRequest {
		t.Fatalf("out-of-range attack: got %d", code)
	}
}
