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

function ensureGroupInvitePanel() {
  let panel = document.querySelector("#group-invite-panel");
  if (panel) return panel;
  panel = document.createElement("section");
  panel.id = "group-invite-panel";
  panel.className = "group-invite-panel";
  panel.innerHTML = `
    <div class="section-heading"><div><p class="eyebrow">Miembros</p><h3>Invitar personas</h3></div></div>
    <p>Como administrador puedes añadir directamente a una persona mediante su nombre y email.</p>
    <form id="group-member-form" class="group-member-form">
      <label>Nombre<input name="member_name" required maxlength="100" placeholder="Nombre de la persona"></label>
      <label>Email<input name="member_email" type="email" required placeholder="persona@email.com"></label>
      <button class="primary-button" type="submit">Añadir al grupo</button>
    </form>
    <div class="group-share-row"><button id="share-group" class="secondary-button" type="button">Compartir grupo</button><small id="group-invite-status" role="status"></small></div>`;
  document.querySelector("#group-admin-actions")?.before(panel);
  return panel;
}

async function shareCurrentGroup() {
  if (!currentGroup) return;
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "groups-section";
  const payload = { title: `Grupo ${currentGroup.name} en PlanToGo`, text: `Te he añadido al grupo “${currentGroup.name}” en PlanToGo. Entra con tu email para ver sus planes.`, url: url.toString() };
  const status = document.querySelector("#group-invite-status");
  try {
    if (navigator.share) { await navigator.share(payload); if (status) status.textContent = "Grupo compartido."; }
    else { await navigator.clipboard.writeText(`${payload.text} ${payload.url}`); if (status) status.textContent = "Mensaje copiado al portapapeles."; }
  } catch (error) { if (error?.name !== "AbortError" && status) status.textContent = "No se pudo compartir."; }
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
    const isAdmin = Boolean(currentGroup.is_admin || currentGroup.role === "admin");
    const title = document.querySelector("#group-detail-title");
    const meta = document.querySelector("#group-detail-meta");
    const adminActions = document.querySelector("#group-admin-actions");
    if (title) title.textContent = currentGroup.name || "Grupo";
    if (groupDetailForm.elements.name) groupDetailForm.elements.name.value = currentGroup.name || "";
    if (groupDetailForm.elements.description) groupDetailForm.elements.description.value = currentGroup.description || "";
    if (meta) meta.textContent = `${currentGroup.member_count ?? normalizeGroupMembers(currentGroup).length} miembros · ${isAdmin ? "Administrador" : "Miembro"}`;
    if (adminActions) adminActions.hidden = !isAdmin;
    if (groupDetailForm.elements.name) groupDetailForm.elements.name.disabled = !isAdmin;
    if (groupDetailForm.elements.description) groupDetailForm.elements.description.disabled = !isAdmin;
    renderGroupMembers();
    const invitePanel = ensureGroupInvitePanel();
    if (invitePanel) {
      invitePanel.hidden = !isAdmin;
      invitePanel.querySelector("#group-member-form")?.reset();
      const inviteStatus = invitePanel.querySelector("#group-invite-status");
      if (inviteStatus) inviteStatus.textContent = "";
    }
    setGroupDetailStatus("");
  } catch (error) { setGroupDetailStatus(error.message, true); }
}

document.querySelector("#groups-list")?.addEventListener("click", event => { const card = event.target.closest(".group-card[data-group-id]"); if (card) openGroupDetail(card.dataset.groupId); });
document.querySelector("#groups-list")?.addEventListener("keydown", event => { const card = event.target.closest(".group-card[data-group-id]"); if (card && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openGroupDetail(card.dataset.groupId); } });
document.querySelector("#close-group-detail")?.addEventListener("click", () => { if (!groupDetailDialog) return; groupDetailDialog.close ? groupDetailDialog.close() : groupDetailDialog.removeAttribute("open"); });

document.querySelector("#group-members-list")?.addEventListener("click", async event => {
  const button = event.target.closest(".group-member-remove");
  if (!button || !currentGroup || !(currentGroup.is_admin || currentGroup.role === "admin")) return;
  const row = button.closest(".group-member-row");
  const memberRef = row?.dataset.memberId || row?.dataset.memberEmail || "";
  const memberName = row?.querySelector("strong")?.textContent || "este miembro";
  if (!memberRef || !confirm(`¿Eliminar a ${memberName} del grupo?`)) return;
  button.disabled = true;
  setGroupDetailStatus("Eliminando miembro…");
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/groups/${encodeURIComponent(currentGroup.id)}/members/${encodeURIComponent(memberRef)}?email=${encodeURIComponent(state.profile.email)}`, { method: "DELETE" });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `Error ${response.status}`);
    const groupID = currentGroup.id;
    await loadDashboard();
    await openGroupDetail(groupID);
    setGroupDetailStatus("Miembro eliminado.");
  } catch (error) { button.disabled = false; setGroupDetailStatus(error.message, true); }
});

groupDetailDialog?.addEventListener("submit", async event => {
  if (event.target.id !== "group-member-form") return;
  event.preventDefault();
  if (!currentGroup?.is_admin && currentGroup?.role !== "admin") return;
  const data = Object.fromEntries(new FormData(event.target));
  data.actor_email = state.profile.email;
  const inviteStatus = document.querySelector("#group-invite-status");
  try {
    if (inviteStatus) inviteStatus.textContent = "Añadiendo persona…";
    const result = await fetchJSON(`${API_BASE_URL}/api/v1/groups/${currentGroup.id}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const groupID = currentGroup.id;
    event.target.reset();
    await loadDashboard();
    await openGroupDetail(groupID);
    const refreshedStatus = document.querySelector("#group-invite-status");
    if (refreshedStatus) refreshedStatus.textContent = result.already_member ? "Esa persona ya pertenecía al grupo." : "Persona añadida al grupo.";
  } catch (error) { if (inviteStatus) inviteStatus.textContent = error.message; }
});

groupDetailDialog?.addEventListener("click", event => { if (event.target.closest("#share-group")) shareCurrentGroup(); });

groupDetailForm?.addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentGroup || !(currentGroup.is_admin || currentGroup.role === "admin")) return;
  const data = Object.fromEntries(new FormData(groupDetailForm));
  data.actor_email = state.profile.email;
  try {
    await fetchJSON(`${API_BASE_URL}/api/v1/groups/${currentGroup.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    const groupID = currentGroup.id;
    await loadDashboard();
    await openGroupDetail(groupID);
    setGroupDetailStatus("Grupo actualizado.");
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
    if (data.type === "fixed") { data.confirmed_date = new Date(data.confirmed_date).toISOString(); data.date_options = []; }
    else {
      data.confirmed_date = "";
      data.date_options = [...document.querySelectorAll(".date-option-input")].map(row => ({ start_time: new Date(row.querySelector(".option-start").value).toISOString(), end_time: new Date(row.querySelector(".option-end").value).toISOString() }));
      if (data.date_options.length < 2) throw new Error("Añade al menos dos propuestas completas.");
    }
    setStatus("Creando plan…");
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    try { await window.PlanRecurrence?.save(body.id); }
    catch (recurrenceError) { await fetch(`${API_BASE_URL}/api/v1/plans/${body.id}?email=${encodeURIComponent(data.creator_email)}`, { method: "DELETE" }).catch(() => {}); throw recurrenceError; }
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
Promise.all([import("./event-wizard.js?v=14"), import("./recurrence-ui.js?v=21")]).catch(error => console.error("No se pudo cargar el asistente", error));