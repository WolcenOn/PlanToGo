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

function loadCalendarInsights() {
  if (!document.querySelector('link[data-calendar-insights]')) {
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = "./calendar-insights.css?v=39";
    style.dataset.calendarInsights = "true";
    document.head.append(style);
  }
  if (!document.querySelector('script[data-calendar-insights]')) {
    const script = document.createElement("script");
    script.src = "./calendar-insights.js?v=39";
    script.dataset.calendarInsights = "true";
    document.body.append(script);
  }
}

syncInstallButton();
loadCalendarInsights();
