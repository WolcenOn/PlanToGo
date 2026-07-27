package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type updatePlanRequest struct {
	CreatorEmail  string `json:"creator_email"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	LocationName  string `json:"location_name"`
	Address       string `json:"address"`
	ConfirmedDate string `json:"confirmed_date"`
}

type registeredVoteRequest struct {
	Name  string            `json:"name"`
	Email string            `json:"email"`
	Votes map[string]string `json:"votes"`
}

type taskRequest struct {
	ActorName  string `json:"actor_name"`
	ActorEmail string `json:"actor_email"`
	Title      string `json:"title"`
	Action     string `json:"action"`
}

type planTask struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Status       string  `json:"status"`
	AssignedName *string `json:"assigned_name"`
	IsMine       bool    `json:"is_mine"`
}

func NewRouterV2(db DBPool, origins []string) http.Handler {
	api := &API{db: db.Pool()}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", api.health)
	mux.HandleFunc("GET /api/health", api.health)
	mux.HandleFunc("GET /api/v1/dashboard", api.dashboard)
	mux.HandleFunc("POST /api/v1/plans", api.createPlan)
	mux.HandleFunc("GET /api/v1/plans/{id}", api.getPlanDetail)
	mux.HandleFunc("PATCH /api/v1/plans/{id}", api.updatePlan)
	mux.HandleFunc("DELETE /api/v1/plans/{id}", api.deletePlan)
	mux.HandleFunc("POST /api/v1/plans/{id}/confirm", api.confirmPlanDate)
	mux.HandleFunc("POST /api/v1/plans/{id}/votes", api.voteRegisteredPlan)
	mux.HandleFunc("POST /api/v1/plans/{id}/tasks", api.createTask)
	mux.HandleFunc("PATCH /api/v1/plans/{id}/tasks/{taskID}", api.updateTask)
	mux.HandleFunc("GET /api/v1/public/plans/{token}", api.getPublicPlan)
	mux.HandleFunc("POST /api/v1/public/plans/{token}/votes", api.votePublicPlan)
	return cors(origins, securityHeaders(mux))
}

// DBPool keeps the router constructor testable without changing the existing API type.
type DBPool interface {
	Pool() interfacePool
}

type interfacePool = *pgxpool.Pool

func (api *API) userAccess(r *http.Request, planID, email string) (string, bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var userID string
	var owner bool
	err := api.db.QueryRow(r.Context(), `
		SELECT u.id, p.created_by=u.id
		FROM users u JOIN plans p ON p.id=$1
		WHERE u.email=$2 AND (p.created_by=u.id OR p.group_id IN (SELECT group_id FROM group_members WHERE user_id=u.id))`,
		planID, email).Scan(&userID, &owner)
	return userID, owner, err
}

func (api *API) getPlanDetail(w http.ResponseWriter, r *http.Request) {
	planID := r.PathValue("id")
	email := r.URL.Query().Get("email")
	userID, owner, err := api.userAccess(r, planID, email)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load plan")
		return
	}

	var plan struct {
		ID, Title, Description, Type, Status string
		ConfirmedDate                        *time.Time
		LocationName, Address                *string
	}
	if err := api.db.QueryRow(r.Context(), `SELECT id,title,description,type,status,confirmed_date,location_name,address FROM plans WHERE id=$1`, planID).Scan(
		&plan.ID, &plan.Title, &plan.Description, &plan.Type, &plan.Status, &plan.ConfirmedDate, &plan.LocationName, &plan.Address,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load plan")
		return
	}

	options := make([]map[string]any, 0)
	rows, err := api.db.Query(r.Context(), `
		SELECT o.id,o.start_time,o.end_time,
		COUNT(*) FILTER(WHERE v.vote='yes')::int,COUNT(*) FILTER(WHERE v.vote='maybe')::int,COUNT(*) FILTER(WHERE v.vote='no')::int,
		COALESCE((SELECT vote::text FROM plan_date_votes mine WHERE mine.option_id=o.id AND mine.user_id=$2),'')
		FROM plan_date_options o LEFT JOIN plan_date_votes v ON v.option_id=o.id
		WHERE o.plan_id=$1 GROUP BY o.id,o.start_time,o.end_time ORDER BY o.start_time`, planID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load dates")
		return
	}
	for rows.Next() {
		var id, myVote string
		var start, end time.Time
		var yes, maybe, no int
		if err := rows.Scan(&id, &start, &end, &yes, &maybe, &no, &myVote); err != nil {
			rows.Close()
			writeError(w, http.StatusInternalServerError, "could not load dates")
			return
		}
		options = append(options, map[string]any{"id": id, "start_time": start, "end_time": end, "yes": yes, "maybe": maybe, "no": no, "my_vote": myVote})
	}
	rows.Close()

	tasks, err := api.loadTasks(r, planID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load tasks")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": plan.ID, "title": plan.Title, "description": plan.Description, "type": plan.Type, "status": plan.Status,
		"confirmed_date": plan.ConfirmedDate, "location_name": plan.LocationName, "address": plan.Address,
		"is_owner": owner, "date_options": options, "tasks": tasks,
	})
}

func (api *API) updatePlan(w http.ResponseWriter, r *http.Request) {
	var input updatePlanRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	_, owner, err := api.userAccess(r, r.PathValue("id"), input.CreatorEmail)
	if err != nil || !owner {
		writeError(w, http.StatusForbidden, "only the creator can edit this plan")
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" {
		writeError(w, http.StatusBadRequest, "title is required")
		return
	}
	var confirmed *time.Time
	if strings.TrimSpace(input.ConfirmedDate) != "" {
		date, err := time.Parse(time.RFC3339, input.ConfirmedDate)
		if err != nil {
			writeError(w, http.StatusBadRequest, "confirmed_date must be RFC3339")
			return
		}
		confirmed = &date
	}
	_, err = api.db.Exec(r.Context(), `UPDATE plans SET title=$1,description=$2,location_name=NULLIF($3,''),address=NULLIF($4,''),confirmed_date=COALESCE($5,confirmed_date) WHERE id=$6`,
		input.Title, strings.TrimSpace(input.Description), strings.TrimSpace(input.LocationName), strings.TrimSpace(input.Address), confirmed, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not update plan")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (api *API) deletePlan(w http.ResponseWriter, r *http.Request) {
	email := r.URL.Query().Get("email")
	_, owner, err := api.userAccess(r, r.PathValue("id"), email)
	if err != nil || !owner {
		writeError(w, http.StatusForbidden, "only the creator can delete this plan")
		return
	}
	if _, err := api.db.Exec(r.Context(), `DELETE FROM plans WHERE id=$1`, r.PathValue("id")); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete plan")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *API) voteRegisteredPlan(w http.ResponseWriter, r *http.Request) {
	var input registeredVoteRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	userID, _, err := api.userAccess(r, r.PathValue("id"), input.Email)
	if err != nil {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	tx, err := api.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())
	for optionID, vote := range input.Votes {
		if vote != "yes" && vote != "maybe" && vote != "no" {
			writeError(w, http.StatusBadRequest, "vote must be yes, maybe or no")
			return
		}
		result, err := tx.Exec(r.Context(), `
			INSERT INTO plan_date_votes(option_id,user_id,vote) SELECT o.id,$1,$2 FROM plan_date_options o WHERE o.id=$3 AND o.plan_id=$4
			ON CONFLICT(option_id,user_id) WHERE user_id IS NOT NULL DO UPDATE SET vote=EXCLUDED.vote,updated_at=now()`, userID, vote, optionID, r.PathValue("id"))
		if err != nil || result.RowsAffected() == 0 {
			writeError(w, http.StatusBadRequest, "invalid date option")
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save availability")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

func (api *API) loadTasks(r *http.Request, planID, userID string) ([]planTask, error) {
	rows, err := api.db.Query(r.Context(), `
		SELECT t.id,t.title,t.status,COALESCE(u.name,t.assigned_to_guest_name),t.assigned_to_user_id=$2
		FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to_user_id WHERE t.plan_id=$1
		ORDER BY t.status='completed',t.created_at`, planID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tasks := make([]planTask, 0)
	for rows.Next() {
		var task planTask
		if err := rows.Scan(&task.ID, &task.Title, &task.Status, &task.AssignedName, &task.IsMine); err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (api *API) createTask(w http.ResponseWriter, r *http.Request) {
	var input taskRequest
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
	var taskID string
	err = api.db.QueryRow(r.Context(), `INSERT INTO tasks(plan_id,title,assigned_to_user_id) VALUES($1,$2,$3) RETURNING id`, r.PathValue("id"), input.Title, userID).Scan(&taskID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create task")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": taskID})
}

func (api *API) updateTask(w http.ResponseWriter, r *http.Request) {
	var input taskRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	userID, owner, err := api.userAccess(r, r.PathValue("id"), input.ActorEmail)
	if err != nil {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	var query string
	var args []any
	switch input.Action {
	case "claim":
		query = `UPDATE tasks SET assigned_to_user_id=$1,assigned_to_guest_name=NULL,assigned_to_guest_session_id=NULL,updated_at=now() WHERE id=$2 AND plan_id=$3 AND assigned_to_user_id IS NULL`
		args = []any{userID, r.PathValue("taskID"), r.PathValue("id")}
	case "release":
		query = `UPDATE tasks SET assigned_to_user_id=NULL,updated_at=now() WHERE id=$1 AND plan_id=$2 AND (assigned_to_user_id=$3 OR $4)`
		args = []any{r.PathValue("taskID"), r.PathValue("id"), userID, owner}
	case "complete":
		query = `UPDATE tasks SET status='completed',updated_at=now() WHERE id=$1 AND plan_id=$2 AND (assigned_to_user_id=$3 OR $4)`
		args = []any{r.PathValue("taskID"), r.PathValue("id"), userID, owner}
	case "reopen":
		query = `UPDATE tasks SET status='pending',updated_at=now() WHERE id=$1 AND plan_id=$2 AND $3`
		args = []any{r.PathValue("taskID"), r.PathValue("id"), owner}
	default:
		writeError(w, http.StatusBadRequest, "invalid task action")
		return
	}
	result, err := api.db.Exec(r.Context(), query, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not update task")
		return
	}
	if result.RowsAffected() == 0 {
		writeError(w, http.StatusConflict, "task cannot be changed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}
