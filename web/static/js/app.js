const statusElement = document.querySelector('#status');
const createButton = document.querySelector('#create-plan');

createButton?.addEventListener('click', () => {
  statusElement.textContent = 'El formulario de creación llegará en la siguiente iteración.';
});

async function checkAPI() {
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('API unavailable');
    statusElement.textContent = 'PlanToGo está conectado.';
  } catch {
    statusElement.textContent = 'No se pudo conectar con la API.';
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/static/service-worker.js'));
}

checkAPI();
