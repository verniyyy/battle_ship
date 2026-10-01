package api

import (
	"errors"
	"math/rand/v2"
	"net/http"
	"strconv"

	"github.com/verniyyy/battle_ship/backend/internal/game"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
	"github.com/verniyyy/battle_ship/backend/internal/store"
)

// ---- duels (beta) ----
//
// Both admirals poll the duel. Whichever request comes in after a deadline
// has run out moves the duel on (meta.Duel.Tick), so a duel never waits on an
// admiral who has left. Every reply is {"id", "duel"} from the asker's side.

func (s *Server) replyDuel(w http.ResponseWriter, status int, id, pid string, d *meta.Duel) {
	side, _ := d.SideOf(pid)
	writeJSON(w, status, map[string]any{"id": id, "duel": d.View(side, s.now())})
}

// tick moves the duel past a deadline that has run out, if one has.
func (s *Server) tick(d *meta.Duel) bool {
	var changed bool
	s.withRng(func(rng *rand.Rand) { changed = d.Tick(s.now(), rng) })
	return changed
}

// updateDuel applies fn to duel id as admiral pid, after catching up on deadlines.
func (s *Server) updateDuel(r *http.Request, id, pid string, fn func(*meta.Duel, game.Side) error) (*meta.Duel, error) {
	return s.store.UpdateDuel(r.Context(), id, func(d *meta.Duel) (bool, error) {
		side, ok := d.SideOf(pid)
		if !ok {
			return false, store.ErrNotFound
		}
		changed := s.tick(d)
		if fn == nil {
			return changed, nil
		}
		return true, fn(d, side)
	})
}

// duelLobby is the admiral's active duel (null when none) and their record.
func (s *Server) duelLobby(w http.ResponseWriter, r *http.Request, pid string) {
	out := map[string]any{"id": nil, "duel": nil}
	id, d, err := s.store.CurrentDuel(r.Context(), pid)
	if err == nil && d.Due(s.now()) {
		d, err = s.updateDuel(r, id, pid, nil)
	}
	switch {
	case err == nil:
		side, _ := d.SideOf(pid)
		out["id"], out["duel"] = id, d.View(side, s.now())
	case !errors.Is(err, store.ErrNotFound):
		s.fail(w, err)
		return
	}
	rec, err := s.store.DuelRecord(r.Context(), pid, 5)
	if err != nil {
		s.fail(w, err)
		return
	}
	out["record"] = rec
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) createDuel(w http.ResponseWriter, r *http.Request, pid string) {
	id, d, err := s.store.CreateDuel(r.Context(), pid, func(p *meta.Profile) (*meta.Duel, error) {
		var code string
		s.withRng(func(rng *rand.Rand) { code = meta.NewDuelCode(rng) })
		return meta.NewDuel(p, code, s.now())
	})
	if err != nil {
		s.fail(w, err)
		return
	}
	s.replyDuel(w, http.StatusCreated, id, pid, d)
}

func (s *Server) joinDuel(w http.ResponseWriter, r *http.Request, pid string) {
	var req struct {
		Code string `json:"code"`
	}
	if !s.decode(w, r, &req) {
		return
	}
	id, d, err := s.store.JoinDuel(r.Context(), pid, req.Code, func(d *meta.Duel, p *meta.Profile) error {
		return d.Join(p, s.now())
	})
	if err != nil {
		s.fail(w, err)
		return
	}
	s.replyDuel(w, http.StatusOK, id, pid, d)
}

// getDuel is the poll. With ?rev= set to the revision the client already
// has, an unchanged duel answers 204 and no body.
func (s *Server) getDuel(w http.ResponseWriter, r *http.Request, pid string) {
	id := r.PathValue("id")
	d, err := s.store.GetDuel(r.Context(), id)
	if err != nil {
		s.fail(w, err)
		return
	}
	if _, ok := d.SideOf(pid); !ok {
		s.fail(w, store.ErrNotFound)
		return
	}
	if d.Due(s.now()) {
		if d, err = s.updateDuel(r, id, pid, nil); err != nil {
			s.fail(w, err)
			return
		}
	}
	if rev, err := strconv.Atoi(r.URL.Query().Get("rev")); err == nil && rev == d.Rev {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.replyDuel(w, http.StatusOK, id, pid, d)
}

func (s *Server) placeDuel(w http.ResponseWriter, r *http.Request, pid string) {
	var req struct {
		Placements []game.Pos `json:"placements"`
	}
	if !s.decode(w, r, &req) {
		return
	}
	s.changeDuel(w, r, pid, func(d *meta.Duel, side game.Side) error {
		var err error
		s.withRng(func(rng *rand.Rand) { err = d.Place(side, req.Placements, s.now(), rng) })
		return err
	})
}

func (s *Server) actDuel(w http.ResponseWriter, r *http.Request, pid string) {
	var req struct {
		game.Action
		// Turn is the round count the order was chosen on.
		Turn int `json:"turn"`
	}
	if !s.decode(w, r, &req) {
		return
	}
	s.changeDuel(w, r, pid, func(d *meta.Duel, side game.Side) error {
		var err error
		s.withRng(func(rng *rand.Rand) { err = d.Act(side, req.Action, req.Turn, s.now(), rng) })
		return err
	})
}

// leaveDuel closes the room before the battle, or surrenders during it.
func (s *Server) leaveDuel(w http.ResponseWriter, r *http.Request, pid string) {
	s.changeDuel(w, r, pid, func(d *meta.Duel, side game.Side) error { return d.Leave(side) })
}

func (s *Server) changeDuel(w http.ResponseWriter, r *http.Request, pid string, fn func(*meta.Duel, game.Side) error) {
	id := r.PathValue("id")
	d, err := s.updateDuel(r, id, pid, fn)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.replyDuel(w, http.StatusOK, id, pid, d)
}
