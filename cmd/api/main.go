package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata"

	"github.com/WolcenOn/PlanToGo/internal/config"
	"github.com/WolcenOn/PlanToGo/internal/database"
	"github.com/WolcenOn/PlanToGo/internal/handlers"
)

func appHandler(api http.Handler) http.Handler {
	static := http.FileServer(http.Dir("docs"))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" || strings.HasPrefix(r.URL.Path, "/api/") {
			api.ServeHTTP(w, r)
			return
		}

		if r.URL.Path == "/" {
			http.ServeFile(w, r, "docs/index.html")
			return
		}

		assetPath := filepath.Join("docs", filepath.Clean(r.URL.Path))
		if info, err := os.Stat(assetPath); err == nil && !info.IsDir() {
			static.ServeHTTP(w, r)
			return
		}

		// Permite abrir enlaces públicos de planes y grupos directamente.
		http.ServeFile(w, r, "docs/index.html")
	})
}

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		logger.Error("load configuration", "error", err)
		os.Exit(1)
	}
	db, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("open database", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := database.Migrate(ctx, db, "migrations"); err != nil {
		logger.Error("run migrations", "error", err)
		os.Exit(1)
	}

	api := handlers.NewRouterV10(db, cfg.AllowedOrigins)
	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           appHandler(api),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	go func() {
		logger.Info("API and PWA started", "port", cfg.Port, "environment", cfg.Environment)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server stopped unexpectedly", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
	}
}
