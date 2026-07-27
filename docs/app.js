const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL?.replace(/\/$/, "");
const PROFILE_KEY = "plantogo.profile";
const state = { profile: readProfile(), plans: [], groups: [], filter: "all", calendarView: "month", calendarDate: new Date(), publicToken: null, publicPlan: null };
const form = document.querySelector("#plan-form");
const profileForm = document.querySelector("#profile-form");
const statusNode = document.querySelector("#form-status");
const dialog = document.querySelector("#plan-dialog");
const planType = document.querySelector("#plan-type");
const optionInputs = document.querySelector("#date-option-inputs");
const voteForm = document.querySelector("#vote-form");

function readProfile() { try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null; } catch { return null; } }
function saveProfile(profile) { state.profile = profile; localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }
function setStatus(message, isError = false) { statusNode.textContent = message; statusNode.classList.toggle("error", isError); }
function escapeText(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])); }
function publicURL(token) { const url = new URL(window.location.href); url.search = ""; url.searchParams.set("token", token); return url.toString(); }
function dateKey(value) { const date = new Date(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function startOfWeek(value) { const date = new Date(value); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); date.setHours(0, 0, 0, 0); return date; }
function formatDate(value) { return new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeStyle: "short" }).format(new Date(value)); }
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase(); }
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); }); }
async function fetchJSON(url, options) { const response = await fetch(url, options); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || `Error ${response.status}`); return body; }

async function loadDashboard() {
  if (!state.profile?.email) { showWelcome(); return; }
  document.querySelector("#profile-button").textContent = state.profile.name || state.profile.email;
  document.querySelector("#welcome-panel").hidden = true;
  document.querySelector("#dashboard-content").hidden = false;
  prefillPlanForm();
  try {
    const data = await fetchJSON(`${API_BASE_URL}/api/v1/dashboard?email=${encodeURIComponent(state.profile.email)}`);
    state.plans = data.plans || [];
    state.groups = data.groups || [];
    renderDashboard();
  } catch (error) {
    document.querySelector("#plans-list").innerHTML = "";
    const empty = document.querySelector("#plans-empty");
    empty.hidden = false;
    empty.textContent = `No se pudo cargar el dashboard: ${error.message}`;
  }
}

function showWelcome() {
  document.querySelector("#welcome-panel").hidden = false;
  document.querySelector("#dashboard-content").hidden = true;
  document.querySelector("#profile-button").textContent = "Configurar perfil";
}

function renderDashboard() {
  const now = new Date();
  document.querySelector("#stat-upcoming").textContent = state.plans.filter(plan => plan.confirmed_date && new Date(plan.confirmed_date) >= now).length;
  document.querySelector("#stat-own").textContent = state.plans.filter(plan => plan.ownership === "own").length;
  document.querySelector("#stat-friends").textContent = state.plans.filter(plan => plan.ownership === "friend").length;
  document.querySelector("#stat-groups").textContent = state.groups.length;
  renderPlans(); renderGroups(); renderCalendar();
}

function filteredPlans() {
  if (state.filter === "all") return state.plans;
  if (["own", "friend"].includes(state.filter)) return state.plans.filter(plan => plan.ownership === state.filter);
  return state.plans.filter(plan => plan.type === state.filter);
}

function participantMarkup(names = []) {
  if (!names.length) return '<span class="participant-empty">Sin participantes todavía</span>';
  const visible = names.slice(0, 4).map(name => `<span class="participant-avatar" title="${escapeText(name)}">${escapeText(initials(name))}</span>`).join("");
  const extra = names.length > 4 ? `<span class="participant-more">+${names.length - 4}</span>` : "";
  return `<div class="participant-stack">${visible}${extra}</div><span class="participant-count">${names.length} ${names.length === 1 ? "persona" : "personas"}</span>`;
}

function renderPlans() {
  const list = document.querySelector("#plans-list");
  const plans = filteredPlans();
  list.innerHTML = "";
  document.querySelector("#plans-empty").hidden = plans.length > 0;
  for (const plan of plans) {
    const card = document.createElement("article");
    card.className = `plan-card ${plan.ownership}`;
    const date = plan.confirmed_date ? new Date(plan.confirmed_date) : null;
    const typeLabel = plan.type === "flexible" ? (plan.status === "confirmed" ? "Fecha decidida" : `${plan.date_option_count || 0} opciones`) : "Fecha fija";
    card.innerHTML = `<div class="plan-tags"><span class="tag ${plan.ownership}">${plan.ownership === "own" ? "Plan propio" : "De amigos"}</span><span class="tag ${plan.type}">${typeLabel}</span></div><div><h3>${escapeText(plan.title)}</h3><p>${escapeText(plan.group_name || plan.location_name || "Sin grupo ni lugar")}</p></div><div class="plan-participants">${participantMarkup(plan.participants || [])}</div><div class="date-badge"><strong>${date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit" }).format(date) : "?"}</strong><span>${date ? new Intl.DateTimeFormat("es-ES", { month: "short", hour: "2-digit", minute: "2-digit" }).format(date) : "Fecha por decidir"}</span></div>`;
    list.append(card);
  }
}

function renderGroups() {
  const list = document.querySelector("#groups-list"); list.innerHTML = "";
  document.querySelector("#groups-empty").hidden = state.groups.length > 0;
  for (const group of state.groups) {
    const card = document.createElement("article"); card.className = "group-card";
    card.innerHTML = `<div class="group-avatar">${escapeText(group.name).slice(0, 1).toUpperCase()}</div><h3>${escapeText(group.name)}</h3><p>${escapeText(group.description || "Grupo sin descripción")}</p><small>${group.plan_count} planes · ${group.role === "admin" ? "Administrador" : "Miembro"}</small>`;
    list.append(card);
  }
}

function plansForDate(date) { const key = dateKey(date); return state.plans.filter(plan => plan.confirmed_date && dateKey(plan.confirmed_date) === key); }
function eventMarkup(plan) { return `<div class="calendar-event ${plan.ownership}"><i></i><span>${escapeText(plan.title)}</span></div>`; }
function renderCalendar() { document.querySelectorAll(".view-button").forEach(button => button.classList.toggle("active", button.dataset.view === state.calendarView)); if (state.calendarView === "month") renderMonth(); if (state.calendarView === "week") renderWeek(); if (state.calendarView === "day") renderDay(); }
function renderMonth() {
  const year = state.calendarDate.getFullYear(), month = state.calendarDate.getMonth(), first = new Date(year, month, 1), gridStart = startOfWeek(first), today = dateKey(new Date());
  document.querySelector("#calendar-title").textContent = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(state.calendarDate);
  let html = `<div class="calendar-grid">${["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map(day => `<div class="calendar-weekday">${day}</div>`).join("")}`;
  for (let i = 0; i < 42; i += 1) { const date = new Date(gridStart); date.setDate(gridStart.getDate() + i); const events = plansForDate(date); html += `<div class="calendar-day${date.getMonth() !== month ? " outside" : ""}${dateKey(date) === today ? " today" : ""}"><span class="day-number">${date.getDate()}</span><div class="calendar-events">${events.slice(0, 3).map(eventMarkup).join("")}${events.length > 3 ? `<small>+${events.length - 3} más</small>` : ""}</div></div>`; }
  document.querySelector("#calendar").innerHTML = `${html}</div>`;
}
function renderWeek() {
  const start = startOfWeek(state.calendarDate), end = new Date(start); end.setDate(end.getDate() + 6);
  document.querySelector("#calendar-title").textContent = `${new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }).format(start)} – ${new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" }).format(end)}`;
  let html = '<div class="agenda-list">';
  for (let i = 0; i < 7; i += 1) { const date = new Date(start); date.setDate(start.getDate() + i); const plans = plansForDate(date); html += `<article class="agenda-day"><h3>${new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" }).format(date)}</h3>${plans.length ? plans.map(plan => `<div class="agenda-event"><span>${eventMarkup(plan)}${escapeText(plan.location_name || "")}</span><strong>${new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(plan.confirmed_date))}</strong></div>`).join("") : "<small>Sin planes</small>"}</article>`; }
  document.querySelector("#calendar").innerHTML = `${html}</div>`;
}
function renderDay() { const plans = plansForDate(state.calendarDate); document.querySelector("#calendar-title").textContent = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(state.calendarDate); document.querySelector("#calendar").innerHTML = `<div class="agenda-list"><article class="agenda-day">${plans.length ? plans.map(plan => `<div class="agenda-event"><span>${eventMarkup(plan)}${escapeText(plan.location_name || "Sin lugar")}</span><strong>${new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(plan.confirmed_date))}</strong></div>`).join("") : '<p class="empty-state">No hay planes para este día.</p>'}</article></div>`; }
function moveCalendar(direction) { const next = new Date(state.calendarDate); if (state.calendarView === "month") next.setMonth(next.getMonth() + direction); if (state.calendarView === "week") next.setDate(next.getDate() + 7 * direction); if (state.calendarView === "day") next.setDate(next.getDate() + direction); state.calendarDate = next; renderCalendar(); }

function prefillPlanForm() { if (!state.profile) return; form.elements.creator_name.value = state.profile.name || ""; form.elements.creator_email.value = state.profile.email || ""; }
function addDateOption(values = {}) {
  const row = document.createElement("div"); row.className = "date-option-input";
  row.innerHTML = `<label>Desde<input type="datetime-local" class="option-start" value="${values.start || ""}" required></label><label>Hasta<input type="datetime-local" class="option-end" value="${values.end || ""}" required></label><button type="button" class="icon-button remove-option" aria-label="Eliminar fecha">×</button>`;
  row.querySelector(".remove-option").addEventListener("click", () => { if (optionInputs.children.length > 2) row.remove(); });
  optionInputs.append(row);
}
function resetDateOptions() { optionInputs.innerHTML = ""; addDateOption(); addDateOption(); }
function togglePlanType() { const flexible = planType.value === "flexible"; document.querySelector("#fixed-date-field").hidden = flexible; document.querySelector("#flexible-dates-field").hidden = !flexible; form.elements.confirmed_date.required = !flexible; if (flexible && optionInputs.children.length < 2) resetDateOptions(); }

async function createPlan(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  if (data.type === "fixed") {
    if (!data.confirmed_date) { setStatus("Selecciona una fecha y hora.", true); return; }
    data.confirmed_date = new Date(data.confirmed_date).toISOString();
    data.date_options = [];
  } else {
    data.confirmed_date = "";
    data.date_options = [...document.querySelectorAll(".date-option-input")].map(row => ({ start_time: new Date(row.querySelector(".option-start").value).toISOString(), end_time: new Date(row.querySelector(".option-end").value).toISOString() }));
    if (data.date_options.length < 2 || data.date_options.some(option => !option.start_time || !option.end_time)) { setStatus("Añade al menos dos opciones completas.", true); return; }
  }
  setStatus("Creando plan…");
  try {
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    saveProfile({ name: data.creator_name, email: data.creator_email });
    const link = publicURL(body.public_token);
    statusNode.innerHTML = `Plan creado. <a href="${link}">Abrir enlace para compartir</a>`;
    await navigator.clipboard?.writeText(link).catch(() => {});
    await loadDashboard();
  } catch (error) { setStatus(error.message === "Failed to fetch" ? "No se pudo conectar con Railway." : error.message, true); }
}

function guestSession(token) { const key = `plantogo.guest.${token}`; let id = localStorage.getItem(key); if (!id) { id = uuid(); localStorage.setItem(key, id); } return id; }
function renderParticipants(names = []) { document.querySelector("#participants-panel").innerHTML = `<p class="eyebrow">Participantes</p><div class="public-participants">${participantMarkup(names)}</div>`; }
function optionScore(option) { return option.yes * 2 + option.maybe; }
function renderPublicOptions(plan) {
  const container = document.querySelector("#date-options"); container.innerHTML = "";
  const maxScore = Math.max(0, ...(plan.date_options || []).map(optionScore));
  for (const option of plan.date_options || []) {
    const card = document.createElement("article"); card.className = "vote-option";
    const best = optionScore(option) === maxScore && maxScore > 0;
    card.innerHTML = `<div class="vote-option-head"><div><strong>${escapeText(formatDate(option.start_time))}</strong><small>hasta ${new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(option.end_time))}</small></div>${best ? '<span class="best-option">Mejor opción</span>' : ""}</div><div class="vote-counts"><span>✓ ${option.yes}</span><span>~ ${option.maybe}</span><span>× ${option.no}</span></div><div class="vote-choice" role="radiogroup"><label><input type="radio" name="vote-${option.id}" value="yes" required>Sí</label><label><input type="radio" name="vote-${option.id}" value="maybe">Quizá</label><label><input type="radio" name="vote-${option.id}" value="no">No</label></div><small>${option.voters?.length ? `Disponibles: ${escapeText(option.voters.join(", "))}` : "Nadie disponible todavía"}</small>${state.profile?.email && plan.status === "voting" ? `<button type="button" class="confirm-option secondary-button" data-option="${option.id}">Fijar esta fecha</button>` : ""}`;
    container.append(card);
  }
  container.querySelectorAll(".confirm-option").forEach(button => button.addEventListener("click", () => confirmOption(plan.id, button.dataset.option)));
}

async function confirmOption(planID, optionID) {
  if (!state.profile?.email || !confirm("¿Fijar esta fecha como definitiva?")) return;
  try { await fetchJSON(`${API_BASE_URL}/api/v1/plans/${planID}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creator_email: state.profile.email, option_id: optionID }) }); await loadPublicPlan(state.publicToken); } catch (error) { document.querySelector("#vote-status").textContent = error.message; }
}

async function loadPublicPlan(token) {
  state.publicToken = token;
  document.querySelector(".sidebar").hidden = true; document.querySelector(".topbar").hidden = true; document.querySelector("#dashboard-view").hidden = true;
  const view = document.querySelector("#plan-view"); view.hidden = false;
  try {
    const plan = await fetchJSON(`${API_BASE_URL}/api/v1/public/plans/${encodeURIComponent(token)}`); state.publicPlan = plan;
    document.querySelector("#plan-title").textContent = plan.title;
    document.querySelector("#plan-description").textContent = plan.description || "Sin descripción";
    document.querySelector("#plan-date").textContent = plan.confirmed_date ? formatDate(plan.confirmed_date) : "Pendiente de votación";
    document.querySelector("#plan-location").textContent = plan.location_name || "Sin lugar definido";
    document.querySelector("#plan-address").textContent = plan.address || "Sin dirección";
    renderParticipants(plan.participants || []);
    voteForm.hidden = plan.type !== "flexible" || plan.status === "confirmed";
    if (!voteForm.hidden) renderPublicOptions(plan);
  } catch (error) { document.querySelector("#plan-title").textContent = "No se pudo cargar el plan"; document.querySelector("#plan-description").textContent = error.message; }
}

voteForm.addEventListener("submit", async event => {
  event.preventDefault();
  const guestName = new FormData(voteForm).get("guest_name")?.trim();
  const votes = {};
  for (const option of state.publicPlan?.date_options || []) { const selected = voteForm.querySelector(`input[name="vote-${option.id}"]:checked`); if (!selected) { document.querySelector("#vote-status").textContent = "Marca una respuesta para cada fecha."; return; } votes[option.id] = selected.value; }
  try { await fetchJSON(`${API_BASE_URL}/api/v1/public/plans/${encodeURIComponent(state.publicToken)}/votes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ guest_name: guestName, guest_session_id: guestSession(state.publicToken), votes }) }); document.querySelector("#vote-status").textContent = "Disponibilidad guardada."; await loadPublicPlan(state.publicToken); } catch (error) { document.querySelector("#vote-status").textContent = error.message; }
});

profileForm.addEventListener("submit", event => { event.preventDefault(); const data = Object.fromEntries(new FormData(profileForm)); saveProfile({ name: data.name.trim(), email: data.email.trim().toLowerCase() }); loadDashboard(); });
form.addEventListener("submit", createPlan);
planType.addEventListener("change", togglePlanType);
document.querySelector("#add-date-option").addEventListener("click", () => addDateOption());
document.querySelector("#new-plan-button").addEventListener("click", () => { prefillPlanForm(); resetDateOptions(); togglePlanType(); dialog.showModal ? dialog.showModal() : dialog.setAttribute("open", ""); });
document.querySelector("#close-dialog").addEventListener("click", () => dialog.close ? dialog.close() : dialog.removeAttribute("open"));
document.querySelector("#cancel-dialog").addEventListener("click", () => dialog.close ? dialog.close() : dialog.removeAttribute("open"));
document.querySelector("#profile-button").addEventListener("click", () => { localStorage.removeItem(PROFILE_KEY); state.profile = null; showWelcome(); });
document.querySelector("#new-group-button").addEventListener("click", () => alert("La creación de grupos será el siguiente módulo."));
document.querySelectorAll(".filter-button").forEach(button => button.addEventListener("click", () => { state.filter = button.dataset.filter; document.querySelectorAll(".filter-button").forEach(item => item.classList.toggle("active", item === button)); renderPlans(); }));
document.querySelectorAll(".view-button").forEach(button => button.addEventListener("click", () => { state.calendarView = button.dataset.view; renderCalendar(); }));
document.querySelector("#calendar-prev").addEventListener("click", () => moveCalendar(-1));
document.querySelector("#calendar-next").addEventListener("click", () => moveCalendar(1));
document.querySelector("#calendar-today").addEventListener("click", () => { state.calendarDate = new Date(); renderCalendar(); });
document.querySelectorAll("[data-scroll]").forEach(button => button.addEventListener("click", () => { document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item === button)); document.querySelector(`#${button.dataset.scroll}`)?.scrollIntoView({ behavior: "smooth" }); }));

resetDateOptions(); togglePlanType();
const token = new URLSearchParams(window.location.search).get("token");
if (token) loadPublicPlan(token); else loadDashboard();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js?v=4").then(registration => registration.update()).catch(() => {});