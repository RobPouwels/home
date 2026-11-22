import { sign } from 'node:crypto';
import { forecastDateKey, hourMs } from '../public/solar-weather.js';

const googleTokenUrl = 'https://oauth2.googleapis.com/token';
const calendarScope = 'https://www.googleapis.com/auth/calendar.events.readonly';
const timeout = () => AbortSignal.timeout(10_000);
const base64Json = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function signedAssertion(account, time) {
  const issued = Math.floor(time / 1000);
  const header = base64Json({ alg: 'RS256', typ: 'JWT', kid: account.private_key_id });
  const claims = base64Json({
    iss: account.client_email, scope: calendarScope, aud: googleTokenUrl,
    iat: issued, exp: issued + 3600,
  });
  const message = header + '.' + claims;
  return message + '.' + sign('RSA-SHA256', Buffer.from(message), account.private_key).toString('base64url');
}

export function calendarItems(items) {
  return (Array.isArray(items) ? items : []).flatMap(event => {
    const allDay = Boolean(event?.start?.date);
    const start = allDay ? event.start.date : event?.start?.dateTime;
    if (event?.status === 'cancelled' || typeof start !== 'string' || !Number.isFinite(Date.parse(start))) return [];
    const privateEvent = event.visibility === 'private' || event.visibility === 'confidential';
    return [{ start, allDay, title: privateEvent ? 'Bezet' : String(event.summary || 'Afspraak').slice(0, 160) }];
  });
}

export function createCalendar(env, { fetchImpl = fetch, now = Date.now } = {}) {
  const id = env.GOOGLE_CALENDAR_ID?.trim();
  const credentials = env.GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON?.trim();
  let account;
  try { account = JSON.parse(credentials || '{}'); } catch { account = {}; }
  let token;
  let result;
  let refreshAt = 0;
  let pending;

  async function authorize(time) {
    if (token?.expires > time + 60_000) return token.value;
    const response = await fetchImpl(googleTokenUrl, {
      method: 'POST', signal: timeout(), redirect: 'error',
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signedAssertion(account, time),
      }),
    });
    if (!response.ok) throw new Error('calendar-auth');
    const { access_token: value, expires_in: seconds } = await response.json();
    if (typeof value !== 'string' || !(seconds > 0)) throw new Error('calendar-auth');
    token = { value, expires: time + seconds * 1000 };
    return token.value;
  }

  return async function calendar() {
    if (!id || !credentials) return { configured: false };
    if (!account?.client_email || !account.private_key) return { configured: true, unavailable: true, reason: 'credentials' };
    const time = now();
    if (pending) return pending;
    if (time < refreshAt) return result;
    pending = (async () => {
      try {
        const url = new URL('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(id) + '/events');
        url.search = new URLSearchParams({
          singleEvents: 'true', orderBy: 'startTime', maxResults: '6',
          timeMin: new Date(time).toISOString(), timeMax: new Date(time + 7 * 24 * hourMs).toISOString(),
          timeZone: 'Europe/Amsterdam', fields: 'items(summary,start,status,visibility)',
        });
        const response = await fetchImpl(url, {
          headers: { Authorization: 'Bearer ' + await authorize(time) }, signal: timeout(), redirect: 'error',
        });
        if (response.status === 401) token = undefined;
        if (!response.ok) {
          result = { configured: true, unavailable: true, reason: [403, 404].includes(response.status) ? 'sharing' : 'provider' };
        } else {
          const { items } = await response.json();
          result = { configured: true, events: calendarItems(items) };
        }
      } catch {
        result = { configured: true, unavailable: true, reason: 'provider' };
      }
      refreshAt = now() + 5 * 60_000;
      return result;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}

export function pricePoints(rows) {
  return (Array.isArray(rows) ? rows : []).flatMap(row => {
    const validTime = typeof row?.datum === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(row.datum);
    const timestamp = validTime ? Date.parse(row.datum) : NaN;
    const raw = row?.prijsVDB;
    const value = typeof raw === 'number' || (typeof raw === 'string' && /^-?\d+(?:\.\d+)?$/.test(raw.trim()))
      ? Number(raw) : NaN;
    return Number.isFinite(timestamp) && Number.isFinite(value) ? [{ timestamp, value }] : [];
  });
}

export function createVandebronPrices(env, { fetchImpl = fetch, now = Date.now } = {}) {
  const token = env.ENEVER_TOKEN?.trim();
  const days = new Map();
  const publicationTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Amsterdam', hour: '2-digit', hourCycle: 'h23',
  });
  const tomorrowOf = day => new Date(Date.parse(day + 'T00:00:00Z') + 24 * hourMs).toISOString().slice(0, 10);

  async function readDay(day, feed, time) {
    const cached = days.get(day);
    if (cached && (cached.pending || cached.retryAt > time)) return cached.pending ?? cached.points;
    const pending = (async () => {
      let points = [];
      try {
        const url = new URL('https://enever.nl/apiv3/stroomprijs_' + feed + '.php');
        url.search = new URLSearchParams({ token, price: 'prijsVDB', resolution: '60' });
        const response = await fetchImpl(url, { signal: timeout(), redirect: 'error' });
        if (response.ok) {
          const payload = await response.json();
          points = pricePoints(payload.data).filter(point => forecastDateKey(point.timestamp) === day);
        }
      } catch {
        // The dashboard shows available prices only and retries after the cache interval.
      }
      const retryDelay = (feed === 'morgen' ? 4 : 6) * hourMs;
      days.set(day, { points, retryAt: points.length ? Infinity : time + retryDelay });
      return points;
    })();
    days.set(day, { pending });
    return pending;
  }

  return async function vandebronPrices() {
    if (!token) return { configured: false };
    const time = now();
    const today = forecastDateKey(time);
    const tomorrow = tomorrowOf(today);
    for (const day of days.keys()) {
      if (day < today) days.delete(day);
    }
    const [current, next] = await Promise.all([
      readDay(today, 'vandaag', time),
      Number(publicationTime.format(time)) >= 16 || days.has(tomorrow) ? readDay(tomorrow, 'morgen', time) : [],
    ]);
    const from = Math.floor(time / hourMs) * hourMs;
    const unique = new Map([...current, ...next].map(point => [point.timestamp, point]));
    const points = [...unique.values()].filter(point => point.timestamp >= from && point.timestamp < from + 24 * hourMs)
      .sort((a, b) => a.timestamp - b.timestamp);
    return { configured: true, points };
  };
}
