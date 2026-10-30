// Satellite imagery shares the provider and bundle with the 3D engine, while
// keeping its own selection, request queue and resource ownership.
import * as THREE from 'three';
import {geoToECEF} from './geo.js';
import {TileError} from './errors.js';

export const SATELLITE_SERVICE='https://mt1.google.com/vt';
const latitude=y=>Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI;
export function satelliteBounds(z,x,y){const n=2**z;return {west:x/n*360-180,east:(x+1)/n*360-180,north:latitude(y/n),south:latitude((y+1)/n)};}

export class SatelliteLayer {
 constructor({renderer,radius=6370890,concurrency=8,maxTiles=512,maxZoom=22,fetch:fetcher=globalThis.fetch.bind(globalThis)}={}){
  if(!Number.isFinite(radius)||radius<=0||!Number.isInteger(concurrency)||concurrency<1||!Number.isInteger(maxTiles)||maxTiles<concurrency||!Number.isInteger(maxZoom)||maxZoom<3||maxZoom>30)throw new TileError('invalid_options','Invalid satellite layer options');
  this.renderer=renderer;this.radius=radius;this.concurrency=concurrency;this.maxTiles=maxTiles;this.fetch=fetcher;
  this.group=new THREE.Group();this.group.name='Satellite 2D';
  this.nodes=new Map();this.resident=new Map();this.active=new Map();this.needed=new Set();this.queue=[];this.failed=new Map();
  this.maxZoom=maxZoom;this.tileSize=256;this.credits='';
  this.lastUpdate=-Infinity;this.disposed=false;this.requests=0;this.targetZoom=3;this.error=null;
  this.frustum=new THREE.Frustum();this.matrix=new THREE.Matrix4();this.cameraPosition=new THREE.Vector3();
 }
 node(z,x,y){
  const key=`${z}/${x}/${y}`;if(this.nodes.has(key))return this.nodes.get(key);
  const bounds=satelliteBounds(z,x,y),lat=(bounds.north+bounds.south)/2,lon=(bounds.west+bounds.east)/2,center=geoToECEF(lat,lon,0,this.radius);
  const angle=Math.min(Math.PI,THREE.MathUtils.degToRad((bounds.north-bounds.south+bounds.east-bounds.west)/2));
  const node={key,z,x,y,bounds,lat,center,sphere:new THREE.Sphere(center,2*this.radius*Math.sin(angle/2)),metersPerTexel:2*Math.PI*this.radius*Math.cos(lat*Math.PI/180)/(2**z*256)};
  this.nodes.set(key,node);return node;
 }
 update(camera){
  if(this.disposed||performance.now()-this.lastUpdate<160)return;this.lastUpdate=performance.now();
  camera.updateWorldMatrix(true,false);camera.getWorldPosition(this.cameraPosition);this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.matrix);
  const distance=this.cameraPosition.length(),normal=this.cameraPosition.clone().normalize(),altitude=Math.max(10,distance-this.radius),horizon=this.radius*this.radius/distance;
  const drawingSize=this.renderer.getDrawingBufferSize(new THREE.Vector2()),pixelScale=drawingSize.y/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)));
  const needed=new Set();let targetZoom=3;
  const visit=node=>{
   if(node.z>0&&(node.center.dot(normal)+node.sphere.radius<horizon||!this.frustum.intersectsSphere(node.sphere)))return;
   if(node.z>=3){needed.add(node.key);targetZoom=Math.max(targetZoom,node.z);}
   if((node.missingUntil??0)>Date.now())return;
   const range=Math.max(altitude,this.cameraPosition.distanceTo(node.center)-node.sphere.radius);
   if(node.z<this.maxZoom&&(node.z<3||node.metersPerTexel*pixelScale/range>.9)){
    for(let y=0;y<2;y++)for(let x=0;x<2;x++)visit(this.node(node.z+1,node.x*2+x,node.y*2+y));
   }
  };
  visit(this.node(0,0,0));this.needed=needed;this.targetZoom=targetZoom;
  for(const [key,record]of this.resident){record.mesh.visible=needed.has(key);if(record.mesh.visible)record.used=performance.now();}
  for(const [key,task]of this.active)if(!needed.has(key))task.controller.abort();
  this.queue=[...needed].map(key=>this.nodes.get(key)).filter(node=>!this.resident.has(node.key)&&!this.active.has(node.key)&&(this.failed.get(node.key)??0)<Date.now()).sort((a,b)=>a.z-b.z||this.cameraPosition.distanceToSquared(a.center)-this.cameraPosition.distanceToSquared(b.center));
  // Keep parent coverage while finer tiles arrive; only off-view records are LRU.
  for(const [key]of this.nodes)if(!needed.has(key)&&!this.resident.has(key)&&!this.active.has(key))this.nodes.delete(key);
  for(const key of this.failed.keys())if(!this.nodes.has(key))this.failed.delete(key);
  this.pump();
 }
 pump(){
  if(this.disposed)return;
  while(this.active.size<this.concurrency&&this.queue.length){
   if(this.resident.size+this.active.size>=this.maxTiles){
    let oldest=null;for(const [key,record]of this.resident)if(!this.needed.has(key)&&(!oldest||record.used<oldest[1].used))oldest=[key,record];
    if(!oldest)break;this.release(oldest[0]);
   }
   const node=this.queue.shift();if(!this.needed.has(node.key)||this.resident.has(node.key)||this.active.has(node.key))continue;
   const controller=new AbortController(),task=this.load(node,controller.signal).finally(()=>{this.active.delete(node.key);this.pump();});this.active.set(node.key,{task,controller});
  }
 }
 async load(node,signal){
  let bitmap=null,mesh=null;const timeout=setTimeout(()=>{this.active.get(node.key)?.controller.abort();},15000);
  try{
   this.requests++;const response=await this.fetch(`${SATELLITE_SERVICE}?lyrs=s&x=${node.x}&y=${node.y}&z=${node.z}`,{signal,credentials:'omit'});
   if(response.status===404||response.status===204){node.missingUntil=Date.now()+300000;this.failed.set(node.key,node.missingUntil);return;}
   if(!response.ok)throw Error('Tile satellitare: HTTP '+response.status);
   const blob=await response.blob();if(blob.size>2*1024**2)throw Error('Tile satellitare troppo grande');bitmap=await createImageBitmap(blob,{imageOrientation:'flipY'});
   if(bitmap.width!==256||bitmap.height!==256)throw Error('Dimensioni della tile satellitare non valide');
   if(this.disposed||signal.aborted||!this.needed.has(node.key))return;
   mesh=this.build(node,bitmap);this.resident.set(node.key,{mesh,used:performance.now(),node});this.group.add(mesh);this.failed.delete(node.key);
  }catch(error){if(!this.disposed&&this.needed.has(node.key)){this.failed.set(node.key,Date.now()+30000);if(error.name!=='AbortError')this.error=error.message;}}
  finally{clearTimeout(timeout);if(!mesh)bitmap?.close();}
 }
 build(node,bitmap){
  const segments=Math.max(4,Math.ceil(64/2**node.z)),positions=[],uv=[],indices=[],n=2**node.z;
  for(let row=0;row<=segments;row++)for(let col=0;col<=segments;col++){
   const u=col/segments,v=row/segments,lat=latitude((node.y+v)/n),lon=(node.x+u)/n*360-180;
   const point=geoToECEF(lat,lon,0,this.radius).sub(node.center);positions.push(point.x,point.y,point.z);uv.push(u,1-v);
  }
  for(let row=0;row<segments;row++)for(let col=0;col<segments;col++){const a=row*(segments+1)+col,b=a+1,c=a+segments+1,d=c+1;indices.push(a,c,b,b,c,d);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeBoundingSphere();
  const texture=new THREE.Texture(bitmap);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());texture.needsUpdate=true;
  const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.FrontSide,depthTest:false,depthWrite:true});
  const mesh=new THREE.Mesh(geometry,material);mesh.position.copy(node.center);mesh.renderOrder=-1000+node.z;mesh.matrixAutoUpdate=false;mesh.updateMatrix();return mesh;
 }
 release(key){const record=this.resident.get(key);if(!record)return;record.mesh.removeFromParent();record.mesh.geometry.dispose();record.mesh.material.map.image.close();record.mesh.material.map.dispose();record.mesh.material.dispose();this.resident.delete(key);}
 status(){let readyZoom=0,visible=0;for(const record of this.resident.values())if(record.mesh.visible){visible++;readyZoom=Math.max(readyZoom,record.node.z);}return {targetZoom:this.targetZoom,readyZoom,visible,resident:this.resident.size,pending:this.active.size,queued:this.queue.length,requests:this.requests,error:this.error};}
 getAttribution(){return this.credits;}
 async dispose(){this.disposed=true;for(const task of this.active.values())task.controller.abort();await Promise.allSettled([...this.active.values()].map(t=>t.task));for(const key of this.resident.keys())this.release(key);this.nodes.clear();this.failed.clear();this.queue=[];this.group.removeFromParent();}
}
