(() => {
  const TIMEZONE = "Europe/Madrid";

  function zonedDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function calendarCellKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function recurringOccurrence(item) {
    const source = (state.plans || []).find(plan => plan.id === item.plan_id) || {};
    return {
      ...source,
      id: item.plan_id,
      title: item.title || source.title || "Actividad recurrente",
      ownership: item.ownership || source.ownership || "own",
      confirmed_date: item.starts_at,
      occurrence_id: item.occurrence_id || item.id,
      occurrence_end: item.ends_at,
      recurring: true,
      _calendarPending: false,
      _calendarSegment: "single"
    };
  }

  function install() {
    if (typeof plansForDate !== "function") return false;
    const previousPlansForDate = plansForDate;

    plansForDate = function plansForDateUnified(date) {
      const key = calendarCellKey(date);
      const occurrences = Array.isArray(state.occurrences) ? state.occurrences : [];
      const recurringPlanIDs = new Set(occurrences.map(item => item.plan_id).filter(Boolean));
      const normal = previousPlansForDate(date).filter(plan => !recurringPlanIDs.has(plan.id));
      const recurring = occurrences
        .filter(item => zonedDateKey(item.starts_at) === key)
        .map(recurringOccurrence);

      const seen = new Set();
      return [...normal, ...recurring].filter(item => {
        const identity = item.recurring
          ? `${item.id}|${item.occurrence_id || item.confirmed_date}`
          : `${item.id}|normal`;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
    };

    window.PlanCalendarOccurrences = {
      zonedDateKey,
      refresh: async () => {
        if (window.PlanRecurrence?.refreshCalendar) {
          await window.PlanRecurrence.refreshCalendar();
        } else {
          renderCalendar();
        }
      }
    };
    renderCalendar();
    return true;
  }

  if (!install()) {
    const timer = setInterval(() => {
      if (install()) clearInterval(timer);
    }, 50);
    setTimeout(() => clearInterval(timer), 10000);
  }
})();