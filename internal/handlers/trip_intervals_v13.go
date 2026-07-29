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

type confirmedTripInterval struct {
	OptionID  string    `json:"option_id"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
}

// NewRouterV13 owns the complete trip contract: fixed trips persist exactly
// one interval, flexible trips persist at least two, and confirmation stores the
// selected option explicitly instead of trying to infer it from a timestamp.
func NewRouterV13(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/trips", api.createTrip)
	mux.HandleFunc("POST /api/v1/plans/{id}/confirm", api.confirmTripInterval)
	mux.HandleFunc("GET /api/v1/plans/{id}/confirmed-interval", api.getConfirmedTripInterval)
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

	var firstOptionID string
	for index, interval := range intervals {
		var optionID string
		if err := tx.QueryRow(r.Context(), `INSERT INTO plan_date_options(plan_id,start_time,end_time) VALUES($1,$2,$3) RETURNING id`, planID, interval.Start, interval.End).Scan(&optionID); err != nil {
			writeError(w, http.StatusInternalServerError, "could not save trip interval")
			return
		}
		if index == 0 {
			firstOptionID = optionID
		}
		if input.Type == "flexible" {
			if _, err := tx.Exec(r.Context(), `INSERT INTO plan_date_votes(option_id,user_id,vote) VALUES($1,$2,'yes')`, optionID, userID); err != nil {
				writeError(w, http.StatusInternalServerError, "could not initialise trip voting")
				return
			}
		}
	}
	if input.Type == "fixed" {
		if _, err := tx.Exec(r.Context(), `UPDATE plans SET confirmed_option_id=$2 WHERE id=$1`, planID, firstOptionID); err != nil {
			writeError(w, http.StatusInternalServerError, "could not confirm fixed trip interval")
			return
		}
	}

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
		"id":             planID,
		"public_token":   token,
		"type":           input.Type,
		"interval_count": len(intervals),
	})
}

func (api *API) confirmTripInterval(w http.ResponseWriter, r *http.Request) {
	var input confirmDateRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	input.CreatorEmail = strings.ToLower(strings.TrimSpace(input.CreatorEmail))
	input.OptionID = strings.TrimSpace(input.OptionID)
	if input.CreatorEmail == "" || input.OptionID == "" {
		writeError(w, http.StatusBadRequest, "creator_email and option_id are required")
		return
	}

	var interval confirmedTripInterval
	err := api.db.QueryRow(r.Context(), `
		UPDATE plans p
		SET confirmed_option_id=o.id, confirmed_date=o.start_time, status='confirmed'
		FROM plan_date_options o, users u
		WHERE p.id=$1 AND o.id=$2 AND o.plan_id=p.id
		  AND u.id=p.created_by AND u.email=$3 AND p.type='flexible'
		RETURNING o.id,o.start_time,o.end_time`,
		r.PathValue("id"), input.OptionID, input.CreatorEmail,
	).Scan(&interval.OptionID, &interval.StartTime, &interval.EndTime)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusForbidden, "trip interval could not be confirmed")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not confirm trip interval")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "confirmed", "confirmed_interval": interval})
}

func (api *API) getConfirmedTripInterval(w http.ResponseWriter, r *http.Request) {
	planID := r.PathValue("id")
	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	if email == "" || !api.canAccessPlan(r, planID, email) {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}

	var interval confirmedTripInterval
	err := api.db.QueryRow(r.Context(), `
		SELECT o.id,o.start_time,o.end_time
		FROM plans p
		JOIN LATERAL (
			SELECT candidate.id,candidate.start_time,candidate.end_time
			FROM plan_date_options candidate
			WHERE candidate.plan_id=p.id
			  AND (candidate.id=p.confirmed_option_id
			       OR (p.confirmed_option_id IS NULL AND p.confirmed_date IS NOT NULL
			           AND ABS(EXTRACT(EPOCH FROM (candidate.start_time-p.confirmed_date))) < 60))
			ORDER BY (candidate.id=p.confirmed_option_id) DESC
			LIMIT 1
		) o ON true
		WHERE p.id=$1 AND p.status='confirmed'`, planID,
	).Scan(&interval.OptionID, &interval.StartTime, &interval.EndTime)
	if errors.Is(err, pgx.ErrNoRows) {
		writeJSON(w, http.StatusOK, map[string]any{"confirmed_interval": nil})
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load confirmed trip interval")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"confirmed_interval": interval})
}
