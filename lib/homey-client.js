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
