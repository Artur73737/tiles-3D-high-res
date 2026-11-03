import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PerspectiveCamera,Vector3,Matrix4,Frustum} from 'three';
import {TerrainTileEngine,SatelliteTileEngine,EarthTileEngine,createView,geoToECEF} from '../src/api.js';
import {EarthHQStreaming} from '../src/streamer.js';
import {SatelliteLayer} from '../src/satellite.js';
import {nodeInFrustum} from '../src/geo-core.js';
import decode from '../src/vendor/rocktree-decoder.cjs';
const bytes=new Uint8Array(readFileSync(new URL('./fixtures/node.pb',import.meta.url)));
const decoded=async()=>(await decode(1,bytes)).payload;
const radius=6371010,point=new Vector3(radius,0,0);
const descriptor=(path,y=500,leaf=false)=>({path,key:path,center:point.clone().add(new Vector3(0,y,0)),radius:10,metersPerTexel:10,leaf,hasData:true,epoch:1});
const source=children=>({root:async()=>({radius,epoch:1}),copyrights:async()=>new Map(),children,loadNode:decoded,clear(){}});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function camera(height=100,heading=500){const c=new PerspectiveCamera(52,1.6,.1,150000000);c.position.set(radius+height,0,0);c.up.set(1,0,0);c.lookAt(radius,heading,0);c.updateMatrixWorld();return c;}
const input=c=>({position:c.position.toArray(),direction:c.getWorldDirection(new Vector3()).toArray(),up:c.up.toArray(),viewportWidth:960,viewportHeight:600,fovYDegrees:c.fov,near:c.near,far:c.far});

test('plain camera projection and clipping agree with the viewer across height, pitch and direction',()=>{
 for(const height of [30,110,1000])for(const heading of [50,500,-500]){
  const c=camera(height,heading),v=createView(input(c)),matrix=new Matrix4().multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse),frustum=new Frustum().setFromProjectionMatrix(matrix);
  assert.ok(Math.max(...v.projection.elements.map((x,i)=>Math.abs(x-matrix.elements[i])))<1e-6);
  assert.ok(Math.abs(v.pixelScale-960*c.projectionMatrix.elements[0]/2)<1e-9);
  for(const y of [-1000,-500,0,500,1000]){const node=descriptor('100',y);assert.equal(nodeInFrustum(node,v.frustum),nodeInFrustum(node,frustum));}
 }
 assert.throws(()=>createView({position:[1,0,0],direction:[0,0,0]}),/direction/);
});

test('data-only terrain and viewer select the same inventory, requests and masks',async()=>{
 const buildSource=()=>source(async n=>n.root?[descriptor('100'),descriptor('200',-500)]:[descriptor(n.path+'0',n.center.y,true)]);
 const options={radiusMeters:2000,retainRadiusMeters:2300,screenSpaceError:1};
 const api=new TerrainTileEngine({...options,source:buildSource()}),viewer=new EarthHQStreaming({...options,source:buildSource(),renderer:{getDrawingBufferSize:v=>v.set(960,600),extensions:{has:()=>true},capabilities:{getMaxAnisotropy:()=>8}}});
 try{
  await Promise.all([api.start(),viewer.start()]);
  for(const heading of [500,-500,500]){const c=camera(100,heading);api.update(input(c));viewer.update(c);await tick();await Promise.all([api.waitForIdle(),viewer.waitForIdle()]);
   assert.equal(api.getCoverage().complete,true);assert.deepEqual([...api.viewCut.keys()],[...viewer.viewCut.keys()]);assert.deepEqual([...api.wanted.keys()],[...viewer.wanted.keys()]);
   assert.deepEqual([...api.assets].map(([key,a])=>[key,a.mask]),[...viewer.assets].map(([key,a])=>[key,a.mask]));
   for(const [key,a]of api.assets){const b=viewer.assets.get(key);assert.deepEqual(a.meshes[0].positions,b.meshes[0].geometry.attributes.position.array);assert.deepEqual(a.meshes[0].indices,b.meshes[0].geometry.index.array);assert.equal(a.angularWeight,b.angularWeight);assert.ok(!a.group);}
  }
 }finally{await Promise.all([api.dispose(),viewer.dispose()]);}
});

test('terminal API preserves raw mesh payload and texture bytes beyond depth thirty',async()=>{
 const api=new TerrainTileEngine({source:source(async n=>n.root?[descriptor('1')]:[descriptor(n.path+'0',500,n.path.length===31)])});let tile;api.addEventListener('tile-load',e=>tile=e.asset);
 try{const c=await api.requestRegion({latitude:0,longitude:0,radiusMeters:1000});assert.equal(c.complete,true);assert.equal(tile.descriptor.path.length,32);assert.equal(tile.descriptor.leaf,true);assert.ok(tile.meshes[0].positions instanceof Uint8Array);assert.ok(tile.meshes[0].uv instanceof Float32Array);assert.ok(tile.matrixGlobeFromMesh instanceof Float64Array);assert.ok(tile.meshes[0].texture.bytes.byteLength>0);assert.ok(tile.decoded.meshes.length);assert.ok(c.residentBytes>0);}finally{await api.dispose();}assert.equal(tile.disposed,true);
});

test('satellite data engine shares viewer selection and returns untouched image bytes',async()=>{
 const api=new SatelliteTileEngine(),viewer=new SatelliteLayer({renderer:{getDrawingBufferSize:v=>v.set(960,600)}});api.pump=viewer.pump=()=>{};
 try{const c=camera(1000,500);api.update(input(c));viewer.update(c);assert.deepEqual([...api.needed],[...viewer.needed]);assert.deepEqual(api.queue.map(n=>n.key),viewer.queue.map(n=>n.key));assert.equal(api.targetZoom,viewer.targetZoom);}finally{await Promise.all([api.dispose(),viewer.dispose()]);}
 const original=new Uint8Array([137,80,78,71,13,10,26,10]);const raster=new SatelliteTileEngine({fetch:async()=>new Response(original,{headers:{'content-type':'image/png'}})});let tile;raster.addEventListener('tile-load',e=>tile=e.tile);
 try{const node=raster.node(22,2200000,1500000);raster.needed.add(node.key);await raster.load(node,new AbortController().signal);assert.deepEqual(tile.data,original);assert.equal(tile.node.z,22);assert.equal(tile.mimeType,'image/png');assert.ok(!tile.mesh);assert.equal(raster.status().resident,1);}finally{await raster.dispose();}
});

test('unified API has no graphics surface and forwards tile lifecycle with layer identity',async()=>{
 const api=new EarthTileEngine({terrain:{source:source(async()=>[descriptor('100',500,true)])},satellite:false});const events=[];api.addEventListener('tile-load',e=>events.push([e.layer,e.tile]));
 await api.start();await api.terrain.requestRegion({latitude:0,longitude:0,radiusMeters:1000});assert.equal(events[0][0],'3d');assert.ok(events[0][1].meshes.length);assert.equal(api.getCoverage().satellite,null);assert.equal(api.terrain.group,undefined);assert.equal(api.terrain.renderer,undefined);await api.dispose();assert.equal(api.terrain.assets.size,0);
});
