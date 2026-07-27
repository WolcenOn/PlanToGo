const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL?.replace(/\/$/, "");
const PROFILE_KEY = "plantogo.profile";
const state = {
  profile: readProfile(),
  plans: [],
  groups: [],
  filter: "all",
  calendarView: "month",
  calendarDate: new Date()
};

const form = document.querySelector("#plan-form");
const profileForm = document.querySelector("#profile-form");
const statusNode = document.querySelector("#form-status");
const dialog = document.querySelector("#plan-dialog");

function readProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null;
  } catch {
    return null;
  }
}

function saveProfile(profile) {
  state.profile = profile;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.classList.toggle("error", isError);
}

function publicURL(token) {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("token", token);
  return url.toString();
}

function dateKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startOfWeek(value) {
  const date = new Date(value);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function escapeText(value) {
  return String(value ?? "");
}

async function fetchJSON(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Error ${response.status}`);
  return body;
}

async function loadDashboard() {
  if (!state.profile?.email) {
    showWelcome();
    return;
  }

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
    document.querySelector("#plans-empty").hidden = false;
    document.querySelector("#plans-empty").textContent = `No se pudo cargar el dashboard: ${error.message}`;
  }
}

function showWelcome() {
  document.querySelector("#welcome-panel").hidden = false;
  document.querySelector("#dashboard-content").hidden = true;
  document.querySelector("#profile-button").textContent = "Configurar perfil";
}

function renderDashboard() {
  const now = new Date();
  const upcoming = state.plans.filter(plan => plan.confirmed_date && new Date(plan.confirmed_date) >= now).length;
  document.querySelector("#stat-upcoming").textContent = upcoming;
  document.querySelector("#stat-own").textContent = state.plans.filter(plan => plan.ownership === "own").length;
  document.querySelector("#stat-friends").textContent = state.plans.filter(plan => plan.ownership === "friend").length;
  document.querySelector("#stat-groups").textContent = state.groups.length;
  renderPlans();
  renderGroups();
  renderCalendar();
}

function filteredPlans() {
  if (state.filter === "all") return state.plans;
  if (state.filter === "own" || state.filter === "friend") {
    return state.plans.filter(plan => plan.ownership === state.filter);
  }
  return state.plans.filter(plan => plan.type === state.filter);
}

function renderPlans() {
  const list = document.querySelector("#plans-list");
  const empty = document.querySelector("#plans-empty");
  list.innerHTML = "";
  const plans = filteredPlans();
  empty.hidden = plans.length > 0;

  for (const plan of plans) {
    const card = document.createElement("article");
    card.className = `plan-card ${plan.ownership}`;
    const date = plan.confirmed_date ? new Date(plan.confirmed_date) : null;
    const typeLabel = plan.type === "flexible" ? "En votación" : "Fecha fija";
    const ownerLabel = plan.ownership === "own" ? "Plan propio" : "De amigos";
    card.innerHTML = `
      <div class="plan-tags">
        <span class="tag ${plan.ownership}">${ownerLabel}</span>
        <span class="tag ${plan.type}">${typeLabel}</span>
      </div>
      <div><h3>${escapeText(plan.title)}</h3><p>${escapeText(plan.group_name || plan.location_name || "Sin grupo ni lugar")}</p></div>
      <div class="date-badge"><strong>${date ? new Intl.DateTimeFormat("es-ES", { day: "2-digit" }).format(date) : "—"}</strong><span>${date ? new Intl.DateTimeFormat("es-ES", { month: "short", hour: "2-digit", minute: "2-digit" }).format(date) : "Fecha por decidir"}</span></div>`;
    list.append(card);
  }
}

function renderGroups() {
  const list = document.querySelector("#groups-list");
  const empty = document.querySelector("#groups-empty");
  list.innerHTML = "";
  empty.hidden = state.groups.length > 0;

  for (const group of state.groups) {
    const card = document.createElement("article");
    card.className = "group-card";
    card.innerHTML = `<div class="group-avatar">${escapeText(group.name).slice(0, 1).toUpperCase()}</div><h3>${escapeText(group.name)}</h3><p>${escapeText(group.description || "Grupo sin descripción")}</p><small>${group.plan_count} planes · ${group.role === "admin" ? "Administrador" : "Miembro"}</small>`;
    list.append(card);
  }
}

function plansForDate(date) {
  const key = dateKey(date);
  return state.plans.filter(plan => plan.confirmed_date && dateKey(plan.confirmed_date) === key);
}

function renderCalendar() {
  document.querySelectorAll(".view-button").forEach(button => {
    button.classList.toggle("active", button.dataset.view === state.calendarView);
  });
  if (state.calendarView === "month") renderMonth();
  if (state.calendarView === "week") renderWeek();
  if (state.calendarView === "day") renderDay();
}

function eventMarkup(plan) {
  return `<div class="calendar-event ${plan.ownership}"><i></i><span>${escapeText(plan.title)}</span></div>`;
}

function renderMonth() {
  const year = state.calendarDate.getFullYear();
  const month = state.calendarDate.getMonth();
  document.querySelector("#calendar-title").textContent = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(state.calendarDate);
  const first = new Date(year, month, 1);
  const gridStart = startOfWeek(first);
  const today = dateKey(new Date());
  const weekdays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  let html = `<div class="calendar-grid">${weekdays.map(day => `<div class="calendar-weekday">${day}</div>`).join("")}`;

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const outside = date.getMonth() !== month ? " outside" : "";
    const isToday = dateKey(date) === today ? " today" : "";
    const events = plansForDate(date).slice(0, 3);
    html += `<div class="calendar-day${outside}${isToday}"><span class="day-number">${date.getDate()}</span><div class="calendar-events">${events.map(eventMarkup).join("")}${plansForDate(date).length > 3 ? `<small>+${plansForDate(date).length - 3} más</small>` : ""}</div></div>`;
  }
  document.querySelector("#calendar").innerHTML = `${html}</div>`;
}

function renderWeek() {
  const start = startOfWeek(state.calendarDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  document.querySelector("#calendar-title").textContent = `${new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short" }).format(start)} – ${new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", year: "numeric" }).format(end)}`;
  let html = '<div class="agenda-list">';
  for (let index = 0; index < 7; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const plans = plansForDate(date);
    html += `<article class="agenda-day"><h3>${new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long" }).format(date)}</h3>${plans.length ? plans.map(plan => `<div class="agenda-event"><span>${eventMarkup(plan)}${escapeText(plan.location_name || "")}</span><strong>${new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(plan.confirmed_date))}</strong></div>`).join("") : '<small>Sin planes</small>'}</article>`;
  }
  document.querySelector("#calendar").innerHTML = `${html}</div>`;
}

function renderDay() {
  const date = state.calendarDate;
  const plans = plansForDate(date);
  document.querySelector("#calendar-title").textContent = new Intl.DateTimeFormat("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
  document.querySelector("#calendar").innerHTML = `<div class="agenda-list"><article class="agenda-day">${plans.length ? plans.map(plan => `<div class="agenda-event"><span>${eventMarkup(plan)}${escapeText(plan.location_name || "Sin lugar")}</span><strong>${new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date(plan.confirmed_date))}</strong></div>`).join("") : '<p class="empty-state">No hay planes para este día.</p>'}</article></div>`;
}

function moveCalendar(direction) {
  const next = new Date(state.calendarDate);
  if (state.calendarView === "month") next.setMonth(next.getMonth() + direction);
  if (state.calendarView === "week") next.setDate(next.getDate() + 7 * direction);
  if (state.calendarView === "day") next.setDate(next.getDate() + direction);
  state.calendarDate = next;
  renderCalendar();
}

function prefillPlanForm() {
  if (!state.profile) return;
  form.elements.creator_name.value = state.profile.name || "";
  form.elements.creator_email.value = state.profile.email || "";
}

async function createPlan(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data.confirmed_date = new Date(data.confirmed_date).toISOString();
  setStatus("Creando plan…");
  try {
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    saveProfile({ name: data.creator_name, email: data.creator_email });
    const link = publicURL(body.public_token);
    statusNode.innerHTML = `Plan creado. <a href="${link}">Abrir enlace público</a>`;
    form.reset();
    prefillPlanForm();
    await loadDashboard();
  } catch (error) {
    setStatus(error.message === "Failed to fetch" ? "No se pudo conectar con Railway. Revisa CORS y el despliegue de la API." : error.message, true);
  }
}

async function loadPublicPlan(token) {
  document.querySelector(".sidebar").hidden = true;
  document.querySelector(".topbar").hidden = true;
  document.querySelector("#dashboard-view").hidden = true;
  const view = document.querySelector("#plan-view");
  view.hidden = false;
  try {
    const plan = await fetchJSON(`${API_BASE_URL}/api/v1/public/plans/${encodeURIComponent(token)}`);
    document.querySelector("#plan-title").textContent = plan.title;
    document.querySelector("#plan-description").textContent = plan.description || "Sin descripción";
    document.querySelector("#plan-date").textContent = new Intl.DateTimeFormat("es-ES", { dateStyle: "full", timeStyle: "short" }).format(new Date(plan.confirmed_date));
    document.querySelector("#plan-location").textContent = plan.location_name || "Sin lugar definido";
    document.querySelector("#plan-address").textContent = plan.address || "Sin dirección";
  } catch (error) {
    document.querySelector("#plan-title").textContent = "No se pudo cargar el plan";
    document.querySelector("#plan-description").textContent = error.message;
  }
}

profileForm.addEventListener("submit", event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(profileForm));
  saveProfile({ name: data.name.trim(), email: data.email.trim().toLowerCase() });
  loadDashboard();
});
form.addEventListener("submit", createPlan);
document.querySelector("#new-plan-button").addEventListener("click", () => { prefillPlanForm(); dialog.showModal(); });
document.querySelector("#close-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#cancel-dialog").addEventListener("click", () => dialog.close());
document.querySelector("#profile-button").addEventListener("click", () => { localStorage.removeItem(PROFILE_KEY); state.profile = null; showWelcome(); });
document.querySelectorAll(".filter-button").forEach(button => button.addEventListener("click", () => { state.filter = button.dataset.filter; document.querySelectorAll(".filter-button").forEach(item => item.classList.toggle("active", item === button)); renderPlans(); }));
document.querySelectorAll(".view-button").forEach(button => button.addEventListener("click", () => { state.calendarView = button.dataset.view; renderCalendar(); }));
document.querySelector("#calendar-prev").addEventListener("click", () => moveCalendar(-1));
document.querySelector("#calendar-next").addEventListener("click", () => moveCalendar(1));
document.querySelector("#calendar-today").addEventListener("click", () => { state.calendarDate = new Date(); renderCalendar(); });
document.querySelectorAll("[data-scroll]").forEach(button => button.addEventListener("click", () => document.querySelector(`#${button.dataset.scroll}`)?.scrollIntoView({ behavior: "smooth" })));

const token = new URLSearchParams(window.location.search).get("token");
if (token) loadPublicPlan(token); else loadDashboard();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
