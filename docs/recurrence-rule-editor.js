(() => {
  const weekdays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  let installed = false;

  function ensureEditor() {
    let panel = document.querySelector("#recurrence-rule-editor");
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "recurrence-rule-editor";
    panel.className = "detail-section recurrence-rule-editor";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="section-heading"><div><p class="eyebrow">Programación semanal</p><h3>Editar días y horarios</h3></div></div>
      <p class="field-help">Activa o desactiva días individualmente. Cada día conserva su propio horario.</p>
      <div class="recurrence-range">
        <label>Desde<input type="date" data-series-from></label>
        <label>Hasta<input type="date" data-series-to></label>
      </div>
      <div class="recurrence-rule-list" data-rule-list>
        ${weekdays.map((name, index) => `<label class="recurrence-rule"><input type="checkbox" data-weekday="${index + 1}"><span>${name}</span><span class="time-field"><small>Empieza</small><input type="time" data-start value="17:00"></span><span class="time-field"><small>Termina</small><input type="time" data-end value="18:00"></span></label>`).join("")}
      </div>
      <div class="dialog-actions"><button type="button" class="primary-button" data-save-recurrence>Guardar programación</button></div>`;
    document.querySelector("#detail-voting")?.before(panel);
    return panel;
  }

  async function loadEditor(planID) {
    const panel = ensureEditor();
    if (!panel || !currentDetail?.is_owner) { if (panel) panel.hidden = true; return; }
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans/${encodeURIComponent(planID)}/recurrence?email=${encodeURIComponent(state.profile.email)}`);
    const rules = Array.isArray(body.rules) ? body.rules : [];
    panel.hidden = rules.length === 0 && !(body.starts_on && body.ends_on);
    if (panel.hidden) return;
    panel.querySelector("[data-series-from]").value = body.starts_on || "";
    panel.querySelector("[data-series-to]").value = body.ends_on || "";
    const byDay = new Map(rules.map(rule => [Number(rule.weekday), rule]));
    panel.querySelectorAll("[data-weekday]").forEach(box => {
      const rule = byDay.get(Number(box.dataset.weekday));
      box.checked = Boolean(rule);
      const row = box.closest(".recurrence-rule");
      row.querySelector("[data-start]").value = rule?.start_time || "17:00";
      row.querySelector("[data-end]").value = rule?.end_time || "18:00";
      row.classList.toggle("active", box.checked);
    });
  }

  async function saveEditor() {
    const panel = ensureEditor();
    if (!currentDetail?.id || !currentDetail?.is_owner) return;
    const rules = [...panel.querySelectorAll("[data-weekday]:checked")].map(box => {
      const row = box.closest(".recurrence-rule");
      return { weekday: Number(box.dataset.weekday), start_time: row.querySelector("[data-start]").value, end_time: row.querySelector("[data-end]").value };
    });
    const payload = {
      actor_email: state.profile.email,
      starts_on: panel.querySelector("[data-series-from]").value,
      ends_on: panel.querySelector("[data-series-to]").value,
      timezone: "Europe/Madrid",
      rules
    };
    if (!payload.starts_on || !payload.ends_on || !rules.length) throw new Error("Selecciona el periodo y al menos un día semanal.");
    if (payload.ends_on < payload.starts_on) throw new Error("La fecha final no puede ser anterior a la inicial.");
    if (rules.some(rule => !rule.start_time || !rule.end_time || rule.end_time <= rule.start_time)) throw new Error("Cada día necesita una hora final posterior.");
    await fetchJSON(`${API_BASE_URL}/api/v1/plans/${encodeURIComponent(currentDetail.id)}/recurrence`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setDetailStatus("Programación semanal actualizada.");
    await loadDashboard();
    await openPlanDetail(currentDetail.id);
  }

  document.addEventListener("change", event => {
    const box = event.target.closest("#recurrence-rule-editor [data-weekday]");
    if (box) box.closest(".recurrence-rule")?.classList.toggle("active", box.checked);
  });

  document.addEventListener("click", async event => {
    const save = event.target.closest("[data-save-recurrence]");
    if (save) {
      event.preventDefault();
      save.disabled = true;
      try { await saveEditor(); } catch (error) { setDetailStatus(error.message, true); } finally { save.disabled = false; }
      return;
    }
    const occurrenceButton = event.target.closest("[data-occurrence-action]");
    if (!occurrenceButton || !currentDetail?.id) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const row = occurrenceButton.closest("[data-occurrence-id]");
    const occurrenceID = row?.dataset.occurrenceId;
    if (!occurrenceID) return;
    try {
      if (occurrenceButton.dataset.occurrenceAction === "delete") {
        if (!confirm("¿Omitir solo esta sesión? La programación semanal no cambiará.")) return;
        const response = await fetch(`${API_BASE_URL}/api/v1/plans/${encodeURIComponent(currentDetail.id)}/occurrences/${encodeURIComponent(occurrenceID)}?email=${encodeURIComponent(state.profile.email)}`, { method: "DELETE" });
        if (!response.ok) throw new Error("No se pudo omitir la sesión.");
      } else {
        const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans/${encodeURIComponent(currentDetail.id)}/recurrence?email=${encodeURIComponent(state.profile.email)}`);
        const item = (body.occurrences || []).find(value => value.id === occurrenceID || value.occurrence_id === occurrenceID);
        if (!item) throw new Error("No se encontró la sesión.");
        const local = value => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
        const start = prompt("Nuevo comienzo (AAAA-MM-DDTHH:MM)", local(item.starts_at)); if (!start) return;
        const end = prompt("Nuevo final (AAAA-MM-DDTHH:MM)", local(item.ends_at)); if (!end) return;
        await fetchJSON(`${API_BASE_URL}/api/v1/plans/${encodeURIComponent(currentDetail.id)}/occurrences/${encodeURIComponent(occurrenceID)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor_email: state.profile.email, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() }) });
      }
      await loadDashboard();
      await openPlanDetail(currentDetail.id);
    } catch (error) { setDetailStatus(error.message, true); }
  }, true);

  function install() {
    if (installed || typeof openPlanDetail !== "function") return false;
    installed = true;
    const baseOpen = openPlanDetail;
    openPlanDetail = async function openPlanDetailWithRuleEditor(planID) {
      await baseOpen(planID);
      try { await loadEditor(planID); } catch (_) { const panel = ensureEditor(); if (panel) panel.hidden = true; }
    };
    return true;
  }

  if (!install()) {
    const timer = setInterval(() => { if (install()) clearInterval(timer); }, 100);
    setTimeout(() => clearInterval(timer), 10000);
  }
})();
