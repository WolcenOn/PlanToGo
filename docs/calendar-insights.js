(() => {
  const planDetails = new Map();
  const groupDetails = new Map();
  let enriching = false;

  window.PlanInsights = { planDetails, groupDetails };

  function score(option = {}) {
    return (Number(option.yes) || 0) * 2 + (Number(option.maybe) || 0);
  }

  function isConfirmed(plan) {
    return plan?.status === "confirmed";
  }

  function bestOption(plan) {
    const detail = planDetails.get(plan?.id);
    const options = Array.isArray(detail?.date_options) ? detail.date_options : [];
    return options.reduce((best, option) => !best || score(option) > score(best) ? option : best, null);
  }

  function matchingConfirmedOption(plan) {
    if (!plan?.confirmed_date) return null;
    const confirmed = new Date(plan.confirmed_date).getTime();
    const detail = planDetails.get(plan.id);
    return (detail?.date_options || []).find(option => Math.abs(new Date(option.start_time).getTime() - confirmed) < 60000) || null;
  }

  function displayedOption(plan) {
    return isConfirmed(plan) ? matchingConfirmedOption(plan) : bestOption(plan);
  }

  function planRange(plan) {
    const option = displayedOption(plan);
    const startValue = option?.start_time || plan?.confirmed_date;
    if (!startValue) return null;
    const start = new Date(startValue);
    const end = new Date(option?.end_time || startValue);
    if (Number.isNaN(start.getTime())) return null;
    if (Number.isNaN(end.getTime()) || end < start) return { start, end: start };
    return { start, end };
  }

  function dayStart(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function sameDay(a, b) {
    return dayStart(a).getTime() === dayStart(b).getTime();
  }

  function groupHue(plan) {
    const seed = String(plan?.group_id || plan?.group_name || plan?.ownership || "PlanToGo");
    let hash = 0;
    for (const char of seed) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return Math.abs(hash) % 360;
  }

  function formatRange(option) {
    if (!option?.start_time) return "Sin propuesta destacada";
    const start = new Date(option.start_time);
    const end = new Date(option.end_time || option.start_time);
    const same = sameDay(start, end);
    const startText = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(start);
    const endText = new Intl.DateTimeFormat("es-ES", same ? { hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(end);
    return `${startText} – ${endText}`;
  }

  function voteNames(option) {
    const values = option?.voters || option?.availability || option?.votes || [];
    if (!Array.isArray(values)) return [];
    return values.map(item => typeof item === "string" ? { name: item, vote: "yes" } : {
      name: item?.name || item?.guest_name || item?.user_name || "Participante",
      vote: item?.vote || item?.availability || item?.value || "yes"
    });
  }

  async function enrichDashboard() {
    if (enriching || !state?.profile?.email) return;
    enriching = true;
    try {
      await Promise.all((state.plans || []).map(async plan => {
        try {
          const detail = await fetchJSON(`${API_BASE_URL}/api/v1/plans/${encodeURIComponent(plan.id)}?email=${encodeURIComponent(state.profile.email)}`);
          planDetails.set(plan.id, detail);
        } catch (_) {}
      }));
      await Promise.all((state.groups || []).map(async group => {
        try {
          const detail = await fetchJSON(`${API_BASE_URL}/api/v1/groups/${encodeURIComponent(group.id)}?email=${encodeURIComponent(state.profile.email)}`);
          groupDetails.set(group.id, detail);
        } catch (_) {}
      }));
      renderDashboard();
    } finally {
      enriching = false;
    }
  }

  const originalLoadDashboard = loadDashboard;
  loadDashboard = async function loadDashboardWithInsights() {
    await originalLoadDashboard();
    await enrichDashboard();
  };

  plansForDate = function plansForDateWithRanges(date) {
    const target = dayStart(date).getTime();
    return (state.plans || []).filter(plan => {
      const range = planRange(plan);
      if (!range) return false;
      const start = dayStart(range.start).getTime();
      const end = dayStart(range.end).getTime();
      if (target < start || target > end) return false;
      plan._calendarPending = !isConfirmed(plan);
      plan._calendarHue = groupHue(plan);
      plan._calendarSegment = start === end ? "single" : target === start ? "start" : target === end ? "end" : "middle";
      return true;
    });
  };

  eventMarkup = function eventMarkupWithRange(plan) {
    const segment = plan._calendarSegment || "single";
    const pending = plan._calendarPending ? " pending" : " confirmed";
    const label = segment === "middle" || segment === "end" ? "" : escapeText(plan.title || "Plan");
    const status = plan._calendarPending ? " · por confirmar" : " · confirmado";
    return `<div class="calendar-event ${plan.ownership || "own"} range-${segment}${pending}" style="--group-hue:${plan._calendarHue || groupHue(plan)}" title="${escapeText(plan.title || "Plan")}${status}" data-plan-id="${escapeText(plan.id || "")}"><i></i><span>${label}</span></div>`;
  };

  const originalRenderPlans = renderPlans;
  renderPlans = function renderPlansWithInsights() {
    originalRenderPlans();
    const plans = filteredPlans();
    const pendingCount = (state.plans || []).filter(plan => !isConfirmed(plan)).length;
    const title = document.querySelector("#plans-section h2");
    if (title) title.innerHTML = `Tus próximos planes${pendingCount ? `<span class="pending-alert" title="${pendingCount} planes por confirmar"><i></i>${pendingCount}</span>` : ""}`;

    document.querySelectorAll("#plans-list .plan-card").forEach((card, index) => {
      const plan = plans[index];
      if (!plan) return;
      card.dataset.planId = plan.id || "";
      const tags = card.querySelector(".plan-tags");
      if (!isConfirmed(plan) && tags && !tags.querySelector(".tag.pending-date")) tags.insertAdjacentHTML("beforeend", '<span class="tag pending-date"><i></i>Por confirmar</span>');
      const option = displayedOption(plan);
      if (option) {
        const badge = card.querySelector(".date-badge");
        const caption = isConfirmed(plan) ? "Intervalo fijado" : "Más votada";
        if (badge) badge.innerHTML = `<strong>${isConfirmed(plan) ? "✓" : "★"}</strong><span><small>${caption}</small>${escapeText(formatRange(option))}</span>`;
      }
    });
  };

  const originalRenderGroups = renderGroups;
  renderGroups = function renderGroupsWithMembers() {
    originalRenderGroups();
    document.querySelectorAll("#groups-list .group-card").forEach((card, index) => {
      const group = state.groups[index];
      if (!group) return;
      const detail = groupDetails.get(group.id);
      const members = Array.isArray(detail?.members) ? detail.members : [];
      if (!members.length) return;
      const names = members.slice(0, 5).map(member => member.name || member.user_name || member.email || "Miembro");
      const extra = members.length > 5 ? ` +${members.length - 5}` : "";
      card.insertAdjacentHTML("beforeend", `<div class="group-card-members"><div class="member-mini-stack">${names.map(name => `<span title="${escapeText(name)}">${escapeText(initials(name))}</span>`).join("")}</div><small>${escapeText(names.join(", "))}${extra}</small></div>`);
    });
  };

  const originalRenderPlanDetail = renderPlanDetail;
  renderPlanDetail = function renderPlanDetailWithVotingInsights() {
    originalRenderPlanDetail();
    if (!currentDetail) return;
    planDetails.set(currentDetail.id, currentDetail);
    const options = currentDetail.date_options || [];
    const voting = document.querySelector("#detail-voting");
    if (voting && options.length) voting.hidden = false;

    detailOptions.querySelectorAll(".detail-option").forEach((row, index) => {
      const option = options[index];
      if (!option) return;
      const names = voteNames(option);
      if (names.length) {
        const groups = ["yes", "maybe", "no"].map(value => {
          const voters = names.filter(item => item.vote === value).map(item => item.name);
          return voters.length ? `<span><strong>${value === "yes" ? "Sí" : value === "maybe" ? "Quizá" : "No"}:</strong> ${escapeText(voters.join(", "))}</span>` : "";
        }).join("");
        row.insertAdjacentHTML("beforeend", `<div class="option-voter-names">${groups}</div>`);
      }
      if (currentDetail.is_owner && currentDetail.status !== "confirmed") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button confirm-option-button";
        button.dataset.optionIndex = String(index);
        button.textContent = "Fijar este intervalo";
        row.append(button);
      }
    });
  };

  detailOptions?.addEventListener("click", async event => {
    const button = event.target.closest(".confirm-option-button");
    if (!button || !currentDetail?.is_owner || button.dataset.confirming === "true") return;
    const option = currentDetail.date_options?.[Number(button.dataset.optionIndex)];
    if (!option || !confirm(`¿Fijar ${formatRange(option)} como intervalo definitivo?`)) return;
    button.dataset.confirming = "true";
    button.disabled = true;
    const previousText = button.textContent;
    button.textContent = "Fijando…";
    try {
      await fetchJSON(`${API_BASE_URL}/api/v1/plans/${encodeURIComponent(currentDetail.id)}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creator_email: state.profile.email, option_id: option.id })
      });
      planDetails.delete(currentDetail.id);
      setDetailStatus("Intervalo fijado correctamente.");
      await loadDashboard();
      await openPlanDetail(currentDetail.id);
    } catch (error) {
      button.dataset.confirming = "false";
      button.disabled = false;
      button.textContent = previousText;
      setDetailStatus(error.message, true);
    }
  });

  document.querySelector("#calendar")?.addEventListener("click", event => {
    const item = event.target.closest(".calendar-event[data-plan-id]");
    if (item?.dataset.planId) openPlanDetail(item.dataset.planId);
  });

  queueMicrotask(() => enrichDashboard());
})();