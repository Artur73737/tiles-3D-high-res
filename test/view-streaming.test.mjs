import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3,PerspectiveCamera,Matrix4,Frustum} from 'three';
import {EarthHQStreaming} from '../src/streamer.js';
import {RocktreeSource} from '../src/source.js';
import {buildAsset,disposeAsset} from '../src/geometry.js';
import {nodeDistance,nodeInFrustum} from '../src/geo.js';
import decode from '../src/vendor/rocktree-decoder.cjs';
const payload=async()=>(await decode(1,new Uint8Array(readFileSync(new URL('./fixtures/node.pb',import.meta.url))))).payload;
const focus=new Vector3(6371010,0,0),node=(path,options={})=>({path,key:path,leaf:false,hasData:true,center:focus.clone().add(new Vector3(0,500,0)),radius:10,metersPerTexel:10,epoch:1,...options});
function cameraView(){const camera=new PerspectiveCamera(52,1,.1,10000);camera.position.copy(focus).add(new Vector3(100,0,0));camera.up.set(1,0,0);camera.lookAt(focus.clone().add(new Vector3(0,500,0)));camera.updateMatrixWorld();return {position:camera.position.clone(),direction:camera.getWorldDirection(new Vector3()),pixelScale:1000,frustum:new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse))};}
function source(children,load=payload){return {root:async()=>({radius:6371010,epoch:1}),copyrights:async()=>new Map(),children,loadNode:load,clear(){}};}

test('view traversal fetches ancestors before children and selects mixed depth without exploring subpixel branches',async()=>{
 const parent=node('100'),child=node('1000',{metersPerTexel:.01}),behind=node('200',{center:focus.clone().add(new Vector3(0,-500,0))});let descended=false;const loads=[];
 const s=new EarthHQStreaming({source:source(async n=>n.root?[parent,behind]:n.path==='100'?[child]:(descended=true,[]),async n=>{loads.push(n.key);return payload();}),radiusMeters:1000,retainRadiusMeters:1100,screenSpaceError:1});
 try{const c=await s.requestRegion({focusECEF:focus,radiusMeters:1000,cameraView:cameraView()});assert.equal(c.complete,true);assert.equal(c.detailMode,'screen-space');assert.equal(c.requiredLeaves,1);assert.deepEqual([...s.viewCut.keys()],['1000']);assert.equal(descended,false);assert.equal(loads.includes('200'),false);assert.ok(loads.indexOf('100')<loads.indexOf('1000'));s.updateViewMasks();assert.equal(s.assets.get('100').mask,254);}finally{await s.dispose();}
});

test('visible view selection can reach actual terminals beyond depth 25 without a hard ceiling',async()=>{
 const s=new EarthHQStreaming({source:source(async n=>n.root?[node('1')]:[node(n.path+'0',{leaf:n.path.length>=29})]),screenSpaceError:1,radiusMeters:1000,retainRadiusMeters:1100});
 try{const c=await s.requestRegion({focusECEF:focus,radiusMeters:1000,cameraView:cameraView()});assert.equal(c.complete,true);assert.equal([...s.viewCut.values()][0].path.length,30);assert.equal([...s.viewCut.values()][0].leaf,true);}finally{await s.dispose();}
});

test('partial parent masks preserve unknown areas and restore a parent after child eviction',async()=>{
 const s=new EarthHQStreaming({source:source(async()=>[])}),masks=new Map();s.viewCut=new Map();
 const asset=path=>({descriptor:{path},setMask:mask=>masks.set(path,mask)});
 s.assets.set('1',asset('1'));s.assets.set('10',asset('10'));s.updateViewMasks();assert.equal(masks.get('1'),254);
 s.assets.delete('10');s.viewTree.set('10',node('10',{hasData:false}));s.viewTree.set('100',node('100',{empty:true}));s.updateViewMasks();assert.equal(masks.get('1'),255,'A single parsed child does not prove the parent subtree is covered');
 s.viewChildren.set('10',['100']);s.updateViewMasks();assert.equal(masks.get('1'),254);s.assets.clear();await s.dispose();
});

test('octant replacement changes rendered indices per child and can restore the complete mesh',async()=>{
 const vertices=new Uint8Array(48);for(let i=0;i<6;i++){vertices[i*8]=i;vertices[i*8+1]=i%2;vertices[i*8+3]=i<3?0:7;}
 const asset=await buildAsset({matrixGlobeFromMesh:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],meshes:[{vertices,indices:new Uint16Array([0,1,2,2,3,3,4,5])}],overlaySurfaceMeshes:[]},node('1'));
 try{const g=asset.group.children[0].geometry;assert.equal(g.drawRange.count,6);asset.setMask(254);assert.equal(g.drawRange.count,3);assert.ok([...g.index.array.slice(0,3)].every(i=>i>=3));asset.setMask(0);assert.equal(asset.group.visible,false);asset.setMask(255);assert.equal(g.drawRange.count,6);assert.equal(asset.group.visible,true);}finally{disposeAsset(asset);}
});

test('provider URL formats match observed imagery and photogrammetry request families',()=>{
 const source=new RocktreeSource();assert.match(source.nodeUrl({path:'03',epoch:1016,flags:16,imageryEpoch:1040}),/!2e1!3u1040!4b0$/);assert.match(source.nodeUrl({path:'304272',epoch:1000,flags:0}),/!2e6!4b0$/);source.clear();
});

test('OBB distance and clipping use oriented axes instead of a bounding sphere approximation',()=>{
 const n=node('1',{center:new Vector3(),obb:{rotation:[0,-1,0,1,0,0,0,0,1],extents:[1,2,3]}});
 assert.equal(nodeDistance(n,new Vector3(5,0,0)),3);assert.equal(nodeDistance(n,new Vector3(0,0,2)),0);
 const v=cameraView();assert.equal(nodeInFrustum(node('1'),v.frustum),true);assert.equal(nodeInFrustum(node('2',{center:focus.clone().add(new Vector3(0,-500,0))}),v.frustum),false);
});

test('descending with unchanged surface focus refreshes the view demand and chooses deeper detail',async()=>{
 const parent=node('100',{metersPerTexel:.5}),child=node('1000',{leaf:true,metersPerTexel:.01});
 const s=new EarthHQStreaming({source:source(async n=>n.root?[parent]:[child]),screenSpaceError:1,radiusMeters:1000,retainRadiusMeters:1100});
 const camera=new PerspectiveCamera(52,1,.1,10000);camera.up.set(1,0,0);camera.position.copy(focus).add(new Vector3(2000,0,0));camera.lookAt(parent.center);camera.updateMatrixWorld();
 try{
  await s.start();s.update(camera,{focusECEF:focus,radiusMeters:1000});await new Promise(r=>setTimeout(r,0));await s.waitForIdle();assert.ok(s.viewCut.has('100'));
  const before=s.generation;camera.position.copy(focus).add(new Vector3(50,450,0));camera.lookAt(parent.center);camera.updateMatrixWorld();s.update(camera,{focusECEF:focus,radiusMeters:1000});await new Promise(r=>setTimeout(r,0));await s.waitForIdle();assert.ok(s.generation>before);assert.ok(s.viewCut.has('1000'));
 }finally{await s.dispose();}
});

test('an expired demanded view node is admitted again and a failed fallback does not poison ready descendants',async()=>{
 const parent=node('1'),child=node('10',{leaf:true,metersPerTexel:.01});let fail=false,loads=0;
 const data=source(async n=>n.root?[parent]:[child],async n=>{loads++;if(n.path==='1'&&fail)throw Error('Fallback unavailable');return payload();});
 const s=new EarthHQStreaming({source:data,screenSpaceError:1,radiusMeters:1000,retainRadiusMeters:1100});
 try{
  await s.requestRegion({focusECEF:focus,radiusMeters:1000,cameraView:cameraView()});s.assets.get('10').expiresAt=0;
  const c=await s.requestRegion({focusECEF:focus,radiusMeters:1000,cameraView:cameraView()});assert.equal(c.complete,true);assert.ok(s.assets.has('10'));assert.ok(loads>=3);
  s.unload('1');fail=true;const ready=await s.requestRegion({focusECEF:focus,radiusMeters:1000,cameraView:cameraView()});assert.equal(ready.complete,true);assert.equal(ready.failedLeaves,0);assert.equal(ready.fallbackFailures,1);
 }finally{await s.dispose();}
});

test('sustained camera movement coalesces a pending view instead of repeatedly cancelling its metadata',async()=>{
 let release,rootCalls=0;const parent=node('1'),child=node('10',{leaf:true,metersPerTexel:.01}),data=source(async n=>n.root?[parent]:new Promise(r=>{release=()=>r([child]);}));data.root=async()=>{rootCalls++;return {radius:6371010,epoch:1};};
 const s=new EarthHQStreaming({source:data,screenSpaceError:1,radiusMeters:1000,retainRadiusMeters:1100}),camera=new PerspectiveCamera(52,1,.1,10000);
 camera.position.copy(focus).add(new Vector3(100,0,0));camera.up.set(1,0,0);camera.lookAt(parent.center);camera.updateMatrixWorld();
 try{
  await s.start();s.update(camera,{focusECEF:focus,radiusMeters:1000});while(!release)await new Promise(r=>setTimeout(r,0));const generation=s.generation;
  for(let i=0;i<20;i++){camera.position.y+=10;camera.lookAt(parent.center);camera.updateMatrixWorld();s.update(camera,{focusECEF:focus,radiusMeters:1000});}
  assert.equal(s.generation,generation);assert.equal(rootCalls,1);release();assert.equal((await s.waitForIdle()).complete,true);
 }finally{release?.();await s.dispose();}
});

test('collision readiness rejects unexamined off-screen space outside the near disk',async()=>{
 const {PlayerWorld}=await import('../src/demo/PlayerWorld.js'),{localFrame}=await import('../src/geo.js');
 const s=new EarthHQStreaming({source:source(async()=>[])}),world=new PlayerWorld(s);s.committedSpec={focus,normal:focus.clone().normalize(),radius:2000,cameraView:cameraView()};s.collisionInventory=new Map();
 world.setFrame(localFrame(0,0));assert.equal(world.readyAt(new Vector3(-20,100,0)),false);assert.equal(world.readyAt(new Vector3(20,100,0)),true);world.dispose();await s.dispose();
});

test('view score uses forward depth and mesh angular correction with the observed thresholds',async()=>{
 const {viewDetailScore}=await import('../src/streamer.js'),{meshAngularWeight}=await import('../src/geometry.js');
 const n=node('100',{center:new Vector3(100,100,0),radius:0,metersPerTexel:.1}),view={position:new Vector3(100,0,0),direction:new Vector3(0,1,0),pixelScale:1000};
 assert.ok(Math.abs(viewDetailScore(n,view)-Math.log2(.8))<1e-10);
 assert.ok(viewDetailScore(n,view,1)<-1,'Grazing surface reduces projected texel size');
 assert.equal(meshAngularWeight({min:[0,0,6371000],max:[.001,.001,6371000]},1),0);
 const flat=meshAngularWeight({min:[0,0,6371000],max:[.001,.001,6371000]},20),tall=meshAngularWeight({min:[0,0,6371000],max:[.001,.001,6381000]},20);
 assert.ok(flat>.99);assert.equal(tall,0);
});
