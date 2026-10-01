package api

import (
	"net/http"
	"slices"
	"strings"

	"github.com/verniyyy/battle_ship/backend/internal/auth"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

// ---- gift box ----

func (s *Server) listGifts(w http.ResponseWriter, r *http.Request, pid string) {
	gifts, err := s.store.PendingGifts(r.Context(), pid, s.now())
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"gifts": orEmpty(gifts)})
}

// claimGifts collects one gift by id, or every pending one when id is empty.
func (s *Server) claimGifts(w http.ResponseWriter, r *http.Request, pid string) {
	var req struct {
		ID string `json:"id"`
	}
	if !s.decode(w, r, &req) {
		return
	}
	now := s.now()
	claimed, p, err := s.store.ClaimGifts(r.Context(), pid, req.ID, now)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"claimed": orEmpty(claimed), "profile": p.View(now)})
}

// ---- admin console ----

type adminHandler func(w http.ResponseWriter, r *http.Request, actor string)

// admin lets only admins through, and only from the site's own pages for
// anything that changes state. actor names them in the audit log.
func (s *Server) admin(h adminHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, ok := s.auth.Admin(w, r)
		switch {
		case !ok:
			writeError(w, http.StatusForbidden, "管理者のみ利用できます")
		case r.Method != http.MethodGet && !s.auth.FromOwnSite(r):
			writeError(w, http.StatusForbidden, "cross-site request refused")
		default:
			h(w, r, actorOf(sess))
		}
	}
}

func actorOf(s auth.Session) string {
	if s.Email != "" {
		return s.Email + " (" + s.Subject + ")"
	}
	return s.Subject
}

func (s *Server) adminListGifts(w http.ResponseWriter, r *http.Request, _ string) {
	gifts, err := s.store.ListGifts(r.Context(), 100)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"gifts": orEmpty(gifts)})
}

func (s *Server) adminCreateGift(w http.ResponseWriter, r *http.Request, actor string) {
	var req struct {
		Gift       meta.Gift `json:"gift"`
		Recipients []string  `json:"recipients"`
	}
	if !s.decode(w, r, &req) {
		return
	}
	var recipients []string
	for _, id := range req.Recipients {
		id = strings.ToLower(strings.TrimSpace(id))
		if id == "" {
			continue
		}
		if !auth.IsPlayerID(id) {
			writeError(w, http.StatusBadRequest, "提督 ID の形式が正しくありません: "+id)
			return
		}
		if !slices.Contains(recipients, id) {
			recipients = append(recipients, id)
		}
	}
	g := req.Gift
	g.ID = ""
	if err := g.Validate(recipients, s.now()); err != nil {
		s.fail(w, err)
		return
	}
	id, err := s.store.CreateGift(r.Context(), &g, recipients, actor)
	if err != nil {
		s.fail(w, err)
		return
	}
	s.log.Info("admin created a gift", "actor", actor, "gift", id, "recipients", len(recipients))
	writeJSON(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Server) adminRevokeGift(w http.ResponseWriter, r *http.Request, actor string) {
	id := r.PathValue("id")
	if err := s.store.RevokeGift(r.Context(), id, actor); err != nil {
		s.fail(w, err)
		return
	}
	s.log.Info("admin revoked a gift", "actor", actor, "gift", id)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) adminFindPlayers(w http.ResponseWriter, r *http.Request, _ string) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" || len(q) > 100 {
		writeError(w, http.StatusBadRequest, "検索語を入力してください")
		return
	}
	players, err := s.store.FindPlayers(r.Context(), q, 20)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"players": orEmpty(players)})
}

func (s *Server) adminAudit(w http.ResponseWriter, r *http.Request, _ string) {
	log, err := s.store.AuditLog(r.Context(), 100)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": orEmpty(log)})
}

// orEmpty keeps an empty list a JSON array rather than null.
func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}
