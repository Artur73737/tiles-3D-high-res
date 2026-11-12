import {TileError,aborted,isAbort} from '../errors.js';
import {cacheLifetime} from './cache.js';
import {SharedDemand} from './demand.js';
import {compareRequestPriority} from './priority.js';
export {compareRequestPriority};
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{if(signal.aborted)return reject(aborted());const t=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);const stop=()=>{clearTimeout(t);reject(aborted());};signal.addEventListener('abort',stop,{once:true});});
export const retryable=error=>!isAbort(error)&&(error?.code==='timeout'||error?.code==='network_error'||(error?.code==='http_error'&&(error.details.status>=500||error.details.status===429||error.details.status===408)));
export class ByteTransport {
 constructor({cache,fetch:fetcher=globalThis.fetch.bind(globalThis),concurrency=6,maxResponseBytes=64*1024*1024,headers={},timeoutMs=0,retries=0,retryDelayMs=250,credentials='omit',referrerPolicy,ttlMs=null}={}){this.ttlMs=ttlMs;this.cache=cache;this.fetch=fetcher;this.concurrency=concurrency;this.maxResponseBytes=maxResponseBytes;this.headers=headers;this.timeoutMs=timeoutMs;this.retries=retries;this.retryDelayMs=retryDelayMs;this.credentials=credentials;this.referrerPolicy=referrerPolicy;this.queue=[];this.running=0;this.jobs=new Map();this.expiry=new Map();this.controller=new AbortController();this.disposed=false;this.stats={networkRequests:0,memoryHits:0,diskHits:0,receivedBytes:0,retries:0};}
 rememberExpiry(url,time){this.expiry.delete(url);this.expiry.set(url,time);while(this.expiry.size>4096)this.expiry.delete(this.expiry.keys().next().value);}
 getExpiry(url){return this.expiry.get(url)??null;}
 getContentType(url){return this.types?.get(url)??null;}
 // One download per URL however many callers ask for it. Each caller may pass its own signal:
 // the download is cancelled only when every caller has aborted. priority is a number or a tuple
 // (see priority.js); asking again for a queued URL with a higher priority moves it up.
 get(url,{fresh=false,priority=0,signal}={}){
  if(this.disposed||signal?.aborted)return Promise.reject(aborted());
  let job=this.jobs.get(url);
  if(job&&!job.controller.signal.aborted){if(compareRequestPriority(priority,job.priority)<0)this.reprioritize(url,priority);return job.subscribe(signal);}
  const forget=()=>{if(this.jobs.get(url)===job)this.jobs.delete(url);};
  job=new SharedDemand(async requestSignal=>{
   if(!fresh&&this.cache){const cached=await this.cache.get(url);if(requestSignal.aborted||this.disposed)throw aborted();if(cached){this.rememberExpiry(url,cached.expiresAt);if(cached.contentType)this.rememberType(url,cached.contentType);this.stats[cached.cacheTier==='disk'?'diskHits':'memoryHits']++;return cached.bytes;}}
   if(requestSignal.aborted||this.disposed)throw aborted();
   return new Promise((resolve,reject)=>{
    const task={url,resolve,reject,priority:job.priority,signal:requestSignal,stop:null};job.queued=task;
    task.stop=()=>{const i=this.queue.indexOf(task);if(i>=0)this.queue.splice(i,1);job.queued=null;reject(aborted());};
    requestSignal.addEventListener('abort',task.stop,{once:true});this.enqueue(task);this.pump();
   });
  },{onEmpty:forget,onSettled:forget});
  job.priority=priority;this.jobs.set(url,job);return job.subscribe(signal);
 }
 // Stable insertion: equal priorities keep request order.
 enqueue(task){let i=this.queue.findIndex(q=>compareRequestPriority(task.priority,q.priority)<0);if(i<0)i=this.queue.length;this.queue.splice(i,0,task);}
 reprioritize(url,priority){const job=this.jobs.get(url);if(!job)return;job.priority=priority;const task=job.queued;if(task){const i=this.queue.indexOf(task);if(i>=0){this.queue.splice(i,1);task.priority=priority;this.enqueue(task);}}}
 rememberType(url,type){(this.types??=new Map()).delete(url);this.types.set(url,type);while(this.types.size>4096)this.types.delete(this.types.keys().next().value);}
 pump(){while(!this.disposed&&this.running<this.concurrency&&this.queue.length){const task=this.queue.shift();task.signal.removeEventListener('abort',task.stop);const job=this.jobs.get(task.url);if(job?.queued===task)job.queued=null;if(task.signal.aborted){task.reject(aborted());continue;}this.running++;this.download(task.url,task.signal).then(task.resolve,task.reject).finally(()=>{this.running--;this.pump();});}}
 async download(url,signal){
  for(let attempt=0;;attempt++){
   try{return await this.attempt(url,signal);}
   catch(error){if(this.disposed||signal?.aborted)throw aborted();if(attempt>=this.retries||!retryable(error))throw error;this.stats.retries++;await sleep(this.retryDelayMs*2**attempt,signal??this.controller.signal);}
  }
 }
 async attempt(url,signal){
  this.stats.networkRequests++;
  const local=new AbortController(),forward=()=>local.abort();this.controller.signal.addEventListener('abort',forward,{once:true});signal?.addEventListener('abort',forward,{once:true});
  let timedOut=false;const timer=this.timeoutMs>0?setTimeout(()=>{timedOut=true;local.abort();},this.timeoutMs):null;
  try{
   let response;
   try{response=await this.fetch(url,{signal:local.signal,mode:'cors',credentials:this.credentials,cache:'no-cache',headers:{...this.headers},...(this.referrerPolicy?{referrerPolicy:this.referrerPolicy}:{})});}
   catch(error){if(timedOut)throw new TileError('timeout','Tile request timed out',{url,timeoutMs:this.timeoutMs});if(isAbort(error))throw error;throw new TileError('network_error','Tile request failed: '+(error?.message??error),{url});}
   // A proxy (serve.py) reports an upstream 404 as 204 + X-Upstream-Status, which browsers do not log.
   const upstream=response.status===204?Number(response.headers.get('x-upstream-status'))||0:0;
   if(upstream)throw new TileError('http_error','Tile request failed: '+upstream,{url,status:upstream});
   if(!response.ok)throw new TileError('http_error','Tile request failed: '+response.status,{url,status:response.status});
   const declared=Number(response.headers.get('content-length'));if(declared>this.maxResponseBytes)throw new TileError('resource_limit','Response exceeds byte budget',{url,declared});
   const reader=response.body?.getReader();let bytes;
   try{
    if(reader){const chunks=[];let total=0;try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>this.maxResponseBytes)throw new TileError('resource_limit','Response exceeds byte budget',{url,total});chunks.push(value);}bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}}catch(error){await reader.cancel().catch(()=>{});throw error;}}
    else{bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>this.maxResponseBytes)throw new TileError('resource_limit','Response exceeds byte budget',{url});}
   }catch(error){if(timedOut)throw new TileError('timeout','Tile request timed out',{url,timeoutMs:this.timeoutMs});throw error;}
   this.stats.receivedBytes+=bytes.byteLength;
   if(this.disposed)throw aborted();
   const contentType=response.headers.get('content-type');if(contentType)this.rememberType(url,contentType);
   const expiresAt=this.ttlMs!=null?Date.now()+this.ttlMs:cacheLifetime(response.headers.get('cache-control'));this.rememberExpiry(url,expiresAt);if(this.cache)await this.cache.put(url,{bytes:bytes.buffer,expiresAt,url,contentType});
   if(this.disposed)throw aborted();return bytes.buffer;
  }finally{clearTimeout(timer);this.controller.signal.removeEventListener('abort',forward);signal?.removeEventListener('abort',forward);}
 }
 async dispose(){if(this.disposed)return;this.disposed=true;this.controller.abort();const jobs=[...this.jobs.values()];for(const job of jobs)job.abort();for(const task of this.queue.splice(0))task.reject(aborted());await Promise.allSettled(jobs.map(j=>j.promise));}
 pending(){return [...this.jobs.values()].map(j=>j.promise);}
}
