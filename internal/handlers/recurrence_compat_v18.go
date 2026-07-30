package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func NewRouterV18(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	legacy := NewRouterV16(db, origins)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/plans/{id}/recurrence", api.saveRecurrenceRulesV17)
	mux.HandleFunc("PUT /api/v1/plans/{id}/recurrence", api.saveRecurrenceRulesV17)
	mux.HandleFunc("GET /api/v1/plans/{id}/recurrence", func(w http.ResponseWriter, r *http.Request) {
		var exists bool
		_ = db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM plan_recurrence_series_v2 WHERE plan_id=$1)`, r.PathValue("id")).Scan(&exists)
		if exists {
			api.getRecurrenceRulesV17(w, r)
			return
		}
		legacy.ServeHTTP(w, r)
	})
	mux.HandleFunc("GET /api/v1/dashboard/occurrences", func(w http.ResponseWriter, r *http.Request) {
		legacyRecorder := httptest.NewRecorder()
		legacy.ServeHTTP(legacyRecorder, r.Clone(r.Context()))
		newRecorder := httptest.NewRecorder()
		api.dashboardOccurrencesV17(newRecorder, r.Clone(r.Context()))

		var legacyBody, newBody struct {
			Occurrences []map[string]any `json:"occurrences"`
		}
		_ = json.Unmarshal(legacyRecorder.Body.Bytes(), &legacyBody)
		_ = json.Unmarshal(newRecorder.Body.Bytes(), &newBody)

		// As soon as a plan has been edited with the v2 rule editor, its v2
		// schedule becomes the sole source of truth. Mixing legacy and v2
		// occurrences makes removed weekdays reappear and can hide newly added
		// weekdays behind stale sessions from the old recurrence model.
		v2PlanIDs := map[string]bool{}
		for _, item := range newBody.Occurrences {
			if planID, _ := item["plan_id"].(string); planID != "" {
				v2PlanIDs[planID] = true
			}
		}
		rows, err := db.Query(r.Context(), `SELECT plan_id::text FROM plan_recurrence_series_v2`)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var planID string
				if rows.Scan(&planID) == nil {
					v2PlanIDs[planID] = true
				}
			}
		}

		seen := map[string]bool{}
		merged := make([]map[string]any, 0, len(legacyBody.Occurrences)+len(newBody.Occurrences))
		appendUnique := func(item map[string]any) {
			planID, _ := item["plan_id"].(string)
			start, _ := item["starts_at"].(string)
			key := planID + "|" + start
			if planID == "" || start == "" || seen[key] {
				return
			}
			seen[key] = true
			merged = append(merged, item)
		}
		for _, item := range newBody.Occurrences {
			appendUnique(item)
		}
		for _, item := range legacyBody.Occurrences {
			planID, _ := item["plan_id"].(string)
			if v2PlanIDs[planID] {
				continue
			}
			appendUnique(item)
		}
		writeJSON(w, http.StatusOK, map[string]any{"occurrences": merged})
	})
	mux.HandleFunc("PATCH /api/v1/plans/{id}/occurrences/{occurrenceID}", func(w http.ResponseWriter, r *http.Request) {
		if _, err := time.Parse("2006-01-02", r.PathValue("occurrenceID")); err != nil {
			legacy.ServeHTTP(w, r)
			return
		}
		api.overrideOccurrenceV17(w, r)
	})
	mux.HandleFunc("DELETE /api/v1/plans/{id}/occurrences/{occurrenceID}", func(w http.ResponseWriter, r *http.Request) {
		if _, err := time.Parse("2006-01-02", r.PathValue("occurrenceID")); err != nil {
			legacy.ServeHTTP(w, r)
			return
		}
		api.deleteOccurrenceV17(w, r)
	})
	mux.Handle("/", NewRouterV16(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}
