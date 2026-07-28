package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type dashboardPlanV11 struct {
	ID                   string     `json:"id"`
	Title                string     `json:"title"`
	Description          string     `json:"description"`
	Type                 string     `json:"type"`
	Status               string     `json:"status"`
	ConfirmedDate        *time.Time `json:"confirmed_date"`
	LocationName         *string    `json:"location_name"`
	GroupID              *string    `json:"group_id"`
	GroupName            *string    `json:"group_name"`
	Ownership            string     `json:"ownership"`
	Participants         []string   `json:"participants"`
	DateOptionCount      int        `json:"date_option_count"`
	PendingTaskCount     int        `json:"pending_task_count"`
	MyPendingTaskCount   int        `json:"my_pending_task_count"`
	OpenPendingTaskCount int        `json:"open_pending_task_count"`
}

func NewRouterV11(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/dashboard", api.dashboardV11)
	mux.Handle("/", NewRouterV10(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) dashboardV11(w http.ResponseWriter, r *http.Request) {
	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	if email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}

	plans := make([]dashboardPlanV11, 0)
	rows, err := api.db.Query(r.Context(), `
		SELECT p.id,p.title,p.description,p.type,p.status,p.confirmed_date,p.location_name,p.group_id,g.name,
		CASE WHEN p.created_by=u.id THEN 'own' ELSE 'friend' END,
		COALESCE(people.names,ARRAY[]::text[]),
		(SELECT COUNT(*)::int FROM plan_date_options o WHERE o.plan_id=p.id),
		(SELECT COUNT(*)::int FROM tasks t WHERE t.plan_id=p.id AND t.status='pending'),
		(SELECT COUNT(*)::int FROM tasks t WHERE t.plan_id=p.id AND t.status='pending' AND t.assigned_to_user_id=u.id),
		(SELECT COUNT(*)::int FROM tasks t WHERE t.plan_id=p.id AND t.status='pending' AND t.assigned_to_user_id IS NULL AND t.assigned_to_guest_name IS NULL)
		FROM users u
		JOIN plans p ON p.created_by=u.id OR p.group_id IN (SELECT group_id FROM group_members WHERE user_id=u.id)
		LEFT JOIN groups g ON g.id=p.group_id
		LEFT JOIN LATERAL (
			SELECT array_agg(DISTINCT person_name ORDER BY person_name) names FROM (
				SELECT creator.name person_name FROM users creator WHERE creator.id=p.created_by
				UNION ALL
				SELECT COALESCE(voter.name,v.guest_name) FROM plan_date_options o
				JOIN plan_date_votes v ON v.option_id=o.id LEFT JOIN users voter ON voter.id=v.user_id
				WHERE o.plan_id=p.id AND v.vote IN ('yes','maybe')
			) participants
		) people ON true
		WHERE u.email=$1 ORDER BY p.confirmed_date NULLS LAST,p.created_at DESC`, email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load dashboard")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var p dashboardPlanV11
		if err := rows.Scan(&p.ID, &p.Title, &p.Description, &p.Type, &p.Status, &p.ConfirmedDate, &p.LocationName, &p.GroupID, &p.GroupName, &p.Ownership, &p.Participants, &p.DateOptionCount, &p.PendingTaskCount, &p.MyPendingTaskCount, &p.OpenPendingTaskCount); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load dashboard")
			return
		}
		plans = append(plans, p)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load dashboard")
		return
	}

	groups := make([]dashboardGroup, 0)
	groupRows, err := api.db.Query(r.Context(), `
		SELECT g.id,g.name,g.description,gm.role,COUNT(p.id)::int FROM users u
		JOIN group_members gm ON gm.user_id=u.id JOIN groups g ON g.id=gm.group_id
		LEFT JOIN plans p ON p.group_id=g.id WHERE u.email=$1
		GROUP BY g.id,g.name,g.description,gm.role ORDER BY g.name`, email)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load groups")
		return
	}
	defer groupRows.Close()
	for groupRows.Next() {
		var g dashboardGroup
		if err := groupRows.Scan(&g.ID, &g.Name, &g.Description, &g.Role, &g.PlanCount); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load groups")
			return
		}
		groups = append(groups, g)
	}
	writeJSON(w, http.StatusOK, map[string]any{"email": email, "plans": plans, "groups": groups})
}
