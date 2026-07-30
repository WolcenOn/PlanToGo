package handlers

import (
    "encoding/json"
    "fmt"
    "net/http"
    "strings"
    "time"

    "github.com/jackc/pgx/v5"
    "github.com/jackc/pgx/v5/pgxpool"
)

type recurrenceRuleV17 struct {
    Weekday  int    `json:"weekday"`
    StartTime string `json:"start_time"`
    EndTime   string `json:"end_time"`
}

type recurrenceWriteV17 struct {
    ActorEmail string              `json:"actor_email"`
    StartsOn   string              `json:"starts_on"`
    EndsOn     string              `json:"ends_on"`
    Timezone   string              `json:"timezone"`
    Rules      []recurrenceRuleV17 `json:"rules"`
}

type occurrenceV17 struct {
    ID           string    `json:"id"`
    OccurrenceID string    `json:"occurrence_id"`
    PlanID       string    `json:"plan_id"`
    Title        string    `json:"title,omitempty"`
    Ownership    string    `json:"ownership,omitempty"`
    StartsAt     time.Time `json:"starts_at"`
    EndsAt       time.Time `json:"ends_at"`
}

func NewRouterV17(db *pgxpool.Pool, origins []string) http.Handler {
    api := &API{db: db}
    mux := http.NewServeMux()
    mux.HandleFunc("POST /api/v1/plans/{id}/recurrence", api.saveRecurrenceRulesV17)
    mux.HandleFunc("PUT /api/v1/plans/{id}/recurrence", api.saveRecurrenceRulesV17)
    mux.HandleFunc("GET /api/v1/plans/{id}/recurrence", api.getRecurrenceRulesV17)
    mux.HandleFunc("GET /api/v1/dashboard/occurrences", api.dashboardOccurrencesV17)
    mux.HandleFunc("PATCH /api/v1/plans/{id}/occurrences/{occurrenceID}", api.overrideOccurrenceV17)
    mux.HandleFunc("DELETE /api/v1/plans/{id}/occurrences/{occurrenceID}", api.deleteOccurrenceV17)
    mux.Handle("/", NewRouterV16(db, origins))
    return corsWithWrites(origins, securityHeaders(mux))
}

func parseClockV17(value string) (time.Time, error) {
    return time.Parse("15:04", strings.TrimSpace(value))
}

func (api *API) recurrenceOwnerV17(r *http.Request, planID, email string) bool {
    var ok bool
    err := api.db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM plans p JOIN users u ON u.id=p.created_by WHERE p.id=$1 AND u.email=$2)`, planID, strings.ToLower(strings.TrimSpace(email))).Scan(&ok)
    return err == nil && ok
}

func validateRecurrenceV17(input *recurrenceWriteV17) (time.Time, time.Time, error) {
    start, err := time.Parse("2006-01-02", input.StartsOn)
    if err != nil { return time.Time{}, time.Time{}, fmt.Errorf("primer día no válido") }
    end, err := time.Parse("2006-01-02", input.EndsOn)
    if err != nil || end.Before(start) { return time.Time{}, time.Time{}, fmt.Errorf("último día no válido") }
    if len(input.Rules) == 0 { return time.Time{}, time.Time{}, fmt.Errorf("selecciona al menos un día semanal") }
    seen := map[int]bool{}
    for _, rule := range input.Rules {
        if rule.Weekday < 1 || rule.Weekday > 7 || seen[rule.Weekday] { return time.Time{}, time.Time{}, fmt.Errorf("días semanales no válidos") }
        seen[rule.Weekday] = true
        s, e1 := parseClockV17(rule.StartTime); e, e2 := parseClockV17(rule.EndTime)
        if e1 != nil || e2 != nil || !e.After(s) { return time.Time{}, time.Time{}, fmt.Errorf("cada día necesita una hora final posterior") }
    }
    if strings.TrimSpace(input.Timezone) == "" { input.Timezone = "Europe/Madrid" }
    return start, end, nil
}

func (api *API) saveRecurrenceRulesV17(w http.ResponseWriter, r *http.Request) {
    planID := r.PathValue("id")
    var input recurrenceWriteV17
    if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&input); err != nil { writeError(w, 400, "invalid JSON"); return }
    start, end, err := validateRecurrenceV17(&input)
    if err != nil { writeError(w, 400, err.Error()); return }
    if !api.recurrenceOwnerV17(r, planID, input.ActorEmail) { writeError(w, 403, "only the owner can edit recurrence"); return }
    tx, err := api.db.Begin(r.Context()); if err != nil { writeError(w, 500, "database error"); return }; defer tx.Rollback(r.Context())
    _, err = tx.Exec(r.Context(), `INSERT INTO plan_recurrence_series_v2(plan_id,starts_on,ends_on,timezone) VALUES($1,$2,$3,$4)
        ON CONFLICT(plan_id) DO UPDATE SET starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on,timezone=EXCLUDED.timezone,updated_at=now()`, planID, start, end, input.Timezone)
    if err != nil { writeError(w, 500, "could not save recurrence"); return }
    weekdays := make([]int, 0, len(input.Rules))
    for _, rule := range input.Rules {
        weekdays = append(weekdays, rule.Weekday)
        _, err = tx.Exec(r.Context(), `INSERT INTO plan_recurrence_rules_v2(plan_id,weekday,start_time,end_time) VALUES($1,$2,$3::time,$4::time)
            ON CONFLICT(plan_id,weekday) DO UPDATE SET start_time=EXCLUDED.start_time,end_time=EXCLUDED.end_time,updated_at=now()`, planID, rule.Weekday, rule.StartTime, rule.EndTime)
        if err != nil { writeError(w, 500, "could not save weekly rule"); return }
    }
    _, err = tx.Exec(r.Context(), `DELETE FROM plan_recurrence_rules_v2 WHERE plan_id=$1 AND NOT (weekday=ANY($2))`, planID, weekdays)
    if err != nil { writeError(w, 500, "could not remove weekly rules"); return }
    _, _ = tx.Exec(r.Context(), `DELETE FROM plan_recurrence_exceptions_v2 WHERE plan_id=$1 AND occurrence_date NOT BETWEEN $2 AND $3`, planID, start, end)
    if err = tx.Commit(r.Context()); err != nil { writeError(w, 500, "could not save recurrence"); return }
    writeJSON(w, 200, map[string]any{"plan_id": planID, "rules": input.Rules})
}

func weekdayISOv17(t time.Time) int { if t.Weekday()==time.Sunday { return 7 }; return int(t.Weekday()) }

func combineLocalV17(day time.Time, clock string, loc *time.Location) (time.Time, error) {
    c, err := time.Parse("15:04:05", clock); if err != nil { c, err = time.Parse("15:04", clock) }; if err != nil { return time.Time{}, err }
    return time.Date(day.Year(), day.Month(), day.Day(), c.Hour(), c.Minute(), c.Second(), 0, loc), nil
}

func (api *API) buildOccurrencesV17(r *http.Request, planID string, from, to time.Time) ([]occurrenceV17, error) {
    var startsOn, endsOn time.Time; var timezone string
    if err := api.db.QueryRow(r.Context(), `SELECT starts_on,ends_on,timezone FROM plan_recurrence_series_v2 WHERE plan_id=$1`, planID).Scan(&startsOn,&endsOn,&timezone); err != nil { return nil, err }
    loc, err := time.LoadLocation(timezone); if err != nil { loc = time.Local }
    rows, err := api.db.Query(r.Context(), `SELECT weekday,start_time::text,end_time::text FROM plan_recurrence_rules_v2 WHERE plan_id=$1`, planID); if err != nil { return nil, err }; defer rows.Close()
    rules := map[int][2]string{}; for rows.Next(){ var wd int; var s,e string; if err:=rows.Scan(&wd,&s,&e);err!=nil{return nil,err}; rules[wd]=[2]string{s,e} }
    exRows, err := api.db.Query(r.Context(), `SELECT occurrence_date,action,starts_at,ends_at FROM plan_recurrence_exceptions_v2 WHERE plan_id=$1`, planID); if err != nil { return nil, err }; defer exRows.Close()
    type ex struct{ action string; start,end *time.Time }; exceptions:=map[string]ex{}
    for exRows.Next(){ var d time.Time; var x ex; if err:=exRows.Scan(&d,&x.action,&x.start,&x.end);err!=nil{return nil,err}; exceptions[d.Format("2006-01-02")]=x }
    if from.Before(startsOn){from=startsOn}; if to.After(endsOn){to=endsOn}; result:=[]occurrenceV17{}
    for day:=time.Date(from.Year(),from.Month(),from.Day(),0,0,0,0,loc); !day.After(to); day=day.AddDate(0,0,1){
        key:=day.Format("2006-01-02"); if x,ok:=exceptions[key];ok { if x.action=="cancel"{continue}; if x.start!=nil&&x.end!=nil{result=append(result,occurrenceV17{ID:key,OccurrenceID:key,PlanID:planID,StartsAt:*x.start,EndsAt:*x.end});continue} }
        rule,ok:=rules[weekdayISOv17(day)]; if !ok {continue}; s,err:=combineLocalV17(day,rule[0],loc);if err!=nil{return nil,err};e,err:=combineLocalV17(day,rule[1],loc);if err!=nil{return nil,err};result=append(result,occurrenceV17{ID:key,OccurrenceID:key,PlanID:planID,StartsAt:s,EndsAt:e})
    }
    return result,nil
}

func (api *API) getRecurrenceRulesV17(w http.ResponseWriter, r *http.Request) {
    planID,email:=r.PathValue("id"),r.URL.Query().Get("email"); if !api.canAccessPlan(r,planID,email){writeError(w,403,"plan access denied");return}
    var starts,ends time.Time;var timezone string;err:=api.db.QueryRow(r.Context(),`SELECT starts_on,ends_on,timezone FROM plan_recurrence_series_v2 WHERE plan_id=$1`,planID).Scan(&starts,&ends,&timezone);if err==pgx.ErrNoRows{writeJSON(w,200,map[string]any{"rules":[]any{},"occurrences":[]any{}});return};if err!=nil{writeError(w,500,"could not load recurrence");return}
    rows,err:=api.db.Query(r.Context(),`SELECT weekday,to_char(start_time,'HH24:MI'),to_char(end_time,'HH24:MI') FROM plan_recurrence_rules_v2 WHERE plan_id=$1 ORDER BY weekday`,planID);if err!=nil{writeError(w,500,"could not load rules");return};defer rows.Close();rules:=[]recurrenceRuleV17{};for rows.Next(){var x recurrenceRuleV17;if rows.Scan(&x.Weekday,&x.StartTime,&x.EndTime)==nil{rules=append(rules,x)}}
    occ,_:=api.buildOccurrencesV17(r,planID,time.Now().AddDate(0,-1,0),time.Now().AddDate(1,0,0));writeJSON(w,200,map[string]any{"starts_on":starts.Format("2006-01-02"),"ends_on":ends.Format("2006-01-02"),"timezone":timezone,"rules":rules,"occurrences":occ})
}

func (api *API) dashboardOccurrencesV17(w http.ResponseWriter, r *http.Request) {
    email:=strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")));if email==""{writeError(w,400,"email is required");return}
    rows,err:=api.db.Query(r.Context(),`SELECT DISTINCT p.id,p.title,CASE WHEN p.created_by=u.id THEN 'own' ELSE 'friend' END FROM users u JOIN plans p ON p.created_by=u.id OR p.group_id IN(SELECT group_id FROM group_members WHERE user_id=u.id) JOIN plan_recurrence_series_v2 s ON s.plan_id=p.id WHERE u.email=$1`,email);if err!=nil{writeError(w,500,"could not load recurring plans");return};defer rows.Close();all:=[]occurrenceV17{}
    from,to:=time.Now().AddDate(0,-2,0),time.Now().AddDate(1,0,0);for rows.Next(){var id,title,own string;if rows.Scan(&id,&title,&own)!=nil{continue};items,err:=api.buildOccurrencesV17(r,id,from,to);if err!=nil{continue};for i:=range items{items[i].Title=title;items[i].Ownership=own};all=append(all,items...)};writeJSON(w,200,map[string]any{"occurrences":all})
}

type occurrenceOverrideV17 struct{ ActorEmail,StartsAt,EndsAt string }
func (api *API) overrideOccurrenceV17(w http.ResponseWriter,r *http.Request){planID,key:=r.PathValue("id"),r.PathValue("occurrenceID");var input occurrenceOverrideV17;if json.NewDecoder(http.MaxBytesReader(w,r.Body,1<<20)).Decode(&input)!=nil{writeError(w,400,"invalid JSON");return};if !api.recurrenceOwnerV17(r,planID,input.ActorEmail){writeError(w,403,"only owner can edit");return};day,err:=time.Parse("2006-01-02",key);s,e1:=time.Parse(time.RFC3339,input.StartsAt);e,e2:=time.Parse(time.RFC3339,input.EndsAt);if err!=nil||e1!=nil||e2!=nil||!e.After(s){writeError(w,400,"invalid occurrence");return};_,err=api.db.Exec(r.Context(),`INSERT INTO plan_recurrence_exceptions_v2(plan_id,occurrence_date,action,starts_at,ends_at) VALUES($1,$2,'override',$3,$4) ON CONFLICT(plan_id,occurrence_date) DO UPDATE SET action='override',starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,updated_at=now()`,planID,day,s,e);if err!=nil{writeError(w,500,"could not edit occurrence");return};writeJSON(w,200,map[string]bool{"updated":true})}
func (api *API) deleteOccurrenceV17(w http.ResponseWriter,r *http.Request){planID,key:=r.PathValue("id"),r.PathValue("occurrenceID");email:=r.URL.Query().Get("email");if !api.recurrenceOwnerV17(r,planID,email){writeError(w,403,"only owner can edit");return};day,err:=time.Parse("2006-01-02",key);if err!=nil{writeError(w,400,"invalid occurrence");return};_,err=api.db.Exec(r.Context(),`INSERT INTO plan_recurrence_exceptions_v2(plan_id,occurrence_date,action) VALUES($1,$2,'cancel') ON CONFLICT(plan_id,occurrence_date) DO UPDATE SET action='cancel',starts_at=NULL,ends_at=NULL,updated_at=now()`,planID,day);if err!=nil{writeError(w,500,"could not delete occurrence");return};w.WriteHeader(http.StatusNoContent)}
