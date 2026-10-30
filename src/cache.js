export class MemoryByteCache {
 constructor({maxBytes=32*1024*1024}={}){this.maxBytes=maxBytes;this.bytes=0;this.records=new Map();this.persistent=false;}
 async get(key){const r=this.records.get(key);if(!r)return null;if(r.expiresAt<=Date.now()){this.records.delete(key);this.bytes-=r.bytes.byteLength;return null;}this.records.delete(key);this.records.set(key,r);return r;}
 async put(key,record){if(record.expiresAt<=Date.now()||record.bytes.byteLength>this.maxBytes)return;const old=this.records.get(key);if(old)this.bytes-=old.bytes.byteLength;this.records.delete(key);this.records.set(key,record);this.bytes+=record.bytes.byteLength;while(this.bytes>this.maxBytes){const k=this.records.keys().next().value;this.bytes-=this.records.get(k).bytes.byteLength;this.records.delete(k);}}
 async close(){this.records.clear();this.bytes=0;}
}
const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
const completed=tx=>new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Cache transaction aborted'));});
export class IndexedDbByteCache {
 constructor({name='earth-hq-cache-v1',maxBytes=512*1024*1024}={}){this.name=name;this.maxBytes=maxBytes;this.db=null;this.opening=null;this.writes=Promise.resolve();this.persistent=true;this.closed=false;}
 async open(){if(this.closed)throw Error('Cache closed');if(this.db)return this.db;if(!this.opening)this.opening=(async()=>{const r=indexedDB.open(this.name,1);r.onupgradeneeded=()=>{const db=r.result;const store=db.createObjectStore('bytes',{keyPath:'key'});store.createIndex('accessed','accessed');db.createObjectStore('meta');};this.db=await request(r);return this.db;})();return this.opening;}
 async get(key){const db=await this.open(),tx=db.transaction('bytes','readonly'),done=completed(tx),record=await request(tx.objectStore('bytes').get(key));await done;if(!record||record.expiresAt<=Date.now())return null;this.touch(key);return record;}
 touch(key){this.writes=this.writes.then(async()=>{const db=await this.open(),tx=db.transaction('bytes','readwrite'),done=completed(tx),store=tx.objectStore('bytes'),record=await request(store.get(key));if(record){record.accessed=Date.now();store.put(record);}await done;}).catch(()=>{});}
 async put(key,record){
  if(record.expiresAt<=Date.now()||record.bytes.byteLength>this.maxBytes)return;
  const operation=this.writes.then(async()=>{
   const db=await this.open(),tx=db.transaction(['bytes','meta'],'readwrite'),done=completed(tx),store=tx.objectStore('bytes'),meta=tx.objectStore('meta');
   const previous=await request(store.get(key));let total=(await request(meta.get('totalBytes')))??0;
   total-=previous?.bytes.byteLength??0;total+=record.bytes.byteLength;store.put({...record,key,accessed:Date.now()});
   if(total>this.maxBytes)await new Promise((resolve,reject)=>{const r=store.index('accessed').openCursor();r.onerror=()=>reject(r.error);r.onsuccess=()=>{const c=r.result;if(!c||total<=this.maxBytes){resolve();return;}if(c.primaryKey!==key){total-=c.value.bytes.byteLength;c.delete();}c.continue();};});
   meta.put(total,'totalBytes');await done;
  });this.writes=operation.catch(()=>{});return operation;
 }
 async close(){await this.writes;this.closed=true;this.db?.close();this.db=null;}
}
export class ResilientByteCache {
 constructor(options={}){this.memory=new MemoryByteCache({maxBytes:options.memoryBytes??32*1024*1024});this.disk=typeof indexedDB==='undefined'?null:new IndexedDbByteCache(options);this.persistent=!!this.disk;this.warning=null;}
 async get(key){const mem=await this.memory.get(key);if(mem)return {...mem,cacheTier:'memory'};if(this.disk){try{const r=await this.disk.get(key);if(r){await this.memory.put(key,r);return {...r,cacheTier:'disk'};}}catch(e){this.warning=e.message;this.persistent=false;}}return null;}
 async put(key,record){await this.memory.put(key,record);if(this.disk){try{await this.disk.put(key,record);}catch(e){this.warning=e.message;this.persistent=false;}}}
 async close(){await this.memory.close();await this.disk?.close();}
}
export function cacheLifetime(header,now=Date.now()){
 if(!header||/\b(?:no-store|no-cache)\b/i.test(header))return now;
 const seconds=/\bmax-age\s*=\s*"?(\d+)/i.exec(header)?.[1];return seconds===undefined?now:now+Number(seconds)*1000;
}
