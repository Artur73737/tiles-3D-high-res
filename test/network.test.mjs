import test from 'node:test';
import assert from 'node:assert/strict';
import {ByteTransport} from '../src/transport.js';
import {MemoryByteCache} from '../src/cache.js';
import {EarthHQStreaming} from '../src/streamer.js';

const url='https://tiles.test/metadata';
test('transient network and truncated-body failures retry one deduplicated job and cache only complete bytes',async()=>{
 let calls=0;const cache=new MemoryByteCache();
 const transport=new ByteTransport({cache,retryDelayMs:1,fetch:async()=>{
  calls++;if(calls===1)throw new TypeError('Failed to fetch');
  if(calls===2)return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([99]));c.error(new TypeError('Connection lost'));}}));
  return new Response(new Uint8Array([1,2,3]),{headers:{'cache-control':'max-age=60'}});
 }});
 try{
  const [a,b]=await Promise.all([transport.get(url),transport.get(url)]);
  assert.equal(calls,3);assert.deepEqual(new Uint8Array(a),new Uint8Array([1,2,3]));assert.equal(a,b);
  assert.equal(transport.stats.networkRequests,3);await transport.get(url);assert.equal(calls,3);
 }finally{await transport.dispose();await cache.close();}
});

test('HTTP retries honor retryability and server pauses without retrying absence or resource limits',async()=>{
 for(const [status,retryAfter,expectedCalls]of [[503,null,3],[429,'0',3],[429,'60',1],[404,null,1],[403,null,1]]){
  let calls=0;const transport=new ByteTransport({cache:new MemoryByteCache(),retryDelayMs:1,fetch:async()=>{calls++;return new Response('',{status,headers:retryAfter?{'retry-after':retryAfter}:{}});}});
  try{await assert.rejects(transport.get(url),e=>e.code==='http_error'&&e.details.status===status&&e.details.url===url);assert.equal(calls,expectedCalls);}finally{await transport.dispose();}
 }
 let canceled=false,calls=0;
 const transport=new ByteTransport({cache:new MemoryByteCache(),maxResponseBytes:1,fetch:async()=>{calls++;return new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'content-length':'2'}});}});
 try{await assert.rejects(transport.get(url),{code:'resource_limit'});assert.equal(calls,1);assert.equal(canceled,true);}finally{await transport.dispose();}
});

test('exhausted retries preserve network evidence and permit a later request to succeed',async()=>{
 let online=false,calls=0;const transport=new ByteTransport({cache:new MemoryByteCache(),retryDelayMs:1,fetch:async()=>{calls++;if(!online)throw new TypeError('Failed to fetch');return new Response('ok');}});
 try{
  await assert.rejects(transport.get(url),e=>e.code==='network_error'&&e.details.url===url&&e.details.attempts===3&&e.details.reason==='Failed to fetch');
  assert.equal(transport.jobs.size,0);online=true;assert.equal(new TextDecoder().decode(await transport.get(url)),'ok');assert.equal(calls,4);
 }finally{await transport.dispose();}
});

test('timeouts retry but disposal interrupts both active attempts and retry backoff',async()=>{
 let calls=0;const transport=new ByteTransport({cache:new MemoryByteCache(),retryDelayMs:1,timeoutMs:5,fetch:async(_,{signal})=>{
  calls++;if(calls>1)return new Response('ok');
  return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('Canceled','AbortError')),{once:true}));
 }});
 try{assert.equal(new TextDecoder().decode(await transport.get(url)),'ok');assert.equal(calls,2);}finally{await transport.dispose();}
 let failed;const reached=new Promise(resolve=>{failed=resolve;});calls=0;
 const backoff=new ByteTransport({cache:new MemoryByteCache(),retryDelayMs:30000,timeoutMs:60000,fetch:async()=>{calls++;failed();throw new TypeError('Failed to fetch');}});
 const request=backoff.get(url);const rejected=assert.rejects(request,{name:'AbortError'});
 await reached;await new Promise(resolve=>setTimeout(resolve,0));await backoff.dispose();await rejected;assert.equal(calls,1);assert.equal(backoff.jobs.size,0);
});

test('failed startup is not memoized forever and a late root cannot initialize a disposed engine',async()=>{
 let calls=0;const planet={epoch:1,radius:6371010};
 const source={root:async()=>{if(++calls===1)throw new TypeError('Failed to fetch');return planet;},copyrights:async()=>new Map()};
 const engine=new EarthHQStreaming({source});
 try{await assert.rejects(engine.start());assert.equal(await engine.start(),planet);assert.equal(calls,2);}finally{await engine.dispose();}
 let deliver;const late=new EarthHQStreaming({source:{...source,root:()=>new Promise(resolve=>{deliver=resolve;})}});
 const started=late.start();const rejected=assert.rejects(started,{name:'AbortError'});
 await late.dispose();deliver(planet);await rejected;assert.equal(late.planet,null);
});
