package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeSessionFinder struct {
	session Session
	err     error
	called  bool
	token   string
}

func (f *fakeSessionFinder) FindSession(_ context.Context, token string, _ time.Time) (Session, error) {
	f.called = true
	f.token = token
	return f.session, f.err
}

func TestOptionalSessionWithoutCookieKeepsRequestAnonymous(t *testing.T) {
	store := &fakeSessionFinder{}
	handler := OptionalSession(store, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := SessionFromContext(r.Context()); ok {
			t.Fatal("unexpected session in anonymous request")
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/test", nil))

	if response.Code != http.StatusNoContent {
		t.Fatalf("unexpected status: %d", response.Code)
	}
	if store.called {
		t.Fatal("store should not be queried without a cookie")
	}
}

func TestOptionalSessionAddsValidSessionToContext(t *testing.T) {
	store := &fakeSessionFinder{session: Session{ID: "session-1", UserID: "user-1"}}
	handler := OptionalSession(store, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok || userID != "user-1" {
			t.Fatalf("unexpected user context: %q, %v", userID, ok)
		}
		w.WriteHeader(http.StatusNoContent)
	}))

	request := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	request.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "plain-session-token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("unexpected status: %d", response.Code)
	}
	if !store.called || store.token != "plain-session-token" {
		t.Fatalf("session token was not resolved correctly: called=%v token=%q", store.called, store.token)
	}
}

func TestOptionalSessionIgnoresInvalidSession(t *testing.T) {
	store := &fakeSessionFinder{err: ErrInvalidOrExpiredToken}
	called := false
	handler := OptionalSession(store, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if _, ok := SessionFromContext(r.Context()); ok {
			t.Fatal("invalid session must not reach the context")
		}
		w.WriteHeader(http.StatusAccepted)
	}))

	request := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	request.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "expired-token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if !called || response.Code != http.StatusAccepted {
		t.Fatalf("request flow changed: called=%v status=%d", called, response.Code)
	}
}

func TestOptionalSessionIgnoresStoreFailure(t *testing.T) {
	store := &fakeSessionFinder{err: errors.New("database unavailable")}
	handler := OptionalSession(store, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	request := httptest.NewRequest(http.MethodGet, "/api/test", nil)
	request.AddCookie(&http.Cookie{Name: SessionCookieName, Value: "token"})
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("store failure must not block legacy flow: %d", response.Code)
	}
}
