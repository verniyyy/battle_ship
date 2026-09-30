package auth

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-jose/go-jose/v4"
)

var secret = []byte("test-secret-test-secret-test-secret")

func TestSessionRoundTrip(t *testing.T) {
	now := time.Date(2026, 9, 30, 0, 0, 0, 0, time.UTC)
	s := NewSessions(secret, true, func() time.Time { return now })
	rec := httptest.NewRecorder()
	if err := s.Issue(rec, "p1", "a@example.com"); err != nil {
		t.Fatal(err)
	}
	c := rec.Result().Cookies()[0]
	if !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode {
		t.Fatalf("cookie flags: %+v", c)
	}

	get := func(value string) (Session, bool, *httptest.ResponseRecorder) {
		r := httptest.NewRequest("GET", "/", nil)
		r.AddCookie(&http.Cookie{Name: sessionCookie, Value: value})
		w := httptest.NewRecorder()
		sess, ok := s.Get(w, r)
		return sess, ok, w
	}
	if sess, ok, w := get(c.Value); !ok || sess.PlayerID != "p1" || sess.Email != "a@example.com" || len(w.Result().Cookies()) != 0 {
		t.Fatalf("fresh session: %+v %v", sess, ok)
	}

	// Tampering with the payload breaks the signature.
	payload, sig, _ := strings.Cut(c.Value, ".")
	forged, _ := json.Marshal(Session{PlayerID: "p2", Expires: now.Add(time.Hour).Unix()})
	if _, ok, _ := get(base64.RawURLEncoding.EncodeToString(forged) + "." + sig); ok {
		t.Fatal("forged session accepted")
	}
	if _, ok, _ := get(payload); ok {
		t.Fatal("unsigned session accepted")
	}
	other := NewSessions([]byte("another-secret-another-secret-xx"), true, s.now)
	if tok, _ := other.Token("p1", ""); func() bool { _, ok, _ := get(tok); return ok }() {
		t.Fatal("session signed with another key accepted")
	}

	// An old session is renewed on use; an expired one is refused.
	now = now.Add(sessionTTL - time.Hour)
	if _, ok, w := get(c.Value); !ok || len(w.Result().Cookies()) != 1 {
		t.Fatal("ageing session should be renewed")
	}
	now = now.Add(2 * time.Hour)
	if _, ok, _ := get(c.Value); ok {
		t.Fatal("expired session accepted")
	}
}

type fakeAccounts struct {
	got   Identity
	guest string
}

func (f *fakeAccounts) Resolve(_ context.Context, id Identity, guest string) (string, error) {
	f.got, f.guest = id, guest
	if guest != "" {
		return guest, nil
	}
	return "99999999-9999-4999-8999-999999999999", nil
}

// fakeGoogle issues ID tokens the way Google's token endpoint does.
type fakeGoogle struct {
	t         *testing.T
	key       *rsa.PrivateKey
	challenge string // PKCE challenge of the pending authorization
	nonce     string
	aud       string
}

func (g *fakeGoogle) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
	if r.Form.Get("code") != "good-code" || base64.RawURLEncoding.EncodeToString(sum[:]) != g.challenge {
		http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
		return
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: g.key}, nil)
	if err != nil {
		g.t.Fatal(err)
	}
	claims, _ := json.Marshal(map[string]any{
		"iss": googleIssuer, "aud": g.aud, "sub": "google-sub-1", "email": "admiral@example.com",
		"nonce": g.nonce, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(),
	})
	jws, err := signer.Sign(claims)
	if err != nil {
		g.t.Fatal(err)
	}
	idToken, _ := jws.CompactSerialize()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "at", "token_type": "Bearer", "expires_in": 3600, "id_token": idToken})
}

func TestGoogleSignIn(t *testing.T) {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	google := &fakeGoogle{t: t, key: key, aud: "client-1"}
	tokenSrv := httptest.NewServer(google)
	defer tokenSrv.Close()

	accounts := &fakeAccounts{}
	sessions := NewSessions(secret, false, time.Now)
	var app *httptest.Server
	h := New(Config{PublicURL: "http://placeholder", GoogleClientID: "client-1", GoogleClientSecret: "s"}, sessions, accounts, slog.New(slog.NewTextHandler(io.Discard, nil)))
	h.oauth.Endpoint.TokenURL = tokenSrv.URL
	h.verifier = oidc.NewVerifier(googleIssuer, &oidc.StaticKeySet{PublicKeys: []crypto.PublicKey{key.Public()}}, &oidc.Config{ClientID: "client-1"})
	mux := http.NewServeMux()
	h.Register(mux)
	app = httptest.NewServer(mux)
	defer app.Close()
	h.publicURL = app.URL

	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

	// Leaving for Google.
	guest := "11111111-1111-4111-8111-111111111111"
	res, err := client.Get(app.URL + "/api/auth/google/login?guest=" + guest)
	if err != nil {
		t.Fatal(err)
	}
	loc, _ := url.Parse(res.Header.Get("Location"))
	q := loc.Query()
	if res.StatusCode != http.StatusFound || loc.Host != "accounts.google.com" || q.Get("client_id") != "client-1" ||
		q.Get("code_challenge_method") != "S256" || q.Get("state") == "" || q.Get("nonce") == "" {
		t.Fatalf("authorization redirect: %d %s", res.StatusCode, loc)
	}
	google.challenge, google.nonce = q.Get("code_challenge"), q.Get("nonce")

	callback := func(query string) *http.Response {
		t.Helper()
		res, err := client.Get(app.URL + callbackPath + "?" + query)
		if err != nil {
			t.Fatal(err)
		}
		return res
	}
	signedIn := func() sessionResponse {
		t.Helper()
		res, err := client.Get(app.URL + "/api/auth/session")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var s sessionResponse
		_ = json.NewDecoder(res.Body).Decode(&s)
		return s
	}

	// A forged state is refused without signing in (and ends the attempt).
	if res := callback("code=good-code&state=forged"); !strings.HasSuffix(res.Header.Get("Location"), "?login=expired") || signedIn().SignedIn {
		t.Fatalf("forged state: %s", res.Header.Get("Location"))
	}

	// Start again and come back properly.
	res, _ = client.Get(app.URL + "/api/auth/google/login?guest=" + guest)
	loc, _ = url.Parse(res.Header.Get("Location"))
	q = loc.Query()
	google.challenge, google.nonce = q.Get("code_challenge"), q.Get("nonce")
	if res := callback("code=good-code&state=" + url.QueryEscape(q.Get("state"))); res.Header.Get("Location") != app.URL+"/" {
		t.Fatalf("callback: %d %s", res.StatusCode, res.Header.Get("Location"))
	}
	if accounts.got != (Identity{Provider: "google", Subject: "google-sub-1", Email: "admiral@example.com"}) || accounts.guest != guest {
		t.Fatalf("resolved %+v guest %q", accounts.got, accounts.guest)
	}
	if s := signedIn(); !s.SignedIn || s.Email != "admiral@example.com" || !s.Google || s.Dev {
		t.Fatalf("session: %+v", s)
	}
	// The flow cookie is single-use.
	if res := callback("code=good-code&state=" + url.QueryEscape(q.Get("state"))); !strings.HasSuffix(res.Header.Get("Location"), "?login=expired") {
		t.Fatalf("replayed callback: %s", res.Header.Get("Location"))
	}

	if res, _ := client.Post(app.URL+"/api/auth/logout", "", nil); res.StatusCode != http.StatusNoContent || signedIn().SignedIn {
		t.Fatal("logout did not sign out")
	}

	// The player pressing "cancel" at Google.
	if res := callback("error=access_denied"); !strings.HasSuffix(res.Header.Get("Location"), "?login=cancelled") {
		t.Fatalf("cancel: %s", res.Header.Get("Location"))
	}
}

func TestDevLoginIsOptIn(t *testing.T) {
	mux := http.NewServeMux()
	New(Config{GoogleClientID: "c", GoogleClientSecret: "s", PublicURL: "https://x"}, NewSessions(secret, true, time.Now), &fakeAccounts{}, slog.Default()).Register(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/dev", strings.NewReader(`{}`)))
	if rec.Code != http.StatusNotFound && rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("dev login without DEV_LOGIN: %d", rec.Code)
	}
}

func TestNewPlayerID(t *testing.T) {
	id := NewPlayerID()
	if !IsPlayerID(id) || id[14] != '4' || NewPlayerID() == id {
		t.Fatalf("bad id %q", id)
	}
}
