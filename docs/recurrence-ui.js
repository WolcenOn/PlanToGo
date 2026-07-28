(() => {
  const form = document.querySelector("#plan-form");
  if (!form) return;

  const weekdayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  let recurrencePayload = null;

  function localValue(value) {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function buildRecurringEditor() {
    const builder = document.querySelector("#recurring-builder");
    if (!builder || builder.dataset.enhanced) return;
    builder.dataset.enhanced = "true";
    builder.innerHTML = `
      <div class="recurrence-range">
        <label>Desde<input id="series-from" type="date"></label>
        <label>Hasta<input id="series-to" type="date"></label>
      </div>
      <div class="recurrence-rule-list">
        ${weekdayNames.map((day, index) => `<label class="recurrence-rule"><input type="checkbox" data-weekday="${index + 1}"><span>${day}</span><input type="time" data-start value="17:00"><input type="time" data-end value="18:00"></label>`).join("")}
      </div>
      <small>Cada día puede tener un horario diferente. Se crearán sesiones independientes dentro de un único evento.</small>`;
  }

  function selectedMode() {
    return form.querySelector('input[name="schedule_mode"]:checked')?.value;
  }

  function firstOccurrence(payload) {
    const start = new Date(`${payload.starts_on}T00:00:00`);
    const end = new Date(`${payload.ends_on}T23:59:59`);
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const weekday = cursor.getDay() === 0 ? 7 : cursor.getDay();
      const rule = payload.rules.find(item => item.weekday === weekday);
      if (!rule) continue;
      return new Date(`${cursor.toISOString().slice(0, 10)}T${rule.start_time}:00`);
    }
    return null;
  }

  function collectRecurrence() {
    if (selectedMode() !== "recurring") return null;
    buildRecurringEditor();
    const startsOn = document.querySelector("#series-from")?.value;
    const endsOn = document.querySelector("#series-to")?.value;
    const rules = [...document.querySelectorAll(".recurrence-rule")]
      .filter(row => row.querySelector("[data-weekday]").checked)
      .map(row => ({
        weekday: Number(row.querySelector("[data-weekday]").dataset.weekday),
        start_time: row.querySelector("[data-start]").value,
        end_time: row.querySelector("[data-end]").value
      }));
    if (!startsOn || !endsOn || !rules.length) throw new Error("Define el periodo y al menos un día semanal.");
    if (rules.some(rule => !rule.start_time || !rule.end_time || rule.end_time <= rule.start_time)) throw new Error("Cada día necesita una hora final posterior a la inicial.");
    return { starts_on: startsOn, ends_on: endsOn, timezone: "Europe/Madrid", rules };
  }

  async function loadOccurrences() {
    if (!state.profile?.email || state.publicToken) {
      state.occurrences = [];
      return;
    }
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/dashboard/occurrences?email=${encodeURIComponent(state.profile.email)}`);
    state.occurrences = body.occurrences || [];
  }

  window.PlanRecurrence = {
    preparePlanData(data) {
      recurrencePayload = collectRecurrence();
      if (!recurrencePayload) return data;
      const first = firstOccurrence(recurrencePayload);
      if (!first) throw new Error("El patrón no genera ninguna sesión dentro del periodo.");
      data.type = "fixed";
      data.confirmed_date = first.toISOString();
      data.date_options = [];
      return data;
    },
    async save(planID) {
      if (!recurrencePayload) return null;
      const result = await fetchJSON(`${API_BASE_URL}/api/v1/plans/${planID}/recurrence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...recurrencePayload, actor_email: state.profile.email })
      });
      recurrencePayload = null;
      return result;
    },
    getFocusDate() {
      return recurrencePayload ? firstOccurrence(recurrencePayload) : null;
    },
    async refreshCalendar() {
      try {
        await loadOccurrences();
      } catch (error) {
        state.occurrences = [];
        console.error("No se pudieron cargar las sesiones recurrentes", error);
      }
      renderCalendar();
    }
  };

  const originalLoadDashboard = loadDashboard;
  loadDashboard = async function loadDashboardWithOccurrences() {
    await originalLoadDashboard();
    if (!state.profile?.email || state.publicToken) return;
    try {
      await loadOccurrences();
    } catch (error) {
      state.occurrences = [];
      console.error("No se pudieron cargar las sesiones recurrentes", error);
    }
    renderCalendar();
  };

  const originalPlansForDate = plansForDate;
  plansForDate = function plansForDateWithOccurrences(date) {
    const recurringPlanIDs = new Set((state.occurrences || []).map(item => item.plan_id));
    const normal = originalPlansForDate(date).filter(plan => !recurringPlanIDs.has(plan.id));
    const key = dateKey(date);
    const recurring = (state.occurrences || []).filter(item => dateKey(item.starts_at) === key).map(item => ({
      id: item.plan_id,
      title: item.title,
      ownership: item.ownership,
      confirmed_date: item.starts_at,
      occurrence_id: item.occurrence_id,
      occurrence_end: item.ends_at,
      recurring: true
    }));
    return [...normal, ...recurring];
  };

  function ensureOccurrencePanel() {
    let panel = document.querySelector("#detail-occurrences");
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "detail-occurrences";
    panel.className = "detail-section";
    panel.innerHTML = '<p class="eyebrow">Programación</p><h3>Sesiones recurrentes</h3><div id="occurrence-list"></div>';
    document.querySelector("#detail-voting")?.before(panel);
    return panel;
  }

  async function renderOccurrences(planID) {
    const panel = ensureOccurrencePanel();
    try {
      const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans/${planID}/recurrence?email=${encodeURIComponent(state.profile.email)}`);
      const items = body.occurrences || [];
      panel.hidden = items.length === 0;
      document.querySelector("#detail-edit-form")?.elements.confirmed_date?.closest("label")?.toggleAttribute("hidden", items.length > 0);
      document.querySelector("#occurrence-list").innerHTML = items.map(item => `
        <article class="occurrence-row" data-occurrence-id="${item.id}">
          <div><strong>${escapeText(formatDate(item.starts_at))}</strong><small>Hasta ${new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(item.ends_at))}</small></div>
          ${currentDetail?.is_owner ? '<div><button type="button" data-occurrence-action="edit">Editar</button><button type="button" data-occurrence-action="delete">Eliminar</button></div>' : ''}
        </article>`).join("");
    } catch {
      panel.hidden = true;
    }
  }

  const originalOpenPlanDetail = openPlanDetail;
  openPlanDetail = async function openPlanDetailWithRecurrence(planID) {
    await originalOpenPlanDetail(planID);
    await renderOccurrences(planID);
  };

  document.addEventListener("click", async event => {
    const button = event.target.closest("[data-occurrence-action]");
    if (!button || !currentDetail?.id) return;
    const row = button.closest("[data-occurrence-id]");
    const occurrenceID = row.dataset.occurrenceId;
    if (button.dataset.occurrenceAction === "edit") {
      const start = prompt("Nuevo comienzo (AAAA-MM-DDTHH:MM)", localValue(row.querySelector("strong").textContent));
      if (!start) return;
      const end = prompt("Nuevo final (AAAA-MM-DDTHH:MM)");
      if (!end) return;
      await fetchJSON(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}/occurrences/${occurrenceID}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor_email: state.profile.email, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() }) });
    } else {
      const wholeSeries = confirm("Aceptar: borrar toda la serie. Cancelar: borrar solo esta sesión.");
      const response = await fetch(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}/occurrences/${occurrenceID}?email=${encodeURIComponent(state.profile.email)}&scope=${wholeSeries ? "series" : "occurrence"}`, { method: "DELETE" });
      if (!response.ok) throw new Error("No se pudo eliminar la sesión.");
    }
    await renderOccurrences(currentDetail.id);
    await loadDashboard();
  });

  buildRecurringEditor();
  if (state.profile?.email && !state.publicToken) {
    window.PlanRecurrence.refreshCalendar();
  }
})();