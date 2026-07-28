package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type addGroupMemberRequest struct {
	ActorEmail  string `json:"actor_email"`
	MemberName  string `json:"member_name"`
	MemberEmail string `json:"member_email"`
}

func NewRouterV8(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/groups/{id}/members", api.addGroupMember)
	mux.Handle("/", NewRouterV7(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) addGroupMember(w http.ResponseWriter, r *http.Request) {
	var input addGroupMemberRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	input.ActorEmail = strings.ToLower(strings.TrimSpace(input.ActorEmail))
	input.MemberEmail = strings.ToLower(strings.TrimSpace(input.MemberEmail))
	input.MemberName = strings.TrimSpace(input.MemberName)
	if input.ActorEmail == "" || input.MemberEmail == "" || input.MemberName == "" {
		writeError(w, http.StatusBadRequest, "actor_email, member_name and member_email are required")
		return
	}

	_, admin, err := api.groupAdmin(r, r.PathValue("id"), input.ActorEmail)
	if err != nil || !admin {
		writeError(w, http.StatusForbidden, "only administrators can add group members")
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
		INSERT INTO users(name, email) VALUES($1, $2)
		ON CONFLICT(email) DO UPDATE SET name = CASE
			WHEN users.name = '' THEN EXCLUDED.name ELSE users.name END
		RETURNING id`, input.MemberName, input.MemberEmail).Scan(&userID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create member")
		return
	}

	result, err := tx.Exec(r.Context(), `
		INSERT INTO group_members(group_id, user_id, role)
		VALUES($1, $2, 'member')
		ON CONFLICT(group_id, user_id) DO NOTHING`, r.PathValue("id"), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not add member")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not add member")
		return
	}

	status := http.StatusCreated
	if result.RowsAffected() == 0 {
		status = http.StatusOK
	}
	writeJSON(w, status, map[string]any{
		"status": "added",
		"member_email": input.MemberEmail,
		"already_member": result.RowsAffected() == 0,
	})
}
