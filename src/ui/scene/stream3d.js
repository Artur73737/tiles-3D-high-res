// Streams Google 3D tiles around a focus point for one scene (flat view or globe).
//
// Tiles within fullDetailMeters of the focus are terminal (maximum resolution). Farther out, up to
// radiusMeters (capped at MAX_RADIUS_M), each tile is the coarsest whose texels are still no larger
// than one device pixel at that distance, so nothing on screen is ever magnified beyond 1 texel/pixel.
// Download order follows the camera, re-evaluated each time a download slot frees up:
//   tier 3  inside the view cone and within nearRadiusMeters of the camera
//   tier 2  inside the view cone
//   tier 1  within nearRadiusMeters but off screen (ready when the camera turns)
//   tier 0  everything else in the area
// nearer first within a tier. Downloads of tiles that leave the area are cancelled.
//
// Loaded tiles never disappear because the camera moved or turned:
// - a tile stays loaded until it is replaced by tiles that cover the same ground, or until more
//   when it is farther than dropDistanceMeters from you, or when loaded tiles exceed gpuBudgetMb
//   (then the farthest tiles no longer needed go first);
// - detail never goes down: a wanted coarse tile whose area is already fully covered by loaded finer
//   tiles is not downloaded, the finer ones stay;
// - a loaded coarse tile is removed only once every wanted finer tile under it is ready, so the
//   switch to finer detail leaves no gap.
import * as THREE from 'three';
import {FadeIn} from './fade.js';
import {geoToECEF} from '../../core/geo.js';

export const MAX_RADIUS_M=500;
const isAbort=e=>e?.name==='AbortError';
const scratch=new THREE.Vector3(),sphere=new THREE.Sphere();

// Camera-relative priority of a tile descriptor (center/radius in ECEF metres).
export function viewPriority(d,eye,{nearRadiusMeters=0,viewPriority=true}={}){
 if(!eye)return [0,0];
 const c=scratch.fromArray(d.center).sub(eye.position),dist=c.length(),gap=Math.max(0,dist-d.radius);
 const near=gap<=nearRadiusMeters;let seen=false;
 if(viewPriority){if(eye.frustum){sphere.center.fromArray(d.center);sphere.radius=d.radius;seen=eye.frustum.intersectsSphere(sphere);}else if(dist<=d.radius)seen=true;else{const cos=c.dot(eye.direction)/dist,angle=Math.acos(Math.max(-1,Math.min(1,cos))),spread=Math.asin(Math.min(1,d.radius/dist));seen=angle-spread<=eye.halfAngle;}}
 return [(seen?2:0)+(near?1:0),-dist];
}
// Camera as seen from ECEF. toEcef: matrix from the camera's world frame to ECEF (identity when the
// scene is already in ECEF). frustum is the exact screen rectangle; direction is the view axis.
export function cameraEye(camera,toEcef=null){
 camera.updateMatrixWorld();const world=toEcef?toEcef.clone().multiply(camera.matrixWorld):camera.matrixWorld.clone();
 const position=new THREE.Vector3().setFromMatrixPosition(world),direction=new THREE.Vector3(0,0,-1).transformDirection(world);
 const frustum=new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix,world.clone().invert()));
 return {position,direction,frustum};
}
const higher=(a,b)=>a[0]!==b[0]?a[0]>b[0]:a[1]>b[1];

export function createTileStream(o){
 // o: {group, getClient, makeMesh(tile), disposeMesh(mesh), place(mesh, descriptor), tileOptions(descriptor),
 //     eye(): {position, direction, frustum} in ECEF (cameraEye) | null, pixelAngle(): radians per device pixel,
 //     settings(): cfg.d3 + concurrency,
 //     now(), onTile, onError, onComplete}
 const loaded=new Map(),inflight=new Map(),fade=new FadeIn();
 // epoch: bumped by clear(); downloads from an older epoch are discarded. listing: bumped per listTiles call.
 let pending=[],client=null,epoch=0,listing=0,last=null,stats=empty();
 // want: paths of the current listing. covered: wanted paths satisfied by loaded finer tiles.
 // waiting: loaded coarse path -> wanted finer paths under it that are not loaded yet.
 let want=new Set(),covered=new Set(),waiting=new Map(),focusPoint=null,bytes=0;
 function empty(){return {done:0,total:0,errors:0,best:null,reached:false};}
 const settings=()=>{const s=o.settings();return {...s,radiusMeters:Math.min(MAX_RADIUS_M,s.radiusMeters)};};
 const isAncestor=(a,b)=>b.length>a.length&&b.startsWith(a);

 function drop(path){const m=loaded.get(path);if(!m)return;bytes-=m.userData.gpuBytes??0;fade.remove(m);o.group.remove(m);o.disposeMesh(m);loaded.delete(path);waiting.delete(path);}
 function clear(){epoch++;listing++;focusPoint=null;for(const c of inflight.values())c.abort();inflight.clear();pending=[];for(const p of [...loaded.keys()])drop(p);last=null;stats=empty();want=new Set();covered=new Set();waiting=new Map();}

 // True when loaded tiles at or below d cover its whole area (metadata walk, no payload).
 async function coveredBy(c,d,below){
  if(loaded.has(d.path))return true;
  if(d.node.empty)return true;                          // declared empty: nothing to cover
  if(!below.has(d.path))return false;                   // no loaded tile underneath
  const kids=await c.children(d);if(!kids.length)return false;
  for(const k of kids)if(!await coveredBy(c,k,below))return false;
  return true;
 }

 // GPU bytes of a tile mesh: vertex / index buffers plus textures (compressed size for DXT).
 function gpuBytes(m){let n=0;const seen=new Set();m.traverse(x=>{if(!x.isMesh)return;for(const at of Object.values(x.geometry.attributes))n+=at.array.byteLength;if(x.geometry.index)n+=x.geometry.index.array.byteLength;
  const t=x.material?.map;if(t&&!seen.has(t)){seen.add(t);const mip=t.mipmaps?.[0];n+=mip?.data?mip.data.byteLength:t.image?.data?t.image.data.byteLength:(t.image?.width??0)*(t.image?.height??0)*4;}});return n;}
 // Removes loaded tiles that are no longer needed, never one that is wanted or stands in for a wanted one:
 // 1. coarse tiles whose wanted finer tiles are all ready (replaced);
 // 2. tiles farther than dropDistanceMeters from the focus (you moved away);
 // 3. above gpuBudgetMb, the farthest remaining ones, trimming to 90% so loads do not trim one by one.
 function prune(focus){
  for(const [a,rest]of waiting)if(!rest.size&&!want.has(a))drop(a);
  if(!focus)return;const s=settings();
  const underCovered=p=>{for(let i=1;i<p.length;i++)if(covered.has(p.slice(0,i)))return true;return false;};
  const needed=p=>want.has(p)||waiting.has(p)||underCovered(p);
  const center=new THREE.Vector3(),spare=[],far=s.dropDistanceMeters??3000;
  for(const [p,m]of loaded){if(needed(p))continue;const d=center.fromArray(m.userData.descriptor.center).distanceTo(focus);if(d>far)drop(p);else spare.push([d,p]);}
  const budget=(s.gpuBudgetMb??2048)*1048576;if(bytes<=budget)return;
  spare.sort((x,y)=>y[0]-x[0]);
  for(const [,p]of spare){if(bytes<=budget*.9)break;drop(p);}
 }

 // Picks the most urgent pending tile for the current camera.
 function next(){
  const eye=o.eye(),s=settings();let best=-1,bestP=null;
  for(let i=0;i<pending.length;i++){const p=viewPriority(pending[i],eye,s);if(best<0||higher(p,bestP)){best=i;bestP=p;}}
  const d=pending[best];pending[best]=pending[pending.length-1];pending.pop();return {d,priority:bestP};
 }
 function pump(){const n=Math.max(1,settings().concurrency|0);while(inflight.size<n&&pending.length){const {d,priority}=next();run(d,priority);}}
 async function run(d,priority){
  const ctl=new AbortController(),g=epoch,c=client;inflight.set(d.path,ctl);
  try{
   const tile=await c.getTile(d,o.tileOptions(d),{signal:ctl.signal,priority});
   if(ctl.signal.aborted||g!==epoch||loaded.has(d.path))return;
   const m=await o.makeMesh(tile);
   if(ctl.signal.aborted||g!==epoch){o.disposeMesh(m);return;}
   m.userData.descriptor=d;m.userData.credits=tile.credits;m.userData.gpuBytes=gpuBytes(m);bytes+=m.userData.gpuBytes;o.place(m,d);o.group.add(m);fade.durationMs=settings().fadeMs??300;fade.add(m,o.now());loaded.set(d.path,m);stats.done++;o.onTile?.({path:d.path});
   // This tile now stands for its area: finer leftovers under it would overlap (z-fighting).
   for(const p of [...loaded.keys()])if(isAncestor(d.path,p)&&!want.has(p))drop(p);
   // A coarse tile above it can go once all of its wanted finer tiles are here.
   for(const [a,rest]of waiting)if(rest.delete(d.path)&&!rest.size&&!want.has(a))drop(a);
   prune(focusPoint);
  }catch(e){if(isAbort(e)||g!==epoch)return;stats.errors++;o.onError?.(e);}
  finally{if(inflight.get(d.path)===ctl)inflight.delete(d.path);if(g===epoch){pump();complete();}}
 }
 function complete(){if(!pending.length&&!inflight.size&&stats.total&&stats.done===stats.total&&!stats.reached){stats.reached=true;o.onComplete?.();}}

 // Re-lists the area when the focus moved a quarter radius (or force), then reconciles.
 async function update(here,{force=false}={}){
  const c=o.getClient();if(!c){if(client)clear();client=null;return;}
  if(c!==client){clear();client=c;}
  const s=settings();
  const moved=last?Math.hypot((here.lat-last.lat)*111320,(here.lon-last.lon)*111320*Math.cos(here.lat*Math.PI/180)):Infinity;
  if(!force&&moved<s.radiusMeters*.25)return;
  last={...here};const g=++listing;
  const list=await c.listTiles({latitude:here.lat,longitude:here.lon,radiusMeters:s.radiusMeters,nearRadiusMeters:s.nearRadiusMeters,headingDegrees:null,fieldOfViewDegrees:360,
   ...(s.detail==='max'&&s.fullDetailMeters!=null?{fullDetailRadiusMeters:s.fullDetailMeters,pixelAngleRadians:o.pixelAngle()}:{fullDetailRadiusMeters:null,pixelAngleRadians:null})});
  if(g!==listing||c!==client)return;
  // Every strict prefix of a loaded path: "has a loaded tile underneath".
  const below=new Set();for(const p of loaded.keys())for(let i=1;i<p.length;i++)below.add(p.slice(0,i));
  // Never downgrade: a wanted tile already covered by loaded finer tiles is not downloaded.
  const nowCovered=new Set();
  await Promise.all(list.tiles.filter(t=>!loaded.has(t.path)&&below.has(t.path)).map(async t=>{try{if(await coveredBy(c,t,below))nowCovered.add(t.path);}catch(e){if(!isAbort(e))o.onError?.(e);}}));
  if(g!==listing||c!==client)return;
  want=new Set(list.tiles.map(t=>t.path));covered=nowCovered;
  for(const [p,ctl]of inflight)if(!want.has(p)){ctl.abort();inflight.delete(p);}
  // Loaded coarse tiles that wanted finer tiles will replace: kept until those are all ready.
  waiting=new Map();
  for(const t of list.tiles){if(loaded.has(t.path)||covered.has(t.path))continue;
   for(let i=1;i<t.path.length;i++){const a=t.path.slice(0,i);if(loaded.has(a)&&!want.has(a)){if(!waiting.has(a))waiting.set(a,new Set());waiting.get(a).add(t.path);}}}
  // Loaded coarse tiles whose wanted finer tiles are all ready already: replaced, remove now.
  const wantBelow=new Set();for(const w of want)for(let i=1;i<w.length;i++)wantBelow.add(w.slice(0,i));
  for(const a of [...loaded.keys()])if(!want.has(a)&&!waiting.has(a)&&wantBelow.has(a))drop(a);
  const f=geoToECEF(here.lat,here.lon,0,list.planetRadius);focusPoint=new THREE.Vector3(f.x,f.y,f.z);prune(focusPoint);
  pending=list.tiles.filter(t=>!loaded.has(t.path)&&!covered.has(t.path)&&!inflight.has(t.path));
  const ready=list.tiles.filter(t=>loaded.has(t.path)||covered.has(t.path)).length;
  stats={done:ready,total:list.count,errors:0,best:list.count?Math.min(...list.tiles.map(t=>t.metersPerTexel)):null,reached:false};
  pump();complete();
 }

 return {
  update,clear,
  tick(now){fade.update(now);},
  loaded,
  get group(){return o.group;},
  stats:()=>({...stats,resident:loaded.size,gpuMB:Math.round(bytes/1048576),downloading:inflight.size,queued:pending.length,fading:fade.active}),
 };
}
