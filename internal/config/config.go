package config

import (
	"fmt"
	"os"
	"strings"
)

type Config struct {
	Environment    string
	Port           string
	DatabaseURL    string
	AllowedOrigins []string
}

func Load() (Config, error) {
	cfg := Config{
		Environment:    getenv("APP_ENV", "development"),
		Port:           getenv("PORT", "8080"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		AllowedOrigins: splitCSV(getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500")),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func splitCSV(value string) []string {
	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		if origin := strings.TrimSpace(part); origin != "" {
			result = append(result, origin)
		}
	}
	return result
}
