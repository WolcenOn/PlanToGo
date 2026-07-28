(() => {
  const groupsList = document.querySelector("#groups-list");
  const detailDialog = document.querySelector("#group-detail-dialog");
  let activeGroupID = "";

  function inviteURL(code) {
    const url = new URL(location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("group_invite", code);
    return url.toString();
  }

  async function shareText(title, url, button) {
    const text = `Te invito a unirte al grupo ${title} en PlanToGo.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Invitación a ${title}`, text, url });
        if (button) button.textContent = "Compartido";
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        if (button) button.textContent = "Copiado";
      }
    } catch (error) {
      if (error?.name !== "AbortError") throw error;
    } finally {
      if (button) setTimeout(() => { button.textContent = "Compartir"; }, 1600);
    }
  }

  async function generateInvite(group, input, button) {
    button.disabled = true;
    const previous = button.textContent;
    button.textContent = "Generando…";
    try {
      const body = await fetchJSON(`${API_BASE_URL}/api/v1/groups/${encodeURIComponent(group.id)}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actor_email: state.profile.email })
      });
      const url = inviteURL(body.code);
      input.value = url;
      input.hidden = false;
      button.textContent = "Compartir";
      button.dataset.ready = "true";
      button.onclick = () => shareText(group.name, url, button);
      await navigator.clipboard?.writeText(url).catch(() => {});
    } catch (error) {
      button.textContent = error.message || "Error";
      setTimeout(() => { button.textContent = previous; }, 1800);
    } finally {
      button.disabled = false;
    }
  }

  function decorateGroupCards() {
    const groups = state.groups || [];
    groupsList?.querySelectorAll(".group-card[data-group-id]").forEach(card => {
      if (card.querySelector(".group-invite-tools")) return;
      const group = groups.find(item => item.id === card.dataset.groupId);
      if (!group || group.role !== "admin") return;
      const tools = document.createElement("div");
      tools.className = "group-invite-tools";
      tools.addEventListener("click", event => event.stopPropagation());
      tools.addEventListener("keydown", event => event.stopPropagation());
      const input = document.createElement("input");
      input.type = "url";
      input.readOnly = true;
      input.hidden = true;
      input.setAttribute("aria-label", `Enlace de invitación de ${group.name}`);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button";
      button.textContent = "Generar enlace";
      button.addEventListener("click", () => generateInvite(group, input, button));
      tools.append(input, button);
      card.append(tools);
    });
  }

  async function loadPendingRequests(group) {
    const list = document.querySelector("#group-join-requests");
    if (!list) return;
    list.innerHTML = "<p>Cargando solicitudes…</p>";
    try {
      const body = await fetchJSON(`${API_BASE_URL}/api/v1/groups/${encodeURIComponent(group.id)}/join-requests?email=${encodeURIComponent(state.profile.email)}`);
      const requests = body.requests || [];
      list.innerHTML = requests.length ? "" : "<p>No hay solicitudes pendientes.</p>";
      requests.forEach(request => {
        const row = document.createElement("article");
        row.className = "group-request-row";
        row.innerHTML = `<div><strong>${escapeText(request.name)}</strong><small>${escapeText(request.email)}</small></div>`;
        const approve = document.createElement("button");
        approve.type = "button";
        approve.className = "primary-button";
        approve.textContent = "Aceptar";
        approve.addEventListener("click", async () => {
          approve.disabled = true;
          approve.textContent = "Aceptando…";
          try {
            await fetchJSON(`${API_BASE_URL}/api/v1/groups/${encodeURIComponent(group.id)}/join-requests/${encodeURIComponent(request.id)}/approve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ actor_email: state.profile.email })
            });
            await loadPendingRequests(group);
            await loadDashboard();
          } catch (error) {
            approve.textContent = error.message || "Error";
            approve.disabled = false;
          }
        });
        row.append(approve);
        list.append(row);
      });
    } catch (error) {
      list.innerHTML = `<p class="error">${escapeText(error.message)}</p>`;
    }
  }

  function ensureAdminPanel(group) {
    if (!detailDialog || group.role !== "admin") return;
    let panel = detailDialog.querySelector("#group-invite-panel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "group-invite-panel";
      panel.className = "group-invite-panel";
      panel.innerHTML = `<div><p class="eyebrow">Invitaciones</p><h3>Invitar y aprobar miembros</h3><p>Genera un enlace. La persona solicitará acceso y tú decidirás si aceptarla.</p></div><div class="group-invite-link"><input id="group-invite-link" type="url" readonly hidden aria-label="Enlace de invitación"><button id="generate-group-invite" class="secondary-button" type="button">Generar enlace</button></div><div><h4>Solicitudes pendientes</h4><div id="group-join-requests"></div></div>`;
      detailDialog.querySelector("form")?.insertBefore(panel, detailDialog.querySelector("#group-admin-actions"));
    }
    const input = panel.querySelector("#group-invite-link");
    const button = panel.querySelector("#generate-group-invite");
    button.onclick = () => generateInvite(group, input, button);
    loadPendingRequests(group);
  }

  groupsList?.addEventListener("click", event => {
    const card = event.target.closest(".group-card[data-group-id]");
    if (!card) return;
    activeGroupID = card.dataset.groupId;
    setTimeout(() => {
      const group = (state.groups || []).find(item => item.id === activeGroupID);
      if (group) ensureAdminPanel(group);
    }, 80);
  }, true);

  new MutationObserver(decorateGroupCards).observe(groupsList || document.body, { childList: true, subtree: true });
  decorateGroupCards();

  async function showJoinDialog(code) {
    const dialog = document.createElement("dialog");
    dialog.className = "dialog group-join-dialog";
    dialog.innerHTML = `<form id="group-join-form"><div class="dialog-heading"><div><p class="eyebrow">Invitación de grupo</p><h2 id="join-group-title">Cargando…</h2></div><button class="icon-button" type="button" aria-label="Cerrar">×</button></div><p id="join-group-description"></p><p>Envía tu solicitud. El administrador deberá aceptarla antes de que puedas acceder al grupo.</p><div class="form-grid"><label>Nombre<input name="name" required maxlength="100"></label><label>Email<input name="email" type="email" required></label></div><p id="join-group-status" class="status" role="status"></p><div class="dialog-actions"><button class="primary-button" type="submit">Solicitar acceso</button></div></form>`;
    document.body.append(dialog);
    const close = () => dialog.close ? dialog.close() : dialog.removeAttribute("open");
    dialog.querySelector(".icon-button").addEventListener("click", close);
    dialog.showModal ? dialog.showModal() : dialog.setAttribute("open", "");
    const status = dialog.querySelector("#join-group-status");
    try {
      const group = await fetchJSON(`${API_BASE_URL}/api/v1/public/groups/${encodeURIComponent(code)}`);
      dialog.querySelector("#join-group-title").textContent = group.name;
      dialog.querySelector("#join-group-description").textContent = group.description || "";
      const form = dialog.querySelector("#group-join-form");
      if (state.profile) {
        form.elements.name.value = state.profile.name || "";
        form.elements.email.value = state.profile.email || "";
      }
      form.addEventListener("submit", async event => {
        event.preventDefault();
        status.textContent = "Enviando solicitud…";
        try {
          const data = Object.fromEntries(new FormData(form));
          const response = await fetchJSON(`${API_BASE_URL}/api/v1/public/groups/${encodeURIComponent(code)}/requests`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
          });
          status.textContent = response.status === "already_member" ? "Ya perteneces a este grupo." : "Solicitud enviada. El administrador debe aceptarla.";
          form.querySelector("button[type=submit]").disabled = true;
        } catch (error) {
          status.textContent = error.message;
          status.classList.add("error");
        }
      });
    } catch (error) {
      dialog.querySelector("#join-group-title").textContent = "Invitación no disponible";
      status.textContent = error.message;
      status.classList.add("error");
    }
  }

  const code = new URL(location.href).searchParams.get("group_invite");
  if (code) showJoinDialog(code);
})();
