package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type taskSubtask struct {
	ID        string `json:"id"`
	TaskID    string `json:"task_id"`
	Title     string `json:"title"`
	Completed bool   `json:"completed"`
	Position  int    `json:"position"`
}

type subtaskWriteRequest struct {
	ActorEmail string `json:"actor_email"`
	Title      string `json:"title"`
	Completed  *bool  `json:"completed"`
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

func (api *API) listPlanSubtasks(w http.ResponseWriter, r *http.Request) {
	planID := r.PathValue("id")
	if !api.canAccessPlan(r, planID, r.URL.Query().Get("email")) {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	rows, err := api.db.Query(r.Context(), `SELECT s.id,s.task_id,s.title,s.completed,s.position
		FROM task_subtasks s JOIN tasks t ON t.id=s.task_id
		WHERE t.plan_id=$1 ORDER BY s.task_id,s.position,s.created_at`, planID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load subtasks")
		return
	}
	defer rows.Close()
	items := make([]taskSubtask, 0)
	for rows.Next() {
		var item taskSubtask
		if err := rows.Scan(&item.ID, &item.TaskID, &item.Title, &item.Completed, &item.Position); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load subtasks")
			return
		}
		items = append(items, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"subtasks": items})
}

func (api *API) createSubtask(w http.ResponseWriter, r *http.Request) {
	planID, taskID := r.PathValue("id"), r.PathValue("taskID")
	var input subtaskWriteRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" || !api.canAccessPlan(r, planID, input.ActorEmail) {
		writeError(w, http.StatusBadRequest, "title and valid actor_email are required")
		return
	}
	var item taskSubtask
	err := api.db.QueryRow(r.Context(), `INSERT INTO task_subtasks(task_id,title,position)
		SELECT t.id,$3,COALESCE((SELECT MAX(position)+1 FROM task_subtasks WHERE task_id=t.id),0)
		FROM tasks t WHERE t.id=$2 AND t.plan_id=$1
		RETURNING id,task_id,title,completed,position`, planID, taskID, input.Title).
		Scan(&item.ID, &item.TaskID, &item.Title, &item.Completed, &item.Position)
	if err != nil {
		writeError(w, http.StatusNotFound, "task not found")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (api *API) updateSubtask(w http.ResponseWriter, r *http.Request) {
	planID, taskID, subtaskID := r.PathValue("id"), r.PathValue("taskID"), r.PathValue("subtaskID")
	var input subtaskWriteRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if input.Completed == nil || !api.canAccessPlan(r, planID, input.ActorEmail) {
		writeError(w, http.StatusBadRequest, "completed and valid actor_email are required")
		return
	}
	result, err := api.db.Exec(r.Context(), `UPDATE task_subtasks s SET completed=$4,updated_at=NOW()
		FROM tasks t WHERE s.id=$3 AND s.task_id=$2 AND t.id=s.task_id AND t.plan_id=$1`,
		planID, taskID, subtaskID, *input.Completed)
	if err != nil || result.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "subtask not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"completed": *input.Completed})
}

func (api *API) deleteSubtask(w http.ResponseWriter, r *http.Request) {
	planID, taskID, subtaskID := r.PathValue("id"), r.PathValue("taskID"), r.PathValue("subtaskID")
	if !api.canAccessPlan(r, planID, r.URL.Query().Get("email")) {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	result, err := api.db.Exec(r.Context(), `DELETE FROM task_subtasks s USING tasks t
		WHERE s.id=$3 AND s.task_id=$2 AND t.id=s.task_id AND t.plan_id=$1`, planID, taskID, subtaskID)
	if err != nil || result.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "subtask not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
