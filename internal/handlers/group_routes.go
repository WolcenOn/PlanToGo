package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type createGroupRequest struct {
	CreatorName  string `json:"creator_name"`
	CreatorEmail string `json:"creator_email"`
	Name         string `json:"name"`
	Description  string `json:"description"`
}

// NewRouterV4 adds group creation and permits browser write methods in CORS.
func NewRouterV4(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/groups", api.createGroup)
	mux.Handle("/", NewRouterV3(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) createGroup(w http.ResponseWriter, r *http.Request) {
	var input createGroupRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	input.CreatorName = strings.TrimSpace(input.CreatorName)
	input.CreatorEmail = strings.ToLower(strings.TrimSpace(input.CreatorEmail))
	input.Name = strings.TrimSpace(input.Name)
	input.Description = strings.TrimSpace(input.Description)
	if input.CreatorName == "" || input.CreatorEmail == "" || input.Name == "" {
		writeError(w, http.StatusBadRequest, "creator_name, creator_email and name are required")
		return
	}

	tx, err := api.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())

	var userID, groupID string
	if err = tx.QueryRow(r.Context(), `INSERT INTO users(name,email) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id`, input.CreatorName, input.CreatorEmail).Scan(&userID); err == nil {
		err = tx.QueryRow(r.Context(), `INSERT INTO groups(name,description) VALUES($1,$2) RETURNING id`, input.Name, input.Description).Scan(&groupID)
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'admin')`, groupID, userID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create group")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create group")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": groupID, "name": input.Name})
}

func corsWithWrites(origins []string, next http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		allowed[strings.TrimRight(strings.TrimSpace(origin), "/")] = struct{}{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/"); origin != "" {
			if _, ok := allowed[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
