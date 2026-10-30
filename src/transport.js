import {TileError,aborted} from './errors.js';
import {cacheLifetime} from './cache.js';
export class ByteTransport {
 constructor({cache,fetch:fetcher=globalThis.fetch.bind(globalThis),concurrency=6,maxResponseBytes=64*1024*1024}={}){this.cache=cache;this.fetch=fetcher;this.concurrency=concurrency;this.maxResponseBytes=maxResponseBytes;this.queue=[];this.running=0;this.jobs=new Map();this.expiry=new Map();this.controller=new AbortController();this.disposed=false;this.stats={networkRequests:0,memoryHits:0,diskHits:0,receivedBytes:0};}
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
  this.stats.networkRequests++;const response=await this.fetch(url,{signal:this.controller.signal,mode:'cors',credentials:'omit',cache:'no-cache'});
  if(!response.ok)throw new TileError('http_error','Tile request failed: '+response.status,{url,status:response.status});
  const declared=Number(response.headers.get('content-length'));if(declared>this.maxResponseBytes)throw new TileError('resource_limit','Response exceeds byte budget',{url,declared});
  const reader=response.body?.getReader();let bytes;
  if(reader){const chunks=[];let total=0;try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>this.maxResponseBytes)throw new TileError('resource_limit','Response exceeds byte budget',{url,total});chunks.push(value);}bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}}catch(error){await reader.cancel().catch(()=>{});throw error;}}
  else{bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>this.maxResponseBytes)throw new TileError('resource_limit','Response exceeds byte budget',{url});}
  this.stats.receivedBytes+=bytes.byteLength;
  if(this.disposed)throw aborted();
  const expiresAt=cacheLifetime(response.headers.get('cache-control'));this.rememberExpiry(url,expiresAt);await this.cache.put(url,{bytes:bytes.buffer,expiresAt,url});
  if(this.disposed)throw aborted();return bytes.buffer;
 }
 async dispose(){if(this.disposed)return;this.disposed=true;this.controller.abort();for(const job of this.queue.splice(0))job.reject(aborted());await Promise.allSettled([...this.jobs.values()]);}
}
