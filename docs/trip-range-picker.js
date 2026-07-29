(() => {
  const form = document.querySelector("#plan-form");
  const planType = document.querySelector("#plan-type");
  const flexibleField = document.querySelector("#flexible-dates-field");
  const rows = document.querySelector("#date-option-inputs");
  if (!form || !planType || !flexibleField || !rows) return;

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

  function activate(control) {
    if (!control) return;
    control.disabled = false;
    control.removeAttribute("disabled");
    control.style.pointerEvents = "auto";
  }

  function createTripRow() {
    const row = document.createElement("div");
    row.className = "date-option-input compact-option trip-interval";
    row.innerHTML = '<label>Inicio del viaje<input type="datetime-local" class="option-start" required></label><label>Fin del viaje<input type="datetime-local" class="option-end" required></label><button type="button" class="icon-button remove-option" aria-label="Eliminar intervalo">×</button>';
    row.querySelector(".remove-option").addEventListener("click", () => {
      const minimum = planType.value === "flexible" ? 2 : 1;
      if (rows.children.length > minimum) row.remove();
    });
    rows.append(row);
    return row;
  }

  function ensureRows() {
    if (!isTrip()) return;
    flexibleField.hidden = false;
    flexibleField.style.removeProperty("display");
    rows.hidden = false;
    rows.style.removeProperty("display");
    const minimum = planType.value === "flexible" ? 2 : 1;
    while (rows.querySelectorAll(".trip-interval").length < minimum) createTripRow();
    if (planType.value === "fixed") [...rows.querySelectorAll(".trip-interval")].slice(1).forEach(row => row.remove());
    rows.querySelectorAll("input, button").forEach(activate);
  }

  function openNativePicker(input) {
    activate(input);
    input.focus({ preventScroll: true });
    if (typeof input.showPicker === "function") input.showPicker();
    else input.click();
  }

  function enhanceRow(row) {
    if (!row || row.dataset.rangePickerEnhanced === "true") return;
    const startInput = row.querySelector(".option-start");
    const endInput = row.querySelector(".option-end");
    if (!startInput || !endInput) return;
    activate(startInput);
    activate(endInput);

    const picker = document.createElement("div");
    picker.className = "trip-range-picker";
    picker.innerHTML = `
      <div class="trip-range-picker-heading"><strong>Selecciona el intervalo</strong><small>Elige salida y regreso como al reservar un viaje.</small></div>
      <div class="trip-range-picker-grid">
        <label>Fecha de salida<div class="trip-date-control"><input type="date" class="trip-range-start-date"><button type="button" class="secondary-button open-start-date">Abrir calendario</button></div></label>
        <label>Fecha de regreso<div class="trip-date-control"><input type="date" class="trip-range-end-date"><button type="button" class="secondary-button open-end-date">Abrir calendario</button></div></label>
      </div>
      <div class="trip-range-summary" aria-live="polite">Selecciona salida y regreso.</div>`;

    const startDate = picker.querySelector(".trip-range-start-date");
    const endDate = picker.querySelector(".trip-range-end-date");
    const summary = picker.querySelector(".trip-range-summary");
    [startDate, endDate].forEach(activate);

    function renderSummary() {
      if (!startDate.value || !endDate.value) {
        summary.textContent = "Selecciona salida y regreso.";
        return;
      }
      const start = new Date(`${startDate.value}T00:00`);
      const end = new Date(`${endDate.value}T00:00`);
      const nights = Math.max(0, Math.round((end - start) / 86400000));
      const formatter = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" });
      summary.textContent = `${formatter.format(start)} → ${formatter.format(end)} · ${nights} ${nights === 1 ? "noche" : "noches"}`;
    }

    function syncPickerToFields() {
      activate(startInput);
      activate(endInput);
      if (startDate.value) endDate.min = startDate.value;
      if (startDate.value && endDate.value && endDate.value < startDate.value) endDate.value = startDate.value;
      const startTime = parts(startInput.value).time || "09:00";
      const endTime = parts(endInput.value).time || "18:00";
      startInput.value = combine(startDate.value, startTime);
      endInput.value = combine(endDate.value, endTime);
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

    startDate.addEventListener("input", syncPickerToFields);
    startDate.addEventListener("change", syncPickerToFields);
    endDate.addEventListener("input", syncPickerToFields);
    endDate.addEventListener("change", syncPickerToFields);
    startInput.addEventListener("change", syncFieldsToPicker);
    endInput.addEventListener("change", syncFieldsToPicker);
    picker.querySelector(".open-start-date").addEventListener("click", () => openNativePicker(startDate));
    picker.querySelector(".open-end-date").addEventListener("click", () => openNativePicker(endDate));

    row.prepend(picker);
    row.classList.add("range-enhanced");
    row.dataset.rangePickerEnhanced = "true";
    syncFieldsToPicker();
  }

  function sync() {
    if (!isTrip()) return;
    ensureRows();
    rows.querySelectorAll(".trip-interval").forEach(enhanceRow);
    rows.querySelectorAll("input, button").forEach(activate);
  }

  form.addEventListener("change", event => {
    if (event.target.matches('input[name="schedule_mode"], #plan-type')) queueMicrotask(sync);
  }, true);
  document.querySelector("#new-plan-button")?.addEventListener("click", () => setTimeout(sync, 0));
  new MutationObserver(() => queueMicrotask(sync)).observe(rows, { childList: true, subtree: true });
  queueMicrotask(sync);
})();