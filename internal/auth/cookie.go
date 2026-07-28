package auth

import (
	"net/http"
	"time"
)

const SessionCookieName = "plantogo_session"

type CookieOptions struct {
	Secure bool
	Domain string
}

func SessionCookie(token string, expiresAt time.Time, options CookieOptions) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    token,
		Path:     "/",
		Domain:   options.Domain,
		Expires:  expiresAt.UTC(),
		MaxAge:   maxAgeUntil(expiresAt),
		HttpOnly: true,
		Secure:   options.Secure,
		SameSite: http.SameSiteLaxMode,
	}
}

func ExpiredSessionCookie(options CookieOptions) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		Domain:   options.Domain,
		Expires:  time.Unix(1, 0).UTC(),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   options.Secure,
		SameSite: http.SameSiteLaxMode,
	}
}

func maxAgeUntil(expiresAt time.Time) int {
	seconds := int(time.Until(expiresAt).Seconds())
	if seconds < 1 {
		return -1
	}
	return seconds
}
