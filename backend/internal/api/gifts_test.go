package api

import (
	"net/http"
	"testing"
	"time"

	"github.com/verniyyy/battle_ship/backend/internal/auth"
	"github.com/verniyyy/battle_ship/backend/internal/meta"
	"github.com/verniyyy/battle_ship/backend/internal/store"
)

func TestGiftsFromTheAdminConsole(t *testing.T) {
	ts := newTestServer(t)
	admin := auth.Session{PlayerID: "33333333-3333-4333-8333-333333333333", Email: "op@example.com", Subject: adminSubject}
	asAdmin := func(method, path string, body, out any) int {
		t.Helper()
		return doAs(t, ts, admin, nil, method, path, body, out)
	}
	for _, p := range []string{alice, bob} {
		if code := do(t, ts, p, "GET", "/api/profile", nil, nil); code != http.StatusOK {
			t.Fatalf("profile: %d", code)
		}
	}
	// The test server's clock.
	now := time.Date(2026, 9, 28, 12, 0, 0, 0, meta.JST)
	gift := func(title string, gems int, everyone bool) meta.Gift {
		return meta.Gift{Title: title, Gems: gems, Everyone: everyone, StartsAt: now.Add(-time.Hour), EndsAt: now.Add(24 * time.Hour)}
	}
	type created struct {
		ID string `json:"id"`
	}

	// Only admins, and only from the site itself.
	if code := do(t, ts, alice, "GET", "/api/admin/gifts", nil, nil); code != http.StatusForbidden {
		t.Fatalf("player in the console: %d", code)
	}
	if code := do(t, ts, "", "GET", "/api/admin/gifts", nil, nil); code != http.StatusForbidden {
		t.Fatalf("signed-out visitor in the console: %d", code)
	}
	cross := http.Header{"Sec-Fetch-Site": {"cross-site"}}
	if code := doAs(t, ts, admin, cross, "POST", "/api/admin/gifts", map[string]any{"gift": gift("x", 1, true)}, nil); code != http.StatusForbidden {
		t.Fatalf("cross-site create: %d", code)
	}

	// Bad drafts are refused before anything is saved.
	for name, body := range map[string]any{
		"no title":       map[string]any{"gift": gift("", 100, true)},
		"bad recipient":  map[string]any{"gift": gift("x", 100, false), "recipients": []string{"not-an-id"}},
		"unknown person": map[string]any{"gift": gift("x", 100, false), "recipients": []string{"44444444-4444-4444-8444-444444444444"}},
	} {
		if code := asAdmin("POST", "/api/admin/gifts", body, nil); code != http.StatusBadRequest {
			t.Errorf("%s: %d", name, code)
		}
	}

	var everyone, personal created
	if code := asAdmin("POST", "/api/admin/gifts", map[string]any{"gift": gift("お詫び", 300, true)}, &everyone); code != http.StatusCreated {
		t.Fatalf("create: %d", code)
	}
	// Recipient ids are tidied and deduplicated.
	if code := asAdmin("POST", "/api/admin/gifts", map[string]any{"gift": gift("個別補償", 50, false), "recipients": []string{" " + bob, bob, ""}}, &personal); code != http.StatusCreated {
		t.Fatalf("create personal: %d", code)
	}

	type box struct {
		Gifts []meta.Gift `json:"gifts"`
	}
	type claim struct {
		Claimed []store.Claimed  `json:"claimed"`
		Profile meta.ProfileView `json:"profile"`
	}
	var b box
	do(t, ts, alice, "GET", "/api/gifts", nil, &b)
	if len(b.Gifts) != 1 || b.Gifts[0].Title != "お詫び" {
		t.Fatalf("alice's box: %+v", b.Gifts)
	}
	var c claim
	if code := do(t, ts, alice, "POST", "/api/gifts/claim", map[string]any{}, &c); code != http.StatusOK || len(c.Claimed) != 1 || c.Profile.Gems != meta.StartGems+300 {
		t.Fatalf("claim all: %d %+v gems %d", code, c.Claimed, c.Profile.Gems)
	}
	do(t, ts, alice, "GET", "/api/gifts", nil, &b)
	if len(b.Gifts) != 0 {
		t.Fatalf("claimed gift still in the box: %+v", b.Gifts)
	}

	do(t, ts, bob, "GET", "/api/gifts", nil, &b)
	if len(b.Gifts) != 2 {
		t.Fatalf("bob's box: %+v", b.Gifts)
	}
	if code := do(t, ts, bob, "POST", "/api/gifts/claim", map[string]any{"id": personal.ID}, &c); code != http.StatusOK || len(c.Claimed) != 1 || c.Claimed[0].Grant.Gems != 50 {
		t.Fatalf("claim one: %d %+v", code, c.Claimed)
	}
	if code := do(t, ts, bob, "POST", "/api/gifts/claim", map[string]any{"id": personal.ID}, nil); code != http.StatusNotFound {
		t.Fatalf("claim twice: %d", code)
	}

	// Stopping the apology takes it out of bob's box.
	if code := asAdmin("POST", "/api/admin/gifts/"+everyone.ID+"/revoke", nil, nil); code != http.StatusNoContent {
		t.Fatalf("revoke: %d", code)
	}
	do(t, ts, bob, "GET", "/api/gifts", nil, &b)
	if len(b.Gifts) != 0 {
		t.Fatalf("revoked gift still in the box: %+v", b.Gifts)
	}

	var list struct {
		Gifts []store.GiftRecord `json:"gifts"`
	}
	asAdmin("GET", "/api/admin/gifts", nil, &list)
	if len(list.Gifts) != 2 || list.Gifts[1].Claims != 1 || list.Gifts[1].RevokedAt == nil {
		t.Fatalf("console list: %+v", list.Gifts)
	}
	var log struct {
		Entries []store.AuditEntry `json:"entries"`
	}
	asAdmin("GET", "/api/admin/audit", nil, &log)
	if len(log.Entries) != 3 || log.Entries[0].Action != "gift.revoke" || log.Entries[0].Actor != "op@example.com (google:admin)" {
		t.Fatalf("audit: %+v", log.Entries)
	}
	var found struct {
		Players []store.PlayerSummary `json:"players"`
	}
	if code := asAdmin("GET", "/api/admin/players?q="+bob, nil, &found); code != http.StatusOK || len(found.Players) != 1 {
		t.Fatalf("find: %d %+v", code, found)
	}
	if code := asAdmin("GET", "/api/admin/players?q=", nil, nil); code != http.StatusBadRequest {
		t.Fatalf("empty search: %d", code)
	}
}
