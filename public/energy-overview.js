import { historyPoints } from './energy-charts.js';

const dateInAmsterdam = new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function isGridMeter(device) {
  return ['smartmeter', 'smart_meter'].includes(device.class)
    || /(?:^|:)com\.homewizard:(?:energy(?:_v2)?|cloud_p1)(?:$|:)/i.test(device.driverId || '')
    || /\bp1\b|slimme meter|smart meter|(?:^|[:.])p1(?:[-_.:]|$)/i.test(
      [device.name, device.driverId].join(' '),
    );
}

export function currentPower(devices) {
  const sources = devices.flatMap(device => {
    const capability = device.capabilitiesObj?.measure_power;
    const value = typeof capability === 'object' ? capability?.value : capability;
    return device.available !== false && Number.isFinite(value) ? [{ device, value }] : [];
  });
  return sources.find(({ device }) => isGridMeter(device)) ?? sources[0] ?? null;
}

export function isPowerLogFor(log, device) {
  if (!device) return false;
  const owner = 'homey:device:' + device.id;
  const id = log.id || '';
  const isOwned = log.ownerId === device.id || log.ownerUri === owner || log.uri === owner
    || id.startsWith(owner + ':');
  const isWatts = /^w$/i.test(String(log.units ?? log.unit ?? '').trim());
  const capability = id.split(':').at(-1);
  if (capability.startsWith('meter_') || capability.startsWith('measure_power.')) return false;
  return isOwned && (capability === 'measure_power' || isWatts);
}

export function todayPowerPoints(insights, device, now = new Date(), { keepMissing = false } = {}) {
  const today = dateInAmsterdam.format(now);
  for (const log of insights.filter(item => isPowerLogFor(item, device))) {
    const points = historyPoints(log.entries).filter(({ timestamp }) =>
      timestamp <= now && dateInAmsterdam.format(timestamp) === today);
    const measurements = points.filter(point => point.value !== null);
    if (measurements.length >= 2) return keepMissing ? points : measurements;
  }
  return [];
}
