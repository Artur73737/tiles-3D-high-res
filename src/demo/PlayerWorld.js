import {Vector3,Matrix4,BufferGeometry,BufferAttribute,Box3} from 'three';
import {Capsule} from 'three/addons/math/Capsule.js';
import {CollisionWorld} from './CollisionWorld.js';
import {intersectsColumn} from '../geo.js';
export class PlayerWorld {
 constructor(streamer){this.streamer=streamer;this.frame=null;this.center=new Vector3();this.localNormal=null;this.nearAssets=new Map();this.nearRequired=new Map();this.requiredInventory=null;this.collisions=new Map();this.colliderMasks=new Map();this.empty=new Set();this.scratch=new Capsule();this.box=new Box3();this.dirty=true;this.onLoad=({asset})=>{if(this.localNormal&&intersectsColumn(asset.descriptor,this.localNormal,24)){this.nearAssets.set(asset.descriptor.key,asset);this.dirty=true;}};this.onUnload=({asset})=>{this.dirty=true;this.nearAssets.delete(asset.descriptor.key);this.remove(asset.descriptor.key);};streamer.addEventListener('tile-load',this.onLoad);streamer.addEventListener('tile-unload',this.onUnload);}
 setFrame(frame){for(const key of [...this.collisions.keys()])this.remove(key);this.empty.clear();this.frame=frame;this.center.set(Infinity,Infinity,Infinity);this.localNormal=null;this.nearAssets.clear();this.nearRequired.clear();this.requiredInventory=null;this.dirty=true;}
 remove(key){const c=this.collisions.get(key);if(c)c.geometry.dispose();this.collisions.delete(key);this.empty.delete(key);this.colliderMasks.delete(key);}
 refresh(feet,{all=false}={}){
  if(!this.frame)return;
  const inventory=this.streamer.collisionInventory??this.streamer.wanted;
  const demandChanged=this.requiredInventory!==inventory;
  const moved=this.center.distanceTo(feet)>3;
  if(moved||demandChanged){this.center.copy(feet);this.localNormal=feet.clone().applyMatrix4(this.frame.toECEF).normalize();this.nearAssets.clear();for(const [key,asset]of this.streamer.assets)if(inventory.has(key)&&intersectsColumn(asset.descriptor,this.localNormal,24))this.nearAssets.set(key,asset);this.dirty=true;}
  if(moved||demandChanged){this.requiredInventory=inventory;this.nearRequired.clear();for(const [key,node]of this.requiredInventory)if(intersectsColumn(node,this.localNormal,24))this.nearRequired.set(key,node);}
  for(const [key,asset]of this.nearAssets)if(this.colliderMasks.get(key)!==asset.mask)this.dirty=true;
  if(!this.dirty)return;
  const wanted=new Set(),begin=performance.now();let remaining=false;
  for(const[key,asset]of this.nearAssets){
   if(!inventory.has(key))continue;
   wanted.add(key);if(this.colliderMasks.get(key)===asset.mask&&(this.collisions.has(key)||this.empty.has(key)))continue;this.remove(key);
   if(!all&&performance.now()-begin>5){remaining=true;continue;}
   const transform=new Matrix4().multiplyMatrices(this.frame.fromECEF,asset.group.matrix),geometries=[];
   for(const mesh of asset.meshes??asset.group.children){
    if(mesh.geometry.drawRange.count===0)continue;
    const source=mesh.geometry.attributes.position,p=new Float32Array(source.count*3),v=new Vector3();
    for(let i=0;i<source.count;i++){v.fromBufferAttribute(source,i).applyMatrix4(transform);v.toArray(p,i*3);}
    const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(p,3));const octants=mesh.geometry.userData.octants;geometry.setIndex(octants?octants.flatMap((values,i)=>asset.mask&(1<<i)?Array.from(values):[]):new BufferAttribute(mesh.geometry.index.array.slice(0,mesh.geometry.drawRange.count),1));geometries.push(geometry);
   }
   if(geometries.length){this.collisions.set(key,new CollisionWorld(geometries));for(const g of geometries)g.dispose();}else this.empty.add(key);this.colliderMasks.set(key,asset.mask);
  }
  for(const key of [...this.collisions.keys()])if(!wanted.has(key))this.remove(key);
  for(const key of [...this.empty])if(!wanted.has(key))this.empty.delete(key);
  this.dirty=remaining;
 }
 readyAt(point){
  if(!this.frame||!this.streamer.committedSpec)return false;
  this.refresh(point);
  const ecef=point.clone().applyMatrix4(this.frame.toECEF),normal=ecef.normalize(),spec=this.streamer.committedSpec;
  const lateral=spec.focus.clone().sub(normal.clone().multiplyScalar(spec.focus.dot(normal))).length();
  if(lateral>spec.radius-3)return false;
  if(spec.cameraView&&lateral>Math.max(0,(spec.collisionRadius??0)-3)){
   // Outside an explicitly requested walking disk, the whole capsule must lie in
   // the examined frustum. Off-screen absence is not evidence of empty ground.
   const feet=point.clone().applyMatrix4(this.frame.toECEF),eye=feet.clone().addScaledVector(this.frame.up,1.72);
   if(spec.cameraView.frustum.planes.some(plane=>plane.distanceToPoint(feet)<.28||plane.distanceToPoint(eye)<.28))return false;
  }
  for(const[key,node]of this.nearRequired)if(intersectsColumn(node,normal,1)&&(!this.streamer.assets.has(key)||(!this.collisions.has(key)&&!this.empty.has(key))))return false;
  return true;
 }
 rayIntersect(ray){let best=false;for(const c of this.collisions.values()){if(!ray.intersectsBox(c.geometry.boundingBox))continue;const hit=c.rayIntersect(ray);if(hit&&(!best||hit.distance<best.distance))best=hit;}return best;}
 capsuleIntersect(capsule){this.scratch.copy(capsule);this.box.makeEmpty().expandByPoint(capsule.start).expandByPoint(capsule.end).expandByScalar(capsule.radius);for(const c of this.collisions.values()){if(!this.box.intersectsBox(c.geometry.boundingBox))continue;const hit=c.capsuleIntersect(this.scratch);if(hit)this.scratch.translate(hit.normal.multiplyScalar(hit.depth));}const d=this.scratch.start.clone().sub(capsule.start),depth=d.length();return depth>1e-8?{normal:d.multiplyScalar(1/depth),depth}:false;}
 dispose(){for(const key of [...this.collisions.keys()])this.remove(key);this.empty.clear();this.nearAssets.clear();this.nearRequired.clear();this.streamer.removeEventListener('tile-load',this.onLoad);this.streamer.removeEventListener('tile-unload',this.onUnload);}
}
