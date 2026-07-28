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

const dashboardRefinementStyles = document.createElement("link");
dashboardRefinementStyles.rel = "stylesheet";
dashboardRefinementStyles.href = "./dashboard-refinement.css?v=26";
document.head.append(dashboardRefinementStyles);
import("./dashboard-refinement.js?v=26").catch(error => console.error("No se pudieron cargar las mejoras del dashboard", error));
