(() => {
  const form = document.querySelector("#plan-form");
  const flexibleField = document.querySelector("#flexible-dates-field");
  const modePanel = document.querySelector(".schedule-mode-panel");
  const typeField = document.querySelector("#plan-type")?.closest("label");
  if (!form || !flexibleField || !modePanel || !typeField) return;

  // El selector del tipo de actividad no debe vivir dentro del bloque que se
  // oculta para las fechas fijas. Lo colocamos antes del selector fijo/votación.
  if (flexibleField.contains(modePanel)) {
    typeField.before(modePanel);
  }

  modePanel.hidden = false;
  modePanel.style.removeProperty("display");
  modePanel.querySelectorAll("input, button, select, textarea").forEach(control => {
    if (control.dataset.activityDisabled === "temporary") {
      control.disabled = false;
      delete control.dataset.activityDisabled;
    }
  });
})();
