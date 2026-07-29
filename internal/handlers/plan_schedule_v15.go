package handlers

import (
    "encoding/json"
    "net/http"
    "strings"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"
)

type scheduleEntryResponse struct {
    ID         string          `json:"id"`
    PlanID     string          `json:"plan_id"`
    Title      string          `json:"title"`
    Ownership  string          `json:"ownership"`
    GroupID    *string         `json:"group_id,omitempty"`
    GroupName  *string         `json:"group_name,omitempty"`
    Location   *string         `json:"location_name,omitempty"`
    Mode       string          `json:"mode"`
    PlanStatus string          `json:"plan_status"`
    Kind       string          `json:"kind"`
    State      string          `json:"state"`
    StartTime  *time.Time      `json:"start_time,omitempty"`
    EndTime    *time.Time      `json:"end_time,omitempty"`
    Recurrence json.RawMessage `json:"recurrence,omitempty"`
    Timezone   string          `json:"timezone"`
}

func NewRouterV15(db *pgxpool.Pool, origins []string) http.Handler {
    api := &API{db: db}
    mux := http.NewServeMux()
    mux.HandleFunc("GET /api/v1/calendar/schedules", api.listPlanSchedules)
    mux.Handle("/", NewRouterV14(db, origins))
    return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) listPlanSchedules(w http.ResponseWriter, r *http.Request) {
    email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
    if email == "" {
        writeError(w, http.StatusBadRequest, "email is required")
        return
    }

    rows, err := api.db.Query(r.Context(), `
        SELECT s.id,s.plan_id,p.title,
               CASE WHEN owner.email=$1 THEN 'own' ELSE 'friend' END,
               p.group_id,g.name,p.location_name,
               p.schedule_mode,p.status,s.kind,s.state,s.start_time,s.end_time,
               COALESCE(s.recurrence,'null'::jsonb),s.timezone
        FROM plan_schedule_entries s
        JOIN plans p ON p.id=s.plan_id
        JOIN users owner ON owner.id=p.created_by
        LEFT JOIN groups g ON g.id=p.group_id
        WHERE owner.email=$1
           OR p.group_id IN (
                SELECT gm.group_id FROM group_members gm
                JOIN users viewer ON viewer.id=gm.user_id
                WHERE viewer.email=$1
           )
        ORDER BY p.id,s.start_time NULLS LAST,s.created_at`, email)
    if err != nil {
        writeError(w, http.StatusInternalServerError, "could not load schedules")
        return
    }
    defer rows.Close()

    entries := make([]scheduleEntryResponse, 0)
    for rows.Next() {
        var item scheduleEntryResponse
        if err := rows.Scan(&item.ID,&item.PlanID,&item.Title,&item.Ownership,&item.GroupID,&item.GroupName,&item.Location,&item.Mode,&item.PlanStatus,&item.Kind,&item.State,&item.StartTime,&item.EndTime,&item.Recurrence,&item.Timezone); err != nil {
            writeError(w, http.StatusInternalServerError, "could not read schedules")
            return
        }
        entries = append(entries, item)
    }
    if err := rows.Err(); err != nil {
        writeError(w, http.StatusInternalServerError, "could not load schedules")
        return
    }
    writeJSON(w, http.StatusOK, map[string]any{"schedules": entries})
}
