package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type recurrenceRuleInput struct {
	Weekday  int    `json:"weekday"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

type recurrenceRequest struct {
	ActorEmail string                `json:"actor_email"`
	StartsOn   string                `json:"starts_on"`
	EndsOn     string                `json:"ends_on"`
	Timezone   string                `json:"timezone"`
	Rules      []recurrenceRuleInput `json:"rules"`
}

type occurrenceUpdateRequest struct {
	ActorEmail string `json:"actor_email"`
	StartsAt   string `json:"starts_at"`
	EndsAt     string `json:"ends_at"`
}

func NewRouterV7(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/plans/{id}/recurrence", api.createRecurrence)
	mux.HandleFunc("GET /api/v1/plans/{id}/recurrence", api.getRecurrence)
	mux.HandleFunc("PATCH /api/v1/plans/{id}/occurrences/{occurrenceID}", api.updateOccurrence)
	mux.HandleFunc("DELETE /api/v1/plans/{id}/occurrences/{occurrenceID}", api.deleteOccurrence)
	mux.HandleFunc("GET /api/v1/dashboard/occurrences", api.dashboardOccurrences)
	mux.Handle("/", NewRouterV6(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) createRecurrence(w http.ResponseWriter, r *http.Request) {
	var input recurrenceRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	_, owner, err := api.multiAccess(r, r.PathValue("id"), input.ActorEmail)
	if err != nil || !owner {
		writeError(w, http.StatusForbidden, "only the creator can configure recurrence")
		return
	}
	startDate, err := time.Parse("2006-01-02", input.StartsOn)
	if err != nil {
		writeError(w, http.StatusBadRequest, "starts_on must be YYYY-MM-DD")
		return
	}
	endDate, err := time.Parse("2006-01-02", input.EndsOn)
	if err != nil || endDate.Before(startDate) {
		writeError(w, http.StatusBadRequest, "invalid recurrence range")
		return
	}
	if len(input.Rules) == 0 {
		writeError(w, http.StatusBadRequest, "at least one recurrence rule is required")
		return
	}
	zone := strings.TrimSpace(input.Timezone)
	if zone == "" {
		zone = "Europe/Madrid"
	}
	location, err := time.LoadLocation(zone)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid timezone")
		return
	}
	tx, err := api.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())
	var seriesID string
	if err := tx.QueryRow(r.Context(), `
		INSERT INTO recurring_series(plan_id,timezone,starts_on,ends_on)
		VALUES($1,$2,$3,$4)
		ON CONFLICT(plan_id) DO UPDATE SET timezone=EXCLUDED.timezone,starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on
		RETURNING id`, r.PathValue("id"), zone, startDate, endDate).Scan(&seriesID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save recurrence")
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM recurring_rules WHERE series_id=$1`, seriesID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not replace recurrence rules")
		return
	}
	if _, err := tx.Exec(r.Context(), `DELETE FROM recurring_occurrences WHERE series_id=$1`, seriesID); err != nil {
		writeError(w, http.StatusInternalServerError, "could not replace occurrences")
		return
	}
	occurrenceCount := 0
	for _, rule := range input.Rules {
		if rule.Weekday < 1 || rule.Weekday > 7 {
			writeError(w, http.StatusBadRequest, "weekday must be between 1 and 7")
			return
		}
		startClock, startErr := time.Parse("15:04", rule.StartTime)
		endClock, endErr := time.Parse("15:04", rule.EndTime)
		if startErr != nil || endErr != nil || !endClock.After(startClock) {
			writeError(w, http.StatusBadRequest, "each rule needs a valid start and end time")
			return
		}
		if _, err := tx.Exec(r.Context(), `INSERT INTO recurring_rules(series_id,weekday,start_time,end_time) VALUES($1,$2,$3,$4)`, seriesID, rule.Weekday, rule.StartTime, rule.EndTime); err != nil {
			writeError(w, http.StatusInternalServerError, "could not save recurrence rule")
			return
		}
		for day := startDate; !day.After(endDate); day = day.AddDate(0, 0, 1) {
			weekday := int(day.Weekday())
			if weekday == 0 {
				weekday = 7
			}
			if weekday != rule.Weekday {
				continue
			}
			startsAt := time.Date(day.Year(), day.Month(), day.Day(), startClock.Hour(), startClock.Minute(), 0, 0, location)
			endsAt := time.Date(day.Year(), day.Month(), day.Day(), endClock.Hour(), endClock.Minute(), 0, 0, location)
			if _, err := tx.Exec(r.Context(), `INSERT INTO recurring_occurrences(series_id,starts_at,ends_at) VALUES($1,$2,$3)`, seriesID, startsAt, endsAt); err != nil {
				writeError(w, http.StatusInternalServerError, "could not generate occurrences")
				return
			}
			occurrenceCount++
		}
	}
	if occurrenceCount == 0 {
		writeError(w, http.StatusBadRequest, "the selected pattern does not generate occurrences")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save recurrence")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"series_id": seriesID, "occurrence_count": occurrenceCount})
}

func (api *API) getRecurrence(w http.ResponseWriter, r *http.Request) {
	_, _, err := api.multiAccess(r, r.PathValue("id"), r.URL.Query().Get("email"))
	if err != nil {
		writeError(w, http.StatusForbidden, "plan access denied")
		return
	}
	rows, err := api.db.Query(r.Context(), `
		SELECT o.id,o.starts_at,o.ends_at,o.cancelled
		FROM recurring_occurrences o JOIN recurring_series s ON s.id=o.series_id
		WHERE s.plan_id=$1 ORDER BY o.starts_at`, r.PathValue("id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load recurrence")
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var id string
		var startsAt, endsAt time.Time
		var cancelled bool
		if err := rows.Scan(&id, &startsAt, &endsAt, &cancelled); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load recurrence")
			return
		}
		items = append(items, map[string]any{"id": id, "starts_at": startsAt, "ends_at": endsAt, "cancelled": cancelled})
	}
	writeJSON(w, http.StatusOK, map[string]any{"occurrences": items})
}

func (api *API) updateOccurrence(w http.ResponseWriter, r *http.Request) {
	var input occurrenceUpdateRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	_, owner, err := api.multiAccess(r, r.PathValue("id"), input.ActorEmail)
	if err != nil || !owner {
		writeError(w, http.StatusForbidden, "only the creator can edit occurrences")
		return
	}
	startsAt, startErr := time.Parse(time.RFC3339, input.StartsAt)
	endsAt, endErr := time.Parse(time.RFC3339, input.EndsAt)
	if startErr != nil || endErr != nil || !endsAt.After(startsAt) {
		writeError(w, http.StatusBadRequest, "invalid occurrence times")
		return
	}
	result, err := api.db.Exec(r.Context(), `
		UPDATE recurring_occurrences o SET starts_at=$1,ends_at=$2,updated_at=now()
		FROM recurring_series s WHERE o.series_id=s.id AND s.plan_id=$3 AND o.id=$4`, startsAt, endsAt, r.PathValue("id"), r.PathValue("occurrenceID"))
	if err != nil || result.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "occurrence not found")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
}

func (api *API) deleteOccurrence(w http.ResponseWriter, r *http.Request) {
	_, owner, err := api.multiAccess(r, r.PathValue("id"), r.URL.Query().Get("email"))
	if err != nil || !owner {
		writeError(w, http.StatusForbidden, "only the creator can delete occurrences")
		return
	}
	if r.URL.Query().Get("scope") == "series" {
		if _, err := api.db.Exec(r.Context(), `DELETE FROM recurring_series WHERE plan_id=$1`, r.PathValue("id")); err != nil {
			writeError(w, http.StatusInternalServerError, "could not delete series")
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	result, err := api.db.Exec(r.Context(), `
		DELETE FROM recurring_occurrences o USING recurring_series s
		WHERE o.series_id=s.id AND s.plan_id=$1 AND o.id=$2`, r.PathValue("id"), r.PathValue("occurrenceID"))
	if err != nil || result.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "occurrence not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (api *API) dashboardOccurrences(w http.ResponseWriter, r *http.Request) {
	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	rows, err := api.db.Query(r.Context(), `
		SELECT p.id,p.title,o.id,o.starts_at,o.ends_at,
		CASE WHEN p.created_by=u.id THEN 'own' ELSE 'friend' END
		FROM users u JOIN plans p ON p.created_by=u.id
		 OR p.group_id IN (SELECT group_id FROM group_members WHERE user_id=u.id)
		 OR EXISTS (SELECT 1 FROM plan_groups pg JOIN group_members gm ON gm.group_id=pg.group_id WHERE pg.plan_id=p.id AND gm.user_id=u.id)
		JOIN recurring_series s ON s.plan_id=p.id
		JOIN recurring_occurrences o ON o.series_id=s.id AND o.cancelled=false
		WHERE u.email=$1 ORDER BY o.starts_at`, email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load occurrences")
		return
	}
	defer rows.Close()
	items := make([]map[string]any, 0)
	for rows.Next() {
		var planID, title, occurrenceID, ownership string
		var startsAt, endsAt time.Time
		if err := rows.Scan(&planID, &title, &occurrenceID, &startsAt, &endsAt, &ownership); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load occurrences")
			return
		}
		items = append(items, map[string]any{"plan_id": planID, "title": title, "occurrence_id": occurrenceID, "starts_at": startsAt, "ends_at": endsAt, "ownership": ownership})
	}
	writeJSON(w, http.StatusOK, map[string]any{"occurrences": items})
}
