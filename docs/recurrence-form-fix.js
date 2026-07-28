(() => {
  const form = document.querySelector("#plan-form");
  if (!form) return;

  function isRecurring() {
    return form.querySelector('input[name="schedule_mode"][value="recurring"]')?.checked === true;
  }

  function setVisibility(field, hidden) {
    if (!field) return;
    if (field.hidden !== hidden) field.hidden = hidden;
    const currentDisplay = field.style.getPropertyValue("display");
    const currentPriority = field.style.getPropertyPriority("display");
    if (hidden) {
      if (currentDisplay !== "none" || currentPriority !== "important") {
        field.style.setProperty("display", "none", "important");
      }
    } else if (currentDisplay === "none") {
      field.style.removeProperty("display");
    }
    field.removeAttribute("aria-hidden");
  }

  function syncRecurringVisibility() {
    const recurring = isRecurring();
    const typeField = form.elements.type?.closest("label");
    const fixedDateField = document.querySelector("#fixed-date-field");
    const fixedDateInput = fixedDateField?.querySelector("input");

    setVisibility(typeField, recurring);
    setVisibility(fixedDateField, recurring);
    if (fixedDateInput && fixedDateInput.disabled !== recurring) fixedDateInput.disabled = recurring;
  }

  form.addEventListener("change", event => {
    if (!event.target.matches('input[name="schedule_mode"], #plan-type')) return;
    if (isRecurring() && form.elements.type?.closest("label")?.contains(document.activeElement)) {
      form.querySelector('input[name="schedule_mode"][value="recurring"]')?.focus({ preventScroll: true });
    }
    queueMicrotask(syncRecurringVisibility);
  }, true);

  new MutationObserver(() => queueMicrotask(syncRecurringVisibility)).observe(form, {
    subtree: true,
    childList: true
  });

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = String(init.method || (typeof input !== "string" ? input?.method : "GET") || "GET").toUpperCase();
    const isRecurrenceCreate = method === "POST" && /\/api\/v1\/plans\/[^/]+\/recurrence(?:\?|$)/.test(url);

    if (isRecurrenceCreate && typeof init.body === "string") {
      try {
        const payload = JSON.parse(init.body);
        const creatorEmail = form.elements.creator_email?.value?.trim().toLowerCase();
        if (creatorEmail) payload.actor_email = creatorEmail;
        init = { ...init, body: JSON.stringify(payload) };
      } catch {
        // Conserva la petición original si no contiene JSON válido.
      }
    }

    return nativeFetch(input, init);
  };

  syncRecurringVisibility();
})();