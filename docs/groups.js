const groupDialog = document.querySelector("#group-dialog");
const groupForm = document.querySelector("#group-form");
const groupStatus = document.querySelector("#group-status");

// smart-modes ocultaba el alta eliminándola del DOM. Varias recargas parciales del
// dashboard esperan que el nodo siga existiendo, así que conservamos un marcador.
if (!document.querySelector("#welcome-panel")) {
  const dashboardView = document.querySelector("#dashboard-view");
  const dashboardContent = document.querySelector("#dashboard-content");
  const placeholder = document.createElement("div");
  placeholder.id = "welcome-panel";
  placeholder.hidden = true;
  dashboardView?.insertBefore(placeholder, dashboardContent || null);
}

function setGroupStatus(message, isError = false) {
  if (!groupStatus) return;
  groupStatus.textContent = message;
  groupStatus.classList.toggle("error", isError);
}

function closeGroupDialog() {
  if (!groupDialog) return;
  if (groupDialog.close) groupDialog.close(); else groupDialog.removeAttribute("open");
}

const newGroupButton = document.querySelector("#new-group-button");
newGroupButton?.addEventListener("click", event => {
  event.preventDefault();
  event.stopImmediatePropagation();
  setGroupStatus("");
  groupForm?.reset();
  if (groupDialog?.showModal) groupDialog.showModal(); else groupDialog?.setAttribute("open", "");
}, true);

document.querySelector("#close-group-dialog")?.addEventListener("click", closeGroupDialog);
document.querySelector("#cancel-group-dialog")?.addEventListener("click", closeGroupDialog);

groupForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.profile?.email) {
    setGroupStatus("Configura primero tu perfil.", true);
    return;
  }
  const data = Object.fromEntries(new FormData(groupForm));
  data.creator_name = state.profile.name;
  data.creator_email = state.profile.email;
  setGroupStatus("Creando grupo…");
  try {
    await fetchJSON(`${API_BASE_URL}/api/v1/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    setGroupStatus("Grupo creado.");
    await loadDashboard();
    setTimeout(closeGroupDialog, 400);
  } catch (error) {
    setGroupStatus(error.message === "Failed to fetch" ? "No se pudo conectar con Railway." : error.message, true);
  }
});

// Los tipos de actividad deben ser visibles tanto para planes fijos como para
// planes con votación. El modo elegido adapta los campos de fecha.
const schedulePanel = document.querySelector(".schedule-mode-panel");
const planFormGrid = document.querySelector("#plan-form .form-grid");
const planTypeSelect = document.querySelector("#plan-type");
if (schedulePanel && planFormGrid) {
  schedulePanel.hidden = false;
  schedulePanel.classList.add("full-width");
  const heading = schedulePanel.querySelector(".schedule-mode-heading strong");
  const help = schedulePanel.querySelector(".schedule-mode-heading small");
  if (heading) heading.textContent = "Tipo de actividad";
  if (help) help.textContent = "Quedada, cine, viaje o actividad recurrente.";
  const typeLabel = planTypeSelect?.closest("label");
  planFormGrid.insertBefore(schedulePanel, typeLabel || planFormGrid.firstChild);

  schedulePanel.querySelectorAll('input[name="schedule_mode"]').forEach(input => {
    input.addEventListener("change", () => {
      schedulePanel.hidden = false;
      if (input.value === "recurring" && planTypeSelect) {
        planTypeSelect.value = "flexible";
        planTypeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        schedulePanel.hidden = false;
      }
    });
  });
  planTypeSelect?.addEventListener("change", () => {
    schedulePanel.hidden = false;
  });
}

// Cambiar de perfil requiere reconstruir el formulario inicial. Una recarga es
// más segura que intentar reutilizar el nodo eliminado por versiones anteriores.
document.querySelector("#profile-button")?.addEventListener("click", event => {
  event.preventDefault();
  event.stopImmediatePropagation();
  localStorage.removeItem(PROFILE_KEY);
  window.location.reload();
}, true);
