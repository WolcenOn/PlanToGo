const detailDialog = document.querySelector("#plan-detail-dialog");
const detailForm = document.querySelector("#detail-edit-form");
const detailStatus = document.querySelector("#detail-status");
const detailTasks = document.querySelector("#detail-tasks");
const detailOptions = document.querySelector("#detail-options");
let currentDetail = null;

function localDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function setDetailStatus(message, isError = false) {
  detailStatus.textContent = message;
  detailStatus.classList.toggle("error", isError);
}

async function openPlanDetail(planID) {
  if (!state.profile?.email) return;
  setDetailStatus("Cargando ficha…");
  if (!detailDialog.open) {
    if (detailDialog.showModal) detailDialog.showModal(); else detailDialog.setAttribute("open", "");
  }
  try {
    currentDetail = await fetchJSON(`${API_BASE_URL}/api/v1/plans/${encodeURIComponent(planID)}?email=${encodeURIComponent(state.profile.email)}`);
    renderPlanDetail();
    setDetailStatus("");
  } catch (error) {
    setDetailStatus(error.message, true);
  }
}

function renderPlanDetail() {
  document.querySelector("#detail-title").textContent = currentDetail.title;
  detailForm.elements.title.value = currentDetail.title || "";
  detailForm.elements.description.value = currentDetail.description || "";
  detailForm.elements.location_name.value = currentDetail.location_name || "";
  detailForm.elements.address.value = currentDetail.address || "";
  detailForm.elements.confirmed_date.value = localDateTimeValue(currentDetail.confirmed_date);
  detailForm.querySelector("#owner-actions").hidden = !currentDetail.is_owner;
  [...detailForm.elements].forEach(element => {
    if (element.name) element.disabled = !currentDetail.is_owner;
  });
  renderDetailOptions();
  renderDetailTasks();
}

function renderDetailOptions() {
  const options = currentDetail.date_options || [];
  document.querySelector("#detail-voting").hidden = options.length === 0 || currentDetail.status === "confirmed";
  detailOptions.innerHTML = options.map(option => `
    <article class="detail-option">
      <div><strong>${escapeText(formatDate(option.start_time))}</strong><small>Sí ${option.yes} · Quizá ${option.maybe} · No ${option.no}</small></div>
      <select data-option-id="${option.id}" aria-label="Tu disponibilidad">
        <option value="yes" ${option.my_vote === "yes" ? "selected" : ""}>Sí</option>
        <option value="maybe" ${option.my_vote === "maybe" ? "selected" : ""}>Quizá</option>
        <option value="no" ${option.my_vote === "no" ? "selected" : ""}>No</option>
      </select>
    </article>`).join("");
}

function taskButton(task) {
  const canDelete = currentDetail.is_owner || task.is_mine;
  const deleteButton = canDelete ? `<button data-task-action="delete" data-task-id="${task.id}" class="task-link danger-link">Eliminar</button>` : "";
  if (task.status === "completed") {
    const reopen = currentDetail.is_owner ? `<button data-task-action="reopen" data-task-id="${task.id}" class="task-link">Reabrir</button>` : "";
    return `${reopen}${deleteButton}`;
  }
  if (task.is_mine) return `<button data-task-action="complete" data-task-id="${task.id}" class="task-link">Completar</button><button data-task-action="release" data-task-id="${task.id}" class="task-link">Liberar</button>${deleteButton}`;
  if (!task.assigned_name) return `<button data-task-action="claim" data-task-id="${task.id}" class="task-link">Me encargo</button>${deleteButton}`;
  return deleteButton;
}

function renderDetailTasks() {
  const tasks = currentDetail.tasks || [];
  detailTasks.innerHTML = tasks.length ? tasks.map(task => `
    <article class="detail-task ${task.status}">
      <div><strong>${escapeText(task.title)}</strong><small>${task.assigned_name ? `Responsable: ${escapeText(task.assigned_name)}` : "Sin responsable"}</small></div>
      <div class="task-actions">${taskButton(task)}</div>
    </article>`).join("") : '<p class="empty-state">No hay tareas pendientes. Añade la primera.</p>';
}

const previousRenderPlans = renderPlans;
renderPlans = function renderPlansWithActions() {
  previousRenderPlans();
  const plans = filteredPlans();
  document.querySelectorAll("#plans-list .plan-card").forEach((card, index) => {
    card.dataset.planId = plans[index]?.id || "";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Abrir ${plans[index]?.title || "plan"}`);
  });
};

document.querySelector("#plans-list").addEventListener("click", event => {
  const card = event.target.closest(".plan-card[data-plan-id]");
  if (card) openPlanDetail(card.dataset.planId);
});
document.querySelector("#plans-list").addEventListener("keydown", event => {
  const card = event.target.closest(".plan-card[data-plan-id]");
  if (card && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openPlanDetail(card.dataset.planId);
  }
});

document.querySelector("#detail-close").addEventListener("click", () => detailDialog.close ? detailDialog.close() : detailDialog.removeAttribute("open"));

detailForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentDetail?.is_owner) return;
  const data = Object.fromEntries(new FormData(detailForm));
  data.creator_email = state.profile.email;
  data.confirmed_date = data.confirmed_date ? new Date(data.confirmed_date).toISOString() : "";
  try {
    await fetchJSON(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    setDetailStatus("Plan actualizado.");
    await loadDashboard();
    await openPlanDetail(currentDetail.id);
  } catch (error) { setDetailStatus(error.message, true); }
});

document.querySelector("#delete-plan").addEventListener("click", async () => {
  if (!currentDetail?.is_owner || !confirm("¿Eliminar este plan y todos sus votos y tareas?")) return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}?email=${encodeURIComponent(state.profile.email)}`, { method: "DELETE" });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Error ${response.status}`);
    detailDialog.close();
    await loadDashboard();
  } catch (error) { setDetailStatus(error.message, true); }
});

document.querySelector("#save-detail-votes").addEventListener("click", async () => {
  const votes = {};
  detailOptions.querySelectorAll("select[data-option-id]").forEach(select => { votes[select.dataset.optionId] = select.value; });
  try {
    await fetchJSON(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}/votes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: state.profile.email, votes }) });
    setDetailStatus("Disponibilidad actualizada.");
    await openPlanDetail(currentDetail.id);
    await loadDashboard();
  } catch (error) { setDetailStatus(error.message, true); }
});

document.querySelector("#add-task-form").addEventListener("submit", async event => {
  event.preventDefault();
  const taskForm = event.currentTarget;
  const input = taskForm.elements.title;
  const assignSelf = taskForm.elements.assign_self.checked;
  try {
    await fetchJSON(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor_email: state.profile.email, title: input.value, assign_self: assignSelf }) });
    taskForm.reset();
    await openPlanDetail(currentDetail.id);
  } catch (error) { setDetailStatus(error.message, true); }
});

detailTasks.addEventListener("click", async event => {
  const button = event.target.closest("[data-task-action]");
  if (!button) return;
  const action = button.dataset.taskAction;
  try {
    if (action === "delete") {
      if (!confirm("¿Eliminar esta tarea?")) return;
      const response = await fetch(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}/tasks/${button.dataset.taskId}?email=${encodeURIComponent(state.profile.email)}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Error ${response.status}`);
    } else {
      await fetchJSON(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}/tasks/${button.dataset.taskId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ actor_email: state.profile.email, action }) });
    }
    await openPlanDetail(currentDetail.id);
  } catch (error) { setDetailStatus(error.message, true); }
});
