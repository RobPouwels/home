import { forecastDateKey, solarDays, weatherRetryAt, weatherUrl } from '../public/solar-weather.js';

const cacheMs = 45 * 60_000;

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
    return { failure: 'provider-http', providerStatus: response.status, retryAfter: response.headers.get('Retry-After') };
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
  let retryAt = 0;
  const weatherLocation = configured ? { latitude: latitude.toFixed(2), longitude: longitude.toFixed(2),
    capacity: hasCapacity ? capacity : null } : null;

  return async function forecast() {
    if (!configured) return { configured: false };
    const time = now();
    const day = forecastDateKey(time);
    if (time < retryAt) {
      return { configured: true, unavailable: true, reason: 'provider-http', providerStatus: 429,
        retryAt, browserForecast: weatherLocation,
        ...(cached?.day === day && cached.result.days?.length ? {
          unavailable: false, stale: true, days: cached.result.days, fetchedAt: cached.result.fetchedAt,
        } : {}),
      };
    }
    if (cached?.day === day && time - cached.time < cacheMs) return cached.result;
    if (pending) return pending;

    pending = (async () => {
      const { response, failure, providerStatus, retryAfter } = await fetchWeather(weatherUrl(weatherLocation), fetchImpl);
      function unavailable(reason) {
        const diagnostic = { reason, ...(providerStatus ? { providerStatus } : {}) };
        if (providerStatus === 429) {
          retryAt = weatherRetryAt(retryAfter, now());
          Object.assign(diagnostic, { retryAt, browserForecast: weatherLocation });
        }
        const result = cached?.day === day && cached.result.days?.length
          ? { ...cached.result, stale: true, ...diagnostic }
          : { configured: true, unavailable: true, ...diagnostic };
        cached = { day, time: time - cacheMs + (providerStatus === 429 ? 0 : 5 * 60_000), result };
        return result;
      }
      if (!response) return unavailable(failure);
      try {
        const days = solarDays(await response.json(), day, weatherLocation.capacity);
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
