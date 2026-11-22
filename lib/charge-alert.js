import { currentPower, isGridMeter } from '../public/energy-overview.js';

const minute = 60_000;

export function chargeAlertSettings(env) {
  if (!env.CHARGE_SURPLUS_W?.trim()) return null;
  const thresholdW = Number(env.CHARGE_SURPLUS_W);
  const minutes = Number(env.CHARGE_SURPLUS_MINUTES ?? 10);
  if (!Number.isFinite(thresholdW) || thresholdW <= 0 || !Number.isInteger(minutes) || minutes < 2 || minutes > 120) {
    throw new Error('Controleer CHARGE_SURPLUS_W en CHARGE_SURPLUS_MINUTES.');
  }
  return { thresholdW, sustainMs: minutes * minute, meterId: env.CHARGE_METER_ID?.trim() || null,
    homeyUserId: env.CHARGE_HOMEY_USER_ID?.trim() || null };
}

export async function isChargeUserHome(api, homeyGet, userId) {
  const id = userId ?? (await homeyGet(api, '/api/manager/users/user/me'))?.id;
  if (typeof id !== 'string' || !id.trim()) return false;
  const presence = await homeyGet(api, '/api/manager/presence/' + encodeURIComponent(id) + '/present');
  return presence === true || presence?.present === true;
}

export function createChargeCheck({ thresholdW, sustainMs, meterId, now = Date.now }) {
  let since;
  let lastSample;
  let lastMeter;
  let generation = 0;

  return async function check(devices, readPresence) {
    const meters = devices.filter(device => meterId ? device.id === meterId : isGridMeter(device));
    const reading = meters.length === 1 ? currentPower(meters) : null;
    const time = now();
    const capability = reading?.device.capabilitiesObj?.measure_power;
    const measuredAt = Date.parse(capability?.lastUpdated ?? capability?.lastChanged);
    if (!reading || !Number.isFinite(measuredAt) || measuredAt > time + minute ||
        time - measuredAt > 5 * minute || reading.value > -thresholdW) {
      since = lastSample = lastMeter = undefined;
      generation++;
      return null;
    }

    if (lastSample === undefined || time - lastSample > 2 * minute || lastMeter !== reading.device.id) {
      since = time;
      generation++;
    }
    lastSample = time;
    lastMeter = reading.device.id;
    if (time - since < sustainMs) return null;

    const checkedGeneration = generation;
    if (await readPresence() !== true || checkedGeneration !== generation) return null;
    return { exportW: -reading.value };
  };
}
