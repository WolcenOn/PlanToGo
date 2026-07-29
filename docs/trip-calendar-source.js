(() => {
  const trips = new Map();
  window.PlanTripCalendar = { trips };

  const dayStart = value => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  };

  const score = interval => (Number(interval?.yes) || 0) * 2 + (Number(interval?.maybe) || 0);

  function selectedInterval(trip) {
    const intervals = Array.isArray(trip?.intervals) ? trip.intervals : [];
    if (!intervals.length) return null;
    if (trip.status === "confirmed") {
      return intervals.find(interval => interval.confirmed) || null;
    }
    return intervals.reduce((best, interval) => !best || score(interval) > score(best) ? interval : best, null);
  }

  async function loadTripIntervals() {
    if (!state?.profile?.email) {
      trips.clear();
      return;
    }
    const body = await fetchJSON(`${API_BASE_URL}/api/v1/calendar/trip-intervals?email=${encodeURIComponent(state.profile.email)}`);
    trips.clear();
    for (const trip of body?.plans || []) trips.set(trip.plan_id, trip);
  }

  const baseLoadDashboard = loadDashboard;
  loadDashboard = async function loadDashboardWithPersistedTrips() {
    await baseLoadDashboard();
    try {
      await loadTripIntervals();
      renderDashboard();
    } catch (error) {
      console.error("No se pudieron cargar los intervalos de viaje", error);
    }
  };

  const basePlansForDate = plansForDate;
  plansForDate = function plansForDateWithPersistedTrips(date) {
    const target = dayStart(date).getTime();
    const base = basePlansForDate(date).filter(plan => !trips.has(plan.id));
    const travelPlans = (state.plans || []).filter(plan => {
      const trip = trips.get(plan.id);
      if (!trip) return false;
      const interval = selectedInterval(trip);
      if (!interval?.start_time || !interval?.end_time) return false;
      const start = dayStart(interval.start_time).getTime();
      const end = dayStart(interval.end_time).getTime();
      if (target < start || target > end) return false;
      plan._calendarPending = trip.status !== "confirmed";
      plan._calendarSegment = start === end ? "single" : target === start ? "start" : target === end ? "end" : "middle";
      plan._calendarTripInterval = interval;
      return true;
    });
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
      renderDashboard();
    } catch (_) {}
  });
})();
