package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type API struct{ db *pgxpool.Pool }

type dateOptionInput struct {
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

type createPlanRequest struct {
	CreatorName   string            `json:"creator_name"`
	CreatorEmail  string            `json:"creator_email"`
	Title         string            `json:"title"`
	Description   string            `json:"description"`
	Type          string            `json:"type"`
	ConfirmedDate string            `json:"confirmed_date"`
	DateOptions   []dateOptionInput `json:"date_options"`
	LocationName  string            `json:"location_name"`
	Address       string            `json:"address"`
}

type dashboardPlan struct {
	ID              string     `json:"id"`
	Title           string     `json:"title"`
	Description     string     `json:"description"`
	Type            string     `json:"type"`
	Status          string     `json:"status"`
	ConfirmedDate   *time.Time `json:"confirmed_date"`
	LocationName    *string    `json:"location_name"`
	GroupID         *string    `json:"group_id"`
	GroupName       *string    `json:"group_name"`
	Ownership       string     `json:"ownership"`
	Participants    []string   `json:"participants"`
	DateOptionCount int        `json:"date_option_count"`
}

type dashboardGroup struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Role        string `json:"role"`
	PlanCount   int    `json:"plan_count"`
}

type publicDateOption struct {
	ID        string    `json:"id"`
	StartTime time.Time `json:"start_time"`
	EndTime   time.Time `json:"end_time"`
	Yes       int       `json:"yes"`
	Maybe     int       `json:"maybe"`
	No        int       `json:"no"`
	Voters    []string  `json:"voters"`
}

type voteRequest struct {
	GuestName      string            `json:"guest_name"`
	GuestSessionID string            `json:"guest_session_id"`
	Votes          map[string]string `json:"votes"`
}

type confirmDateRequest struct {
	CreatorEmail string `json:"creator_email"`
	OptionID     string `json:"option_id"`
}

func NewRouter(db *pgxpool.Pool, origins []string) http.Handler {
	api := &API{db: db}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", api.health)
	mux.HandleFunc("GET /api/health", api.health)
	mux.HandleFunc("GET /api/v1/dashboard", api.dashboard)
	mux.HandleFunc("POST /api/v1/plans", api.createPlan)
	mux.HandleFunc("POST /api/v1/plans/{id}/confirm", api.confirmPlanDate)
	mux.HandleFunc("GET /api/v1/public/plans/{token}", api.getPublicPlan)
	mux.HandleFunc("POST /api/v1/public/plans/{token}/votes", api.votePublicPlan)
	return cors(origins, securityHeaders(mux))
}

func (api *API) health(w http.ResponseWriter, r *http.Request) {
	if err := api.db.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (api *API) dashboard(w http.ResponseWriter, r *http.Request) {
	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	if email == "" {
		writeError(w, http.StatusBadRequest, "email is required")
		return
	}
	plans := make([]dashboardPlan, 0)
	rows, err := api.db.Query(r.Context(), `
		SELECT p.id,p.title,p.description,p.type,p.status,p.confirmed_date,p.location_name,p.group_id,g.name,
		CASE WHEN p.created_by=u.id THEN 'own' ELSE 'friend' END,
		COALESCE(people.names,ARRAY[]::text[]),
		(SELECT COUNT(*)::int FROM plan_date_options o WHERE o.plan_id=p.id)
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
		var p dashboardPlan
		if err := rows.Scan(&p.ID, &p.Title, &p.Description, &p.Type, &p.Status, &p.ConfirmedDate, &p.LocationName, &p.GroupID, &p.GroupName, &p.Ownership, &p.Participants, &p.DateOptionCount); err != nil {
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

func (api *API) createPlan(w http.ResponseWriter, r *http.Request) {
	var input createPlanRequest
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

	var confirmedDate *time.Time
	options := make([][2]time.Time, 0, len(input.DateOptions))
	if input.Type == "fixed" {
		date, err := time.Parse(time.RFC3339, input.ConfirmedDate)
		if err != nil {
			writeError(w, http.StatusBadRequest, "confirmed_date must be RFC3339")
			return
		}
		confirmedDate = &date
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
	err = tx.QueryRow(r.Context(), `INSERT INTO users(name,email) VALUES($1,$2) ON CONFLICT(email) DO UPDATE SET name=EXCLUDED.name RETURNING id`, input.CreatorName, input.CreatorEmail).Scan(&userID)
	if err == nil {
		status := "confirmed"
		if input.Type == "flexible" {
			status = "voting"
		}
		err = tx.QueryRow(r.Context(), `INSERT INTO plans(title,description,type,status,confirmed_date,location_name,address,created_by) VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),$8) RETURNING id`, input.Title, strings.TrimSpace(input.Description), input.Type, status, confirmedDate, strings.TrimSpace(input.LocationName), strings.TrimSpace(input.Address), userID).Scan(&planID)
	}
	if err == nil && input.Type == "flexible" {
		for _, option := range options {
			var optionID string
			err = tx.QueryRow(r.Context(), `INSERT INTO plan_date_options(plan_id,start_time,end_time) VALUES($1,$2,$3) RETURNING id`, planID, option[0], option[1]).Scan(&optionID)
			if err != nil {
				break
			}
			_, err = tx.Exec(r.Context(), `INSERT INTO plan_date_votes(option_id,user_id,vote) VALUES($1,$2,'yes')`, optionID, userID)
			if err != nil {
				break
			}
		}
	}
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO access_tokens(purpose,token_hash,plan_id) VALUES('plan_access',$1,$2)`, hash[:], planID)
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create plan")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not create plan")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": planID, "public_token": token, "type": input.Type})
}

func (api *API) getPublicPlan(w http.ResponseWriter, r *http.Request) {
	planID, err := api.planIDFromToken(r.Context(), r.PathValue("token"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "plan not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	var plan struct {
		ID, Title, Description, Type, Status string
		ConfirmedDate                        *time.Time
		LocationName, Address                *string
	}
	if err := api.db.QueryRow(r.Context(), `SELECT id,title,description,type,status,confirmed_date,location_name,address FROM plans WHERE id=$1`, planID).Scan(&plan.ID, &plan.Title, &plan.Description, &plan.Type, &plan.Status, &plan.ConfirmedDate, &plan.LocationName, &plan.Address); err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}

	options := make([]publicDateOption, 0)
	rows, err := api.db.Query(r.Context(), `
		SELECT o.id,o.start_time,o.end_time,
		COUNT(*) FILTER(WHERE v.vote='yes')::int,COUNT(*) FILTER(WHERE v.vote='maybe')::int,COUNT(*) FILTER(WHERE v.vote='no')::int,
		COALESCE(array_agg(DISTINCT COALESCE(u.name,v.guest_name) ORDER BY COALESCE(u.name,v.guest_name)) FILTER(WHERE v.vote IN ('yes','maybe')),ARRAY[]::text[])
		FROM plan_date_options o LEFT JOIN plan_date_votes v ON v.option_id=o.id LEFT JOIN users u ON u.id=v.user_id
		WHERE o.plan_id=$1 GROUP BY o.id,o.start_time,o.end_time ORDER BY o.start_time`, planID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load date options")
		return
	}
	defer rows.Close()
	for rows.Next() {
		var option publicDateOption
		if err := rows.Scan(&option.ID, &option.StartTime, &option.EndTime, &option.Yes, &option.Maybe, &option.No, &option.Voters); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load date options")
			return
		}
		options = append(options, option)
	}

	participants := make([]string, 0)
	_ = api.db.QueryRow(r.Context(), `SELECT COALESCE(array_agg(DISTINCT person_name ORDER BY person_name),ARRAY[]::text[]) FROM (
		SELECT creator.name person_name FROM plans p JOIN users creator ON creator.id=p.created_by WHERE p.id=$1
		UNION ALL SELECT COALESCE(u.name,v.guest_name) FROM plan_date_options o JOIN plan_date_votes v ON v.option_id=o.id LEFT JOIN users u ON u.id=v.user_id WHERE o.plan_id=$1 AND v.vote IN ('yes','maybe')) people`, planID).Scan(&participants)

	writeJSON(w, http.StatusOK, map[string]any{"id": plan.ID, "title": plan.Title, "description": plan.Description, "type": plan.Type, "status": plan.Status, "confirmed_date": plan.ConfirmedDate, "location_name": plan.LocationName, "address": plan.Address, "date_options": options, "participants": participants})
}

func (api *API) votePublicPlan(w http.ResponseWriter, r *http.Request) {
	planID, err := api.planIDFromToken(r.Context(), r.PathValue("token"))
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "plan not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	var input voteRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	input.GuestName = strings.TrimSpace(input.GuestName)
	input.GuestSessionID = strings.TrimSpace(input.GuestSessionID)
	if input.GuestName == "" || input.GuestSessionID == "" || len(input.Votes) == 0 {
		writeError(w, http.StatusBadRequest, "guest_name, guest_session_id and votes are required")
		return
	}
	tx, err := api.db.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "database error")
		return
	}
	defer tx.Rollback(r.Context())
	for optionID, vote := range input.Votes {
		if vote != "yes" && vote != "maybe" && vote != "no" {
			writeError(w, http.StatusBadRequest, "votes must be yes, maybe or no")
			return
		}
		var belongs bool
		if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM plan_date_options WHERE id=$1 AND plan_id=$2)`, optionID, planID).Scan(&belongs); err != nil || !belongs {
			writeError(w, http.StatusBadRequest, "invalid date option")
			return
		}
		tag, err := tx.Exec(r.Context(), `UPDATE plan_date_votes SET guest_name=$1,vote=$2,updated_at=now() WHERE option_id=$3 AND guest_session_id=$4::uuid`, input.GuestName, vote, optionID, input.GuestSessionID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid guest session")
			return
		}
		if tag.RowsAffected() == 0 {
			if _, err := tx.Exec(r.Context(), `INSERT INTO plan_date_votes(option_id,guest_name,guest_session_id,vote) VALUES($1,$2,$3::uuid,$4)`, optionID, input.GuestName, input.GuestSessionID, vote); err != nil {
				writeError(w, http.StatusBadRequest, "could not save vote")
				return
			}
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save votes")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}

func (api *API) confirmPlanDate(w http.ResponseWriter, r *http.Request) {
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
	tag, err := api.db.Exec(r.Context(), `UPDATE plans p SET confirmed_date=o.start_time,status='confirmed' FROM plan_date_options o,users u WHERE p.id=$1 AND o.id=$2 AND o.plan_id=p.id AND u.id=p.created_by AND u.email=$3 AND p.type='flexible'`, r.PathValue("id"), input.OptionID, input.CreatorEmail)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not confirm date")
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusForbidden, "date could not be confirmed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "confirmed"})
}

func (api *API) planIDFromToken(ctx context.Context, token string) (string, error) {
	hash := sha256.Sum256([]byte(token))
	var planID string
	err := api.db.QueryRow(ctx, `SELECT plan_id FROM access_tokens WHERE purpose='plan_access' AND token_hash=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now())`, hash[:]).Scan(&planID)
	return planID, err
}

func newToken() (string, [32]byte, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", [32]byte{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(buffer)
	return token, sha256.Sum256([]byte(token)), nil
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

func cors(origins []string, next http.Handler) http.Handler {
	allowed := make(map[string]struct{}, len(origins))
	for _, origin := range origins {
		allowed[strings.TrimRight(strings.TrimSpace(origin), "/")] = struct{}{}
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/"); origin != "" {
			if _, ok := allowed[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
