const groupDialog = document.querySelector("#group-dialog");
const groupForm = document.querySelector("#group-form");
const groupStatus = document.querySelector("#group-status");

function setGroupStatus(message, isError = false) {
  groupStatus.textContent = message;
  groupStatus.classList.toggle("error", isError);
}

function closeGroupDialog() {
  if (groupDialog.close) groupDialog.close(); else groupDialog.removeAttribute("open");
}

document.querySelector("#new-group-button").addEventListener("click", event => {
  event.preventDefault();
  event.stopImmediatePropagation();
  setGroupStatus("");
  groupForm.reset();
  if (groupDialog.showModal) groupDialog.showModal(); else groupDialog.setAttribute("open", "");
}, true);

document.querySelector("#close-group-dialog").addEventListener("click", closeGroupDialog);
document.querySelector("#cancel-group-dialog").addEventListener("click", closeGroupDialog);

groupForm.addEventListener("submit", async event => {
  event.preventDefault();
  if (!state.profile?.email) {
    setGroupStatus("Configura primero tu perfil.", true);
    return;
  }
  const data = Object.fromEntries(new FormData(groupForm));
  data.creator_name = state.profile.name;
  data.creator_email = state.profile.email;
  setGroupStatus("Creando grupo…");
  try {
    await fetchJSON(`${API_BASE_URL}/api/v1/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    setGroupStatus("Grupo creado.");
    await loadDashboard();
    setTimeout(closeGroupDialog, 400);
  } catch (error) {
    setGroupStatus(error.message === "Failed to fetch" ? "No se pudo conectar con Railway." : error.message, true);
  }
});
