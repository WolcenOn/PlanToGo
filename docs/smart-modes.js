(() => {
  const form = document.querySelector("#plan-form");
  const planType = document.querySelector("#plan-type");
  const flexibleField = document.querySelector("#flexible-dates-field");
  const fixedField = document.querySelector("#fixed-date-field");
  const rows = document.querySelector("#date-option-inputs");
  const addButton = document.querySelector("#add-date-option");
  if (!form || !planType || !flexibleField || !fixedField || !rows || !addButton) return;

  const typeField = planType.closest("label");
  const builderHeading = flexibleField.querySelector(".builder-heading");
  const builderTitle = builderHeading?.querySelector("strong");
  const builderHelp = builderHeading?.querySelector("small");

  const modePanel = document.createElement("section");
  modePanel.className = "schedule-mode-panel full-width";
  modePanel.innerHTML = `
    <div class="schedule-mode-heading"><strong>¿Qué estás organizando?</strong><small>La forma de indicar las fechas se adapta a la actividad.</small></div>
    <div class="schedule-mode-grid" role="radiogroup" aria-label="Tipo de actividad">
      <label><input type="radio" name="schedule_mode" value="meetup" checked><span>Quedada</span><small>Una fecha o varias propuestas</small></label>
      <label><input type="radio" name="schedule_mode" value="cinema"><span>Cine</span><small>Una sesión o varias propuestas</small></label>
      <label><input type="radio" name="schedule_mode" value="trip"><span>Viaje</span><small>Uno o varios intervalos completos</small></label>
      <label><input type="radio" name="schedule_mode" value="recurring"><span>Actividad recurrente</span><small>Días semanales y horario</small></label>
    </div>
    <div id="recurring-builder" class="recurring-builder" hidden></div>`;
  typeField.before(modePanel);

  const currentMode = () => form.querySelector('input[name="schedule_mode"]:checked')?.value || "meetup";
  const isTrip = () => currentMode() === "trip";
  const isRecurring = () => currentMode() === "recurring";
  const isFlexible = () => planType.value === "flexible";
  const pad = value => String(value).padStart(2, "0");
  const toLocalValue = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  function setVisible(node, visible) {
    if (!node) return;
    node.hidden = !visible;
    if (visible) node.style.removeProperty("display");
    else node.style.setProperty("display", "none", "important");
    node.querySelectorAll("input, select, textarea, button").forEach(control => {
      control.disabled = !visible;
    });
  }

  function formatTripSummary(startDate, endDate) {
    if (!startDate || !endDate) return "Selecciona la salida y el regreso.";
    const start = new Date(`${startDate}T00:00`);
    const end = new Date(`${endDate}T00:00`);
    const nights = Math.max(0, Math.round((end - start) / 86400000));
    const formatter = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" });
    return `${formatter.format(start)} → ${formatter.format(end)} · ${nights} ${nights === 1 ? "noche" : "noches"}`;
  }

  function syncTripRow(row) {
    const startDate = row.querySelector(".trip-start-date");
    const endDate = row.querySelector(".trip-end-date");
    const startTime = row.querySelector(".trip-start-time");
    const endTime = row.querySelector(".trip-end-time");
    const startValue = row.querySelector(".option-start");
    const endValue = row.querySelector(".option-end");
    const summary = row.querySelector(".trip-range-summary");

    if (startDate.value) endDate.min = startDate.value;
    if (startDate.value && endDate.value && endDate.value < startDate.value) endDate.value = startDate.value;
    startValue.value = startDate.value ? `${startDate.value}T${startTime.value || "09:00"}` : "";
    endValue.value = endDate.value ? `${endDate.value}T${endTime.value || "18:00"}` : "";
    summary.textContent = formatTripSummary(startDate.value, endDate.value);
  }

  function buildTripInterval() {
    const row = document.createElement("div");
    row.className = "date-option-input trip-interval unified-trip-interval";
    row.innerHTML = `
      <div class="trip-range-picker">
        <div class="trip-range-picker-heading"><strong>Selecciona el intervalo</strong><small>Elige salida y regreso como al reservar un viaje.</small></div>
        <div class="trip-range-picker-grid">
          <label>Fecha de salida<input type="date" class="trip-start-date" required></label>
          <label>Fecha de regreso<input type="date" class="trip-end-date" required></label>
          <label>Hora de salida<input type="time" class="trip-start-time" value="09:00" required></label>
          <label>Hora de regreso<input type="time" class="trip-end-time" value="18:00" required></label>
        </div>
        <div class="trip-range-summary" aria-live="polite">Selecciona la salida y el regreso.</div>
      </div>
      <input type="hidden" class="option-start">
      <input type="hidden" class="option-end">
      <button type="button" class="icon-button remove-option" aria-label="Eliminar intervalo">×</button>`;

    row.querySelectorAll("input[type=date], input[type=time]").forEach(input => {
      input.addEventListener("change", () => syncTripRow(row));
    });
    row.querySelector(".remove-option").addEventListener("click", () => {
      const minimum = isFlexible() ? 2 : 1;
      if (rows.querySelectorAll(".trip-interval").length > minimum) row.remove();
      syncRemoveButtons();
    });
    rows.append(row);
    syncTripRow(row);
    return row;
  }

  function buildStandardOption() {
    const mode = currentMode();
    const row = document.createElement("div");
    row.className = "date-option-input compact-option";
    const label = mode === "cinema" ? "Inicio de sesión" : "Día y hora";
    row.innerHTML = `<label>${label}<input type="datetime-local" class="option-start" required></label><input type="hidden" class="option-end"><button type="button" class="icon-button remove-option" aria-label="Eliminar propuesta">×</button>`;
    row.querySelector(".option-start").addEventListener("change", event => {
      const start = new Date(event.target.value);
      if (!Number.isNaN(start.getTime())) row.querySelector(".option-end").value = toLocalValue(new Date(start.getTime() + (mode === "cinema" ? 180 : 120) * 60000));
    });
    row.querySelector(".remove-option").addEventListener("click", () => {
      if (rows.children.length > 2) row.remove();
    });
    rows.append(row);
  }

  function syncRemoveButtons() {
    const tripRows = [...rows.querySelectorAll(".trip-interval")];
    const minimum = isFlexible() ? 2 : 1;
    tripRows.forEach(row => {
      row.querySelector(".remove-option").hidden = tripRows.length <= minimum;
    });
  }

  function rebuildRows() {
    rows.innerHTML = "";
    const minimum = isFlexible() ? 2 : 1;
    for (let index = 0; index < minimum; index += 1) {
      if (isTrip()) buildTripInterval();
      else buildStandardOption();
    }
    syncRemoveButtons();
  }

  function sync() {
    const recurring = isRecurring();
    const trip = isTrip();
    const flexible = isFlexible();
    const recurringBuilder = document.querySelector("#recurring-builder");

    setVisible(typeField, !recurring);
    setVisible(recurringBuilder, recurring);

    if (recurring) {
      setVisible(fixedField, false);
      setVisible(flexibleField, false);
      form.elements.confirmed_date.required = false;
      return;
    }

    if (trip) {
      setVisible(fixedField, false);
      setVisible(flexibleField, true);
      setVisible(rows, true);
      setVisible(builderHeading, true);
      setVisible(addButton, flexible);
      addButton.textContent = "+ Añadir intervalo";
      if (builderTitle) builderTitle.textContent = flexible ? "Intervalos de viaje para votar" : "Intervalo fijo del viaje";
      if (builderHelp) builderHelp.textContent = flexible ? "Añade al menos dos intervalos completos." : "Selecciona exactamente una salida y un regreso.";
      form.elements.confirmed_date.required = false;
      form.elements.confirmed_date.value = "";
      rebuildRows();
      return;
    }

    addButton.textContent = "+ Añadir propuesta";
    setVisible(fixedField, !flexible);
    setVisible(flexibleField, flexible);
    setVisible(rows, flexible);
    setVisible(builderHeading, flexible);
    setVisible(addButton, flexible);
    form.elements.confirmed_date.required = !flexible;
    if (flexible) rebuildRows();
  }

  form.querySelectorAll('input[name="schedule_mode"]').forEach(input => input.addEventListener("change", sync));
  planType.addEventListener("change", sync);

  addButton.addEventListener("click", event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (isTrip()) buildTripInterval();
    else buildStandardOption();
    syncRemoveButtons();
  }, true);

  form.addEventListener("submit", async event => {
    if (!isTrip()) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const intervalRows = [...rows.querySelectorAll(".trip-interval")];
    intervalRows.forEach(syncTripRow);
    const minimum = isFlexible() ? 2 : 1;
    const invalid = intervalRows.some(row => {
      const start = row.querySelector(".option-start").value;
      const end = row.querySelector(".option-end").value;
      return !start || !end || new Date(end) <= new Date(start);
    });
    if (intervalRows.length < minimum || (!isFlexible() && intervalRows.length !== 1) || invalid) {
      setStatus(isFlexible()
        ? "Añade al menos dos intervalos completos y comprueba que cada regreso sea posterior a la salida."
        : "Selecciona una salida y un regreso posterior para el viaje.", true);
      return;
    }

    const data = Object.fromEntries(new FormData(form));
    data.type = isFlexible() ? "flexible" : "fixed";
    data.confirmed_date = "";
    data.date_options = intervalRows.map(row => ({
      start_time: new Date(row.querySelector(".option-start").value).toISOString(),
      end_time: new Date(row.querySelector(".option-end").value).toISOString()
    }));
    data.group_ids = [...document.querySelectorAll("#plan-group-options input:checked")].map(input => input.value);

    setStatus("Creando viaje…");
    try {
      const body = await fetchJSON(`${API_BASE_URL}/api/v1/trips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      saveProfile({ name: data.creator_name, email: data.creator_email });
      const link = publicURL(body.public_token);
      statusNode.innerHTML = `Viaje creado. <a href="${link}">Abrir enlace para compartir</a>`;
      await navigator.clipboard?.writeText(link).catch(() => {});
      if (window.PlanSharing?.afterCreate) await window.PlanSharing.afterCreate({ title: data.title }, link);
      form.reset();
      dialog.close();
      await loadDashboard();
    } catch (error) {
      setStatus(error.message === "Failed to fetch" ? "No se pudo conectar con Railway." : error.message, true);
    }
  }, true);

  sync();
})();
