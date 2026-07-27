const API_BASE_URL = window.APP_CONFIG?.API_BASE_URL?.replace(/\/$/, "");
const form = document.querySelector("#plan-form");
const statusNode = document.querySelector("#form-status");

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

async function createPlan(event) {
  event.preventDefault();
  if (!API_BASE_URL || API_BASE_URL.includes("REPLACE-WITH")) {
    setStatus("Configura docs/config.js con el dominio público de Railway.", true);
    return;
  }
  const data = Object.fromEntries(new FormData(form));
  data.confirmed_date = new Date(data.confirmed_date).toISOString();
  setStatus("Creando plan…");
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/plans`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "No se pudo crear el plan");
    const link = publicURL(body.public_token);
    statusNode.innerHTML = `Plan creado. <a href="${link}">Abrir enlace público</a>`;
    form.reset();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function loadPublicPlan(token) {
  document.querySelector("#create-view").hidden = true;
  const view = document.querySelector("#plan-view");
  view.hidden = false;
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/public/plans/${encodeURIComponent(token)}`);
    const plan = await response.json();
    if (!response.ok) throw new Error(plan.error || "Plan no encontrado");
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

form?.addEventListener("submit", createPlan);
const token = new URLSearchParams(window.location.search).get("token");
if (token) loadPublicPlan(token);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");
