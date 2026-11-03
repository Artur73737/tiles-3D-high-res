import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3,PerspectiveCamera,Frustum,Matrix4} from 'three';
import decode from '../src/vendor/rocktree-decoder.cjs';
import {EarthHQStreaming} from '../src/streamer.js';
import {ByteTransport} from '../src/transport.js';
import {MemoryByteCache} from '../src/cache.js';
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function until(predicate){for(let i=0;i<1000;i++){if(predicate())return;await tick();}assert.fail('Streaming condition did not settle');}
const fixture=readFileSync(new URL('./fixtures/node.pb',import.meta.url));
const radius=6371010;

function setup(){
 const calls=[],cache=new MemoryByteCache(),errors=[];
 const transport=new ByteTransport({cache,concurrency:1,fetch:(url,{signal})=>new Promise((resolve,reject)=>{
  const call={url,signal,complete:()=>resolve(new Response(fixture,{headers:{'cache-control':'max-age=60'}}))};calls.push(call);
  signal.addEventListener('abort',()=>reject(new DOMException('Canceled','AbortError')),{once:true});
 })});
 const nodes=[['a','100',500],['b','200',520],['c','300',-500]].map(([key,path,east])=>({key,path,center:new Vector3(radius,east,0),radius:10,metersPerTexel:10,leaf:true,hasData:true,epoch:1,flags:0}));
 const source={transport,root:async()=>({radius,epoch:1}),copyrights:async()=>new Map(),children:async()=>nodes,loadNode:async(node,options)=>(await decode(1,new Uint8Array(await transport.get(node.key,options)))).payload,clear(){}};
 const streamer=new EarthHQStreaming({source,concurrency:3,screenSpaceError:1,radiusMeters:2000,retainRadiusMeters:2000});
 streamer.addEventListener('error',event=>errors.push(event.error));streamer.addEventListener('warning',event=>errors.push(event.error));
 const camera=new PerspectiveCamera(60,1,1,10000);camera.position.set(radius+100,0,0);camera.up.set(1,0,0);
 const aim=east=>{camera.lookAt(radius,east,0);camera.updateMatrixWorld(true);};
 const view=()=>{const projection=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);return {projection,position:camera.position.clone(),direction:camera.getWorldDirection(new Vector3()),frustum:new Frustum().setFromProjectionMatrix(projection),pixelScale:1080*camera.projectionMatrix.elements[0]/2};};
 const update=()=>streamer.update(camera,{radiusMeters:2000});
 const start=async()=>{aim(500);await streamer.requestRegion({latitude:0,longitude:0,radiusMeters:2000,cameraView:view(),waitForCompletion:false});await until(()=>calls.length===1&&transport.queue.length===1);};
 const close=async()=>{await streamer.dispose();await transport.dispose();await cache.close();};
 return {streamer,transport,calls,errors,aim,update,start,close};
}

test('a rapid view turn cancels stale streaming and queued payloads after two grace frames without retry starvation',async()=>{
 const s=setup();
 try{
  await s.start();assert.deepEqual(s.calls.map(call=>call.url),['a']);
  s.aim(-500);s.update();s.update();assert.equal(s.calls[0].signal.aborted,false);
  s.update();await until(()=>s.calls.some(call=>call.url==='c'));
  assert.equal(s.calls[0].signal.aborted,true);assert.equal(s.calls.some(call=>call.url==='b'),false);
  s.calls.find(call=>call.url==='c').complete();const coverage=await s.streamer.waitForIdle(5000);
  assert.equal(coverage.complete,true);assert.deepEqual(s.calls.map(call=>call.url),['a','c']);assert.deepEqual([...s.streamer.assets.keys()],['c']);assert.equal(s.streamer.failed.size,0);assert.deepEqual(s.errors,[]);assert.equal(s.transport.queue.length,0);
 }finally{await s.close();}
});

test('reversing the camera before canceled payload cleanup requeues current demand and completes',async()=>{
 const s=setup();
 try{
  await s.start();s.aim(-500);s.update();s.update();s.update();assert.equal(s.calls[0].signal.aborted,true);
  // Reverse synchronously, before the canceled request's promise finalizers run.
  s.aim(500);s.update();
  await until(()=>s.calls.filter(call=>call.url==='a').length===2);s.calls.filter(call=>call.url==='a')[1].complete();
  await until(()=>s.calls.some(call=>call.url==='b'));s.calls.find(call=>call.url==='b').complete();
  const coverage=await s.streamer.waitForIdle(5000);assert.equal(coverage.complete,true);assert.deepEqual(s.calls.map(call=>call.url),['a','a','b']);assert.equal(s.streamer.active.size,0);assert.equal(s.streamer.payloadControllers.size,0);assert.equal(s.streamer.failed.size,0);assert.deepEqual(s.errors,[]);
 }finally{await s.close();}
});
