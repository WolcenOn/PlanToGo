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

  function buildTripRow(values = {}) {
    const row = document.createElement("div");
    row.className = "date-option-input compact-option trip-interval";
    row.innerHTML = `<label>Inicio del viaje<input type="datetime-local" class="option-start" value="${values.start || ""}" required></label><label>Fin del viaje<input type="datetime-local" class="option-end" value="${values.end || ""}" required></label><button type="button" class="icon-button remove-option" aria-label="Eliminar intervalo">×</button>`;
    row.querySelector(".remove-option").addEventListener("click", () => {
      const minimum = planType.value === "flexible" ? 2 : 1;
      if (rows.children.length > minimum) row.remove();
    });
    rows.append(row);
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
    rows.querySelectorAll(".remove-option").forEach(button => {
      button.hidden = rows.children.length <= desiredMinimum;
    });
  }

  function sync() {
    const current = mode();
    const recurring = current === "recurring";
    const trip = current === "trip";
    const flexible = planType.value === "flexible";

    // Quedadas, cine y viajes siempre permiten escoger entre fecha fija y votación.
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
      if (builderTitle) builderTitle.textContent = flexible ? "Intervalos de viaje para votar" : "Intervalo fijo del viaje";
      if (builderHelp) builderHelp.textContent = flexible ? "Añade al menos dos periodos completos." : "Indica el comienzo y el final del viaje.";
      form.elements.confirmed_date.required = false;
      return;
    }

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
    sync();
  }, true);

  // Un viaje fijo necesita conservar inicio y fin. El modelo actual almacena los
  // intervalos en date_options, por lo que se crea como una única opción cerrada.
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