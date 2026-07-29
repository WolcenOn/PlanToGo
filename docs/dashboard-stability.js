(() => {
  if (typeof participantMarkup === "function") {
    participantMarkup = function participantMarkupSafe(value) {
      const names = Array.isArray(value) ? value.filter(name => typeof name === "string" && name.trim()) : [];
      if (!names.length) return '<span class="participant-empty">Sin participantes todavía</span>';
      const visible = names.slice(0, 4).map(name => `<span class="participant-avatar" title="${escapeText(name)}">${escapeText(initials(name))}</span>`).join("");
      const extra = names.length > 4 ? `<span class="participant-more">+${names.length - 4}</span>` : "";
      return `<div class="participant-stack">${visible}${extra}</div><span class="participant-count">${names.length} ${names.length === 1 ? "persona" : "personas"}</span>`;
    };
  }

  if (typeof renderPlans === "function") {
    renderPlans = function renderPlansSafe() {
      const list = document.querySelector("#plans-list");
      if (!list) return;
      const plans = typeof filteredPlans === "function" ? filteredPlans() : [];
      list.innerHTML = "";
      const empty = document.querySelector("#plans-empty");
      if (empty) empty.hidden = plans.length > 0;
      for (const rawPlan of plans) {
        const plan = rawPlan || {};
        const card = document.createElement("article");
        card.className = `plan-card ${plan.ownership || "own"}`;
        if (plan.id) card.dataset.planId = plan.id;
        const date = plan.confirmed_date ? new Date(plan.confirmed_date) : null;
        const validDate = date && !Number.isNaN(date.getTime());
        const type = plan.type === "fixed" ? "fixed" : "flexible";
        const typeLabel = type === "flexible" ? (plan.status === "confirmed" ? "Fecha decidida" : `${Number(plan.date_option_count) || 0} opciones`) : "Fecha fija";
        card.innerHTML = `<div class="plan-tags"><span class="tag ${plan.ownership || "own"}">${plan.ownership === "friend" ? "De amigos" : "Plan propio"}</span><span class="tag ${type}">${typeLabel}</span></div><div><h3>${escapeText(plan.title || "Plan sin título")}</h3><p>${escapeText(plan.group_name || plan.location_name || "Sin grupo ni lugar")}</p></div><div class="plan-participants">${participantMarkup(plan.participants)}</div><div class="date-badge"><strong>${validDate ? new Intl.DateTimeFormat("es-ES", { day: "2-digit" }).format(date) : "?"}</strong><span>${validDate ? new Intl.DateTimeFormat("es-ES", { month: "short", hour: "2-digit", minute: "2-digit" }).format(date) : "Fecha por decidir"}</span></div>`;
        list.append(card);
      }
    };
  }

  if (typeof renderCalendar === "function") {
    const baseRenderCalendar = renderCalendar;
    renderCalendar = function renderCalendarWithPendingPlans() {
      baseRenderCalendar();
      const calendar = document.querySelector("#calendar");
      if (!calendar) return;
      const pending = (Array.isArray(state?.plans) ? state.plans : []).filter(plan => plan && !plan.confirmed_date);
      document.querySelector("#calendar-pending-plans")?.remove();
      if (!pending.length) return;
      const panel = document.createElement("section");
      panel.id = "calendar-pending-plans";
      panel.className = "calendar-pending-plans";
      panel.innerHTML = `<strong>Planes pendientes de fecha</strong><small>Se mostrarán en un día concreto cuando se confirme una opción.</small><div>${pending.map(plan => `<button type="button" data-pending-plan-id="${escapeText(plan.id || "")}">${escapeText(plan.title || "Plan sin título")} · ${Number(plan.date_option_count) || 0} opciones</button>`).join("")}</div>`;
      calendar.before(panel);
    };
    document.querySelector("#calendar-section")?.addEventListener("click", event => {
      const button = event.target.closest("[data-pending-plan-id]");
      if (button && typeof openPlanDetail === "function") openPlanDetail(button.dataset.pendingPlanId);
    });
  }
})();