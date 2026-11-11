import {Vector3} from 'three';
import {decoderPool} from './decoder/pool.js';
// Metadata gates every tile below it, so it always goes ahead of tile payloads.
const METADATA_PRIORITY=[1e9];
import {planetMetadata,copyrightMetadata} from './protobuf.js';
import {TileError} from '../errors.js';
export class GoogleEarthSource {
 constructor({transport,baseUrl='https://kh.google.com/rt/earth/',maxParsedMetadata=200}={}){this.transport=transport;this.baseUrl=baseUrl.endsWith('/')?baseUrl:baseUrl+'/';this.bulk=new Map();this.maxParsedMetadata=maxParsedMetadata;}
 async root(){const bytes=await this.transport.get(this.baseUrl+'PlanetoidMetadata',{fresh:true});return planetMetadata(bytes);}
 async copyrights(epoch){return copyrightMetadata(await this.transport.get(this.baseUrl+'Copyrights/pb=!1u'+epoch));}
 bulkUrl(path,epoch){return this.baseUrl+'BulkMetadata/pb=!1m2!1s'+path+'!2u'+epoch;}
 // textureFormat: 6 = DXT1, 1 = JPEG; textures:false requests geometry only (!4b1).
 nodeUrl(node,{textureFormat=6,textures=true}={}){return this.baseUrl+'NodeData/pb=!1m2!1s'+node.path+'!2u'+node.epoch+'!2e'+textureFormat+(node.flags&16?'!3u'+node.imageryEpoch:'')+'!4b'+(textures?0:1);}
 async loadBulk(path,epoch){
  const key=this.bulkUrl(path,epoch);if(this.bulk.has(key)){const value=this.bulk.get(key);if(value.pending||value.expiresAt>Date.now()){this.bulk.delete(key);this.bulk.set(key,value);return value.task;}this.bulk.delete(key);}
  const entry={pending:true,expiresAt:0,task:null};
  entry.task=(async()=>{const bytes=await this.transport.get(key,{priority:METADATA_PRIORITY}),payload=await decoderPool().decode(0,bytes);if(payload.headNodePath!==path)throw new TileError('identity_mismatch','Unexpected metadata path',{expected:path,actual:payload.headNodePath});entry.pending=false;entry.expiresAt=this.transport.getExpiry?.(key)??Date.now();return {path,epoch,url:key,payload,records:new Map()};})();
  this.bulk.set(key,entry);try{const result=await entry.task;while(this.bulk.size>this.maxParsedMetadata)this.bulk.delete(this.bulk.keys().next().value);return result;}catch(error){this.bulk.delete(key);throw error;}
 }
 node(bulk,index,path){
  if(bulk.records.has(index))return bulk.records.get(index);
  const b=bulk.payload,flags=b.flags[index],leaf=!!(flags&4),hasData=!(flags&8),empty=leaf&&!hasData;
  const center=new Vector3().fromArray(b.obbCenters,index*3),extents=Array.from(b.obbExtents.slice(index*3,index*3+3)),radius=Math.hypot(...extents);
  if(!empty&&(![center.x,center.y,center.z,radius,...extents].every(Number.isFinite)||extents.some(x=>x<0)))throw new TileError('unknown_bounds','Metadata has unresolved bounds',{path});
  const node={path,index,bulk,flags,leaf,hasData,empty,center,radius,epoch:b.epoch[index],bulkEpoch:b.bulkMetadataEpoch[index],imageryEpoch:b.imageryEpochArray?b.imageryEpochArray[index]:b.defaultImageryEpoch,metersPerTexel:b.metersPerTexel[index],extents,rotation:b.obbRotations?Array.from(b.obbRotations.slice(index*9,index*9+9)):null};
  if(hasData&&(!node.epoch||(flags&16&&!node.imageryEpoch)))throw new TileError('unknown_epoch','Tile epoch missing',{path});
  node.key=this.nodeUrl(node);bulk.records.set(index,node);return node;
 }
 async children(node){
  let bulk,index,path;
  if(node.root){bulk=await this.loadBulk('',node.epoch);index=-1;path='';}
  else if(node.leaf)return [];
  else if(node.path.length-node.bulk.path.length===4){if(!node.bulkEpoch)throw new TileError('unknown_epoch','Child metadata epoch missing',{path:node.path});bulk=await this.loadBulk(node.path,node.bulkEpoch);index=-1;path=node.path;}
  else{bulk=node.bulk;index=node.index;path=node.path;}
  const children=[];for(let k=0;k<8;k++){const child=bulk.payload.childIndices[8*(index+1)+k];if(child>=0)children.push(this.node(bulk,child,path+k));}
  if(!children.length)throw new TileError('unknown_children','Nonterminal branch without children',{path});return children;
 }
 // priority: number or tuple (core/net/priority.js); signal cancels this caller's interest only.
 async loadNode(node,url=node.key,{priority=0,signal}={}){const bytes=await this.transport.get(url,{priority,signal});return decoderPool().decode(1,bytes,{signal});}
 clear(){this.bulk.clear();}
}
