(() => {
  const palette = ["#2563eb", "#7c3aed", "#db2777", "#ea580c", "#059669", "#0891b2", "#4f46e5", "#65a30d"];

  function groupColor(groupID) {
    if (!groupID) return "#64748b";
    let hash = 0;
    for (const char of String(groupID)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return palette[hash % palette.length];
  }

  function taskSummary(plan) {
    const mine = Number(plan.my_pending_task_count || 0);
    const open = Number(plan.open_pending_task_count || 0);
    const total = Number(plan.pending_task_count || 0);
    if (!total) return '<div class="plan-task-summary done"><strong>✓</strong><span>Sin tareas pendientes</span></div>';
    return `<div class="plan-task-summary"><span><strong>${mine}</strong> para ti</span><span><strong>${open}</strong> sin asignar</span><span><strong>${total}</strong> pendientes</span></div>`;
  }

  const previousRenderPlans = renderPlans;
  renderPlans = function renderPlansRefined() {
    previousRenderPlans();
    const plans = filteredPlans();
    document.querySelectorAll("#plans-list .plan-card").forEach((card, index) => {
      const plan = plans[index];
      if (!plan) return;
      const color = groupColor(plan.group_id);
      card.style.setProperty("--group-color", color);
      card.dataset.groupColor = color;
      if (plan.group_id) card.classList.add("has-group-color");
      if (!card.querySelector(".plan-task-summary")) {
        const dateBadge = card.querySelector(".date-badge");
        dateBadge?.insertAdjacentHTML("beforebegin", taskSummary(plan));
      }
    });
  };

  const previousRenderGroups = renderGroups;
  renderGroups = function renderGroupsRefined() {
    previousRenderGroups();
    document.querySelectorAll("#groups-list .group-card").forEach((card, index) => {
      const group = state.groups[index];
      if (!group) return;
      const color = groupColor(group.id);
      card.style.setProperty("--group-color", color);
      card.querySelector(".group-avatar")?.style.setProperty("background", color);
      card.querySelector(".group-avatar")?.style.setProperty("color", "#fff");
    });
  };

  const previousEventMarkup = eventMarkup;
  eventMarkup = function eventMarkupWithGroup(plan) {
    const color = groupColor(plan.group_id);
    return `<div class="calendar-event ${plan.ownership}" style="--group-color:${color}"><i></i><span>${escapeText(plan.title)}</span></div>`;
  };

  function activateSummary(card, action) {
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.addEventListener("click", action);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        action();
      }
    });
  }

  const statCards = [...document.querySelectorAll(".stat-card")];
  if (statCards[0]) activateSummary(statCards[0], () => document.querySelector("#calendar-section")?.scrollIntoView({ behavior: "smooth" }));
  if (statCards[1]) activateSummary(statCards[1], () => {
    state.filter = "own";
    document.querySelector('[data-filter="own"]')?.click();
    document.querySelector("#plans-section")?.scrollIntoView({ behavior: "smooth" });
  });
  if (statCards[2]) activateSummary(statCards[2], () => {
    state.filter = "friend";
    document.querySelector('[data-filter="friend"]')?.click();
    document.querySelector("#plans-section")?.scrollIntoView({ behavior: "smooth" });
  });
  if (statCards[3]) activateSummary(statCards[3], () => document.querySelector("#groups-section")?.scrollIntoView({ behavior: "smooth" }));

  if (state.plans?.length || state.groups?.length) renderDashboard();
})();
