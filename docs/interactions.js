document.addEventListener("DOMContentLoaded", () => {
  const dialog = document.querySelector("#plan-dialog");
  const newPlanButton = document.querySelector("#new-plan-button");
  const closeButtons = [document.querySelector("#close-dialog"), document.querySelector("#cancel-dialog")];
  const groupButton = document.querySelector("#new-group-button");

  if (newPlanButton && dialog && typeof dialog.showModal !== "function") {
    newPlanButton.addEventListener("click", () => {
      dialog.setAttribute("open", "");
    });
  }

  if (dialog && typeof dialog.close !== "function") {
    closeButtons.forEach(button => button?.addEventListener("click", () => dialog.removeAttribute("open")));
  }

  groupButton?.addEventListener("click", () => {
    window.alert("La creación de grupos será el siguiente módulo funcional de PlanToGo.");
  });

  document.querySelectorAll("[data-scroll]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item === button));
    });
  });

  navigator.serviceWorker?.getRegistrations().then(registrations => {
    registrations.forEach(registration => registration.update());
  });
});
