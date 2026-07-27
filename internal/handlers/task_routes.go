package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type createTaskV3Request struct {
	ActorEmail string `json:"actor_email"`
	Title      string `json:"title"`
	AssignSelf bool   `json:"assign_self"`
}

// NewRouterV3 extends the existing API without changing the stable plan handlers.
func NewRouterV3(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/plans/{id}/tasks", api.createTaskV3)
	mux.HandleFunc("DELETE /api/v1/plans/{id}/tasks/{taskID}", api.deleteTask)
	mux.Handle("/", NewRouterV2(db, origins))
	return cors(origins, securityHeaders(mux))
}

func (api *API) createTaskV3(w http.ResponseWriter, r *http.Request) {
	var input createTaskV3Request
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	userID, _, err := api.userAccess(r, r.PathValue("id"), input.ActorEmail)
	if err != nil {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" {
		writeError(w, http.StatusBadRequest, "task title is required")
		return
	}

	var assignedUserID any
	if input.AssignSelf {
		assignedUserID = userID
	}
	var taskID string
	if err := api.db.QueryRow(r.Context(), `INSERT INTO tasks(plan_id,title,assigned_to_user_id) VALUES($1,$2,$3) RETURNING id`, r.PathValue("id"), input.Title, assignedUserID).Scan(&taskID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create task")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": taskID})
}

func (api *API) deleteTask(w http.ResponseWriter, r *http.Request) {
	userID, owner, err := api.userAccess(r, r.PathValue("id"), r.URL.Query().Get("email"))
	if err != nil {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	result, err := api.db.Exec(r.Context(), `DELETE FROM tasks WHERE id=$1 AND plan_id=$2 AND (assigned_to_user_id=$3 OR $4)`, r.PathValue("taskID"), r.PathValue("id"), userID, owner)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete task")
		return
	}
	if result.RowsAffected() == 0 {
		writeError(w, http.StatusForbidden, "only the responsible person or plan creator can delete this task")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
