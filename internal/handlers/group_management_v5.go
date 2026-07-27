package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type createPlanMultiRequest struct {
	createPlanRequest
	GroupIDs []string `json:"group_ids"`
}

type updateGroupRequest struct {
	ActorEmail  string `json:"actor_email"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type groupDetail struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Role        string `json:"role"`
	MemberCount int    `json:"member_count"`
}

func NewRouterV5(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/dashboard", api.dashboardMulti)
	mux.HandleFunc("POST /api/v1/plans", api.createPlanMulti)
	mux.HandleFunc("GET /api/v1/plans/{id}", api.getPlanDetailMulti)
	mux.HandleFunc("PATCH /api/v1/plans/{id}", api.updatePlanMulti)
	mux.HandleFunc("DELETE /api/v1/plans/{id}", api.deletePlanMulti)
	mux.HandleFunc("POST /api/v1/plans/{id}/votes", api.voteRegisteredMulti)
	mux.HandleFunc("POST /api/v1/plans/{id}/tasks", api.createTaskMulti)
	mux.HandleFunc("PATCH /api/v1/plans/{id}/tasks/{taskID}", api.updateTaskMulti)
	mux.HandleFunc("DELETE /api/v1/plans/{id}/tasks/{taskID}", api.deleteTaskMulti)
	mux.HandleFunc("GET /api/v1/groups/{id}", api.getGroup)
	mux.HandleFunc("PATCH /api/v1/groups/{id}", api.updateGroup)
	mux.HandleFunc("DELETE /api/v1/groups/{id}", api.deleteGroup)
	mux.Handle("/", NewRouterV4(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) multiAccess(r *http.Request, planID, email string) (string, bool, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var userID string
	var owner bool
	err := api.db.QueryRow(r.Context(), `
		SELECT u.id, p.created_by = u.id
		FROM users u
		JOIN plans p ON p.id = $1
		WHERE u.email = $2 AND (
			p.created_by = u.id
			OR p.group_id IN (SELECT group_id FROM group_members WHERE user_id = u.id)
			OR EXISTS (
				SELECT 1
				FROM plan_groups pg
				JOIN group_members gm ON gm.group_id = pg.group_id
				WHERE pg.plan_id = p.id AND gm.user_id = u.id
			)
		)`, planID, email).Scan(&userID, &owner)
	return userID, owner, err
}

func (api *API) dashboardMulti(w http.ResponseWriter, r *http.Request) {
	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	if email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}

	plans := make([]dashboardPlan, 0)
	rows, err := api.db.Query(r.Context(), `
		SELECT p.id, p.title, p.description, p.type, p.status, p.confirmed_date,
		       p.location_name, p.group_id, NULLIF(group_names.names, ''),
		       CASE WHEN p.created_by = u.id THEN 'own' ELSE 'friend' END,
		       COALESCE(people.names, ARRAY[]::text[]),
		       (SELECT COUNT(*)::int FROM plan_date_options o WHERE o.plan_id = p.id)
		FROM users u
		JOIN plans p ON p.created_by = u.id
		 OR p.group_id IN (SELECT group_id FROM group_members WHERE user_id = u.id)
		 OR EXISTS (
			SELECT 1 FROM plan_groups pg
			JOIN group_members gm ON gm.group_id = pg.group_id
			WHERE pg.plan_id = p.id AND gm.user_id = u.id
		 )
		LEFT JOIN LATERAL (
			SELECT string_agg(DISTINCT g.name, ', ' ORDER BY g.name) AS names
			FROM plan_groups pg JOIN groups g ON g.id = pg.group_id
			WHERE pg.plan_id = p.id
		) group_names ON true
		LEFT JOIN LATERAL (
			SELECT array_agg(DISTINCT person_name ORDER BY person_name) AS names
			FROM (
				SELECT creator.name AS person_name FROM users creator WHERE creator.id = p.created_by
				UNION ALL
				SELECT COALESCE(voter.name, v.guest_name)
				FROM plan_date_options o
				JOIN plan_date_votes v ON v.option_id = o.id
				LEFT JOIN users voter ON voter.id = v.user_id
				WHERE o.plan_id = p.id AND v.vote IN ('yes', 'maybe')
			) participants
		) people ON true
		WHERE u.email = $1
		ORDER BY p.confirmed_date NULLS LAST, p.created_at DESC`, email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load dashboard")
		return
	}
	defer rows.Close()

	for rows.Next() {
		var plan dashboardPlan
		if err := rows.Scan(
			&plan.ID, &plan.Title, &plan.Description, &plan.Type, &plan.Status,
			&plan.ConfirmedDate, &plan.LocationName, &plan.GroupID, &plan.GroupName,
			&plan.Ownership, &plan.Participants, &plan.DateOptionCount,
		); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load dashboard")
			return
		}
		plans = append(plans, plan)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load dashboard")
		return
	}

	groups := make([]dashboardGroup, 0)
	groupRows, err := api.db.Query(r.Context(), `
		SELECT g.id, g.name, g.description, gm.role,
		       COUNT(DISTINCT COALESCE(pg.plan_id, p.id))::int
		FROM users u
		JOIN group_members gm ON gm.user_id = u.id
		JOIN groups g ON g.id = gm.group_id
		LEFT JOIN plan_groups pg ON pg.group_id = g.id
		LEFT JOIN plans p ON p.group_id = g.id
		WHERE u.email = $1
		GROUP BY g.id, g.name, g.description, gm.role
		ORDER BY g.name`, email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load groups")
		return
	}
	defer groupRows.Close()

	for groupRows.Next() {
		var group dashboardGroup
		if err := groupRows.Scan(&group.ID, &group.Name, &group.Description, &group.Role, &group.PlanCount); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load groups")
			return
		}
		groups = append(groups, group)
	}
	if err := groupRows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load groups")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"email": email, "plans": plans, "groups": groups})
}

func (api *API) createPlanMulti(w http.ResponseWriter, r *http.Request) {
	var input createPlanMultiRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	input.CreatorName = strings.TrimSpace(input.CreatorName)
	input.CreatorEmail = strings.ToLower(strings.TrimSpace(input.CreatorEmail))
	input.Title = strings.TrimSpace(input.Title)
	input.Type = strings.ToLower(strings.TrimSpace(input.Type))
	if input.Type == "" {
		input.Type = "fixed"
	}
	if input.CreatorName == "" || input.CreatorEmail == "" || input.Title == "" {
		writeError(w, http.StatusBadRequest, "creator_name, creator_email and title are required")
		return
	}
	if input.Type != "fixed" && input.Type != "flexible" {
		writeError(w, http.StatusBadRequest, "type must be fixed or flexible")
		return
	}

	var confirmed *time.Time
	options := make([][2]time.Time, 0, len(input.DateOptions))
	if input.Type == "fixed" {
		date, err := time.Parse(time.RFC3339, input.ConfirmedDate)
		if err != nil {
			writeError(w, http.StatusBadRequest, "confirmed_date must be RFC3339")
			return
		}
		confirmed = &date
	} else {
		if len(input.DateOptions) < 2 {
			writeError(w, http.StatusBadRequest, "flexible plans require at least two date options")
			return
		}
		for _, option := range input.DateOptions {
			start, startErr := time.Parse(time.RFC3339, option.StartTime)
			end, endErr := time.Parse(time.RFC3339, option.EndTime)
			if startErr != nil || endErr != nil || !end.After(start) {
				writeError(w, http.StatusBadRequest, "each date option needs valid start and end times")
				return
			}
			options = append(options, [2]time.Time{start, end})
		}
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
	err = tx.QueryRow(r.Context(), `
		INSERT INTO users(name, email) VALUES($1, $2)
		ON CONFLICT(email) DO UPDATE SET name = EXCLUDED.name
		RETURNING id`, input.CreatorName, input.CreatorEmail).Scan(&userID)
	if err == nil && len(input.GroupIDs) > 0 {
		var count int
		err = tx.QueryRow(r.Context(), `
			SELECT COUNT(*)::int FROM group_members
			WHERE user_id = $1 AND group_id = ANY($2::uuid[])`, userID, input.GroupIDs).Scan(&count)
		if err == nil && count != len(input.GroupIDs) {
			writeError(w, http.StatusForbidden, "you can only publish in groups where you are a member")
			return
		}
	}

	status := "confirmed"
	if input.Type == "flexible" {
		status = "voting"
	}
	var legacyGroup any
	if len(input.GroupIDs) > 0 {
		legacyGroup = input.GroupIDs[0]
	}
	if err == nil {
		err = tx.QueryRow(r.Context(), `
			INSERT INTO plans(group_id, title, description, type, status, confirmed_date, location_name, address, created_by)
			VALUES($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), $9)
			RETURNING id`, legacyGroup, input.Title, strings.TrimSpace(input.Description), input.Type,
			status, confirmed, strings.TrimSpace(input.LocationName), strings.TrimSpace(input.Address), userID,
		).Scan(&planID)
	}
	if err == nil {
		for _, groupID := range input.GroupIDs {
			if _, err = tx.Exec(r.Context(), `
				INSERT INTO plan_groups(plan_id, group_id) VALUES($1, $2)
				ON CONFLICT DO NOTHING`, planID, groupID); err != nil {
				break
			}
		}
	}
	if err == nil && input.Type == "flexible" {
		for _, option := range options {
			var optionID string
			err = tx.QueryRow(r.Context(), `
				INSERT INTO plan_date_options(plan_id, start_time, end_time)
				VALUES($1, $2, $3) RETURNING id`, planID, option[0], option[1]).Scan(&optionID)
			if err != nil {
				break
			}
			_, err = tx.Exec(r.Context(), `
				INSERT INTO plan_date_votes(option_id, user_id, vote)
				VALUES($1, $2, 'yes')`, optionID, userID)
			if err != nil {
				break
			}
		}
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `
			INSERT INTO access_tokens(purpose, token_hash, plan_id)
			VALUES('plan_access', $1, $2)`, hash[:], planID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create plan")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create plan")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": planID, "public_token": token, "type": input.Type})
}

func (api *API) getPlanDetailMulti(w http.ResponseWriter, r *http.Request) {
	planID := r.PathValue("id")
	userID, owner, err := api.multiAccess(r, planID, r.URL.Query().Get("email"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load plan")
		return
	}

	var title, description, planType, status string
	var confirmed *time.Time
	var location, address *string
	if err := api.db.QueryRow(r.Context(), `
		SELECT title, description, type, status, confirmed_date, location_name, address
		FROM plans WHERE id = $1`, planID).Scan(
		&title, &description, &planType, &status, &confirmed, &location, &address,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load plan")
		return
	}

	options := make([]map[string]any, 0)
	rows, err := api.db.Query(r.Context(), `
		SELECT o.id, o.start_time, o.end_time,
		       COUNT(*) FILTER(WHERE v.vote = 'yes')::int,
		       COUNT(*) FILTER(WHERE v.vote = 'maybe')::int,
		       COUNT(*) FILTER(WHERE v.vote = 'no')::int,
		       COALESCE((SELECT mine.vote::text FROM plan_date_votes mine WHERE mine.option_id = o.id AND mine.user_id = $2), '')
		FROM plan_date_options o
		LEFT JOIN plan_date_votes v ON v.option_id = o.id
		WHERE o.plan_id = $1
		GROUP BY o.id, o.start_time, o.end_time
		ORDER BY o.start_time`, planID, userID)
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
		options = append(options, map[string]any{
			"id": id, "start_time": start, "end_time": end,
			"yes": yes, "maybe": maybe, "no": no, "my_vote": myVote,
		})
	}
	rows.Close()

	tasks, err := api.loadTasks(r, planID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load tasks")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": planID, "title": title, "description": description, "type": planType,
		"status": status, "confirmed_date": confirmed, "location_name": location,
		"address": address, "is_owner": owner, "date_options": options, "tasks": tasks,
	})
}

func (api *API) updatePlanMulti(w http.ResponseWriter, r *http.Request) {
	var input updatePlanRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	_, owner, err := api.multiAccess(r, r.PathValue("id"), input.CreatorEmail)
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
	_, err = api.db.Exec(r.Context(), `
		UPDATE plans SET title = $1, description = $2, location_name = NULLIF($3, ''),
		address = NULLIF($4, ''), confirmed_date = COALESCE($5, confirmed_date)
		WHERE id = $6`, input.Title, strings.TrimSpace(input.Description), strings.TrimSpace(input.LocationName),
		strings.TrimSpace(input.Address), confirmed, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not update plan")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (api *API) deletePlanMulti(w http.ResponseWriter, r *http.Request) {
	_, owner, err := api.multiAccess(r, r.PathValue("id"), r.URL.Query().Get("email"))
	if err != nil || !owner {
		writeError(w, http.StatusForbidden, "only the creator can delete this plan")
		return
	}
	if _, err := api.db.Exec(r.Context(), `DELETE FROM plans WHERE id = $1`, r.PathValue("id")); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete plan")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *API) voteRegisteredMulti(w http.ResponseWriter, r *http.Request) {
	var input registeredVoteRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	userID, _, err := api.multiAccess(r, r.PathValue("id"), input.Email)
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
			INSERT INTO plan_date_votes(option_id, user_id, vote)
			SELECT id, $1, $2 FROM plan_date_options WHERE id = $3 AND plan_id = $4
			ON CONFLICT(option_id, user_id) WHERE user_id IS NOT NULL
			DO UPDATE SET vote = EXCLUDED.vote, updated_at = now()`, userID, vote, optionID, r.PathValue("id"))
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

func (api *API) createTaskMulti(w http.ResponseWriter, r *http.Request) {
	var input createTaskV3Request
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	userID, _, err := api.multiAccess(r, r.PathValue("id"), input.ActorEmail)
	if err != nil {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" {
		writeError(w, http.StatusBadRequest, "task title is required")
		return
	}
	var assigned any
	if input.AssignSelf {
		assigned = userID
	}
	var taskID string
	if err := api.db.QueryRow(r.Context(), `
		INSERT INTO tasks(plan_id, title, assigned_to_user_id)
		VALUES($1, $2, $3) RETURNING id`, r.PathValue("id"), input.Title, assigned).Scan(&taskID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create task")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"id": taskID})
}

func (api *API) updateTaskMulti(w http.ResponseWriter, r *http.Request) {
	var input taskRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	userID, owner, err := api.multiAccess(r, r.PathValue("id"), input.ActorEmail)
	if err != nil {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	var query string
	var args []any
	switch input.Action {
	case "claim":
		query = `UPDATE tasks SET assigned_to_user_id=$1, assigned_to_guest_name=NULL, assigned_to_guest_session_id=NULL, updated_at=now() WHERE id=$2 AND plan_id=$3 AND assigned_to_user_id IS NULL`
		args = []any{userID, r.PathValue("taskID"), r.PathValue("id")}
	case "release":
		query = `UPDATE tasks SET assigned_to_user_id=NULL, updated_at=now() WHERE id=$1 AND plan_id=$2 AND (assigned_to_user_id=$3 OR $4)`
		args = []any{r.PathValue("taskID"), r.PathValue("id"), userID, owner}
	case "complete":
		query = `UPDATE tasks SET status='completed', updated_at=now() WHERE id=$1 AND plan_id=$2 AND (assigned_to_user_id=$3 OR $4)`
		args = []any{r.PathValue("taskID"), r.PathValue("id"), userID, owner}
	case "reopen":
		query = `UPDATE tasks SET status='pending', updated_at=now() WHERE id=$1 AND plan_id=$2 AND $3`
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

func (api *API) deleteTaskMulti(w http.ResponseWriter, r *http.Request) {
	userID, owner, err := api.multiAccess(r, r.PathValue("id"), r.URL.Query().Get("email"))
	if err != nil {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	result, err := api.db.Exec(r.Context(), `
		DELETE FROM tasks WHERE id=$1 AND plan_id=$2 AND (assigned_to_user_id=$3 OR $4)`,
		r.PathValue("taskID"), r.PathValue("id"), userID, owner)
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

func (api *API) groupAdmin(r *http.Request, groupID, email string) (string, bool, error) {
	var userID, role string
	err := api.db.QueryRow(r.Context(), `
		SELECT u.id, gm.role::text
		FROM users u JOIN group_members gm ON gm.user_id = u.id
		WHERE u.email = $1 AND gm.group_id = $2`, strings.ToLower(strings.TrimSpace(email)), groupID).Scan(&userID, &role)
	return userID, role == "admin", err
}

func (api *API) getGroup(w http.ResponseWriter, r *http.Request) {
	_, admin, err := api.groupAdmin(r, r.PathValue("id"), r.URL.Query().Get("email"))
	if err != nil {
		writeError(w, http.StatusForbidden, "group access denied")
		return
	}
	var group groupDetail
	err = api.db.QueryRow(r.Context(), `
		SELECT g.id, g.name, g.description, gm.role::text,
		       (SELECT COUNT(*)::int FROM group_members x WHERE x.group_id = g.id)
		FROM groups g
		JOIN users u ON u.email = $2
		JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = u.id
		WHERE g.id = $1`, r.PathValue("id"), strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))).Scan(
		&group.ID, &group.Name, &group.Description, &group.Role, &group.MemberCount,
	)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load group")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"id": group.ID, "name": group.Name, "description": group.Description,
		"role": group.Role, "member_count": group.MemberCount, "is_admin": admin,
	})
}

func (api *API) updateGroup(w http.ResponseWriter, r *http.Request) {
	var input updateGroupRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	_, admin, err := api.groupAdmin(r, r.PathValue("id"), input.ActorEmail)
	if err != nil || !admin {
		writeError(w, http.StatusForbidden, "only administrators can edit this group")
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if _, err := api.db.Exec(r.Context(), `
		UPDATE groups SET name=$1, description=$2 WHERE id=$3`, input.Name,
		strings.TrimSpace(input.Description), r.PathValue("id")); err != nil {
		writeError(w, http.StatusInternalServerError, "could not update group")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (api *API) deleteGroup(w http.ResponseWriter, r *http.Request) {
	_, admin, err := api.groupAdmin(r, r.PathValue("id"), r.URL.Query().Get("email"))
	if err != nil || !admin {
		writeError(w, http.StatusForbidden, "only administrators can delete this group")
		return
	}
	if _, err := api.db.Exec(r.Context(), `DELETE FROM groups WHERE id=$1`, r.PathValue("id")); err != nil {
		writeError(w, http.StatusInternalServerError, "could not delete group")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
