package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type createTripRequest struct {
	CreatorName  string            `json:"creator_name"`
	CreatorEmail string            `json:"creator_email"`
	Title        string            `json:"title"`
	Description  string            `json:"description"`
	Type         string            `json:"type"`
	DateOptions  []dateOptionInput `json:"date_options"`
	LocationName string            `json:"location_name"`
	Address      string            `json:"address"`
	GroupIDs     []string          `json:"group_ids"`
}

type parsedTripInterval struct {
	Start time.Time
	End   time.Time
}

// NewRouterV13 adds a single, explicit contract for trips: fixed trips persist
// exactly one complete interval and flexible trips persist at least two.
func NewRouterV13(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/trips", api.createTrip)
	mux.Handle("/", NewRouterV12(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) createTrip(w http.ResponseWriter, r *http.Request) {
	var input createTripRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	input.CreatorName = strings.TrimSpace(input.CreatorName)
	input.CreatorEmail = strings.ToLower(strings.TrimSpace(input.CreatorEmail))
	input.Title = strings.TrimSpace(input.Title)
	input.Type = strings.ToLower(strings.TrimSpace(input.Type))
	if input.CreatorName == "" || input.CreatorEmail == "" || input.Title == "" {
		writeError(w, http.StatusBadRequest, "creator_name, creator_email and title are required")
		return
	}
	if input.Type != "fixed" && input.Type != "flexible" {
		writeError(w, http.StatusBadRequest, "type must be fixed or flexible")
		return
	}

	required := 1
	if input.Type == "flexible" {
		required = 2
	}
	if len(input.DateOptions) < required || (input.Type == "fixed" && len(input.DateOptions) != 1) {
		if input.Type == "fixed" {
			writeError(w, http.StatusBadRequest, "fixed trips require exactly one interval")
		} else {
			writeError(w, http.StatusBadRequest, "flexible trips require at least two intervals")
		}
		return
	}

	intervals := make([]parsedTripInterval, 0, len(input.DateOptions))
	for _, option := range input.DateOptions {
		start, startErr := time.Parse(time.RFC3339, option.StartTime)
		end, endErr := time.Parse(time.RFC3339, option.EndTime)
		if startErr != nil || endErr != nil || !end.After(start) {
			writeError(w, http.StatusBadRequest, "each trip interval needs a valid start and end")
			return
		}
		intervals = append(intervals, parsedTripInterval{Start: start, End: end})
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

	var userID string
	if err := tx.QueryRow(r.Context(), `INSERT INTO users(name,email) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id`, input.CreatorName, input.CreatorEmail).Scan(&userID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save creator")
		return
	}

	var primaryGroupID *string
	for _, groupID := range input.GroupIDs {
		groupID = strings.TrimSpace(groupID)
		if groupID == "" {
			continue
		}
		var allowedID string
		if err := tx.QueryRow(r.Context(), `SELECT group_id FROM group_members WHERE user_id=$1 AND group_id=$2`, userID, groupID).Scan(&allowedID); err == nil {
			primaryGroupID = &allowedID
			break
		}
	}

	status := "confirmed"
	var confirmedDate *time.Time
	if input.Type == "fixed" {
		confirmedDate = &intervals[0].Start
	} else {
		status = "voting"
	}

	var planID string
	if err := tx.QueryRow(r.Context(), `
		INSERT INTO plans(title,description,type,status,confirmed_date,location_name,address,created_by,group_id)
		VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),$8,$9) RETURNING id`,
		input.Title, strings.TrimSpace(input.Description), input.Type, status, confirmedDate,
		strings.TrimSpace(input.LocationName), strings.TrimSpace(input.Address), userID, primaryGroupID,
	).Scan(&planID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create trip")
		return
	}

	for _, interval := range intervals {
		var optionID string
		if err := tx.QueryRow(r.Context(), `INSERT INTO plan_date_options(plan_id,start_time,end_time) VALUES($1,$2,$3) RETURNING id`, planID, interval.Start, interval.End).Scan(&optionID); err != nil {
			writeError(w, http.StatusInternalServerError, "could not save trip interval")
			return
		}
		if input.Type == "flexible" {
			if _, err := tx.Exec(r.Context(), `INSERT INTO plan_date_votes(option_id,user_id,vote) VALUES($1,$2,'yes')`, optionID, userID); err != nil {
				writeError(w, http.StatusInternalServerError, "could not initialise trip voting")
				return
			}
		}
	}

	// Publish to every selected group when the join table is available. The
	// primary group remains populated for backwards-compatible dashboard views.
	var planGroupsTable *string
	if err := tx.QueryRow(r.Context(), `SELECT to_regclass('public.plan_groups')::text`).Scan(&planGroupsTable); err == nil && planGroupsTable != nil {
		for _, groupID := range input.GroupIDs {
			groupID = strings.TrimSpace(groupID)
			if groupID == "" {
				continue
			}
			_, err := tx.Exec(r.Context(), `INSERT INTO plan_groups(plan_id,group_id)
				SELECT $1,gm.group_id FROM group_members gm WHERE gm.user_id=$2 AND gm.group_id=$3
				ON CONFLICT DO NOTHING`, planID, userID, groupID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, "could not publish trip to groups")
				return
			}
		}
	}

	if _, err := tx.Exec(r.Context(), `INSERT INTO access_tokens(purpose,token_hash,plan_id) VALUES('plan_access',$1,$2)`, hash[:], planID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create trip link")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create trip")
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"id":            planID,
		"public_token":  token,
		"type":          input.Type,
		"interval_count": len(intervals),
	})
}
