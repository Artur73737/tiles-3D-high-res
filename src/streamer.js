import {EventDispatcher,Group,Vector3,Matrix4,Frustum,Vector2} from 'three';
import {ResilientByteCache} from './cache.js';
import {ByteTransport} from './transport.js';
import {RocktreeSource} from './source.js';
import {buildAsset,disposeAsset} from './geometry.js';
import {intersectsRegion,intersectsColumn,containsRegion,geoToECEF,nearestNodePoint,nodeInFrustum} from './geo.js';
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
 constructor({renderer,cache,cacheName='earth-hq-cache-v1',cacheBytes=512*1024*1024,fetch,baseUrl,source,radiusMeters=70,retainRadiusMeters=150,concurrency=18,maxGpuBytes=512*1024*1024,maxResponseBytes,activationAltitudeMeters=2500,altitudeHysteresisMeters=500,previewRadiusMeters=0,screenSpaceError=0}={}){
  super();if(!Number.isFinite(radiusMeters)||radiusMeters<=0||!Number.isFinite(retainRadiusMeters)||retainRadiusMeters<radiusMeters||!Number.isInteger(concurrency)||concurrency<1||!Number.isFinite(maxGpuBytes)||maxGpuBytes<=0)throw new TileError('invalid_options','Invalid radius, retention, GPU budget or concurrency');
  if(!Number.isFinite(activationAltitudeMeters)||activationAltitudeMeters<=0||!Number.isFinite(altitudeHysteresisMeters)||altitudeHysteresisMeters<0)throw new TileError('invalid_options','Invalid automatic streaming altitude');
  if(!Number.isFinite(previewRadiusMeters)||previewRadiusMeters<0)throw new TileError('invalid_options','Invalid preview radius');
  if(!Number.isFinite(screenSpaceError)||screenSpaceError<0)throw new TileError('invalid_options','Invalid screen-space error');
  this.screenSpaceError=screenSpaceError;this.cameraView=null;this.viewTree=new Map();this.viewChildren=new Map();this.viewCut=null;this.collisionInventory=null;this.viewMaskDirty=false;this.viewQualityDirty=false;this.refinedPaths=new Set();
  this.previewRadiusMeters=previewRadiusMeters;this.previewWanted=new Map();this.previews=new Map();this.previewQueue=[];this.previewCursor=0;this.previewRemaining=new Map();this.previewForLeaf=new Map();this.previewFailed=new Set();
  this.capacityBlocked=false;
  this.localDiscoveryReady=false;
  this.terminalBurst=0;this.priorityView=null;
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
   const planet=await this.source.root();if(this.disposed)throw aborted();this.planet=planet;this.rootReadAt=Date.now();
   try{const credits=await this.source.copyrights(planet.epoch);if(this.disposed)throw aborted();this.credits=credits;}catch(error){if(isAbort(error))throw error;this.dispatchEvent({type:'warning',error,phase:'attribution'});}
   return planet;
  })().catch(error=>{this.initializing=null;throw error;});
  return this.initializing;
 }
 async requestRegion({latitude,longitude,focusECEF,radiusMeters=this.radiusMeters,viewDirectionECEF,viewHalfAngle=Math.PI,nearRadiusMeters=60,waitForCompletion=true,cameraView=null}={}){
  if(!focusECEF&&(!Number.isFinite(latitude)||latitude< -90||latitude>90||!Number.isFinite(longitude)))throw new TileError('invalid_focus','Latitude or longitude invalid');
  const generation=++this.generation;
  await this.start();if(this.disposed)throw aborted();if(generation!==this.generation)return this.getCoverage();if(!Number.isFinite(radiusMeters)||!(radiusMeters>0))throw new TileError('invalid_options','HQ radius must be finite and positive');
  const focus=focusECEF?new Vector3().copy(focusECEF):geoToECEF(latitude,longitude,0,this.planet.radius);
  if(![focus.x,focus.y,focus.z].every(Number.isFinite)||focus.lengthSq()===0)throw new TileError('invalid_focus','Invalid globe focus');
  const normal=focus.clone().normalize(),direction=viewDirection(focus,viewDirectionECEF);
  if(!Number.isFinite(viewHalfAngle)||viewHalfAngle<=0||viewHalfAngle>Math.PI||!Number.isFinite(nearRadiusMeters)||nearRadiusMeters<0)throw new TileError('invalid_options','Invalid view angle or near radius');
  this.enabled=true;this.altitudePaused=false;
  const spec={cameraView,focus:focus.normalize().multiplyScalar(this.planet.radius),normal,radius:radiusMeters,viewDirection:direction,viewHalfAngle,nearRadius:nearRadiusMeters,generation,at:Date.now()};this.lastSpec=spec;this.pendingSpec=spec;this.discovering=true;this.localDiscoveryReady=false;this.discoveryError=null;this.failed.clear();this.capacityBlocked=false;this.publish();this.pumpDiscovery();return waitForCompletion?this.waitForIdle():this.getCoverage();
 }
 update(camera,{focusECEF,radiusMeters=this.radiusMeters,viewDirectionECEF,viewHalfAngle=Math.PI,nearRadiusMeters=60}={}){
  if(this.disposed||!this.enabled||!this.planet)return;
  this.group.updateWorldMatrix(true,false);
  const inverse=new Matrix4().copy(this.group.matrixWorld).invert();
  const position=camera.getWorldPosition(new Vector3()).applyMatrix4(inverse);
  if(this.screenSpaceError>0){
   camera.updateMatrixWorld(true);const projection=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(this.group.matrixWorld);
   const width=this.renderer?.getDrawingBufferSize(new Vector2()).x??1080*camera.aspect;
   this.cameraView={position:position.clone(),direction:camera.getWorldDirection(new Vector3()).transformDirection(inverse),frustum:new Frustum().setFromProjectionMatrix(projection),pixelScale:width*camera.projectionMatrix.elements[0]/2};
  }
  if(this.viewMaskDirty)this.updateViewMasks();
  this.prioritizeView(position,camera.getWorldDirection(new Vector3()).transformDirection(inverse));
  if(![position.x,position.y,position.z].every(Number.isFinite)||position.lengthSq()===0)return;
  this.cameraAltitudeMeters=position.length()-this.planet.radius;
  const paused=this.cameraAltitudeMeters>this.activationAltitudeMeters+(this.altitudePaused?0:this.altitudeHysteresisMeters);
  if(paused){if(!this.altitudePaused){this.altitudePaused=true;this.generation++;this.pendingSpec=null;this.discovering=false;this.publish();}return;}
  const resumed=this.altitudePaused;this.altitudePaused=false;
  const focus=focusECEF?new Vector3().copy(focusECEF):position;
  if(focus.lengthSq()===0)return;focus.normalize().multiplyScalar(this.planet.radius);
  const direction=viewDirection(focus,viewDirectionECEF);
  const viewMoved=this.cameraView&&this.lastSpec?.cameraView&&(position.distanceTo(this.lastSpec.cameraView.position)>Math.max(.5,Math.min(10,Math.abs(this.cameraAltitudeMeters)*.05))||Math.abs(this.cameraView.pixelScale/this.lastSpec.cameraView.pixelScale-1)>.05);
  const pitched=this.cameraView&&this.lastSpec?.cameraView&&this.cameraView.direction.dot(this.lastSpec.cameraView.direction)<Math.cos(Math.PI/30);
  const turned=direction&&(!this.lastSpec?.viewDirection||direction.dot(this.lastSpec.viewDirection)<Math.cos(Math.PI/30));
  const viewBusy=this.cameraView&&this.discovery&&this.lastSpec?.cameraView&&Date.now()-this.lastSpec.at<1000&&this.cameraView.direction.dot(this.lastSpec.cameraView.direction)>.5&&focus.distanceTo(this.lastSpec.focus)<radiusMeters*.25;
  if(viewBusy)return;
  const refreshDue=this.lastSpec&&Date.now()-this.lastSpec.at>60000&&!this.discovery&&!this.pendingSpec&&this.active.size===0;
  if(resumed||!this.lastSpec||this.lastSpec.focus.distanceTo(focus)>Math.max(2,Math.min(20,radiusMeters*.08))||this.lastSpec.radius!==radiusMeters||this.lastSpec.viewHalfAngle!==viewHalfAngle||this.lastSpec.nearRadius!==nearRadiusMeters||!!direction!==!!this.lastSpec.viewDirection||turned||pitched||viewMoved||refreshDue){this.requestRegion({focusECEF:focus,radiusMeters,viewDirectionECEF:direction,viewHalfAngle,nearRadiusMeters,cameraView:this.cameraView,waitForCompletion:false}).catch(error=>{if(!isAbort(error))this.dispatchEvent({type:'error',error});});}
 }
 async pumpDiscovery(){
  if(this.discovery||this.disposed)return;
  this.discovery=(async()=>{
   while(this.pendingSpec&&!this.disposed){const spec=this.pendingSpec;this.pendingSpec=null;
    try{
     if(this.queryCount++>0&&(!spec.cameraView||Date.now()-this.rootReadAt>=60000)){this.planet=await this.source.root();this.rootReadAt=Date.now();}
     if(spec.cameraView){await this.discoverView(spec);continue;}
     this.viewCut=null;this.viewQualityDirty=false;this.collisionInventory=null;for(const asset of this.assets.values())asset.setMask?.(255);
     // Load a small set of real parent meshes before the expensive terminal
     // inventory. These never count as completed maximum-detail coverage.
     this.tileQueue=[];this.tileCursor=0;
     let nearRoots=[],terminals=[];
     if(this.previewRadiusMeters>0&&spec.radius>this.previewRadiusMeters){
      const previews=new Map();
      const selectPreview=node=>{
       if(node.empty)return false;
       if(!node.root&&!intersectsColumn(node,spec.normal,spec.radius))return false;
       if(node.leaf){if(intersectsRegion(node,spec))terminals.push(node);return false;}
       const previewSize=node.root?this.previewRadiusMeters:this.previewRadiusMeters+Math.max(0,node.center.distanceTo(spec.focus)-node.radius-spec.nearRadius)/6;
       if(node.hasData&&node.radius<=previewSize){previews.set(node.key,node);return false;}
       return true;
      };
      await this.walkMetadata([{root:true,epoch:this.planet.epoch}],spec.generation,selectPreview);
      if(this.disposed||spec.generation!==this.generation)continue;
      this.previewWanted=previews;nearRoots=[...previews.values()].filter(node=>intersectsColumn(node,spec.normal,spec.nearRadius)).concat(terminals.filter(node=>intersectsColumn(node,spec.normal,spec.nearRadius)));this.previewRemaining.clear();this.previewForLeaf.clear();this.previewRetirable.clear();this.previewFailed.clear();
      for(const [key,asset]of this.previews)if(asset.expiresAt<=Date.now()||asset.rootEpoch!==this.planet.epoch||!intersectsColumn(asset.descriptor,spec.normal,Math.max(this.retainRadiusMeters,spec.radius)))this.unload(key);
      this.previewQueue=[...previews.values()].sort((a,b)=>this.comparePriority(a,b,spec));this.previewCursor=0;this.pumpTiles();
     }else{
      this.previewWanted.clear();this.previewQueue=[];this.previewRemaining.clear();this.previewForLeaf.clear();this.previewRetirable.clear();for(const key of this.previews.keys())this.unload(key);
     }
     if(this.previewRadiusMeters>0&&spec.radius>this.previewRadiusMeters){
      const localSpec={...spec,radius:Math.min(spec.radius,spec.nearRadius),viewDirection:null};
      // Preserve proven local coverage while a new view is discovered. Turning
      // or moving must not freeze flight solely because the gaze pass began.
      const previous=this.inventoryEpoch===this.planet.epoch?this.committedSpec:null;
      const proven=previous?{...previous,radius:Math.min(previous.radius,previous.nearRadius),viewDirection:null}:null;
      const seed=proven?[...this.wanted].filter(([,node])=>intersectsColumn(node,proven.normal,proven.radius)):[];
      let accumulated={desired:new Map(seed),empty:0};
      const examined=new Set();
      const add=async(roots,coverageSpec)=>{
       const result=await this.collectLeaves(spec,roots,true);
       if(this.disposed||spec.generation!==this.generation)return false;
       const desired=new Map(accumulated.desired);
       for(const [key,node]of result.desired)desired.set(key,node);
       accumulated={desired,empty:accumulated.empty+result.empty};
       for(const root of roots)examined.add(root.key);
       this.installInventory(accumulated,coverageSpec,false,roots);
       return true;
      };
      // Complete the block under the gaze before inspecting off-screen ground.
      // Reuse only an already examined collision disk, otherwise claim none.
      const roots=[...this.previewWanted.values(),...terminals].filter(node=>intersectsRegion(node,spec));
      roots.sort((a,b)=>this.comparePriority(a,b,spec));
      if(this.priorityView&&roots.length&&!await add([roots[0]],proven??{...localSpec,radius:0}))continue;
      if(!await add(nearRoots.filter(node=>!examined.has(node.key)),localSpec))continue;
      // Publish each small completed inventory instead of waiting for the whole
      // distant sector. This also avoids traversing the root hierarchy twice.
      let remaining=roots.filter(node=>!examined.has(node.key));
      while(remaining.length&&spec.generation===this.generation&&!this.disposed){
       remaining.sort((a,b)=>this.comparePriority(a,b,spec));
       if(!await add(remaining.splice(0,4),localSpec))break;
      }
      if(this.disposed||spec.generation!==this.generation)continue;
      this.installInventory(accumulated,spec,true);
     }else{
      const inventory=await this.collectLeaves(spec);
      if(this.disposed||spec.generation!==this.generation)continue;
      this.installInventory(inventory,spec,true);
     }
    }catch(error){if(this.disposed||spec.generation!==this.generation)continue;this.discovering=false;this.discoveryError=error;this.dispatchEvent({type:'error',error,phase:'metadata'});this.publish();}
   }
  })().finally(()=>{this.discovery=null;if(this.pendingSpec&&!this.disposed)this.pumpDiscovery();this.publish();});
 }
 // Camera demand traverses visible ancestors first, stopping at the texel
 // footprint needed by the current pixels. There is no depth/zoom ceiling.
 async discoverView(spec){
  const cut=new Map(),view=spec.cameraView,tree=new Map(),refined=new Set();
  this.viewQualityDirty=false;this.emptyLeaves=0;this.viewTree=tree;this.viewChildren=new Map();this.viewCut=cut;this.wanted=new Map();this.tileQueue=[];this.tileCursor=0;this.readyCount=0;this.localDiscoveryReady=true;
  this.previewWanted.clear();this.previewQueue=[];this.previewForLeaf.clear();this.previewRemaining.clear();this.previewRetirable.clear();
  for(const key of [...this.previews.keys()])this.unload(key);
  const wanted=this.wanted;
  await this.walkMetadata([{root:true,epoch:this.planet.epoch}],spec.generation,node=>{
   if(node.root)return true;
   tree.set(node.path,node);
   if(node.empty){this.emptyLeaves++;return false;}
   const ground=intersectsColumn(node,spec.normal,8);
   if(!ground&&(!intersectsColumn(node,spec.normal,spec.radius)||!nodeInFrustum(node,view.frustum)))return false;
   if(node.hasData){wanted.set(node.key,node);if(this.assets.has(node.key))this.readyCount++;this.tileQueue??=[];this.tileQueue.push(node);this.pumpTiles();}
   const score=viewDetailScore(node,view,this.assets.get(node.key)?.angularWeight??0,this.screenSpaceError);
   const refine=node.path.length<3||(this.refinedPaths.has(node.path)?score>=-1:score>-.2);
   if(node.leaf||node.hasData&&!ground&&Number.isFinite(score)&&!refine){if(node.hasData)cut.set(node.key,node);return false;}
   refined.add(node.path);return true;
  },(parent,children)=>{this.viewChildren.set(parent.path,children.map(child=>child.path));for(const child of children)tree.set(child.path,child);},(a,b)=>this.comparePriority(a,b,spec));
  if(this.disposed||spec.generation!==this.generation)return;
  this.refinedPaths=refined;this.committedSpec=spec;this.inventoryEpoch=this.planet.epoch;this.collisionInventory=new Map(cut);this.discovering=false;this.localDiscoveryReady=false;
  for(const [key,asset]of this.assets)if(asset.expiresAt<=Date.now()||!wanted.has(key)&&(!intersectsColumn(asset.descriptor,spec.normal,this.retainRadiusMeters)||asset.rootEpoch!==this.planet.epoch))this.unload(key);
  this.sortTileQueue(spec);this.viewMaskDirty=true;this.updateViewMasks();this.pumpTiles();this.publish();
 }
 updateViewMasks(){
  if(!this.viewCut)return;this.viewMaskDirty=false;
  const byPath=new Map([...this.assets.values()].map(asset=>[asset.descriptor.path,asset]));
  // Known empty octants also cover their parent's footprint. Unknown metadata
  // cannot retire a fallback. Each direct child replaces only its own octant.
  const memo=new Map();
  const complete=path=>{
   if(memo.has(path))return memo.get(path);
   if(byPath.has(path))return true;
   const node=this.viewTree.get(path);if(node?.empty)return true;
   if(!node||node.leaf)return false;
   const children=this.viewChildren.get(path);
   const covered=!!children?.length&&children.every(child=>complete(child));memo.set(path,covered);return covered;
  };
  for(const asset of this.assets.values()){
   let mask=255;for(let octant=0;octant<8;octant++)if(complete(asset.descriptor.path+octant))mask&=~(1<<octant);
   asset.setMask?.(mask);
  }
 }
 async walkMetadata(roots,generation,visit,onChildren,compare){
  const queue=[];
  const push=node=>{queue.push(node);if(compare){let i=queue.length-1;while(i>0){const parent=(i-1)>>1;if(compare(queue[parent],node)<=0)break;queue[i]=queue[parent];i=parent;}queue[i]=node;}};
  const pop=()=>{if(!compare)return queue.pop();const result=queue[0],last=queue.pop();if(queue.length){let i=0;while(i*2+1<queue.length){let child=i*2+1;if(child+1<queue.length&&compare(queue[child+1],queue[child])<0)child++;if(compare(last,queue[child])<=0)break;queue[i]=queue[child];i=child;}queue[i]=last;}return result;};
  for(const root of roots)push(root);
  const active=new Set(),limit=this.concurrency;let failure=null,visited=0;
  const current=()=>!this.disposed&&generation===this.generation;
  try{
   while((queue.length||active.size)&&current()&&!failure){
    while(queue.length&&active.size<limit&&current()&&!failure){
     const node=pop();
     if(visit(node)){
      const task=(async()=>{const children=await this.source.children(node);if(current()&&!failure){onChildren?.(node,children);for(const child of children)push(child);}})().catch(error=>{failure??=error;}).finally(()=>active.delete(task));
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
  this.wanted=desired;this.readyCount=0;for(const key of desired.keys())if(this.assets.has(key))this.readyCount++;this.committedSpec=spec;this.inventoryEpoch=this.planet.epoch;this.emptyLeaves=empty;for(const key of this.failed.keys())if(!desired.has(key))this.failed.delete(key);this.discoveryError=null;this.discovering=!final;this.localDiscoveryReady=!final;
  // A completed local footprint is evidence even while the global inventory
  // is still being discovered. A later view sector must not erase that proof.
  const coveredParents=new Map(final?[...this.previewWanted.values()].filter(node=>containsRegion(node,spec)).map(node=>[node.path,node.key]):[]);
  for(const parent of wholeParents)if(this.previewWanted.has(parent.key))coveredParents.set(parent.path,parent.key);
  for(const key of coveredParents.values()){this.previewRetirable.add(key);this.previewRemaining.set(key,0);}
  for(const node of desired.values())for(let length=node.path.length-1;length>0;length--){const parent=coveredParents.get(node.path.slice(0,length));if(parent){this.previewForLeaf.set(node.key,parent);if(!this.assets.has(node.key))this.previewRemaining.set(parent,this.previewRemaining.get(parent)+1);break;}}
  const paths=new Map([...desired.values()].map(n=>[n.path,n.key]));
  for(const [key,asset]of this.assets){const samePath=paths.get(asset.descriptor.path);if(asset.expiresAt<=Date.now()||(samePath&&samePath!==key)||(!desired.has(key)&&asset.rootEpoch!==this.planet.epoch))this.unload(key);else if(!desired.has(key)&&!intersectsColumn(asset.descriptor,spec.normal,Math.max(this.retainRadiusMeters,spec.radius)))this.unload(key);else if(desired.has(key))asset.rootEpoch=this.planet.epoch;}
  this.sortTileQueue(spec);
  for(const [key,remaining]of this.previewRemaining)if(remaining===0&&this.previewRetirable.has(key))this.setPreviewVisible(key,false);
  this.pumpTiles();this.publish();
 }
 // The actual 3D gaze includes pitch. Horizontal demand and collision coverage
 // remain independent: looking up must not discard the ground beneath a player.
 prioritizeView(position,direction){
  const previous=this.priorityView;
  if(previous&&previous.position.distanceToSquared(position)<400&&previous.direction.dot(direction)>Math.cos(Math.PI/30))return;
  this.priorityView={position:position.clone(),direction:direction.clone().normalize()};
  if(this.lastSpec){
   this.sortTileQueue(this.lastSpec);
   this.previewQueue=[...this.previewWanted.values()].sort((a,b)=>this.comparePriority(a,b,this.lastSpec));this.previewCursor=0;
  }
 }
 priority(node,spec){
  const gaze=this.priorityView,distance=node.center.distanceToSquared(spec.focus);
  if(!gaze)return [0,distance];
  const offset=node.center.clone().sub(gaze.position),range=offset.length();
  const cosine=range?Math.max(-1,Math.min(1,offset.dot(gaze.direction)/range)):0;
  const angle=Math.acos(cosine),extent=Math.asin(Math.min(.95,node.radius/Math.max(range,1)));
  const onScreen=cosine>0&&range>node.radius;
  const bucket=onScreen&&angle-extent<Math.PI/22?0:onScreen&&angle-extent<Math.PI/3?1:distance<(spec.nearRadius+node.radius)**2?2:3;
  return [bucket,distance];
 }
 comparePriority(a,b,spec){const pa=this.priority(a,spec),pb=this.priority(b,spec);return pa[0]-pb[0]||pa[1]-pb[1];}
 sortTileQueue(spec){
  const parents=new Map(),scores=new Map();
  this.tileQueue=[...this.wanted.values()].filter(node=>!this.assets.has(node.key)&&!this.active.has(node.key)&&!this.failed.has(node.key));
  for(const node of this.tileQueue){
   const parent=this.previewWanted.get(this.previewForLeaf.get(node.key))??node;
   if(!parents.has(parent.key))parents.set(parent.key,this.priority(parent,spec));
   scores.set(node.key,[...parents.get(parent.key),...this.priority(node,spec)]);
  }
  this.tileQueue.sort((a,b)=>{const x=scores.get(a.key),y=scores.get(b.key);return x[0]-y[0]||x[1]-y[1]||x[2]-y[2]||x[3]-y[3];});this.tileCursor=0;
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
   else{this.assets.set(node.key,asset);if(this.viewCut&&!node.leaf&&asset.angularWeight>0)this.viewQualityDirty=true;this.readyCount++;const parent=this.previewForLeaf.get(node.key);if(parent){const remaining=this.previewRemaining.get(parent)-1;this.previewRemaining.set(parent,remaining);if(remaining===0&&this.previewRetirable.has(parent))this.setPreviewVisible(parent,false);}}
   for(const id of asset.copyrightIds)this.creditCounts.set(id,(this.creditCounts.get(id)??0)+1);this.group.add(asset.group);this.gpuBytes+=asset.gpuBytes;this.viewMaskDirty=true;this.dispatchEvent({type:preview?'preview-load':'tile-load',asset});
  }catch(error){if(asset&&!(preview?this.previews:this.assets).has(node.key))disposeAsset(asset);if(this.disposed||isAbort(error)||!(preview?this.previewWanted:this.wanted).has(node.key))return;if(preview){this.previewFailed.add(node.key);this.dispatchEvent({type:'warning',error,phase:'preview',node});}else{this.failed.set(node.key,error);this.dispatchEvent({type:this.viewCut&&!this.viewCut.has(node.key)?'warning':'error',error,phase:this.viewCut&&!this.viewCut.has(node.key)?'fallback':'tile',node});}}
 }
 setPreviewVisible(key,visible){const asset=this.previews.get(key);if(asset&&asset.group.visible!==visible){asset.group.visible=visible;this.visiblePreviewCount+=visible?1:-1;}}
 unload(key){const preview=this.previews.has(key),asset=(preview?this.previews:this.assets).get(key);if(!asset)return;this.dispatchEvent({type:preview?'preview-unload':'tile-unload',asset});(preview?this.previews:this.assets).delete(key);if(preview){if(asset.group.visible)this.visiblePreviewCount--;if(this.previewPaths.get(asset.descriptor.path)===key)this.previewPaths.delete(asset.descriptor.path);}else{for(let length=asset.descriptor.path.length-1;length>0;length--){const parent=this.previewPaths.get(asset.descriptor.path.slice(0,length));if(parent){this.setPreviewVisible(parent,true);break;}}}if(!preview){if(this.wanted.has(key))this.readyCount--;const parent=this.previewForLeaf.get(key);if(parent)this.previewRemaining.set(parent,(this.previewRemaining.get(parent)??0)+1);this.viewMaskDirty=true;}for(const id of asset.copyrightIds){const count=(this.creditCounts.get(id)??0)-1;if(count>0)this.creditCounts.set(id,count);else this.creditCounts.delete(id);}this.gpuBytes-=asset.gpuBytes;disposeAsset(asset);}
 getCoverage(){
  const required=this.viewCut??this.wanted;let ready=this.readyCount;if(this.viewCut){ready=0;for(const key of required.keys())if(this.assets.has(key))ready++;}
  const errors=[...(this.discoveryError?[this.discoveryError]:[]),...[...this.failed].filter(([key])=>!this.viewCut||this.viewCut.has(key)).map(([,error])=>error)];
  const complete=!this.disposed&&this.enabled&&!this.altitudePaused&&!this.discovering&&!this.pendingSpec&&!this.viewQualityDirty&&errors.length===0&&ready===required.size&&!!this.lastSpec;
  return {status:this.disposed?'disposed':!this.enabled?'paused':this.altitudePaused?'waiting-altitude':errors.length?'incomplete':this.discovering?'discovering':complete?this.wanted.size?'complete':'no-data':'loading',complete,cameraAltitudeMeters:this.cameraAltitudeMeters,activationAltitudeMeters:this.activationAltitudeMeters,epoch:this.planet?.epoch??null,radiusMeters:this.lastSpec?.radius??this.radiusMeters,inventoryRadiusMeters:this.committedSpec?.radius??0,detailMode:this.viewCut?'screen-space':'terminal',requiredLeaves:required.size,readyLeaves:ready,missingLeaves:required.size-ready,unknownBranches:this.discoveryError?1:0,failedLeaves:errors.length-(this.discoveryError?1:0),fallbackFailures:this.viewCut?[...this.failed.keys()].filter(key=>!this.viewCut.has(key)).length:0,declaredEmptyLeaves:this.emptyLeaves,residentLeaves:this.assets.size,previewTiles:this.visiblePreviewCount,residentPreviews:this.previews.size,previewRequired:this.previewWanted.size,gpuBytes:this.gpuBytes,errors:errors.map(e=>({code:e.code??'unavailable',message:e.message,details:e.details??{}})),cachePersistent:this.cache?.persistent??false,cacheWarning:this.cache?.warning??null,...this.transport?.stats};
 }
 getAttribution(){const counts=new Map();for(const [id,count]of this.creditCounts){const text=this.credits.get(id);if(text)counts.set(text,(counts.get(text)??0)+count);}return [...counts].sort((a,b)=>b[1]-a[1]).map(([text])=>text).join(' · ');}
 publish(){
  if(this.viewQualityDirty&&!this.disposed&&this.enabled&&!this.altitudePaused&&!this.discovery&&!this.discovering&&!this.pendingSpec&&this.active.size===0&&this.lastSpec?.cameraView){
   this.viewQualityDirty=false;this.discovering=true;
   this.requestRegion({...this.regionOptions(),waitForCompletion:false}).catch(error=>{this.discovering=false;if(!isAbort(error)){this.discoveryError=error;this.dispatchEvent({type:'error',error});}this.publish();});
  }
  this.dispatchEvent({type:'progress',coverage:this.getCoverage()});
 }
 waitForIdle(timeoutMs=120000){if(this.disposed)return Promise.reject(aborted());return new Promise((resolve,reject)=>{let timer;const check=()=>{if(this.disposed){cleanup();reject(aborted());}else if(!this.discovery&&!this.discovering&&!this.pendingSpec&&this.active.size===0){const result=this.getCoverage();cleanup();resolve(result);}};const cleanup=()=>{clearTimeout(timer);this.removeEventListener('progress',check);};this.addEventListener('progress',check);timer=setTimeout(()=>{cleanup();reject(new TileError('timeout','HQ streaming has not settled',{coverage:this.getCoverage()}));},timeoutMs);check();});}
 regionOptions(){const s=this.lastSpec;return s?{focusECEF:s.focus,radiusMeters:s.radius,viewDirectionECEF:s.viewDirection,viewHalfAngle:s.viewHalfAngle,nearRadiusMeters:s.nearRadius,cameraView:s.cameraView}:{};}
 retryFailed(){this.failed.clear();this.discoveryError=null;if(this.lastSpec)return this.requestRegion(this.regionOptions());return Promise.resolve(this.getCoverage());}
 setGpuBudget(bytes){if(!(bytes>0))throw new TileError('invalid_options','GPU budget must be positive');this.maxGpuBytes=bytes;this.capacityBlocked=false;for(const[key,error]of this.failed)if(error.code==='gpu_budget')this.failed.delete(key);if(this.lastSpec)this.sortTileQueue(this.lastSpec);this.pumpTiles();}
 setEnabled(enabled){if(this.enabled===!!enabled)return;this.enabled=!!enabled;if(!enabled){this.generation++;this.pendingSpec=null;this.discovering=false;}else if(this.lastSpec&&!this.altitudePaused)this.requestRegion({...this.regionOptions(),waitForCompletion:false}).catch(error=>{if(!isAbort(error))this.dispatchEvent({type:'error',error});});this.publish();}
 async dispose(){
  if(this.disposing)return this.disposing;this.disposed=true;this.generation++;this.pendingSpec=null;this.enabled=false;this.publish();
  this.disposing=(async()=>{if(this.ownsSource)await this.transport.dispose();await Promise.allSettled([...(this.discovery?[this.discovery]:[]),...this.active.values()]);for(const key of [...this.assets.keys(),...this.previews.keys()])this.unload(key);this.wanted.clear();this.previewWanted.clear();this.previewForLeaf.clear();this.previewRemaining.clear();this.previewRetirable.clear();this.previewQueue=[];this.failed.clear();if(this.ownsSource)this.source.clear();if(this.ownsCache)await this.cache.close();this.group.removeFromParent();this.publish();})();return this.disposing;
 }
}

export function viewDetailScore(node,view,weight=0,quality=1){
 const closest=nearestNodePoint(node,view.position),offset=closest.clone().sub(view.position),depth=Math.max(1e-20,Math.abs(offset.dot(view.direction)));
 const cosine=Math.max(0,-closest.normalize().dot(offset.clone().normalize())),angular=Math.max(1e-9,1-weight+weight*Math.pow(cosine,.2));
 return Math.log2(.8)+Math.log2(node.metersPerTexel*view.pixelScale/depth*angular/quality);
}
