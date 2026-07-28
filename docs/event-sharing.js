(() => {
  const form = document.querySelector("#plan-form");
  const plansList = document.querySelector("#plans-list");
  const statusNode = document.querySelector("#form-status");
  if (!form || !plansList || !statusNode) return;

  function resetSingleEventMode() {
    const meetup = form.querySelector('input[name="schedule_mode"][value="meetup"]');
    if (meetup) {
      meetup.checked = true;
      meetup.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (form.elements.type) {
      form.elements.type.value = "fixed";
      form.elements.type.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const dateInput = form.elements.confirmed_date;
    if (dateInput) {
      dateInput.disabled = false;
      dateInput.required = true;
      dateInput.closest("label")?.removeAttribute("hidden");
      dateInput.closest("label")?.style.removeProperty("display");
    }
  }

  document.querySelector("#new-plan-button")?.addEventListener("click", () => queueMicrotask(resetSingleEventMode));

  async function sharePlan({ title, url }) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `Te invito a ${title}`, url });
        return "shared";
      } catch (error) {
        if (error?.name === "AbortError") return "cancelled";
      }
    }
    await navigator.clipboard.writeText(url);
    return "copied";
  }

  async function generatePlanLink(plan) {
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/plans/${encodeURIComponent(plan.id)}/share-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor_email: state.profile.email })
    });
    return publicURL(body.public_token);
  }

  let lastSharedURL = "";
  new MutationObserver(async () => {
    const linkNode = statusNode.querySelector("a[href]");
    const url = linkNode?.href;
    if (!url || url === lastSharedURL) return;
    lastSharedURL = url;
    const title = form.elements.title?.value?.trim() || "Nuevo evento";
    try {
      const result = await sharePlan({ title, url });
      if (result === "copied") statusNode.firstChild.textContent = "Evento creado. Enlace copiado al portapapeles. ";
      if (result === "shared") statusNode.firstChild.textContent = "Evento creado y compartido. ";
    } catch {
      // El enlace sigue visible aunque el navegador bloquee compartir o copiar.
    }
  }).observe(statusNode, { childList: true, subtree: true });

  const originalRenderPlans = renderPlans;
  renderPlans = function renderPlansWithSharing() {
    originalRenderPlans();
    document.querySelectorAll("#plans-list .plan-card").forEach((card, index) => {
      const plan = filteredPlans()[index];
      if (!plan || plan.ownership !== "own" || card.querySelector(".plan-share-tools")) return;
      const sharing = document.createElement("div");
      sharing.className = "plan-share-tools";
      sharing.innerHTML = `<label>Enlace para compartir<input type="text" readonly placeholder="Pulsa Generar enlace" aria-label="Enlace público de ${escapeText(plan.title)}"></label><button type="button" class="secondary-button" data-share-plan>Generar enlace</button>`;
      const input = sharing.querySelector("input");
      const button = sharing.querySelector("[data-share-plan]");
      input.addEventListener("click", event => event.target.select());
      button.addEventListener("click", async event => {
        event.stopPropagation();
        button.disabled = true;
        try {
          if (!input.value) {
            button.textContent = "Generando…";
            input.value = await generatePlanLink(plan);
          }
          button.textContent = "Compartir";
          const result = await sharePlan({ title: plan.title, url: input.value });
          button.textContent = result === "copied" ? "Copiado" : result === "shared" ? "Compartido" : "Compartir";
          setTimeout(() => { button.textContent = "Compartir"; }, 1800);
        } catch (error) {
          button.textContent = error.message || "No se pudo compartir";
        } finally {
          button.disabled = false;
        }
      });
      card.append(sharing);
    });
  };

  if (state.plans?.length) renderPlans();
})();

import("./group-invitations.js?v=23").catch(error => console.error("No se pudo cargar invitaciones de grupo", error));
