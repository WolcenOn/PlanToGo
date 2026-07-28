package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
)

type HTTPOptions struct {
	Cookie CookieOptions
}

type HTTPHandler struct {
	service *Service
	options HTTPOptions
}

func NewHTTPHandler(service *Service, options HTTPOptions) *HTTPHandler {
	return &HTTPHandler{service: service, options: options}
}

// Routes returns an isolated authentication router. It is not registered in
// the application router yet, so introducing this file changes no public flow.
func (h *HTTPHandler) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/auth/request", h.requestMagicLink)
	mux.HandleFunc("GET /api/v1/auth/verify", h.verify)
	mux.HandleFunc("GET /api/v1/auth/me", h.me)
	mux.HandleFunc("POST /api/v1/auth/logout", h.logout)
	return mux
}

type requestMagicLinkInput struct {
	Email string `json:"email"`
}

func (h *HTTPHandler) requestMagicLink(w http.ResponseWriter, r *http.Request) {
	var input requestMagicLinkInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeAuthError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if err := h.service.RequestMagicLink(r.Context(), input.Email); err != nil {
		switch {
		case errors.Is(err, ErrDeliveryDisabled):
			writeAuthError(w, http.StatusServiceUnavailable, "authentication is not configured")
		case strings.Contains(err.Error(), "invalid email"):
			writeAuthError(w, http.StatusBadRequest, "invalid email")
		default:
			writeAuthError(w, http.StatusInternalServerError, "could not request access link")
		}
		return
	}
	writeAuthJSON(w, http.StatusAccepted, map[string]string{
		"message": "If the email belongs to an existing user, an access link will be sent.",
	})
}

func (h *HTTPHandler) verify(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" {
		writeAuthError(w, http.StatusBadRequest, "token is required")
		return
	}
	sessionToken, expiresAt, _, err := h.service.Verify(r.Context(), token)
	if err != nil {
		if errors.Is(err, ErrInvalidOrExpiredToken) {
			writeAuthError(w, http.StatusUnauthorized, "invalid or expired access link")
			return
		}
		writeAuthError(w, http.StatusInternalServerError, "could not create session")
		return
	}
	http.SetCookie(w, SessionCookie(sessionToken, expiresAt, h.options.Cookie))
	http.Redirect(w, r, "/", http.StatusSeeOther)
}

func (h *HTTPHandler) me(w http.ResponseWriter, r *http.Request) {
	userID, ok := UserIDFromContext(r.Context())
	if !ok {
		writeAuthError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	user, err := h.service.CurrentUser(r.Context(), userID)
	if err != nil {
		writeAuthError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	writeAuthJSON(w, http.StatusOK, map[string]any{"user": user})
}

func (h *HTTPHandler) logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(SessionCookieName)
	if err == nil {
		if err := h.service.Logout(r.Context(), cookie.Value); err != nil {
			writeAuthError(w, http.StatusInternalServerError, "could not close session")
			return
		}
	}
	http.SetCookie(w, ExpiredSessionCookie(h.options.Cookie))
	w.WriteHeader(http.StatusNoContent)
}

func writeAuthJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeAuthError(w http.ResponseWriter, status int, message string) {
	writeAuthJSON(w, status, map[string]string{"error": message})
}
