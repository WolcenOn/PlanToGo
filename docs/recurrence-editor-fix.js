document.addEventListener("click", async event => {
  const button = event.target.closest('[data-occurrence-action="edit"]');
  if (!button || typeof currentDetail === "undefined" || !currentDetail?.id) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const row = button.closest("[data-occurrence-id]");
  const occurrenceID = row.dataset.occurrenceId;
  try {
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}/recurrence?email=${encodeURIComponent(state.profile.email)}`);
    const occurrence = (body.occurrences || []).find(item => item.id === occurrenceID);
    if (!occurrence) throw new Error("No se encontró la sesión.");
    const toLocal = value => {
      const date = new Date(value);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    };
    const start = prompt("Nuevo comienzo (AAAA-MM-DDTHH:MM)", toLocal(occurrence.starts_at));
    if (!start) return;
    const end = prompt("Nuevo final (AAAA-MM-DDTHH:MM)", toLocal(occurrence.ends_at));
    if (!end) return;
    await fetchJSON(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}/occurrences/${occurrenceID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor_email: state.profile.email, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() })
    });
    await openPlanDetail(currentDetail.id);
    await loadDashboard();
  } catch (error) {
    document.querySelector("#detail-status").textContent = error.message;
  }
}, true);
