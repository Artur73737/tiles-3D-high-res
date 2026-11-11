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
// nearer first within a tier. Tiles that leave the area are cancelled if still downloading;
// loaded tiles are kept until they are farther than radius x retainFactor.
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
 function empty(){return {done:0,total:0,errors:0,best:null,reached:false};}
 const settings=()=>{const s=o.settings();return {...s,radiusMeters:Math.min(MAX_RADIUS_M,s.radiusMeters)};};

 function drop(path){const m=loaded.get(path);if(!m)return;fade.remove(m);o.group.remove(m);o.disposeMesh(m);loaded.delete(path);}
 function clear(){epoch++;listing++;for(const c of inflight.values())c.abort();inflight.clear();pending=[];for(const p of [...loaded.keys()])drop(p);last=null;stats=empty();}

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
   m.userData.descriptor=d;m.userData.credits=tile.credits;o.place(m,d);o.group.add(m);fade.durationMs=settings().fadeMs??300;fade.add(m,o.now());loaded.set(d.path,m);stats.done++;o.onTile?.({path:d.path});
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
  // Same focus point listTiles measures distanceMeters from.
  const f=geoToECEF(here.lat,here.lon,0,list.planetRadius),focus=new THREE.Vector3(f.x,f.y,f.z);
  const want=new Set(list.tiles.map(t=>t.path)),retain=s.radiusMeters*s.retainFactor,center=new THREE.Vector3();
  for(const [p,ctl]of inflight)if(!want.has(p)){ctl.abort();inflight.delete(p);}
  // Tiles that left the area stay while they are within radius x retainFactor of the focus.
  for(const [p,m]of loaded)if(!want.has(p)&&center.fromArray(m.userData.descriptor.center).distanceTo(focus)>retain)drop(p);
  pending=list.tiles.filter(t=>!loaded.has(t.path)&&!inflight.has(t.path));
  stats={done:list.tiles.filter(t=>loaded.has(t.path)).length,total:list.count,errors:0,best:list.count?Math.min(...list.tiles.map(t=>t.metersPerTexel)):null,reached:false};
  pump();complete();
 }

 return {
  update,clear,
  tick(now){fade.update(now);},
  loaded,
  get group(){return o.group;},
  stats:()=>({...stats,resident:loaded.size,downloading:inflight.size,queued:pending.length,fading:fade.active}),
 };
}
