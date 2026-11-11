// Streaming building blocks: request priority, shared demand, transport scheduling and cancellation,
// decoder pool fallback, camera priority tiers and fade-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Group,Mesh,MeshBasicMaterial,BufferGeometry} from 'three';
import {compareRequestPriority} from '../src/core/net/priority.js';
import {SharedDemand} from '../src/core/net/demand.js';
import {ByteTransport} from '../src/core/net/transport.js';
import {DecoderPool} from '../src/core/rocktree/decoder/pool.js';
import {viewPriority,cameraEye,MAX_RADIUS_M} from '../src/ui/scene/stream3d.js';
import {PerspectiveCamera} from 'three';
import {FadeIn} from '../src/ui/scene/fade.js';

test('priority tuples compare left to right, higher first',()=>{
 const list=[[0,-5],[2,-300],[1,-10],[2,-20],3,[1,-1]].sort(compareRequestPriority);
 assert.deepEqual(list,[3,[2,-20],[2,-300],[1,-1],[1,-10],[0,-5]]);
});

test('shared demand: one consumer leaving does not cancel the others; the last one aborts',async()=>{
 let signal;const gate=Promise.withResolvers();
 const d=new SharedDemand(async s=>{signal=s;return gate.promise;});
 const a=new AbortController(),b=new AbortController(),pa=d.subscribe(a.signal),pb=d.subscribe(b.signal);
 a.abort();await assert.rejects(pa,{name:'AbortError'});await Promise.resolve();assert.equal(signal.aborted,false);
 gate.resolve(7);assert.equal(await pb,7);
 const c=new AbortController(),e=new SharedDemand(async s=>{signal=s;return new Promise(()=>{});}),pc=e.subscribe(c.signal);
 await Promise.resolve();c.abort();await assert.rejects(pc,{name:'AbortError'});assert.equal(signal.aborted,true);
});

// fetch stub: each URL resolves when released, and records start order.
function stubFetch(){
 const started=[],waits=new Map();
 const fetch=(url,{signal})=>new Promise((resolve,reject)=>{started.push(url);signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});
  waits.set(url,()=>resolve(new Response(new Uint8Array([url.length]),{status:200,headers:{'cache-control':'max-age=60'}})));});
 return {fetch,started,release:url=>waits.get(url)?.()};
}

test('transport: one download per URL, highest priority first, abort when nobody wants it',async()=>{
 const net=stubFetch(),t=new ByteTransport({fetch:net.fetch,concurrency:1});
 const first=t.get('u0',{priority:0});await new Promise(r=>setTimeout(r));
 const low=t.get('low',{priority:[0,-100]}),near=t.get('near',{priority:[2,-5]}),view=t.get('view',{priority:[1,-1]});
 const again=t.get('near',{priority:[2,-5]});
 const ctl=new AbortController(),gone=t.get('gone',{priority:[9],signal:ctl.signal});ctl.abort();
 await assert.rejects(gone,{name:'AbortError'});
 for(const u of ['u0','near','view','low']){await new Promise(r=>setTimeout(r));net.release(u);}
 await Promise.all([first,low,near,view,again]);
 assert.deepEqual(net.started,['u0','near','view','low']);assert.equal(t.stats.networkRequests,4);
 assert.equal(await again,await near);await t.dispose();
});

test('transport: raising the priority of a queued URL moves it ahead',async()=>{
 const net=stubFetch(),t=new ByteTransport({fetch:net.fetch,concurrency:1});
 const busy=t.get('busy');await new Promise(r=>setTimeout(r));
 const a=t.get('a',{priority:1}),b=t.get('b',{priority:2});t.get('a',{priority:5});
 for(const u of ['busy','a','b']){await new Promise(r=>setTimeout(r));net.release(u);}
 await Promise.all([busy,a,b]);assert.deepEqual(net.started,['busy','a','b']);await t.dispose();
});

test('decoder pool decodes on the calling thread when workers are unavailable',async()=>{
 const pool=new DecoderPool();assert.equal(pool.mode,'inline');
 await assert.rejects(pool.decode(1,new Uint8Array([1,2,3]).buffer));
 const ctl=new AbortController();ctl.abort();await assert.rejects(pool.decode(1,new ArrayBuffer(4),{signal:ctl.signal}),{name:'AbortError'});
});

test('camera priority: near+view > view > near off screen > elsewhere, nearer first within a tier',()=>{
 const eye={position:new Vector3(0,0,0),direction:new Vector3(0,1,0),halfAngle:Math.PI/6};
 const tile=(x,y,r=5)=>({center:[x,y,0],radius:r});
 assert.equal(viewPriority(tile(0,40),eye,{nearRadiusMeters:60})[0],3);
 assert.equal(viewPriority(tile(0,300),eye,{nearRadiusMeters:60})[0],2);
 assert.equal(viewPriority(tile(0,-40),eye,{nearRadiusMeters:60})[0],1);
 assert.equal(viewPriority(tile(0,-300),eye,{nearRadiusMeters:60})[0],0);
 assert.equal(viewPriority(tile(0,300),eye,{nearRadiusMeters:60,viewPriority:false})[0],0);
 assert.ok(viewPriority(tile(0,200),eye,{})[1]>viewPriority(tile(0,400),eye,{})[1]);
 assert.equal(MAX_RADIUS_M,500);
 // Exact frustum: a tile beside the screen edge is off screen even if a circular cone would include it.
 const cam=new PerspectiveCamera(60,1,.1,1e5);cam.lookAt(0,1,0);const fe=cameraEye(cam);
 assert.equal(viewPriority(tile(0,300),fe,{})[0],2);assert.equal(viewPriority(tile(250,300,1),fe,{})[0],0);
});

test('fade-in ramps opacity and restores the original material state',()=>{
 const opaque=new MeshBasicMaterial(),water=new MeshBasicMaterial({transparent:true,opacity:.75}),g=new Group();
 g.add(new Mesh(new BufferGeometry(),opaque),new Mesh(new BufferGeometry(),water));
 const f=new FadeIn(100);f.add(g,0);assert.equal(opaque.opacity,0);assert.equal(opaque.transparent,true);
 f.update(50);assert.ok(opaque.opacity>0&&opaque.opacity<1);assert.ok(water.opacity<.75);
 f.update(100);assert.equal(opaque.opacity,1);assert.equal(opaque.transparent,false);assert.equal(water.opacity,.75);assert.equal(water.transparent,true);assert.equal(f.active,0);
 const off=new FadeIn(0),m=new MeshBasicMaterial();off.add(new Mesh(new BufferGeometry(),m),0);assert.equal(m.opacity,1);
});
