(() => {
  const form = document.querySelector("#plan-form");
  const planType = document.querySelector("#plan-type");
  if (!form || !planType) return;

  const isFixedTrip = () => planType.value === "fixed" && form.querySelector('input[name="schedule_mode"]:checked')?.value === "trip";

  form.addEventListener("submit", async event => {
    if (!isFixedTrip()) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const intervals = [...form.querySelectorAll("#date-option-inputs .trip-interval")];
    const row = intervals[0];
    const startValue = row?.querySelector(".option-start")?.value;
    const endValue = row?.querySelector(".option-end")?.value;
    const start = startValue ? new Date(startValue) : null;
    const end = endValue ? new Date(endValue) : null;

    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setStatus("Selecciona una salida y un regreso válidos.", true);
      return;
    }

    const data = Object.fromEntries(new FormData(form));
    data.type = "fixed";
    data.confirmed_date = start.toISOString();
    data.date_options = [{ start_time: start.toISOString(), end_time: end.toISOString() }];
    data.group_ids = [...document.querySelectorAll("#plan-group-options input:checked")].map(input => input.value);
    data.tasks = window.PlanWizard?.getTasks?.() || [];

    setStatus("Creando viaje…");
    try {
      const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      saveProfile({ name: data.creator_name, email: data.creator_email });
      state.calendarDate = new Date(start);
      const link = publicURL(body.public_token);
      statusNode.innerHTML = `Viaje creado. <a href="${link}">Abrir enlace para compartir</a>`;
      await navigator.clipboard?.writeText(link).catch(() => {});
      await loadDashboard();
      document.querySelector("#calendar-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      await window.PlanSharing?.afterCreate?.({ title: data.title }, link);
    } catch (error) {
      setStatus(error.message === "Failed to fetch" ? "No se pudo conectar con Railway." : error.message, true);
    }
  }, true);
})();