import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3,Scene,PerspectiveCamera,Group} from 'three';
import decode from '../src/vendor/rocktree-decoder.cjs';
import {planetMetadata} from '../src/protobuf.js';
import {MemoryByteCache,cacheLifetime} from '../src/cache.js';
import {ByteTransport} from '../src/transport.js';
import {RocktreeSource} from '../src/source.js';
import {EarthHQStreaming} from '../src/streamer.js';
import {buildAsset,disposeAsset} from '../src/geometry.js';
import {intersectsColumn,intersectsRegion} from '../src/geo.js';
import {SprintInput} from '../src/demo/SprintInput.js';
const fixture=name=>new Uint8Array(readFileSync(new URL('./fixtures/'+name,import.meta.url)));
const root=()=>planetMetadata(fixture('planet.pb'));
const decoded=async()=>(await decode(1,fixture('node.pb'))).payload;
const tick=()=>new Promise(r=>setTimeout(r,0));
function fakeSource({depth=0,fail=false,load=decoded}={}){
 const leaf={path:'1'.repeat(depth+1),key:'node-terminal',leaf:true,hasData:true,empty:false,center:new Vector3(6371010,0,0),radius:10,epoch:1,flags:4};
 return {root:async()=>root(),copyrights:async()=>new Map(),loadNode:load,children:async node=>{if(fail)throw Error('Metadata unavailable');if(node.root)return depth?[{...leaf,leaf:false,path:'1',key:'branch'}]:[leaf];return node.path.length===depth?[leaf]:[{...node,path:node.path+'1'}];},clear(){},leaf};
}
test('real metadata root and bulk parse at the producing boundary',async()=>{
 assert.equal(root().epoch,1016);assert.equal(root().radius,6371010);
 const source=new RocktreeSource({transport:{get:async()=>fixture('bulk.pb').buffer}}),prefix='30427242735060526245';
 const bulk=await source.loadBulk(prefix,1016);let terminals=0;
 async function walk(n){if(n.leaf){if(n.hasData)terminals++;return;}for(const child of await source.children(n))await walk(child);}
 await walk({path:prefix,index:-1,bulk,leaf:false});assert.ok(terminals>0);
 assert.throws(()=>planetMetadata(new Uint8Array([10,255])),/Truncated|Invalid/);
});
test('memory LRU and HTTP freshness do not imply indefinite cache validity',async()=>{
 const c=new MemoryByteCache({maxBytes:4});const r=n=>({bytes:new Uint8Array(n).buffer,expiresAt:Date.now()+10000});
 await c.put('a',r(2));await c.put('b',r(2));await c.get('a');await c.put('c',r(2));assert.equal(await c.get('b'),null);assert.equal(c.bytes,4);
 assert.equal(cacheLifetime('no-cache, max-age=99',10),10);assert.equal(cacheLifetime('no-store',10),10);assert.equal(cacheLifetime('public, max-age=14400',0),14400000);
 await c.close();assert.equal(c.bytes,0);
});
test('one request per URL, bounded concurrency, and disposal settles queued fetches',async()=>{
 let calls=0;const cache=new MemoryByteCache(),loader=new ByteTransport({cache,concurrency:2,fetch:async()=>{calls++;return new Response(new Uint8Array([1,2]),{headers:{'cache-control':'max-age=99'}});}});
 await Promise.all([loader.get('https://tiles.test/a'),loader.get('https://tiles.test/a')]);assert.equal(calls,1);await loader.get('https://tiles.test/a');assert.equal(calls,1);
 await loader.dispose();assert.ok((await cache.get('https://tiles.test/a'))!==null);await cache.close();
 let active=0,peak=0;const blocked=new ByteTransport({cache:new MemoryByteCache(),concurrency:2,fetch:async(u,{signal})=>new Promise((resolve,reject)=>{active++;peak=Math.max(peak,active);signal.addEventListener('abort',()=>{active--;reject(new DOMException('Stopped','AbortError'));});})});
 const pending=Array.from({length:8},(_,i)=>blocked.get('https://tiles.test/'+i));const result=Promise.allSettled(pending);await tick();await blocked.dispose();assert.equal(peak,2);assert.equal(active,0);assert.ok((await result).every(r=>r.status==='rejected'));
});
test('all selected branches reach actual terminals beyond any previous level cap',async()=>{
 const s=new EarthHQStreaming({source:fakeSource({depth:25})});const coverage=await s.requestRegion({latitude:0,longitude:0,radiusMeters:50});
 assert.equal(coverage.complete,true);assert.equal(coverage.requiredLeaves,1);assert.equal([...s.assets.values()][0].descriptor.path.length,26);await s.dispose();assert.equal(s.group.children.length,0);
 assert.equal(intersectsColumn({center:new Vector3(6372010,0,0),radius:1},new Vector3(1,0,0),10),true);
});

test('long-range view keeps near ground in every direction and conservative edge tiles',()=>{
 const spec={focus:new Vector3(6371010,0,0),normal:new Vector3(1,0,0),radius:1000,viewDirection:new Vector3(0,1,0),viewHalfAngle:Math.PI/4,nearRadius:60};
 const node=(y,z,radius=1)=>({center:new Vector3(6371010,y,z),radius});
 assert.equal(intersectsRegion(node(-40,0),spec),true);
 assert.equal(intersectsRegion(node(950,0),spec),true);
 assert.equal(intersectsRegion(node(700,710,15),spec),true);
 assert.equal(intersectsRegion(node(-200,0),spec),false);
 assert.equal(intersectsRegion(node(1100,0),spec),false);
 assert.equal(intersectsRegion(node(1200,0,250),spec),true);
});

test('automatic camera turns replace the view demand without requiring a position change',async()=>{
 const source=fakeSource(),s=new EarthHQStreaming({source});
 await s.requestRegion({latitude:0,longitude:0,radiusMeters:1000,viewDirectionECEF:new Vector3(0,1,0),viewHalfAngle:Math.PI/4});
 const generation=s.generation;
 const camera=new PerspectiveCamera();camera.position.set(6371110,0,0);
 s.update(camera,{focusECEF:new Vector3(6371010,0,0),radiusMeters:1000,viewDirectionECEF:new Vector3(0,-1,0),viewHalfAngle:Math.PI/4});
 await tick();await s.waitForIdle();assert.ok(s.generation>generation);assert.equal(s.committedSpec.viewDirection.y,-1);assert.equal(s.getCoverage().complete,true);await s.dispose();
});

test('camera altitude automatically starts, pauses and resumes HQ without a region request',async()=>{
 let loads=0;const s=new EarthHQStreaming({source:fakeSource({load:async()=>{loads++;return decoded();}})}),camera=new PerspectiveCamera();
 try{
  await s.start();camera.position.set(6371010+10000,0,0);s.update(camera);await tick();
  assert.equal(s.getCoverage().status,'waiting-altitude');assert.equal(s.queryCount,0);assert.equal(loads,0);
  camera.position.x=6371010+2400;s.update(camera);await tick();await s.waitForIdle();
  assert.equal(s.getCoverage().complete,true);assert.equal(loads,1);const generation=s.generation;
  camera.position.x=6371010+2700;s.update(camera);await tick();assert.equal(s.generation,generation);
  camera.position.x=6371010+3100;s.update(camera);await s.waitForIdle();assert.equal(s.getCoverage().status,'waiting-altitude');assert.equal(s.getCoverage().complete,false);
  camera.position.x=6371010+2700;s.update(camera);await tick();assert.equal(s.getCoverage().status,'waiting-altitude');
  camera.position.x=6371010+2400;s.update(camera);await tick();await s.waitForIdle();
  assert.equal(s.getCoverage().complete,true);assert.equal(loads,1);assert.ok(s.generation>generation);
 }finally{await s.dispose();}
});

test('altitude uses the transformed camera even when the caller provides a surface focus',async()=>{
 const s=new EarthHQStreaming({source:fakeSource()}),parent=new Group(),camera=new PerspectiveCamera(),focus=new Vector3(6371010,0,0);
 parent.position.set(30,-40,80);parent.scale.setScalar(.001);parent.rotation.y=.3;parent.add(s.group);parent.add(camera);
 try{
  await s.start();camera.position.set(6371010+10000,0,0);s.update(camera,{focusECEF:focus});await tick();assert.equal(s.queryCount,0);
  camera.position.set(6371010+100,0,0);s.update(camera,{focusECEF:focus});await tick();await s.waitForIdle();assert.equal(s.getCoverage().complete,true);assert.ok(Math.abs(s.getCoverage().cameraAltitudeMeters-100)<.001);
 }finally{await s.dispose();}
});

test('vertical and zero headings are normalized once and do not restart discovery every frame',async()=>{
 const s=new EarthHQStreaming({source:fakeSource()}),camera=new PerspectiveCamera();camera.position.set(6371110,0,0);
 try{
  await s.start();s.update(camera,{viewDirectionECEF:new Vector3(-1,0,0)});await tick();await s.waitForIdle();const generation=s.generation;
  for(let i=0;i<4;i++){s.update(camera,{viewDirectionECEF:new Vector3(i%2?-1:0,0,0)});await tick();}
  assert.equal(s.generation,generation);assert.equal(s.committedSpec.viewDirection,null);assert.equal(s.getCoverage().complete,true);
  s.update(camera,{nearRadiusMeters:100});await tick();await s.waitForIdle();assert.equal(s.committedSpec.nearRadius,100);
 }finally{await s.dispose();}
});

test('ascending during discovery or a late tile does not attach meshes or restart work',async()=>{
 let deliver;const s=new EarthHQStreaming({source:fakeSource({load:()=>new Promise(resolve=>{deliver=resolve;})})}),camera=new PerspectiveCamera();
 try{
  await s.start();camera.position.set(6371110,0,0);s.update(camera);while(!deliver)await tick();
  camera.position.x=6371010+4000;s.update(camera);deliver(await decoded());await s.waitForIdle();
  assert.equal(s.assets.size,0);assert.equal(s.getCoverage().status,'waiting-altitude');
  camera.position.x=6371110;s.update(camera);camera.position.x=6375010;s.update(camera);await tick();await s.waitForIdle();
  assert.equal(s.assets.size,0);assert.equal(s.getCoverage().status,'waiting-altitude');
  s.setEnabled(false);s.setEnabled(true);await tick();assert.equal(s.getCoverage().status,'waiting-altitude');
 }finally{await s.dispose();}
});

test('altitude options reject invalid values',()=>{
 for(const options of [{activationAltitudeMeters:NaN},{activationAltitudeMeters:0},{altitudeHysteresisMeters:-1}])assert.throws(()=>new EarthHQStreaming(options),{code:'invalid_options'});
});
test('unknown metadata fails closed rather than becoming absent tiles',async()=>{
 const s=new EarthHQStreaming({source:fakeSource({fail:true})});const result=await s.requestRegion({latitude:0,longitude:0});assert.equal(result.complete,false);assert.equal(result.unknownBranches,1);await s.dispose();
});
test('GPU capacity is visible as incomplete coverage and can be repaired without dropping leaves',async()=>{
 const s=new EarthHQStreaming({source:fakeSource(),maxGpuBytes:1});let c=await s.requestRegion({latitude:0,longitude:0});assert.equal(c.requiredLeaves,1);assert.equal(c.readyLeaves,0);assert.equal(c.complete,false);assert.equal(c.errors[0].code,'gpu_budget');
 s.setGpuBudget(100*1024*1024);c=await s.waitForIdle();assert.equal(c.complete,true);await s.dispose();
});
test('late tile delivery is owned through disposal and cannot attach after it',async()=>{
 let deliver;const source=fakeSource({load:()=>new Promise(r=>{deliver=r;})}),s=new EarthHQStreaming({source});
 const requested=s.requestRegion({latitude:0,longitude:0}).catch(e=>e);while(!deliver)await tick();let settled=false;const disposed=s.dispose().then(()=>{settled=true;});await tick();assert.equal(settled,false);deliver(await decoded());await disposed;assert.equal(s.group.children.length,0);assert.equal(s.assets.size,0);assert.equal((await requested).name,'AbortError');
});

test('tile staging settles even when browser animation frames are suspended',async()=>{
 const previous=globalThis.requestAnimationFrame;let calls=0;
 globalThis.requestAnimationFrame=()=>{calls++;throw Error('Hidden tab cannot deliver an animation frame');};
 const s=new EarthHQStreaming({source:fakeSource()});
 try{const result=await s.requestRegion({latitude:0,longitude:0});assert.equal(result.complete,true);assert.equal(calls,0);}
 finally{await s.dispose();if(previous===undefined)delete globalThis.requestAnimationFrame;else globalThis.requestAnimationFrame=previous;}
});
test('a failed metadata child still waits for mixed late child outcomes on cleanup',async()=>{
 let deliver;const source=fakeSource();source.children=async n=>{if(n.root)return [{...source.leaf,path:'a',leaf:false},{...source.leaf,path:'b',leaf:false}];if(n.path==='a')throw Error('Failed branch');return new Promise(r=>{deliver=r;});};
 const s=new EarthHQStreaming({source});const requested=s.requestRegion({latitude:0,longitude:0}).catch(e=>e);while(!deliver)await tick();let done=false;const disposing=s.dispose().then(()=>{done=true;});await tick();assert.equal(done,false);deliver([]);await disposing;assert.equal((await requested).name,'AbortError');
});
test('decoded assets dispose exactly once without disposing the host scene',async()=>{
 const asset=await buildAsset(await decoded(),{key:'fixture',path:'fixture'}),scene=new Scene();scene.add(asset.group);let disposed=0;asset.group.traverse(m=>m.isMesh&&m.geometry.addEventListener('dispose',()=>disposed++));
 const count=asset.group.children.length;assert.ok(count>0);disposeAsset(asset);disposeAsset(asset);assert.equal(disposed,count);assert.equal(scene.children.length,0);
});
test('double W requires release and a held second press; repeat and blur cannot latch sprint',()=>{
 const input=new SprintInput();input.down('KeyW',0);input.down('KeyW',100,true);assert.equal(input.keys.sprint,false);input.up('KeyW');input.down('KeyW',200);assert.equal(input.keys.sprint,true);input.down('KeyW',600,true);assert.equal(input.keys.sprint,true);input.up('KeyW');assert.equal(input.keys.sprint,false);input.reset();input.down('KeyW',700);assert.equal(input.keys.sprint,false);
});
