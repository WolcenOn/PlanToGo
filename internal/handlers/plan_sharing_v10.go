package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

type planShareTokenRequest struct {
	ActorEmail string `json:"actor_email"`
}

func NewRouterV10(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/plans/{id}/share-token", api.createPlanShareToken)
	mux.Handle("/", NewRouterV9(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) createPlanShareToken(w http.ResponseWriter, r *http.Request) {
	var input planShareTokenRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	_, owner, err := api.multiAccess(r, r.PathValue("id"), input.ActorEmail)
	if err != nil || !owner {
		writeError(w, http.StatusForbidden, "only the plan creator can generate a share link")
		return
	}
	token, hash, err := newToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not generate share link")
		return
	}
	if _, err := api.db.Exec(r.Context(), `
		INSERT INTO access_tokens(purpose,token_hash,plan_id)
		VALUES('plan_access',$1,$2)`, hash[:], r.PathValue("id")); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save share link")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"public_token": token})
}
