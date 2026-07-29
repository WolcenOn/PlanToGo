(() => {
  const form = document.querySelector("#plan-form");
  const planType = document.querySelector("#plan-type");
  const flexibleField = document.querySelector("#flexible-dates-field");
  const fixedField = document.querySelector("#fixed-date-field");
  const rows = document.querySelector("#date-option-inputs");
  if (!form || !planType || !flexibleField || !fixedField || !rows) return;

  const mode = () => form.querySelector('input[name="schedule_mode"]:checked')?.value || "meetup";
  const isTrip = () => mode() === "trip";
  const pad = value => String(value).padStart(2, "0");
  const localDate = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const parts = value => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return { date: "", time: "09:00" };
    return { date: localDate(date), time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
  };
  const combine = (date, time) => date ? `${date}T${time || "09:00"}` : "";

  function createTripRow() {
    const row = document.createElement("div");
    row.className = "date-option-input compact-option trip-interval";
    row.innerHTML = '<label>Inicio del viaje<input type="datetime-local" class="option-start" required></label><label>Fin del viaje<input type="datetime-local" class="option-end" required></label><button type="button" class="icon-button remove-option" aria-label="Eliminar intervalo">×</button>';
    row.querySelector(".remove-option").addEventListener("click", () => {
      const minimum = planType.value === "flexible" ? 2 : 1;
      if (rows.querySelectorAll(".trip-interval").length > minimum) row.remove();
    });
    rows.append(row);
    return row;
  }

  function ensureRows() {
    if (!isTrip()) return;
    fixedField.hidden = true;
    fixedField.style.setProperty("display", "none", "important");
    fixedField.querySelectorAll("input,select,textarea,button").forEach(control => { control.disabled = true; });

    flexibleField.hidden = false;
    flexibleField.style.removeProperty("display");
    flexibleField.querySelectorAll("input,select,textarea,button").forEach(control => { control.disabled = false; });
    rows.hidden = false;
    rows.style.removeProperty("display");

    const minimum = planType.value === "flexible" ? 2 : 1;
    while (rows.querySelectorAll(".trip-interval").length < minimum) createTripRow();
    if (planType.value === "fixed") [...rows.querySelectorAll(".trip-interval")].slice(1).forEach(row => row.remove());
  }

  function enhanceRow(row) {
    if (!row) return;
    row.querySelectorAll(":scope > .trip-range-picker").forEach((picker, index) => { if (index > 0) picker.remove(); });
    if (row.dataset.rangePickerEnhanced === "true" && row.querySelector(":scope > .trip-range-picker")) return;

    const startInput = row.querySelector(".option-start");
    const endInput = row.querySelector(".option-end");
    if (!startInput || !endInput) return;
    startInput.disabled = false;
    endInput.disabled = false;

    row.querySelector(":scope > .trip-range-picker")?.remove();
    const picker = document.createElement("div");
    picker.className = "trip-range-picker";
    picker.innerHTML = `
      <div class="trip-range-picker-heading"><strong>Selecciona el intervalo</strong><small>Elige salida y regreso como al reservar un viaje.</small></div>
      <div class="trip-range-picker-grid">
        <label>Fecha de salida<input type="date" class="trip-range-start-date"><button type="button" class="secondary-button open-start-picker">Abrir calendario</button></label>
        <label>Fecha de regreso<input type="date" class="trip-range-end-date"><button type="button" class="secondary-button open-end-picker">Abrir calendario</button></label>
      </div>
      <div class="trip-range-summary" aria-live="polite">Selecciona salida y regreso.</div>`;

    const startDate = picker.querySelector(".trip-range-start-date");
    const endDate = picker.querySelector(".trip-range-end-date");
    const summary = picker.querySelector(".trip-range-summary");
    startDate.disabled = false;
    endDate.disabled = false;

    function renderSummary() {
      if (!startDate.value || !endDate.value) { summary.textContent = "Selecciona salida y regreso."; return; }
      const start = new Date(`${startDate.value}T00:00`);
      const end = new Date(`${endDate.value}T00:00`);
      const nights = Math.max(0, Math.round((end - start) / 86400000));
      const formatter = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" });
      summary.textContent = `${formatter.format(start)} → ${formatter.format(end)} · ${nights} ${nights === 1 ? "noche" : "noches"}`;
    }

    function syncPickerToFields() {
      if (startDate.value) endDate.min = startDate.value;
      if (startDate.value && endDate.value && endDate.value < startDate.value) endDate.value = startDate.value;
      startInput.value = combine(startDate.value, parts(startInput.value).time || "09:00");
      endInput.value = combine(endDate.value, parts(endInput.value).time || "18:00");
      startInput.dispatchEvent(new Event("change", { bubbles: true }));
      endInput.dispatchEvent(new Event("change", { bubbles: true }));
      renderSummary();
    }

    function syncFieldsToPicker() {
      startDate.value = parts(startInput.value).date;
      endDate.value = parts(endInput.value).date;
      if (startDate.value) endDate.min = startDate.value;
      renderSummary();
    }

    startDate.addEventListener("change", syncPickerToFields);
    endDate.addEventListener("change", syncPickerToFields);
    startInput.addEventListener("change", syncFieldsToPicker);
    endInput.addEventListener("change", syncFieldsToPicker);
    picker.querySelector(".open-start-picker").addEventListener("click", () => startDate.showPicker?.() || startDate.focus());
    picker.querySelector(".open-end-picker").addEventListener("click", () => endDate.showPicker?.() || endDate.focus());

    row.prepend(picker);
    row.classList.add("range-enhanced");
    row.dataset.rangePickerEnhanced = "true";
    syncFieldsToPicker();
  }

  function sync() {
    if (!isTrip()) return;
    ensureRows();
    rows.querySelectorAll(".trip-interval").forEach(enhanceRow);
  }

  form.addEventListener("change", event => {
    if (event.target.matches('input[name="schedule_mode"], #plan-type')) queueMicrotask(sync);
  }, true);
  new MutationObserver(() => queueMicrotask(sync)).observe(rows, { childList: true });
  queueMicrotask(sync);
})();