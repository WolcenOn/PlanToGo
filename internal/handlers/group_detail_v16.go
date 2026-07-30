package handlers

import (
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

type groupDetailMember struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

type groupDetailResponse struct {
	ID          string              `json:"id"`
	Name        string              `json:"name"`
	Description string              `json:"description"`
	Role        string              `json:"role"`
	IsAdmin     bool                `json:"is_admin"`
	MemberCount int                 `json:"member_count"`
	Members     []groupDetailMember `json:"members"`
}

// NewRouterV16 keeps the group member count and member list on the same
// response contract so the group detail UI cannot display contradictory data.
func NewRouterV16(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/groups/{id}", api.getGroupDetailV16)
	mux.Handle("/", NewRouterV14(db, origins))
	return corsWithWrites(origins, securityHeaders(mux))
}

func (api *API) getGroupDetailV16(w http.ResponseWriter, r *http.Request) {
	groupID := strings.TrimSpace(r.PathValue("id"))
	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	if groupID == "" || email == "" {
		writeError(w, http.StatusBadRequest, "group id and email are required")
		return
	}

	var response groupDetailResponse
	if err := api.db.QueryRow(r.Context(), `
		SELECT g.id,g.name,g.description,gm.role::text,(gm.role='admin')
		FROM groups g
		JOIN users actor ON actor.email=$2
		JOIN group_members gm ON gm.group_id=g.id AND gm.user_id=actor.id
		WHERE g.id=$1`, groupID, email).
		Scan(&response.ID, &response.Name, &response.Description, &response.Role, &response.IsAdmin); err != nil {
		writeError(w, http.StatusNotFound, "group not found or access denied")
		return
	}

	rows, err := api.db.Query(r.Context(), `
		SELECT u.id,u.name,u.email,gm.role::text
		FROM group_members gm
		JOIN users u ON u.id=gm.user_id
		WHERE gm.group_id=$1
		ORDER BY CASE WHEN gm.role='admin' THEN 0 ELSE 1 END,u.name,u.email`, groupID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load group members")
		return
	}
	defer rows.Close()

	response.Members = make([]groupDetailMember, 0)
	for rows.Next() {
		var member groupDetailMember
		if err := rows.Scan(&member.ID, &member.Name, &member.Email, &member.Role); err != nil {
			writeError(w, http.StatusInternalServerError, "could not read group members")
			return
		}
		response.Members = append(response.Members, member)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, "could not load group members")
		return
	}
	response.MemberCount = len(response.Members)
	writeJSON(w, http.StatusOK, response)
}
