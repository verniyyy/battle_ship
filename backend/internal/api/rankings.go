package api

import (
	"net/http"

	"github.com/verniyyy/battle_ship/backend/internal/meta"
)

// ---- rankings ----

func (s *Server) ranking(w http.ResponseWriter, r *http.Request, pid string) {
	board := meta.Board(r.PathValue("board"))
	if !board.Valid() {
		writeError(w, http.StatusNotFound, "そのランキングはありません")
		return
	}
	v, err := s.store.Ranking(r.Context(), pid, board, meta.RankingSize)
	if err != nil {
		s.fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ranking": v})
}
