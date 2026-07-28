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

  async function copyLink(url) {
    await navigator.clipboard.writeText(url);
  }

  async function sharePlan({ title, url }) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `Te invito a ${title}`, url });
        return "shared";
      } catch (error) {
        if (error?.name === "AbortError") return "cancelled";
      }
    }
    await copyLink(url);
    return "copied";
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
      if (!plan?.public_token || card.querySelector(".plan-share-tools")) return;
      const link = publicURL(plan.public_token);
      const sharing = document.createElement("div");
      sharing.className = "plan-share-tools";
      sharing.innerHTML = `<label>Enlace para compartir<input type="text" readonly value="${escapeText(link)}" aria-label="Enlace público de ${escapeText(plan.title)}"></label><button type="button" class="secondary-button" data-share-plan>Compartir</button>`;
      sharing.querySelector("input").addEventListener("click", event => event.target.select());
      sharing.querySelector("[data-share-plan]").addEventListener("click", async event => {
        event.stopPropagation();
        const button = event.currentTarget;
        try {
          const result = await sharePlan({ title: plan.title, url: link });
          button.textContent = result === "copied" ? "Copiado" : result === "shared" ? "Compartido" : "Compartir";
          setTimeout(() => { button.textContent = "Compartir"; }, 1800);
        } catch {
          button.textContent = "No se pudo compartir";
        }
      });
      card.append(sharing);
    });
  };

  if (state.plans?.length) renderPlans();
})();