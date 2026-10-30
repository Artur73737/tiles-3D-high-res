import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3,Group,PerspectiveCamera} from 'three';
import decode from '../src/vendor/rocktree-decoder.cjs';
import {EarthHQStreaming} from '../src/streamer.js';
import {PlayerWorld} from '../src/demo/PlayerWorld.js';
import {localFrame,geoToECEF} from '../src/geo.js';
import {ByteTransport} from '../src/transport.js';
import {MemoryByteCache} from '../src/cache.js';
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
  assert.equal(coverage.complete,true);assert.equal(s.visiblePreviewCount,0);assert.equal(coverage.readyLeaves,2);assert.equal(s.previews.get('parent').group.visible,false);
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
  assert.equal(s.assets.size,2);assert.equal(s.committedSpec.radius,60);assert.equal(s.getCoverage().status,'discovering');assert.equal(s.getCoverage().complete,false);
  releaseFar();const result=await requested;assert.equal(result.complete,true);assert.equal(result.requiredLeaves,3);assert.equal(s.visiblePreviewCount,0);assert.equal(s.committedSpec.radius,1000);
 }finally{await s.dispose();}
});

test('near HQ removes its coarse parent while distant discovery is pending, including view-sector edges',async()=>{
 const data=source(),farParent={...data.parent,path:'2',key:'far-parent',center:new Vector3(6371010,500,0)},farLeaf={...farParent,path:'20',key:'far-leaf',leaf:true,radius:10};
 let releaseFar;data.children=async n=>n.root?[data.parent,farParent]:n.path==='1'?data.leaves:new Promise(resolve=>{releaseFar=()=>resolve([farLeaf]);});
 const s=new EarthHQStreaming({source:data,previewRadiusMeters:120,radiusMeters:1000,retainRadiusMeters:1100});
 const pending=s.requestRegion({latitude:0,longitude:0,viewDirectionECEF:new Vector3(0,1,0),viewHalfAngle:Math.PI/4,nearRadiusMeters:60}).catch(error=>error);
 try{
  for(let i=0;i<1000&&(!releaseFar||s.assets.size<2);i++)await tick();
  assert.equal(s.assets.size,2);assert.equal(s.getCoverage().complete,false);
  assert.equal(s.previews.get('parent')?.group.visible,false,'Completed near HQ must not remain covered by its coarse parent');
  const camera=new PerspectiveCamera();camera.position.set(6371110,0,0);s.lastSpec.at=Date.now()-61000;
  const generation=s.generation;s.update(camera,{focusECEF:new Vector3(6371010,0,0),radiusMeters:1000,viewDirectionECEF:new Vector3(0,1,0),viewHalfAngle:Math.PI/4,nearRadiusMeters:60});
  await tick();assert.equal(s.generation,generation,'Periodic freshness check must not cancel unfinished discovery');
  releaseFar();const coverage=await pending;assert.equal(coverage.complete,true);assert.equal(s.previews.get('parent').group.visible,false,'Final directional inventory must preserve proven near coverage');
 }finally{releaseFar?.();await s.dispose();}
});

test('late preview response remains owned through disposal without attaching to the scene',async()=>{
 const data=source();let release;data.loadNode=n=>n.key==='parent'?new Promise(r=>{release=r;}):payload();
 const s=new EarthHQStreaming({source:data,previewRadiusMeters:120,radiusMeters:200,retainRadiusMeters:220});
 const pending=s.requestRegion({latitude:0,longitude:0}).catch(e=>e);
 while(!release)await tick();let done=false;const disposed=s.dispose().then(()=>{done=true;});await tick();assert.equal(done,false);
 release(await payload());await disposed;assert.equal((await pending).name,'AbortError');assert.equal(s.previews.size,0);assert.equal(s.group.children.length,0);
});

test('final sector keeps pending near descendants outside the heading and late previews stay hidden',async()=>{
 const data=source();data.parent.center=new Vector3(6371010,-80,0);data.leaves=data.leaves.map(n=>({...n,center:data.parent.center.clone()}));
 let releaseLeaf,releasePreview;data.loadNode=n=>n.key==='parent'?new Promise(resolve=>{releasePreview=resolve;}):n.key==='b'?new Promise(resolve=>{releaseLeaf=resolve;}):payload();
 const s=new EarthHQStreaming({source:data,previewRadiusMeters:120,radiusMeters:1000,retainRadiusMeters:1100});
 const pending=s.requestRegion({latitude:0,longitude:0,viewDirectionECEF:new Vector3(0,1,0),viewHalfAngle:Math.PI/4,nearRadiusMeters:60}).catch(error=>error);
 try{
  for(let i=0;i<1000&&(!releaseLeaf||!releasePreview||s.discovering);i++)await tick();
  assert.equal(s.wanted.has('b'),true,'The distant sector must not cancel near footprint refinement behind the camera');
  assert.equal(s.getCoverage().complete,false);releaseLeaf(await payload());
  for(let i=0;i<1000&&!s.assets.has('b');i++)await tick();
  releasePreview(await payload());const result=await pending;
  assert.equal(result.complete,true);assert.equal(s.previews.get('parent').group.visible,false);
  assert.equal(s.visiblePreviewCount,0);s.unload('b');assert.equal(s.previews.get('parent').group.visible,true);
 }finally{releaseLeaf?.(await payload());releasePreview?.(await payload());await s.dispose();}
});

test('local collision inventory ignores far arrivals but refreshes after movement and demand replacement',()=>{
 const s=new EarthHQStreaming({source:source()}),world=new PlayerWorld(s),frame=localFrame(0,0);
 const node=(key,east)=>({key,center:geoToECEF(0,0).add(new Vector3(0,east,0)),radius:1});
 const near=node('near',0),far=node('far',100),asset=n=>({descriptor:n,group:new Group()});
 s.wanted=new Map([['near',near],['far',far]]);s.assets.set('near',asset(near));s.committedSpec={focus:geoToECEF(0,0),radius:200};
 world.setFrame(frame);world.refresh(new Vector3(),{all:true});assert.equal(world.readyAt(new Vector3()),true);assert.equal(world.nearRequired.size,1);
 s.assets.set('far',asset(far));s.dispatchEvent({type:'tile-load',asset:s.assets.get('far')});assert.equal(world.dirty,false);
 s.wanted=new Map([['missing',node('missing',0)]]);assert.equal(world.readyAt(new Vector3()),false);
 s.wanted=new Map([['far',far]]);world.refresh(new Vector3(100,0,0),{all:true});assert.equal(world.nearRequired.has('far'),true);assert.equal(world.readyAt(new Vector3(100,0,0)),true);
 world.dispose();
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

test('a sustained payload queue cannot starve metadata needed to finish refinement',async()=>{
 const order=[];let release;const cache=new MemoryByteCache(),transport=new ByteTransport({cache,concurrency:1,fetch:async url=>{order.push(url);if(order.length===1)await new Promise(resolve=>{release=resolve;});return new Response('ok');}});
 try{
  const first=transport.get('first');while(!release)await tick();
  const metadata=transport.get('metadata'),payloads=Array.from({length:16},(_,i)=>transport.get('tile-'+i,{priority:1}));
  await tick();release();await Promise.all([first,metadata,...payloads]);
  assert.equal(order[1],'tile-0');assert.ok(order.indexOf('metadata')<order.indexOf('tile-15'));
 }finally{await transport.dispose();await cache.close();}
});

test('canceling discovery waits for bounded active branches without requesting the obsolete frontier',async()=>{
 const data=source(),releases=[];
 data.children=async node=>node.root?Array.from({length:8},(_,i)=>({...data.parent,path:String(i),key:'branch-'+i})):new Promise(resolve=>{releases.push(()=>resolve(data.leaves));});
 const s=new EarthHQStreaming({source:data,concurrency:6});const pending=s.requestRegion({latitude:0,longitude:0}).catch(error=>error);
 try{
  for(let i=0;i<1000&&releases.length<6;i++)await tick();
  assert.equal(releases.length,6);s.setEnabled(false);for(const release of releases)release();
  await pending;assert.equal(releases.length,6);assert.equal(s.assets.size,0);assert.equal(s.getCoverage().status,'paused');
 }finally{for(const release of releases)release();await s.dispose();}
});

test('turning through 360 degrees preserves resident HQ and full-surround previews',async()=>{
 const data=source(),parents=[{...data.parent,path:'1',key:'east-parent',radius:30,center:new Vector3(6371010,400,0)},{...data.parent,path:'2',key:'west-parent',radius:30,center:new Vector3(6371010,-400,0)}];
 const leaves=parents.map(p=>({...p,path:p.path+'0',key:p.key+'-leaf',radius:10,leaf:true}));
 data.children=async n=>n.root?parents:[leaves.find(leaf=>leaf.path.startsWith(n.path))];
 const s=new EarthHQStreaming({source:data,previewRadiusMeters:120,radiusMeters:500,retainRadiusMeters:550}),options={latitude:0,longitude:0,viewHalfAngle:Math.PI/4};
 try{
  await s.requestRegion({...options,viewDirectionECEF:new Vector3(0,1,0)});
  const east=s.assets.get('east-parent-leaf');assert.ok(east);assert.equal(s.previews.get('west-parent').group.visible,true);assert.equal(s.previews.get('east-parent').group.visible,false);
  await s.requestRegion({...options,viewDirectionECEF:new Vector3(0,-1,0)});
  const west=s.assets.get('west-parent-leaf');assert.ok(west);assert.equal(s.assets.get('east-parent-leaf'),east);assert.equal(east.disposed,false);assert.equal(s.previews.get('east-parent').group.visible,false);
  await s.requestRegion({...options,viewDirectionECEF:new Vector3(0,1,0)});assert.equal(s.assets.get('east-parent-leaf'),east);assert.equal(s.assets.get('west-parent-leaf'),west);
  s.unload('east-parent-leaf');assert.equal(s.previews.get('east-parent').group.visible,true);
 }finally{await s.dispose();assert.equal(s.gpuBytes,0);assert.equal(s.visiblePreviewCount,0);assert.equal(s.previewPaths.size,0);}
});
