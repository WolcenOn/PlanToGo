(() => {
  const form = document.querySelector("#plan-form");
  const grid = form?.querySelector(".form-grid");
  const actions = form?.querySelector(".dialog-actions");
  if (!form || !grid || !actions) return;

  const TEMPLATE_KEY = "plantogo.eventTemplates";
  const builtIns = [
    { id: "barbecue", name: "Barbacoa", icon: "🔥", title: "Barbacoa", description: "Comida, bebida y organización entre todos.", mode: "meetup", type: "flexible", tasks: ["Comprar comida", "Llevar bebidas", "Preparar la barbacoa", "Recoger y limpiar"] },
    { id: "cinema", name: "Cine", icon: "🎬", title: "Ir al cine", description: "Elegir película y sesión.", mode: "cinema", type: "flexible", tasks: ["Elegir película", "Comprar entradas"] },
    { id: "trip", name: "Viaje", icon: "🧳", title: "Viaje", description: "Organización del viaje, transporte y alojamiento.", mode: "trip", type: "flexible", tasks: ["Reservar alojamiento", "Organizar transporte", "Preparar equipaje", "Revisar documentación"] },
    { id: "recurring", name: "Extraescolares", icon: "📚", title: "Actividad extraescolar", description: "Programación recurrente por días de la semana.", mode: "recurring", type: "flexible", tasks: ["Confirmar participantes", "Preparar material"] }
  ];

  let currentStep = 0;
  let tasks = [];

  const readCustomTemplates = () => {
    try { return JSON.parse(localStorage.getItem(TEMPLATE_KEY)) || []; } catch { return []; }
  };
  const writeCustomTemplates = value => localStorage.setItem(TEMPLATE_KEY, JSON.stringify(value));

  const templatePanel = document.createElement("section");
  templatePanel.className = "wizard-template-panel";
  templatePanel.innerHTML = `
    <div class="wizard-heading"><div><p class="eyebrow">Paso 1</p><h3>Empieza desde una plantilla</h3></div><button id="save-event-template" class="secondary-button" type="button">Guardar como plantilla</button></div>
    <div id="event-template-list" class="event-template-list"></div>`;
  grid.before(templatePanel);

  const stepper = document.createElement("ol");
  stepper.className = "wizard-stepper";
  stepper.innerHTML = ["Evento", "Fechas", "Grupos", "Tareas"].map((label, index) => `<li data-step="${index}"><span>${index + 1}</span>${label}</li>`).join("");
  templatePanel.before(stepper);

  const steps = [0, 1, 2, 3].map(index => {
    const section = document.createElement("section");
    section.className = "wizard-step";
    section.dataset.step = String(index);
    grid.append(section);
    return section;
  });

  const creatorName = form.elements.creator_name?.closest("label");
  const creatorEmail = form.elements.creator_email?.closest("label");
  const title = form.elements.title?.closest("label");
  const description = form.elements.description?.closest("label");
  const planType = form.elements.type?.closest("label");
  const fixedDate = document.querySelector("#fixed-date-field");
  const flexibleDates = document.querySelector("#flexible-dates-field");
  const location = form.elements.location_name?.closest("label");
  const address = form.elements.address?.closest("label");
  const groupField = document.querySelector(".group-publish-field");
  const modePanel = document.querySelector(".schedule-mode-panel");

  [creatorName, creatorEmail, title, description, modePanel].filter(Boolean).forEach(node => steps[0].append(node));
  [planType, fixedDate, flexibleDates, location, address].filter(Boolean).forEach(node => steps[1].append(node));
  if (groupField) steps[2].append(groupField);

  const dateHelp = document.createElement("div");
  dateHelp.className = "date-scope-helper";
  dateHelp.innerHTML = `<strong>Acotar propuestas</strong><small>Rellena rápidamente un intervalo y después ajusta las horas.</small><div><button type="button" data-range="weekend">Próximo fin de semana</button><button type="button" data-range="7">Próximos 7 días</button><button type="button" data-range="14">Próximas 2 semanas</button></div>`;
  steps[1].prepend(dateHelp);

  steps[3].innerHTML = `
    <div class="wizard-heading"><div><p class="eyebrow">Organización</p><h3>Tareas iniciales</h3><small>Son opcionales y quedarán libres para que cualquiera pueda elegirlas.</small></div></div>
    <div class="wizard-task-entry"><input id="wizard-task-input" maxlength="160" placeholder="Ej. Comprar bebidas"><button id="wizard-add-task" class="secondary-button" type="button">Añadir</button></div>
    <div id="wizard-task-list" class="wizard-task-list"></div>
    <article id="wizard-review" class="wizard-review"></article>`;

  const cancel = document.querySelector("#cancel-dialog");
  const submit = actions.querySelector('button[type="submit"]');
  const previous = document.createElement("button");
  previous.type = "button";
  previous.className = "secondary-button";
  previous.textContent = "Anterior";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "primary-button";
  next.textContent = "Siguiente";
  actions.insertBefore(previous, submit);
  actions.insertBefore(next, submit);
  if (cancel) cancel.textContent = "Cancelar";
  submit.textContent = "Crear evento";

  function renderTasks() {
    const list = document.querySelector("#wizard-task-list");
    list.innerHTML = tasks.length ? tasks.map((task, index) => `<div><span>${escapeText(task)}</span><button type="button" data-remove-task="${index}" aria-label="Eliminar tarea">×</button></div>`).join("") : '<p class="participant-empty">No hay tareas iniciales.</p>';
  }

  function addTask(value) {
    const clean = String(value || "").trim();
    if (!clean || tasks.some(task => task.toLowerCase() === clean.toLowerCase())) return;
    tasks.push(clean);
    renderTasks();
  }

  function templateCards() {
    return [...builtIns, ...readCustomTemplates()];
  }

  function renderTemplates() {
    document.querySelector("#event-template-list").innerHTML = templateCards().map(template => `
      <button type="button" class="event-template-card" data-template="${template.id}"><span>${template.icon || "✨"}</span><strong>${escapeText(template.name)}</strong><small>${escapeText(template.mode === "trip" ? "Inicio y fin" : template.mode === "recurring" ? "Días semanales" : "Propuestas rápidas")}</small></button>`).join("");
  }

  function applyTemplate(template) {
    form.elements.title.value = template.title || template.name || "";
    form.elements.description.value = template.description || "";
    if (form.elements.type) {
      form.elements.type.value = template.type || "flexible";
      form.elements.type.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const mode = form.querySelector(`input[name="schedule_mode"][value="${template.mode || "meetup"}"]`);
    if (mode) { mode.checked = true; mode.dispatchEvent(new Event("change", { bubbles: true })); }
    tasks = [...(template.tasks || [])];
    renderTasks();
  }

  function saveTemplate() {
    const name = prompt("Nombre de la plantilla");
    if (!name?.trim()) return;
    const custom = readCustomTemplates();
    custom.push({ id: `custom-${Date.now()}`, name: name.trim(), icon: "✨", title: form.elements.title.value, description: form.elements.description.value, type: form.elements.type.value, mode: form.querySelector('input[name="schedule_mode"]:checked')?.value || "meetup", tasks: [...tasks] });
    writeCustomTemplates(custom.slice(-12));
    renderTemplates();
  }

  function setRange(kind) {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    const start = new Date(now);
    const end = new Date(now);
    if (kind === "weekend") {
      const daysToSaturday = (6 - now.getDay() + 7) % 7 || 7;
      start.setDate(now.getDate() + daysToSaturday);
      start.setHours(12);
      end.setTime(start.getTime()); end.setDate(start.getDate() + 1);
    } else {
      start.setDate(now.getDate() + 1); start.setHours(18);
      end.setDate(start.getDate() + Number(kind) - 1); end.setHours(18);
    }
    const localValue = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const recurring = document.querySelector("#recurring-builder");
    if (recurring && !recurring.hidden) {
      document.querySelector("#recurring-from").value = localValue(start).slice(0, 10);
      document.querySelector("#recurring-to").value = localValue(end).slice(0, 10);
      return;
    }
    const rows = [...document.querySelectorAll("#date-option-inputs .date-option-input")];
    rows[0]?.querySelector(".option-start")?.setAttribute("value", localValue(start));
    rows[1]?.querySelector(".option-start")?.setAttribute("value", localValue(end));
    rows.slice(0, 2).forEach((row, index) => {
      const input = row.querySelector(".option-start");
      if (input) { input.value = localValue(index ? end : start); input.dispatchEvent(new Event("change", { bubbles: true })); }
    });
  }

  function validateStep() {
    const required = [...steps[currentStep].querySelectorAll("input[required],textarea[required],select[required]")].filter(input => !input.disabled && !input.closest("[hidden]"));
    const invalid = required.find(input => !input.checkValidity());
    if (invalid) { invalid.reportValidity(); return false; }
    return true;
  }

  function updateReview() {
    const selectedGroups = [...document.querySelectorAll("#plan-group-options input:checked")].map(input => input.closest("label")?.querySelector("span")?.textContent || "Grupo");
    document.querySelector("#wizard-review").innerHTML = `<strong>Resumen</strong><p>${escapeText(form.elements.title.value || "Sin título")}</p><small>${form.elements.type.value === "flexible" ? "Varias fechas para votar" : "Fecha fija"} · ${selectedGroups.length ? selectedGroups.map(escapeText).join(", ") : "Sin grupo"} · ${tasks.length} tareas</small>`;
  }

  function showStep(index) {
    currentStep = Math.max(0, Math.min(steps.length - 1, index));
    steps.forEach((step, stepIndex) => { step.hidden = stepIndex !== currentStep; });
    templatePanel.hidden = currentStep !== 0;
    stepper.querySelectorAll("li").forEach((item, stepIndex) => item.classList.toggle("active", stepIndex <= currentStep));
    previous.hidden = currentStep === 0;
    next.hidden = currentStep === steps.length - 1;
    submit.hidden = currentStep !== steps.length - 1;
    if (currentStep === steps.length - 1) updateReview();
  }

  next.addEventListener("click", () => { if (validateStep()) showStep(currentStep + 1); });
  previous.addEventListener("click", () => showStep(currentStep - 1));
  document.querySelector("#wizard-add-task").addEventListener("click", () => { const input = document.querySelector("#wizard-task-input"); addTask(input.value); input.value = ""; input.focus(); });
  document.querySelector("#wizard-task-input").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); document.querySelector("#wizard-add-task").click(); } });
  document.querySelector("#wizard-task-list").addEventListener("click", event => { const button = event.target.closest("[data-remove-task]"); if (!button) return; tasks.splice(Number(button.dataset.removeTask), 1); renderTasks(); });
  document.querySelector("#event-template-list").addEventListener("click", event => { const card = event.target.closest("[data-template]"); if (!card) return; const template = templateCards().find(item => item.id === card.dataset.template); if (template) applyTemplate(template); });
  document.querySelector("#save-event-template").addEventListener("click", saveTemplate);
  dateHelp.addEventListener("click", event => { const button = event.target.closest("[data-range]"); if (button) setRange(button.dataset.range); });
  document.querySelector("#new-plan-button")?.addEventListener("click", () => { tasks = []; renderTasks(); showStep(0); });
  form.addEventListener("reset", () => { tasks = []; renderTasks(); showStep(0); });

  window.PlanWizard = { getTasks: () => [...tasks] };
  renderTemplates();
  renderTasks();
  showStep(0);
})();
