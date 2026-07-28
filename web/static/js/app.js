const statusElement = document.querySelector('#status');
const createButton = document.querySelector('#create-plan');

const dashboardData = {
  attention: [
    { icon: '✓', title: 'Confirma si vienes', detail: 'Cena de verano · Amigos', action: 'Responder' },
    { icon: '↻', title: 'La hora ha cambiado', detail: 'Pádel del jueves · ahora a las 20:00', action: 'Ver cambio' },
    { icon: '□', title: 'Te corresponde reservar la pista', detail: 'Antes del miércoles', action: 'Ver tarea' }
  ],
  today: [
    { time: '17:30', duration: '1 h', title: 'Recoger a Lucía', group: 'Familia', place: 'Colegio', status: 'Confirmado', color: '#d36c4d' },
    { time: '20:00', duration: '1 h 30', title: 'Partido de pádel', group: 'Pádel', place: 'Club Norte', status: 'Voy', color: '#2f7f73' }
  ],
  upcoming: [
    { day: 'Mañana', time: '18:00', title: 'Clase de natación', group: 'Extraescolares', status: 'Recurrente', color: '#4c6fb1' },
    { day: 'Viernes', time: '21:00', title: 'Cena de verano', group: 'Amigos', status: 'Falta tu respuesta', color: '#9463a7' },
    { day: 'Sábado', time: '13:30', title: 'Comida familiar', group: 'Familia', status: '8 personas', color: '#d36c4d' }
  ],
  groups: [
    { icon: '⌂', name: 'Familia', next: 'Recoger a Lucía · hoy', pending: '1 pendiente', color: '#d36c4d' },
    { icon: '●', name: 'Pádel', next: 'Partido · hoy a las 20:00', pending: '1 cambio', color: '#2f7f73' },
    { icon: '☺', name: 'Amigos', next: 'Cena · viernes', pending: '2 sin responder', color: '#9463a7' },
    { icon: '✎', name: 'Extraescolares', next: 'Natación · mañana', pending: 'Al día', color: '#4c6fb1' }
  ]
};

function escapeHTML(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showStatus(message) {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.classList.add('is-visible');
  window.clearTimeout(showStatus.timeoutId);
  showStatus.timeoutId = window.setTimeout(() => statusElement.classList.remove('is-visible'), 2600);
}

function renderAttention() {
  const container = document.querySelector('#attention-list');
  const count = document.querySelector('#attention-count');
  const section = container?.closest('section');
  if (!container || !count || !section) return;

  count.textContent = dashboardData.attention.length;
  count.setAttribute('aria-label', `${dashboardData.attention.length} elementos pendientes`);
  section.hidden = dashboardData.attention.length === 0;
  container.innerHTML = dashboardData.attention.map((item) => `
    <article class="attention-card">
      <span class="attention-card__icon" aria-hidden="true">${escapeHTML(item.icon)}</span>
      <div>
        <h3>${escapeHTML(item.title)}</h3>
        <p>${escapeHTML(item.detail)}</p>
      </div>
      <button class="action-button" type="button" data-action="${escapeHTML(item.action)}">${escapeHTML(item.action)}</button>
    </article>
  `).join('');
}

function planCard(plan) {
  return `
    <article class="plan-card" style="--group-color:${escapeHTML(plan.color)}" tabindex="0">
      <div class="plan-card__time">${escapeHTML(plan.time)}${plan.duration ? `<small>${escapeHTML(plan.duration)}</small>` : ''}</div>
      <div>
        <h3>${escapeHTML(plan.title)}</h3>
        <p>${escapeHTML(plan.group)}${plan.place ? ` · ${escapeHTML(plan.place)}` : ''}</p>
        <div class="plan-card__meta"><span class="tag">${escapeHTML(plan.status)}</span></div>
      </div>
      <span class="chevron" aria-hidden="true">›</span>
    </article>
  `;
}

function renderToday() {
  const container = document.querySelector('#today-list');
  if (!container) return;
  container.innerHTML = dashboardData.today.length
    ? dashboardData.today.map(planCard).join('')
    : '<div class="empty-state">Todavía no tienes planes para hoy.</div>';
}

function renderUpcoming() {
  const container = document.querySelector('#upcoming-list');
  if (!container) return;
  const grouped = dashboardData.upcoming.reduce((days, plan) => {
    (days[plan.day] ??= []).push(plan);
    return days;
  }, {});

  container.innerHTML = Object.entries(grouped).map(([day, plans]) => `
    <div class="day-group">
      <p class="day-group__label">${escapeHTML(day)}</p>
      ${plans.map(planCard).join('')}
    </div>
  `).join('');
}

function renderGroups() {
  const container = document.querySelector('#groups-list');
  if (!container) return;
  container.innerHTML = dashboardData.groups.map((group) => `
    <article class="group-card" style="--group-color:${escapeHTML(group.color)}" tabindex="0" role="button" aria-label="Abrir grupo ${escapeHTML(group.name)}">
      <div class="group-card__header">
        <span class="group-card__icon" aria-hidden="true">${escapeHTML(group.icon)}</span>
        <div><h3>${escapeHTML(group.name)}</h3><p>${escapeHTML(group.next)}</p></div>
      </div>
      <div class="group-card__footer">
        <strong>Próximo plan</strong>
        <strong class="group-card__pending">${escapeHTML(group.pending)}</strong>
      </div>
    </article>
  `).join('');
}

function setCurrentDate() {
  const dateElement = document.querySelector('#current-date');
  if (!dateElement) return;
  dateElement.textContent = new Intl.DateTimeFormat('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long'
  }).format(new Date());
}

function bindInteractions() {
  createButton?.addEventListener('click', () => showStatus('Creación rápida de planes: siguiente incremento.'));

  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]');
    if (action) showStatus(`${action.dataset.action}: flujo preparado para conectar con la API.`);

    const navigation = event.target.closest('[data-view]');
    if (navigation) {
      document.querySelectorAll('.bottom-nav__item').forEach((item) => {
        const active = item.dataset.view === navigation.dataset.view;
        item.classList.toggle('is-active', active);
        if (active) item.setAttribute('aria-current', 'page');
        else item.removeAttribute('aria-current');
      });
      if (navigation.dataset.view !== 'home') showStatus(`${navigation.textContent.trim()}: vista prevista para el próximo incremento.`);
    }

    const group = event.target.closest('.group-card');
    if (group) showStatus(`${group.getAttribute('aria-label')}: ficha de grupo pendiente de conectar.`);
  });
}

async function checkAPI() {
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('API unavailable');
    document.documentElement.dataset.apiStatus = 'connected';
  } catch {
    document.documentElement.dataset.apiStatus = 'offline';
    showStatus('No se pudo conectar con la API. Mostrando la agenda disponible.');
  }
}

function init() {
  setCurrentDate();
  renderAttention();
  renderToday();
  renderUpcoming();
  renderGroups();
  bindInteractions();
  checkAPI();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/static/service-worker.js'));
}

init();
