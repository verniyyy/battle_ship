package main

import (
	"cmp"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/verniyyy/battle_ship/backend/internal/api"
	"github.com/verniyyy/battle_ship/backend/internal/auth"
	"github.com/verniyyy/battle_ship/backend/internal/store"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log); err != nil {
		log.Error("server stopped", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return errors.New("DATABASE_URL is required")
	}
	addr := os.Getenv("ADDR")
	if addr == "" {
		// Vercel tells the server which port to bind through PORT.
		addr = ":" + cmp.Or(os.Getenv("PORT"), "8080")
	}

	authCfg, sessions, err := authConfig()
	if err != nil {
		return err
	}

	pool, err := connect(ctx, log, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()

	pg := store.NewPostgres(pool)
	if err := pg.Migrate(ctx); err != nil {
		return err
	}
	log.Info("migrations applied")

	ver := version()
	log.Info("starting", "version", ver)

	mux := http.NewServeMux()
	authn := auth.New(authCfg, sessions, pg, log)
	mux.Handle("/", api.New(pg, authn, log, rand.New(rand.NewPCG(rand.Uint64(), rand.Uint64())), time.Now).Handler())
	// Unlike /healthz this touches the database, so a daily probe also keeps
	// an idle free-tier database from being paused.
	mux.HandleFunc("GET /readyz", func(w http.ResponseWriter, r *http.Request) {
		if _, err := pool.Exec(r.Context(), "SELECT 1"); err != nil {
			log.Error("readiness check failed", "err", err)
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET /api/version", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]string{"version": ver})
	})

	srv := &http.Server{
		Addr:              addr,
		Handler:           logRequests(log, requireOriginSecret(os.Getenv("ORIGIN_SECRET"), mux)),
		ReadHeaderTimeout: 5 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", addr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// authConfig reads the sign-in settings from the environment.
func authConfig() (auth.Config, *auth.Sessions, error) {
	cfg := auth.Config{
		PublicURL:          os.Getenv("PUBLIC_URL"),
		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		DevLogin:           os.Getenv("DEV_LOGIN") == "1",
	}
	secret := os.Getenv("SESSION_SECRET")
	switch {
	case len(secret) < 32:
		return cfg, nil, errors.New("SESSION_SECRET must be at least 32 characters")
	case cfg.GoogleClientID == "" && !cfg.DevLogin:
		return cfg, nil, errors.New("no sign-in method: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or DEV_LOGIN=1 locally)")
	case cfg.GoogleClientID != "" && (cfg.GoogleClientSecret == "" || cfg.PublicURL == ""):
		return cfg, nil, errors.New("Google sign-in needs GOOGLE_CLIENT_SECRET and PUBLIC_URL")
	}
	secure := strings.HasPrefix(cfg.PublicURL, "https://")
	return cfg, auth.NewSessions([]byte(secret), secure, time.Now), nil
}

// connect retries until the database accepts connections, which smooths over container start-up ordering.
func connect(ctx context.Context, log *slog.Logger, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	for attempt := 1; ; attempt++ {
		err := pool.Ping(ctx)
		if err == nil {
			return pool, nil
		}
		if attempt >= 30 {
			pool.Close()
			return nil, err
		}
		log.Warn("waiting for database", "attempt", attempt, "err", err)
		select {
		case <-ctx.Done():
			pool.Close()
			return nil, ctx.Err()
		case <-time.After(time.Second):
		}
	}
}

// requireOriginSecret rejects requests that did not come through the edge
// proxy, which adds the shared secret. An empty secret disables the check.
// The hosting firewall enforces the same rule before requests are billed;
// this is the backstop in case that rule is missing.
func requireOriginSecret(secret string, next http.Handler) http.Handler {
	if secret == "" {
		return next
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Origin-Auth")), []byte(secret)) != 1 {
			http.NotFound(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func logRequests(log *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Info("request", "method", r.Method, "path", r.URL.Path, "duration", time.Since(start))
	})
}
