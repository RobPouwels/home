const endpoint = 'https://api.open-meteo.com/v1/forecast';
const cacheMs = 45 * 60_000;
const amsterdamDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Amsterdam', dateStyle: 'short' });

function configuredNumber(value) {
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
}

export function createSolarForecast(env, { fetchImpl = fetch, now = Date.now } = {}) {
  const latitude = configuredNumber(env.SOLAR_LATITUDE);
  const longitude = configuredNumber(env.SOLAR_LONGITUDE);
  const capacity = configuredNumber(env.SOLAR_CAPACITY_KWP);
  const configured = Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
  const hasCapacity = Number.isFinite(capacity) && capacity > 0;
  let cached;
  let pending;

  return async function forecast() {
    if (!configured) return { configured: false };
    const time = now();
    const day = amsterdamDay.format(time);
    if (cached?.day === day && time - cached.time < cacheMs) return cached.result;
    if (pending) return pending;

    pending = (async () => {
      const url = new URL(endpoint);
      url.search = new URLSearchParams({
        latitude: latitude.toFixed(2),
        longitude: longitude.toFixed(2),
        timezone: 'Europe/Amsterdam',
        forecast_days: '3',
        daily: 'shortwave_radiation_sum,weather_code',
      });
      try {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(6000) });
        if (!response.ok) throw new Error('Forecast failed');
        const { daily } = await response.json();
        const days = (daily?.time ?? []).flatMap((date, index) => {
          const radiation = daily.shortwave_radiation_sum?.[index];
          if (date < day || !Number.isFinite(radiation) || radiation < 0) return [];
          const sun = radiation / 3.6;
          return [{
            date,
            sun,
            weatherCode: daily.weather_code?.[index] ?? null,
            estimatedKwh: hasCapacity ? sun * capacity * 0.8 : null,
          }];
        });
        if (!days.length) throw new Error('Forecast empty');
        const result = { configured: true, days, fetchedAt: new Date(time).toISOString() };
        cached = { day, time, result };
        return result;
      } catch {
        // Briefly cache errors as well so several dashboards do not hammer the provider.
        const result = cached?.day === day && cached.result.days?.length
          ? { ...cached.result, stale: true }
          : { configured: true, unavailable: true };
        cached = { day, time: time - cacheMs + 5 * 60_000, result };
        return result;
      }
    })();

    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}
