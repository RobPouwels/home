const endpoint = 'https://api.open-meteo.com/v1/forecast';

export function weatherUrl({ latitude, longitude }) {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    latitude, longitude,
    timezone: 'Europe/Amsterdam',
    forecast_days: '3',
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

export function solarDays({ daily }, day, capacity) {
  return (daily?.time ?? []).flatMap((date, index) => {
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
