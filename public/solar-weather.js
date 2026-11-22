const endpoint = 'https://api.open-meteo.com/v1/forecast';

export function weatherUrl({ latitude, longitude }) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    latitude, longitude,
    timezone: 'Europe/Amsterdam',
    forecast_days: '3',
    timeformat: 'unixtime',
    current: 'shortwave_radiation_instant',
    hourly: 'shortwave_radiation',
    daily: 'shortwave_radiation_sum,weather_code',
  });
  return url;
}

export function weatherRetryAt(header, now = Date.now()) {
  const value = header?.trim();
  const retry = /^\d+$/.test(value ?? '') ? now + Number(value) * 1000 : Date.parse(value);
  return Number.isFinite(retry) ? Math.max(now + 60_000, retry) : now + 60 * 60_000;
}

const amsterdamDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Amsterdam', calendar: 'iso8601', numberingSystem: 'latn',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

export function forecastDateKey(timestamp) {
  const parts = Object.fromEntries(amsterdamDay.formatToParts(timestamp).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function solarDays({ daily, utc_offset_seconds = 0 }, day, capacity) {
  return (daily?.time ?? []).flatMap((time, index) => {
    const date = Number.isFinite(time)
      ? new Date((time + utc_offset_seconds) * 1000).toISOString().slice(0, 10) : time;
    const radiation = daily.shortwave_radiation_sum?.[index];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        date < day || !Number.isFinite(radiation) || radiation < 0) return [];
    const sun = radiation / 3.6;
    return [{
      date,
      sun,
      weatherCode: daily.weather_code?.[index] ?? null,
      estimatedKwh: Number.isFinite(capacity) && capacity > 0 ? sun * capacity * 0.8 : null,
    }];
  });
}


export const hourMs = 3_600_000;

export function solarHours({ current, hourly }, capacity) {
  const hasCapacity = Number.isFinite(capacity) && capacity > 0;
  return {
    current: Number.isFinite(current?.shortwave_radiation_instant) && current.shortwave_radiation_instant >= 0
      ? { timestamp: current.time * 1000, radiation: current.shortwave_radiation_instant } : null,
    // The provider labels hourly averages by the end of the measured interval.
    hours: (hourly?.time ?? []).flatMap((time, index) => {
      const radiation = hourly.shortwave_radiation?.[index];
      if (!Number.isFinite(time) || !Number.isFinite(radiation) || radiation < 0) return [];
      return [{ timestamp: time * 1000 - hourMs, value: hasCapacity ? radiation * capacity * 0.8 / 1000 : radiation }];
    }),
    unit: hasCapacity ? 'kW' : 'W/m²',
  };
}

export function rollingSolar(solar, now = Date.now()) {
  const end = now + 24 * hourMs;
  const buckets = Array(24).fill(null);
  const coverage = Array(24).fill(0);
  for (const { timestamp, value } of solar?.hours ?? []) {
    const overlapStart = Math.max(now, timestamp);
    const overlapEnd = Math.min(timestamp + hourMs, end);
    if (overlapStart >= overlapEnd) continue;
    const first = Math.floor((overlapStart - now) / hourMs);
    const last = Math.min(23, Math.ceil((overlapEnd - now) / hourMs) - 1);
    for (let i = first; i <= last; i++) {
      const fraction = (Math.min(overlapEnd, now + (i + 1) * hourMs) -
        Math.max(overlapStart, now + i * hourMs)) / hourMs;
      buckets[i] = (buckets[i] ?? 0) + value * fraction;
      coverage[i] += fraction;
    }
  }
  const values = buckets.map((value, i) => coverage[i] >= 0.999 ? value : null);
  return {
    values,
    expectedKwh: solar?.unit === 'kW' && values.every(Number.isFinite) ? values.reduce((a, b) => a + b, 0) : null,
    radiation: solar?.current && Math.abs(now - solar.current.timestamp) <= 2 * hourMs ? solar.current.radiation : null,
  };
}
