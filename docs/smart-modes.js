(() => {
  const form = document.querySelector("#plan-form");
  const planType = document.querySelector("#plan-type");
  const builder = document.querySelector("#flexible-dates-field");
  const rows = document.querySelector("#date-option-inputs");
  const addButton = document.querySelector("#add-date-option");
  if (!form || !planType || !builder || !rows) return;

  const modePanel = document.createElement("section");
  modePanel.className = "schedule-mode-panel";
  modePanel.innerHTML = `
    <div class="schedule-mode-heading"><strong>¿Qué estás organizando?</strong><small>La forma de proponer fechas se adapta al plan.</small></div>
    <div class="schedule-mode-grid" role="radiogroup" aria-label="Tipo de horario">
      <label><input type="radio" name="schedule_mode" value="meetup" checked><span>Quedada</span><small>Solo hora de comienzo</small></label>
      <label><input type="radio" name="schedule_mode" value="cinema"><span>Cine</span><small>Horas de las sesiones</small></label>
      <label><input type="radio" name="schedule_mode" value="trip"><span>Viaje</span><small>Comienzo y final</small></label>
      <label><input type="radio" name="schedule_mode" value="recurring"><span>Actividad recurrente</span><small>Días semanales y horario</small></label>
    </div>
    <div id="recurring-builder" class="recurring-builder" hidden>
      <div class="recurring-range">
        <label>Desde<input id="recurring-from" type="date"></label>
        <label>Hasta<input id="recurring-to" type="date"></label>
        <label>Empieza<input id="recurring-start" type="time" value="17:00"></label>
        <label>Termina<input id="recurring-end" type="time" value="18:00"></label>
      </div>
      <fieldset><legend>Días de la semana</legend><div class="weekday-grid">
        ${["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"].map((day, index) => `<label><input type="checkbox" value="${index + 1}"><span>${day.slice(0, 3)}</span></label>`).join("")}
      </div></fieldset>
      <small>Se generará una opción por cada día seleccionado dentro del periodo.</small>
    </div>`;
  builder.insertBefore(modePanel, builder.querySelector(".builder-heading"));

  const currentMode = () => form.querySelector('input[name="schedule_mode"]:checked')?.value || "meetup";
  const durationMinutes = mode => mode === "cinema" ? 180 : 120;
  const toLocalValue = date => {
    const copy = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return copy.toISOString().slice(0, 16);
  };

  function addCompactOption(value = "") {
    const mode = currentMode();
    const row = document.createElement("div");
    row.className = "date-option-input compact-option";
    if (mode === "trip") {
      row.innerHTML = `<label>Comienza<input type="datetime-local" class="option-start" value="${value}" required></label><label>Termina<input type="datetime-local" class="option-end" required></label><button type="button" class="icon-button remove-option" aria-label="Eliminar">×</button>`;
    } else {
      row.innerHTML = `<label>${mode === "cinema" ? "Inicio de sesión" : "Día y hora"}<input type="datetime-local" class="option-start" value="${value}" required></label><input type="hidden" class="option-end"><button type="button" class="icon-button remove-option" aria-label="Eliminar">×</button>`;
      row.querySelector(".option-start").addEventListener("change", event => {
        const start = new Date(event.target.value);
        if (!Number.isNaN(start.getTime())) row.querySelector(".option-end").value = toLocalValue(new Date(start.getTime() + durationMinutes(mode) * 60000));
      });
    }
    row.querySelector(".remove-option").addEventListener("click", () => { if (rows.children.length > 2) row.remove(); });
    rows.append(row);
  }

  function rebuildOptions() {
    const mode = currentMode();
    const recurring = mode === "recurring";
    document.querySelector("#recurring-builder").hidden = !recurring;
    rows.hidden = recurring;
    addButton.hidden = recurring;
    rows.innerHTML = "";
    if (!recurring) { addCompactOption(); addCompactOption(); }
    const heading = builder.querySelector(".builder-heading strong");
    if (heading) heading.textContent = mode === "trip" ? "Opciones de viaje" : mode === "cinema" ? "Sesiones propuestas" : mode === "recurring" ? "Programación semanal" : "Días propuestos";
  }

  function generateRecurringRows() {
    if (currentMode() !== "recurring") return true;
    const from = document.querySelector("#recurring-from").value;
    const to = document.querySelector("#recurring-to").value;
    const startTime = document.querySelector("#recurring-start").value;
    const endTime = document.querySelector("#recurring-end").value;
    const weekdays = [...document.querySelectorAll("#recurring-builder .weekday-grid input:checked")].map(input => Number(input.value));
    if (!from || !to || !startTime || !endTime || !weekdays.length) return false;
    rows.innerHTML = "";
    const cursor = new Date(`${from}T00:00`);
    const last = new Date(`${to}T23:59`);
    let count = 0;
    while (cursor <= last && count < 90) {
      const weekday = cursor.getDay() === 0 ? 7 : cursor.getDay();
      if (weekdays.includes(weekday)) {
        const day = toLocalValue(cursor).slice(0, 10);
        const row = document.createElement("div");
        row.className = "date-option-input generated-option";
        row.innerHTML = `<input type="hidden" class="option-start" value="${day}T${startTime}"><input type="hidden" class="option-end" value="${day}T${endTime}">`;
        rows.append(row);
        count += 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return rows.children.length >= 2;
  }

  form.querySelectorAll('input[name="schedule_mode"]').forEach(input => input.addEventListener("change", rebuildOptions));
  planType.addEventListener("change", () => { modePanel.hidden = planType.value !== "flexible"; if (planType.value === "flexible") rebuildOptions(); });
  addButton.addEventListener("click", event => { event.stopImmediatePropagation(); addCompactOption(); }, true);
  form.addEventListener("submit", event => {
    if (planType.value !== "flexible") return;
    if (!generateRecurringRows()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const status = document.querySelector("#form-status");
      status.textContent = "Completa el periodo, el horario y al menos un día semanal.";
      status.classList.add("error");
      return;
    }
    rows.querySelectorAll(".compact-option").forEach(row => {
      const startInput = row.querySelector(".option-start");
      const endInput = row.querySelector(".option-end");
      if (startInput?.value && !endInput?.value) {
        const start = new Date(startInput.value);
        endInput.value = toLocalValue(new Date(start.getTime() + durationMinutes(currentMode()) * 60000));
      }
    });
  }, true);

  const profile = (() => { try { return JSON.parse(localStorage.getItem("plantogo.profile")); } catch { return null; } })();
  if (profile?.email) {
    const welcome = document.querySelector("#welcome-panel");
    welcome?.remove();
    document.querySelector("#dashboard-content")?.removeAttribute("hidden");
    const profileButton = document.querySelector("#profile-button");
    if (profileButton) profileButton.title = "Cambiar o cerrar el perfil guardado en este dispositivo";
  }

  modePanel.hidden = planType.value !== "flexible";
  rebuildOptions();
})();
