import {TileError} from '../errors.js';
export function fields(input){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=new Map();let p=0;
 function varint(){let n=0,m=1,b;do{if(p>=bytes.length||m>2**49)throw new TileError('invalid_protobuf','Invalid varint');b=bytes[p++];n+=(b&127)*m;m*=128;}while(b&128);return n;}
 while(p<bytes.length){
  const tag=varint(),key=Math.floor(tag/8),wire=tag&7;let value;
  if(!key)throw new TileError('invalid_protobuf','Zero field number');
  if(wire===0)value=varint();
  else if(wire===2){const size=varint();if(p+size>bytes.length)throw new TileError('invalid_protobuf','Truncated bytes');value=bytes.subarray(p,p+size);p+=size;}
  else if(wire===5){if(p+4>bytes.length)throw new TileError('invalid_protobuf','Truncated float');value=view.getFloat32(p,true);p+=4;}
  else if(wire===1){if(p+8>bytes.length)throw new TileError('invalid_protobuf','Truncated double');value=view.getFloat64(p,true);p+=8;}
  else throw new TileError('invalid_protobuf','Unsupported wire type '+wire);
  if(!out.has(key))out.set(key,[]);out.get(key).push(value);
 }
 return out;
}
export function planetMetadata(bytes){
 const p=fields(bytes),nested=p.get(1)?.[0];if(!(nested instanceof Uint8Array))throw new TileError('root_metadata','Missing root node');
 const node=fields(nested),epoch=node.get(5)?.[0],radius=p.get(2)?.[0];
 if(!Number.isSafeInteger(epoch)||epoch<1||!Number.isFinite(radius)||radius<=0)throw new TileError('root_metadata','Unknown root epoch or radius');
 return {epoch,radius,minTerrainAltitude:p.get(3)?.[0]??null,maxTerrainAltitude:p.get(4)?.[0]??null};
}
export function copyrightMetadata(bytes){
 const out=new Map(),text=new TextDecoder();for(const row of fields(bytes).get(1)??[]){const f=fields(row),id=f.get(1)?.[0],raw=f.get(3)?.[0]??f.get(2)?.[0];if(Number.isSafeInteger(id)&&raw instanceof Uint8Array)out.set(id,text.decode(raw));}return out;
}
