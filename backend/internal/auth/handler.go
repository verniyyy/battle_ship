package auth

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/endpoints"
)

// Identity is an account at an identity provider.
type Identity struct {
	Provider string
	Subject  string
	Email    string
}

// Accounts maps provider accounts to players.
type Accounts interface {
	// Resolve returns the identity's player, creating the account on first
	// sign-in. A new account adopts guestID, the player this browser played as
	// before signing in, unless another account already owns it.
	Resolve(ctx context.Context, id Identity, guestID string) (playerID string, err error)
}

type Config struct {
	// PublicURL is where players reach the site, e.g. https://example.com.
	// Google redirects back to it, so it must match the OAuth client's settings.
	PublicURL          string
	GoogleClientID     string
	GoogleClientSecret string
	// DevLogin allows signing in without Google. Only for local development.
	DevLogin bool
	// AdminSubjects are the session subjects (see Session.Subject) allowed into
	// the admin console, e.g. "google:1234567890". Signing in with the dev
	// login as an admin gives the subject DevAdminSubject.
	AdminSubjects []string
}

// DevAdminSubject is the subject of an admin signed in through the dev login.
// Google subjects are always prefixed "google:", so it cannot collide with one.
const DevAdminSubject = "dev:admin"

const (
	googleIssuer = "https://accounts.google.com"
	googleJWKS   = "https://www.googleapis.com/oauth2/v3/certs"
	callbackPath = "/api/auth/google/callback"
	flowCookie   = "oidc_flow"
	flowTTL      = 10 * time.Minute
)

// Handler serves the sign-in routes under /api/auth.
type Handler struct {
	sessions  *Sessions
	accounts  Accounts
	log       *slog.Logger
	publicURL string
	dev       bool
	admins    map[string]bool

	oauth    *oauth2.Config // nil when Google sign-in is not configured
	verifier *oidc.IDTokenVerifier
}

func New(cfg Config, sessions *Sessions, accounts Accounts, log *slog.Logger) *Handler {
	h := &Handler{sessions: sessions, accounts: accounts, log: log, publicURL: strings.TrimRight(cfg.PublicURL, "/"), dev: cfg.DevLogin, admins: map[string]bool{}}
	for _, s := range cfg.AdminSubjects {
		if s = strings.TrimSpace(s); s != "" {
			h.admins[s] = true
		}
	}
	if cfg.GoogleClientID != "" {
		h.oauth = &oauth2.Config{
			ClientID:     cfg.GoogleClientID,
			ClientSecret: cfg.GoogleClientSecret,
			Endpoint:     endpoints.Google,
			RedirectURL:  h.publicURL + callbackPath,
			Scopes:       []string{oidc.ScopeOpenID, "email"},
		}
		// The keys are fetched on first use, so a cold start makes no extra request.
		keys := oidc.NewRemoteKeySet(context.Background(), googleJWKS)
		h.verifier = oidc.NewVerifier(googleIssuer, keys, &oidc.Config{ClientID: cfg.GoogleClientID})
	}
	return h
}

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/session", h.session)
	mux.HandleFunc("POST /api/auth/logout", h.logout)
	if h.oauth != nil {
		mux.HandleFunc("GET /api/auth/google/login", h.googleLogin)
		mux.HandleFunc("GET "+callbackPath, h.googleCallback)
	}
	if h.dev {
		mux.HandleFunc("POST /api/auth/dev", h.devLogin)
	}
}

// PlayerID returns the signed-in player, or false.
func (h *Handler) PlayerID(w http.ResponseWriter, r *http.Request) (string, bool) {
	s, ok := h.sessions.Get(w, r)
	return s.PlayerID, ok
}

// Admin returns the signed-in session when it belongs to an admin. The list
// is checked on every request, so taking a subject off it takes effect at once.
func (h *Handler) Admin(w http.ResponseWriter, r *http.Request) (Session, bool) {
	s, ok := h.sessions.Get(w, r)
	return s, ok && s.Subject != "" && h.admins[s.Subject]
}

// FromOwnSite reports whether a state-changing request may come from the
// browser's own pages: a cross-site page cannot forge it. Browsers name the
// requesting page in Origin and Sec-Fetch-Site; tools that send neither carry
// no ambient cookie of someone else's, so they pass.
func (h *Handler) FromOwnSite(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
		return false
	}
	if o := r.Header.Get("Origin"); o != "" && h.publicURL != "" && o != h.publicURL {
		return false
	}
	return true
}

type sessionResponse struct {
	SignedIn bool   `json:"signedIn"`
	Email    string `json:"email,omitempty"`
	Admin    bool   `json:"admin,omitempty"`
	// The sign-in methods on offer.
	Google bool `json:"google"`
	Dev    bool `json:"dev"`
}

func (h *Handler) session(w http.ResponseWriter, r *http.Request) {
	s, ok := h.sessions.Get(w, r)
	writeJSON(w, http.StatusOK, sessionResponse{SignedIn: ok, Email: s.Email, Admin: ok && h.admins[s.Subject], Google: h.oauth != nil, Dev: h.dev})
}

func (h *Handler) logout(w http.ResponseWriter, _ *http.Request) {
	h.sessions.Clear(w)
	w.WriteHeader(http.StatusNoContent)
}

// flow is what the browser keeps between leaving for Google and coming back.
type flow struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Guest    string `json:"g,omitempty"`
	Expires  int64  `json:"x"`
}

// googleLogin sends the browser to Google's consent screen. ?guest= names the
// player this browser has been playing as, to carry over into a new account.
func (h *Handler) googleLogin(w http.ResponseWriter, r *http.Request) {
	f := flow{State: rand.Text(), Nonce: rand.Text(), Verifier: oauth2.GenerateVerifier(), Expires: h.sessions.now().Add(flowTTL).Unix()}
	if g := r.URL.Query().Get("guest"); IsPlayerID(g) {
		f.Guest = strings.ToLower(g)
	}
	token, err := h.sessions.signer.seal(f)
	if err != nil {
		h.fail(w, r, "seal flow", err)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: flowCookie, Value: token, Path: "/api/auth/google", MaxAge: int(flowTTL / time.Second),
		HttpOnly: true, Secure: h.sessions.secure, SameSite: http.SameSiteLaxMode,
	})
	target := h.oauth.AuthCodeURL(f.State, oidc.Nonce(f.Nonce), oauth2.S256ChallengeOption(f.Verifier),
		oauth2.SetAuthURLParam("prompt", "select_account"))
	http.Redirect(w, r, target, http.StatusFound)
}

func (h *Handler) googleCallback(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: flowCookie, Path: "/api/auth/google", MaxAge: -1, HttpOnly: true, Secure: h.sessions.secure})

	q := r.URL.Query()
	if e := q.Get("error"); e != "" {
		// access_denied is the player pressing "cancel".
		h.back(w, r, "cancelled")
		return
	}
	var f flow
	c, err := r.Cookie(flowCookie)
	if err != nil || h.sessions.signer.open(c.Value, &f) != nil || f.Expires < h.sessions.now().Unix() {
		h.back(w, r, "expired")
		return
	}
	if q.Get("state") != f.State {
		h.back(w, r, "expired")
		return
	}

	tok, err := h.oauth.Exchange(r.Context(), q.Get("code"), oauth2.VerifierOption(f.Verifier))
	if err != nil {
		h.fail(w, r, "exchange code", err)
		return
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok {
		h.fail(w, r, "exchange code", fmt.Errorf("no id_token in token response"))
		return
	}
	idt, err := h.verifier.Verify(r.Context(), raw)
	if err != nil {
		h.fail(w, r, "verify id token", err)
		return
	}
	if idt.Nonce != f.Nonce {
		h.fail(w, r, "verify id token", fmt.Errorf("nonce mismatch"))
		return
	}
	var claims struct {
		Email string `json:"email"`
	}
	if err := idt.Claims(&claims); err != nil {
		h.fail(w, r, "read claims", err)
		return
	}

	pid, err := h.accounts.Resolve(r.Context(), Identity{Provider: "google", Subject: idt.Subject, Email: claims.Email}, f.Guest)
	if err != nil {
		h.fail(w, r, "resolve account", err)
		return
	}
	if err := h.sessions.Issue(w, Session{PlayerID: pid, Email: claims.Email, Subject: "google:" + idt.Subject}); err != nil {
		h.fail(w, r, "issue session", err)
		return
	}
	h.log.Info("signed in", "provider", "google", "player", pid)
	h.back(w, r, "")
}

// devLogin signs in as the browser's guest player, or a new one, without
// Google; with admin, as an admin when DevAdminSubject is on the list.
func (h *Handler) devLogin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Guest string `json:"guest"`
		Admin bool   `json:"admin"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<12)
	_ = json.NewDecoder(r.Body).Decode(&req)
	pid := strings.ToLower(req.Guest)
	if !IsPlayerID(pid) {
		pid = NewPlayerID()
	}
	sess := Session{PlayerID: pid, Email: "dev@localhost"}
	if req.Admin {
		sess.Subject = DevAdminSubject
	}
	if err := h.sessions.Issue(w, sess); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// back returns the browser to the game, with ?login=<problem> when sign-in did not happen.
func (h *Handler) back(w http.ResponseWriter, r *http.Request, problem string) {
	target := h.publicURL + "/"
	if problem != "" {
		target += "?login=" + url.QueryEscape(problem)
	}
	http.Redirect(w, r, target, http.StatusFound)
}

func (h *Handler) fail(w http.ResponseWriter, r *http.Request, step string, err error) {
	h.log.Error("google sign-in failed", "step", step, "err", err)
	h.back(w, r, "failed")
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// IsPlayerID reports whether s is a well-formed player id (a UUID).
func IsPlayerID(s string) bool { return uuidRe.MatchString(s) }

// NewPlayerID returns a random version 4 UUID.
func NewPlayerID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
