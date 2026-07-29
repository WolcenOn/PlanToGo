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
  const recurringBuilder = document.querySelector("#recurring-builder");

  function mode() {
    return form.querySelector('input[name="schedule_mode"]:checked')?.value || "meetup";
  }

  function setVisible(node, visible) {
    if (!node) return;
    node.hidden = !visible;
    node.style.setProperty("display", visible ? "" : "none", visible ? "" : "important");
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

  function ensureTripInterval() {
    let row = rows.querySelector(".date-option-input");
    if (!row || !row.querySelector(".option-end")) {
      rows.innerHTML = "";
      row = document.createElement("div");
      row.className = "date-option-input compact-option trip-interval";
      row.innerHTML = '<label>Inicio del viaje<input type="datetime-local" class="option-start" required></label><label>Fin del viaje<input type="datetime-local" class="option-end" required></label>';
      rows.append(row);
    }
    [...rows.children].slice(1).forEach(node => node.remove());
    row.classList.add("trip-interval");
    row.querySelector(".remove-option")?.remove();
    const labels = row.querySelectorAll("label");
    if (labels[0]) labels[0].childNodes[0].textContent = "Inicio del viaje";
    if (labels[1]) labels[1].childNodes[0].textContent = "Fin del viaje";
  }

  function sync() {
    const current = mode();
    const recurring = current === "recurring";
    const trip = current === "trip";
    const meetupLike = !recurring && !trip;

    if (trip) planType.value = "flexible";

    setVisible(typeField, meetupLike);
    setVisible(fixedField, meetupLike && planType.value === "fixed");
    setVisible(flexibleField, trip || recurring || (meetupLike && planType.value === "flexible"));

    if (trip) ensureTripInterval();
    setVisible(rows, trip || (meetupLike && planType.value === "flexible"));
    setVisible(addButton, meetupLike && planType.value === "flexible");
    setVisible(builderHeading, meetupLike && planType.value === "flexible");
    setVisible(dateHelp, meetupLike && planType.value === "flexible");
    setVisible(recurringBuilder, recurring);

    form.elements.confirmed_date.required = meetupLike && planType.value === "fixed";
  }

  form.addEventListener("change", event => {
    if (event.target.matches('input[name="schedule_mode"], #plan-type')) queueMicrotask(sync);
  }, true);

  // Viaje admite un único intervalo inicio/fin. El formulario general exige dos
  // opciones porque las quedadas flexibles están pensadas para votación.
  form.addEventListener("submit", async event => {
    if (mode() !== "trip") return;
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
