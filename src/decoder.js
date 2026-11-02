import decode from './vendor/rocktree-decoder.cjs';
import {aborted,TileError} from './errors.js';
export class DecoderPool {
 constructor(){this.workers=[];this.queue=[];this.nextId=0;this.disposed=false;}
 decode(command,bytes){
  if(this.disposed)return Promise.reject(this.failure??aborted());
  if(typeof Worker==='undefined'||typeof __EARTH_DECODER_WORKER__==='undefined')return decode(command,new Uint8Array(bytes)).then(result=>result.payload);
  if(!this.workers.length){
   const url=URL.createObjectURL(new Blob([__EARTH_DECODER_WORKER__],{type:'text/javascript'}));
   try{for(let i=0;i<Math.min(12,Math.max(1,navigator.hardwareConcurrency??4));i++){
    const slot={worker:new Worker(url),job:null};
    slot.worker.onmessage=({data})=>{const job=slot.job;if(!job||data.id!==job.id)return;slot.job=null;data.error?job.reject(new TileError('decode_error',data.error)):job.resolve(data.payload);this.pump();};
    slot.worker.onerror=event=>{event.preventDefault();this.dispose(new TileError('decode_error',event.message));};this.workers.push(slot);
   }}catch(error){this.dispose();return Promise.reject(error);}finally{URL.revokeObjectURL(url);}
  }
  return new Promise((resolve,reject)=>{this.queue.push({id:++this.nextId,command,bytes,resolve,reject});this.pump();});
 }
 pump(){for(const slot of this.workers)if(!slot.job&&this.queue.length){slot.job=this.queue.shift();const job=slot.job,copy=job.bytes.slice(0);slot.worker.postMessage({id:job.id,command:job.command,bytes:copy},[copy]);}}
 dispose(failure){if(this.disposed)return;this.disposed=true;this.failure=failure;for(const slot of this.workers){slot.job?.reject(failure??aborted());slot.worker.terminate();}for(const job of this.queue)job.reject(failure??aborted());this.workers=[];this.queue=[];}
}
