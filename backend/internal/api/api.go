// Package api exposes the game over a JSON HTTP API.
//
// Every /api route except the catalog and sign-in is scoped to the signed-in
// admiral. Profiles are created on first use. /api/admin is the operators'
// console, open only to admins.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/auth"
	"github.com/verniyyy/battle_ship/backend/internal/game"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
	"github.com/verniyyy/battle_ship/backend/internal/store"
)

type Server struct {
	store store.Store
	auth  *auth.Handler
	log   *slog.Logger
	now   func() time.Time

	mu  sync.Mutex // guards rng, which is not safe for concurrent use
	rng *rand.Rand
}

func New(s store.Store, a *auth.Handler, log *slog.Logger, rng *rand.Rand, now func() time.Time) *Server {
	return &Server{store: s, auth: a, log: log, rng: rng, now: now}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	catalog := meta.BuildCatalog()
	mux.HandleFunc("GET /api/catalog", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, catalog) })
	s.auth.Register(mux)

	mux.HandleFunc("GET /api/profile", s.player(s.profile))
	mux.HandleFunc("POST /api/profile/login", s.player(s.claimLogin))
	mux.HandleFunc("POST /api/profile/fleet", s.player(s.setFleet))
	mux.HandleFunc("POST /api/profile/secretary", s.player(s.setSecretary))
	mux.HandleFunc("POST /api/profile/name", s.player(s.rename))
	mux.HandleFunc("POST /api/ships/{uid}/train", s.player(s.train))
	mux.HandleFunc("POST /api/gacha", s.player(s.pull))
	mux.HandleFunc("POST /api/missions/{id}/claim", s.player(s.claimMission))
	mux.HandleFunc("POST /api/achievements/{id}/claim", s.player(s.claimAchievement))
	mux.HandleFunc("GET /api/gifts", s.player(s.listGifts))
	mux.HandleFunc("POST /api/gifts/claim", s.player(s.claimGifts))

	mux.HandleFunc("GET /api/friends", s.player(s.listFriends))
	mux.HandleFunc("GET /api/friends/{code}", s.player(s.friendProfile))
	mux.HandleFunc("POST /api/friends/requests", s.player(s.requestFriend))
	mux.HandleFunc("POST /api/friends/requests/{code}/accept", s.player(s.friendChange(s.store.AcceptFriend)))
	mux.HandleFunc("POST /api/friends/requests/{code}/decline", s.player(s.friendChange(s.store.DeclineFriend)))
	mux.HandleFunc("POST /api/friends/requests/{code}/cancel", s.player(s.friendChange(s.store.CancelFriendRequest)))
	mux.HandleFunc("POST /api/friends/{code}/remove", s.player(s.friendChange(s.store.RemoveFriend)))
	mux.HandleFunc("POST /api/friends/cheer", s.player(s.cheerFriends))
	mux.HandleFunc("POST /api/friends/{code}/cheer", s.player(s.cheerFriends))
	mux.HandleFunc("POST /api/friends/cheers/claim", s.player(s.claimCheers))

	mux.HandleFunc("GET /api/rankings/{board}", s.player(s.ranking))

	duel := func(h playerHandler) http.HandlerFunc { return s.feature(auth.FeatureDuels, s.player(h)) }
	mux.HandleFunc("GET /api/duels", duel(s.duelLobby))
	mux.HandleFunc("POST /api/duels", duel(s.createDuel))
	mux.HandleFunc("POST /api/duels/join", duel(s.joinDuel))
	mux.HandleFunc("GET /api/duels/{id}", duel(s.getDuel))
	mux.HandleFunc("POST /api/duels/{id}/placement", duel(s.placeDuel))
	mux.HandleFunc("POST /api/duels/{id}/actions", duel(s.actDuel))
	mux.HandleFunc("POST /api/duels/{id}/leave", duel(s.leaveDuel))

	mux.HandleFunc("POST /api/games", s.player(s.createGame))
	mux.HandleFunc("GET /api/games", s.player(s.listGames))
	mux.HandleFunc("GET /api/games/current", s.player(s.currentGame))
	mux.HandleFunc("GET /api/games/{id}", s.player(s.getGame))
	mux.HandleFunc("POST /api/games/{id}/actions", s.player(s.act))
	mux.HandleFunc("POST /api/games/{id}/chest", s.player(s.openChest))
	mux.HandleFunc("POST /api/games/{id}/rematch", s.player(s.rematch))
	mux.HandleFunc("POST /api/games/{id}/abandon", s.player(s.abandon))

	mux.HandleFunc("GET /api/admin/gifts", s.admin(s.adminListGifts))
	mux.HandleFunc("POST /api/admin/gifts", s.admin(s.adminCreateGift))
	mux.HandleFunc("POST /api/admin/gifts/{id}/revoke", s.admin(s.adminRevokeGift))
	mux.HandleFunc("GET /api/admin/players", s.admin(s.adminFindPlayers))
	mux.HandleFunc("GET /api/admin/audit", s.admin(s.adminAudit))
	return mux
}

type playerHandler func(w http.ResponseWriter, r *http.Request, pid string)

// player requires a signed-in admiral.
func (s *Server) player(h playerHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		pid, ok := s.auth.PlayerID(w, r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "ログインしてください")
			return
		}
		h(w, r, pid)
	}
}

// feature hides h, as if it did not exist, until the feature is released to the admiral.
func (s *Server) feature(name string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.auth.Enabled(w, r, name) {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		h(w, r)
	}
}

// withRng runs fn with exclusive use of the server's random source.
func (s *Server) withRng(fn func(*rand.Rand)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fn(s.rng)
}

// ---- profile ----

func (s *Server) profile(w http.ResponseWriter, r *http.Request, pid string) {
	s.updateProfile(w, r, pid, func(*meta.Profile) (map[string]any, error) { return map[string]any{}, nil })
}

// updateProfile applies fn to the locked profile and replies with fn's fields plus the profile view.
func (s *Server) updateProfile(w http.ResponseWriter, r *http.Request, pid string, fn func(*meta.Profile) (map[string]any, error)) {
	var out map[string]any
	now := s.now()
	p, err := s.store.UpdatePlayer(r.Context(), pid, func(p *meta.Profile) error {
		var err error
		out, err = fn(p)
		return err
	})
	if err != nil {
		s.fail(w, err)
		return
	}
	out["profile"] = p.View(now)
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) claimLogin(w http.ResponseWriter, r *http.Request, pid string) {
	s.updateProfile(w, r, pid, func(p *meta.Profile) (map[string]any, error) {
		day, g, err := p.ClaimLogin(s.now())
		return map[string]any{"day": day, "grant": g}, err
	})
}

func (s *Server) setFleet(w http.ResponseWriter, r *http.Request, pid string) {
	var req struct {
		UIDs []string `json:"uids"`
	}
	if !s.decode(w, r, &req) {
		return
	}
	s.updateProfile(w, r, pid, func(p *meta.Profile) (map[string]any, error) {
		return map[string]any{}, p.SetFleet(req.UIDs)
	})
}

func (s *Server) setSecretary(w http.ResponseWriter, r *http.Request, pid string) {
	var req struct {
		UID string `json:"uid"`
	}
	if !s.decode(w, r, &req) {
		return
	}
	s.updateProfile(w, r, pid, func(p *meta.Profile) (map[string]any, error) {
		return map[string]any{}, p.SetSecretary(req.UID)
	})
}

func (s *Server) rename(w http.ResponseWriter, r *http.Request, pid string) {
	var req struct {
		Name    string `json:"name"`
		Comment string `json:"comment"`
	}
	if !s.decode(w, r, &req) {
		return
	}
	s.updateProfile(w, r, pid, func(p *meta.Profile) (map[string]any, error) {
		return map[string]any{}, p.Rename(req.Name, req.Comment)
	})
}

// train buys one level, or with ?max=1 as many as the coins allow.
func (s *Server) train(w http.ResponseWriter, r *http.Request, pid string) {
	levels := 1
	if r.URL.Query().Get("max") == "1" {
		levels = 0
	}
	s.updateProfile(w, r, pid, func(p *meta.Profile) (map[string]any, error) {
		n, err := p.Train(r.PathValue("uid"), levels, s.now())
		return map[string]any{"levels": n}, err
	})
}

func (s *Server) pull(w http.ResponseWriter, r *http.Request, pid string) {
	var req struct {
		Count int `json:"count"`
	}
	if !s.decode(w, r, &req) {
		return
	}
	s.updateProfile(w, r, pid, func(p *meta.Profile) (map[string]any, error) {
		var (
			gains []meta.Gain
			err   error
		)
		s.withRng(func(rng *rand.Rand) { gains, err = p.Pull(req.Count, rng, s.now()) })
		return map[string]any{"gains": gains}, err
	})
}

func (s *Server) claimMission(w http.ResponseWriter, r *http.Request, pid string) {
	s.updateProfile(w, r, pid, func(p *meta.Profile) (map[string]any, error) {
		g, err := p.ClaimMission(r.PathValue("id"), s.now())
		return map[string]any{"grant": g}, err
	})
}

func (s *Server) claimAchievement(w http.ResponseWriter, r *http.Request, pid string) {
	s.updateProfile(w, r, pid, func(p *meta.Profile) (map[string]any, error) {
		g, err := p.ClaimAchievement(r.PathValue("id"))
		return map[string]any{"grant": g}, err
	})
}

// ---- matches ----

type matchResponse struct {
	ID     string       `json:"id"`
	Game   game.View    `json:"game"`
	Stage  meta.Stage   `json:"stage"`
	Fleet  []string     `json:"fleet"`
	Reward *meta.Reward `json:"reward,omitempty"`
}

func matchView(id string, m *meta.Match) matchResponse {
	return matchResponse{ID: id, Game: m.Game.PlayerView(), Stage: m.Stage, Fleet: m.Fleet, Reward: m.Reward.Public()}
}

type createGameRequest struct {
	StageID string `json:"stageId"`
	// Placements[i] is the position of fleet slot i.
	Placements []game.Pos `json:"placements"`
}

func (s *Server) createGame(w http.ResponseWriter, r *http.Request, pid string) {
	var req createGameRequest
	if !s.decode(w, r, &req) {
		return
	}
	var m *meta.Match
	// The profile is only read here, but locking it keeps the fleet consistent.
	if _, err := s.store.UpdatePlayer(r.Context(), pid, func(p *meta.Profile) error {
		var err error
		s.withRng(func(rng *rand.Rand) { m, err = meta.NewMatch(p, req.StageID, req.Placements, rng) })
		return err
	}); err != nil {
		s.fail(w, err)
		return
	}
	id, err := s.store.CreateMatch(r.Context(), m)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, matchView(id, m))
}

// rematch starts the same stage again with the fleet deployed as last time.
func (s *Server) rematch(w http.ResponseWriter, r *http.Request, pid string) {
	prev, err := s.getMatch(r, pid)
	if err != nil {
		s.fail(w, err)
		return
	}
	var m *meta.Match
	if _, err := s.store.UpdatePlayer(r.Context(), pid, func(p *meta.Profile) error {
		var err error
		s.withRng(func(rng *rand.Rand) { m, err = meta.Rematch(prev, p, rng) })
		return err
	}); err != nil {
		s.fail(w, err)
		return
	}
	id, err := s.store.CreateMatch(r.Context(), m)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, matchView(id, m))
}

// getMatch loads a match owned by pid; other admirals' matches are "not found".
func (s *Server) getMatch(r *http.Request, pid string) (*meta.Match, error) {
	m, err := s.store.GetMatch(r.Context(), r.PathValue("id"))
	if err == nil && m.PlayerID != pid {
		err = store.ErrNotFound
	}
	return m, err
}

func (s *Server) getGame(w http.ResponseWriter, r *http.Request, pid string) {
	m, err := s.getMatch(r, pid)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, matchView(r.PathValue("id"), m))
}

// currentGame finds the battle the admiral retreated from, on any device.
func (s *Server) currentGame(w http.ResponseWriter, r *http.Request, pid string) {
	id, m, err := s.store.CurrentMatch(r.Context(), pid)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, matchView(id, m))
}

type actionResponse struct {
	// Results are the round's actions, player's and CPU's, in the order they resolved.
	Results []game.Result     `json:"results"`
	Game    game.View         `json:"game"`
	Reward  *meta.Reward      `json:"reward,omitempty"`
	Profile *meta.ProfileView `json:"profile,omitempty"`
}

// actRequest is the player's action and, optionally, the turn it was chosen on.
type actRequest struct {
	game.Action
	// Turn is the number of rounds played in the view the action was chosen
	// from. When the battle has moved on since (played from another device),
	// the action is refused rather than applied to a board its sender never saw.
	Turn *int `json:"turn,omitempty"`
}

// errStaleTurn refuses an action chosen on an out-of-date view of the battle.
var errStaleTurn = errors.New("他の端末で戦況が進んだため、最新の状態に更新します")

// act plays one round: the player's action against the CPU's, which it
// commits without seeing the player's. The battle that ends here is settled in
// the same transaction.
func (s *Server) act(w http.ResponseWriter, r *http.Request, pid string) {
	var req actRequest
	if !s.decode(w, r, &req) {
		return
	}
	id := r.PathValue("id")
	var resp actionResponse
	now := s.now()
	m, p, err := s.store.UpdateMatch(r.Context(), id, func(m *meta.Match, p *meta.Profile) error {
		if m.PlayerID != pid {
			return store.ErrNotFound
		}
		if req.Turn != nil && *req.Turn != m.Game.Turn && m.Game.Status == game.StatusInProgress {
			return errStaleTurn
		}
		var err error
		s.withRng(func(rng *rand.Rand) {
			if resp.Results, err = m.Game.Round(req.Action, rng); err != nil {
				return
			}
			meta.Settle(m, p, rng, now)
		})
		return err
	})
	if err != nil {
		s.fail(w, err)
		return
	}
	resp.Game = m.Game.PlayerView()
	if m.Reward != nil {
		resp.Reward = m.Reward.Public()
		v := p.View(now)
		resp.Profile = &v
	}
	writeJSON(w, http.StatusOK, resp)
}

// abandon withdraws from a suspended battle for good, settled as a defeat.
func (s *Server) abandon(w http.ResponseWriter, r *http.Request, pid string) {
	now := s.now()
	m, p, err := s.store.UpdateMatch(r.Context(), r.PathValue("id"), func(m *meta.Match, p *meta.Profile) error {
		if m.PlayerID != pid {
			return store.ErrNotFound
		}
		if err := m.Game.Abandon(); err != nil {
			return err
		}
		s.withRng(func(rng *rand.Rand) { meta.Settle(m, p, rng, now) })
		return nil
	})
	if err != nil {
		s.fail(w, err)
		return
	}
	v := p.View(now)
	writeJSON(w, http.StatusOK, actionResponse{Results: []game.Result{}, Game: m.Game.PlayerView(), Reward: m.Reward.Public(), Profile: &v})
}

func (s *Server) openChest(w http.ResponseWriter, r *http.Request, pid string) {
	var req struct {
		Index int `json:"index"`
	}
	if !s.decode(w, r, &req) {
		return
	}
	now := s.now()
	var chest *meta.Chest
	m, p, err := s.store.UpdateMatch(r.Context(), r.PathValue("id"), func(m *meta.Match, p *meta.Profile) error {
		if m.PlayerID != pid {
			return store.ErrNotFound
		}
		var err error
		chest, err = meta.OpenChest(m, p, req.Index, now)
		return err
	})
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"chest": chest, "reward": m.Reward, "profile": p.View(now)})
}

func (s *Server) listGames(w http.ResponseWriter, r *http.Request, pid string) {
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 100 {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = n
	}
	games, err := s.store.ListFinished(r.Context(), pid, limit)
	if err != nil {
		s.fail(w, err)
		return
	}
	if games == nil {
		games = []store.Summary{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"games": games})
}

// ---- plumbing ----

func (s *Server) decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<16)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return false
	}
	return true
}

// fail maps domain errors to HTTP statuses.
func (s *Server) fail(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, game.ErrInvalidAction), errors.Is(err, game.ErrInvalidPlacement), errors.Is(err, meta.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	case errors.Is(err, meta.ErrInsufficient):
		writeError(w, http.StatusPaymentRequired, err.Error())
	case errors.Is(err, game.ErrGameOver), errors.Is(err, store.ErrInBattle), errors.Is(err, errStaleTurn),
		errors.Is(err, store.ErrInDuel), errors.Is(err, meta.ErrDuelMoved):
		writeError(w, http.StatusConflict, err.Error())
	default:
		s.log.Error("internal error", "err", err)
		writeError(w, http.StatusInternalServerError, "internal server error")
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
