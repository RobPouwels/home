const clock = new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit',
});
const number = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 6 });
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export function historyPoints(entries) {
  const rows = Array.isArray(entries) ? entries : entries?.values ?? entries?.data;
  if (!Array.isArray(rows)) return [];
  const values = new Map();
  for (const row of rows) {
    const timestamp = Date.parse(row?.t ?? row?.timestamp);
    const value = row?.v ?? row?.value ?? row?.y;
    if (Number.isFinite(timestamp)) {
      values.set(timestamp, Number.isFinite(value) ? value : null);
    }
  }
  return [...values].sort(([a], [b]) => a - b)
    .map(([timestamp, value]) => ({ timestamp, value }));
}

function signedRuns(points, gridPower) {
  const runs = [];
  let run;
  function add(direction, start, end) {
    if (run?.direction === direction && run.points.at(-1) === start) {
      run.points.push(end);
    } else {
      run = { direction, points: [start, end] };
      runs.push(run);
    }
  }
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const end = points[i];
    if (start.value === null || end.value === null) continue;
    if (!gridPower) {
      add('neutral', start, end);
    } else if (start.value * end.value < 0) {
      const ratio = start.value / (start.value - end.value);
      const zero = { timestamp: start.timestamp + ratio * (end.timestamp - start.timestamp), value: 0 };
      add(start.value > 0 ? 'import' : 'export', start, zero);
      add(end.value > 0 ? 'import' : 'export', zero, end);
    } else {
      const value = start.value || end.value;
      add(value > 0 ? 'import' : value < 0 ? 'export' : 'neutral', start, end);
    }
  }
  return runs;
}

export function energyChart(points, { gridPower = false, unit = '' } = {}) {
  const measurements = points.filter(point => Number.isFinite(point.value));
  if (measurements.length < 2) return '';
  const start = measurements[0].timestamp;
  const end = measurements.at(-1).timestamp;
  if (start === end) return '';

  const values = measurements.map(point => point.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (gridPower) {
    const bound = Math.max(Math.abs(min), Math.abs(max), 1);
    const step = 10 ** Math.floor(Math.log10(bound));
    max = Math.ceil(bound / step) * step;
    min = -max;
  } else if (min === max) {
    const padding = Math.abs(min) * 0.02 || 1;
    min -= padding;
    max += padding;
  }
  const x = timestamp => ((timestamp - start) / (end - start) * 500).toFixed(2);
  const y = value => (4 + (max - value) / (max - min) * 92).toFixed(2);
  const middle = gridPower ? 0 : (min + max) / 2;
  const baseline = gridPower ? middle : min;
  const guides = [max, middle, min].map(value => {
    const className = gridPower && value === 0 ? ' chart-zero' : '';
    return `<path class="chart-guide${className}" d="M0 ${y(value)}H500"/>`;
  }).join('');
  const runs = signedRuns(points, gridPower);
  const fills = [];
  const lines = [];
  for (const { direction, points: run } of runs) {
    const line = 'M' + run.map(point => `${x(point.timestamp)},${y(point.value)}`).join('L');
    if (direction !== 'neutral') {
      fills.push(`<path class="chart-area chart-${direction}" d="${line}L${x(run.at(-1).timestamp)},${y(baseline)}H${x(run[0].timestamp)}Z"/>`);
    }
    lines.push(`<path class="chart-trace chart-${direction}" d="${line}"/>`);
  }
  // An isolated reading remains visible when there is a missing sample on each side.
  const connected = new Set(runs.flatMap(run => run.points));
  const dots = measurements.filter(point => !connected.has(point)).map(point => {
    const px = x(point.timestamp);
    const py = y(point.value);
    const direction = gridPower && point.value !== 0 ? (point.value > 0 ? 'import' : 'export') : 'neutral';
    return `<path class="chart-trace chart-${direction}" d="M${px},${py}v0.01"/>`;
  }).join('');
  const axis = [max, middle, min].map(value =>
    `<span>${gridPower && value > 0 ? '+' : ''}${number.format(value)}${unit ? ' ' + escapeHtml(unit) : ''}</span>`
  ).join('');
  const legend = gridPower ? `<ul class="chart-legend" aria-hidden="true">
    <li><span class="chart-import"></span>Netafname (+)</li>
    <li><span class="chart-export"></span>Teruglevering (−)</li>
  </ul>` : '';
  const label = gridPower ? 'Netafname boven nul, teruglevering onder nul' : 'Meetwaarden in de tijd';
  return `<div class="energy-chart" role="img" aria-label="${label}">
    ${legend}
    <div class="chart-plot" aria-hidden="true">
      <div class="chart-y">${axis}</div>
      <svg viewBox="0 0 500 100" preserveAspectRatio="none">${fills.join('')}${guides}${lines.join('')}${dots}</svg>
      <div class="chart-x"><time>${clock.format(start)}</time><time>${clock.format((start + end) / 2)}</time><time>${clock.format(end)}</time></div>
    </div>
  </div>`;
}
