package database

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Migrate(ctx context.Context, db *pgxpool.Pool, path string) error {
	if _, err := db.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}
	var applied bool
	if err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '000001_init')`).Scan(&applied); err != nil {
		return fmt.Errorf("check migration: %w", err)
	}
	if applied {
		return nil
	}
	sql, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read migration: %w", err)
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin migration: %w", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, string(sql)); err != nil {
		return fmt.Errorf("execute migration: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO schema_migrations(version) VALUES ('000001_init')`); err != nil {
		return fmt.Errorf("record migration: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migration: %w", err)
	}
	return nil
}
