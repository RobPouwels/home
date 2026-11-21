const dateInAmsterdam = new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function isGridMeter(device) {
  return ['smartmeter', 'smart_meter'].includes(device.class)
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
  const isWatts = /^w$/i.test((log.units ?? log.unit ?? '').trim());
  const isPower = /(?:^|:)measure_power$/.test(id);
  return isOwned && (isPower || isWatts);
}

export function todayPowerPoints(insights, device, now = new Date()) {
  const today = dateInAmsterdam.format(now);
  for (const log of insights.filter(item => isPowerLogFor(item, device))) {
    const entries = log.entries;
    const rows = Array.isArray(entries) ? entries : entries?.values ?? entries?.data;
    if (!Array.isArray(rows)) continue;
    const points = rows.flatMap(row => {
      const timestamp = Date.parse(row?.t ?? row?.timestamp);
      const value = row?.v ?? row?.value;
      if (!Number.isFinite(timestamp) || !Number.isFinite(value) || timestamp > now
          || dateInAmsterdam.format(timestamp) !== today) return [];
      return [{ timestamp, value }];
    });
    if (points.length >= 2) return points.sort((a, b) => a.timestamp - b.timestamp);
  }
  return [];
}
