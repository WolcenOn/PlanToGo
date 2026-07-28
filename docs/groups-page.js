(() => {
  const dashboardView = document.querySelector("#dashboard-view");
  const groupsSection = document.querySelector("#groups-section");
  const topbarTitle = document.querySelector(".topbar h1");
  const topbarEyebrow = document.querySelector(".topbar .eyebrow");
  const topbarActions = document.querySelector(".topbar-actions");
  if (!dashboardView || !groupsSection || !topbarTitle || !topbarActions) return;

  const groupsView = document.createElement("section");
  groupsView.id = "groups-view";
  groupsView.hidden = true;
  groupsView.innerHTML = `
    <div class="groups-page-heading">
      <button type="button" id="back-to-dashboard" class="secondary-button">← Volver al dashboard</button>
      <div><p class="eyebrow">Tu gente</p><h2>Grupos</h2><p>Gestiona miembros, invitaciones y los planes compartidos de cada grupo.</p></div>
    </div>`;
  groupsView.append(groupsSection);
  dashboardView.after(groupsView);

  function currentView() {
    return new URL(window.location.href).searchParams.get("view") === "groups" ? "groups" : "dashboard";
  }

  function setView(view, { history = true } = {}) {
    const groups = view === "groups";
    dashboardView.hidden = groups;
    groupsView.hidden = !groups;
    topbarTitle.textContent = groups ? "Grupos" : "Dashboard";
    if (topbarEyebrow) topbarEyebrow.textContent = groups ? "Organización" : "Tu espacio";
    topbarActions.hidden = groups;
    document.body.classList.toggle("groups-page-active", groups);

    if (history) {
      const url = new URL(window.location.href);
      if (groups) url.searchParams.set("view", "groups");
      else url.searchParams.delete("view");
      historyPush(url);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function historyPush(url) {
    window.history.pushState({ view: url.searchParams.get("view") || "dashboard" }, "", url);
  }

  document.querySelector("#back-to-dashboard")?.addEventListener("click", () => setView("dashboard"));
  window.addEventListener("popstate", () => setView(currentView(), { history: false }));

  const statCards = [...document.querySelectorAll(".stat-card")];
  const groupsCard = statCards[3];
  if (groupsCard) {
    const replacement = groupsCard.cloneNode(true);
    groupsCard.replaceWith(replacement);
    replacement.tabIndex = 0;
    replacement.setAttribute("role", "link");
    replacement.setAttribute("aria-label", "Abrir la página de grupos");
    const openGroups = () => setView("groups");
    replacement.addEventListener("click", openGroups);
    replacement.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openGroups();
      }
    });
  }

  setView(currentView(), { history: false });
})();
