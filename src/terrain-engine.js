import {EventDispatcher,Vector3} from './math.js';
import {createView} from './view.js';
import {ResilientByteCache} from './cache.js';
import {ByteTransport,compareRequestPriority} from './transport.js';
import {RocktreeSource} from './source.js';
import {buildTileData,disposeTileData} from './tile-data.js';
import {intersectsRegion,intersectsColumn,geoToECEF,nearestNodePoint,nodeInFrustum} from './geo-core.js';
import {TileError,isAbort,aborted} from './errors.js';
import {TileFade} from './transitions.js';
const cpuTurn=()=>new Promise(resolve=>setTimeout(resolve,0));
function viewDirection(focus,value){
 if(!value)return null;
 const direction=new Vector3().copy(value),normal=focus.clone().normalize();
 direction.addScaledVector(normal,-direction.dot(normal));
 if(![direction.x,direction.y,direction.z].every(Number.isFinite))throw new TileError('invalid_focus','Invalid view direction');
 return direction.lengthSq()<1e-12?null:direction.normalize();
}
export class TerrainTileEngine extends EventDispatcher {
 constructor({cache,cacheName='earth-hq-cache-v1',cacheBytes=512*1024*1024,fetch,baseUrl,source,radiusMeters=2000,retainRadiusMeters=radiusMeters*1.15,concurrency=18,maxResidentBytes=512*1024*1024,maxGpuBytes=maxResidentBytes,maxResponseBytes,activationAltitudeMeters=2500,altitudeHysteresisMeters=500,screenSpaceError=1}={}){
  super();if(!Number.isFinite(radiusMeters)||radiusMeters<=0||!Number.isFinite(retainRadiusMeters)||retainRadiusMeters<radiusMeters||!Number.isInteger(concurrency)||concurrency<1||!Number.isFinite(maxGpuBytes)||maxGpuBytes<=0)throw new TileError('invalid_options','Invalid radius, retention, GPU budget or concurrency');
  if(!Number.isFinite(activationAltitudeMeters)||activationAltitudeMeters<=0||!Number.isFinite(altitudeHysteresisMeters)||altitudeHysteresisMeters<0)throw new TileError('invalid_options','Invalid automatic streaming altitude');
  if(!Number.isFinite(screenSpaceError)||screenSpaceError<0)throw new TileError('invalid_options','Invalid screen-space error');
  this.screenSpaceError=screenSpaceError;this.cameraView=null;this.viewTree=new Map();this.viewChildren=new Map();this.viewCut=null;this.collisionInventory=null;this.viewMaskDirty=false;this.viewQualityDirty=false;
  this.capacityBlocked=false;this.localDiscoveryReady=false;this.payloadControllers=new Map();this.discoveryController=null;this.renderFrame=0;
  this.activationAltitudeMeters=activationAltitudeMeters;this.altitudeHysteresisMeters=altitudeHysteresisMeters;this.altitudePaused=true;this.cameraAltitudeMeters=null;
  this.radiusMeters=radiusMeters;this.retainRadiusMeters=retainRadiusMeters;this.maxGpuBytes=maxGpuBytes;this.concurrency=concurrency;
  this.ownsCache=!cache&&!source;this.cache=cache??(!source?new ResilientByteCache({name:cacheName,maxBytes:cacheBytes}):null);
  this.ownsSource=!source;this.transport=source?.transport??new ByteTransport({cache:this.cache,fetch,concurrency,maxResponseBytes});this.source=source??new RocktreeSource({transport:this.transport,baseUrl});
  this.assets=new Map();this.wanted=new Map();this.failed=new Map();this.active=new Map();this.readyCount=0;this.creditCounts=new Map();this.gpuBytes=0;this.disposed=false;this.enabled=true;this.generation=0;this.pendingSpec=null;this.discovery=null;this.lastSpec=null;this.discoveryError=null;this.discovering=false;this.queryCount=0;this.initializing=null;this.planet=null;this.credits=new Map();this.emptyLeaves=0;this.disposing=null;
 }
 async start(){
  if(this.disposed)throw aborted();
  if(!this.initializing)this.initializing=(async()=>{
   const planet=await this.source.root();if(this.disposed)throw aborted();this.planet=planet;this.onPlanet(planet);this.rootReadAt=Date.now();
   try{const credits=await this.source.copyrights(planet.epoch);if(this.disposed)throw aborted();this.credits=credits;}catch(error){if(isAbort(error))throw error;this.dispatchEvent({type:'warning',error,phase:'attribution'});}
   return planet;
  })().catch(error=>{this.initializing=null;throw error;});
  return this.initializing;
 }
 async requestRegion({latitude,longitude,focusECEF,radiusMeters=this.radiusMeters,viewDirectionECEF,viewHalfAngle=Math.PI,nearRadiusMeters=60,collisionRadiusMeters=0,waitForCompletion=true,cameraView=null}={}){
  if(!focusECEF&&(!Number.isFinite(latitude)||latitude< -90||latitude>90||!Number.isFinite(longitude)))throw new TileError('invalid_focus','Latitude or longitude invalid');
  const generation=++this.generation;this.discoveryController?.abort();
  await this.start();if(this.disposed)throw aborted();if(generation!==this.generation)return this.getCoverage();if(!Number.isFinite(radiusMeters)||!(radiusMeters>0))throw new TileError('invalid_options','HQ radius must be finite and positive');
  const focus=focusECEF?new Vector3().copy(focusECEF):geoToECEF(latitude,longitude,0,this.planet.radius);
  if(![focus.x,focus.y,focus.z].every(Number.isFinite)||focus.lengthSq()===0)throw new TileError('invalid_focus','Invalid globe focus');
  const normal=focus.clone().normalize(),direction=viewDirection(focus,viewDirectionECEF);
  if(!Number.isFinite(viewHalfAngle)||viewHalfAngle<=0||viewHalfAngle>Math.PI||!Number.isFinite(nearRadiusMeters)||nearRadiusMeters<0||!Number.isFinite(collisionRadiusMeters)||collisionRadiusMeters<0)throw new TileError('invalid_options','Invalid view angle or near radius');
  this.enabled=true;this.altitudePaused=false;
  const spec={cameraView,focus:focus.normalize().multiplyScalar(this.planet.radius),normal,radius:radiusMeters,viewDirection:direction,viewHalfAngle,nearRadius:nearRadiusMeters,collisionRadius:collisionRadiusMeters,generation,at:Date.now()};this.lastSpec=spec;this.currentDemand=spec;this.pendingSpec=spec;this.discovering=true;this.localDiscoveryReady=false;this.discoveryError=null;this.failed.clear();this.capacityBlocked=false;this.publish();this.pumpDiscovery();return waitForCompletion?this.waitForIdle():this.getCoverage();
 }
 createAsset(decoded,node){return buildTileData(decoded,node);}
 disposeAsset(asset){disposeTileData(asset);}
 onPlanet(){}
 onAssetLoaded(asset){asset.onChange=()=>this.dispatchEvent({type:'tile-update',asset});}
 onDispose(){}
 update(view,options={}){if(this.disposed||!this.enabled||!this.planet)return;this.updateView(createView(view),options);}
 updateView(view,{focusECEF,radiusMeters=this.radiusMeters,viewDirectionECEF,viewHalfAngle=Math.PI,nearRadiusMeters=60,collisionRadiusMeters=0}={}){
  if(this.disposed||!this.enabled||!this.planet)return;
  const previousView=this.cameraView,position=view.position.clone();
  if(this.screenSpaceError>0)this.cameraView=view;
  this.renderFrame++;const renderChanged=this.transitionsDirty||this.viewMaskDirty||this.renderQuality!==this.screenSpaceError||!previousView||this.cameraView&&(!previousView.position.equals(this.cameraView.position)||!previousView.direction.equals(this.cameraView.direction)||previousView.pixelScale!==this.cameraView.pixelScale);
  if(this.viewMaskDirty)this.updateViewMasks();if(this.cameraView?.projection&&(renderChanged||this.transitioning)){this.updateTransitions(performance.now()/1000);this.renderQuality=this.screenSpaceError;}
  if(![position.x,position.y,position.z].every(Number.isFinite)||position.lengthSq()===0)return;
  this.cameraAltitudeMeters=position.length()-this.planet.radius;
  const paused=this.cameraAltitudeMeters>this.activationAltitudeMeters+(this.altitudePaused?0:this.altitudeHysteresisMeters);
  if(paused){if(!this.altitudePaused){this.altitudePaused=true;this.cancelRequests();this.generation++;this.pendingSpec=null;this.discovering=false;this.publish();}return;}
  const resumed=this.altitudePaused;this.altitudePaused=false;
  const focus=focusECEF?new Vector3().copy(focusECEF):position;
  if(focus.lengthSq()===0)return;focus.normalize().multiplyScalar(this.planet.radius);
  const direction=viewDirection(focus,viewDirectionECEF);
  this.updateRequestDemand({focus,normal:focus.clone().normalize(),radius:radiusMeters,collisionRadius:collisionRadiusMeters,cameraView:this.cameraView});
  const viewMoved=this.cameraView&&this.lastSpec?.cameraView&&(position.distanceTo(this.lastSpec.cameraView.position)>Math.max(.5,Math.min(10,Math.abs(this.cameraAltitudeMeters)*.05))||Math.abs(this.cameraView.pixelScale/this.lastSpec.cameraView.pixelScale-1)>.05);
  const pitched=this.cameraView&&this.lastSpec?.cameraView&&this.cameraView.direction.dot(this.lastSpec.cameraView.direction)<Math.cos(Math.PI/30);
  const turned=direction&&(!this.lastSpec?.viewDirection||direction.dot(this.lastSpec.viewDirection)<Math.cos(Math.PI/30));
  const viewBusy=this.cameraView&&this.discovery&&this.lastSpec?.cameraView&&Date.now()-this.lastSpec.at<1000&&this.cameraView.direction.dot(this.lastSpec.cameraView.direction)>.5&&focus.distanceTo(this.lastSpec.focus)<radiusMeters*.25;
  if(viewBusy)return;
  const refreshDue=this.lastSpec&&Date.now()-this.lastSpec.at>60000&&!this.discovery&&!this.pendingSpec&&this.active.size===0;
  if(resumed||!this.lastSpec||this.lastSpec.focus.distanceTo(focus)>Math.max(2,Math.min(20,radiusMeters*.08))||this.lastSpec.radius!==radiusMeters||this.lastSpec.viewHalfAngle!==viewHalfAngle||this.lastSpec.nearRadius!==nearRadiusMeters||this.lastSpec.collisionRadius!==collisionRadiusMeters||!!direction!==!!this.lastSpec.viewDirection||turned||pitched||viewMoved||refreshDue){this.requestRegion({focusECEF:focus,radiusMeters,viewDirectionECEF:direction,viewHalfAngle,nearRadiusMeters,collisionRadiusMeters,cameraView:this.cameraView,waitForCompletion:false}).catch(error=>{if(!isAbort(error))this.dispatchEvent({type:'error',error});});}
 }
 async pumpDiscovery(){
  if(this.discovery||this.disposed)return;
  this.discovery=(async()=>{
   while(this.pendingSpec&&!this.disposed){const spec=this.pendingSpec;this.pendingSpec=null;this.discoveryController=spec.controller=new AbortController();
    try{
     if(this.queryCount++>0&&(!spec.cameraView||Date.now()-this.rootReadAt>=60000)){this.planet=await this.source.root();this.rootReadAt=Date.now();}
     if(spec.cameraView){await this.discoverView(spec);continue;}
     this.viewCut=null;this.viewQualityDirty=false;this.collisionInventory=null;for(const asset of this.assets.values())asset.setMask?.(255);
     const {desired,empty}=await this.collectLeaves(spec);
     if(this.disposed||spec.generation!==this.generation)continue;
     this.wanted=desired;this.emptyLeaves=empty;this.committedSpec=spec;this.inventoryEpoch=this.planet.epoch;this.discovering=false;
     this.readyCount=0;for(const key of desired.keys())if(this.assets.has(key))this.readyCount++;
     this.evictOutside(spec);this.sortTileQueue(spec);this.pumpTiles();this.publish();
    }catch(error){if(this.disposed||spec.generation!==this.generation)continue;this.discovering=false;this.discoveryError=error;this.dispatchEvent({type:'error',error,phase:'metadata'});this.publish();}
   }
  })().finally(()=>{this.discovery=null;if(this.pendingSpec&&!this.disposed)this.pumpDiscovery();this.publish();});
 }
 // Camera demand traverses visible ancestors first, stopping at the texel
 // footprint needed by the current pixels. There is no depth/zoom ceiling.
 async discoverView(spec){
  const cut=new Map(),view=spec.cameraView,tree=new Map(),nodeVisible=new Map();
  this.viewQualityDirty=false;this.emptyLeaves=0;this.viewTree=tree;this.viewChildren=new Map();this.viewCut=cut;this.wanted=new Map();this.tileQueue=[];this.tileCursor=0;this.readyCount=0;this.localDiscoveryReady=true;
  const wanted=this.wanted;
  await this.walkMetadata([{root:true,epoch:this.planet.epoch}],spec.generation,node=>{
   if(node.root)return true;
   tree.set(node.path,node);
   if(node.empty){this.emptyLeaves++;return false;}
   const collision=spec.collisionRadius>0&&intersectsColumn(node,spec.normal,spec.collisionRadius);
   if(!collision&&(!intersectsColumn(node,spec.normal,spec.radius)||!nodeInFrustum(node,view.frustum))){nodeVisible.set(node.path,false);return false;}
   nodeVisible.set(node.path,true);
   const score=viewDetailScore(node,view,this.assets.get(node.key)?.angularWeight??0,this.screenSpaceError);
   // Admission and continuation are separate reference-traverser decisions.
   // A subpixel child cannot become payload demand merely because we visited it.
   const admit=collision||node.path.length<3||!Number.isFinite(score)||score>=-1;
   if(node.hasData&&admit){wanted.set(node.key,node);if(this.assets.has(node.key))this.readyCount++;this.tileQueue.push(node);this.pumpTiles();}
   const refine=collision||node.path.length<3||score>-.2||this.assets.get(node.key)?.fade?.dependencyFrame===this.renderFrame-1;
   if(node.leaf||node.hasData&&Number.isFinite(score)&&!refine)return false;
   return true;
  },(parent,children)=>{this.viewChildren.set(parent.path,children.map(child=>child.path));for(const child of children)tree.set(child.path,child);},(a,b)=>this.comparePriority(a,b,spec),async node=>{
   const parent=tree.get(node.path?.slice(0,-1));
   // The active 3D traverser admits the current payload independently, but
   // expands its metadata only when its data-bearing parent mesh is resident.
   if(parent?.hasData&&!this.assets.has(parent.key))await this.waitForMesh(parent.key,spec.generation);
   return this.source.children(node,{signal:spec.controller.signal,priority:node.root?undefined:this.requestPriority(node,spec,false)});
  });
  if(this.disposed||spec.generation!==this.generation)return;
  // Keep a parent in the display frontier for child octants that did not
  // qualify for finer geometry. Empty/off-screen children need no payload.
  const covered=new Map();
  const selected=path=>{
   if(covered.has(path))return covered.get(path);
   if(wanted.has(tree.get(path)?.key)||tree.get(path)?.empty||nodeVisible.get(path)===false)return true;
   const children=this.viewChildren.get(path),result=!!children?.length&&children.every(selected);covered.set(path,result);return result;
  };
  for(const node of wanted.values()){const children=this.viewChildren.get(node.path);if(!children?.length||!children.every(selected))cut.set(node.key,node);}
  this.committedSpec=spec;this.inventoryEpoch=this.planet.epoch;this.collisionInventory=new Map(cut);this.discovering=false;this.localDiscoveryReady=false;
  this.evictOutside(spec);
  this.sortTileQueue(spec);this.viewMaskDirty=true;this.updateViewMasks();this.pumpTiles();this.publish();
 }
 updateViewMasks(){
  if(!this.viewCut)return;this.viewMaskDirty=false;this.transitionsDirty=true;
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
 updateTransitions(now){
  if(!this.viewCut||!this.cameraView)return;
  const view=this.cameraView,byPath=new Map([...this.assets.values()].map(asset=>[asset.descriptor.path,asset]));
  const active=new Map(),scores=new Map(),plans=new Map(),residentReentries=new Set();let transitioning=0;
  // A traversal is skipped only while selection inputs remain unchanged. Count
  // actual selection traversals so that an idle view preserves its spatial state.
  const traversal=this.transitionTraversal=(this.transitionTraversal??0)+1;
  for(const [path,asset]of byPath){
   const node=asset.descriptor,score=viewDetailScore(node,view,asset.angularWeight,this.screenSpaceError);scores.set(path,score);
   const spatial=intersectsColumn(node,this.currentDemand.normal,this.currentDemand.radius)&&nodeInFrustum(node,view.frustum);
   // Reference state 30207/32997: a resident mesh returning from outside on
   // consecutive traversals is selected immediately. Newly arrived meshes fade.
   if(asset.selectionTraversal===traversal-1&&asset.selectionSpatial===false&&spatial)residentReentries.add(path);
   asset.selectionTraversal=traversal;asset.selectionSpatial=spatial;
   const alpha=asset.fade?.alpha??0;
   const fading=spatial&&alpha>0&&(alpha<1?score>=-3:score>Math.fround(-1-Math.fround(.2)));
   if(this.payloadInView(node,{...this.currentDemand,cameraView:view})||fading)active.set(path,asset);
   plans.set(path,[]);
  }
  const covered=new Map(),complete=path=>{
   if(covered.has(path))return covered.get(path);
   if(active.has(path)||this.viewTree.get(path)?.empty)return true;
   const children=this.viewChildren.get(path),result=!!children?.length&&children.every(complete);covered.set(path,result);return result;
  };
  const add=(path,pass)=>{if(pass.mask)plans.get(path)?.push(pass);};
  for(const [path,asset]of active){
   let mask=asset.nonEmptyOctants??255;for(let octant=0;octant<8;octant++)if(complete(path+octant))mask&=~(1<<octant);
   asset.mask=mask;
   if(!mask)continue;
   const parent=active.get(path.slice(0,-1)),bit=1<<Number(path.at(-1)),fade=asset.fade??(asset.fade=new TileFade());
   if(!parent||asset.fadeEligible===false||residentReentries.has(path)||!((parent.nonEmptyOctants??255)&bit)||!nodeInFrustum(asset.descriptor,view.frustum)){
    fade.reset(true);fade.point=null;add(path,{id:path,mask,opacity:1,secondary:false});continue;
   }
   const point=asset.descriptor.center.clone().applyMatrix4(view.projection);
   const pair=fade.pair(scores.get(path),now,{x:Math.fround(point.x),y:Math.fround(point.y)},this.renderFrame);
   const parentPath=parent.descriptor.path;
   if(pair.current)add(path,{id:path,mask,opacity:1,secondary:false});else add(parentPath,{id:path,mask:bit,opacity:1,secondary:false});
   if(pair.blend){transitioning++;parent.fade??=new TileFade();parent.fade.dependencyFrame=this.renderFrame;add(pair.current?parentPath:path,{id:path,mask:pair.current?bit:mask,opacity:pair.blend,secondary:true});}
  }
  for(const [path,asset]of byPath){if(!active.has(path))asset.mask=0;asset.setRenderPasses?.(plans.get(path));}
  this.transitioning=transitioning;this.transitionsDirty=false;
 }
 waitForMesh(key,generation){
  if(this.assets.has(key))return Promise.resolve();
  return new Promise((resolve,reject)=>{
   const finish=error=>{this.removeEventListener('progress',check);error?reject(error):resolve();};
   const check=()=>{if(this.disposed||!this.enabled||this.altitudePaused||generation!==this.generation)finish(aborted());else if(this.assets.has(key))finish();else if(this.failed.has(key))finish(this.failed.get(key));else if(this.capacityBlocked)finish(new TileError('gpu_budget','Parent mesh cannot fit in the tile memory budget'));};
   this.addEventListener('progress',check);check();
  });
 }
 async walkMetadata(roots,generation,visit,onChildren,compare,expand=node=>this.source.children(node)){
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
      const task=(async()=>{const children=await expand(node);if(current()&&!failure){onChildren?.(node,children);for(const child of children)push(child);}})().catch(error=>{failure??=error;}).finally(()=>active.delete(task));
      active.add(task);
     }
     if(++visited%512===0)await cpuTurn();
    }
    if(active.size)await Promise.race(active);
   }
  }finally{await Promise.allSettled([...active]);}
  if(failure)throw failure;
 }
 async collectLeaves(spec){
  const desired=new Map();let empty=0;
  await this.walkMetadata([{root:true,epoch:this.planet.epoch}],spec.generation,node=>{
   if(node.empty){empty++;return false;}
   if(!node.root&&!intersectsRegion(node,spec))return false;
   if(node.leaf){if(node.hasData)desired.set(node.key,node);return false;}
   return true;
  },undefined,undefined,node=>this.source.children(node,{signal:spec.controller.signal}));return {desired,empty};
 }
 evictOutside(spec){
  for(const [key,asset]of this.assets){
   if(asset.expiresAt<=Date.now()||asset.rootEpoch!==this.planet.epoch||!this.wanted.has(key)&&!intersectsColumn(asset.descriptor,spec.normal,Math.max(this.retainRadiusMeters,spec.radius)))this.unload(key);
  }
 }
 requestPriority(node,spec,payload=true){
  // PlanetFetcher key: lower traversal mode, higher request priority,
  // admitted/resource flag, higher view score, payload before metadata on ties.
  const score=spec.cameraView?viewDetailScore(node,spec.cameraView,this.assets.get(node.key)?.angularWeight??0,this.screenSpaceError):-node.center.distanceToSquared(spec.focus);
  return [-1,100,!payload||score<99?1:0,Number.isNaN(score)?0:score,payload?1:0];
 }
 comparePriority(a,b,spec){
  if(a.root||b.root)return a.root?-1:1;
  return compareRequestPriority(this.requestPriority(a,spec),this.requestPriority(b,spec));
 }
 sortTileQueue(spec){
  this.tileQueue=[...this.wanted.values()].filter(node=>!this.assets.has(node.key)&&!this.active.has(node.key)&&!this.failed.has(node.key)).sort((a,b)=>this.comparePriority(a,b,spec));this.tileCursor=0;
 }
 nextTile(){while(this.tileCursor<this.tileQueue?.length){const node=this.tileQueue[this.tileCursor++];if(this.wanted.has(node.key)&&!this.assets.has(node.key)&&!this.active.has(node.key)&&!this.failed.has(node.key))return node;}return null;}
 pumpTiles(){
  if(this.disposed||!this.enabled||this.altitudePaused||this.capacityBlocked||this.discovering&&!this.localDiscoveryReady)return;
  while(this.active.size<this.concurrency){
   const node=this.nextTile();if(!node)break;
   const task=this.loadTile(node).finally(()=>{this.active.delete(node.key);if(this.enabled&&!this.altitudePaused&&!this.disposed&&!this.capacityBlocked&&this.wanted.has(node.key)&&!this.assets.has(node.key)&&!this.failed.has(node.key)&&this.payloadInView(node,this.currentDemand??this.lastSpec))this.tileQueue.push(this.wanted.get(node.key));this.pumpTiles();this.publish();});this.active.set(node.key,task);
  }
 }
 payloadInView(node,spec){
  if(!spec?.cameraView)return !spec||intersectsRegion(node,spec);
  if(spec.collisionRadius>0&&intersectsColumn(node,spec.normal,spec.collisionRadius))return true;
  if(!intersectsColumn(node,spec.normal,spec.radius)||!nodeInFrustum(node,spec.cameraView.frustum))return false;
  const score=viewDetailScore(node,spec.cameraView,this.assets.get(node.key)?.angularWeight??0,this.screenSpaceError);
  return node.path.length<3||score>=-1;
 }
 updateRequestDemand(spec){
  this.currentDemand=spec;if(!spec.cameraView)return;
  for(const [key,request]of this.payloadControllers){
   if(this.payloadInView(request.node,spec)){
    request.lastTouch=this.renderFrame;this.transport.reprioritize?.(key,this.requestPriority(request.node,spec));
   }else if(request.lastTouch<this.renderFrame-2)request.controller.abort();
  }
 }
 cancelRequests(){this.discoveryController?.abort();for(const {controller}of this.payloadControllers.values())controller.abort();}
 async loadTile(node){
  let asset;const controller=new AbortController(),signal=controller.signal;this.payloadControllers.set(node.key,{controller,node,lastTouch:this.renderFrame});
  try{
   const decoded=await this.source.loadNode(node,{signal,priority:this.lastSpec?this.requestPriority(node,this.lastSpec):undefined});if(this.disposed||!this.enabled||this.altitudePaused||signal.aborted)return;
   await cpuTurn();if(this.disposed||!this.enabled||this.altitudePaused||signal.aborted)return;
   asset=await this.createAsset(decoded,node);
   if(this.disposed||!this.enabled||this.altitudePaused||signal.aborted||!this.wanted.has(node.key)){this.disposeAsset(asset);return;}
   if(this.gpuBytes+asset.gpuBytes>this.maxGpuBytes)for(const key of this.assets.keys()){if(!this.wanted.has(key))this.unload(key);if(this.gpuBytes+asset.gpuBytes<=this.maxGpuBytes)break;}
   if(this.gpuBytes+asset.gpuBytes>this.maxGpuBytes){this.capacityBlocked=true;throw new TileError('gpu_budget','GPU budget cannot hold every requested HQ leaf',{path:node.path,budget:this.maxGpuBytes,requiredNext:this.gpuBytes+asset.gpuBytes});}
   asset.fade=new TileFade();asset.expiresAt=this.transport.getExpiry?.(node.key)??Infinity;asset.rootEpoch=this.planet.epoch;
   this.assets.set(node.key,asset);if(this.viewCut&&!node.leaf&&asset.angularWeight>0)this.viewQualityDirty=true;this.readyCount++;
   for(const id of asset.copyrightIds)this.creditCounts.set(id,(this.creditCounts.get(id)??0)+1);this.onAssetLoaded(asset);this.gpuBytes+=asset.gpuBytes;this.viewMaskDirty=true;this.dispatchEvent({type:'tile-load',asset});
  }catch(error){
   if(asset&&!this.assets.has(node.key))this.disposeAsset(asset);
   if(this.disposed||isAbort(error)||!this.wanted.has(node.key))return;
   this.failed.set(node.key,error);const fallback=this.viewCut&&!this.viewCut.has(node.key);
   this.dispatchEvent({type:fallback?'warning':'error',error,phase:fallback?'fallback':'tile',node});
  }finally{if(this.payloadControllers.get(node.key)?.controller===controller)this.payloadControllers.delete(node.key);}
 }
 unload(key){
  const asset=this.assets.get(key);if(!asset)return;this.dispatchEvent({type:'tile-unload',asset});this.assets.delete(key);
  if(this.wanted.has(key))this.readyCount--;this.viewMaskDirty=true;
  for(const id of asset.copyrightIds){const count=(this.creditCounts.get(id)??0)-1;if(count>0)this.creditCounts.set(id,count);else this.creditCounts.delete(id);}
  this.gpuBytes-=asset.gpuBytes;this.disposeAsset(asset);
 }
 getCoverage(){
  const required=this.viewCut??this.wanted;let ready=this.readyCount;if(this.viewCut){ready=0;for(const key of required.keys())if(this.assets.has(key))ready++;}
  const errors=[...(this.discoveryError?[this.discoveryError]:[]),...[...this.failed].filter(([key])=>!this.viewCut||this.viewCut.has(key)).map(([,error])=>error)];
  const complete=!this.disposed&&this.enabled&&!this.altitudePaused&&!this.discovering&&!this.pendingSpec&&!this.viewQualityDirty&&errors.length===0&&ready===required.size&&!!this.lastSpec;
  return {status:this.disposed?'disposed':!this.enabled?'paused':this.altitudePaused?'waiting-altitude':errors.length?'incomplete':this.discovering?'discovering':complete?this.wanted.size?'complete':'no-data':'loading',complete,transitioning:this.transitioning??0,cameraAltitudeMeters:this.cameraAltitudeMeters,activationAltitudeMeters:this.activationAltitudeMeters,epoch:this.planet?.epoch??null,radiusMeters:this.lastSpec?.radius??this.radiusMeters,inventoryRadiusMeters:this.committedSpec?.radius??0,detailMode:this.viewCut?'screen-space':'terminal',requiredLeaves:required.size,readyLeaves:ready,missingLeaves:required.size-ready,unknownBranches:this.discoveryError?1:0,failedLeaves:errors.length-(this.discoveryError?1:0),fallbackFailures:this.viewCut?[...this.failed.keys()].filter(key=>!this.viewCut.has(key)).length:0,declaredEmptyLeaves:this.emptyLeaves,residentLeaves:this.assets.size,residentBytes:this.gpuBytes,gpuBytes:this.gpuBytes,errors:errors.map(e=>({code:e.code??'unavailable',message:e.message,details:e.details??{}})),cachePersistent:this.cache?.persistent??false,cacheWarning:this.cache?.warning??null,...this.transport?.stats};
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
 regionOptions(){const s=this.lastSpec;return s?{focusECEF:s.focus,radiusMeters:s.radius,viewDirectionECEF:s.viewDirection,viewHalfAngle:s.viewHalfAngle,nearRadiusMeters:s.nearRadius,collisionRadiusMeters:s.collisionRadius,cameraView:s.cameraView}:{};}
 retryFailed(){this.failed.clear();this.discoveryError=null;if(this.lastSpec)return this.requestRegion(this.regionOptions());return Promise.resolve(this.getCoverage());}
 setGpuBudget(bytes){if(!(bytes>0))throw new TileError('invalid_options','GPU budget must be positive');this.maxGpuBytes=bytes;this.capacityBlocked=false;for(const[key,error]of this.failed)if(error.code==='gpu_budget')this.failed.delete(key);if(this.lastSpec&&this.discoveryError?.code==='gpu_budget'){this.requestRegion({...this.regionOptions(),waitForCompletion:false}).catch(error=>{if(!isAbort(error))this.dispatchEvent({type:'error',error});});return;}if(this.lastSpec)this.sortTileQueue(this.lastSpec);this.pumpTiles();}
 setEnabled(enabled){if(this.enabled===!!enabled)return;this.enabled=!!enabled;if(!enabled){this.cancelRequests();this.generation++;this.pendingSpec=null;this.discovering=false;}else if(this.lastSpec&&!this.altitudePaused)this.requestRegion({...this.regionOptions(),waitForCompletion:false}).catch(error=>{if(!isAbort(error))this.dispatchEvent({type:'error',error});});this.publish();}
 async dispose(){
  if(this.disposing)return this.disposing;this.disposed=true;this.cancelRequests();this.generation++;this.pendingSpec=null;this.enabled=false;this.publish();
  this.disposing=(async()=>{if(this.ownsSource)await this.transport.dispose();await Promise.allSettled([...(this.discovery?[this.discovery]:[]),...this.active.values()]);for(const key of [...this.assets.keys()])this.unload(key);this.wanted.clear();this.failed.clear();if(this.ownsSource)this.source.clear();if(this.ownsCache)await this.cache.close();this.onDispose();this.publish();})();return this.disposing;
 }
}

export function viewDetailScore(node,view,weight=0,quality=1){
 const closest=nearestNodePoint(node,view.position),offset=closest.clone().sub(view.position),depth=Math.max(1e-20,Math.abs(offset.dot(view.direction)));
 const cosine=Math.max(0,-closest.normalize().dot(offset.clone().normalize())),angular=Math.max(1e-9,1-weight+weight*Math.pow(cosine,.2));
 return Math.log2(.8)+Math.log2(node.metersPerTexel*view.pixelScale/depth*angular/quality);
}
