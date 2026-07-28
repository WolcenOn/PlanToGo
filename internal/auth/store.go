package auth

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalidOrExpiredToken = errors.New("invalid or expired authentication token")

// Store encapsulates persistence for login tokens and sessions.
// It is intentionally not wired into the HTTP router yet.
type Store struct {
	db *pgxpool.Pool
}

type Session struct {
	ID         string
	UserID     string
	ExpiresAt  time.Time
	LastSeenAt time.Time
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func tokenHashBytes(token string) []byte {
	hash := HashToken(token)
	return hash[:]
}

func (s *Store) CreateLoginToken(ctx context.Context, userID, token string, expiresAt time.Time) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO login_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, userID, tokenHashBytes(token), expiresAt)
	return err
}

// ConsumeLoginToken marks a valid one-use token as consumed and returns its user.
// The UPDATE is atomic, preventing the same magic link from being used twice.
func (s *Store) ConsumeLoginToken(ctx context.Context, token string, now time.Time) (string, error) {
	var userID string
	err := s.db.QueryRow(ctx, `
		UPDATE login_tokens
		SET used_at = $2
		WHERE token_hash = $1
		  AND used_at IS NULL
		  AND expires_at > $2
		RETURNING user_id
	`, tokenHashBytes(token), now).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvalidOrExpiredToken
	}
	return userID, err
}

func (s *Store) CreateSession(ctx context.Context, userID, token string, expiresAt time.Time) error {
	_, err := s.db.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3)
	`, userID, tokenHashBytes(token), expiresAt)
	return err
}

func (s *Store) FindSession(ctx context.Context, token string, now time.Time) (Session, error) {
	var session Session
	err := s.db.QueryRow(ctx, `
		UPDATE sessions
		SET last_seen_at = $2
		WHERE token_hash = $1
		  AND revoked_at IS NULL
		  AND expires_at > $2
		RETURNING id, user_id, expires_at, last_seen_at
	`, tokenHashBytes(token), now).Scan(&session.ID, &session.UserID, &session.ExpiresAt, &session.LastSeenAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidOrExpiredToken
	}
	return session, err
}

func (s *Store) RevokeSession(ctx context.Context, token string, now time.Time) error {
	_, err := s.db.Exec(ctx, `
		UPDATE sessions
		SET revoked_at = COALESCE(revoked_at, $2)
		WHERE token_hash = $1
	`, tokenHashBytes(token), now)
	return err
}

func (s *Store) DeleteExpired(ctx context.Context, now time.Time) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err = tx.Exec(ctx, `DELETE FROM login_tokens WHERE expires_at <= $1 OR used_at IS NOT NULL`, now); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM sessions WHERE expires_at <= $1 OR revoked_at IS NOT NULL`, now); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
