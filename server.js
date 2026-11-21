import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import crypto from 'node:crypto';
import { demoData } from './lib/demo-data.js';
import { encryptJson, decryptJson } from './lib/crypto-store.js';
import { exchangeCode, createHomeySession, homeyRequest } from './lib/homey-client.js';
import { SessionStore } from './lib/session-store.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const REDIRECT_URI = `${APP_URL}/auth/homey/callback`;
const DEMO = process.env.DEMO_ENABLED !== 'false';
const pool = process.env.DATABASE_URL ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }, max: 5 }) : null;

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:', 'https://*.ezviz.com'], connectSrc: ["'self'"], frameSrc: ["'none'"] } }, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false }));

const sessions = new SessionStore(); // short-lived authenticated browser sessions; restart safely logs out
const oauthStates = new Map();
const sha = v => crypto.createHash('sha256').update(v).digest();
function encrypt(value) { return encryptJson(value, process.env.ENCRYPTION_KEY || ''); }
function decrypt(value) { return decryptJson(value, process.env.ENCRYPTION_KEY || ''); }
async function initDb() { if (!pool) return; await pool.query(`CREATE TABLE IF NOT EXISTS homey_connection (id integer primary key check (id=1), encrypted_tokens text not null, updated_at timestamptz not null default now())`); }
function sessionRequired(req,res,next) { const sid=req.cookies.thuis_session; const s=sessions.get(sid); if (!s) { return res.status(401).json({error:'Niet aangemeld'}); } req.session=s; next(); }
function readyForOAuth() { return Boolean(process.env.HOMEY_CLIENT_ID && process.env.HOMEY_CLIENT_SECRET && pool && process.env.ENCRYPTION_KEY); }
async function getTokens() { if(!pool) return null; const r=await pool.query('SELECT encrypted_tokens FROM homey_connection WHERE id=1'); return r.rowCount ? decrypt(r.rows[0].encrypted_tokens) : null; }
async function saveTokens(tokens) { await pool.query(`INSERT INTO homey_connection(id,encrypted_tokens,updated_at) VALUES(1,$1,now()) ON CONFLICT(id) DO UPDATE SET encrypted_tokens=EXCLUDED.encrypted_tokens,updated_at=now()`,[encrypt(tokens)]); }
async function homeySession() { const tokens=await getTokens(); if(!tokens) throw new Error('Homey is nog niet gekoppeld.'); return createHomeySession(tokens,{clientId:process.env.HOMEY_CLIENT_ID,clientSecret:process.env.HOMEY_CLIENT_SECRET,saveTokens}); }
async function homeyGet(api,pathName) { return homeyRequest(api,pathName); }
async function homeyWrite(api,pathName,body,method='POST') { return homeyRequest(api,pathName,{method,body}); }

app.get('/api/health',(_req,res)=>res.json({ok:true,app:'Thuis',demo:DEMO,oauthConfigured:readyForOAuth()}));
app.get('/api/session',sessionRequired,(_req,res)=>res.json({ok:true}));
app.post('/api/login', (req,res)=>{ const password=String(req.body?.password||''); const expected=process.env.ADMIN_PASSWORD||''; if(expected.length<20 || !crypto.timingSafeEqual(sha(password),sha(expected))) return res.status(401).json({error:'Onjuiste aanmelding of wachtwoord niet ingesteld.'}); const sid=sessions.create(12*60*60*1000); res.cookie('thuis_session',sid,{httpOnly:true,secure:APP_URL.startsWith('https://'),sameSite:'lax',maxAge:12*60*60*1000,path:'/'}); res.json({ok:true}); });
app.post('/api/logout',sessionRequired,(req,res)=>{sessions.delete(req.cookies.thuis_session);res.clearCookie('thuis_session',{path:'/'});res.json({ok:true});});
app.get('/api/config',sessionRequired,async(_req,res)=>{let connected=false;try{connected=Boolean(await getTokens())}catch{}res.json({app:'Thuis',demo:DEMO,connected,redirectUri:REDIRECT_URI,oauthConfigured:readyForOAuth(),dbConfigured:Boolean(pool)});});
app.get('/api/homey/connect',sessionRequired,(req,res)=>{ if(!readyForOAuth()) return res.status(503).json({error:'Vul eerst Homey Client ID/Secret, DATABASE_URL en ENCRYPTION_KEY in bij de hostingomgeving.'}); const state=crypto.randomBytes(32).toString('hex'); oauthStates.set(state,Date.now()+10*60*1000); const u=new URL('https://api.athom.com/oauth2/authorise'); u.searchParams.set('response_type','code');u.searchParams.set('client_id',process.env.HOMEY_CLIENT_ID);u.searchParams.set('redirect_uri',REDIRECT_URI);u.searchParams.set('state',state);res.redirect(u.toString()); });
app.get('/auth/homey/callback',sessionRequired,async(req,res)=>{ try { const {code,state,error}=req.query; const expiry=oauthStates.get(String(state)); oauthStates.delete(String(state)); if(error||!code||!expiry||expiry<Date.now()) throw new Error('OAuth geweigerd of ongeldige/verlopen state. Probeer opnieuw.'); const t=await exchangeCode(String(code),{clientId:process.env.HOMEY_CLIENT_ID,clientSecret:process.env.HOMEY_CLIENT_SECRET});await saveTokens(t);res.redirect('/?homey=connected#instellingen'); } catch(e) {res.redirect(`/?homey_error=${encodeURIComponent(e.message)}#instellingen`);} });
app.post('/api/homey/disconnect',sessionRequired,async(_req,res)=>{if(pool)await pool.query('DELETE FROM homey_connection WHERE id=1');res.json({ok:true});});
app.get('/api/homey/data',sessionRequired,async(req,res)=>{ if(req.query.demo==='1' && DEMO) return res.json(demoData()); try { const api=await homeySession(); const [devices,zones,flows,advancedFlows,insights]=await Promise.all([homeyGet(api,'/api/manager/devices/device'),homeyGet(api,'/api/manager/zones/zone'),homeyGet(api,'/api/manager/flow/flow'),homeyGet(api,'/api/manager/flow/advancedflow').catch(()=>({})),homeyGet(api,'/api/manager/insights/log').catch(()=>({}))]); const d=Object.values(devices||{}); const z=Object.values(zones||{}); const f=Object.values(flows||{}).map(x=>({...x,advanced:false})).concat(Object.values(advancedFlows||{}).map(x=>({...x,advanced:true}))); const logs=Object.values(insights||{}); const energyLogs=logs.filter(l=>/power|energie|energy|verbruik|teruglever/i.test(`${l.title||''} ${l.name||''} ${l.id||''}`)); const entries=await Promise.all(energyLogs.slice(0,8).map(async l=>{try{return {...l,entries:await homeyGet(api,`/api/manager/insights/log/${encodeURIComponent(l.uri||'homey:manager:insights')}/${encodeURIComponent(l.id)}/entry?resolution=3600`)};}catch{return {...l,entries:null};}})); res.json({connected:true,updatedAt:new Date().toISOString(),devices:d,zones:z,flows:f,insights:entries,energy:d.filter(x=>x.capabilities?.some(c=>/measure_power|meter_power|meter_gas|meter_water|measure_energy/.test(c))),source:'Homey Web API'}); } catch(e) {res.status(503).json({connected:false,error:e.message,stale:true});} });
app.post('/api/homey/device/:id/capability',sessionRequired,async(req,res)=>{try{const api=await homeySession();const {capability,value}=req.body||{};if(!['onoff','dim'].includes(capability))return res.status(400).json({error:'Alleen aan/uit en dimmen zijn in deze eerste versie toegestaan.'});if(capability==='dim'&&(!Number.isFinite(value)||value<0||value>1))return res.status(400).json({error:'Dimwaarde moet tussen 0 en 1 liggen.'});await homeyWrite(api,`/api/manager/devices/device/${encodeURIComponent(req.params.id)}/capability/${encodeURIComponent(capability)}`,{value},'PUT');const devices=await homeyGet(api,'/api/manager/devices/device');const device=devices[req.params.id];res.json({ok:true,device});}catch(e){res.status(503).json({ok:false,error:e.message});}});
app.post('/api/homey/flow/:id/start',sessionRequired,async(req,res)=>{try{const api=await homeySession();const flowId=String(req.params.id); const adv=await homeyGet(api,'/api/manager/flow/advancedflow').catch(()=>({})); const isAdvanced=Boolean(adv?.[flowId]); const route=isAdvanced?'advancedflow':'flow'; await homeyWrite(api,`/api/manager/flow/${route}/${encodeURIComponent(flowId)}/trigger`,{});res.json({ok:true});}catch(e){res.status(503).json({ok:false,error:e.message});}});
app.get('/api/demo',sessionRequired,(_req,res)=>{if(!DEMO)return res.status(404).end();res.json(demoData());});
app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));

initDb().then(()=>app.listen(PORT,()=>console.log(`Thuis luistert op ${PORT}`))).catch(e=>{console.error('Database initialisatie mislukt',e.message);process.exit(1)});
