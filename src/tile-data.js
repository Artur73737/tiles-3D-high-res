import {Vector3} from './math.js';
import {TileError} from './errors.js';

// Own geometry interpretation once; both the API and the viewer consume these arrays.
export function prepareTileData(node,descriptor){
 const matrix=node.matrixGlobeFromMesh;if(!matrix||matrix.length!==16||!Array.from(matrix).every(Number.isFinite))throw new TileError('invalid_geometry','Invalid tile transform',{path:descriptor.path});
 const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},point=new Vector3(),referenceLongitude=Math.atan2(descriptor.center?.y??0,descriptor.center?.x??1),meshes=[];
 const surfaces=[...node.meshes,...node.overlaySurfaceMeshes];if(node.waterMesh)surfaces.push(node.waterMesh);
 for(const source of surfaces){
  const v=source.vertices,n=v.length/8;if(!Number.isInteger(n))throw new TileError('invalid_geometry','Invalid vertex layout');
  const positions=new Uint8Array(n*3),uv=new Float32Array(n*2),vertexOctants=new Float32Array(n);
  for(let i=0;i<n;i++){
   point.set(v[i*8],v[i*8+1],v[i*8+2]).applyMatrix4(matrix);const radius=point.length();
   if(radius>0){let longitude=Math.atan2(point.y,point.x);longitude=referenceLongitude+Math.atan2(Math.sin(longitude-referenceLongitude),Math.cos(longitude-referenceLongitude));const geo=[longitude,Math.asin(Math.max(-1,Math.min(1,point.z/radius))),radius];for(let j=0;j<3;j++){bounds.min[j]=Math.min(bounds.min[j],geo[j]);bounds.max[j]=Math.max(bounds.max[j],geo[j]);}}
   vertexOctants[i]=2**(v[i*8+3]&7);positions.set(v.subarray(i*8,i*8+3),i*3);const scale=source.uvOffsetAndScale;uv[i*2]=scale?(v[i*8+4]+v[i*8+5]*256+scale[0])*scale[2]:0;uv[i*2+1]=scale?(v[i*8+6]+v[i*8+7]*256+scale[1])*scale[3]:0;
  }
  const strip=source.indices,indices=[],octants=Array.from({length:8},()=>[]),end=Math.min(source.layerBounds?.[3]??strip.length,strip.length-2);
  for(let i=0;i<end;i++){const a=strip[i],b=strip[i+(i%2?2:1)],c=strip[i+(i%2?1:2)];if(a===b||a===c||b===c)continue;if(a>=n||b>=n||c>=n)throw new TileError('invalid_geometry','Vertex index outside tile');indices.push(a,b,c);octants[v[a*8+3]&7].push(a,b,c);}
  if(!indices.length)continue;
  meshes.push({positions,uv,vertexOctants,indices:n>65535?new Uint32Array(indices):new Uint16Array(indices),octants:octants.map(values=>new Uint32Array(values)),texture:source.texture??null,surface:source===node.waterMesh?'water':'terrain',source});
 }
 return {descriptor,decoded:node,matrixGlobeFromMesh:Float64Array.from(matrix),meshes,copyrightIds:node.copyrightIds??[],nonEmptyOctants:node.nonEmptyOctants??255,angularWeight:meshAngularWeight(bounds,descriptor.path.length),fadeEligible:!surfaces.some(surface=>surface.layerBounds?.[5]>surface.layerBounds?.[4])};
}
function storageBytes(value,seen=new Set()){
 if(value===null||typeof value!=='object'||seen.has(value))return 0;seen.add(value);
 if(ArrayBuffer.isView(value))return storageBytes(value.buffer,seen);
 if(value instanceof ArrayBuffer)return value.byteLength;
 return Object.values(value).reduce((n,v)=>n+(typeof v==='number'?8:storageBytes(v,seen)),0);
}
export function buildTileData(node,descriptor){
 const asset=prepareTileData(node,descriptor);asset.disposed=false;asset.mask=255;asset.passes=[{id:'base',mask:255,opacity:1,secondary:false}];asset.byteLength=storageBytes({decoded:asset.decoded,meshes:asset.meshes,matrix:asset.matrixGlobeFromMesh});asset.gpuBytes=asset.byteLength;
 asset.setRenderPasses=passes=>{if(asset.passes.length===passes.length&&passes.every((p,i)=>['id','mask','opacity','secondary'].every(k=>p[k]===asset.passes[i][k])))return;asset.passes=passes.map(p=>({...p}));asset.onChange?.();};
 asset.setMask=mask=>{asset.mask=mask;asset.setRenderPasses([{id:'base',mask,opacity:1,secondary:false}]);};return asset;
}
export function disposeTileData(asset){if(asset&&!asset.disposed){asset.disposed=true;asset.onChange=null;}}

// Geographic extent of the decoded mesh owns the oblique-view correction.
export function meshAngularWeight({min,max},depth){
 if(depth<=1)return 0;if(!min.every(Number.isFinite)||!max.every(Number.isFinite))return 1;
 const position=(lon,lat,r)=>new Vector3(r*Math.cos(lat)*Math.cos(lon),r*Math.cos(lat)*Math.sin(lon),r*Math.sin(lat));
 const a=position(min[0],min[1],min[2]),b=position(max[0],max[1],min[2]),c=position((min[0]+max[0])/2,(min[1]+max[1])/2,max[2]),span=a.distanceTo(b);
 return span>0?Math.max(0,1-a.add(b).multiplyScalar(.5).distanceTo(c)/span)**4:0;
}
