// Globe view: Google 2D tiles draped on a sphere through a non-overlapping quadtree, plus Google 3D
// meshes placed in ECEF. Geometry is stored relative to each tile centre (relative-to-centre
// rendering), so float32 vertex precision holds at centimetre scale anywhere on the planet.
import * as THREE from 'three';
import {geoToECEF} from '../../core/geo.js';
import {createTileStream,cameraEye} from './stream3d.js';
import {trackGestures} from '../input/gestures.js';
const R=6371010,C=40075016.686,DEG=Math.PI/180,TILE_PX=256,EDGE=0.004;
const ecef=(lat,lon,alt=0)=>{const p=geoToECEF(lat,lon,alt,R);return new THREE.Vector3(p.x,p.y,p.z);};
export function enuFrame(lat,lon,alt=0){const e=new THREE.Vector3(-Math.sin(lon*DEG),Math.cos(lon*DEG),0),up=ecef(lat,lon,0).normalize(),n=new THREE.Vector3().crossVectors(up,e);return {e,n,up,m:new THREE.Matrix4().makeBasis(e,n,up).setPosition(up.clone().multiplyScalar(R+alt))};}
const toGeo=p=>{const l=p.length();return {lat:Math.asin(p.z/l)/DEG,lon:Math.atan2(p.y,p.x)/DEG,alt:l-R};};
const tileLat=(y,n)=>Math.atan(Math.sinh(Math.PI*(1-2*y/n)))/DEG;

export function createGlobe(ctx){
 const {win,view,camera,cfg,keys}=ctx;
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x050505);
 // Draw order: opaque base sphere (writes depth, hides the far hemisphere) -> 2D imagery (no depth
 // writes, so it can never z-fight with itself or with 3D) -> 3D meshes (depth tested normally).
 const base=new THREE.Mesh(new THREE.SphereGeometry(R-4000,128,96),new THREE.MeshBasicMaterial({color:0x0d1013}));base.rotation.x=Math.PI/2;base.renderOrder=0;
 const patches=new THREE.Group(),meshes=new THREE.Group();patches.renderOrder=1;meshes.renderOrder=2;scene.add(base,patches,meshes);
 const nav={lat:41.89021,lon:12.49223,dist:1500,heading:0,tilt:45};const fly={pos:ecef(41.89,12.49,300),yaw:0,pitch:-.2};
 let magnification=0,active=false,mode='2d',dirty=true,lastLod=0,gen2d=0,frame=0,ground=0,finest=2,shown=0,selected=0;
 const nodes=new Map();

 // ---------- camera ----------
 function placeOrbit(){const f=enuFrame(nav.lat,nav.lon),t=f.up.clone().multiplyScalar(R+ground),h=nav.heading*DEG,tl=nav.tilt*DEG;
  const fwd=f.n.clone().multiplyScalar(Math.cos(h)).addScaledVector(f.e,Math.sin(h));
  camera.position.copy(t).addScaledVector(f.up,nav.dist*Math.cos(tl)).addScaledVector(fwd,-nav.dist*Math.sin(tl));
  camera.up.copy(fwd).multiplyScalar(Math.cos(tl)).addScaledVector(f.up,Math.sin(tl)).normalize();camera.lookAt(t);}
 function flyBasis(){const g=toGeo(fly.pos),f=enuFrame(g.lat,g.lon),fwd=f.n.clone().multiplyScalar(Math.cos(fly.yaw)*Math.cos(fly.pitch)).addScaledVector(f.e,Math.sin(fly.yaw)*Math.cos(fly.pitch)).addScaledVector(f.up,Math.sin(fly.pitch)).normalize();
  const right=f.e.clone().multiplyScalar(Math.cos(fly.yaw)).addScaledVector(f.n,-Math.sin(fly.yaw));return {f,fwd,right};}
 const altitude=()=>camera.position.length()-R;
 const focus=()=>mode==='fly'?toGeo(fly.pos):{lat:nav.lat,lon:nav.lon};
 const pxH=()=>Math.max(1,view.clientHeight);
 const focal=()=>pxH()/(2*Math.tan(camera.fov*DEG/2));
 const zoomFromDist=(d,lat)=>Math.log2(C*Math.cos(lat*DEG)*focal()/(TILE_PX*Math.max(d,1)));
 const distFromZoom=(z,lat)=>C*Math.cos(lat*DEG)*focal()/(TILE_PX*2**z);
 const heading=()=>mode==='fly'?((fly.yaw/DEG)%360+360)%360:nav.heading;

 // ---------- input (screen-aligned: content follows the pointer at any heading) ----------
 let drag=null;
 view.addEventListener('pointerdown',e=>{if(!active||mode==='fly'||e.pointerType==='touch')return;drag={x:e.clientX,y:e.clientY,rot:e.button===2||e.ctrlKey||e.shiftKey};view.setPointerCapture(e.pointerId);});
 view.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
  if(drag.rot){nav.heading=(nav.heading-dx*.25+360)%360;nav.tilt=Math.max(0,Math.min(85,nav.tilt-dy*.25));}
  else{const mpp=nav.dist/focal(),h=nav.heading*DEG,east=(-dx*Math.cos(h)+dy*Math.sin(h))*mpp,north=(dx*Math.sin(h)+dy*Math.cos(h))*mpp;
   nav.lat=Math.max(-85,Math.min(85,nav.lat+north/111320));nav.lon=((nav.lon+east/(111320*Math.max(.01,Math.cos(nav.lat*DEG)))+540)%360)-180;}
  dirty=true;ctx.onMove?.();});
 // Touch: one finger pans (or looks around in fly), pinch zooms, twist rotates, two-finger drag tilts.
 const panBy=(dx,dy)=>{const mpp=nav.dist/focal(),h=nav.heading*DEG,east=(-dx*Math.cos(h)+dy*Math.sin(h))*mpp,north=(dx*Math.sin(h)+dy*Math.cos(h))*mpp;
  nav.lat=Math.max(-85,Math.min(85,nav.lat+north/111320));nav.lon=((nav.lon+east/(111320*Math.max(.01,Math.cos(nav.lat*DEG)))+540)%360)-180;};
 trackGestures(view,{filter:e=>active&&e.pointerType==='touch',
  onPan:(dx,dy,n)=>{if(mode==='fly'){if(n===1){fly.yaw-=dx*.005;fly.pitch=Math.max(-1.55,Math.min(1.55,fly.pitch+dy*.005));}return;}
   if(n===1)panBy(dx,dy);else nav.tilt=Math.max(0,Math.min(85,nav.tilt-dy*.3));dirty=true;ctx.onMove?.();},
  onPinch:({scale,rotate})=>{if(mode==='fly')return;nav.heading=(nav.heading-rotate/DEG+360)%360;zoomBy(1/scale);}});
 view.addEventListener('pointerup',()=>{drag=null;});view.addEventListener('contextmenu',e=>{if(active)e.preventDefault();});
 view.addEventListener('wheel',e=>{if(!active)return;e.preventDefault();zoomBy(e.deltaY<0?1/1.15:1.15);},{passive:false});
 view.addEventListener('click',()=>{if(active&&mode==='fly')view.requestPointerLock?.();});
 view.ownerDocument.addEventListener('mousemove',e=>{if(!active||mode!=='fly'||view.ownerDocument.pointerLockElement!==view)return;fly.yaw+=e.movementX*.0025;fly.pitch=Math.max(-1.55,Math.min(1.55,fly.pitch-e.movementY*.0025));});
 function zoomBy(f){if(mode==='fly'){cfg.d3.flySpeed=Math.max(1,Math.min(20000,Math.round(cfg.d3.flySpeed/f)));ctx.onFlySpeed?.();return;}nav.dist=Math.max(minDist(),Math.min(3e7,nav.dist*f));dirty=true;ctx.onMove?.();}
 // 2D without overzoom stops where the maximum zoom is shown 1:1, like the flat map; 3D may go closer.
 function minDist(){return mode==='2d'&&!cfg.d2.overzoom?Math.max(15,distFromZoom(cfg.d2.maxZoom,nav.lat)*ctx.dpr()*256/ctx.tileTexels()):15;}
 function resetNorth(){if(mode==='fly')fly.yaw=0;else nav.heading=0;dirty=true;ctx.onMove?.();}

 // ---------- 2D quadtree ----------
 function patchGeometry(z,x,y){
  const n=2**z,seg=z<4?32:z<8?16:8,west=x/n*360-180,span=360/n,c=ecef(tileLat(y+.5,n),west+span/2),pos=[],uv=[],idx=[];
  for(let j=0;j<=seg;j++){const v=-EDGE+(1+2*EDGE)*j/seg,lat=tileLat(Math.min(n,Math.max(0,y+v)),n);for(let i=0;i<=seg;i++){const u=-EDGE+(1+2*EDGE)*i/seg,p=ecef(lat,west+span*u).sub(c);pos.push(p.x,p.y,p.z);uv.push(u,v);}}
  for(let j=0;j<seg;j++)for(let i=0;i<seg;i++){const a=j*(seg+1)+i,b=a+1,d=a+seg+1,e=d+1;idx.push(a,d,b,b,d,e);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeBoundingSphere();return {g,c};
 }
 const node=(z,x,y)=>{const k=z+'/'+x+'/'+y;let t=nodes.get(k);if(!t){t={k,z,x,y,mesh:null,state:'idle',used:0};nodes.set(k,t);}return t;};
 function request(t){if(t.state!=='idle')return;t.state='loading';const g=gen2d;
  ctx.tileImage(t.z,t.x,t.y,32-t.z).then(bmp=>{if(g!==gen2d||nodes.get(t.k)!==t){bmp?.close?.();return;}const {g:geo,c}=patchGeometry(t.z,t.x,t.y),map=new THREE.Texture(bmp);
   map.flipY=false;map.colorSpace=THREE.SRGBColorSpace;map.anisotropy=8;map.wrapS=map.wrapT=THREE.ClampToEdgeWrapping;map.needsUpdate=true;
   const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map,depthWrite:false}));m.userData.c=c;m.visible=false;m.matrixAutoUpdate=false;t.mesh=m;t.state='ready';patches.add(m);dirty=true;ctx.onTile?.({mode:'globe2d',z:t.z,x:t.x,y:t.y});},
  e=>{if(nodes.get(t.k)===t){t.state='error';t.err=e?.code??e?.message;}});}
 const frustum=new THREE.Frustum(),sphere=new THREE.Sphere(),pm=new THREE.Matrix4();
 // Returns the ready nodes that exactly cover tile (z,x,y), or null when nothing ready covers it.
 // A node subdivides only when its texels would be magnified; its children replace it only once all
 // of them are ready, so no two drawn patches ever overlap.
 function cover(z,x,y,camN,horizonAng,cap,lift,texels){
  const n=2**z,latC=tileLat(y+.5,n),c=ecef(latC,(x+.5)/n*360-180,lift),cn=c.clone().normalize(),ang=Math.PI/n*1.5;
  if(z>2&&cn.dot(camN)<Math.cos(Math.min(Math.PI,horizonAng+ang)))return [];
  const size=Math.max(1,C*Math.cos(latC*DEG)/n),north=tileLat(y,n),south=tileLat(y+1,n),ext=Math.max(size,(north-south)*111320);
  if(z>3){sphere.set(c,ext*.8);if(!frustum.intersectsSphere(sphere))return [];}
  const t=node(z,x,y);t.used=frame;t.mag=0;const d=Math.max(.5,c.distanceTo(camera.position)-ext*.75),px=ext/d*focal()*ctx.dpr();
  t.mag=z<cap?px/texels:0;
  // Never magnify: subdivide as soon as a tile would cover more device pixels than it has texels.
  if(z<cap&&px>texels){let all=true;const parts=[];for(const [i,j]of [[0,0],[1,0],[0,1],[1,1]]){const r=cover(z+1,2*x+i,2*y+j,camN,horizonAng,cap,lift,texels);if(r===null)all=false;else parts.push(...r);}
   if(all)return parts;request(t);return t.state==='ready'?[t]:null;}
  request(t);return t.state==='ready'?[t]:null;
 }
 function updatePatches(){
  frame++;camera.updateMatrixWorld();pm.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);frustum.setFromProjectionMatrix(pm);
  const camN=camera.position.clone().normalize(),horizonAng=Math.acos(Math.min(1,R/camera.position.length())),cap=cfg.d2.maxZoom,list=[];
  // Patches rest on the local ground height near the surface; LOD distances use the same height.
  const lift=altitude()-ground<20000?ground-2:0,s=(R+lift)/R,texels=ctx.tileTexels();
  for(let x=0;x<4;x++)for(let y=0;y<4;y++){const r=cover(2,x,y,camN,horizonAng,cap,lift,texels);if(r)list.push(...r);}
  for(const t of nodes.values())if(t.mesh)t.mesh.visible=false;
  finest=2;magnification=0;for(const t of list){magnification=Math.max(magnification,t.mag);const m=t.mesh;m.position.copy(m.userData.c).multiplyScalar(s);m.scale.setScalar(s);m.updateMatrix();m.visible=true;finest=Math.max(finest,t.z);}
  shown=list.length;selected=[...nodes.values()].filter(t=>t.used===frame).length;
  if(nodes.size>900){const old=[...nodes.values()].filter(t=>t.used<frame-2&&t.state!=='loading').sort((a,b)=>a.used-b.used);for(const t of old.slice(0,nodes.size-700))dropNode(t);}
 }
 function dropNode(t){if(t.mesh){patches.remove(t.mesh);t.mesh.geometry.dispose();t.mesh.material.map?.dispose();t.mesh.material.dispose();}nodes.delete(t.k);}

 // ---------- 3D meshes ----------
 const activation=()=>3000;
 // Meshes are placed in ECEF through their own ENU frame; the camera is already in ECEF.
 const tiles=createTileStream({group:meshes,getClient:()=>ctx.getClient3d(),makeMesh:t=>ctx.makeMesh(t),disposeMesh:m=>ctx.disposeMesh(m),settings:ctx.settings3d,pixelAngle:ctx.pixelAngle,now:()=>win.performance.now(),
  place:(m,d)=>{m.matrixAutoUpdate=false;m.matrix.copy(enuFrame(d.latitude,d.longitude).m);},
  tileOptions:d=>({latitude:d.latitude,longitude:d.longitude,textureOutput:ctx.textureOutput()}),
  eye:()=>cameraEye(camera),
  onTile:e=>ctx.onTile?.({mode:'globe3d',...e}),onError:e=>ctx.onError?.(e)});
 function refresh3d(force){
  if(!ctx.getClient3d()||mode==='2d'||altitude()>activation())return;
  tiles.update(focus(),{force}).catch(e=>{if(e.name!=='AbortError')ctx.onError?.(e);});
 }
 function clear3d(){tiles.clear();}
 function surfaceHit(origin,dir,max){return new THREE.Raycaster(origin,dir,0,max).intersectObjects(meshes.children,true)[0]??null;}

 // ---------- frame ----------
 function update(dt){
  if(!active)return;tiles.tick(win.performance.now());
  if(mode==='fly'){const {f,fwd,right}=flyBasis(),v=new THREE.Vector3(),alt=Math.max(1,fly.pos.length()-R),k=(keys.has('ShiftLeft')||keys.has('ShiftRight')?4:1)*cfg.d3.flySpeed*Math.max(1,alt/300)*dt;
   if(keys.has('KeyW'))v.add(fwd);if(keys.has('KeyS'))v.sub(fwd);if(keys.has('KeyD'))v.add(right);if(keys.has('KeyA'))v.sub(right);if(keys.has('KeyE')||keys.has('Space'))v.add(f.up);if(keys.has('KeyQ')||keys.has('ControlLeft'))v.sub(f.up);
   // Keys give full speed; the touch stick is analog. Combined input never exceeds full speed.
   if(v.lengthSq())v.normalize();const pad=ctx.flyPad?.();if(pad){v.addScaledVector(fwd,pad.y).addScaledVector(right,pad.x).addScaledVector(f.up,(pad.up?1:0)-(pad.down?1:0));}if(v.lengthSq()>1)v.normalize();
   if(v.lengthSq()){fly.pos.addScaledVector(v,k);dirty=true;}
   const up=fly.pos.clone().normalize(),hit=surfaceHit(fly.pos.clone().addScaledVector(up,500),up.clone().negate(),3000),floor=hit?hit.point.length():R+ground+2;
   if(fly.pos.length()<floor+1.7)fly.pos.setLength(floor+1.7);
   const b=flyBasis();camera.position.copy(fly.pos);camera.up.copy(b.f.up);camera.lookAt(fly.pos.clone().add(b.fwd));}
  else placeOrbit();
  const now=win.performance.now();if(dirty&&now-lastLod>120||now-lastLod>800){lastLod=now;dirty=false;updatePatches();refresh3d(false);}
 }

 return {scene,meshes,nav,fly,zoomBy,resetNorth,heading,
  enter(m,{lat,lon,zoom}){active=true;mode=m;nav.lat=lat;nav.lon=lon;if(Number.isFinite(zoom))nav.dist=Math.max(minDist(),distFromZoom(zoom,lat));
   if(m==='fly'){fly.pos=ecef(lat,lon,ground+Math.min(400,Math.max(40,nav.dist*.3)));fly.yaw=nav.heading*DEG;fly.pitch=-.2;}
   if(m==='3d'&&nav.dist>2500){nav.dist=Math.min(nav.dist,cfg.d3.radiusMeters*3);nav.tilt=Math.max(nav.tilt,45);}
   if(m==='2d')clear3d();dirty=true;lastLod=0;},
  leave(){active=false;clear3d();if(view.ownerDocument.pointerLockElement===view)view.ownerDocument.exitPointerLock();},
  setGround(g){ground=g;dirty=true;},
  update,invalidate2d(){gen2d++;for(const t of [...nodes.values()])dropNode(t);dirty=true;},
  invalidate3d(){clear3d();dirty=true;},refresh3d,
  getView(){const f=focus(),d=mode==='fly'?Math.max(1,altitude()):nav.dist;return {lat:f.lat,lon:f.lon,zoom:Math.max(0,Math.min(26,zoomFromDist(d,f.lat))),altitude:altitude(),heading:heading(),tilt:nav.tilt};},
  debugNodes(){return nodes.values();},
  visibleKeys(){return [...nodes.values()].filter(t=>t.mesh?.visible).map(t=>t.k);},
  stats(){return {magnification,patches:shown,wanted:selected,finestZoom:finest,nodes:nodes.size,mesh:tiles.stats(),altitude:altitude(),activation:activation()};},
  dispose(){this.invalidate2d();clear3d();base.geometry.dispose();base.material.dispose();}};
}
