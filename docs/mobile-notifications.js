(() => {
  const button = document.querySelector("#notification-button");
  const ENABLED_KEY = "plantogo.notifications.enabled";
  const SENT_KEY = "plantogo.notifications.sent";
  const CHECK_INTERVAL = 15 * 60 * 1000;

  function supported() {
    return "Notification" in window && "serviceWorker" in navigator;
  }

  function enabled() {
    return supported() && Notification.permission === "granted" && localStorage.getItem(ENABLED_KEY) === "true";
  }

  function syncButton() {
    if (!button) return;
    button.hidden = !supported();
    if (Notification.permission === "denied") {
      button.textContent = "Avisos bloqueados";
      button.disabled = true;
      return;
    }
    button.disabled = false;
    button.textContent = enabled() ? "Avisos activos" : "Activar avisos";
    button.setAttribute("aria-pressed", enabled() ? "true" : "false");
  }

  function sentMap() {
    try { return JSON.parse(localStorage.getItem(SENT_KEY)) || {}; } catch { return {}; }
  }

  function dayKey() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  async function notify(title, options) {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      icon: "./icons/plantogo-icon.svg",
      badge: "./icons/plantogo-icon.svg",
      ...options
    });
  }

  async function checkNotifications(force = false) {
    if (!enabled() || !state?.profile?.email || !Array.isArray(state.plans)) return;
    const now = Date.now();
    const next24Hours = now + 24 * 60 * 60 * 1000;
    const sent = sentMap();
    const today = dayKey();

    for (const plan of state.plans) {
      const date = plan.confirmed_date ? new Date(plan.confirmed_date).getTime() : 0;
      if (date >= now && date <= next24Hours) {
        const key = `plan:${plan.id}:${today}`;
        if (force || !sent[key]) {
          const when = new Intl.DateTimeFormat("es-ES", { weekday: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(date));
          await notify(`Plan próximo: ${plan.title}`, {
            body: `${when}${plan.location_name ? ` · ${plan.location_name}` : ""}`,
            tag: `plan-${plan.id}`,
            data: { url: `./?view=day&date=${new Date(date).toISOString().slice(0, 10)}` }
          });
          sent[key] = Date.now();
        }
      }

      const mine = Number(plan.my_pending_task_count || 0);
      const open = Number(plan.open_pending_task_count || 0);
      const total = Number(plan.pending_task_count || 0);
      if (total > 0 && (mine > 0 || open > 0)) {
        const key = `tasks:${plan.id}:${today}`;
        if (force || !sent[key]) {
          const parts = [];
          if (mine) parts.push(`${mine} para ti`);
          if (open) parts.push(`${open} sin asignar`);
          await notify(`Tareas pendientes en ${plan.title}`, {
            body: parts.join(" · ") || `${total} tareas pendientes`,
            tag: `tasks-${plan.id}`,
            data: { url: "./" }
          });
          sent[key] = Date.now();
        }
      }
    }

    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    for (const [key, value] of Object.entries(sent)) if (Number(value) < cutoff) delete sent[key];
    localStorage.setItem(SENT_KEY, JSON.stringify(sent));
  }

  button?.addEventListener("click", async () => {
    if (!supported()) return;
    if (enabled()) {
      localStorage.setItem(ENABLED_KEY, "false");
      syncButton();
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      localStorage.setItem(ENABLED_KEY, "true");
      syncButton();
      await notify("Avisos activados", {
        body: "PlanToGo te avisará de planes próximos y tareas pendientes mientras la PWA esté activa.",
        tag: "notifications-enabled",
        data: { url: "./" }
      });
      await checkNotifications(true);
    } else {
      syncButton();
    }
  });

  const originalLoadDashboard = window.loadDashboard;
  if (typeof originalLoadDashboard === "function") {
    window.loadDashboard = async function loadDashboardWithNotifications(...args) {
      const result = await originalLoadDashboard.apply(this, args);
      await checkNotifications();
      return result;
    };
  }

  window.addEventListener("focus", () => checkNotifications());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkNotifications();
  });
  setInterval(checkNotifications, CHECK_INTERVAL);
  syncButton();
  setTimeout(checkNotifications, 2500);
})();