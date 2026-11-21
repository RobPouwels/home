const basic = (id, secret) => Buffer.from(`${id}:${secret}`).toString('base64');
async function tokenPost(form, { clientId, clientSecret, fetchImpl=fetch }) {
  const r=await fetchImpl('https://api.athom.com/oauth2/token',{method:'POST',headers:{Authorization:`Basic ${basic(clientId,clientSecret)}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(form)});
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    const knownErrors = ['invalid_client', 'invalid_grant', 'invalid_request', 'unauthorized_client', 'unsupported_grant_type'];
    const reason = knownErrors.includes(detail?.error) ? `, ${detail.error}` : '';
    throw new Error(`Homey OAuth-tokenaanvraag mislukt (${r.status}${reason})`);
  }
  const j=await r.json();return {...j,expires_at:Date.now()+Number(j.expires_in||3600)*1000};
}
export async function exchangeCode(code, opts) {
  return tokenPost({ grant_type: 'authorization_code', code }, opts);
}
export async function refreshAthomToken(tokens, {clientId,clientSecret,saveTokens,fetchImpl=fetch}) {
  if(tokens.expires_at && Date.now()<tokens.expires_at-60_000)return tokens;
  const n=await tokenPost({grant_type:'refresh_token',refresh_token:tokens.refresh_token},{clientId,clientSecret,fetchImpl});
  const updated={...tokens,...n};if(saveTokens)await saveTokens(updated);return updated;
}
export async function athomGet(pathname,tokens,{clientId,clientSecret,saveTokens,fetchImpl=fetch}) {
  const t=await refreshAthomToken(tokens,{clientId,clientSecret,saveTokens,fetchImpl});
  const r=await fetchImpl(`https://api.athom.com${pathname}`,{headers:{Authorization:`Bearer ${t.access_token}`}});
  if(!r.ok)throw new Error(`Athom API antwoordde ${r.status}`);return r.json();
}
export async function createHomeySession(tokens,{clientId,clientSecret,saveTokens,fetchImpl=fetch}) {
  const current=await refreshAthomToken(tokens,{clientId,clientSecret,saveTokens,fetchImpl});
  const user=await athomGet('/user/me',current,{clientId,clientSecret,saveTokens,fetchImpl});
  const homey=(user.homeys||[]).find(h=>h.platform==='local'&&h.remoteUrl);
  if(!homey)throw new Error('Geen Homey Pro met extern Homey-adres gevonden in dit account.');
  const delegationResponse = await fetchImpl('https://api.athom.com/delegation/token?audience=homey', {
    method: 'POST',
    headers: { Authorization: `Bearer ${current.access_token}` },
  });
  if (!delegationResponse.ok) throw new Error(`Homey-delegatietoken ophalen mislukt (${delegationResponse.status})`);
  const delegation = await delegationResponse.json();
  const dtoken=typeof delegation==='string'?delegation:(delegation.token||delegation.delegation_token);
  const login=await fetchImpl(`${homey.remoteUrl}/api/manager/users/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:dtoken})});
  if(!login.ok)throw new Error(`Homey-sessie maken mislukt (${login.status})`);
  const sessionToken=await login.json();
  return {base:homey.remoteUrl,token:typeof sessionToken==='string'?sessionToken:sessionToken.token,homeyName:homey.name};
}
export async function homeyRequest(api,pathName,{method='GET',body,fetchImpl=fetch}={}) {
  const r=await fetchImpl(`${api.base}${pathName}`,{method,headers:{Authorization:`Bearer ${api.token}`,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(!r.ok)throw new Error(`Homey API antwoordde ${r.status}`);
  if(r.status===204)return {};return r.json().catch(()=>({}));
}

class HomeyRateLimitError extends Error {
  constructor(retryAt) {
    super('Homey vraagt tijdelijk om minder aanvragen. Het dashboard probeert het later opnieuw.');
    this.retryAt = retryAt;
  }
}

export function createHomeyAccess({ getTokens, clientId, clientSecret, saveTokens, fetchImpl = fetch, now = Date.now }) {
  let cached;
  let pending;
  let generation = 0;
  let retryAt = 0;

  function checkCooldown() {
    if (now() < retryAt) throw new HomeyRateLimitError(retryAt);
  }

  async function limitedFetch(url, options) {
    checkCooldown();
    const response = await fetchImpl(url, options);
    if (response.status === 429) {
      const header = response.headers.get('Retry-After')?.trim();
      const time = now();
      const requested = /^\d+$/.test(header ?? '') ? time + Number(header) * 1000 : Date.parse(header);
      retryAt = Math.max(retryAt, Number.isFinite(requested) ? Math.max(requested, time + 1000) : time + 120_000);
      throw new HomeyRateLimitError(retryAt);
    }
    return response;
  }

  function reset() {
    generation++;
    cached = null;
    pending = null;
  }

  async function session() {
    checkCooldown();
    if (cached?.until > now()) return cached.api;
    if (pending) return pending;

    const currentGeneration = generation;
    pending = (async () => {
      const tokens = await getTokens();
      if (!tokens) throw new Error('Homey is nog niet gekoppeld.');
      const api = await createHomeySession(tokens, {
        clientId, clientSecret, fetchImpl: limitedFetch,
        saveTokens: async updated => {
          if (currentGeneration === generation) await saveTokens(updated);
        },
      });
      if (currentGeneration !== generation) throw new Error('De Homey-koppeling is gewijzigd. Vernieuw het dashboard.');
      cached = { api, until: now() + 20 * 60_000 };
      return api;
    })();
    try {
      return await pending;
    } finally {
      if (currentGeneration === generation) pending = null;
    }
  }

  function request(api, pathname, options) {
    return homeyRequest(api, pathname, {
      ...options,
      fetchImpl: async (url, init) => {
        const response = await limitedFetch(url, init);
        if (response.status === 401 && cached?.api === api) reset();
        return response;
      },
    });
  }

  return { session, request, reset, exchange: code => exchangeCode(code, {
    clientId, clientSecret, fetchImpl: limitedFetch,
  }) };
}

export function homeyErrorResponse(res, error, body) {
  if (error instanceof HomeyRateLimitError) {
    const seconds = Math.max(1, Math.ceil((error.retryAt - Date.now()) / 1000));
    return res.set('Retry-After', String(seconds)).status(429).json({
      ...body, error: error.message, retryAfter: seconds,
    });
  }
  return res.status(503).json({ ...body, error: error.message });
}

export function optionalHomeyRead(error, fallback) {
  if (error instanceof HomeyRateLimitError) throw error;
  return fallback;
}
