(() => {
  function repairWizardLayout() {
    const form = document.querySelector("#plan-form");
    const grid = form?.querySelector(".form-grid");
    const templatePanel = form?.querySelector(".wizard-template-panel");
    const firstStep = form?.querySelector('.wizard-step[data-step="0"]');
    const stepper = form?.querySelector(".wizard-stepper");
    if (!form || !grid || !templatePanel || !firstStep || !stepper) return false;

    if (templatePanel.parentElement !== firstStep) firstStep.prepend(templatePanel);
    if (stepper.nextElementSibling !== grid) grid.before(stepper);
    templatePanel.hidden = false;
    form.classList.add("wizard-layout-ready");
    return true;
  }

  if (repairWizardLayout()) return;
  const observer = new MutationObserver(() => {
    if (repairWizardLayout()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 10000);
})();