// One geographic interface over the three scenes (flat 2D canvas, flat 3D local frame, globe ECEF),
// so overlays and tools never deal with cameras or frames directly. Screen units are CSS pixels
// relative to the stage. project() returns null for points that cannot be seen (behind the camera,
// on the far side of the globe, off the 2D world).
import * as THREE from 'three';
import {geoToECEF,ecefToGeo} from '../../core/geo.js';

const R=6371010,C=40075016.686,DEG=Math.PI/180;
const v=new THREE.Vector3(),w=new THREE.Vector3();

export function createMapView(d){
 // d: {state, stage, camera, globe, world, origin(), enu(lat,lon), project(lat,lon,z), unproject(x,y,z), orbit, groundAlt()}
 const kind=()=>d.state.view==='globe'?'globe':d.state.mode==='2d'?'flat2d':'flat3d';
 const size=()=>({w:d.stage.clientWidth,h:d.stage.clientHeight});
 const ecef=(lat,lon,alt)=>{const p=geoToECEF(lat,lon,alt,R);return w.set(p.x,p.y,p.z);};
 // World position of a geographic point in the current 3D scene.
 // ECEF -> flat 3D local frame; the inverse is cached per origin (it is used for every projected point).
 let inv=null,invFor=null,fwd=null;
 function frames(o){if(invFor!==o){invFor=o;fwd=d.enu(o.lat,o.lon);inv=fwd.clone().invert();}return {inv,fwd};}
 function world(lat,lon,alt){
  const p=ecef(lat,lon,alt);if(kind()==='globe')return p;
  const o=d.origin();if(!o)return null;return p.applyMatrix4(frames(o).inv);
 }
 // Per-frame snapshot: stage size, view and projection matrices. Projecting thousands of points then costs
 // a few multiplications each and one result object. begin() also returns a signature of the view, so
 // callers can tell whether the camera moved since the previous frame.
 let snap=null;
 function take(){
  const k=kind(),W=d.stage.clientWidth,H=d.stage.clientHeight;
  if(k==='flat2d'){const s=d.state;return {k,W,H,z:s.zoom,c:d.project(s.lat,s.lon,s.zoom),n:2**s.zoom,sig:`2|${W}|${H}|${s.zoom}|${s.lat}|${s.lon}`};}
  d.camera.updateMatrixWorld();const m=new THREE.Matrix4().multiplyMatrices(d.camera.projectionMatrix,d.camera.matrixWorldInverse),o=k==='flat3d'?d.origin():null;
  const c=d.camera.position;return {k,W,H,m,inv:o?frames(o).inv:null,cx:c.x,cy:c.y,cz:c.z,sig:k+'|'+W+'|'+H+'|'+m.elements.join(',')};
 }
 const begin=()=>(snap=take()).sig,end=()=>{snap=null;};
 function project(lat,lon,alt=0){
  const s=snap??take();
  if(s.k==='flat2d'){const a=d.project(lat,lon,s.z);let dx=a.x-s.c.x;if(dx>s.n/2)dx-=s.n;else if(dx<-s.n/2)dx+=s.n;return {x:s.W/2+dx*256,y:s.H/2+(a.y-s.c.y)*256,depth:0};}
  if(s.k==='flat3d'&&!s.inv)return null;
  const la=lat*DEG,lo=lon*DEG,r=R+alt,cl=Math.cos(la);let x=r*cl*Math.cos(lo),y=r*cl*Math.sin(lo),z=r*Math.sin(la);
  if(s.k==='globe'){
   // Hidden behind the planet: the camera->point segment enters the sphere before reaching the point.
   let dx=x-s.cx,dy=y-s.cy,dz=z-s.cz;const len=Math.hypot(dx,dy,dz);
   if(len>1e-6){dx/=len;dy/=len;dz/=len;const b=s.cx*dx+s.cy*dy+s.cz*dz,disc=b*b-(s.cx*s.cx+s.cy*s.cy+s.cz*s.cz-(R-2000)**2);if(disc>=0){const t=-b-Math.sqrt(disc);if(t>0&&t<len)return null;}}
  }else{v.set(x,y,z).applyMatrix4(s.inv);x=v.x;y=v.y;z=v.z;}
  v.set(x,y,z).applyMatrix4(s.m);if(v.z<-1||v.z>1)return null;
  return {x:(v.x+1)/2*s.W,y:(1-v.y)/2*s.H,depth:v.z};
 }
 // Camera ray through a screen point, in world units.
 function ray(x,y){const {w:W,h:H}=size(),rc=new THREE.Raycaster();rc.setFromCamera(new THREE.Vector2(x/W*2-1,-(y/H)*2+1),d.camera);return rc;}
 function geoOf(p){
  if(kind()==='globe'){const g=ecefToGeo(p,R);return {lat:g.latitude,lon:g.longitude,alt:g.altitude};}
  const o=d.origin(),e=p.clone().applyMatrix4(frames(o).fwd),g=ecefToGeo(e,R);return {lat:g.latitude,lon:g.longitude,alt:g.altitude};
 }
 const meshes=()=>kind()==='globe'?d.globe.meshes:d.world;
 // Geographic point under a screen position. meshes:true also hits loaded 3D tiles (click picking).
 function pick(x,y,{surface=true}={}){
  const k=kind();
  if(k==='flat2d'){const s=d.state,{w:W,h:H}=size(),z=s.zoom,c=d.project(s.lat,s.lon,z),g=d.unproject(c.x+(x-W/2)/256,c.y+(y-H/2)/256,z);if(g.lat<-85.06||g.lat>85.06)return null;return {lat:g.lat,lon:((g.lon+540)%360)-180,alt:0};}
  const rc=ray(x,y);
  if(surface){const hit=rc.intersectObject(meshes(),true)[0];if(hit)return geoOf(hit.point);}
  if(k==='globe'){const r=R+(d.groundAlt?.()??0),o=rc.ray.origin,dir=rc.ray.direction,b=o.dot(dir),disc=b*b-(o.lengthSq()-r*r);if(disc<0)return null;const t=-b-Math.sqrt(disc);if(t<0)return null;return geoOf(o.clone().addScaledVector(dir,t));}
  const o=d.origin();if(!o)return null;const plane=new THREE.Plane(new THREE.Vector3(0,0,1),-(o.ground??0)),hit=rc.ray.intersectPlane(plane,new THREE.Vector3());return hit?geoOf(hit):null;
 }
 // Zoom on the same scale as the 2D map (256 px tiles), from the camera distance in 3D.
 function zoom(){
  const k=kind(),s=d.state;if(k==='flat2d')return s.zoom;if(k==='globe')return d.globe.getView().zoom;
  const t=d.orbit&&s.mode==='3d'?d.orbit.target:null,dist=t?d.camera.position.distanceTo(t):Math.max(1,d.camera.position.z-(d.origin()?.ground??0)),focal=size().h/(2*Math.tan(d.camera.fov*DEG/2));
  return Math.max(0,Math.min(24,Math.log2(C*Math.cos(s.lat*DEG)*focal/(256*Math.max(1,dist)))));
 }
 // Visible area: corners and edge midpoints picked on the ground (no tile meshes, cheap). Rays that miss
 // the ground (sky) widen the box around the centre by the horizon distance.
 function viewport(){
  const {w:W,h:H}=size(),pts=[],z=zoom();let miss=false;
  for(const [fx,fy]of [[0,0],[.5,0],[1,0],[1,.5],[1,1],[.5,1],[0,1],[0,.5],[.5,.5]]){const g=pick(fx*W,fy*H,{surface:false});if(g)pts.push(g);else miss=true;}
  const center=pick(W/2,H/2,{surface:false})??{lat:d.state.lat,lon:d.state.lon};
  if(!pts.length)return {south:-85,north:85,west:-180,east:180,zoom:z,center};
  let south=Math.min(...pts.map(p=>p.lat)),north=Math.max(...pts.map(p=>p.lat)),west=Math.min(...pts.map(p=>p.lon)),east=Math.max(...pts.map(p=>p.lon));
  if(east-west>180){const ls=pts.map(p=>p.lon<0?p.lon+360:p.lon);west=Math.min(...ls);east=Math.max(...ls)-360;if(west>180)west-=360;}
  // Ground visible to the horizon: on the globe the cap of angular radius acos(R / (R + h)); in the flat
  // 3D frame the tangent distance sqrt(2 R h).
  if(miss){const g=kind()==='globe',alt=g?d.globe.getView().altitude:Math.max(50,d.camera.position.z),hz=g?Math.acos(R/(R+Math.max(alt,50)))/DEG:Math.min(2.5e6,Math.sqrt(2*R*Math.max(alt,50)))/111320;
   south=Math.max(-85,Math.min(south,center.lat-hz));north=Math.min(85,Math.max(north,center.lat+hz));const hw=hz/Math.max(.05,Math.cos(center.lat*DEG));
   if(hw>=180){west=-180;east=180;}else{west=Math.min(west,center.lon-hw);east=Math.max(east,center.lon+hw);if(west<-180)west+=360;if(east>180)east-=360;}}
  return {south,north,west,east,zoom:z,center};
 }
 // Height of the loaded 3D surface at a point (vertical ray), or null when nothing is loaded there.
 function surfaceAt(lat,lon){
  if(kind()==='flat2d')return null;const top=world(lat,lon,9000);if(!top)return null;const from=top.clone(),to=world(lat,lon,-500).clone(),dir=to.sub(from).normalize();
  const hit=new THREE.Raycaster(from,dir,0,9600).intersectObject(meshes(),true)[0];return hit?geoOf(hit.point).alt:null;
 }
 // Line of sight between two points over the loaded 3D surface.
 function sight(a,b){
  if(kind()==='flat2d')return null;const pa=world(a.lat,a.lon,a.alt).clone(),pb=world(b.lat,b.lon,b.alt).clone(),dir=pb.clone().sub(pa),len=dir.length();
  // The first and last 2 m are the surfaces the points were picked on, not obstacles.
  const hits=new THREE.Raycaster(pa,dir.normalize(),2,Math.max(2,len-2)).intersectObject(meshes(),true);
  return hits.length?{visible:false,blockedAt:geoOf(hits[0].point),distance:hits[0].distance}:{visible:true};
 }
 return {kind,size,project,pick,viewport,zoom,surfaceAt,sight,begin,end};
}
