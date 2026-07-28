const groupDetailDialog = document.querySelector("#group-detail-dialog");
const groupDetailForm = document.querySelector("#group-detail-form");
const groupDetailStatus = document.querySelector("#group-detail-status");
let currentGroup = null;

function setGroupDetailStatus(message = "", isError = false) {
  if (!groupDetailStatus) return;
  groupDetailStatus.textContent = message;
  groupDetailStatus.classList.toggle("error", isError);
}

function renderPlanGroupOptions() {
  const container = document.querySelector("#plan-group-options");
  if (!container) return;
  const groups = state.groups || [];
  container.innerHTML = groups.length
    ? groups.map(group => `<label><input type="checkbox" value="${group.id}"><span>${escapeText(group.name)}</span><small>${group.role === "admin" ? "Administrador" : "Miembro"}</small></label>`).join("")
    : '<p class="participant-empty">No perteneces a ningún grupo.</p>';
}

function normalizeGroupMembers(group) {
  const members = Array.isArray(group?.members) ? group.members : [];
  return members.map(member => ({
    id: member.id || member.user_id || "",
    name: member.name || member.user_name || member.email || "Miembro",
    email: member.email || member.user_email || "",
    role: member.role || "member"
  }));
}

function renderGroupMembers() {
  const container = document.querySelector("#group-members-list");
  const empty = document.querySelector("#group-members-empty");
  if (!container) return;
  const members = normalizeGroupMembers(currentGroup);
  const isAdmin = Boolean(currentGroup?.is_admin || currentGroup?.role === "admin");
  const actorEmail = (state.profile?.email || "").toLowerCase();
  container.innerHTML = members.map(member => {
    const isSelf = member.email && member.email.toLowerCase() === actorEmail;
    const canRemove = isAdmin && member.role !== "admin" && !isSelf;
    return `<div class="group-member-row" data-member-id="${escapeText(member.id)}" data-member-email="${escapeText(member.email)}"><div><strong>${escapeText(member.name)}</strong>${member.email ? `<small>${escapeText(member.email)}</small>` : ""}</div><span class="group-member-role">${member.role === "admin" ? "Administrador" : "Miembro"}</span>${canRemove ? '<button class="danger-button group-member-remove" type="button">Eliminar</button>' : ""}</div>`;
  }).join("");
  if (empty) empty.hidden = members.length > 0;
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
  if (!state.profile?.email || !groupDetailDialog || !groupDetailForm) return;
  setGroupDetailStatus("Cargando grupo…");
  if (!groupDetailDialog.open) groupDetailDialog.showModal ? groupDetailDialog.showModal() : groupDetailDialog.setAttribute("open", "");
  try {
    currentGroup = await fetchJSON(`${API_BASE_URL}/api/v1/groups/${encodeURIComponent(groupID)}?email=${encodeURIComponent(state.profile.email)}`);
    const title = document.querySelector("#group-detail-title");
    const meta = document.querySelector("#group-detail-meta");
    const adminActions = document.querySelector("#group-admin-actions");
    if (title) title.textContent = currentGroup.name || "Grupo";
    if (groupDetailForm.elements.name) groupDetailForm.elements.name.value = currentGroup.name || "";
    if (groupDetailForm.elements.description) groupDetailForm.elements.description.value = currentGroup.description || "";
    if (meta) meta.textContent = `${currentGroup.member_count ?? normalizeGroupMembers(currentGroup).length} miembros · ${(currentGroup.is_admin || currentGroup.role === "admin") ? "Administrador" : "Miembro"}`;
    if (adminActions) adminActions.hidden = !(currentGroup.is_admin || currentGroup.role === "admin");
    if (groupDetailForm.elements.name) groupDetailForm.elements.name.disabled = !(currentGroup.is_admin || currentGroup.role === "admin");
    if (groupDetailForm.elements.description) groupDetailForm.elements.description.disabled = !(currentGroup.is_admin || currentGroup.role === "admin");
    renderGroupMembers();
    setGroupDetailStatus("");
  } catch (error) {
    setGroupDetailStatus(error.message, true);
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
document.querySelector("#close-group-detail")?.addEventListener("click", () => {
  if (!groupDetailDialog) return;
  groupDetailDialog.close ? groupDetailDialog.close() : groupDetailDialog.removeAttribute("open");
});

document.querySelector("#group-members-list")?.addEventListener("click", async event => {
  const button = event.target.closest(".group-member-remove");
  if (!button || !currentGroup || !(currentGroup.is_admin || currentGroup.role === "admin")) return;
  const row = button.closest(".group-member-row");
  const memberID = row?.dataset.memberId || "";
  const memberEmail = row?.dataset.memberEmail || "";
  const memberName = row?.querySelector("strong")?.textContent || "este miembro";
  if (!memberID && !memberEmail) return;
  if (!confirm(`¿Eliminar a ${memberName} del grupo?`)) return;
  button.disabled = true;
  setGroupDetailStatus("Eliminando miembro…");
  try {
    const memberRef = memberID || memberEmail;
    const response = await fetch(`${API_BASE_URL}/api/v1/groups/${encodeURIComponent(currentGroup.id)}/members/${encodeURIComponent(memberRef)}?email=${encodeURIComponent(state.profile.email)}`, { method: "DELETE" });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Error ${response.status}`);
    await loadDashboard();
    await openGroupDetail(currentGroup.id);
    setGroupDetailStatus("Miembro eliminado.");
  } catch (error) {
    button.disabled = false;
    setGroupDetailStatus(error.message, true);
  }
});

groupDetailForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentGroup || !(currentGroup.is_admin || currentGroup.role === "admin")) return;
  const data = Object.fromEntries(new FormData(groupDetailForm));
  data.actor_email = state.profile.email;
  try {
    await fetchJSON(`${API_BASE_URL}/api/v1/groups/${currentGroup.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    setGroupDetailStatus("Grupo actualizado.");
    await loadDashboard();
    await openGroupDetail(currentGroup.id);
  } catch (error) { setGroupDetailStatus(error.message, true); }
});

document.querySelector("#delete-group")?.addEventListener("click", async () => {
  if (!currentGroup || !(currentGroup.is_admin || currentGroup.role === "admin") || !confirm("¿Eliminar este grupo? Los planes seguirán existiendo, pero dejarán de publicarse en él.")) return;
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/groups/${currentGroup.id}?email=${encodeURIComponent(state.profile.email)}`, { method: "DELETE" });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Error ${response.status}`);
    groupDetailDialog?.close?.();
    await loadDashboard();
  } catch (error) { setGroupDetailStatus(error.message, true); }
});

form.addEventListener("submit", async event => {
  event.preventDefault();
  event.stopImmediatePropagation();
  const data = Object.fromEntries(new FormData(form));
  data.group_ids = [...document.querySelectorAll("#plan-group-options input:checked")].map(input => input.value);
  data.tasks = window.PlanWizard?.getTasks?.() || [];
  try {
    window.PlanRecurrence?.preparePlanData(data);
    const focusDate = window.PlanRecurrence?.getFocusDate?.() || (data.confirmed_date ? new Date(data.confirmed_date) : null);
    if (!data.confirmed_date && data.type === "fixed") throw new Error("Selecciona la fecha y hora del evento.");
    if (data.type === "fixed") {
      data.confirmed_date = new Date(data.confirmed_date).toISOString();
      data.date_options = [];
    } else {
      data.confirmed_date = "";
      data.date_options = [...document.querySelectorAll(".date-option-input")].map(row => ({
        start_time: new Date(row.querySelector(".option-start").value).toISOString(),
        end_time: new Date(row.querySelector(".option-end").value).toISOString()
      }));
      if (data.date_options.length < 2) throw new Error("Añade al menos dos propuestas completas.");
    }
    setStatus("Creando plan…");
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    try {
      await window.PlanRecurrence?.save(body.id);
    } catch (recurrenceError) {
      await fetch(`${API_BASE_URL}/api/v1/plans/${body.id}?email=${encodeURIComponent(data.creator_email)}`, { method: "DELETE" }).catch(() => {});
      throw recurrenceError;
    }
    saveProfile({ name: data.creator_name, email: data.creator_email });
    if (focusDate && !Number.isNaN(focusDate.getTime())) state.calendarDate = new Date(focusDate);
    const link = publicURL(body.public_token);
    statusNode.innerHTML = `Plan creado con ${body.task_count || 0} tareas. <a href="${link}">Abrir enlace para compartir</a>`;
    await loadDashboard();
    document.querySelector("#calendar-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    await window.PlanSharing?.afterCreate?.({ title: data.title }, link);
  } catch (error) { setStatus(error.message === "Failed to fetch" ? "No se pudo conectar con Railway." : error.message, true); }
}, true);

const wizardStyle = document.createElement("link");
wizardStyle.rel = "stylesheet";
wizardStyle.href = "./event-wizard.css?v=14";
document.head.append(wizardStyle);
Promise.all([
  import("./event-wizard.js?v=14"),
  import("./recurrence-ui.js?v=21")
]).catch(error => console.error("No se pudo cargar el asistente", error));