// Package auth signs admirals in with Google (OpenID Connect) and keeps them
// signed in with a session cookie.
//
// Sessions are stateless: the cookie carries the player id and an expiry,
// signed with HMAC-SHA256, so checking one never touches the database.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
)

const (
	sessionCookie = "session"
	sessionTTL    = 30 * 24 * time.Hour
	// A session with less than this left is renewed on use, so active players stay signed in.
	renewBelow = sessionTTL / 2
)

// Session is the signed-in admiral.
type Session struct {
	PlayerID string `json:"p"`
	// Email is the Google account's address, shown so players know which account they use.
	Email string `json:"e,omitempty"`
	// Subject is the account's stable id at its provider, which decides who is an admin.
	Subject string `json:"s,omitempty"`
	Expires int64  `json:"x"`
}

// signer seals values into tamper-proof cookie strings.
type signer struct{ key []byte }

func (s signer) seal(v any) (string, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(data)
	return payload + "." + base64.RawURLEncoding.EncodeToString(s.mac(payload)), nil
}

var errBadToken = errors.New("invalid token")

func (s signer) open(token string, v any) error {
	payload, sig, ok := strings.Cut(token, ".")
	if !ok {
		return errBadToken
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(got, s.mac(payload)) {
		return errBadToken
	}
	data, err := base64.RawURLEncoding.DecodeString(payload)
	if err != nil {
		return errBadToken
	}
	return json.Unmarshal(data, v)
}

func (s signer) mac(payload string) []byte {
	h := hmac.New(sha256.New, s.key)
	h.Write([]byte(payload))
	return h.Sum(nil)
}

// Sessions issues and checks session cookies.
type Sessions struct {
	signer signer
	secure bool
	now    func() time.Time
}

// NewSessions signs cookies with secret. Secure cookies are only sent over HTTPS.
func NewSessions(secret []byte, secure bool, now func() time.Time) *Sessions {
	return &Sessions{signer: signer{key: secret}, secure: secure, now: now}
}

// Token returns a cookie value for sess starting now; its expiry is set here.
func (s *Sessions) Token(sess Session) (string, error) {
	sess.Expires = s.now().Add(sessionTTL).Unix()
	return s.signer.seal(sess)
}

// Issue signs the player in on this browser.
func (s *Sessions) Issue(w http.ResponseWriter, sess Session) error {
	token, err := s.Token(sess)
	if err != nil {
		return err
	}
	s.set(w, sessionCookie, token, sessionTTL)
	return nil
}

// Clear signs the browser out.
func (s *Sessions) Clear(w http.ResponseWriter) { s.set(w, sessionCookie, "", -1) }

// Get returns the request's session, renewing the cookie when it is getting old.
func (s *Sessions) Get(w http.ResponseWriter, r *http.Request) (Session, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil {
		return Session{}, false
	}
	var sess Session
	if s.signer.open(c.Value, &sess) != nil || sess.PlayerID == "" {
		return Session{}, false
	}
	left := time.Unix(sess.Expires, 0).Sub(s.now())
	if left <= 0 {
		return Session{}, false
	}
	if left < renewBelow {
		_ = s.Issue(w, sess)
	}
	return sess, true
}

func (s *Sessions) set(w http.ResponseWriter, name, value string, ttl time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   int(ttl / time.Second),
		HttpOnly: true,
		Secure:   s.secure,
		// Lax still sends the cookie on the top-level redirect back from Google.
		SameSite: http.SameSiteLaxMode,
	})
}
