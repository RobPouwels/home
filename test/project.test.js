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
