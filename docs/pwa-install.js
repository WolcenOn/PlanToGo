let deferredInstallPrompt = null;
const installButton = document.querySelector("#install-app-button");

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function syncInstallButton() {
  if (!installButton) return;
  installButton.hidden = isStandalone() || !deferredInstallPrompt;
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  syncInstallButton();
});

installButton?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice.catch(() => null);
  deferredInstallPrompt = null;
  syncInstallButton();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  syncInstallButton();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(error => {
      console.error("No se pudo registrar la PWA", error);
    });
  });
}

function loadScriptOnce(src, marker) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[${marker}]`);
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else existing.addEventListener("load", resolve, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.setAttribute(marker, "true");
    script.addEventListener("load", () => { script.dataset.loaded = "true"; resolve(); }, { once: true });
    script.addEventListener("error", reject, { once: true });
    document.body.append(script);
  });
}

function loadCalendarInsights() {
  if (!document.querySelector('link[data-calendar-insights]')) {
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "./calendar-insights.css?v=48";
    style.dataset.calendarInsights = "true";
    document.head.append(style);
  }
  loadScriptOnce("./calendar-insights.js?v=48", "data-calendar-insights")
    .then(() => loadScriptOnce("./trip-calendar-source.js?v=48", "data-trip-calendar-source"))
    .catch(error => console.error("No se pudo cargar el calendario de viajes", error));
}

syncInstallButton();
loadCalendarInsights();