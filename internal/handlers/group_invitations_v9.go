package handlers

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type groupJoinRequestInput struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

type groupInviteAdminInput struct {
	ActorEmail string `json:"actor_email"`
}

func NewRouterV9(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/groups/{id}/invite", api.createGroupInvite)
	mux.HandleFunc("GET /api/v1/groups/{id}/join-requests", api.listGroupJoinRequests)
	mux.HandleFunc("POST /api/v1/groups/{id}/join-requests/{requestID}/approve", api.approveGroupJoinRequest)
	mux.HandleFunc("GET /api/v1/public/groups/{token}", api.getPublicGroupInvite)
	mux.HandleFunc("POST /api/v1/public/groups/{token}/requests", api.requestGroupJoin)
	mux.Handle("/", NewRouterV8(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) createGroupInvite(w http.ResponseWriter, r *http.Request) {
	var input groupInviteAdminInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	_, admin, err := api.groupAdmin(r, r.PathValue("id"), input.ActorEmail)
	if err != nil || !admin {
		writeError(w, http.StatusForbidden, "only administrators can generate invitations")
		return
	}
	token, hash, err := newToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not generate invitation")
		return
	}
	expiresAt := time.Now().Add(30 * 24 * time.Hour)
	if _, err := api.db.Exec(r.Context(), `
		INSERT INTO access_tokens(purpose, token_hash, group_id, expires_at)
		VALUES('group_join', $1, $2, $3)`, hash[:], r.PathValue("id"), expiresAt); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save invitation")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"code": token, "expires_at": expiresAt})
}

func (api *API) groupInviteFromToken(r *http.Request) (string, string, error) {
	hash := sha256.Sum256([]byte(r.PathValue("token")))
	var tokenID, groupID string
	err := api.db.QueryRow(r.Context(), `
		SELECT id, group_id FROM access_tokens
		WHERE purpose='group_join' AND token_hash=$1 AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > now())`, hash[:]).Scan(&tokenID, &groupID)
	return tokenID, groupID, err
}

func (api *API) getPublicGroupInvite(w http.ResponseWriter, r *http.Request) {
	_, groupID, err := api.groupInviteFromToken(r)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "invitation not found or expired")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	var name, description string
	if err := api.db.QueryRow(r.Context(), `SELECT name, description FROM groups WHERE id=$1`, groupID).Scan(&name, &description); err != nil {
		writeError(w, http.StatusNotFound, "group not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": groupID, "name": name, "description": description})
}

func (api *API) requestGroupJoin(w http.ResponseWriter, r *http.Request) {
	var input groupJoinRequestInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if input.Name == "" || input.Email == "" {
		writeError(w, http.StatusBadRequest, "name and email are required")
		return
	}
	tokenID, groupID, err := api.groupInviteFromToken(r)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "invitation not found or expired")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	tx, err := api.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())
	var userID string
	if err := tx.QueryRow(r.Context(), `
		INSERT INTO users(name,email) VALUES($1,$2)
		ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name
		RETURNING id`, input.Name, input.Email).Scan(&userID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save requester")
		return
	}
	var alreadyMember bool
	if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2)`, groupID, userID).Scan(&alreadyMember); err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	if alreadyMember {
		writeJSON(w, http.StatusOK, map[string]string{"status": "already_member"})
		return
	}
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO group_join_requests(token_id,group_id,user_id,status)
		VALUES($1,$2,$3,'pending')
		ON CONFLICT(group_id,user_id) DO UPDATE SET token_id=EXCLUDED.token_id, status='pending', reviewed_at=NULL, reviewed_by=NULL`, tokenID, groupID, userID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create join request")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create join request")
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "pending"})
}

func (api *API) listGroupJoinRequests(w http.ResponseWriter, r *http.Request) {
	_, admin, err := api.groupAdmin(r, r.PathValue("id"), r.URL.Query().Get("email"))
	if err != nil || !admin {
		writeError(w, http.StatusForbidden, "only administrators can view requests")
		return
	}
	rows, err := api.db.Query(r.Context(), `
		SELECT q.id,u.name,u.email,q.created_at
		FROM group_join_requests q JOIN users u ON u.id=q.user_id
		WHERE q.group_id=$1 AND q.status='pending' ORDER BY q.created_at`, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load requests")
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id, name, email string
		var createdAt time.Time
		if err := rows.Scan(&id, &name, &email, &createdAt); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load requests")
			return
		}
		items = append(items, map[string]any{"id": id, "name": name, "email": email, "created_at": createdAt})
	}
	writeJSON(w, http.StatusOK, map[string]any{"requests": items})
}

func (api *API) approveGroupJoinRequest(w http.ResponseWriter, r *http.Request) {
	var input groupInviteAdminInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	adminID, admin, err := api.groupAdmin(r, r.PathValue("id"), input.ActorEmail)
	if err != nil || !admin {
		writeError(w, http.StatusForbidden, "only administrators can approve requests")
		return
	}
	tx, err := api.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())
	var userID string
	if err := tx.QueryRow(r.Context(), `
		SELECT user_id FROM group_join_requests
		WHERE id=$1 AND group_id=$2 AND status='pending' FOR UPDATE`, r.PathValue("requestID"), r.PathValue("id")).Scan(&userID); err != nil {
		writeError(w, http.StatusNotFound, "pending request not found")
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO group_members(group_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT DO NOTHING`, r.PathValue("id"), userID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not add member")
		return
	}
	if _, err := tx.Exec(r.Context(), `UPDATE group_join_requests SET status='accepted',reviewed_at=now(),reviewed_by=$1 WHERE id=$2`, adminID, r.PathValue("requestID")); err != nil {
		writeError(w, http.StatusInternalServerError, "could not approve request")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not approve request")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "accepted"})
}
