package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type API struct {
	db *pgxpool.Pool
}

type createPlanRequest struct {
	CreatorName   string `json:"creator_name"`
	CreatorEmail  string `json:"creator_email"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	ConfirmedDate string `json:"confirmed_date"`
	LocationName  string `json:"location_name"`
	Address       string `json:"address"`
}

func NewRouter(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", api.health)
	mux.HandleFunc("GET /api/health", api.health)
	mux.HandleFunc("POST /api/v1/plans", api.createPlan)
	mux.HandleFunc("GET /api/v1/public/plans/{token}", api.getPublicPlan)
	return cors(origins, securityHeaders(mux))
}

func (api *API) health(w http.ResponseWriter, r *http.Request) {
	if err := api.db.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (api *API) createPlan(w http.ResponseWriter, r *http.Request) {
	var input createPlanRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	input.CreatorName = strings.TrimSpace(input.CreatorName)
	input.CreatorEmail = strings.ToLower(strings.TrimSpace(input.CreatorEmail))
	input.Title = strings.TrimSpace(input.Title)
	if input.CreatorName == "" || input.CreatorEmail == "" || input.Title == "" {
		writeError(w, http.StatusBadRequest, "creator_name, creator_email and title are required")
		return
	}

	confirmedDate, err := time.Parse(time.RFC3339, input.ConfirmedDate)
	if err != nil {
		writeError(w, http.StatusBadRequest, "confirmed_date must be RFC3339")
		return
	}

	token, hash, err := newToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not generate access token")
		return
	}

	tx, err := api.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())

	var userID, planID string
	err = tx.QueryRow(
		r.Context(),
		`INSERT INTO users(name,email) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
		input.CreatorName,
		input.CreatorEmail,
	).Scan(&userID)

	if err == nil {
		err = tx.QueryRow(
			r.Context(),
			`INSERT INTO plans(title,description,type,status,confirmed_date,location_name,address,created_by) VALUES($1,$2,'fixed','confirmed',$3,NULLIF($4,''),NULLIF($5,''),$6) RETURNING id`,
			input.Title,
			strings.TrimSpace(input.Description),
			confirmedDate,
			strings.TrimSpace(input.LocationName),
			strings.TrimSpace(input.Address),
			userID,
		).Scan(&planID)
	}

	if err == nil {
		_, err = tx.Exec(
			r.Context(),
			`INSERT INTO access_tokens(purpose,token_hash,plan_id) VALUES('plan_access',$1,$2)`,
			hash[:],
			planID,
		)
	}

	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create plan")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create plan")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{"id": planID, "public_token": token})
}

func (api *API) getPublicPlan(w http.ResponseWriter, r *http.Request) {
	token := r.PathValue("token")
	hash := sha256.Sum256([]byte(token))

	var plan struct {
		ID            string
		Title         string
		Description   string
		Status        string
		ConfirmedDate time.Time
		LocationName  *string
		Address       *string
	}

	err := api.db.QueryRow(
		r.Context(),
		`SELECT p.id,p.title,p.description,p.status,p.confirmed_date,p.location_name,p.address FROM access_tokens t JOIN plans p ON p.id=t.plan_id WHERE t.purpose='plan_access' AND t.token_hash=$1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>now())`,
		hash[:],
	).Scan(
		&plan.ID,
		&plan.Title,
		&plan.Description,
		&plan.Status,
		&plan.ConfirmedDate,
		&plan.LocationName,
		&plan.Address,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "plan not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":             plan.ID,
		"title":          plan.Title,
		"description":    plan.Description,
		"status":         plan.Status,
		"confirmed_date": plan.ConfirmedDate,
		"location_name":  plan.LocationName,
		"address":        plan.Address,
	})
}

func newToken() (string, [32]byte, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", [32]byte{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(buffer)
	return token, sha256.Sum256([]byte(token)), nil
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func cors(origins []string, next http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		normalized := strings.TrimRight(strings.TrimSpace(origin), "/")
		if normalized != "" {
			allowed[normalized] = struct{}{}
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
		if origin != "" {
			if _, ok := allowed[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
