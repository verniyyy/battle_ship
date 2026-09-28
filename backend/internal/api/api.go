// Package api exposes the game over a JSON HTTP API.
package api

import (
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"strconv"
	"sync"

	"github.com/verniyyy/battle_ship/backend/internal/game"
	"github.com/verniyyy/battle_ship/backend/internal/store"
)

type Server struct {
	store store.Store
	log   *slog.Logger

	mu  sync.Mutex // guards rng, which is not safe for concurrent use
	rng *rand.Rand
}

func New(s store.Store, log *slog.Logger, rng *rand.Rand) *Server {
	return &Server{store: s, log: log, rng: rng}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	mux.HandleFunc("GET /api/fleet", s.fleet)
	mux.HandleFunc("POST /api/games", s.createGame)
	mux.HandleFunc("GET /api/games", s.listGames)
	mux.HandleFunc("GET /api/games/{id}", s.getGame)
	mux.HandleFunc("POST /api/games/{id}/actions", s.act)
	mux.HandleFunc("GET /api/stats", s.stats)
	return mux
}

type gameResponse struct {
	ID   string    `json:"id"`
	Game game.View `json:"game"`
}

func (s *Server) fleet(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"boardSize": game.BoardSize, "ships": game.Fleet})
}

type createGameRequest struct {
	// Placements[i] is the position of ship ID i.
	Placements []game.Pos `json:"placements"`
}

func (s *Server) createGame(w http.ResponseWriter, r *http.Request) {
	var req createGameRequest
	if !s.decode(w, r, &req) {
		return
	}
	player, err := game.NewBoard(req.Placements)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	s.mu.Lock()
	cpu, err := game.NewBoard(game.RandomPlacement(s.rng))
	s.mu.Unlock()
	if err != nil {
		s.internal(w, err)
		return
	}
	st := game.NewState(player, cpu)
	id, err := s.store.Create(r.Context(), st)
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, gameResponse{ID: id, Game: st.PlayerView()})
}

func (s *Server) getGame(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	st, err := s.store.Get(r.Context(), id)
	if err != nil {
		s.storeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, gameResponse{ID: id, Game: st.PlayerView()})
}

type actionResponse struct {
	Player game.Result  `json:"player"`
	CPU    *game.Result `json:"cpu,omitempty"`
	Game   game.View    `json:"game"`
}

// act applies the player's action and, unless that ended the game, the CPU's reply.
func (s *Server) act(w http.ResponseWriter, r *http.Request) {
	var a game.Action
	if !s.decode(w, r, &a) {
		return
	}
	var resp actionResponse
	st, err := s.store.Update(r.Context(), r.PathValue("id"), func(st *game.State) error {
		res, err := st.Apply(game.SidePlayer, a)
		if err != nil {
			return err
		}
		resp.Player = res
		if st.Status != game.StatusInProgress {
			return nil
		}
		s.mu.Lock()
		cpuAction := st.DecideCPU(s.rng)
		s.mu.Unlock()
		cpuRes, err := st.Apply(game.SideCPU, cpuAction)
		if err != nil {
			s.log.Error("cpu chose an invalid action", "action", cpuAction, "err", err)
			return err
		}
		resp.CPU = &cpuRes
		return nil
	})
	switch {
	case errors.Is(err, game.ErrInvalidAction):
		writeError(w, http.StatusBadRequest, err.Error())
		return
	case errors.Is(err, game.ErrGameOver):
		writeError(w, http.StatusConflict, err.Error())
		return
	case err != nil:
		s.storeError(w, err)
		return
	}
	resp.Game = st.PlayerView()
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) listGames(w http.ResponseWriter, r *http.Request) {
	limit := 20
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 100 {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = n
	}
	games, err := s.store.ListFinished(r.Context(), limit)
	if err != nil {
		s.internal(w, err)
		return
	}
	if games == nil {
		games = []store.Summary{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"games": games})
}

func (s *Server) stats(w http.ResponseWriter, r *http.Request) {
	st, err := s.store.Stats(r.Context())
	if err != nil {
		s.internal(w, err)
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<16)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return false
	}
	return true
}

func (s *Server) storeError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "game not found")
		return
	}
	s.internal(w, err)
}

func (s *Server) internal(w http.ResponseWriter, err error) {
	s.log.Error("internal error", "err", err)
	writeError(w, http.StatusInternalServerError, "internal server error")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
