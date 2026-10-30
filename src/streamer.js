import {EventDispatcher,Group,Vector3,Matrix4} from 'three';
import {ResilientByteCache} from './cache.js';
import {ByteTransport} from './transport.js';
import {RocktreeSource} from './source.js';
import {buildAsset,disposeAsset} from './geometry.js';
import {intersectsRegion,intersectsColumn,containsRegion,geoToECEF} from './geo.js';
import {TileError,isAbort,aborted} from './errors.js';
const cpuTurn=()=>new Promise(resolve=>setTimeout(resolve,0));
function viewDirection(focus,value){
 if(!value)return null;
 const direction=new Vector3().copy(value),normal=focus.clone().normalize();
 direction.addScaledVector(normal,-direction.dot(normal));
 if(![direction.x,direction.y,direction.z].every(Number.isFinite))throw new TileError('invalid_focus','Invalid view direction');
 return direction.lengthSq()<1e-12?null:direction.normalize();
}
export class EarthHQStreaming extends EventDispatcher {
 constructor({renderer,cache,cacheName='earth-hq-cache-v1',cacheBytes=512*1024*1024,fetch,baseUrl,source,radiusMeters=70,retainRadiusMeters=150,concurrency=18,maxGpuBytes=512*1024*1024,maxResponseBytes,activationAltitudeMeters=2500,altitudeHysteresisMeters=500,previewRadiusMeters=0}={}){
  super();if(!Number.isFinite(radiusMeters)||radiusMeters<=0||!Number.isFinite(retainRadiusMeters)||retainRadiusMeters<radiusMeters||!Number.isInteger(concurrency)||concurrency<1||!Number.isFinite(maxGpuBytes)||maxGpuBytes<=0)throw new TileError('invalid_options','Invalid radius, retention, GPU budget or concurrency');
  if(!Number.isFinite(activationAltitudeMeters)||activationAltitudeMeters<=0||!Number.isFinite(altitudeHysteresisMeters)||altitudeHysteresisMeters<0)throw new TileError('invalid_options','Invalid automatic streaming altitude');
  if(!Number.isFinite(previewRadiusMeters)||previewRadiusMeters<0)throw new TileError('invalid_options','Invalid preview radius');
  this.previewRadiusMeters=previewRadiusMeters;this.previewWanted=new Map();this.previews=new Map();this.previewQueue=[];this.previewCursor=0;this.previewRemaining=new Map();this.previewForLeaf=new Map();this.previewFailed=new Set();
  this.capacityBlocked=false;
  this.localDiscoveryReady=false;
  this.terminalBurst=0;
  this.previewRetirable=new Set();
  this.previewPaths=new Map();this.visiblePreviewCount=0;
  this.activationAltitudeMeters=activationAltitudeMeters;this.altitudeHysteresisMeters=altitudeHysteresisMeters;this.altitudePaused=true;this.cameraAltitudeMeters=null;
  this.renderer=renderer;this.group=new Group();this.group.name='Earth HQ streaming';this.radiusMeters=radiusMeters;this.retainRadiusMeters=retainRadiusMeters;this.maxGpuBytes=maxGpuBytes;this.concurrency=concurrency;
  this.ownsCache=!cache&&!source;this.cache=cache??(!source?new ResilientByteCache({name:cacheName,maxBytes:cacheBytes}):null);
  this.ownsSource=!source;this.transport=source?.transport??new ByteTransport({cache:this.cache,fetch,concurrency,maxResponseBytes});this.source=source??new RocktreeSource({transport:this.transport,baseUrl});
  this.assets=new Map();this.wanted=new Map();this.failed=new Map();this.active=new Map();this.readyCount=0;this.creditCounts=new Map();this.gpuBytes=0;this.disposed=false;this.enabled=true;this.generation=0;this.pendingSpec=null;this.discovery=null;this.lastSpec=null;this.discoveryError=null;this.discovering=false;this.queryCount=0;this.initializing=null;this.planet=null;this.credits=new Map();this.emptyLeaves=0;this.disposing=null;
 }
 async start(){
  if(this.disposed)throw aborted();
  if(!this.initializing)this.initializing=(async()=>{
   const planet=await this.source.root();if(this.disposed)throw aborted();this.planet=planet;
   try{const credits=await this.source.copyrights(planet.epoch);if(this.disposed)throw aborted();this.credits=credits;}catch(error){if(isAbort(error))throw error;this.dispatchEvent({type:'warning',error,phase:'attribution'});}
   return planet;
  })().catch(error=>{this.initializing=null;throw error;});
  return this.initializing;
 }
 async requestRegion({latitude,longitude,focusECEF,radiusMeters=this.radiusMeters,viewDirectionECEF,viewHalfAngle=Math.PI,nearRadiusMeters=60,waitForCompletion=true}={}){
  if(!focusECEF&&(!Number.isFinite(latitude)||latitude< -90||latitude>90||!Number.isFinite(longitude)))throw new TileError('invalid_focus','Latitude or longitude invalid');
  const generation=++this.generation;
  await this.start();if(this.disposed)throw aborted();if(generation!==this.generation)return this.getCoverage();if(!Number.isFinite(radiusMeters)||!(radiusMeters>0))throw new TileError('invalid_options','HQ radius must be finite and positive');
  const focus=focusECEF?new Vector3().copy(focusECEF):geoToECEF(latitude,longitude,0,this.planet.radius);
  if(![focus.x,focus.y,focus.z].every(Number.isFinite)||focus.lengthSq()===0)throw new TileError('invalid_focus','Invalid globe focus');
  const normal=focus.clone().normalize(),direction=viewDirection(focus,viewDirectionECEF);
  if(!Number.isFinite(viewHalfAngle)||viewHalfAngle<=0||viewHalfAngle>Math.PI||!Number.isFinite(nearRadiusMeters)||nearRadiusMeters<0)throw new TileError('invalid_options','Invalid view angle or near radius');
  this.enabled=true;this.altitudePaused=false;
  const spec={focus:focus.normalize().multiplyScalar(this.planet.radius),normal,radius:radiusMeters,viewDirection:direction,viewHalfAngle,nearRadius:nearRadiusMeters,generation,at:Date.now()};this.lastSpec=spec;this.pendingSpec=spec;this.discovering=true;this.localDiscoveryReady=false;this.discoveryError=null;this.publish();this.pumpDiscovery();return waitForCompletion?this.waitForIdle():this.getCoverage();
 }
 update(camera,{focusECEF,radiusMeters=this.radiusMeters,viewDirectionECEF,viewHalfAngle=Math.PI,nearRadiusMeters=60}={}){
  if(this.disposed||!this.enabled||!this.planet)return;
  this.group.updateWorldMatrix(true,false);
  const position=camera.getWorldPosition(new Vector3()).applyMatrix4(new Matrix4().copy(this.group.matrixWorld).invert());
  if(![position.x,position.y,position.z].every(Number.isFinite)||position.lengthSq()===0)return;
  this.cameraAltitudeMeters=position.length()-this.planet.radius;
  const paused=this.cameraAltitudeMeters>this.activationAltitudeMeters+(this.altitudePaused?0:this.altitudeHysteresisMeters);
  if(paused){if(!this.altitudePaused){this.altitudePaused=true;this.generation++;this.pendingSpec=null;this.discovering=false;this.publish();}return;}
  const resumed=this.altitudePaused;this.altitudePaused=false;
  const focus=focusECEF?new Vector3().copy(focusECEF):position;
  if(focus.lengthSq()===0)return;focus.normalize().multiplyScalar(this.planet.radius);
  const direction=viewDirection(focus,viewDirectionECEF);
  const turned=direction&&(!this.lastSpec?.viewDirection||direction.dot(this.lastSpec.viewDirection)<Math.cos(Math.PI/30));
  const refreshDue=this.lastSpec&&Date.now()-this.lastSpec.at>60000&&!this.discovery&&!this.pendingSpec&&this.active.size===0;
  if(resumed||!this.lastSpec||this.lastSpec.focus.distanceTo(focus)>Math.max(2,Math.min(20,radiusMeters*.08))||this.lastSpec.radius!==radiusMeters||this.lastSpec.viewHalfAngle!==viewHalfAngle||this.lastSpec.nearRadius!==nearRadiusMeters||!!direction!==!!this.lastSpec.viewDirection||turned||refreshDue){this.requestRegion({focusECEF:focus,radiusMeters,viewDirectionECEF:direction,viewHalfAngle,nearRadiusMeters,waitForCompletion:false}).catch(error=>{if(!isAbort(error))this.dispatchEvent({type:'error',error});});}
 }
 async pumpDiscovery(){
  if(this.discovery||this.disposed)return;
  this.discovery=(async()=>{
   while(this.pendingSpec&&!this.disposed){const spec=this.pendingSpec;this.pendingSpec=null;
    try{
     if(this.queryCount++>0)this.planet=await this.source.root();
     // Load a small set of real parent meshes before the expensive terminal
     // inventory. These never count as completed maximum-detail coverage.
     this.tileQueue=[];this.tileCursor=0;
     let localInventory=null,nearRoots=[];
     if(this.previewRadiusMeters>0&&spec.radius>this.previewRadiusMeters){
      const previews=new Map(),nearTerminals=[];
      const selectPreview=node=>{
       if(node.empty)return false;
       if(!node.root&&!intersectsColumn(node,spec.normal,spec.radius))return false;
       if(node.leaf){if(intersectsColumn(node,spec.normal,spec.nearRadius))nearTerminals.push(node);return false;}
       const previewSize=node.root?this.previewRadiusMeters:this.previewRadiusMeters+Math.max(0,node.center.distanceTo(spec.focus)-node.radius-spec.nearRadius)/6;
       if(node.hasData&&node.radius<=previewSize){previews.set(node.key,node);return false;}
       return true;
      };
      await this.walkMetadata([{root:true,epoch:this.planet.epoch}],spec.generation,selectPreview);
      if(this.disposed||spec.generation!==this.generation)continue;
      this.previewWanted=previews;nearRoots=[...previews.values()].filter(node=>intersectsColumn(node,spec.normal,spec.nearRadius)).concat(nearTerminals);this.previewRemaining.clear();this.previewForLeaf.clear();this.previewRetirable.clear();this.previewFailed.clear();
      for(const [key,asset]of this.previews)if(asset.expiresAt<=Date.now()||asset.rootEpoch!==this.planet.epoch||!intersectsColumn(asset.descriptor,spec.normal,Math.max(this.retainRadiusMeters,spec.radius)))this.unload(key);
      this.previewQueue=[...previews.values()].sort((a,b)=>a.center.distanceToSquared(spec.focus)-b.center.distanceToSquared(spec.focus));this.previewCursor=0;this.pumpTiles();
     }else{
      this.previewWanted.clear();this.previewQueue=[];this.previewRemaining.clear();this.previewForLeaf.clear();this.previewRetirable.clear();for(const key of this.previews.keys())this.unload(key);
     }
     if(this.previewRadiusMeters>0&&spec.radius>this.previewRadiusMeters){
      // Examine whole nearby parent footprints in every direction, so their
      // coarse geometry can retire without waiting for the distant sector.
      const localSpec={...spec,radius:Math.min(spec.radius,spec.nearRadius),viewDirection:null},local=await this.collectLeaves(localSpec,nearRoots,true);
      if(this.disposed||spec.generation!==this.generation)continue;
      localInventory=local;
      this.installInventory(local,localSpec,false,nearRoots);
     }
     const inventory=await this.collectLeaves(spec);
     if(this.disposed||spec.generation!==this.generation)continue;
     // Keep the full near footprints demanded until they are refined, even
     // when the final directional sector excludes some of their descendants.
     if(localInventory)for(const [key,node]of localInventory.desired)inventory.desired.set(key,node);
     this.installInventory(inventory,spec,true);
    }catch(error){if(this.disposed||spec.generation!==this.generation)continue;this.discovering=false;this.discoveryError=error;this.dispatchEvent({type:'error',error,phase:'metadata'});this.publish();}
   }
  })().finally(()=>{this.discovery=null;if(this.pendingSpec&&!this.disposed)this.pumpDiscovery();this.publish();});
 }
 async walkMetadata(roots,generation,visit){
  const queue=[...roots],active=new Set(),limit=this.concurrency;let failure=null,visited=0;
  const current=()=>!this.disposed&&generation===this.generation;
  try{
   while((queue.length||active.size)&&current()&&!failure){
    while(queue.length&&active.size<limit&&current()&&!failure){
     const node=queue.pop();
     if(visit(node)){
      const task=(async()=>{const children=await this.source.children(node);if(current()&&!failure)queue.push(...children);})().catch(error=>{failure??=error;}).finally(()=>active.delete(task));
      active.add(task);
     }
     if(++visited%512===0)await cpuTurn();
    }
    if(active.size)await Promise.race(active);
   }
  }finally{await Promise.allSettled([...active]);}
  if(failure)throw failure;
 }
 async collectLeaves(spec,roots=[{root:true,epoch:this.planet.epoch}],wholeSubtrees=false){
  const desired=new Map();let empty=0;
  await this.walkMetadata(roots,spec.generation,node=>{
   if(node.empty){empty++;return false;}
   if(!wholeSubtrees&&!node.root&&!intersectsRegion(node,spec))return false;
   if(node.leaf){if(node.hasData)desired.set(node.key,node);return false;}
   return true;
  });return {desired,empty};
 }
 installInventory({desired,empty},spec,final,wholeParents=[]){
  this.wanted=desired;this.readyCount=0;for(const key of desired.keys())if(this.assets.has(key))this.readyCount++;this.tileQueue=[...desired.values()];this.tileCursor=0;this.committedSpec=spec;this.emptyLeaves=empty;this.failed.clear();this.capacityBlocked=false;this.discoveryError=null;this.discovering=!final;this.localDiscoveryReady=!final;
  // A completed local footprint is evidence even while the global inventory
  // is still being discovered. A later view sector must not erase that proof.
  const coveredParents=new Map([...this.previewWanted.values()].filter(node=>containsRegion(node,spec)).map(node=>[node.path,node.key]));
  for(const parent of wholeParents)if(this.previewWanted.has(parent.key))coveredParents.set(parent.path,parent.key);
  for(const key of coveredParents.values()){this.previewRetirable.add(key);this.previewRemaining.set(key,0);}
  for(const node of desired.values())for(let length=node.path.length-1;length>0;length--){const parent=coveredParents.get(node.path.slice(0,length));if(parent){this.previewForLeaf.set(node.key,parent);if(!this.assets.has(node.key))this.previewRemaining.set(parent,this.previewRemaining.get(parent)+1);break;}}
  // Finish one nearby parent at a time: scattered HQ leaves cannot replace
  // the coarse parent until its entire footprint has finished downloading.
  const priority=node=>(this.previewWanted.get(this.previewForLeaf.get(node.key))??node).center.distanceToSquared(spec.focus);
  this.tileQueue.sort((a,b)=>priority(a)-priority(b)||a.center.distanceToSquared(spec.focus)-b.center.distanceToSquared(spec.focus));
  const paths=new Map([...desired.values()].map(n=>[n.path,n.key]));
  for(const [key,asset]of this.assets){const samePath=paths.get(asset.descriptor.path);if(asset.expiresAt<=Date.now()||(samePath&&samePath!==key)||(!desired.has(key)&&asset.rootEpoch!==this.planet.epoch))this.unload(key);else if(!desired.has(key)&&!intersectsColumn(asset.descriptor,spec.normal,Math.max(this.retainRadiusMeters,spec.radius)))this.unload(key);else if(desired.has(key))asset.rootEpoch=this.planet.epoch;}
  for(const [key,remaining]of this.previewRemaining)if(remaining===0&&this.previewRetirable.has(key))this.setPreviewVisible(key,false);
  this.pumpTiles();this.publish();
 }
 nextTerminal(){while(this.tileCursor<this.tileQueue?.length){const node=this.tileQueue[this.tileCursor++];if(!this.assets.has(node.key)&&!this.active.has(node.key)&&!this.failed.has(node.key))return node;}return null;}
 nextPreview(){
  while(this.previewCursor<this.previewQueue.length){
   const candidate=this.previewQueue[this.previewCursor];
   this.previewCursor++;
   if(this.previewWanted.has(candidate.key)&&!this.previews.has(candidate.key)&&!this.active.has(candidate.key)&&!this.previewFailed.has(candidate.key)&&!(this.previewRetirable.has(candidate.key)&&this.previewRemaining.get(candidate.key)===0))return candidate;
  }
  return null;
 }
 pumpTiles(){
  if(this.disposed||!this.enabled||this.altitudePaused||this.capacityBlocked)return;
  while(this.active.size<this.concurrency){
   const terminalsReady=!this.discovering||this.localDiscoveryReady;
   let node=terminalsReady&&this.terminalBurst<3?this.nextTerminal():null,preview=false;
   if(!node){node=this.nextPreview();preview=!!node;}
   if(!node&&terminalsReady)node=this.nextTerminal();if(!node)break;
   this.terminalBurst=preview?0:Math.min(3,this.terminalBurst+1);
   const task=this.loadTile(node,preview).finally(()=>{this.active.delete(node.key);this.pumpTiles();this.publish();});this.active.set(node.key,task);
  }
 }
 async loadTile(node,preview=false){
  let asset;
  try{
   const decoded=await this.source.loadNode(node);if(this.disposed||!this.enabled||this.altitudePaused)return;
   await cpuTurn();if(this.disposed||!this.enabled||this.altitudePaused)return;
   asset=await buildAsset(decoded,node,this.renderer);
   if(this.disposed||!this.enabled||this.altitudePaused||!(preview?this.previewWanted:this.wanted).has(node.key)){disposeAsset(asset);return;}
   if(this.gpuBytes+asset.gpuBytes>this.maxGpuBytes)for(const [key,previewAsset]of this.previews){if(!previewAsset.group.visible)this.unload(key);if(this.gpuBytes+asset.gpuBytes<=this.maxGpuBytes)break;}
   if(this.gpuBytes+asset.gpuBytes>this.maxGpuBytes)for(const key of this.assets.keys()){if(!this.wanted.has(key))this.unload(key);if(this.gpuBytes+asset.gpuBytes<=this.maxGpuBytes)break;}
   if(this.gpuBytes+asset.gpuBytes>this.maxGpuBytes){if(!preview)this.capacityBlocked=true;throw new TileError('gpu_budget','GPU budget cannot hold every requested HQ leaf',{path:node.path,budget:this.maxGpuBytes,requiredNext:this.gpuBytes+asset.gpuBytes});}
   asset.expiresAt=this.transport.getExpiry?.(node.key)??Infinity;asset.rootEpoch=this.planet.epoch;
   if(preview){this.previews.set(node.key,asset);this.previewPaths.set(node.path,node.key);asset.group.visible=!(this.previewRetirable.has(node.key)&&this.previewRemaining.get(node.key)===0);if(asset.group.visible)this.visiblePreviewCount++;asset.group.traverse(mesh=>{if(mesh.isMesh){mesh.material.polygonOffset=true;mesh.material.polygonOffsetFactor=1;mesh.material.polygonOffsetUnits=1;}});}
   else{this.assets.set(node.key,asset);this.readyCount++;const parent=this.previewForLeaf.get(node.key);if(parent){const remaining=this.previewRemaining.get(parent)-1;this.previewRemaining.set(parent,remaining);if(remaining===0&&this.previewRetirable.has(parent))this.setPreviewVisible(parent,false);}}
   for(const id of asset.copyrightIds)this.creditCounts.set(id,(this.creditCounts.get(id)??0)+1);this.group.add(asset.group);this.gpuBytes+=asset.gpuBytes;this.dispatchEvent({type:preview?'preview-load':'tile-load',asset});
  }catch(error){if(asset&&!(preview?this.previews:this.assets).has(node.key))disposeAsset(asset);if(this.disposed||isAbort(error)||!(preview?this.previewWanted:this.wanted).has(node.key))return;if(preview){this.previewFailed.add(node.key);this.dispatchEvent({type:'warning',error,phase:'preview',node});}else{this.failed.set(node.key,error);this.dispatchEvent({type:'error',error,phase:'tile',node});}}
 }
 setPreviewVisible(key,visible){const asset=this.previews.get(key);if(asset&&asset.group.visible!==visible){asset.group.visible=visible;this.visiblePreviewCount+=visible?1:-1;}}
 unload(key){const preview=this.previews.has(key),asset=(preview?this.previews:this.assets).get(key);if(!asset)return;this.dispatchEvent({type:preview?'preview-unload':'tile-unload',asset});(preview?this.previews:this.assets).delete(key);if(preview){if(asset.group.visible)this.visiblePreviewCount--;if(this.previewPaths.get(asset.descriptor.path)===key)this.previewPaths.delete(asset.descriptor.path);}else{for(let length=asset.descriptor.path.length-1;length>0;length--){const parent=this.previewPaths.get(asset.descriptor.path.slice(0,length));if(parent){this.setPreviewVisible(parent,true);break;}}}if(!preview){if(this.wanted.has(key))this.readyCount--;const parent=this.previewForLeaf.get(key);if(parent)this.previewRemaining.set(parent,(this.previewRemaining.get(parent)??0)+1);}for(const id of asset.copyrightIds){const count=(this.creditCounts.get(id)??0)-1;if(count>0)this.creditCounts.set(id,count);else this.creditCounts.delete(id);}this.gpuBytes-=asset.gpuBytes;disposeAsset(asset);}
 getCoverage(){
  const ready=this.readyCount;
  const complete=!this.disposed&&this.enabled&&!this.altitudePaused&&!this.discovering&&!this.pendingSpec&&!this.discoveryError&&this.failed.size===0&&ready===this.wanted.size&&!!this.lastSpec;
  return {status:this.disposed?'disposed':!this.enabled?'paused':this.altitudePaused?'waiting-altitude':this.discoveryError||this.failed.size?'incomplete':this.discovering?'discovering':complete?this.wanted.size?'complete':'no-data':'loading',complete,cameraAltitudeMeters:this.cameraAltitudeMeters,activationAltitudeMeters:this.activationAltitudeMeters,epoch:this.planet?.epoch??null,radiusMeters:this.lastSpec?.radius??this.radiusMeters,inventoryRadiusMeters:this.committedSpec?.radius??0,requiredLeaves:this.wanted.size,readyLeaves:ready,missingLeaves:this.wanted.size-ready,unknownBranches:this.discoveryError?1:0,failedLeaves:this.failed.size,declaredEmptyLeaves:this.emptyLeaves,residentLeaves:this.assets.size,previewTiles:this.visiblePreviewCount,residentPreviews:this.previews.size,previewRequired:this.previewWanted.size,gpuBytes:this.gpuBytes,errors:[...(this.discoveryError?[this.discoveryError]:[]),...this.failed.values()].map(e=>({code:e.code??'unavailable',message:e.message,details:e.details??{}})),cachePersistent:this.cache?.persistent??false,cacheWarning:this.cache?.warning??null,...this.transport?.stats};
 }
 getAttribution(){const counts=new Map();for(const [id,count]of this.creditCounts){const text=this.credits.get(id);if(text)counts.set(text,(counts.get(text)??0)+count);}return [...counts].sort((a,b)=>b[1]-a[1]).map(([text])=>text).join(' · ');}
 publish(){this.dispatchEvent({type:'progress',coverage:this.getCoverage()});}
 waitForIdle(timeoutMs=120000){if(this.disposed)return Promise.reject(aborted());return new Promise((resolve,reject)=>{let timer;const check=()=>{if(this.disposed){cleanup();reject(aborted());}else if(!this.discovery&&!this.discovering&&!this.pendingSpec&&this.active.size===0){const result=this.getCoverage();cleanup();resolve(result);}};const cleanup=()=>{clearTimeout(timer);this.removeEventListener('progress',check);};this.addEventListener('progress',check);timer=setTimeout(()=>{cleanup();reject(new TileError('timeout','HQ streaming has not settled',{coverage:this.getCoverage()}));},timeoutMs);check();});}
 regionOptions(){const s=this.lastSpec;return s?{focusECEF:s.focus,radiusMeters:s.radius,viewDirectionECEF:s.viewDirection,viewHalfAngle:s.viewHalfAngle,nearRadiusMeters:s.nearRadius}:{};}
 retryFailed(){this.failed.clear();this.discoveryError=null;if(this.lastSpec)return this.requestRegion(this.regionOptions());return Promise.resolve(this.getCoverage());}
 setGpuBudget(bytes){if(!(bytes>0))throw new TileError('invalid_options','GPU budget must be positive');this.maxGpuBytes=bytes;this.capacityBlocked=false;for(const[key,error]of this.failed)if(error.code==='gpu_budget')this.failed.delete(key);this.tileQueue=[...this.wanted.values()].sort((a,b)=>a.center.distanceToSquared(this.lastSpec.focus)-b.center.distanceToSquared(this.lastSpec.focus));this.tileCursor=0;this.pumpTiles();}
 setEnabled(enabled){if(this.enabled===!!enabled)return;this.enabled=!!enabled;if(!enabled){this.generation++;this.pendingSpec=null;this.discovering=false;}else if(this.lastSpec&&!this.altitudePaused)this.requestRegion({...this.regionOptions(),waitForCompletion:false}).catch(error=>{if(!isAbort(error))this.dispatchEvent({type:'error',error});});this.publish();}
 async dispose(){
  if(this.disposing)return this.disposing;this.disposed=true;this.generation++;this.pendingSpec=null;this.enabled=false;this.publish();
  this.disposing=(async()=>{if(this.ownsSource)await this.transport.dispose();await Promise.allSettled([...(this.discovery?[this.discovery]:[]),...this.active.values()]);for(const key of [...this.assets.keys(),...this.previews.keys()])this.unload(key);this.wanted.clear();this.previewWanted.clear();this.previewForLeaf.clear();this.previewRemaining.clear();this.previewRetirable.clear();this.previewQueue=[];this.failed.clear();if(this.ownsSource)this.source.clear();if(this.ownsCache)await this.cache.close();this.group.removeFromParent();this.publish();})();return this.disposing;
 }
}
