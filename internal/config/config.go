package config

import (
	"fmt"
	"os"
)

type Config struct {
	Environment string
	Port        string
	DatabaseURL string
	PublicURL   string
}

func Load() (Config, error) {
	cfg := Config{
		Environment: getenv("APP_ENV", "development"),
		Port:        getenv("PORT", "8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		PublicURL:   getenv("PUBLIC_URL", "http://localhost:8080"),
	}

	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}

	return cfg, nil
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
