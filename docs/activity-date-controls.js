(() => {
  const form = document.querySelector("#plan-form");
  const planType = document.querySelector("#plan-type");
  const fixedField = document.querySelector("#fixed-date-field");
  const flexibleField = document.querySelector("#flexible-dates-field");
  const rows = document.querySelector("#date-option-inputs");
  const addButton = document.querySelector("#add-date-option");
  if (!form || !planType || !fixedField || !flexibleField || !rows || !addButton) return;

  const typeField = planType.closest("label");
  const dateHelp = document.querySelector(".date-scope-helper");
  const builderHeading = flexibleField.querySelector(".builder-heading");
  const builderTitle = builderHeading?.querySelector("strong");
  const builderHelp = builderHeading?.querySelector("small");
  const recurringBuilder = document.querySelector("#recurring-builder");
  const modePanel = document.querySelector(".schedule-mode-panel");

  // El selector de actividad se crea originalmente dentro del bloque flexible.
  // Ese bloque puede ocultarse para fechas fijas, por lo que el selector debe
  // moverse fuera antes de aplicar cualquier visibilidad condicional.
  if (modePanel && flexibleField.contains(modePanel) && typeField) {
    typeField.before(modePanel);
    modePanel.hidden = false;
    modePanel.style.removeProperty("display");
    modePanel.querySelectorAll("input, select, textarea, button").forEach(control => {
      control.disabled = false;
      delete control.dataset.activityDisabled;
    });
  }

  function mode() {
    return form.querySelector('input[name="schedule_mode"]:checked')?.value || "meetup";
  }

  function setVisible(node, visible) {
    if (!node) return;
    node.hidden = !visible;
    if (visible) node.style.removeProperty("display");
    else node.style.setProperty("display", "none", "important");
    node.querySelectorAll("input, select, textarea, button").forEach(control => {
      if (!visible) {
        control.dataset.activityDisabled = control.disabled ? "already" : "temporary";
        control.disabled = true;
      } else if (control.dataset.activityDisabled === "temporary") {
        control.disabled = false;
        delete control.dataset.activityDisabled;
      }
    });
  }

  function refreshRemoveButtons() {
    const minimum = planType.value === "flexible" ? 2 : 1;
    rows.querySelectorAll(".trip-interval .remove-option").forEach(button => {
      button.hidden = rows.children.length <= minimum;
    });
  }

  function buildTripRow(values = {}) {
    const row = document.createElement("div");
    row.className = "date-option-input compact-option trip-interval";
    row.innerHTML = `<label>Inicio del viaje<input type="datetime-local" class="option-start" value="${values.start || ""}" required></label><label>Fin del viaje<input type="datetime-local" class="option-end" value="${values.end || ""}" required></label><button type="button" class="icon-button remove-option" aria-label="Eliminar intervalo">×</button>`;
    row.querySelector(".remove-option").addEventListener("click", () => {
      const minimum = planType.value === "flexible" ? 2 : 1;
      if (rows.children.length > minimum) {
        row.remove();
        refreshRemoveButtons();
      }
    });
    rows.append(row);
    refreshRemoveButtons();
    return row;
  }

  function ensureTripRows() {
    const desiredMinimum = planType.value === "flexible" ? 2 : 1;
    const existing = [...rows.querySelectorAll(".date-option-input")].map(row => ({
      start: row.querySelector(".option-start")?.value || "",
      end: row.querySelector(".option-end")?.value || ""
    }));
    const needsRebuild = [...rows.children].some(row => !row.classList.contains("trip-interval"));
    if (needsRebuild) rows.innerHTML = "";
    while (rows.children.length < desiredMinimum) buildTripRow(existing[rows.children.length] || {});
    if (planType.value === "fixed") [...rows.children].slice(1).forEach(node => node.remove());
    refreshRemoveButtons();
  }

  function sync() {
    const current = mode();
    const recurring = current === "recurring";
    const trip = current === "trip";
    const flexible = planType.value === "flexible";

    if (modePanel) setVisible(modePanel, true);
    setVisible(typeField, !recurring);
    setVisible(recurringBuilder, recurring);

    if (recurring) {
      setVisible(fixedField, false);
      setVisible(flexibleField, true);
      setVisible(rows, false);
      setVisible(addButton, false);
      setVisible(builderHeading, false);
      setVisible(dateHelp, false);
      form.elements.confirmed_date.required = false;
      return;
    }

    if (trip) {
      ensureTripRows();
      setVisible(fixedField, false);
      setVisible(flexibleField, true);
      setVisible(rows, true);
      setVisible(builderHeading, true);
      setVisible(addButton, flexible);
      setVisible(dateHelp, flexible);
      addButton.textContent = "+ Añadir intervalo";
      if (builderTitle) builderTitle.textContent = flexible ? "Intervalos de viaje para votar" : "Intervalo fijo del viaje";
      if (builderHelp) builderHelp.textContent = flexible ? "Cada propuesta incluye el inicio y el fin completos. Añade al menos dos intervalos." : "Indica el comienzo y el final del viaje.";
      form.elements.confirmed_date.required = false;
      return;
    }

    addButton.textContent = "+ Añadir propuesta";
    setVisible(fixedField, !flexible);
    setVisible(flexibleField, flexible);
    setVisible(rows, flexible);
    setVisible(addButton, flexible);
    setVisible(builderHeading, flexible);
    setVisible(dateHelp, flexible);
    form.elements.confirmed_date.required = !flexible;
  }

  form.addEventListener("change", event => {
    if (event.target.matches('input[name="schedule_mode"], #plan-type')) queueMicrotask(sync);
  }, true);

  addButton.addEventListener("click", event => {
    if (mode() !== "trip" || planType.value !== "flexible") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    buildTripRow();
  }, true);

  form.addEventListener("submit", event => {
    if (mode() !== "trip" || planType.value !== "flexible") return;
    const intervals = [...rows.querySelectorAll(".trip-interval")];
    const invalid = intervals.some(row => {
      const start = row.querySelector(".option-start")?.value;
      const end = row.querySelector(".option-end")?.value;
      return !start || !end || new Date(end) <= new Date(start);
    });
    if (intervals.length < 2 || invalid) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setStatus("Añade al menos dos intervalos completos y comprueba que cada fin sea posterior a su inicio.", true);
    }
  }, true);

  form.addEventListener("submit", async event => {
    if (mode() !== "trip" || planType.value !== "fixed") return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const start = rows.querySelector(".option-start")?.value;
    const end = rows.querySelector(".option-end")?.value;
    if (!start || !end || new Date(end) <= new Date(start)) {
      setStatus("Indica un inicio y un fin posterior para el viaje.", true);
      return;
    }

    const data = Object.fromEntries(new FormData(form));
    data.type = "flexible";
    data.confirmed_date = "";
    data.date_options = [{ start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString() }];
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
      dialog.close();
      form.reset();
      await loadDashboard();
    } catch (error) {
      setStatus(error.message === "Failed to fetch" ? "No se pudo conectar con Railway." : error.message, true);
    }
  }, true);

  new MutationObserver(() => queueMicrotask(sync)).observe(form, { subtree: true, childList: true });
  queueMicrotask(sync);
})();
