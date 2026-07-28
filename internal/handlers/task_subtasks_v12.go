package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type taskSubtask struct {
	ID string `json:"id"`
	TaskID string `json:"task_id"`
	Title string `json:"title"`
	Completed bool `json:"completed"`
	Position int `json:"position"`
}

type subtaskWriteRequest struct {
	ActorEmail string `json:"actor_email"`
	Title string `json:"title"`
	Completed *bool `json:"completed"`
}

func NewRouterV12(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/plans/{id}/subtasks", api.listPlanSubtasks)
	mux.HandleFunc("POST /api/v1/plans/{id}/tasks/{taskID}/subtasks", api.createSubtask)
	mux.HandleFunc("PATCH /api/v1/plans/{id}/tasks/{taskID}/subtasks/{subtaskID}", api.updateSubtask)
	mux.HandleFunc("DELETE /api/v1/plans/{id}/tasks/{taskID}/subtasks/{subtaskID}", api.deleteSubtask)
	mux.Handle("/", NewRouterV11(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) canAccessPlan(r *http.Request, planID, email string) bool {
	var allowed bool
	err := api.db.QueryRow(r.Context(), `SELECT EXISTS (
		SELECT 1 FROM users u JOIN plans p ON p.id=$1
		WHERE u.email=$2 AND (p.created_by=u.id OR p.group_id IN
		(SELECT group_id FROM group_members WHERE user_id=u.id)))`,
		planID, strings.ToLower(strings.TrimSpace(email))).Scan(&allowed)
	return err == nil && allowed
}
