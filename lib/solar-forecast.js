const endpoint = 'https://api.open-meteo.com/v1/forecast';
const cacheMs = 45 * 60_000;
const amsterdamDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam', calendar: 'iso8601', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

export function forecastDateKey(timestamp) {
  const parts = Object.fromEntries(amsterdamDay.formatToParts(timestamp).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function fetchWeather(url, fetchImpl) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) });
    } catch (error) {
      if (attempt === 0) continue;
      const failure = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network';
      return { failure };
    }
    if (response.ok) return { response };
    if (response.status >= 500 && attempt === 0) {
      await response.body?.cancel().catch(() => {});
      continue;
    }
    return { failure: 'provider-http', providerStatus: response.status };
  }
}

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
    const day = forecastDateKey(time);
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
      const { response, failure, providerStatus } = await fetchWeather(url, fetchImpl);
      function unavailable(reason) {
        const diagnostic = { reason, ...(providerStatus ? { providerStatus } : {}) };
        const result = cached?.day === day && cached.result.days?.length
          ? { ...cached.result, stale: true, ...diagnostic }
          : { configured: true, unavailable: true, ...diagnostic };
        cached = { day, time: time - cacheMs + 5 * 60_000, result };
        return result;
      }
      if (!response) return unavailable(failure);
      try {
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
        if (!days.length) return unavailable('empty');
        const result = { configured: true, days, fetchedAt: new Date(time).toISOString() };
        cached = { day, time, result };
        return result;
      } catch {
        return unavailable('invalid-response');
      }
    })();

    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
}
