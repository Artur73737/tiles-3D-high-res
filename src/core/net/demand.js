import {aborted} from '../errors.js';

// One operation shared by any number of consumers. Each consumer subscribes with its own
// AbortSignal; releasing one consumer never cancels the others. The operation is aborted
// only when the last consumer leaves before it settles.
export class SharedDemand {
 constructor(operation,{onEmpty=()=>{},onSettled=()=>{}}={}){
  this.controller=new AbortController();this.consumers=new Set();this.settled=false;this.onEmpty=onEmpty;
  this.promise=Promise.resolve().then(()=>{if(this.controller.signal.aborted)throw aborted();return operation(this.controller.signal);});
  this.promise.then(value=>this.finish(null,value),error=>this.finish(error)).then(onSettled);
 }
 subscribe(signal){
  if(signal?.aborted||this.controller.signal.aborted)return Promise.reject(aborted());
  if(this.settled)return this.error?Promise.reject(this.error):Promise.resolve(this.value);
  return new Promise((resolve,reject)=>{
   const consumer={resolve,reject,signal,stop:null};
   consumer.stop=()=>{this.release(consumer);reject(aborted());if(!this.consumers.size&&!this.settled){this.onEmpty();this.controller.abort();}};
   this.consumers.add(consumer);signal?.addEventListener('abort',consumer.stop,{once:true});
  });
 }
 release(consumer){consumer.signal?.removeEventListener('abort',consumer.stop);this.consumers.delete(consumer);}
 finish(error,value){
  this.settled=true;this.error=error;this.value=value;
  for(const consumer of [...this.consumers]){this.release(consumer);error?consumer.reject(error):consumer.resolve(value);}
 }
 abort(){if(this.settled)return;this.onEmpty();this.controller.abort();for(const consumer of [...this.consumers]){this.release(consumer);consumer.reject(aborted());}}
}
