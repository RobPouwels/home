import { currentPower, isGridMeter, todayPowerPoints } from './energy-overview.js';

const $=s=>document.querySelector(s);const $$=s=>[...document.querySelectorAll(s)];let demo=true,live=false,data=null,config=null,stale=false;const favDevices=JSON.parse(localStorage.getItem('thuis_fav_devices')||'["d1","d2","d3"]');const favFlows=JSON.parse(localStorage.getItem('thuis_fav_flows')||'["f1","f2"]');
const icons={light:'☼',socket:'⏻',sensor:'◉',other:'⌂'};function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2600)}
let homeyRetryAt = 0;
async function api(url,opts={}){
const homeyReadOrControl = /^\/api\/homey\/(?:data|device\/|flow\/)/.test(url);
if (homeyReadOrControl && Date.now() < homeyRetryAt) {
  throw new Error('Homey begrenst de aanvragen tijdelijk. Probeer het na de wachttijd opnieuw.');
}
const r=await fetch(url,{credentials:'same-origin',...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});let j={};try{j=await r.json()}catch{}if (r.status === 429 && homeyReadOrControl) {
  const retry = Number(j.retryAfter ?? r.headers.get('Retry-After') ?? 120);
  homeyRetryAt = Math.max(homeyRetryAt, Date.now() + (Number.isFinite(retry) ? Math.max(1, retry) : 120) * 1000);
}
if(!r.ok)throw new Error(j.error||`Fout ${r.status}`);return j}
function showPage(p){$$('.page').forEach(x=>x.classList.toggle('active',x.id===`page-${p}`));$$('[data-page]').forEach(button => {
  const current = button.dataset.page === p;
  button.classList.toggle('active', current);
  if (current) button.setAttribute('aria-current', 'page');
  else button.removeAttribute('aria-current');
});$('#pageName').textContent=({overzicht:'Overzicht',apparaten:'Apparaten',flows:'Flows',energie:'Energie',cameras:'Camera’s',bespaartips:'Bespaartips',informatie:'Handleiding & roadmap',instellingen:'Instellingen'})[p]||p;}
function getCap(d,c){return d.capabilitiesObj?.[c]?.value??d.capabilitiesObj?.[c]??null}function isOn(d){return Boolean(getCap(d,'onoff'))}function roomName(d){return data?.zones?.find(z=>z.id===d.zone||z.id===d.zoneId)?.name||d.zoneName||'Onbekende kamer'}
function deviceCard(d){const canOn=d.capabilities?.includes('onoff'),canDim=d.capabilities?.includes('dim');const on=isOn(d);return `<article class="device-card"><div class="device-top"><div class="device-icon">${icons[d.class]||icons.other}</div><div style="min-width:0"><div class="device-name">${esc(d.name)}</div><div class="device-room">${esc(roomName(d))}</div></div><button class="fav-star ${favDevices.includes(d.id)?'selected':''}" data-fav-device="${d.id}" title="Favoriet">★</button><span class="device-state ${on?'':'off'}">${canOn?(on?'Aan':'Uit'):'Beschikbaar'}</span></div><div class="device-controls">${canDim?`<input class="dim-control" aria-label="Dimmen ${esc(d.name)}" type="range" min="0" max="1" step=".01" value="${getCap(d,'dim')??0}" data-dim="${d.id}" ${!live&&!demo?'disabled':''}>`:canOn?`<span class="control-hint">${on?'Ingeschakeld':'Uitgeschakeld'}</span>`:`<span class="control-hint">Alleen uitlezen</span>`}${canOn?`<button class="switch ${on?'on':''}" aria-label="Schakel ${esc(d.name)}" aria-pressed="${on}" data-toggle="${d.id}" ${!live&&!demo?'disabled':''}></button>`:''}</div></article>`}
function flowRow(f){return `<div class="flow-row"><span class="flow-symbol">⌁</span><div><b>${esc(f.name)}</b><small>${f.advanced?'Advanced Flow':'Gewone Flow'}</small></div><button class="fav-star ${favFlows.includes(f.id)?'selected':''}" data-fav-flow="${f.id}" title="Favoriet">★</button><button data-flow="${f.id}">Start →</button></div>`}
function render(){if(!data)return;$('#deviceCount').textContent=data.devices.length;$('#flowCount').textContent=data.flows.length;const fav=data.devices.filter(d=>favDevices.includes(d.id)).slice(0,3);$('#favoriteDevices').innerHTML=fav.map(deviceCard).join('')||'<p class="muted">Nog geen favorieten.</p>';$('#allDevices').innerHTML=data.devices.map(deviceCard).join('');$('#favoriteFlows').innerHTML=data.flows.filter(f=>favFlows.includes(f.id)).map(flowRow).join('');$('#allFlows').innerHTML=data.flows.map(f=>`<article class="flow-card"><span class="flow-symbol">⌁</span><div><b>${esc(f.name)}</b><small>${f.advanced?'Advanced Flow':'Gewone Flow'} · ${f.enabled===false?'Uitgeschakeld':'Beschikbaar'}</small></div><button class="fav-star ${favFlows.includes(f.id)?'selected':''}" data-fav-flow="${f.id}" title="Favoriet">★</button><button class="primary" data-flow="${f.id}">Start</button></article>`).join('');$('#roomFilter').innerHTML='<option value="all">Alle kamers</option>'+data.zones.map(z=>`<option value="${z.id}">${esc(z.name)}</option>`).join('');renderEnergy();$('#lastUpdated').textContent=`Bijgewerkt ${new Date(data.updatedAt).toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})}`;renderOverviewEnergy();bindControls();}
const energyNumber = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 });
const energyTime = new Intl.DateTimeFormat('nl-NL', {
  timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit',
});

function renderOverviewEnergy() {
  const measurement = currentPower(data.devices);
  const { device, value } = measurement ?? {};
  const formatted = measurement ? energyNumber.format(value) : '—';
  const lookupTime = new Date(data.updatedAt);
  const timeLabel = Number.isFinite(lookupTime.getTime()) ? energyTime.format(lookupTime) : '';
  const origin = data.demo ? 'Demo' : 'via Homey';
  const direction = !measurement ? 'Geen actuele vermogensmeting beschikbaar' : isGridMeter(device)
    ? value < 0 ? 'Teruglevering' : value > 0 ? 'Netafname' : 'Geen netstroom'
    : 'Vermogen van één apparaat';
  const description = measurement ? [direction, device.name, origin].join(' · ') : direction;

  for (const id of ['powerValue', 'overviewEnergyPower']) {
    $(`#${id}`).innerHTML = `${formatted} <small>W</small>`;
  }
  $('#powerType').textContent = description;
  $('#powerMeta').textContent = timeLabel
    ? `${stale ? 'Laatst bekend' : 'Opgehaald'} om ${timeLabel}`
    : '';
  $('#overviewEnergyStatus').textContent = stale ? 'LAATST BEKEND' : data.demo ? 'DEMO' : measurement ? 'LIVE' : '–';
  $('#overviewEnergySource').textContent = description;
  const points = todayPowerPoints(data.insights ?? [], device);
  const chart = $('#overviewEnergyChart');
  chart.hidden = points.length < 2;
  if (chart.hidden) {
    chart.replaceChildren();
    $('#overviewEnergyHistory').textContent = 'Geen vermogensgrafiek voor vandaag beschikbaar.';
    return;
  }

  const start = points[0].timestamp;
  const end = points.at(-1).timestamp;
  const values = points.map(point => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const line = points.map(({ timestamp, value }, index) => {
    const x = end === start ? index * 500 / (points.length - 1) : (timestamp - start) * 500 / (end - start);
    const y = 92 - (value - min) * 84 / range;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  chart.innerHTML = `<svg role="img" aria-label="Vermogen vandaag in watt" viewBox="0 0 500 100" preserveAspectRatio="none"><polyline points="${line}" fill="none" stroke="#73b6a2" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`;
  $('#overviewEnergyHistory').textContent = `Vandaag · ${energyTime.format(start)}–${energyTime.format(end)} · ${points.length} metingen`;
}

function renderEnergy(){const found=[];for(const d of data.devices){for(const c of d.capabilities||[]){if(/measure_power|meter_power|measure_energy|meter_gas|meter_water/.test(c)){const val=getCap(d,c);found.push({d,c,val,unit:d.capabilitiesObj?.[c]?.units||d.capabilitiesObj?.[c]?.unit||(c.includes('power')?'W':'kWh')});}}}$('#energyCards').innerHTML=found.length?found.map(x=>`<article class="energy-tile"><small>${esc(x.d.name)}</small><strong>${x.val??'—'} <em>${esc(x.unit)}</em></strong><small>${x.c.includes('meter_')?'Meterstand':x.c==='measure_power'?'Actueel vermogen':'Meetwaarde'} · via Homey</small></article>`).join(''):'<article class="energy-tile"><small>Geen HomeWizard-meetwaarden gevonden</small><strong>—</strong><small>Koppel HomeWizard in Homey en vernieuw</small></article>';const hist=(data.insights||[]).map(l=>({name:l.title||l.name||l.id,rows:Array.isArray(l.entries)?l.entries:(l.entries?.values||l.entries?.data||[])})).filter(x=>x.rows.length);if(hist.length){$('#historyContent').innerHTML=hist.map(h=>`<div class="history-line"><b>${esc(h.name)}</b><small>${h.rows.length} meetpunten · afzonderlijke reeks</small>${historySvg(h.rows)}</div>`).join('')+'<a class="link-btn" href="https://my.homey.app/" target="_blank" rel="noreferrer">Open volledige Homey Insights ↗</a>';}else{$('#historyContent').innerHTML='<p class="muted">Er is nog geen geschikte Homey Insights-historie gevonden voor deze meetwaarden. De daggrafiek verschijnt zodra Homey geschikte logboeken beschikbaar stelt.</p><a class="link-btn" href="https://my.homey.app/" target="_blank" rel="noreferrer">Open Homey Insights ↗</a>';}}
function historySvg(rows){const pts=rows.map(r=>({v:Number(r.v??r.value??r.y),t:r.t??r.timestamp})).filter(p=>Number.isFinite(p.v));if(pts.length<2)return '<small class="muted">Onvoldoende meetpunten voor een grafiek.</small>';const vals=pts.map(p=>p.v),min=Math.min(...vals),max=Math.max(...vals),span=max-min||1;const poly=pts.map((p,i)=>`${(i/(pts.length-1))*500},${88-((p.v-min)/span)*76}`).join(' ');return `<svg class="history-svg" viewBox="0 0 500 100" preserveAspectRatio="none"><polyline points="${poly}" fill="none" stroke="#4b9b7d" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg><small class="muted">${min.toFixed(0)} – ${max.toFixed(0)} ${esc(rows[0]?.unit||'')}</small>`;}
function bindControls(){$$('[data-fav-device]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.favDevice;const i=favDevices.indexOf(id);if(i>=0)favDevices.splice(i,1);else favDevices.push(id);localStorage.setItem('thuis_fav_devices',JSON.stringify(favDevices));render();}));$$('[data-fav-flow]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.favFlow;const i=favFlows.indexOf(id);if(i>=0)favFlows.splice(i,1);else favFlows.push(id);localStorage.setItem('thuis_fav_flows',JSON.stringify(favFlows));render();}));$$('[data-toggle]').forEach(b=>b.addEventListener('click',()=>changeDevice(b.dataset.toggle,'onoff',!isOn(data.devices.find(d=>d.id===b.dataset.toggle)))));$$('[data-dim]').forEach(b=>b.addEventListener('change',()=>changeDevice(b.dataset.dim,'dim',Number(b.value))));$$('[data-flow]').forEach(b=>b.addEventListener('click',()=>startFlow(b.dataset.flow)));}
async function changeDevice(id,capability,value){if(!demo&&!live){toast('Bediening gepauzeerd: Homey is niet verbonden.');return;}const d=data.devices.find(x=>x.id===id);if(demo){d.capabilitiesObj[capability].value=value;render();toast(`${d.name}: ${capability==='dim'?'dimniveau aangepast':value?'ingeschakeld':'uitgeschakeld'} (demo)`);return;}try{await api(`/api/homey/device/${encodeURIComponent(id)}/capability`,{method:'POST',body:JSON.stringify({capability,value})});await loadData();toast('Opdracht uitgevoerd en status vernieuwd.');}catch(e){toast(`Niet gelukt: ${e.message}`);}}
async function startFlow(id){if(!demo&&!live){toast('Bediening gepauzeerd: Homey is niet verbonden.');return;}if(demo){toast('Demo: Flow gestart (geen echt apparaat aangestuurd).');return;}try{await api(`/api/homey/flow/${encodeURIComponent(id)}/start`,{method:'POST',body:'{}'});toast('Flow-startopdracht verzonden.');}catch(e){toast(`Flow niet gestart: ${e.message}`);}}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
let loadSequence = 0;
let pendingLoads = 0;

async function loadData() {
  if (!demo && Date.now() < homeyRetryAt) {
    toast('Homey heeft de aanvragen tijdelijk begrensd. Automatisch vernieuwen hervat na de wachttijd.');
    return;
  }
  const request = ++loadSequence;
  const useDemo = demo;
  pendingLoads++;
  try {
    const result = await api(useDemo ? '/api/demo' : '/api/homey/data');
    if (request !== loadSequence || useDemo !== demo) return;
    data = result;
    live = true;
    stale = false;
    setConnection(useDemo ? 'demo' : 'online');
    render();
  } catch (error) {
    if (request !== loadSequence || useDemo !== demo) return;
    live = false;
    stale = true;
    setConnection('offline', error.message);
    if (data) render();
    toast('Homey niet bereikbaar. Oude waarden zijn niet actueel en bediening is gepauzeerd.');
  } finally {
    pendingLoads--;
  }
}

function setConnection(state,msg=''){const banner=$('#connectionBanner');if(state==='demo'){banner.className='connection-banner';banner.innerHTML='<span class="dot"></span><div><b>Demo-omgeving</b><small>Voorbeeldgegevens. Er worden geen echte apparaten of Flows aangestuurd.</small></div><button id="demoToggle" class="text-btn">Demo verlaten</button>';$('#demoPill').classList.remove('hidden');$('#sideStatus').textContent='Demo actief';$('#sideDot').style.background='#d49b3f';$('#demoToggle').onclick=()=>toggleDemo(false);}else if(state==='online'){banner.className='connection-banner';banner.innerHTML='<span class="dot"></span><div><b>Homey verbonden</b><small>Livegegevens via de officiële Homey Web API.</small></div><button class="text-btn" id="demoToggle">Demo bekijken</button>';$('#demoPill').classList.add('hidden');$('#sideStatus').textContent='Homey verbonden';$('#sideDot').style.background='#36a47e';$('#demoToggle').onclick=()=>toggleDemo(true);}else{banner.className='connection-banner offline';banner.innerHTML=`<span class="dot"></span><div><b>Homey niet verbonden</b><small>${esc(msg||'Verbinding verbroken. Getoonde waarden zijn mogelijk verouderd; bediening is gepauzeerd.')}</small></div><button class="text-btn" id="demoToggle">Demo bekijken</button>`;$('#demoPill').classList.remove('hidden');$('#sideStatus').textContent='Verbinding verbroken';$('#sideDot').style.background='#d45b54';$('#demoToggle').onclick=()=>toggleDemo(true);}}
async function toggleDemo(on){demo=on;$('#connectionBanner').classList.remove('offline');if(on){await loadData();}else{if(!config?.connected){setConnection('offline','Koppel eerst Homey via Instellingen.');toast('Homey is nog niet gekoppeld.');return;}await loadData();}}
async function loadConfig(){try{config=await api('/api/config');$('#redirectUrl').textContent=config.redirectUri;$('#homeyStatus').textContent=config.connected?'Verbonden':'Niet gekoppeld';$('#connectHomey').disabled=!config.oauthConfigured;$('#connectHomey').title=config.oauthConfigured?'':'Hostingvariabelen nog niet ingesteld';$('#disconnectHomey').disabled=!config.connected;}catch(e){toast(e.message)}}
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();$('#loginError').textContent='';try{await api('/api/login',{method:'POST',body:JSON.stringify({password:$('#password').value})});$('#login').classList.add('hidden');$('#app').classList.remove('hidden');await boot();}catch(err){$('#loginError').textContent=err.message;}});
let nextSolarCheck = 0;
async function boot(){const h=await api('/api/health');await loadConfig();demo=h.demo&&!config?.connected;if(location.hash==='#instellingen')showPage('instellingen');if(location.search.includes('homey=connected'))toast('Homey succesvol gekoppeld.');if(location.search.includes('homey_error'))toast(new URLSearchParams(location.search).get('homey_error'));await Promise.all([loadData(), loadSolarForecast()]);}
async function logout() {
  await api('/api/logout', { method: 'POST', body: '{}' });
  location.reload();
}
$('#logout').onclick = logout;
$('#mobileLogout').onclick = logout;$('#refresh').onclick=()=>loadData();$('#copyRedirect').onclick=async()=>{await navigator.clipboard.writeText($('#redirectUrl').textContent);toast('Redirect-URL gekopieerd.');};$('#connectHomey').onclick=()=>location.href='/api/homey/connect';$('#disconnectHomey').onclick=async()=>{if(confirm('Homey-koppeling verbreken?')){await api('/api/homey/disconnect',{method:'POST',body:'{}'});await loadConfig();demo=true;await loadData();toast('Homey-koppeling verbroken.');}};
$$('[data-page]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.page)));$$('[data-goto]').forEach(b=>b.addEventListener('click',()=>showPage(b.dataset.goto)));$('#deviceSearch').addEventListener('input',filterDevices);$('#roomFilter').addEventListener('change',filterDevices);function filterDevices(){const q=$('#deviceSearch').value.toLowerCase(),room=$('#roomFilter').value;$('#allDevices').innerHTML=data.devices.filter(d=>(d.name.toLowerCase().includes(q)||roomName(d).toLowerCase().includes(q))&&(room==='all'||d.zone===room||d.zoneId===room)).map(deviceCard).join('');bindControls();}
(async()=>{try{await api('/api/health');await api('/api/session');$('#login').classList.add('hidden');$('#app').classList.remove('hidden');await boot();}catch{$('#login').classList.remove('hidden');}})();

setInterval(() => {
  if (!document.hidden && !$('#app').classList.contains('hidden') && Date.now() >= nextSolarCheck) loadSolarForecast();
  if (!demo && config?.connected && !document.hidden && !$('#app').classList.contains('hidden') && !pendingLoads && Date.now() >= homeyRetryAt) {
    loadData();
  }
}, 60_000);

function weatherLabel(code) {
  if (code === 0) return 'Helder';
  if (code === 1 || code === 2) return 'Deels bewolkt';
  if (code === 3) return 'Bewolkt';
  if (code === 45 || code === 48) return 'Mist';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'Sneeuw';
  if (code >= 95) return 'Onweer';
  if (code >= 51) return 'Neerslag';
  return 'Weertype onbekend';
}

async function loadSolarForecast() {
  nextSolarCheck = Date.now() + 45 * 60_000;
  const status = $('#solarStatus');
  const list = $('#solarDays');
  const model = $('#solarModel');
  try {
    const forecast = await api('/api/solar-forecast');
    if (!forecast.configured) {
      status.textContent = 'Stel bij Render SOLAR_LATITUDE en SOLAR_LONGITUDE in om de zonverwachting te tonen.';
      return;
    }
    if (!forecast.days?.length) {
      nextSolarCheck = Date.now() + 5 * 60_000;
      list.hidden = model.hidden = true;
      const details = {
        timeout: 'Open-Meteo reageert te langzaam.',
        network: 'De server kan Open-Meteo momenteel niet bereiken.',
        empty: 'Open-Meteo levert geen zoninstraling voor de komende dagen.',
        'invalid-response': 'Open-Meteo heeft onleesbare weerdata teruggestuurd.',
        'provider-http': `Open-Meteo antwoordt met HTTP ${forecast.providerStatus ?? 'onbekend'}.`,
      };
      status.textContent = details[forecast.reason] || 'Zonverwachting tijdelijk niet beschikbaar.';
      return;
    }
    if (forecast.stale) nextSolarCheck = Date.now() + 5 * 60_000;
    const dateLabel = new Intl.DateTimeFormat('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Amsterdam' });
    const dateParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Amsterdam', calendar: 'iso8601', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts();
    const parts = Object.fromEntries(dateParts.map(part => [part.type, part.value]));
    const currentDay = `${parts.year}-${parts.month}-${parts.day}`;
    const nextDay = new Date(Date.parse(currentDay + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
    list.replaceChildren(...forecast.days.map(day => {
      const card = document.createElement('li');
      const name = document.createElement('span');
      const value = document.createElement('strong');
      const detail = document.createElement('span');
      name.textContent = day.date === currentDay ? 'Vandaag' : day.date === nextDay ? 'Morgen' :
        dateLabel.format(new Date(day.date + 'T12:00:00Z'));
      value.textContent = day.estimatedKwh === null
        ? energyNumber.format(day.sun) + ' kWh/m²'
        : energyNumber.format(day.estimatedKwh) + ' kWh';
      detail.textContent = weatherLabel(day.weatherCode);
      card.append(name, value, detail);
      return card;
    }));
    status.textContent = (forecast.stale ? 'Laatst beschikbare verwachting' : 'Verwachting opgehaald')
      + ' om ' + energyTime.format(new Date(forecast.fetchedAt));
    model.textContent = forecast.days[0].estimatedKwh === null
      ? 'Dit is de verwachte zoninstraling per m². Stel SOLAR_CAPACITY_KWP in voor een schatting van je opwek.'
      : 'Grove dagschatting op basis van horizontale zoninstraling, je paneelvermogen en 20% systeemverlies. Dakrichting, helling en schaduw zijn niet meegerekend.';
    list.hidden = model.hidden = false;
  } catch (error) {
    nextSolarCheck = Date.now() + 5 * 60_000;
    list.hidden = model.hidden = true;
    status.textContent = 'De zonverwachting kon niet worden geladen. ' + (error.message === 'Niet aangemeld' ? 'Meld je opnieuw aan.' : 'Probeer het straks opnieuw.');
  }
}
