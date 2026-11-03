import {Vector3} from './math.js';
import {DecoderPool} from './decoder.js';
import {planetMetadata,copyrightMetadata} from './protobuf.js';
import {intersectsColumn} from './geo-core.js';
import {TileError,aborted} from './errors.js';
import {SharedDemand} from './demand.js';
export class RocktreeSource {
 constructor({transport,baseUrl='https://kh.google.com/rt/earth/',maxParsedMetadata=200}={}){this.transport=transport;this.decoder=new DecoderPool();this.baseUrl=baseUrl.endsWith('/')?baseUrl:baseUrl+'/';this.bulk=new Map();this.maxParsedMetadata=maxParsedMetadata;}
 async root(){const bytes=await this.transport.get(this.baseUrl+'PlanetoidMetadata',{fresh:true});return planetMetadata(bytes);}
 async copyrights(epoch){return copyrightMetadata(await this.transport.get(this.baseUrl+'Copyrights/pb=!1u'+epoch));}
 bulkUrl(path,epoch){return this.baseUrl+'BulkMetadata/pb=!1m2!1s'+path+'!2u'+epoch;}
 nodeUrl(node){return this.baseUrl+'NodeData/pb=!1m2!1s'+node.path+'!2u'+node.epoch+'!2e'+(node.flags&16?1:6)+(node.flags&16?'!3u'+node.imageryEpoch:'')+'!4b0';}
 loadBulk(path,epoch,{priority,signal}={}){
  if(signal?.aborted)return Promise.reject(aborted());
  const key=this.bulkUrl(path,epoch);let entry=this.bulk.get(key);
  if(entry&&(entry.pending||entry.expiresAt>Date.now())&&!entry.demand.controller.signal.aborted){this.bulk.delete(key);this.bulk.set(key,entry);this.transport.reprioritize?.(key,priority??0);return entry.demand.subscribe(signal);}
  if(entry)this.bulk.delete(key);
  entry={pending:true,expiresAt:0,demand:null};
  const forget=()=>{if(this.bulk.get(key)===entry)this.bulk.delete(key);};
  entry.demand=new SharedDemand(async requestSignal=>{
   const bytes=await this.transport.get(key,{priority,signal:requestSignal});if(requestSignal.aborted)throw aborted();
   const payload=await this.decoder.decode(0,bytes);if(requestSignal.aborted)throw aborted();
   if(payload.headNodePath!==path)throw new TileError('identity_mismatch','Unexpected metadata path',{expected:path,actual:payload.headNodePath});
   entry.pending=false;entry.expiresAt=this.transport.getExpiry?.(key)??Date.now();
   while(this.bulk.size>this.maxParsedMetadata){const oldest=[...this.bulk].find(([,value])=>!value.pending);if(!oldest)break;this.bulk.delete(oldest[0]);}
   return {path,epoch,url:key,payload,records:new Map()};
  },{onEmpty:forget,onSettled:()=>{if(entry.demand.error)forget();}});
  this.bulk.set(key,entry);return entry.demand.subscribe(signal);
 }
 node(bulk,index,path){
  if(bulk.records.has(index))return bulk.records.get(index);
  const b=bulk.payload,flags=b.flags[index],leaf=!!(flags&4),hasData=!(flags&8),empty=leaf&&!hasData;
  const center=new Vector3().fromArray(b.obbCenters,index*3),extents=Array.from(b.obbExtents.slice(index*3,index*3+3)),radius=Math.hypot(...extents);
  if(!empty&&(![center.x,center.y,center.z,radius,...extents].every(Number.isFinite)||extents.some(x=>x<0)))throw new TileError('unknown_bounds','Metadata has unresolved bounds',{path});
  const node={path,index,bulk,flags,leaf,hasData,empty,center,radius,epoch:b.epoch[index],bulkEpoch:b.bulkMetadataEpoch[index],imageryEpoch:b.imageryEpochArray?b.imageryEpochArray[index]:b.defaultImageryEpoch,obb:{rotation:Array.from(b.obbRotations.slice(index*9,index*9+9)),extents},metersPerTexel:b.metersPerTexel[index]};
  if(!empty&&(!node.obb.rotation.every(Number.isFinite)||node.obb.rotation.length!==9))throw new TileError('unknown_bounds','Metadata has unresolved OBB axes',{path});
  if(hasData&&(!node.epoch||(flags&16&&!node.imageryEpoch)))throw new TileError('unknown_epoch','Tile epoch missing',{path});
  node.key=this.nodeUrl(node);bulk.records.set(index,node);return node;
 }
 async children(node,options={}){
  let bulk,index,path;
  if(node.root){bulk=await this.loadBulk('',node.epoch,options);index=-1;path='';}
  else if(node.leaf)return [];
  else if(node.path.length-node.bulk.path.length===4){if(!node.bulkEpoch)throw new TileError('unknown_epoch','Child metadata epoch missing',{path:node.path});bulk=await this.loadBulk(node.path,node.bulkEpoch,options);index=-1;path=node.path;}
  else{bulk=node.bulk;index=node.index;path=node.path;}
  const children=[];for(let k=0;k<8;k++){const child=bulk.payload.childIndices[8*(index+1)+k];if(child>=0)children.push(this.node(bulk,child,path+k));}
  if(!children.length)throw new TileError('unknown_children','Nonterminal branch without children',{path});return children;
 }
 async surfaceCeiling(normal,planet,{isCurrent=()=>true,signal}={}){
  let frontier=[{root:true,epoch:planet.epoch}],ceiling=0,settledCeiling=0;
  while(frontier.length&&isCurrent()&&!signal?.aborted){
   const children=(await Promise.all(frontier.map(node=>this.children(node,{signal})))).flat().filter(node=>!node.empty&&intersectsColumn(node,normal,0));
   if(!children.length)return ceiling;
   const height=node=>{const r=node.obb?.rotation,e=node.obb?.extents;let extent=node.radius;if(r&&e){extent=0;for(let i=0;i<3;i++)extent+=Math.abs(normal.x*r[i]+normal.y*r[i+3]+normal.z*r[i+6])*e[i];}return node.center.dot(normal)+extent-planet.radius;};
   for(const node of children)if(node.leaf||node.radius<=256)settledCeiling=Math.max(settledCeiling,height(node));
   ceiling=Math.max(settledCeiling,...children.map(height));
   // A sub-256 m footprint gives a conservative local roof/elevation bound.
   frontier=children.filter(node=>!node.leaf&&node.radius>256);
  }
  return Math.max(0,ceiling);
 }
 async loadNode(node,{priority=1,signal}={}){const bytes=await this.transport.get(node.key,{priority,signal});if(signal?.aborted)throw aborted();const decoded=await this.decoder.decode(1,bytes);if(signal?.aborted)throw aborted();return decoded;}
 clear(){for(const entry of this.bulk.values())entry.demand.abort();this.bulk.clear();this.decoder.dispose();}
}
