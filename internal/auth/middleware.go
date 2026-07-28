package auth

import (
	"context"
	"errors"
	"net/http"
	"time"
)

type sessionContextKey struct{}

// SessionFinder is the minimum persistence contract required by the optional
// authentication middleware. Store implements this interface.
type SessionFinder interface {
	FindSession(ctx context.Context, token string, now time.Time) (Session, error)
}

// OptionalSession resolves a valid session cookie and adds it to the request
// context. Missing, malformed, expired or revoked sessions never block the
// request, preserving the application's current email-based behaviour.
func OptionalSession(store SessionFinder, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			next.ServeHTTP(w, r)
			return
		}

		cookie, err := r.Cookie(SessionCookieName)
		if err != nil || cookie.Value == "" {
			next.ServeHTTP(w, r)
			return
		}

		session, err := store.FindSession(r.Context(), cookie.Value, time.Now().UTC())
		if err != nil {
			// Invalid credentials are deliberately ignored while authentication is
			// being introduced progressively. Unexpected storage errors also leave
			// the existing request flow untouched.
			if !errors.Is(err, ErrInvalidOrExpiredToken) {
				// Reserved for structured logging once the middleware receives a logger.
			}
			next.ServeHTTP(w, r)
			return
		}

		ctx := context.WithValue(r.Context(), sessionContextKey{}, session)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// SessionFromContext returns the authenticated session when OptionalSession
// resolved one. The boolean is false for all current anonymous requests.
func SessionFromContext(ctx context.Context) (Session, bool) {
	session, ok := ctx.Value(sessionContextKey{}).(Session)
	return session, ok
}

// UserIDFromContext is a convenience helper for future endpoint migrations.
func UserIDFromContext(ctx context.Context) (string, bool) {
	session, ok := SessionFromContext(ctx)
	if !ok || session.UserID == "" {
		return "", false
	}
	return session.UserID, true
}
