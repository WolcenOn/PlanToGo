(() => {
  const form = document.querySelector("#plan-form");
  const planType = document.querySelector("#plan-type");
  const fixedDate = form?.elements.confirmed_date;
  const flexibleBuilder = document.querySelector("#flexible-dates-field");
  const status = document.querySelector("#form-status");
  if (!form || !planType || !fixedDate || !flexibleBuilder) return;

  function syncDateValidation() {
    const flexible = planType.value === "flexible";
    fixedDate.disabled = flexible;
    fixedDate.required = !flexible;

    flexibleBuilder.querySelectorAll("input, select, textarea").forEach(input => {
      input.disabled = !flexible;
      if (input.classList.contains("option-start") || input.classList.contains("option-end")) {
        input.required = flexible && input.type !== "hidden";
      }
    });
  }

  planType.addEventListener("change", () => queueMicrotask(syncDateValidation));
  form.querySelectorAll('input[name="schedule_mode"]').forEach(input => {
    input.addEventListener("change", () => queueMicrotask(syncDateValidation));
  });

  form.addEventListener("invalid", event => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return;
    status.textContent = field === fixedDate
      ? "Selecciona la fecha y hora del evento."
      : "Revisa los campos obligatorios antes de crear el evento.";
    status.classList.add("error");
  }, true);

  syncDateValidation();
})();

(() => {
  function addStyle(href) {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.append(link);
  }

  function loadClassic(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.body.append(script);
    });
  }

  addStyle("./dashboard-refinement.css?v=27");
  addStyle("./groups-page.css?v=27");
  loadClassic("./dashboard-refinement.js?v=27")
    .then(() => loadClassic("./groups-page.js?v=27"))
    .catch(error => console.error("No se pudieron cargar las mejoras del dashboard", error));
})();
