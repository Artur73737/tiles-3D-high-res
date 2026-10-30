import {TileError,aborted} from './errors.js';
import {cacheLifetime} from './cache.js';
export class ByteTransport {
 constructor({cache,fetch:fetcher=globalThis.fetch.bind(globalThis),concurrency=6,maxResponseBytes=64*1024*1024,retries=2,retryDelayMs=300,timeoutMs=15000}={}){
  if(!Number.isInteger(retries)||retries<0||!Number.isFinite(retryDelayMs)||retryDelayMs<0||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new TileError('invalid_options','Invalid network retry options');
  this.cache=cache;this.fetch=fetcher;this.concurrency=concurrency;this.maxResponseBytes=maxResponseBytes;this.retries=retries;this.retryDelayMs=retryDelayMs;this.timeoutMs=timeoutMs;this.queue=[];this.running=0;this.jobs=new Map();this.expiry=new Map();this.controller=new AbortController();this.disposed=false;this.stats={networkRequests:0,memoryHits:0,diskHits:0,receivedBytes:0};
 }
 rememberExpiry(url,time){this.expiry.delete(url);this.expiry.set(url,time);while(this.expiry.size>4096)this.expiry.delete(this.expiry.keys().next().value);}
 getExpiry(url){return this.expiry.get(url)??null;}
 get(url,{fresh=false,priority=0}={}){
  if(this.disposed)return Promise.reject(aborted());
  if(this.jobs.has(url))return this.jobs.get(url);
  const promise=(async()=>{
   if(!fresh){const cached=await this.cache.get(url);if(cached){if(this.disposed)throw aborted();this.rememberExpiry(url,cached.expiresAt);this.stats[cached.cacheTier==='disk'?'diskHits':'memoryHits']++;return cached.bytes;}}
   if(this.disposed)throw aborted();
   return new Promise((resolve,reject)=>{const task={url,resolve,reject,priority},index=this.queue.findIndex(queued=>queued.priority<priority);if(index<0)this.queue.push(task);else this.queue.splice(index,0,task);this.pump();});
  })().finally(()=>this.jobs.delete(url));this.jobs.set(url,promise);return promise;
 }
 pump(){while(!this.disposed&&this.running<this.concurrency&&this.queue.length){const task=this.queue.shift();this.running++;this.download(task.url).then(task.resolve,task.reject).finally(()=>{this.running--;this.pump();});}}
 async download(url){
  let result;
  for(let attempt=0;;attempt++){
   if(this.disposed)throw aborted();
   try{result=await this.fetchBytes(url);break;}
   catch(error){
    if(this.disposed)throw aborted();
    const status=error.details?.status,retryable=['network_error','network_timeout'].includes(error.code)||error.code==='http_error'&&(status===408||status===429||status>=500);
    if(!retryable||attempt>=this.retries){if(retryable)error.details.attempts=attempt+1;throw error;}
    const delay=Math.max(this.retryDelayMs*2**attempt,error.details?.retryAfterMs??0);
    // Long server-directed pauses remain explicit failures, never early retries.
    if(delay>this.timeoutMs)throw error;
    await this.waitToRetry(delay);
   }
  }
  const {bytes,headers}=result;
  if(this.disposed)throw aborted();
  const expiresAt=cacheLifetime(headers.get('cache-control'));this.rememberExpiry(url,expiresAt);await this.cache.put(url,{bytes:bytes.buffer,expiresAt,url});
  if(this.disposed)throw aborted();return bytes.buffer;
 }
 waitToRetry(ms){
  const signal=this.controller.signal;
  return new Promise((resolve,reject)=>{
   if(signal.aborted){reject(aborted());return;}
   const stop=()=>{clearTimeout(timer);reject(aborted());};
   const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);
   signal.addEventListener('abort',stop,{once:true});
  });
 }
 async fetchBytes(url){
  const controller=new AbortController(),signal=this.controller.signal,stop=()=>controller.abort();let timedOut=false;
  signal.addEventListener('abort',stop,{once:true});if(signal.aborted)stop();
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.timeoutMs);
  try{
  this.stats.networkRequests++;const response=await this.fetch(url,{signal:controller.signal,mode:'cors',credentials:'omit',cache:'no-cache'});
  if(!response.ok){
   const retryAfter=response.headers.get('retry-after');
   const retryAfterMs=retryAfter===null?0:/^\d+$/.test(retryAfter)?Number(retryAfter)*1000:Math.max(0,Date.parse(retryAfter)-Date.now())||0;
   await response.body?.cancel();
   throw new TileError('http_error','Tile request failed: '+response.status,{url,status:response.status,retryAfterMs});
  }
  const declared=Number(response.headers.get('content-length'));if(declared>this.maxResponseBytes){await response.body?.cancel();throw new TileError('resource_limit','Response exceeds byte budget',{url,declared});}
  const reader=response.body?.getReader();let bytes;
  if(reader){const chunks=[];let total=0;try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>this.maxResponseBytes)throw new TileError('resource_limit','Response exceeds byte budget',{url,total});chunks.push(value);}bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}}catch(error){await reader.cancel().catch(()=>{});throw error;}}
  else{bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>this.maxResponseBytes)throw new TileError('resource_limit','Response exceeds byte budget',{url});}
  this.stats.receivedBytes+=bytes.byteLength;
  return {bytes,headers:response.headers};
  }catch(error){
   if(signal.aborted)throw aborted();
   if(timedOut||error instanceof TypeError)throw new TileError(timedOut?'network_timeout':'network_error',timedOut?'3D tile request timed out':'Cannot reach the 3D tile service',{url,reason:error.message});
   throw error;
  }finally{clearTimeout(timer);signal.removeEventListener('abort',stop);}
 }
 async dispose(){if(this.disposed)return;this.disposed=true;this.controller.abort();for(const job of this.queue.splice(0))job.reject(aborted());await Promise.allSettled([...this.jobs.values()]);}
}
