package auth

import "net/http"

// FeatureDuels is duels between admirals.
const FeatureDuels = "duels"

// features are those that ship hidden until released. Config.Features turns
// one on for everyone; admins have them all, to try one out before release.
var features = []string{FeatureDuels}

// Features lists the features open to the signed-in admiral.
func (h *Handler) Features(w http.ResponseWriter, r *http.Request) []string {
	_, admin := h.Admin(w, r)
	out := []string{}
	for _, f := range features {
		if admin || h.released[f] {
			out = append(out, f)
		}
	}
	return out
}

// Enabled reports whether the feature is open to the signed-in admiral.
func (h *Handler) Enabled(w http.ResponseWriter, r *http.Request, feature string) bool {
	if h.released[feature] {
		return true
	}
	_, admin := h.Admin(w, r)
	return admin
}
