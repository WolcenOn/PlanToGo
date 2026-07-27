const groupDetailDialog = document.querySelector("#group-detail-dialog");
const groupDetailForm = document.querySelector("#group-detail-form");
const groupDetailStatus = document.querySelector("#group-detail-status");
let currentGroup = null;

function renderPlanGroupOptions() {
  const container = document.querySelector("#plan-group-options");
  if (!container) return;
  const groups = state.groups || [];
  container.innerHTML = groups.length
    ? groups.map(group => `<label><input type="checkbox" value="${group.id}"><span>${escapeText(group.name)}</span><small>${group.role === "admin" ? "Administrador" : "Miembro"}</small></label>`).join("")
    : '<p class="participant-empty">No perteneces a ningún grupo.</p>';
}

document.querySelector("#new-plan-button")?.addEventListener("click", renderPlanGroupOptions);

const originalRenderGroupsForManagement = renderGroups;
renderGroups = function renderGroupsManaged() {
  originalRenderGroupsForManagement();
  document.querySelectorAll("#groups-list .group-card").forEach((card, index) => {
    const group = state.groups[index];
    if (!group) return;
    card.dataset.groupId = group.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Abrir grupo ${group.name}`);
  });
  renderPlanGroupOptions();
};

async function openGroupDetail(groupID) {
  if (!state.profile?.email) return;
  groupDetailStatus.textContent = "Cargando grupo…";
  if (!groupDetailDialog.open) groupDetailDialog.showModal ? groupDetailDialog.showModal() : groupDetailDialog.setAttribute("open", "");
  try {
    currentGroup = await fetchJSON(`${API_BASE_URL}/api/v1/groups/${encodeURIComponent(groupID)}?email=${encodeURIComponent(state.profile.email)}`);
    document.querySelector("#group-detail-title").textContent = currentGroup.name;
    groupDetailForm.elements.name.value = currentGroup.name;
    groupDetailForm.elements.description.value = currentGroup.description || "";
    document.querySelector("#group-detail-meta").textContent = `${currentGroup.member_count} miembros · ${currentGroup.role === "admin" ? "Administrador" : "Miembro"}`;
    document.querySelector("#group-admin-actions").hidden = !currentGroup.is_admin;
    groupDetailForm.elements.name.disabled = !currentGroup.is_admin;
    groupDetailForm.elements.description.disabled = !currentGroup.is_admin;
    groupDetailStatus.textContent = "";
  } catch (error) {
    groupDetailStatus.textContent = error.message;
    groupDetailStatus.classList.add("error");
  }
}

document.querySelector("#groups-list")?.addEventListener("click", event => {
  const card = event.target.closest(".group-card[data-group-id]");
  if (card) openGroupDetail(card.dataset.groupId);
});
document.querySelector("#groups-list")?.addEventListener("keydown", event => {
  const card = event.target.closest(".group-card[data-group-id]");
  if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openGroupDetail(card.dataset.groupId); }
});
document.querySelector("#close-group-detail")?.addEventListener("click", () => groupDetailDialog.close ? groupDetailDialog.close() : groupDetailDialog.removeAttribute("open"));

groupDetailForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentGroup?.is_admin) return;
  const data = Object.fromEntries(new FormData(groupDetailForm));
  data.actor_email = state.profile.email;
  try {
    await fetchJSON(`${API_BASE_URL}/api/v1/groups/${currentGroup.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    groupDetailStatus.textContent = "Grupo actualizado.";
    await loadDashboard();
    await openGroupDetail(currentGroup.id);
  } catch (error) { groupDetailStatus.textContent = error.message; groupDetailStatus.classList.add("error"); }
});

document.querySelector("#delete-group")?.addEventListener("click", async () => {
  if (!currentGroup?.is_admin || !confirm("¿Eliminar este grupo? Los planes seguirán existiendo, pero dejarán de publicarse en él.")) return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/groups/${currentGroup.id}?email=${encodeURIComponent(state.profile.email)}`, { method: "DELETE" });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Error ${response.status}`);
    groupDetailDialog.close();
    await loadDashboard();
  } catch (error) { groupDetailStatus.textContent = error.message; groupDetailStatus.classList.add("error"); }
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const data = Object.fromEntries(new FormData(form));
  data.group_ids = [...document.querySelectorAll("#plan-group-options input:checked")].map(input => input.value);
  data.tasks = window.PlanWizard?.getTasks?.() || [];
  try {
    if (data.type === "fixed") {
      if (!data.confirmed_date) throw new Error("Selecciona una fecha y hora.");
      data.confirmed_date = new Date(data.confirmed_date).toISOString();
      data.date_options = [];
    } else {
      data.confirmed_date = "";
      data.date_options = [...document.querySelectorAll(".date-option-input")].map(row => ({
        start_time: new Date(row.querySelector(".option-start").value).toISOString(),
        end_time: new Date(row.querySelector(".option-end").value).toISOString()
      }));
      if (data.date_options.length < 2) throw new Error("Añade al menos dos opciones completas.");
    }
    setStatus("Creando plan…");
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    saveProfile({ name: data.creator_name, email: data.creator_email });
    const link = publicURL(body.public_token);
    statusNode.innerHTML = `Plan creado con ${body.task_count || 0} tareas. <a href="${link}">Abrir enlace para compartir</a>`;
    await navigator.clipboard?.writeText(link).catch(() => {});
    await loadDashboard();
  } catch (error) { setStatus(error.message === "Failed to fetch" ? "No se pudo conectar con Railway." : error.message, true); }
}, true);

const wizardStyle = document.createElement("link");
wizardStyle.rel = "stylesheet";
wizardStyle.href = "./event-wizard.css?v=11";
document.head.append(wizardStyle);
import("./event-wizard.js?v=11").catch(error => console.error("No se pudo cargar el asistente", error));
