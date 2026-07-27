package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type createPlanWizardRequest struct {
	createPlanRequest
	GroupIDs []string `json:"group_ids"`
	Tasks    []string `json:"tasks"`
}

// NewRouterV6 adds initial task creation while keeping the existing V5 routes.
func NewRouterV6(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/plans", api.createPlanWizard)
	mux.Handle("/", NewRouterV5(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) createPlanWizard(w http.ResponseWriter, r *http.Request) {
	var input createPlanWizardRequest
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

	cleanTasks := make([]string, 0, len(input.Tasks))
	seenTasks := make(map[string]struct{})
	for _, rawTask := range input.Tasks {
		task := strings.TrimSpace(rawTask)
		key := strings.ToLower(task)
		if task == "" {
			continue
		}
		if len(task) > 160 {
			writeError(w, http.StatusBadRequest, "task titles must be 160 characters or fewer")
			return
		}
		if _, exists := seenTasks[key]; exists {
			continue
		}
		seenTasks[key] = struct{}{}
		cleanTasks = append(cleanTasks, task)
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
		for _, task := range cleanTasks {
			if _, err = tx.Exec(r.Context(), `
				INSERT INTO tasks(plan_id, title) VALUES($1, $2)`, planID, task); err != nil {
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
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": planID, "public_token": token, "type": input.Type, "task_count": len(cleanTasks),
	})
}
