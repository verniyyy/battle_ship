package api

import (
	"context"
	"net/http"
)

// ---- friends ----
//
// Other admirals are named by their friend code; every change replies with
// the friends screen as it now stands.

func (s *Server) listFriends(w http.ResponseWriter, r *http.Request, pid string) {
	s.replyFriends(w, r, pid, map[string]any{})
}

// replyFriends answers with the friends screen plus extra fields.
func (s *Server) replyFriends(w http.ResponseWriter, r *http.Request, pid string, out map[string]any) {
	l, err := s.store.FriendList(r.Context(), pid, s.now())
	if err != nil {
		s.fail(w, err)
		return
	}
	out["friends"] = l
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) friendProfile(w http.ResponseWriter, r *http.Request, pid string) {
	v, err := s.store.FriendProfile(r.Context(), pid, r.PathValue("code"))
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"friend": v})
}

func (s *Server) requestFriend(w http.ResponseWriter, r *http.Request, pid string) {
	var req struct {
		Code string `json:"code"`
	}
	if !s.decode(w, r, &req) {
		return
	}
	mutual, err := s.store.RequestFriend(r.Context(), pid, req.Code)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.replyFriends(w, r, pid, map[string]any{"befriended": mutual})
}

// friendChange answers a change that names the other admiral in the path,
// such as accepting their request.
func (s *Server) friendChange(fn func(ctx context.Context, pid, code string) error) playerHandler {
	return func(w http.ResponseWriter, r *http.Request, pid string) {
		if err := fn(r.Context(), pid, r.PathValue("code")); err != nil {
			s.fail(w, err)
			return
		}
		s.replyFriends(w, r, pid, map[string]any{})
	}
}

// cheerFriends cheers the friend in the path, or every friend without one.
func (s *Server) cheerFriends(w http.ResponseWriter, r *http.Request, pid string) {
	n, err := s.store.CheerFriends(r.Context(), pid, r.PathValue("code"), s.now())
	if err != nil {
		s.fail(w, err)
		return
	}
	s.replyFriends(w, r, pid, map[string]any{"sent": n})
}

func (s *Server) claimCheers(w http.ResponseWriter, r *http.Request, pid string) {
	now := s.now()
	n, g, p, err := s.store.ClaimCheers(r.Context(), pid, now)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.replyFriends(w, r, pid, map[string]any{"count": n, "grant": g, "profile": p.View(now)})
}
