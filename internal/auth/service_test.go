package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

type fakeAuthRepository struct {
	user             User
	findByEmailErr   error
	consumedUserID   string
	consumeErr       error
	createdLoginUser string
	createdSession   string
	revokedToken     string
}

func (f *fakeAuthRepository) FindUserByEmail(context.Context, string) (User, error) {
	return f.user, f.findByEmailErr
}
func (f *fakeAuthRepository) FindUserByID(context.Context, string) (User, error) {
	return f.user, nil
}
func (f *fakeAuthRepository) CreateLoginToken(_ context.Context, userID, _ string, _ time.Time) error {
	f.createdLoginUser = userID
	return nil
}
func (f *fakeAuthRepository) ConsumeLoginToken(context.Context, string, time.Time) (string, error) {
	return f.consumedUserID, f.consumeErr
}
func (f *fakeAuthRepository) CreateSession(_ context.Context, _ string, token string, _ time.Time) error {
	f.createdSession = token
	return nil
}
func (f *fakeAuthRepository) RevokeSession(_ context.Context, token string, _ time.Time) error {
	f.revokedToken = token
	return nil
}

type fakeLinkSender struct{ link string }

func (f *fakeLinkSender) SendMagicLink(_ context.Context, _ User, link string) error {
	f.link = link
	return nil
}

func TestRequestMagicLinkDoesNotRevealUnknownUser(t *testing.T) {
	repository := &fakeAuthRepository{findByEmailErr: ErrUnknownUser}
	sender := &fakeLinkSender{}
	service := NewService(repository, sender, ServiceOptions{BaseURL: "https://example.test"})

	if err := service.RequestMagicLink(context.Background(), "unknown@example.test"); err != nil {
		t.Fatalf("expected generic success, got %v", err)
	}
	if sender.link != "" {
		t.Fatal("unknown user must not receive a link")
	}
}

func TestRequestMagicLinkCreatesOneUseToken(t *testing.T) {
	repository := &fakeAuthRepository{user: User{ID: "user-1", Email: "ana@example.test"}}
	sender := &fakeLinkSender{}
	service := NewService(repository, sender, ServiceOptions{BaseURL: "https://example.test"})

	if err := service.RequestMagicLink(context.Background(), "ANA@example.test"); err != nil {
		t.Fatalf("request magic link: %v", err)
	}
	if repository.createdLoginUser != "user-1" {
		t.Fatalf("unexpected user: %s", repository.createdLoginUser)
	}
	if !strings.HasPrefix(sender.link, "https://example.test/api/v1/auth/verify?token=") {
		t.Fatalf("unexpected link: %s", sender.link)
	}
}

func TestVerifyCreatesSession(t *testing.T) {
	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	repository := &fakeAuthRepository{
		user:           User{ID: "user-1", Name: "Ana", Email: "ana@example.test"},
		consumedUserID: "user-1",
	}
	service := NewService(repository, nil, ServiceOptions{Now: func() time.Time { return now }})

	token, expiresAt, user, err := service.Verify(context.Background(), "login-token")
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if token == "" || repository.createdSession != token {
		t.Fatal("session token was not created")
	}
	if !expiresAt.Equal(now.Add(DefaultSessionTTL)) {
		t.Fatalf("unexpected expiry: %v", expiresAt)
	}
	if user.ID != "user-1" {
		t.Fatalf("unexpected user: %+v", user)
	}
}

func TestVerifyRejectsConsumedOrExpiredToken(t *testing.T) {
	repository := &fakeAuthRepository{consumeErr: ErrInvalidOrExpiredToken}
	service := NewService(repository, nil, ServiceOptions{})

	_, _, _, err := service.Verify(context.Background(), "invalid")
	if !errors.Is(err, ErrInvalidOrExpiredToken) {
		t.Fatalf("expected invalid token error, got %v", err)
	}
}
