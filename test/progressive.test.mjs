import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3,Group} from 'three';
import decode from '../src/core/rocktree/vendor/rocktree-decoder.cjs';
import {EarthHQStreaming} from '../src/engine/streamer.js';
import {localFrame,geoToECEF} from '../src/core/geo.js';
import {ByteTransport} from '../src/core/net/transport.js';
import {MemoryByteCache} from '../src/core/net/cache.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
const payload=async()=>(await decode(1,new Uint8Array(readFileSync(new URL('./fixtures/node.pb',import.meta.url))))).payload;
function source(){
 const parent={path:'1',key:'parent',leaf:false,hasData:true,center:new Vector3(6371010,0,0),radius:100,epoch:1};
 const leaves=[{...parent,path:'10',key:'a',radius:10,leaf:true},{...parent,path:'11',key:'b',radius:10,leaf:true}];
 return {parent,leaves,root:async()=>({radius:6371010,epoch:1}),copyrights:async()=>new Map(),children:async n=>n.root?[parent]:leaves,loadNode:payload,clear(){}};
}

test('real parent preview appears during terminal discovery and retires only when all terminal data is ready',async()=>{
 const data=source();let releaseMetadata;const normalChildren=data.children;
 data.children=n=>n.root?normalChildren(n):new Promise(r=>{releaseMetadata=()=>{data.children=normalChildren;r(data.leaves);};});
 const s=new EarthHQStreaming({source:data,previewRadiusMeters:120,radiusMeters:200,retainRadiusMeters:220});
 const pending=s.requestRegion({latitude:0,longitude:0});
 try{
  for(let i=0;i<1000&&!s.previews.size;i++)await tick();
  assert.equal(s.previews.size,1);assert.equal(s.assets.size,0);assert.equal(s.getCoverage().complete,false);assert.equal(s.getCoverage().status,'discovering');
  let releaseLeaf;data.loadNode=n=>n.key==='b'?new Promise(r=>{releaseLeaf=r;}):payload();releaseMetadata();
  for(let i=0;i<1000&&(!releaseLeaf||!s.assets.size);i++)await tick();
  assert.equal(s.assets.size,1);assert.equal(s.previews.size,1);assert.equal(s.getCoverage().readyLeaves,1);assert.equal(s.getCoverage().requiredLeaves,2);
  releaseLeaf(await payload());const coverage=await pending;
  assert.equal(coverage.complete,true);assert.equal(s.previews.size,0);assert.equal(coverage.readyLeaves,2);assert.equal(s.group.children.length,2);
 }finally{await s.dispose();}
});

test('preview failures do not count as missing terminal leaves and all preview resources are released',async()=>{
 const data=source();data.loadNode=n=>{if(n.key==='parent')throw Error('Preview unavailable');return payload();};
 const s=new EarthHQStreaming({source:data,previewRadiusMeters:120,radiusMeters:200,retainRadiusMeters:220});
 let warnings=0;s.addEventListener('warning',()=>warnings++);
 const coverage=await s.requestRegion({latitude:0,longitude:0});
 assert.equal(coverage.complete,true);assert.equal(coverage.requiredLeaves,2);assert.equal(coverage.failedLeaves,0);assert.equal(warnings,1);
 await s.dispose();assert.equal(s.group.children.length,0);assert.equal(s.gpuBytes,0);
});

test('near terminal meshes load before distant discovery settles without claiming full coverage',async()=>{
 const data=source(),farParent={...data.parent,path:'2',key:'far-parent',center:new Vector3(6371010,0,500)},farLeaf={...farParent,path:'20',key:'far-leaf',leaf:true,radius:10};let releaseFar;
 data.children=async n=>{if(n.root)return [data.parent,farParent];if(n.path==='1')return data.leaves;return new Promise(r=>{releaseFar=()=>r([farLeaf]);});};
 const s=new EarthHQStreaming({source:data,previewRadiusMeters:120,radiusMeters:1000,retainRadiusMeters:1100});const requested=s.requestRegion({latitude:0,longitude:0});
 try{
  for(let i=0;i<1000&&(!releaseFar||s.assets.size<2);i++)await tick();
  assert.equal(s.assets.size,2);assert.equal(s.committedSpec.radius,120);assert.equal(s.getCoverage().status,'discovering');assert.equal(s.getCoverage().complete,false);
  releaseFar();const result=await requested;assert.equal(result.complete,true);assert.equal(result.requiredLeaves,3);assert.equal(s.previews.size,0);assert.equal(s.committedSpec.radius,1000);
 }finally{await s.dispose();}
});

test('late preview response remains owned through disposal without attaching to the scene',async()=>{
 const data=source();let release;data.loadNode=n=>n.key==='parent'?new Promise(r=>{release=r;}):payload();
 const s=new EarthHQStreaming({source:data,previewRadiusMeters:120,radiusMeters:200,retainRadiusMeters:220});
 const pending=s.requestRegion({latitude:0,longitude:0}).catch(e=>e);
 while(!release)await tick();let done=false;const disposed=s.dispose().then(()=>{done=true;});await tick();assert.equal(done,false);
 release(await payload());await disposed;assert.equal((await pending).name,'AbortError');assert.equal(s.previews.size,0);assert.equal(s.group.children.length,0);
});


test('GPU capacity exhaustion stops scheduling distant downloads and can resume after a budget increase',async()=>{
 const data=source();data.leaves=Array.from({length:40},(_,i)=>({...data.leaves[0],path:'1'+i,key:'leaf-'+i}));data.children=async n=>n.root?[data.parent]:data.leaves;
 let loads=0;data.loadNode=async()=>{loads++;return payload();};
 const s=new EarthHQStreaming({source:data,concurrency:2,maxGpuBytes:1});
 try{const result=await s.requestRegion({latitude:0,longitude:0});assert.equal(result.complete,false);assert.equal(result.requiredLeaves,40);assert.ok(loads<=2);s.setGpuBudget(128*1024**2);const retried=await s.waitForIdle();assert.equal(retried.complete,true);assert.equal(retried.readyLeaves,40);}finally{await s.dispose();}
});

test('visible payload requests bypass queued metadata while concurrency and deduplication remain bounded',async()=>{
 const order=[];let release;const cache=new MemoryByteCache(),transport=new ByteTransport({cache,concurrency:1,fetch:async url=>{order.push(url);if(order.length===1)await new Promise(r=>{release=r;});return new Response(new Uint8Array([1]));}});
 try{const first=transport.get('first');while(!release)await tick();const metadata=transport.get('metadata'),visible=transport.get('visible',{priority:1}),duplicate=transport.get('visible',{priority:1});await tick();release();await Promise.all([first,metadata,visible,duplicate]);assert.deepEqual(order,['first','visible','metadata']);}finally{await transport.dispose();await cache.close();}
});
