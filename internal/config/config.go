package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

type AuthConfig struct {
	Enabled     bool
	PublicURL   string
	CookieSecure bool
	SMTPHost    string
	SMTPPort    string
	SMTPUsername string
	SMTPPassword string
	SMTPFrom     string
	DevLogLinks bool
}

type Config struct {
	Environment    string
	Port           string
	DatabaseURL    string
	AllowedOrigins []string
	Auth           AuthConfig
}

func Load() (Config, error) {
	environment := getenv("APP_ENV", "development")
	cfg := Config{
		Environment:    environment,
		Port:           getenv("PORT", "8080"),
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		AllowedOrigins: splitCSV(getenv("CORS_ALLOWED_ORIGINS", "http://localhost:5500,http://127.0.0.1:5500")),
		Auth: AuthConfig{
			Enabled:      getenvBool("AUTH_ENABLED", false),
			PublicURL:    strings.TrimRight(os.Getenv("PUBLIC_URL"), "/"),
			CookieSecure: getenvBool("AUTH_COOKIE_SECURE", environment != "development"),
			SMTPHost:     strings.TrimSpace(os.Getenv("SMTP_HOST")),
			SMTPPort:     getenv("SMTP_PORT", "587"),
			SMTPUsername: strings.TrimSpace(os.Getenv("SMTP_USERNAME")),
			SMTPPassword: os.Getenv("SMTP_PASSWORD"),
			SMTPFrom:     strings.TrimSpace(os.Getenv("SMTP_FROM")),
			DevLogLinks:  getenvBool("AUTH_DEV_LOG_LINKS", false),
		},
	}
	if cfg.DatabaseURL == "" {
		return Config{}, fmt.Errorf("DATABASE_URL is required")
	}
	if cfg.Auth.Enabled {
		if cfg.Auth.PublicURL == "" {
			return Config{}, fmt.Errorf("PUBLIC_URL is required when AUTH_ENABLED=true")
		}
		if cfg.Auth.DevLogLinks && environment == "production" {
			return Config{}, fmt.Errorf("AUTH_DEV_LOG_LINKS cannot be enabled in production")
		}
		if !cfg.Auth.DevLogLinks && (cfg.Auth.SMTPHost == "" || cfg.Auth.SMTPFrom == "") {
			return Config{}, fmt.Errorf("SMTP_HOST and SMTP_FROM are required when authentication email delivery is enabled")
		}
	}
	return cfg, nil
}

func getenv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func getenvBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
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
