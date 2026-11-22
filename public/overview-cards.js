import { gridDay, playback } from './overview-data.js';
import { forecastDateKey, hourMs, rollingSolar } from './solar-weather.js';

const number = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' });
const rateNumber = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 5 });
const date = new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric', month: 'short',
});
const clock = new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit',
});
const find = id => document.getElementById(id);
const write = (id, value) => { find(id).textContent = value; };
const withUnit = (value, unit) => Number.isFinite(value) ? number.format(value) + ' ' + unit : '—';
const euros = value => Number.isFinite(value) ? money.format(value) : '—';

function plot(values, { kind, caption, label, format, highlight = -1 }) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return '';
  const high = Math.max(kind === 'sun' ? 0.1 : 1, ...valid);
  const low = Math.min(0, ...valid);
  const y = value => 4 + (high - value) / (high - low) * 92;
  const zero = y(0);
  const bars = values.map((value, index) => {
    const x = index * 10;
    if (!Number.isFinite(value)) {
      return `<path class="plot-missing" d="M${x + 1} ${zero}h8"/>`;
    }
    const barClass = index === highlight ? 'price-low' : kind + '-slot';
    return `<rect class="${barClass}" x="${x + 1}" y="${Math.min(y(value), zero)}" width="8" height="${Math.max(0.6, Math.abs(y(value) - zero))}"><title>+${index} uur · ${format(value)}</title></rect>`;
  }).join('');
  const labels = ['Nu', '+3 u', '+6 u', '+9 u', '+12 u', '+15 u', '+18 u', '+21 u', '+24 u'];
  return `<div class="forecast-plot"><p class="plot-caption">${caption}</p>
    <svg role="img" aria-label="${label}" viewBox="0 0 240 100" preserveAspectRatio="none">
      <path class="plot-zero" d="M0 ${zero}H240"/>${bars}
    </svg><div class="plot-axis" aria-hidden="true">${labels.map(item => `<span>${item}</span>`).join('')}</div></div>`;
}

export function renderSolarHours(solar) {
  const { values, expectedKwh, radiation } = rollingSolar(solar);
  write('solarExpected', withUnit(expectedKwh, 'kWh'));
  write('solarRadiation', withUnit(radiation, 'W/m²'));
  const unit = solar?.unit === 'kW' ? 'kW' : 'W/m²';
  const caption = unit === 'kW' ? 'Geschat vermogen per uur · kW' : 'Verwachte horizontale zoninstraling · W/m²';
  find('solarHours').innerHTML = plot(values, { kind: 'sun', caption, label: caption, format: value => withUnit(value, unit) });
}

export function renderCosts(data, tariffs, stale) {
  const demoTariffs = { importRate: 0.28, exportRate: 0.08 };
  const rates = data?.demo ? demoTariffs : tariffs;
  const isToday = Number.isFinite(Date.parse(data?.updatedAt)) &&
    forecastDateKey(Date.parse(data.updatedAt)) === forecastDateKey(Date.now());
  const { taken, sent, cost, credit } = gridDay(isToday ? data : null, rates);
  const reading = item => item ? (item.approximate ? '≈ ' : '') + withUnit(item.kwh, 'kWh') : '—';
  write('gridImport', reading(taken));
  write('gridExport', reading(sent));
  write('gridCost', euros(cost));
  write('gridCredit', euros(credit));
  const notes = [];
  if (data?.demo) notes.push('Demo.');
  if (stale && isToday) notes.push('Laatst bekend.');
  if (!taken) notes.push('Geen P1-dagstand.');
  if (Number.isFinite(rates?.importRate)) notes.push(rateNumber.format(rates.importRate) + ' €/kWh afname.');
  else notes.push('Stel je afnametarief in bij Render.');
  if (taken || sent) notes.push('Excl. vaste kosten en saldering.');
  write('costNote', notes.join(' '));
}

function fillList(id, rows) {
  const list = find(id);
  list.replaceChildren(...rows.map(({ title, detail }) => {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    const description = document.createElement('small');
    name.textContent = title;
    description.textContent = detail;
    item.append(name, description);
    return item;
  }));
  list.hidden = rows.length === 0;
}

export function renderMusic(data, stale) {
  const devices = playback(data?.devices);
  const playing = devices.filter(device => device.active);
  fillList('musicList', playing.map(device => ({
    title: device.track || 'Media wordt afgespeeld',
    detail: [device.artist, device.name].filter(Boolean).join(' · '),
  })));
  const status = playing.length
    ? data.demo ? 'Voorbeeld via de Homey-demo.' : stale ? 'Laatst bekende afspeelstatus via Homey.' : 'Afspeelstatus via Homey.'
    : stale ? 'Actuele afspeelstatus kon niet worden opgehaald.'
      : !devices.length ? 'Voeg je speaker toe via Chromecast in Homey.'
        : devices.some(device => device.active === false) ? 'Geen actieve weergave gemeld.'
          : 'Geen afspeelstatus beschikbaar.';
  write('musicStatus', status);
}

export function renderFeeds(feeds) {
  const { agenda, prices } = feeds ?? {};
  const items = agenda?.events ?? [];
  fillList('agendaList', items.map(event => ({
    title: event.title,
    detail: event.allDay
      ? date.format(new Date(event.start + 'T12:00:00Z')) + ' · Hele dag'
      : date.format(new Date(event.start)) + ' · ' + clock.format(new Date(event.start)),
  })));
  write('agendaStatus', !feeds ? 'Agenda tijdelijk niet beschikbaar.'
    : !agenda?.configured ? 'Koppel een gedeelde Google-agenda via Render.'
      : agenda.unavailable ? 'Agenda niet bereikbaar. Controleer de instellingen en deelrechten.'
        : items.length ? '' : 'Geen afspraken in de komende zeven dagen.');
  find('agendaStatus').hidden = items.length > 0;

  const start = Math.floor(Date.now() / hourMs) * hourMs;
  const byTime = new Map((prices?.points ?? []).map(point => [point.timestamp, point.value]));
  const values = Array.from({ length: 24 }, (_, i) => {
    const value = byTime.get(start + i * hourMs);
    return Number.isFinite(value) ? value * 100 : null;
  });
  const known = values.filter(Number.isFinite).length;
  const best = known ? values.indexOf(Math.min(...values.filter(Number.isFinite))) : -1;
  write('priceNow', withUnit(values[0], 'ct/kWh'));
  write('priceLow', best < 0 ? '—' : withUnit(values[best], 'ct/kWh') + ' · ' + clock.format(start + best * hourMs));
  find('priceChart').innerHTML = plot(values, {
    kind: 'price', caption: 'Uurprijzen · ct/kWh · groen markeert het goedkoopste uur',
    label: 'Vandebron-uurprijzen voor de komende 24 uur in cent per kilowattuur',
    format: value => withUnit(value, 'ct/kWh'), highlight: best,
  });
  write('priceStatus', !feeds ? 'Prijsfeed tijdelijk niet beschikbaar.'
    : !prices?.configured ? 'Stel je Enever-token in bij Render.'
      : !known ? 'Tarieven tijdelijk niet beschikbaar.'
        : `${known} van 24 uren beschikbaar via Enever, inclusief btw.`);
}
