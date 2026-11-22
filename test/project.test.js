import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { demoData } from '../lib/demo-data.js';
import { encryptJson, decryptJson } from '../lib/crypto-store.js';

const root=new URL('../',import.meta.url);
test('demo bevat kamers, echte-achtige capabilities, P1 en gewone plus Advanced Flow',()=>{const d=demoData();assert.equal(d.demo,true);assert.ok(d.zones.some(z=>z.name==='Woonkamer'));assert.ok(d.devices.some(x=>x.capabilities.includes('dim')));assert.ok(d.devices.some(x=>x.name==='HomeWizard P1'));assert.ok(d.flows.some(x=>x.advanced));assert.ok(d.flows.some(x=>!x.advanced));});
test('AES-256-GCM bewaart tokens versleuteld en ondersteunt roundtrip',()=>{const k='a'.repeat(64),secret={access_token:'simulated-access',refresh_token:'simulated-refresh'};const blob=encryptJson(secret,k);assert.equal(blob.includes('simulated-access'),false);assert.deepEqual(decryptJson(blob,k),secret);});
test('AES-GCM weigert verkeerde sleutel',()=>{const a=encryptJson({token:'x'},'a'.repeat(64));assert.throws(()=>decryptJson(a,'b'.repeat(64)));});
test('backend bevat server-side login, HttpOnly cookie, OAuth state en protected Homey routes',async()=>{const s=await readFile(new URL('server.js',root),'utf8');assert.match(s,/function sessionRequired/);assert.match(s,/httpOnly:true/);assert.match(s,/oauthStates\.set/);assert.match(s,/oauthStates\.delete/);assert.match(s,/app\.get\('\/api\/homey\/data',sessionRequired/);assert.match(s,/app\.post\('\/api\/homey\/device\/:id\/capability',sessionRequired/);assert.match(s,/app\.post\('\/api\/homey\/flow\/:id\/start',sessionRequired/);});
test('frontend bevat de gevraagde schermen en demo houdt echte acties lokaal',async()=>{const html=await readFile(new URL('public/index.html',root),'utf8');const js=await readFile(new URL('public/app.js',root),'utf8');for(const p of ['overzicht','apparaten','flows','energie','cameras','instellingen'])assert.match(html,new RegExp(`page-${p}`));assert.match(js,/if\(demo\)\{d\.capabilitiesObj/);assert.match(js,/if\(demo\)\{toast\('Demo: Flow gestart/);});
import { exchangeCode, createHomeySession, homeyRequest, refreshAthomToken } from '../lib/homey-client.js';

test('Homey OAuth callback en remote sessie werken met gesimuleerde Athom-antwoorden',async()=>{const calls=[];const fake=async(url,opts={})=>{calls.push({url,opts});if(url==='https://api.athom.com/oauth2/token')return new Response(JSON.stringify({access_token:'sim-access',refresh_token:'sim-refresh',expires_in:3600}),{status:200});if(url==='https://api.athom.com/user/me')return new Response(JSON.stringify({homeys:[{platform:'local',name:'Homey Pro 2026',remoteUrl:'https://homey.example.net'}]}),{status:200});if(url==='https://api.athom.com/delegation/token?audience=homey')return new Response(JSON.stringify('delegation-sim'),{status:200});if(url==='https://homey.example.net/api/manager/users/login')return new Response(JSON.stringify('homey-session-sim'),{status:200});throw new Error(`Onverwachte URL ${url}`);};const tokens=await exchangeCode('sim-code',{clientId:'id',clientSecret:'secret',fetchImpl:fake});assert.equal(tokens.access_token,'sim-access');const session=await createHomeySession(tokens,{clientId:'id',clientSecret:'secret',fetchImpl:fake});assert.equal(session.base,'https://homey.example.net');assert.equal(session.token,'homey-session-sim');assert.deepEqual(Object.fromEntries(calls[0].opts.body), {
    grant_type: 'authorization_code',
    code: 'sim-code',
  });
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.headers.Authorization, 'Basic ' + Buffer.from('id:secret').toString('base64'));
  assert.equal(calls[2].opts.method, 'POST');
  assert.equal(calls[2].opts.headers.Authorization, 'Bearer sim-access');assert.equal(JSON.parse(calls.at(-1).opts.body).token,'delegation-sim');});
test('Homey API leest apparaten en voert capability-write uit via extern Homey-adres',async()=>{const calls=[];const fake=async(url,opts={})=>{calls.push({url,opts});return new Response(JSON.stringify({id:'lamp1',name:'Testlamp'}),{status:200});};const api={base:'https://remote.homeypro.net',token:'session-token'};const read=await homeyRequest(api,'/api/manager/devices/device',{fetchImpl:fake});assert.equal(read.id,'lamp1');await homeyRequest(api,'/api/manager/devices/device/lamp1/capability/onoff',{method:'PUT',body:{value:true},fetchImpl:fake});assert.equal(calls[0].opts.headers.Authorization,'Bearer session-token');assert.equal(calls[1].opts.method,'PUT');assert.deepEqual(JSON.parse(calls[1].opts.body),{value:true});});
test('verlopen Homey access-token wordt vernieuwd en refresh-tokenrespons opgeslagen',async()=>{let saved=null;const fake=async(url,opts={})=>new Response(JSON.stringify({access_token:'new-access',refresh_token:'rotated-refresh',expires_in:3600}),{status:200});const t=await refreshAthomToken({access_token:'old',refresh_token:'old-refresh',expires_at:1},{clientId:'id',clientSecret:'secret',fetchImpl:fake,saveTokens:async x=>saved=x});assert.equal(t.access_token,'new-access');assert.equal(t.refresh_token,'rotated-refresh');assert.equal(saved.refresh_token,'rotated-refresh');});

import { SessionStore } from '../lib/session-store.js';
test('sessiebeveiliging accepteert alleen bestaande en niet-verlopen sessies',()=>{const store=new SessionStore();const id=store.create(1000,10000);assert.ok(store.get(id,10500));assert.equal(store.get(id,11001),null);assert.equal(store.get(id,11002),null);});

test('tokenfout toont alleen de bekende OAuth-foutcode', async () => {
  const fetchImpl = async () => Response.json({
    error: 'invalid_grant',
    error_description: 'sim-code',
  }, { status: 400 });

  await assert.rejects(
    exchangeCode('sim-code', { clientId: 'id', clientSecret: 'secret', fetchImpl }),
    { message: 'Homey OAuth-tokenaanvraag mislukt (400, invalid_grant)' },
  );
});

import { currentPower, todayPowerPoints } from '../public/energy-overview.js';

test('energieoverzicht kiest de P1-meting en leest een gewijzigde waarde opnieuw uit', () => {
  const devices = demoData().devices;
  const selected = currentPower(devices);
  assert.equal(selected.device.id, 'd5');
  assert.equal(selected.value, 428);
  selected.device.capabilitiesObj.measure_power.value = -125;
  assert.equal(currentPower(devices).value, -125);
  selected.device.capabilitiesObj.measure_power.value = null;
  assert.equal(currentPower(devices).device.id, 'd3');
  assert.equal(currentPower([selected.device]), null);
});

test('vermogensgrafiek gebruikt alleen waarden van vandaag in Amsterdam en van dezelfde meter', () => {
  const { device } = currentPower(demoData().devices);
  const insights = [
    { id: 'homey:device:d3:measure_power', entries: [{ t: '2026-07-01T22:10:00Z', v: 99 }] },
    { id: 'homey:device:d5:meter_power', units: 'kWh', entries: [{ t: '2026-07-01T22:20:00Z', v: 950 }] },
    { id: 'homey:device:d5:measure_power', entries: { values: [
      { t: '2026-07-01T21:59:59Z', v: 350 },
      { t: '2026-07-02T00:00:00Z', v: null },
      { t: '2026-07-01T22:20:00Z', v: -60 },
      { t: '2026-07-01T22:00:00Z', v: 0 },
      { t: '2026-07-02T12:00:00Z', v: 120 },
    ] } },
  ];
  const now = new Date('2026-07-02T10:00:00Z');
  assert.deepEqual(todayPowerPoints(insights, device, now).map(point => point.value), [0, -60]);
  assert.deepEqual(todayPowerPoints(insights, device, new Date('2026-07-03T10:00:00Z')), []);
});

import { createHomeyAccess } from '../lib/homey-client.js';

test('parallelle aanvragen hergebruiken dezelfde Homey-sessie; een afgewezen sessie wordt vernieuwd', async () => {
  const calls = [];
  const access = createHomeyAccess({
    getTokens: async () => ({access_token:'mock',expires_at:Date.now()+3600_000}),
    fetchImpl: async (url, options) => {
      calls.push(url);
      if (url.endsWith('/user/me')) return Response.json({homeys:[
        {platform:'local',remoteUrl:'https://homey.example',name:'Homey Pro'},
      ]});
      if (url.includes('/delegation/token')) return Response.json('delegation');
      if (url.endsWith('/users/login')) return Response.json('session');
      return new Response(null, {status:401});
    },
  });
  const [first, second] = await Promise.all([access.session(), access.session()]);
  assert.equal(first, second);
  assert.equal(await access.session(), first);
  assert.equal(calls.length, 3);
  await assert.rejects(access.request(first, '/api/manager/devices/device'), /401/);
  assert.notEqual(await access.session(), first);
  assert.equal(calls.filter(url => url.endsWith('/user/me')).length, 2);
});

test('Athom 429 onderdrukt nieuwe aanvragen totdat Retry-After is verstreken', async () => {
  let now = Date.now();
  let requests = 0;
  const access = createHomeyAccess({
    now: () => now,
    getTokens: async () => ({access_token:'mock',expires_at:now+3600_000}),
    fetchImpl: async () => {
      requests++;
      return new Response(null, {status:429,headers:{'Retry-After':'30'}});
    },
  });
  const expectedRetry = now + 30_000;
  await assert.rejects(access.session(), error => error.retryAt === expectedRetry);
  await assert.rejects(access.session(), error => error.retryAt === expectedRetry);
  assert.equal(requests, 1);
  now = expectedRetry;
  await assert.rejects(access.session(), error => error.retryAt === now + 30_000);
  assert.equal(requests, 2);
});

import { createSolarForecast } from '../lib/solar-forecast.js';

test('zonverwachting kiest Nederlandse dagen, schat opwek en deelt gelijktijdige aanvragen', async () => {
  let calls = 0;
  const forecast = createSolarForecast({
    SOLAR_LATITUDE: '52.0929', SOLAR_LONGITUDE: '5.1208', SOLAR_CAPACITY_KWP: '5',
  }, {
    now: () => Date.parse('2026-07-01T23:00:00Z'),
    fetchImpl: async url => {
      calls++;
      assert.equal(url.searchParams.get('latitude'), '52.09');
      assert.equal(url.searchParams.get('longitude'), '5.12');
      assert.equal(url.searchParams.get('timezone'), 'Europe/Amsterdam');
      return Response.json({ daily: {
        time: ['2026-07-01', '2026-07-02', '2026-07-03'], shortwave_radiation_sum: [3.6, 18, 0],
        weather_code: [2, 0, 3],
      } });
    },
  });
  const [first, second] = await Promise.all([forecast(), forecast()]);
  assert.equal(first, second);
  assert.equal(await forecast(), first);
  assert.equal(calls, 1);
  assert.deepEqual(first.days.map(day => [day.date, day.sun, day.estimatedKwh]), [
    ['2026-07-02', 5, 20], ['2026-07-03', 0, 0],
  ]);
});

test('zonverwachting zonder locatie doet geen externe aanvraag en zonder kWp toont ze enkel zoninstraling', async () => {
  const unconfigured = createSolarForecast({}, {fetchImpl: async () => assert.fail('onverwachte aanvraag')});
  assert.deepEqual(await unconfigured(), {configured:false});
  let now = Date.parse('2026-11-21T10:00:00Z');
  const forecast = createSolarForecast({SOLAR_LATITUDE:'52',SOLAR_LONGITUDE:'5'}, {
    now: () => now,
    fetchImpl: async () => now >= Date.parse('2026-11-21T11:00:00Z') ? new Response(null,{status:503})
      : Response.json({daily:{time:['2026-11-21'],shortwave_radiation_sum:[7.2],weather_code:[2]}}),
  });
  assert.deepEqual((await forecast()).days[0], {date:'2026-11-21',sun:2,weatherCode:2,estimatedKwh:null});
  now += 60 * 60_000;
  assert.equal((await forecast()).stale, true);
});

test('zonverwachting probeert een time-out opnieuw en geeft een HTTP 429 zonder extra aanvraag terug', async () => {
  let calls = 0;
  const env = { SOLAR_LATITUDE: '52', SOLAR_LONGITUDE: '5' };
  const now = () => Date.parse('2026-11-21T10:00:00Z');
  const retry = createSolarForecast(env, {
    now,
    fetchImpl: async () => {
      if (++calls === 1) throw new DOMException('Simulatie', 'TimeoutError');
      return Response.json({daily:{time:['2026-11-21'],shortwave_radiation_sum:[3.6]}});
    },
  });
  assert.equal((await retry()).days[0].sun, 1);
  assert.equal(calls, 2);
  const limited = createSolarForecast(env, {
    now,
    fetchImpl: async () => { calls++; return new Response(null, {status:429}); },
  });
  assert.deepEqual(await limited(), {
    configured:true, unavailable:true, reason:'provider-http', providerStatus:429,
    retryAt: now() + 60 * 60_000, browserForecast: {latitude:'52.00',longitude:'5.00',capacity:null},
  });
  await limited();
  assert.equal(calls, 3);
});

test('Open-Meteo wachttijd geldt ook voorbij middernacht en vervalt volgens Retry-After', async () => {
  let time = Date.parse('2026-11-21T22:59:00Z');
  let calls = 0;
  const forecast = createSolarForecast({
    SOLAR_LATITUDE:'51.815111', SOLAR_LONGITUDE:'5.737012', SOLAR_CAPACITY_KWP:'11.9',
  }, {
    now: () => time,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return new Response(null,{status:429,headers:{'Retry-After':'180'}});
      return Response.json({daily:{time:['2026-11-22'],shortwave_radiation_sum:[3.6],weather_code:[0]}});
    },
  });
  const denied = await forecast();
  assert.equal(denied.retryAt, time + 180_000);
  assert.deepEqual(denied.browserForecast,{latitude:'51.82',longitude:'5.74',capacity:11.9});
  time += 120_000;
  assert.equal((await forecast()).providerStatus,429);
  assert.equal(calls,1);
  time += 60_000;
  assert.equal((await forecast()).days[0].estimatedKwh,11.9 * 0.8);
  assert.equal(calls,2);
});

import { chargeAlertSettings, createChargeCheck, isChargeUserHome } from '../lib/charge-alert.js';

test('laadadvies verschijnt pas na verse aanhoudende teruglevering en bevestigde aanwezigheid', async () => {
  const minute = 60_000;
  let time = Date.parse('2026-11-21T10:00:00Z');
  let power = -1600;
  let stale = true;
  let present = false;
  const check = createChargeCheck({thresholdW:1500,sustainMs:2 * minute,now:() => time});
  const sample = () => check([
    {id:'p1',name:'HomeWizard P1',capabilitiesObj:{
      measure_power:{value:power,lastUpdated:new Date(time - (stale ? 10 * minute : 0)).toISOString()},
    }},
    {id:'plug',name:'Slimme stekker',capabilitiesObj:{measure_power:{value:-5000}}},
  ], async () => present);

  assert.equal(await sample(), null);
  stale = false;
  time += minute;
  assert.equal(await sample(), null);
  time += minute;
  assert.equal(await sample(), null);
  time += minute;
  assert.equal(await sample(), null);
  present = null;
  assert.equal(await sample(), null);
  present = true;
  assert.deepEqual(await sample(), {exportW:1600});
  power = -1499;
  assert.equal(await sample(), null);
  power = -2000;
  time += minute;
  assert.equal(await sample(), null);
  time += 3 * minute;
  assert.equal(await sample(), null);
});

test('laadadvies kan via de bestaande drempel zonder Twilio worden geconfigureerd', () => {
  assert.equal(chargeAlertSettings({}), null);
  assert.deepEqual(chargeAlertSettings({CHARGE_SURPLUS_W:'1500'}), {
    thresholdW:1500,sustainMs:600_000,meterId:null,homeyUserId:null,
  });
});

test('Homey-aanwezigheid kijkt naar de eigen of expliciet ingestelde gebruiker', async () => {
  const paths = [];
  const get = async (_api, path) => {
    paths.push(path);
    if (path.endsWith('/users/user/me')) return {id:'rob'};
    if (path.endsWith('/presence/rob/present')) return true;
    return {present:false};
  };
  assert.equal(await isChargeUserHome({}, get), true);
  assert.equal(await isChargeUserHome({}, get, 'andere-gebruiker'), false);
  assert.deepEqual(paths, [
    '/api/manager/users/user/me',
    '/api/manager/presence/rob/present',
    '/api/manager/presence/andere-gebruiker/present',
  ]);
  assert.equal(await isChargeUserHome({}, async () => ({})), false);
  assert.equal(await isChargeUserHome({}, async () => ({present:'true'}), 'rob'), false);
});

import { energyChart, historyPoints } from '../public/energy-charts.js';
import { isPowerLogFor } from '../public/energy-overview.js';

test('netvermogen wisselt op de nullijn van netafname naar teruglevering', () => {
  const points = historyPoints([
    { t: '2026-07-02T10:00:00Z', v: 100 },
    { t: '2026-07-02T11:00:00Z', v: -300 },
  ]);
  const chart = energyChart(points, { gridPower: true, unit: 'W' });
  assert.match(chart, /chart-import" d="M0\.00,[\d.]+L125\.00,50\.00/);
  assert.match(chart, /chart-export" d="M125\.00,50\.00L500\.00,[\d.]+/);
  assert.match(chart, /Netafname \(\+\).*\n.*Teruglevering \(−\)/);
  assert.match(chart, /<span>0 W<\/span>/);
  assert.match(chart, /<time>12:00<\/time><time>12:30<\/time><time>13:00<\/time>/);
});

test('met alleen teruglevering blijft de negatieve helft groen', () => {
  const chart = energyChart([{ timestamp: 0, value: -200 }, { timestamp: 5, value: -80 }], {
    gridPower: true, unit: 'W',
  });
  assert.match(chart, /chart-area chart-export/);
  assert.doesNotMatch(chart, /chart-area chart-import/);
  assert.match(chart, /chart-guide chart-zero/);
});

test('een ontbrekende meterstand onderbreekt de neutrale grafiek', () => {
  const points = historyPoints({ values: [
    { t: '2026-07-02T11:00:00Z', v: 40 },
    { t: '2026-07-02T10:15:00Z', v: null },
    { t: '2026-07-02T10:00:00Z', v: 39.5 },
  ] });
  const chart = energyChart(points, { unit: 'kWh' });
  assert.match(chart, /39,5 kWh/);
  assert.equal((chart.match(/chart-trace chart-neutral/g) || []).length, 2);
  assert.doesNotMatch(chart, /chart-export|chart-import|chart-trace chart-neutral" d="[^"]*L/);
});

test('een P1-meterstand en fasevermogen zijn apart van het totale netvermogen', () => {
  const { device } = currentPower(demoData().devices);
  assert.equal(isPowerLogFor({ id: 'homey:device:d5:measure_power' }, device), true);
  assert.equal(isPowerLogFor({ id: 'homey:device:d5:meter_power.returned', units: 'kWh' }, device), false);
  assert.equal(isPowerLogFor({ id: 'homey:device:d5:measure_power.l1', units: 'W' }, device), false);
  assert.equal(isPowerLogFor({ id: 'homey:device:d3:measure_power', units: 'W' }, device), false);
});

import { generateKeyPairSync, verify } from 'node:crypto';
import { calendarItems, createCalendar, createVandebronPrices } from '../lib/dashboard-feeds.js';
import { dutchMidnight, gridDay, isGridCounterLog, playback, tariffValue } from '../public/overview-data.js';
import { hourMs, rollingSolar, solarHours } from '../public/solar-weather.js';

test('zonneprognose snijdt het lopende uur correct aan en houdt ontbrekende uren leeg', () => {
  const base = Date.parse('2026-11-22T08:00:00Z');
  const hourEnd = Array.from({ length: 25 }, (_, i) => (base + (i + 1) * hourMs) / 1000);
  const hourly = {
    time: hourEnd,
    shortwave_radiation: hourEnd.map((_, i) => i === 0 ? 100 : 200),
  };
  const current = { time: base / 1000 + 1800, shortwave_radiation_instant: 148 };
  const solar = solarHours({ current, hourly }, 10);
  const view = rollingSolar(solar, base + hourMs / 2);
  assert.ok(Math.abs(view.values[0] - 1.2) < 0.0001);
  assert.ok(Math.abs(view.expectedKwh - (1.2 + 23 * 1.6)) < 0.0001);
  assert.equal(view.radiation, 148);

  hourly.shortwave_radiation[4] = null;
  const incomplete = rollingSolar(solarHours({ current, hourly }, 10), base + hourMs / 2);
  assert.equal(incomplete.values[4], null);
  assert.equal(incomplete.expectedKwh, null);
});

test('dagkosten gebruiken bruto P1-tellers en Nederlandse middernacht', () => {
  const now = Date.parse('2026-07-02T12:00:00Z');
  assert.equal(new Date(dutchMidnight(now)).toISOString(), '2026-07-01T22:00:00.000Z');
  assert.equal(new Date(dutchMidnight(Date.parse('2026-11-02T12:00:00Z'))).toISOString(), '2026-11-01T23:00:00.000Z');
  const meter = {
    id: 'test-p1', name: 'Meterkast', driverId: 'homey:app:com.homewizard:energy_v2',
    capabilitiesObj: {
      meter_power: { value: 7 },
      'meter_power.consumed': { value: 106 },
      'meter_power.returned': { value: 42 },
    },
  };
  const log = (key, v, t = '2026-07-01T22:00:00Z') => ({ id: 'homey:device:test-p1:' + key, entries: [{ t, v }] });
  const insights = [
    log('meter_power', 10),
    log('meter_power.consumed', 100),
    log('meter_power.returned', 40, '2026-07-01T21:55:00Z'),
  ];
  assert.equal(isGridCounterLog(insights[0], meter), false);
  const dashboard = { updatedAt: new Date(now).toISOString(), devices: [meter], insights };
  const result = gridDay(dashboard, { importRate: tariffValue('0,25'), exportRate: 0.1 });
  assert.deepEqual(result, {
    taken: { kwh: 6, approximate: false }, sent: { kwh: 2, approximate: true }, cost: 1.5, credit: 0.2,
  });
  insights[1] = log('meter_power.consumed', 100, '2026-07-02T02:00:00Z');
  assert.equal(gridDay(dashboard, { importRate: 0.25 }).cost, null);
});

test('muziek gebruikt alleen Chromecast-apparaten en leest hun echte afspeelstatus', () => {
  const device = demoData().devices.find(item => item.id === 'd6');
  assert.deepEqual(playback([device, { ...device, driverId: 'homey:app:com.sonos:one' }]), [
    { name: 'Google Nest Woonkamer', active: true, track: 'Zondagmorgen', artist: 'Voorbeeldtrack' },
  ]);
  device.capabilitiesObj.speaker_playing.value = false;
  assert.equal(playback([device])[0].active, false);
});

test('Google Agenda vraagt alleen leesrechten, houdt privédetails apart en deelt overlappende aanvragen', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = {
    client_email: 'example@demo.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
  const responses = [
    { start: { dateTime: '2026-11-23T17:00:00+01:00' }, summary: 'Afspraak' },
    { start: { date: '2026-11-24' }, visibility: 'private', summary: 'Privé' },
    { start: { date: '2026-11-25' }, status: 'cancelled', summary: 'Afgezegd' },
  ];
  const requests = [];
  const getCalendar = createCalendar({
    GOOGLE_CALENDAR_ID: 'huis@group.calendar.google.com',
    GOOGLE_CALENDAR_SERVICE_ACCOUNT_JSON: JSON.stringify(account),
  }, {
    now: () => Date.parse('2026-11-22T08:00:00Z'),
    fetchImpl: async (url, options) => {
      requests.push(String(url));
      if (String(url).includes('oauth2.googleapis.com')) {
        const jwt = options.body.get('assertion').split('.');
        const claims = JSON.parse(Buffer.from(jwt[1], 'base64url'));
        assert.equal(claims.scope, 'https://www.googleapis.com/auth/calendar.events.readonly');
        assert.equal(verify('RSA-SHA256', Buffer.from(jwt[0] + '.' + jwt[1]), publicKey, Buffer.from(jwt[2], 'base64url')), true);
        return new Response(JSON.stringify({ access_token: 'test-bearer', expires_in: 3600 }));
      }
      assert.equal(options.headers.Authorization, 'Bearer test-bearer');
      assert.equal(url.searchParams.get('singleEvents'), 'true');
      assert.ok(String(url).includes('huis%40group.calendar.google.com'));
      return new Response(JSON.stringify({ items: responses }));
    },
  });
  const [first, second] = await Promise.all([getCalendar(), getCalendar()]);
  assert.equal(requests.length, 2);
  assert.deepEqual(first, second);
  assert.deepEqual(first.events, [
    { start: '2026-11-23T17:00:00+01:00', allDay: false, title: 'Afspraak' },
    { start: '2026-11-24', allDay: true, title: 'Bezet' },
  ]);
  assert.deepEqual(calendarItems([null]), []);
});

test('prijsfeed combineert vandaag en morgen, inclusief negatieve tarieven en lege uren', async () => {
  const requests = [];
  let now = Date.parse('2026-11-22T15:45:00Z');
  const getPrices = createVandebronPrices({ ENEVER_TOKEN: 'sample' }, {
    now: () => now,
    fetchImpl: async url => {
      requests.push(url.pathname);
      assert.equal(url.searchParams.get('price'), 'prijsVDB');
      const date = url.pathname.includes('vandaag') ? '2026-11-22T16:00:00+01:00' : '2026-11-23T00:00:00+01:00';
      return new Response(JSON.stringify({ data: [
        { datum: date, prijsVDB: url.pathname.includes('vandaag') ? '-0.025' : 0.18 },
        { datum: '2026-11-23T01:00:00+01:00', prijsVDB: null },
      ] }));
    },
  });
  const prices = await getPrices();
  assert.deepEqual(prices.points.map(point => point.value), [-0.025, 0.18]);
  assert.equal((await getPrices()).points.length, 2);
  assert.equal(requests.length, 2);
  now += 9 * hourMs;
  assert.deepEqual((await getPrices()).points, []);
  assert.equal(requests.length, 2);
});

import { powerDirection, serviceStatus, welcomeText } from '../public/overview-data.js';

test('actueel netvermogen kleurt volgens de richting en verouderde waarden blijven neutraal', () => {
  const device = { id: 'p1', name: 'HomeWizard P1' };
  assert.deepEqual(powerDirection({ device, value: -140 }, false), { state: 'export', label: 'Teruglevering' });
  assert.equal(powerDirection({ device, value: 140 }, false).state, 'no-export');
  assert.equal(powerDirection({ device, value: 0 }, false).label, 'Geen teruglevering');
  assert.equal(powerDirection({ device, value: -140 }, true).state, 'unknown');
  assert.equal(powerDirection({ device: { name: 'Stekker' }, value: -140 }, false).state, 'unknown');
  assert.equal(powerDirection(null, false).state, 'unknown');
});

test('verbindingslampjes zijn pas groen bij een actieve Homey-verbinding en beschikbare apparaten', () => {
  const google = { driverId: 'homey:app:com.google.chromecast:chromecast', available: true };
  const meter = { driverId: 'homey:app:com.homewizard:energy_v2', available: true };
  assert.deepEqual(serviceStatus('online', [google, meter]), { Homey: 'online', Google: 'online', Wizard: 'online' });
  assert.deepEqual(serviceStatus('online', [{ ...google, available: false }]), {
    Homey: 'online', Google: 'unavailable', Wizard: 'unavailable',
  });
  assert.deepEqual(serviceStatus('demo', [google, meter]), { Homey: 'demo', Google: 'unknown', Wizard: 'unknown' });
  assert.deepEqual(serviceStatus('offline', [google, meter]), { Homey: 'offline', Google: 'unknown', Wizard: 'unknown' });
});

test('begroeting volgt de tijd in Amsterdam', () => {
  assert.equal(welcomeText(Date.parse('2026-07-02T10:15:00Z')), 'Goedemiddag, welkom bij Hoefsetuin 32');
  assert.equal(welcomeText(Date.parse('2026-11-22T10:15:00Z')), 'Goedemorgen, welkom bij Hoefsetuin 32');
});
