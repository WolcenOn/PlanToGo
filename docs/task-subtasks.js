(() => {
  let subtasksByTask = new Map();

  async function loadSubtasks() {
    if (!currentDetail?.id || !state.profile?.email) return;
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}/subtasks?email=${encodeURIComponent(state.profile.email)}`);
    subtasksByTask = new Map();
    for (const item of body.subtasks || []) {
      const items = subtasksByTask.get(item.task_id) || [];
      items.push(item);
      subtasksByTask.set(item.task_id, items);
    }
  }

  function subtaskMarkup(task) {
    const items = subtasksByTask.get(task.id) || [];
    const completed = items.filter(item => item.completed).length;
    return `
      <div class="subtask-panel" data-task-id="${task.id}">
        ${items.length ? `<div class="subtask-progress"><span>${completed}/${items.length} completadas</span><progress max="${items.length}" value="${completed}"></progress></div>` : ""}
        <div class="subtask-list">${items.map(item => `
          <label class="subtask-row ${item.completed ? "completed" : ""}">
            <input type="checkbox" data-subtask-id="${item.id}" ${item.completed ? "checked" : ""}>
            <span>${escapeText(item.title)}</span>
            <button type="button" data-delete-subtask="${item.id}" aria-label="Eliminar ${escapeText(item.title)}">×</button>
          </label>`).join("")}</div>
        <form class="add-subtask-form" data-task-id="${task.id}">
          <input name="title" maxlength="200" required placeholder="Añadir elemento a la lista">
          <button type="submit" class="secondary-button">Añadir</button>
          <small class="subtask-form-status" role="status"></small>
        </form>
      </div>`;
  }

  const baseRenderDetailTasks = renderDetailTasks;
  renderDetailTasks = function renderTasksWithSubtasks() {
    baseRenderDetailTasks();
    const tasks = currentDetail?.tasks || [];
    document.querySelectorAll("#detail-tasks .detail-task").forEach((row, index) => {
      const task = tasks[index];
      if (task && !row.querySelector(".subtask-panel")) row.insertAdjacentHTML("beforeend", subtaskMarkup(task));
    });
  };

  const baseOpenPlanDetail = openPlanDetail;
  openPlanDetail = async function openPlanDetailWithSubtasks(planID) {
    await baseOpenPlanDetail(planID);
    if (!currentDetail?.id) return;
    try {
      await loadSubtasks();
      renderDetailTasks();
    } catch (error) {
      setDetailStatus(`No se pudieron cargar las subtareas: ${error.message}`, true);
    }
  };

  detailTasks.addEventListener("change", async event => {
    const checkbox = event.target.closest("[data-subtask-id]");
    if (!checkbox) return;
    const taskID = checkbox.closest("[data-task-id]").dataset.taskId;
    try {
      await fetchJSON(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}/tasks/${taskID}/subtasks/${checkbox.dataset.subtaskId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor_email: state.profile.email, completed: checkbox.checked })
      });
      await loadSubtasks();
      renderDetailTasks();
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      setDetailStatus(error.message, true);
    }
  });

  detailTasks.addEventListener("submit", async event => {
    const form = event.target.closest(".add-subtask-form");
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const input = form.elements.title;
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector(".subtask-form-status");
    const title = String(input?.value || "").trim();
    if (!title) {
      status.textContent = "Escribe un elemento para la lista.";
      status.classList.add("error");
      input?.focus();
      return;
    }

    status.textContent = "Añadiendo…";
    status.classList.remove("error");
    if (button) button.disabled = true;

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/plans/${encodeURIComponent(currentDetail.id)}/tasks/${encodeURIComponent(form.dataset.taskId)}/subtasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor_email: state.profile.email, title })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404) throw new Error("La API de subtareas todavía no está desplegada en Railway o la tarea ya no existe.");
        throw new Error(body.error || `No se pudo añadir la subtarea (error ${response.status}).`);
      }
      input.value = "";
      await loadSubtasks();
      renderDetailTasks();
    } catch (error) {
      status.textContent = error.message;
      status.classList.add("error");
      setDetailStatus(error.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  }, true);

  detailTasks.addEventListener("click", async event => {
    const button = event.target.closest("[data-delete-subtask]");
    if (!button) return;
    const taskID = button.closest("[data-task-id]").dataset.taskId;
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/plans/${currentDetail.id}/tasks/${taskID}/subtasks/${button.dataset.deleteSubtask}?email=${encodeURIComponent(state.profile.email)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("No se pudo eliminar la subtarea.");
      await loadSubtasks();
      renderDetailTasks();
    } catch (error) { setDetailStatus(error.message, true); }
  });
})();
