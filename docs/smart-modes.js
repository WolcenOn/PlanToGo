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
      <label><input type="radio" name="schedule_mode" value="trip"><span>Viaje</span><small>Intervalos completos de inicio y fin</small></label>
      <label><input type="radio" name="schedule_mode" value="recurring"><span>Actividad recurrente</span><small>Días semanales y horario</small></label>
    </div>
    <div id="recurring-builder" class="recurring-builder" hidden></div>`;
  typeField.before(modePanel);

  const currentMode = () => form.querySelector('input[name="schedule_mode"]:checked')?.value || "meetup";
  const isTrip = () => currentMode() === "trip";
  const isRecurring = () => currentMode() === "recurring";
  const isFlexible = () => planType.value === "flexible";
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

  function buildOption() {
    const mode = currentMode();
    const row = document.createElement("div");
    row.className = `date-option-input compact-option${mode === "trip" ? " trip-interval" : ""}`;
    if (mode === "trip") {
      row.innerHTML = '<label>Inicio del viaje<input type="datetime-local" class="option-start" required></label><label>Fin del viaje<input type="datetime-local" class="option-end" required></label><button type="button" class="icon-button remove-option" aria-label="Eliminar intervalo">×</button>';
    } else {
      const label = mode === "cinema" ? "Inicio de sesión" : "Día y hora";
      row.innerHTML = `<label>${label}<input type="datetime-local" class="option-start" required></label><input type="hidden" class="option-end"><button type="button" class="icon-button remove-option" aria-label="Eliminar propuesta">×</button>`;
      row.querySelector(".option-start").addEventListener("change", event => {
        const start = new Date(event.target.value);
        if (!Number.isNaN(start.getTime())) row.querySelector(".option-end").value = toLocalValue(new Date(start.getTime() + (mode === "cinema" ? 180 : 120) * 60000));
      });
    }
    row.querySelector(".remove-option").addEventListener("click", () => {
      const minimum = isFlexible() ? 2 : 1;
      if (rows.children.length > minimum) row.remove();
    });
    rows.append(row);
  }

  function rebuildRows() {
    rows.innerHTML = "";
    const minimum = isFlexible() ? 2 : 1;
    for (let index = 0; index < minimum; index += 1) buildOption();
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
      if (builderHelp) builderHelp.textContent = flexible ? "Cada propuesta incluye inicio y fin. Añade al menos dos intervalos." : "Indica el inicio y el final del viaje.";
      form.elements.confirmed_date.required = false;
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
    buildOption();
  }, true);

  form.addEventListener("submit", async event => {
    if (!isTrip()) return;
    const intervals = [...rows.querySelectorAll(".trip-interval")];
    const invalid = intervals.some(row => {
      const start = row.querySelector(".option-start")?.value;
      const end = row.querySelector(".option-end")?.value;
      return !start || !end || new Date(end) <= new Date(start);
    });
    const minimum = isFlexible() ? 2 : 1;
    if (intervals.length < minimum || invalid) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setStatus(`Añade al menos ${minimum === 1 ? "un intervalo completo" : "dos intervalos completos"} y comprueba sus fechas.`, true);
      return;
    }

    if (isFlexible()) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const interval = intervals[0];
    const data = Object.fromEntries(new FormData(form));
    data.type = "flexible";
    data.confirmed_date = "";
    data.date_options = [{
      start_time: new Date(interval.querySelector(".option-start").value).toISOString(),
      end_time: new Date(interval.querySelector(".option-end").value).toISOString()
    }];
    setStatus("Creando viaje…");
    try {
      const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      saveProfile({ name: data.creator_name, email: data.creator_email });
      const link = publicURL(body.public_token);
      statusNode.innerHTML = `Viaje creado. <a href="${link}">Abrir enlace para compartir</a>`;
      await navigator.clipboard?.writeText(link).catch(() => {});
      await loadDashboard();
    } catch (error) {
      setStatus(error.message === "Failed to fetch" ? "No se pudo conectar con Railway." : error.message, true);
    }
  }, true);

  sync();
})();