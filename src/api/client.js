import {ByteTransport} from '../core/net/transport.js';
import {MemoryByteCache,IndexedDbByteCache} from '../core/net/cache.js';
import {TileError} from '../core/errors.js';
export const MiB=1024*1024;
export const fail=(message,details)=>{throw new TileError('invalid_options',message,details);};
export const positiveInt=(v,name)=>{if(!Number.isInteger(v)||v<1)fail(name+' must be a positive integer',{[name]:v});return v;};
export const nonNegative=(v,name)=>{if(!Number.isFinite(v)||v<0)fail(name+' must be a finite number >= 0',{[name]:v});return v;};
export const positive=(v,name)=>{if(!Number.isFinite(v)||v<=0)fail(name+' must be a finite number > 0',{[name]:v});return v;};
export const latitudeOf=v=>{if(!Number.isFinite(v)||v<-90||v>90)fail('latitude must be within [-90, 90]',{latitude:v});return v;};
export const longitudeOf=v=>{if(!Number.isFinite(v)||v<-180||v>180)fail('longitude must be within [-180, 180]',{longitude:v});return v;};
const CACHE_MODES=['memory','persistent','none'];
// Headers that do not trigger a CORS preflight (measured: any other header makes Google reject the request).
export const SAFE_HEADERS=['accept','accept-language','content-language'];
const CREDENTIALS=['omit','same-origin','include'];

class TwoTierCache {
 constructor(memory,disk){this.memory=memory;this.disk=disk;this.persistent=true;this.warning=null;}
 async get(key){const m=await this.memory.get(key);if(m)return {...m,cacheTier:'memory'};try{const d=await this.disk.get(key);if(d){await this.memory.put(key,d);return {...d,cacheTier:'disk'};}}catch(e){this.warning=e.message;this.persistent=false;}return null;}
 async put(key,record){await this.memory.put(key,record);try{await this.disk.put(key,record);}catch(e){this.warning=e.message;this.persistent=false;}}
 async close(){await this.memory.close();await this.disk.close();}
}

// Shared network configuration for 2D and 3D clients. Live settings (concurrency,
// timeout, retries, headers, response limit) apply to queued and new requests;
// settings that change the transport identity (fetch, cache) take effect on the
// next request without aborting requests already in flight.
export class TileClient {
 constructor(defaults){
  this.network={concurrency:defaults.concurrency??8,timeoutMs:defaults.timeoutMs??30000,retries:defaults.retries??2,retryDelayMs:250,headers:{},maxResponseBytes:64*MiB,fetch:null,credentials:'omit',referrerPolicy:undefined};
  this.cacheOptions={mode:'memory',memoryBytes:64*MiB,diskBytes:512*MiB,name:defaults.cacheName,ttlSeconds:null};
  this._transport=null;this._cache=null;this._retired=[];this.disposed=false;
 }
 set(options={}){
  for(const [key,value]of Object.entries(options)){
   const setter=this.constructor.optionSetters[key];if(!setter)fail('Unknown option '+key,{option:key,known:Object.keys(this.constructor.optionSetters)});
   Array.isArray(value)&&setter.spread?this[setter.name](...value):this[setter.name](value);
  }
  return this;
 }
 setConcurrency(n){this.network.concurrency=positiveInt(n,'concurrency');if(this._transport){this._transport.concurrency=n;this._transport.pump();}return this;}
 setTimeout(ms){this.network.timeoutMs=nonNegative(ms,'timeoutMs');if(this._transport)this._transport.timeoutMs=ms;return this;}
 setRetries(retries,retryDelayMs=this.network.retryDelayMs){if(!Number.isInteger(retries)||retries<0)fail('retries must be an integer >= 0',{retries});nonNegative(retryDelayMs,'retryDelayMs');Object.assign(this.network,{retries,retryDelayMs});if(this._transport)Object.assign(this._transport,{retries,retryDelayMs});return this;}
 setHeaders(headers,{merge=false}={}){if(!headers||typeof headers!=='object')fail('headers must be an object');if(typeof document!=='undefined'&&this.network.fetch==null)for(const k of Object.keys(headers))if(!SAFE_HEADERS.includes(k.toLowerCase()))throw new TileError('cors_rejected','Google rejects the CORS preflight caused by header '+k+'; browsers may send only '+SAFE_HEADERS.join(', '),{header:k});for(const [k,v]of Object.entries(headers))if(typeof v!=='string')fail('header values must be strings',{header:k});this.network.headers=merge?{...this.network.headers,...headers}:{...headers};if(this._transport)this._transport.headers=this.network.headers;return this;}
 setMaxResponseBytes(bytes){this.network.maxResponseBytes=positive(bytes,'maxResponseBytes');if(this._transport)this._transport.maxResponseBytes=bytes;return this;}
 setCredentials(mode){if(!CREDENTIALS.includes(mode))fail('credentials must be one of '+CREDENTIALS.join(', '),{credentials:mode});this.network.credentials=mode;if(this._transport)this._transport.credentials=mode;return this;}
 setReferrerPolicy(policy){if(policy!==undefined&&typeof policy!=='string')fail('referrerPolicy must be a string');this.network.referrerPolicy=policy;if(this._transport)this._transport.referrerPolicy=policy;return this;}
 setFetch(fetcher){if(fetcher!=null&&typeof fetcher!=='function')fail('fetch must be a function or null');this.network.fetch=fetcher??null;this.retire();return this;}
 setCache(options){
  const next={...this.cacheOptions,...(typeof options==='string'?{mode:options}:options)};
  if(!CACHE_MODES.includes(next.mode))fail('cache mode must be one of '+CACHE_MODES.join(', '),{mode:next.mode});
  positive(next.memoryBytes,'memoryBytes');positive(next.diskBytes,'diskBytes');if(typeof next.name!=='string'||!next.name)fail('cache name must be a non-empty string');
  if(next.ttlSeconds!=null)nonNegative(next.ttlSeconds,'ttlSeconds');
  this.cacheOptions=next;this.retire();return this;
 }
 getOptions(){return structuredClone({network:{...this.network,fetch:!!this.network.fetch},cache:this.cacheOptions});}
 retire(){
  const transport=this._transport,cache=this._cache;this._transport=null;this._cache=null;if(!transport)return;
  this._retired.push(Promise.allSettled(transport.pending()).then(()=>transport.dispose()).then(()=>cache?.close()).catch(()=>{}));
 }
 transport(){
  if(this.disposed)throw new DOMException('Client disposed','AbortError');
  if(!this._transport){
   const c=this.cacheOptions,memory=c.mode==='none'?null:new MemoryByteCache({maxBytes:c.memoryBytes});
   this._cache=c.mode==='persistent'&&typeof indexedDB!=='undefined'?new TwoTierCache(memory,new IndexedDbByteCache({name:c.name,maxBytes:c.diskBytes})):memory;
   if(c.mode==='persistent'&&typeof indexedDB==='undefined'&&this._cache){this._cache.warning='IndexedDB unavailable: memory cache only';}
   const n=this.network;
   this._transport=new ByteTransport({cache:this._cache,fetch:n.fetch??((url,init)=>globalThis.fetch(url,init)),concurrency:n.concurrency,maxResponseBytes:n.maxResponseBytes,headers:n.headers,timeoutMs:n.timeoutMs,retries:n.retries,retryDelayMs:n.retryDelayMs,credentials:n.credentials,referrerPolicy:n.referrerPolicy,ttlMs:c.ttlSeconds==null?null:c.ttlSeconds*1000});
   this.onTransport?.(this._transport);
  }
  return this._transport;
 }
 getStats(){const t=this._transport;return {...(t?.stats??{networkRequests:0,memoryHits:0,diskHits:0,receivedBytes:0,retries:0}),queued:t?.queue.length??0,running:t?.running??0,cacheMode:this.cacheOptions.mode,cachePersistent:this._cache?.persistent??false,cacheWarning:this._cache?.warning??null};}
 async clearCache(){
  const name=this.cacheOptions.name;this.retire();await Promise.allSettled(this._retired);this._retired=[];
  if(this.cacheOptions.mode==='persistent'&&typeof indexedDB!=='undefined')await new Promise((resolve,reject)=>{const r=indexedDB.deleteDatabase(name);r.onsuccess=resolve;r.onerror=()=>reject(r.error);r.onblocked=resolve;});
 }
 async dispose(){if(this.disposed)return;const t=this._transport,c=this._cache;this._transport=null;this.disposed=true;if(t)await t.dispose();await c?.close();await Promise.allSettled(this._retired);}
}
TileClient.optionSetters={concurrency:{name:'setConcurrency'},timeoutMs:{name:'setTimeout'},retries:{name:'setRetries',spread:true},headers:{name:'setHeaders'},maxResponseBytes:{name:'setMaxResponseBytes'},credentials:{name:'setCredentials'},referrerPolicy:{name:'setReferrerPolicy'},fetch:{name:'setFetch'},cache:{name:'setCache'}};
