package auth

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
)

var (
	ErrUnknownUser       = errors.New("unknown user")
	ErrDeliveryDisabled  = errors.New("magic link delivery is not configured")
	ErrAuthenticationOff = errors.New("authentication is disabled")
)

const (
	DefaultLoginTokenTTL = 15 * time.Minute
	DefaultSessionTTL    = 30 * 24 * time.Hour
)

type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type Repository interface {
	FindUserByEmail(ctx context.Context, email string) (User, error)
	FindUserByID(ctx context.Context, userID string) (User, error)
	CreateLoginToken(ctx context.Context, userID, token string, expiresAt time.Time) error
	ConsumeLoginToken(ctx context.Context, token string, now time.Time) (string, error)
	CreateSession(ctx context.Context, userID, token string, expiresAt time.Time) error
	RevokeSession(ctx context.Context, token string, now time.Time) error
}

type LinkSender interface {
	SendMagicLink(ctx context.Context, user User, link string) error
}

type ServiceOptions struct {
	BaseURL       string
	LoginTokenTTL time.Duration
	SessionTTL    time.Duration
	Now           func() time.Time
}

type Service struct {
	repository Repository
	sender     LinkSender
	baseURL    string
	loginTTL   time.Duration
	sessionTTL time.Duration
	now        func() time.Time
}

func NewService(repository Repository, sender LinkSender, options ServiceOptions) *Service {
	loginTTL := options.LoginTokenTTL
	if loginTTL <= 0 {
		loginTTL = DefaultLoginTokenTTL
	}
	sessionTTL := options.SessionTTL
	if sessionTTL <= 0 {
		sessionTTL = DefaultSessionTTL
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	return &Service{
		repository: repository,
		sender:     sender,
		baseURL:    strings.TrimRight(options.BaseURL, "/"),
		loginTTL:   loginTTL,
		sessionTTL: sessionTTL,
		now:        now,
	}
}

func NormalizeEmail(value string) (string, error) {
	email := strings.ToLower(strings.TrimSpace(value))
	address, err := mail.ParseAddress(email)
	if err != nil || !strings.EqualFold(address.Address, email) {
		return "", fmt.Errorf("invalid email")
	}
	return email, nil
}

// RequestMagicLink deliberately returns nil for unknown users so callers can
// use the same public response without revealing whether an email exists.
func (s *Service) RequestMagicLink(ctx context.Context, email string) error {
	if s.sender == nil || s.baseURL == "" {
		return ErrDeliveryDisabled
	}
	normalized, err := NormalizeEmail(email)
	if err != nil {
		return err
	}
	user, err := s.repository.FindUserByEmail(ctx, normalized)
	if errors.Is(err, ErrUnknownUser) {
		return nil
	}
	if err != nil {
		return err
	}
	token, err := NewToken()
	if err != nil {
		return err
	}
	if err := s.repository.CreateLoginToken(ctx, user.ID, token, s.now().Add(s.loginTTL)); err != nil {
		return err
	}
	link := s.baseURL + "/api/v1/auth/verify?token=" + token
	return s.sender.SendMagicLink(ctx, user, link)
}

func (s *Service) Verify(ctx context.Context, loginToken string) (sessionToken string, expiresAt time.Time, user User, err error) {
	now := s.now()
	userID, err := s.repository.ConsumeLoginToken(ctx, loginToken, now)
	if err != nil {
		return "", time.Time{}, User{}, err
	}
	user, err = s.repository.FindUserByID(ctx, userID)
	if err != nil {
		return "", time.Time{}, User{}, err
	}
	sessionToken, err = NewToken()
	if err != nil {
		return "", time.Time{}, User{}, err
	}
	expiresAt = now.Add(s.sessionTTL)
	if err := s.repository.CreateSession(ctx, userID, sessionToken, expiresAt); err != nil {
		return "", time.Time{}, User{}, err
	}
	return sessionToken, expiresAt, user, nil
}

func (s *Service) CurrentUser(ctx context.Context, userID string) (User, error) {
	if strings.TrimSpace(userID) == "" {
		return User{}, ErrInvalidOrExpiredToken
	}
	return s.repository.FindUserByID(ctx, userID)
}

func (s *Service) Logout(ctx context.Context, sessionToken string) error {
	if strings.TrimSpace(sessionToken) == "" {
		return nil
	}
	return s.repository.RevokeSession(ctx, sessionToken, s.now())
}
