import crypto from 'node:crypto';
export class SessionStore {
  #items=new Map();
  create(ttlMs=12*60*60*1000,now=Date.now()){const id=crypto.randomBytes(32).toString('hex');this.#items.set(id,{expires:now+ttlMs});return id;}
  get(id,now=Date.now()){const s=id&&this.#items.get(id);if(!s||s.expires<now){if(id)this.#items.delete(id);return null;}return s;}
  delete(id){return this.#items.delete(id);}
}
