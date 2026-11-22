import { historyPoints } from './energy-charts.js';
import { forecastDateKey } from './solar-weather.js';
import { isGridMeter, isPowerLogFor } from './energy-overview.js';

export function tariffValue(value) {
  if (typeof value !== 'string' || !/^\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const result = Number(value.trim().replace(',', '.'));
  return Number.isFinite(result) ? result : null;
}

function capability(device, key) {
  const value = device.capabilitiesObj?.[key];
  return value !== null && typeof value === 'object' ? value.value : value;
}

function logKey(log) {
  return String(log.id ?? '').split(':').at(-1);
}

function ownedBy(log, device) {
  const uri = 'homey:device:' + device.id;
  return log.ownerId === device.id || log.ownerUri === uri || log.uri === uri || String(log.id ?? '').startsWith(uri + ':');
}

export function dutchMidnight(now) {
  const day = forecastDateKey(now);
  const midnightUtc = Date.parse(day + 'T00:00:00Z');
  return [1, 2].map(hour => midnightUtc - hour * 3_600_000)
    .find(time => forecastDateKey(time) === day && forecastDateKey(time - 1) !== day);
}

function counterKeys(device) {
  const energy = device.energy ?? {};
  const stored = key => (device.capabilities ?? []).includes(key) || Object.hasOwn(device.capabilitiesObj ?? {}, key);
  return {
    imported: energy.cumulativeImportedCapability || energy.meterPowerImportedCapability
      || ['meter_power.consumed', 'meter_power.imported', 'meter_power'].find(stored),
    exported: energy.cumulativeExportedCapability || energy.meterPowerExportedCapability
      || ['meter_power.returned', 'meter_power.exported'].find(stored),
  };
}

export function isGridCounterLog(log, device) {
  if (!device || !ownedBy(log, device)) return false;
  const key = logKey(log);
  const { imported, exported } = counterKeys(device);
  return key === imported || key === exported;
}

function todayCounter(logs, meter, key, now) {
  if (!key) return null;
  const current = capability(meter, key);
  if (!Number.isFinite(current) || current < 0) return null;
  const points = historyPoints(logs.find(log => isGridCounterLog(log, meter) && logKey(log) === key)?.entries);
  const maxSkew = 15 * 60_000;
  const boundary = dutchMidnight(now);
  if (boundary === undefined) return null;
  const available = points.filter(point => point.value !== null && point.timestamp <= now);
  const baseline = available.filter(point => Math.abs(point.timestamp - boundary) <= maxSkew)
    .sort((a, b) => Math.abs(a.timestamp - boundary) - Math.abs(b.timestamp - boundary))[0];
  if (!baseline) return null;
  let previous = baseline.value;
  for (const { value, timestamp } of available) {
    if (timestamp <= baseline.timestamp) continue;
    if (value + 0.001 < previous) return null;
    previous = value;
  }
  if (current + 0.001 < previous) return null;
  return { kwh: Math.max(0, current - baseline.value), approximate: baseline.timestamp !== boundary };
}

export function gridDay(data, tariffs) {
  const meters = (data?.devices ?? []).filter(device => isGridMeter(device) && device.available !== false);
  const meter = meters.find(device => Number.isFinite(capability(device, counterKeys(device).imported))) ?? meters[0];
  const now = Date.parse(data?.updatedAt);
  const logs = data?.insights ?? [];
  const keys = meter ? counterKeys(meter) : {};
  const taken = meter && Number.isFinite(now) ? todayCounter(logs, meter, keys.imported, now) : null;
  const sent = meter && Number.isFinite(now) ? todayCounter(logs, meter, keys.exported, now) : null;
  const cost = taken && Number.isFinite(tariffs?.importRate) ? taken.kwh * tariffs.importRate : null;
  const credit = sent && Number.isFinite(tariffs?.exportRate) ? sent.kwh * tariffs.exportRate : null;
  return { taken, sent, cost, credit };
}

export function playback(devices) {
  return (devices ?? [])
    .filter(device => device.available !== false && /(?:^|:)com\.google\.chromecast(?:$|:)/i.test(
      [device.driverId, device.driverUri, device.ownerUri].filter(Boolean).join(':'),
    ))
    .map(device => {
      const active = capability(device, 'speaker_playing');
      const track = capability(device, 'speaker_track');
      const artist = capability(device, 'speaker_artist');
      return {
        name: device.name,
        active: typeof active === 'boolean' ? active : null,
        track: typeof track === 'string' ? track.trim() : '',
        artist: typeof artist === 'string' ? artist.trim() : '',
      };
    });
}

export function powerDirection(measurement, stale) {
  if (!Number.isFinite(measurement?.value)) return { state: 'unknown', label: 'Geen meting' };
  if (stale) return { state: 'unknown', label: 'Laatst bekende meting' };
  if (!isGridMeter(measurement.device)) return { state: 'unknown', label: 'Vermogen van één apparaat' };
  if (measurement.value < 0) return { state: 'export', label: 'Teruglevering' };
  return { state: 'no-export', label: measurement.value > 0 ? 'Netafname' : 'Geen teruglevering' };
}

export function serviceStatus(mode, devices) {
  const activeDevices = (devices ?? []).filter(device => device.available !== false);
  const isHomeWizard = activeDevices.some(device => /(?:^|:)com\.homewizard(?=:|$)/i.test(
    [device.driverId, device.driverUri, device.ownerUri].filter(Boolean).join(':'),
  ) || /\bhomewizard\b/i.test(device.name ?? ''));
  return {
    Homey: mode === 'online' ? 'online' : mode === 'demo' ? 'demo' : 'offline',
    Google: mode === 'online' ? (playback(activeDevices).length ? 'online' : 'unavailable') : 'unknown',
    Wizard: mode === 'online' ? (isHomeWizard ? 'online' : 'unavailable') : 'unknown',
  };
}

const amsterdamHour = new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam', hour: 'numeric', hourCycle: 'h23',
});

export function welcomeText(now = Date.now()) {
  const hour = Number(amsterdamHour.format(now));
  const timeOfDay = hour < 6 ? 'Goedenacht' : hour < 12 ? 'Goedemorgen' : hour < 18 ? 'Goedemiddag' : 'Goedenavond';
  return timeOfDay + ', welkom bij Hoefsetuin 32';
}
