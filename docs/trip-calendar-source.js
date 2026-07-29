(() => {
  const trips = new Map();
  window.PlanTripCalendar = { trips };

  const dayStart = value => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const score = interval => (Number(interval?.yes) || 0) * 2 + (Number(interval?.maybe) || 0);

  function selectedInterval(trip, plan) {
    const intervals = Array.isArray(trip?.intervals) ? trip.intervals : [];
    if (!intervals.length) return null;
    if (trip.status === "confirmed") {
      const explicit = intervals.find(interval => interval.confirmed);
      if (explicit) return explicit;
      if (plan?.confirmed_date) {
        const confirmed = new Date(plan.confirmed_date).getTime();
        const matched = intervals.find(interval => Math.abs(new Date(interval.start_time).getTime() - confirmed) < 60000);
        if (matched) return matched;
      }
      return null;
    }
    return intervals.reduce((best, interval) => !best || score(interval) > score(best) ? interval : best, null);
  }

  function validRange(interval) {
    if (!interval?.start_time || !interval?.end_time) return null;
    const start = dayStart(interval.start_time).getTime();
    const end = dayStart(interval.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return { start, end };
  }

  async function loadTripIntervals() {
    if (!state?.profile?.email) {
      trips.clear();
      return;
    }
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/calendar/trip-intervals?email=${encodeURIComponent(state.profile.email)}`);
    const nextTrips = new Map();
    for (const trip of body?.plans || []) nextTrips.set(trip.plan_id, trip);
    trips.clear();
    nextTrips.forEach((trip, id) => trips.set(id, trip));
  }

  const baseLoadDashboard = loadDashboard;
  loadDashboard = async function loadDashboardWithPersistedTrips() {
    await baseLoadDashboard();
    try {
      await loadTripIntervals();
      renderDashboard();
    } catch (error) {
      console.error("No se pudieron cargar los intervalos de viaje", error);
      renderDashboard();
    }
  };

  const basePlansForDate = plansForDate;
  plansForDate = function plansForDateWithPersistedTrips(date) {
    const target = dayStart(date).getTime();
    const originalPlans = basePlansForDate(date);
    const replacedTripIDs = new Set();
    const travelPlans = [];

    for (const plan of state.plans || []) {
      const trip = trips.get(plan.id);
      if (!trip) continue;
      const interval = selectedInterval(trip, plan);
      const range = validRange(interval);
      if (!range) continue;

      replacedTripIDs.add(plan.id);
      if (target < range.start || target > range.end) continue;
      plan._calendarPending = trip.status !== "confirmed";
      plan._calendarSegment = range.start === range.end ? "single" : target === range.start ? "start" : target === range.end ? "end" : "middle";
      plan._calendarTripInterval = interval;
      travelPlans.push(plan);
    }

    const base = originalPlans.filter(plan => !replacedTripIDs.has(plan.id));
    return [...base, ...travelPlans];
  };

  const baseRenderPlanDetail = renderPlanDetail;
  renderPlanDetail = function renderTripDetailWithoutGenericDate() {
    baseRenderPlanDetail();
    if (!currentDetail?.id) return;
    const trip = trips.get(currentDetail.id);
    const dateInput = detailEditForm?.elements?.confirmed_date;
    const dateLabel = dateInput?.closest("label");
    if (dateLabel) {
      dateLabel.hidden = Boolean(trip);
      dateLabel.style.display = trip ? "none" : "";
    }
    if (dateInput) {
      dateInput.disabled = Boolean(trip);
      if (trip) dateInput.value = "";
    }
    const votingTitle = document.querySelector("#detail-voting h3");
    if (trip && votingTitle) votingTitle.textContent = trip.status === "confirmed" ? "Intervalo confirmado" : "Intervalos disponibles";
  };

  queueMicrotask(async () => {
    try {
      await loadTripIntervals();
    } catch (error) {
      console.error("No se pudieron cargar los intervalos de viaje", error);
    }
    renderDashboard();
  });
})();