package auth

import (
	"net/http"
	"testing"
	"time"
)

func TestSessionCookieSecurityDefaults(t *testing.T) {
	expiresAt := time.Now().Add(30 * 24 * time.Hour)
	cookie := SessionCookie("secret-token", expiresAt, CookieOptions{Secure: true})

	if cookie.Name != SessionCookieName {
		t.Fatalf("unexpected cookie name: %s", cookie.Name)
	}
	if cookie.Value != "secret-token" {
		t.Fatal("session token was not preserved")
	}
	if !cookie.HttpOnly {
		t.Fatal("session cookie must be HttpOnly")
	}
	if !cookie.Secure {
		t.Fatal("production session cookie must be Secure")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected SameSite mode: %v", cookie.SameSite)
	}
	if cookie.Path != "/" {
		t.Fatalf("unexpected cookie path: %s", cookie.Path)
	}
	if cookie.MaxAge <= 0 {
		t.Fatalf("expected a positive MaxAge, got %d", cookie.MaxAge)
	}
}

func TestExpiredSessionCookieClearsBrowserState(t *testing.T) {
	cookie := ExpiredSessionCookie(CookieOptions{Secure: true})
	if cookie.Value != "" {
		t.Fatal("expired cookie must have an empty value")
	}
	if cookie.MaxAge != -1 {
		t.Fatalf("expired cookie must use MaxAge=-1, got %d", cookie.MaxAge)
	}
	if !cookie.Expires.Before(time.Now()) {
		t.Fatal("expired cookie must have a past expiry")
	}
	if !cookie.HttpOnly || !cookie.Secure {
		t.Fatal("expired cookie must preserve security attributes")
	}
}
