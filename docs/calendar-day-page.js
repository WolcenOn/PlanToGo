(() => {
  const dashboardView = document.querySelector("#dashboard-view");
  const groupsView = document.querySelector("#groups-view");
  const topbarTitle = document.querySelector(".topbar h1");
  const topbarEyebrow = document.querySelector(".topbar .eyebrow");
  const topbarActions = document.querySelector(".topbar-actions");
  const calendar = document.querySelector("#calendar");
  if (!dashboardView || !topbarTitle || !calendar) return;

  const palette = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#059669", "#0891b2", "#4f46e5", "#65a30d"];

  function groupColor(groupID) {
    if (!groupID) return "#64748b";
    let hash = 0;
    for (const char of String(groupID)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return palette[hash % palette.length];
  }

  function localDateKey(value) {
    const date = value instanceof Date ? value : new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function dateFromKey(key) {
    const [year, month, day] = String(key || "").split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dashboardDateKeys() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return new Set([0, 1, 2].map(offset => {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      return localDateKey(date);
    }));
  }

  const previousFilteredPlans = filteredPlans;
  filteredPlans = function filteredPlansForDashboard() {
    const plans = previousFilteredPlans();
    const params = new URL(window.location.href).searchParams;
    if (params.get("view") === "day") return plans;
    const visibleDates = dashboardDateKeys();
    return plans.filter(plan => plan.confirmed_date && visibleDates.has(localDateKey(plan.confirmed_date)));
  };

  const dayView = document.createElement("section");
  dayView.id = "day-plans-view";
  dayView.hidden = true;
  dayView.innerHTML = `
    <div class="day-page-heading">
      <button type="button" id="back-from-day" class="secondary-button">← Volver al dashboard</button>
      <div><p class="eyebrow">Agenda diaria</p><h2 id="day-page-title">Planes del día</h2><p id="day-page-count"></p></div>
    </div>
    <div id="day-plans-list" class="plans-grid day-plans-grid"></div>
    <p id="day-plans-empty" class="empty-state" hidden>No hay planes para este día.</p>`;
  (groupsView || dashboardView).after(dayView);

  function taskSummary(plan) {
    const mine = Number(plan.my_pending_task_count || 0);
    const open = Number(plan.open_pending_task_count || 0);
    const total = Number(plan.pending_task_count || 0);
    if (!total) return '<div class="plan-task-summary done"><strong>✓</strong><span>Sin tareas pendientes</span></div>';
    return `<div class="plan-task-summary"><span><strong>${mine}</strong> para ti</span><span><strong>${open}</strong> sin asignar</span><span><strong>${total}</strong> pendientes</span></div>`;
  }

  function planCard(plan) {
    const card = document.createElement("article");
    const date = plan.confirmed_date ? new Date(plan.confirmed_date) : null;
    const color = groupColor(plan.group_id);
    const typeLabel = plan.type === "flexible" ? (plan.status === "confirmed" ? "Fecha decidida" : `${plan.date_option_count || 0} opciones`) : "Fecha fija";
    card.className = `plan-card ${plan.ownership || "friend"}${plan.group_id ? " has-group-color" : ""}`;
    card.style.setProperty("--group-color", color);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Abrir ${plan.title}`);
    card.innerHTML = `
      <div class="plan-tags"><span class="tag ${plan.ownership || "friend"}">${plan.ownership === "own" ? "Plan propio" : "De amigos"}</span><span class="tag ${plan.type || "fixed"}">${typeLabel}</span></div>
      <div><h3>${escapeText(plan.title)}</h3><p>${escapeText(plan.group_name || plan.location_name || "Sin grupo ni lugar")}</p></div>
      ${taskSummary(plan)}
      <div class="date-badge"><strong>${date ? new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(date) : "?"}</strong><span>${plan.recurring ? "Sesión recurrente" : "Horario del plan"}</span></div>`;
    const open = () => openPlanDetail?.(plan.id);
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
    return card;
  }

  function renderDay(key) {
    const date = dateFromKey(key);
    if (!date) return;
    const plans = plansForDate(date).sort((a, b) => new Date(a.confirmed_date) - new Date(b.confirmed_date));
    document.querySelector("#day-page-title").textContent = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
    document.querySelector("#day-page-count").textContent = `${plans.length} ${plans.length === 1 ? "plan" : "planes"}`;
    const list = document.querySelector("#day-plans-list");
    list.replaceChildren(...plans.map(planCard));
    document.querySelector("#day-plans-empty").hidden = plans.length > 0;
  }

  function setDayView(key, { history = true } = {}) {
    const date = dateFromKey(key);
    if (!date) return;
    dashboardView.hidden = true;
    if (groupsView) groupsView.hidden = true;
    dayView.hidden = false;
    topbarTitle.textContent = "Planes del día";
    if (topbarEyebrow) topbarEyebrow.textContent = "Calendario";
    if (topbarActions) topbarActions.hidden = true;
    document.body.classList.remove("groups-page-active");
    document.body.classList.add("day-page-active");
    renderDay(key);
    if (history) {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "day");
      url.searchParams.set("date", key);
      window.history.pushState({ view: "day", date: key }, "", url);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function leaveDayView({ history = true } = {}) {
    dayView.hidden = true;
    dashboardView.hidden = false;
    topbarTitle.textContent = "Dashboard";
    if (topbarEyebrow) topbarEyebrow.textContent = "Tu espacio";
    if (topbarActions) topbarActions.hidden = false;
    document.body.classList.remove("day-page-active");
    if (history) {
      const url = new URL(window.location.href);
      url.searchParams.delete("view");
      url.searchParams.delete("date");
      window.history.pushState({ view: "dashboard" }, "", url);
    }
    renderPlans();
  }

  function annotateCalendarDays() {
    if (state.calendarView !== "month") return;
    const first = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth(), 1);
    const start = startOfWeek(first);
    document.querySelectorAll("#calendar .calendar-day").forEach((cell, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = localDateKey(date);
      cell.dataset.date = key;
      cell.tabIndex = 0;
      cell.setAttribute("role", "link");
      cell.setAttribute("aria-label", `Ver planes del ${new Intl.DateTimeFormat("es-ES", { dateStyle: "full" }).format(date)}`);
    });
  }

  const previousRenderCalendar = renderCalendar;
  renderCalendar = function renderClickableCalendar() {
    previousRenderCalendar();
    annotateCalendarDays();
  };

  calendar.addEventListener("click", event => {
    const day = event.target.closest(".calendar-day[data-date]");
    if (day) setDayView(day.dataset.date);
  });
  calendar.addEventListener("keydown", event => {
    const day = event.target.closest(".calendar-day[data-date]");
    if (day && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setDayView(day.dataset.date);
    }
  });

  document.querySelector("#back-from-day")?.addEventListener("click", () => leaveDayView());
  window.addEventListener("popstate", () => {
    const params = new URL(window.location.href).searchParams;
    if (params.get("view") === "day" && params.get("date")) setDayView(params.get("date"), { history: false });
    else {
      dayView.hidden = true;
      document.body.classList.remove("day-page-active");
      renderPlans();
    }
  });

  const params = new URL(window.location.href).searchParams;
  if (params.get("view") === "day" && params.get("date")) setDayView(params.get("date"), { history: false });
  else renderPlans();
  renderCalendar();
})();