package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type tripCalendarInterval struct {
	ID        string    `json:"id"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	Yes       int       `json:"yes"`
	Maybe     int       `json:"maybe"`
	No        int       `json:"no"`
	Confirmed bool      `json:"confirmed"`
}

type tripCalendarPlan struct {
	PlanID    string                 `json:"plan_id"`
	Status    string                 `json:"status"`
	Intervals []tripCalendarInterval `json:"intervals"`
}

// NewRouterV14 makes trip intervals a first-class calendar data source.
func NewRouterV14(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/trips", api.createTaggedTrip)
	mux.HandleFunc("GET /api/v1/calendar/trip-intervals", api.listTripCalendarIntervals)
	mux.Handle("/", NewRouterV13(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) createTaggedTrip(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	recorder := httptest.NewRecorder()
	api.createTrip(recorder, r)

	responseBody := recorder.Body.Bytes()
	if recorder.Code == http.StatusCreated {
		var result struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(responseBody, &result) == nil && result.ID != "" {
			if _, err := api.db.Exec(r.Context(), `UPDATE plans SET schedule_mode='trip' WHERE id=$1`, result.ID); err != nil {
				writeError(w, http.StatusInternalServerError, "could not classify trip")
				return
			}
		}
	}
	for key, values := range recorder.Header() {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	w.WriteHeader(recorder.Code)
	_, _ = w.Write(responseBody)
}

func (api *API) listTripCalendarIntervals(w http.ResponseWriter, r *http.Request) {
	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	if email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}

	rows, err := api.db.Query(r.Context(), `
		SELECT p.id,p.status,o.id,o.start_time,o.end_time,
		       COUNT(*) FILTER (WHERE v.vote='yes')::int,
		       COUNT(*) FILTER (WHERE v.vote='maybe')::int,
		       COUNT(*) FILTER (WHERE v.vote='no')::int,
		       (p.confirmed_option_id=o.id)
		FROM users u
		JOIN plans p ON p.created_by=u.id
		  OR p.group_id IN (SELECT gm.group_id FROM group_members gm WHERE gm.user_id=u.id)
		JOIN plan_date_options o ON o.plan_id=p.id
		LEFT JOIN plan_date_votes v ON v.option_id=o.id
		WHERE u.email=$1 AND p.schedule_mode='trip'
		GROUP BY p.id,p.status,p.confirmed_option_id,o.id,o.start_time,o.end_time
		ORDER BY p.id,o.start_time`, email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load trip intervals")
		return
	}
	defer rows.Close()

	plans := make(map[string]*tripCalendarPlan)
	order := make([]string, 0)
	for rows.Next() {
		var planID, status string
		var interval tripCalendarInterval
		if err := rows.Scan(&planID, &status, &interval.ID, &interval.StartTime, &interval.EndTime, &interval.Yes, &interval.Maybe, &interval.No, &interval.Confirmed); err != nil {
			writeError(w, http.StatusInternalServerError, "could not read trip intervals")
			return
		}
		plan := plans[planID]
		if plan == nil {
			plan = &tripCalendarPlan{PlanID: planID, Status: status, Intervals: make([]tripCalendarInterval, 0)}
			plans[planID] = plan
			order = append(order, planID)
		}
		plan.Intervals = append(plan.Intervals, interval)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load trip intervals")
		return
	}

	result := make([]tripCalendarPlan, 0, len(order))
	for _, id := range order {
		result = append(result, *plans[id])
	}
	writeJSON(w, http.StatusOK, map[string]any{"plans": result})
}
