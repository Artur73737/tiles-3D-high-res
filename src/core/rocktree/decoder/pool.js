// Rocktree decoding (command 0 = BulkMetadata, 1 = NodeData).
// In a browser bundle the work runs in a pool of Web Workers so decoding never blocks rendering.
// Without workers (Node, tests, a page that forbids blob: workers) it decodes on the calling thread.
import decode from '../vendor/rocktree-decoder.cjs';
import {TileError,aborted} from '../../errors.js';

/* global __TILES_DECODER_WORKER__ */
const workerSource=typeof __TILES_DECODER_WORKER__==='string'?__TILES_DECODER_WORKER__:null;
const inline=(command,bytes)=>decode(command,new Uint8Array(bytes)).then(r=>r.payload);

export class DecoderPool {
 constructor({size}={}){
  this.size=size??Math.min(8,Math.max(1,(globalThis.navigator?.hardwareConcurrency??4)-1));
  this.slots=[];this.queue=[];this.nextId=0;this.inline=!workerSource||typeof Worker==='undefined';
 }
 get mode(){return this.inline?'inline':'worker';}
 // bytes: ArrayBuffer. The caller keeps its buffer: workers receive a copy.
 decode(command,bytes,{signal}={}){
  if(signal?.aborted)return Promise.reject(aborted());
  if(!this.inline&&!this.slots.length)this.start();
  if(this.inline)return inline(command,bytes);
  return new Promise((resolve,reject)=>{
   const job={id:++this.nextId,command,bytes,resolve,reject,signal,stop:null};
   if(signal){job.stop=()=>{const i=this.queue.indexOf(job);if(i>=0){this.queue.splice(i,1);reject(aborted());}};signal.addEventListener('abort',job.stop,{once:true});}
   this.queue.push(job);this.pump();
  });
 }
 start(){
  // The Blob URL is kept for the page lifetime: workers may still be fetching it after construction.
  try{
   const url=this.url??=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
   for(let i=0;i<this.size;i++){
    const slot={worker:new Worker(url),job:null};
    slot.worker.onmessage=({data})=>{const job=slot.job;if(!job||data.id!==job.id)return;slot.job=null;job.signal?.removeEventListener('abort',job.stop);data.error?job.reject(new TileError('decode_error',data.error)):job.resolve(data.payload);this.pump();};
    slot.worker.onerror=event=>{event.preventDefault?.();this.fallback();};
    this.slots.push(slot);
   }
  }catch{this.fallback();}
 }
 pump(){
  for(const slot of this.slots){if(slot.job||!this.queue.length)continue;
   const job=this.queue.shift();if(job.signal?.aborted){job.reject(aborted());continue;}
   slot.job=job;const b=job.bytes,copy=b instanceof ArrayBuffer?b.slice(0):new Uint8Array(b.buffer,b.byteOffset,b.byteLength).slice().buffer;slot.worker.postMessage({id:job.id,command:job.command,bytes:copy},[copy]);}
 }
 // A worker failed to start or crashed: finish every pending job on this thread from now on.
 fallback(){
  if(this.inline)return;this.inline=true;
  const jobs=[...this.slots.map(s=>s.job).filter(Boolean),...this.queue.splice(0)];
  for(const slot of this.slots)slot.worker.terminate();this.slots=[];
  for(const job of jobs)inline(job.command,job.bytes).then(job.resolve,job.reject);
 }
}

// One pool per page: workers are shared by every client and survive client re-creation.
let shared=null;
export const decoderPool=()=>shared??=new DecoderPool();
