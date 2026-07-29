(() => {
  const schedulesByPlan = new Map();
  let loaded = false;

  const atDayStart = value => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  };
  const sameDay = (a, b) => atDayStart(a).getTime() === atDayStart(b).getTime();

  function entryRangeForDate(entry, date) {
    if (entry.kind === "instant") {
      if (!entry.start_time || !sameDay(entry.start_time, date)) return null;
      const start = new Date(entry.start_time);
      return { start, end: start };
    }
    if (entry.kind === "interval") {
      if (!entry.start_time || !entry.end_time) return null;
      const start = new Date(entry.start_time);
      const end = new Date(entry.end_time);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
      const target = atDayStart(date).getTime();
      if (target < atDayStart(start).getTime() || target > atDayStart(end).getTime()) return null;
      return { start, end };
    }
    if (entry.kind !== "recurrence" || !entry.recurrence) return null;
    const rule = typeof entry.recurrence === "string" ? JSON.parse(entry.recurrence) : entry.recurrence;
    const weekdays = Array.isArray(rule.weekdays) ? rule.weekdays.map(Number) : [];
    const isoWeekday = date.getDay() === 0 ? 7 : date.getDay();
    if (rule.frequency !== "weekly" || !weekdays.includes(isoWeekday)) return null;
    if (rule.start_date && atDayStart(date) < atDayStart(rule.start_date)) return null;
    if (rule.until && atDayStart(date) > atDayStart(rule.until)) return null;
    const start = new Date(date);
    const [hour, minute] = String(rule.start_time || "09:00").split(":").map(Number);
    start.setHours(hour || 0, minute || 0, 0, 0);
    const end = new Date(start.getTime() + (Number(rule.duration_minutes) || 60) * 60000);
    return { start, end };
  }

  function visibleEntries(entries) {
    if (!entries.length) return [];
    const mode = entries[0].mode;
    const status = entries[0].plan_status;
    if (mode === "trip" && status === "confirmed") {
      return entries.filter(entry => entry.state === "confirmed");
    }
    return entries.filter(entry => entry.state !== "cancelled");
  }

  async function loadSchedules() {
    if (!state?.profile?.email) return;
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/calendar/schedules?email=${encodeURIComponent(state.profile.email)}`);
    const next = new Map();
    for (const entry of body?.schedules || []) {
      const list = next.get(entry.plan_id) || [];
      list.push(entry);
      next.set(entry.plan_id, list);
    }
    schedulesByPlan.clear();
    next.forEach((entries, id) => schedulesByPlan.set(id, entries));
    loaded = true;
  }

  const originalLoadDashboard = loadDashboard;
  loadDashboard = async function loadDashboardWithSchedules() {
    await originalLoadDashboard();
    try {
      await loadSchedules();
    } catch (error) {
      console.error("No se pudo cargar la programación unificada", error);
    }
    renderDashboard();
  };

  const originalPlansForDate = plansForDate;
  plansForDate = function plansForDateFromSchedules(date) {
    if (!loaded) return originalPlansForDate(date);
    const scheduledIDs = new Set(schedulesByPlan.keys());
    const result = originalPlansForDate(date).filter(plan => !scheduledIDs.has(plan.id));

    for (const plan of state.plans || []) {
      const entries = visibleEntries(schedulesByPlan.get(plan.id) || []);
      for (const entry of entries) {
        const range = entryRangeForDate(entry, date);
        if (!range) continue;
        const startDay = atDayStart(range.start).getTime();
        const endDay = atDayStart(range.end).getTime();
        const target = atDayStart(date).getTime();
        result.push({
          ...plan,
          confirmed_date: range.start.toISOString(),
          schedule_mode: entry.mode,
          _calendarPending: entry.state === "candidate" || entry.plan_status !== "confirmed",
          _calendarSegment: startDay === endDay ? "single" : target === startDay ? "start" : target === endDay ? "end" : "middle",
          _calendarScheduleID: entry.id,
          _calendarStart: range.start.toISOString(),
          _calendarEnd: range.end.toISOString()
        });
      }
    }
    return result;
  };

  const originalRenderPlanDetail = renderPlanDetail;
  renderPlanDetail = function renderPlanDetailFromSchedules() {
    originalRenderPlanDetail();
    const entries = schedulesByPlan.get(currentDetail?.id) || [];
    const trip = entries.some(entry => entry.mode === "trip");
    const form = document.querySelector("#detail-edit-form");
    const input = form?.elements?.confirmed_date;
    const label = input?.closest("label");
    if (label) {
      label.hidden = trip;
      label.style.display = trip ? "none" : "";
    }
    if (input) input.disabled = trip;
    const title = document.querySelector("#detail-voting h3");
    if (trip && title) title.textContent = currentDetail?.status === "confirmed" ? "Intervalo confirmado" : "Intervalos disponibles";
  };

  queueMicrotask(async () => {
    try { await loadSchedules(); } catch (error) { console.error("No se pudo cargar la programación unificada", error); }
    renderDashboard();
  });
})();
