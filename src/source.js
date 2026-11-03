import {Vector3} from 'three';
import {DecoderPool} from './decoder.js';
import {planetMetadata,copyrightMetadata} from './protobuf.js';
import {intersectsColumn} from './geo.js';
import {TileError} from './errors.js';
export class RocktreeSource {
 constructor({transport,baseUrl='https://kh.google.com/rt/earth/',maxParsedMetadata=200}={}){this.transport=transport;this.decoder=new DecoderPool();this.baseUrl=baseUrl.endsWith('/')?baseUrl:baseUrl+'/';this.bulk=new Map();this.maxParsedMetadata=maxParsedMetadata;}
 async root(){const bytes=await this.transport.get(this.baseUrl+'PlanetoidMetadata',{fresh:true});return planetMetadata(bytes);}
 async copyrights(epoch){return copyrightMetadata(await this.transport.get(this.baseUrl+'Copyrights/pb=!1u'+epoch));}
 bulkUrl(path,epoch){return this.baseUrl+'BulkMetadata/pb=!1m2!1s'+path+'!2u'+epoch;}
 nodeUrl(node){return this.baseUrl+'NodeData/pb=!1m2!1s'+node.path+'!2u'+node.epoch+'!2e'+(node.flags&16?1:6)+(node.flags&16?'!3u'+node.imageryEpoch:'')+'!4b0';}
 async loadBulk(path,epoch,{priority}={}){
  const key=this.bulkUrl(path,epoch);if(this.bulk.has(key)){const value=this.bulk.get(key);if(value.pending||value.expiresAt>Date.now()){this.bulk.delete(key);this.bulk.set(key,value);return value.task;}this.bulk.delete(key);}
  const entry={pending:true,expiresAt:0,task:null};
  entry.task=(async()=>{const bytes=await this.transport.get(key,{priority}),payload=await this.decoder.decode(0,bytes);if(payload.headNodePath!==path)throw new TileError('identity_mismatch','Unexpected metadata path',{expected:path,actual:payload.headNodePath});entry.pending=false;entry.expiresAt=this.transport.getExpiry?.(key)??Date.now();return {path,epoch,url:key,payload,records:new Map()};})();
  this.bulk.set(key,entry);try{const result=await entry.task;while(this.bulk.size>this.maxParsedMetadata)this.bulk.delete(this.bulk.keys().next().value);return result;}catch(error){this.bulk.delete(key);throw error;}
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
 async surfaceCeiling(normal,planet,{isCurrent=()=>true}={}){
  let frontier=[{root:true,epoch:planet.epoch}],ceiling=0,settledCeiling=0;
  while(frontier.length&&isCurrent()){
   const children=(await Promise.all(frontier.map(node=>this.children(node)))).flat().filter(node=>!node.empty&&intersectsColumn(node,normal,0));
   if(!children.length)return ceiling;
   const height=node=>{const r=node.obb?.rotation,e=node.obb?.extents;let extent=node.radius;if(r&&e){extent=0;for(let i=0;i<3;i++)extent+=Math.abs(normal.x*r[i]+normal.y*r[i+3]+normal.z*r[i+6])*e[i];}return node.center.dot(normal)+extent-planet.radius;};
   for(const node of children)if(node.leaf||node.radius<=256)settledCeiling=Math.max(settledCeiling,height(node));
   ceiling=Math.max(settledCeiling,...children.map(height));
   // A sub-256 m footprint gives a conservative local roof/elevation bound.
   frontier=children.filter(node=>!node.leaf&&node.radius>256);
  }
  return Math.max(0,ceiling);
 }
 async loadNode(node,{priority=1}={}){const bytes=await this.transport.get(node.key,{priority});return await this.decoder.decode(1,bytes);}
 clear(){this.bulk.clear();this.decoder.dispose();}
}
