(() => {
  const form = document.querySelector("#plan-form");
  const planType = document.querySelector("#plan-type");
  const rows = document.querySelector("#date-option-inputs");
  if (!form || !planType || !rows) return;

  const mode = () => form.querySelector('input[name="schedule_mode"]:checked')?.value || "meetup";
  const isTrip = () => mode() === "trip";
  const pad = value => String(value).padStart(2, "0");
  const toDateInput = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const dateTimeParts = value => {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return { date: "", time: "09:00" };
    return { date: toDateInput(date), time: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
  };
  const combine = (date, time) => date ? `${date}T${time || "09:00"}` : "";

  function enhanceRow(row) {
    if (!row || row.dataset.rangePickerEnhanced === "true") return;
    const startInput = row.querySelector(".option-start");
    const endInput = row.querySelector(".option-end");
    if (!startInput || !endInput) return;

    const startParts = dateTimeParts(startInput.value);
    const endParts = dateTimeParts(endInput.value);
    const picker = document.createElement("div");
    picker.className = "trip-range-picker";
    picker.innerHTML = `
      <div class="trip-range-picker-heading"><strong>Selecciona el intervalo</strong><small>Elige la fecha de salida y la fecha de regreso.</small></div>
      <div class="trip-range-picker-grid">
        <label>Salida<input type="date" class="trip-range-start-date" value="${startParts.date}"></label>
        <label>Regreso<input type="date" class="trip-range-end-date" value="${endParts.date}"></label>
      </div>
      <div class="trip-range-summary" aria-live="polite"></div>`;

    const startDate = picker.querySelector(".trip-range-start-date");
    const endDate = picker.querySelector(".trip-range-end-date");
    const summary = picker.querySelector(".trip-range-summary");

    function syncFromPicker() {
      if (startDate.value) endDate.min = startDate.value;
      if (startDate.value && endDate.value && endDate.value < startDate.value) endDate.value = startDate.value;
      const startTime = dateTimeParts(startInput.value).time;
      const endTime = dateTimeParts(endInput.value).time || "18:00";
      startInput.value = combine(startDate.value, startTime);
      endInput.value = combine(endDate.value, endTime);
      if (startDate.value && endDate.value) {
        const start = new Date(`${startDate.value}T00:00`);
        const end = new Date(`${endDate.value}T00:00`);
        const nights = Math.max(0, Math.round((end - start) / 86400000));
        const formatter = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric" });
        summary.textContent = `${formatter.format(start)} → ${formatter.format(end)} · ${nights} ${nights === 1 ? "noche" : "noches"}`;
      } else {
        summary.textContent = "Selecciona salida y regreso para ver el intervalo.";
      }
      startInput.dispatchEvent(new Event("change", { bubbles: true }));
      endInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    function syncFromInputs() {
      const start = dateTimeParts(startInput.value);
      const end = dateTimeParts(endInput.value);
      startDate.value = start.date;
      endDate.value = end.date;
      syncFromPicker();
    }

    startDate.addEventListener("change", syncFromPicker);
    endDate.addEventListener("change", syncFromPicker);
    startInput.addEventListener("change", syncFromInputs);
    endInput.addEventListener("change", syncFromInputs);

    row.prepend(picker);
    row.dataset.rangePickerEnhanced = "true";
    syncFromPicker();
  }

  function ensureTripFixedRow() {
    if (!isTrip() || planType.value !== "fixed") return;
    const row = rows.querySelector(".trip-interval") || rows.querySelector(".date-option-input");
    if (row) enhanceRow(row);
  }

  function enhanceAll() {
    if (!isTrip()) return;
    rows.querySelectorAll(".trip-interval, .date-option-input").forEach(enhanceRow);
    ensureTripFixedRow();
  }

  form.addEventListener("change", event => {
    if (event.target.matches('input[name="schedule_mode"], #plan-type')) queueMicrotask(enhanceAll);
  }, true);
  new MutationObserver(() => queueMicrotask(enhanceAll)).observe(rows, { childList: true, subtree: true });
  queueMicrotask(enhanceAll);
})();
