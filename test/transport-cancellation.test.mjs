import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ByteTransport} from '../src/transport.js';
import {MemoryByteCache} from '../src/cache.js';
import {RocktreeSource} from '../src/source.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const ok=()=>new Response(new Uint8Array([1,2]),{headers:{'cache-control':'max-age=60'}});

test('shared byte demand cancels one consumer without aborting another, and removes obsolete queued work',async()=>{
 const hold=deferred(),started=deferred(),calls=[],cache=new MemoryByteCache();let wireSignal;
 const transport=new ByteTransport({cache,concurrency:1,fetch:async(url,{signal})=>{calls.push(url);wireSignal=signal;started.resolve();await hold.promise;return ok();}});
 const a=new AbortController(),b=new AbortController(),queued=new AbortController();
 const first=transport.get('shared',{signal:a.signal}),second=transport.get('shared',{signal:b.signal}),obsolete=transport.get('obsolete',{signal:queued.signal});
 const canceledA=assert.rejects(first,{name:'AbortError'}),canceledQueued=assert.rejects(obsolete,{name:'AbortError'});
 await started.promise;await tick();a.abort();queued.abort();await Promise.all([canceledA,canceledQueued]);assert.equal(wireSignal.aborted,false);hold.resolve();assert.equal((await second).byteLength,2);assert.deepEqual(calls,['shared']);await transport.dispose();
});

test('last consumer cancellation aborts a streaming body and skips retries and incomplete cache writes',async()=>{
 const reading=deferred(),cache=new MemoryByteCache();let calls=0,wireSignal;
 const transport=new ByteTransport({cache,fetch:async(url,{signal})=>{calls++;wireSignal=signal;return new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array([1]));signal.addEventListener('abort',()=>controller.error(new DOMException('Canceled','AbortError')));reading.resolve();}}));}});
 const controller=new AbortController(),result=transport.get('stream',{signal:controller.signal}),rejected=assert.rejects(result,{name:'AbortError'});
 await reading.promise;controller.abort();await rejected;await transport.dispose();assert.equal(wireSignal.aborted,true);assert.equal(calls,1);assert.equal(await cache.get('stream'),null);assert.equal(transport.running,0);
});

test('reacquiring a canceled URL owns a fresh request while a late old completion cannot remove it',async()=>{
 const firstGate=deferred(),secondGate=deferred(),cache=new MemoryByteCache();let calls=0;
 const transport=new ByteTransport({cache,concurrency:2,fetch:async()=>{const n=++calls;await (n===1?firstGate:secondGate).promise;return ok();}});
 const controller=new AbortController(),first=transport.get('same',{signal:controller.signal}),rejected=assert.rejects(first,{name:'AbortError'});await tick();controller.abort();await rejected;
 const next=transport.get('same');await tick();firstGate.resolve();await tick();assert.equal(transport.jobs.size,1);assert.equal(await cache.get('same'),null);secondGate.resolve();assert.equal((await next).byteLength,2);await transport.dispose();assert.equal(calls,2);
});

test('queued demand priority can change without creating another subscriber or fetch',async()=>{
 const gate=deferred(),calls=[],cache=new MemoryByteCache();
 const transport=new ByteTransport({cache,concurrency:1,fetch:async url=>{calls.push(url);if(url==='first')await gate.promise;return ok();}});
 const first=transport.get('first');await tick();const low=transport.get('low',{priority:0}),high=transport.get('high',{priority:3});await tick();transport.reprioritize('low',5);gate.resolve();await Promise.all([first,low,high]);assert.deepEqual(calls,['first','low','high']);await transport.dispose();
});

test('cancellation during a completed byte-cache commit retains ownership until the write settles',async()=>{
 const gate=deferred(),writing=deferred(),cache=new MemoryByteCache(),put=cache.put.bind(cache);cache.put=async(...args)=>{writing.resolve();await gate.promise;return put(...args);};
 const transport=new ByteTransport({cache,fetch:async()=>ok()}),controller=new AbortController();
 const result=transport.get('complete',{signal:controller.signal}),rejected=assert.rejects(result,{name:'AbortError'});await writing.promise;controller.abort();await rejected;
 let disposed=false;const cleanup=transport.dispose().then(()=>disposed=true);await tick();assert.equal(disposed,false);gate.resolve();await cleanup;assert.equal((await cache.get('complete')).bytes.byteLength,2);assert.equal(transport.owned.size,0);
});

test('parsed metadata sharing keeps new-view demand alive after old-view cancellation',async()=>{
 const fixture=readFileSync(new URL('./fixtures/bulk.pb',import.meta.url)),gate=deferred(),cache=new MemoryByteCache();let calls=0,wireSignal;
 const transport=new ByteTransport({cache,fetch:async(url,{signal})=>{calls++;wireSignal=signal;await gate.promise;return new Response(fixture,{headers:{'cache-control':'max-age=60'}});}}),source=new RocktreeSource({transport});
 const oldView=new AbortController(),newView=new AbortController(),path='30427242735060526245';
 const first=source.loadBulk(path,1016,{signal:oldView.signal}),second=source.loadBulk(path,1016,{signal:newView.signal}),rejected=assert.rejects(first,{name:'AbortError'});
 await tick();oldView.abort();await rejected;assert.equal(wireSignal.aborted,false);gate.resolve();const parsed=await second;assert.equal(parsed.path,path);assert.equal(calls,1);assert.equal(await source.loadBulk(path,1016),parsed);source.clear();await transport.dispose();
});

test('canceling all metadata consumers permits immediate reacquisition without caching stale decode output',async()=>{
 const firstDecode=deferred(),secondDecode=deferred();let calls=0;
 const source=new RocktreeSource({transport:{get:async()=>new ArrayBuffer(0),getExpiry:()=>Date.now()+60000}});source.decoder={decode:()=>++calls===1?firstDecode.promise:secondDecode.promise,dispose(){}};
 const controller=new AbortController(),first=source.loadBulk('123',1,{signal:controller.signal}),rejected=assert.rejects(first,{name:'AbortError'});await tick();controller.abort();await rejected;
 const second=source.loadBulk('123',1);await tick();firstDecode.resolve({headNodePath:'123'});await tick();assert.equal(source.bulk.size,1);secondDecode.resolve({headNodePath:'123'});const parsed=await second;assert.equal(parsed.path,'123');assert.equal(await source.loadBulk('123',1),parsed);source.clear();
});
