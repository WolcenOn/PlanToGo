package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"

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
		seen := map[string]bool{}
		merged := make([]map[string]any, 0, len(legacyBody.Occurrences)+len(newBody.Occurrences))
		for _, item := range append(newBody.Occurrences, legacyBody.Occurrences...) {
			planID, _ := item["plan_id"].(string)
			start, _ := item["starts_at"].(string)
			key := planID + "|" + start
			if seen[key] {
				continue
			}
			seen[key] = true
			merged = append(merged, item)
		}
		writeJSON(w, http.StatusOK, map[string]any{"occurrences": merged})
	})
	mux.HandleFunc("PATCH /api/v1/plans/{id}/occurrences/{occurrenceID}", api.overrideOccurrenceV17)
	mux.HandleFunc("DELETE /api/v1/plans/{id}/occurrences/{occurrenceID}", api.deleteOccurrenceV17)
	mux.Handle("/", NewRouterV16(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}
