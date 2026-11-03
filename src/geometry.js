import * as THREE from 'three';
import decodeDXT from 'decode-dxt';
import {TileError} from './errors.js';
import {terrainMaterial,setTerrainPass} from './terrain-material.js';
export function disposeAsset(asset){
 if(!asset||asset.disposed)return;asset.disposed=true;
 asset.group.removeFromParent();const geometries=new Set(),materials=new Set(),textures=new Set();
 asset.group.traverse(object=>{if(!object.isMesh)return;geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material]){materials.add(material);if(material.map)textures.add(material.map);}});
 for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();for(const texture of textures){texture.image?.close?.();texture.dispose();}
}
export async function buildAsset(node,descriptor,renderer){
 const matrix=node.matrixGlobeFromMesh;if(!matrix||matrix.length!==16||!Array.from(matrix).every(Number.isFinite))throw new TileError('invalid_geometry','Invalid tile transform',{path:descriptor.path});
 const group=new THREE.Group();group.matrixAutoUpdate=false;group.matrix.fromArray(matrix);group.userData.tileKey=descriptor.key;group.userData.nodePath=descriptor.path;
 const bounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},point=new THREE.Vector3(),referenceLongitude=Math.atan2(descriptor.center?.y??0,descriptor.center?.x??1);
 const asset={group,meshes:[],passes:new Map(),nonEmptyOctants:node.nonEmptyOctants??255,angularWeight:0,gpuBytes:0,copyrightIds:node.copyrightIds??[],descriptor,disposed:false};
 try{
  const surfaces=[...node.meshes,...node.overlaySurfaceMeshes];if(node.waterMesh)surfaces.push(node.waterMesh);
  for(const source of surfaces){
   const v=source.vertices,n=v.length/8;if(!Number.isInteger(n))throw new TileError('invalid_geometry','Invalid vertex layout');
   const positions=new Uint8Array(n*3),uv=new Float32Array(n*2),vertexOctants=new Float32Array(n);
   for(let i=0;i<n;i++){
    point.set(v[i*8],v[i*8+1],v[i*8+2]).applyMatrix4(group.matrix);const radius=point.length();
    if(radius>0){let longitude=Math.atan2(point.y,point.x);longitude=referenceLongitude+Math.atan2(Math.sin(longitude-referenceLongitude),Math.cos(longitude-referenceLongitude));const geo=[longitude,Math.asin(THREE.MathUtils.clamp(point.z/radius,-1,1)),radius];for(let j=0;j<3;j++){bounds.min[j]=Math.min(bounds.min[j],geo[j]);bounds.max[j]=Math.max(bounds.max[j],geo[j]);}}
    vertexOctants[i]=2**(v[i*8+3]&7);positions.set(v.subarray(i*8,i*8+3),i*3);const s=source.uvOffsetAndScale;uv[i*2]=s?(v[i*8+4]+v[i*8+5]*256+s[0])*s[2]:0;uv[i*2+1]=s?(v[i*8+6]+v[i*8+7]*256+s[1])*s[3]:0;}
   const strip=source.indices,indices=[],octants=Array.from({length:8},()=>[]);
   // Standard visible terrain/overground layers; hidden and skirt layers are not duplicate surfaces.
   const end=Math.min(source.layerBounds?.[3]??strip.length,strip.length-2);
   for(let i=0;i<end;i++){const a=strip[i],b=strip[i+(i%2?2:1)],c=strip[i+(i%2?1:2)];if(a===b||a===c||b===c)continue;if(a>=n||b>=n||c>=n)throw new TileError('invalid_geometry','Vertex index outside tile');indices.push(a,b,c);octants[v[a*8+3]&7].push(a,b,c);}
   if(!indices.length)continue;
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Uint8BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setAttribute('tileOctant',new THREE.BufferAttribute(vertexOctants,1));geometry.setIndex(indices);geometry.computeBoundingSphere();geometry.userData.octants=octants.map(values=>new Uint32Array(values));geometry.setDrawRange(0,indices.length);
   let texture=null;const tex=source.texture;
   if(tex?.textureFormat===6){const bytes=new Uint8Array(tex.bytes);if(!renderer||renderer.extensions.has('WEBGL_compressed_texture_s3tc'))texture=new THREE.CompressedTexture([{data:bytes,width:tex.width,height:tex.height}],tex.width,tex.height,THREE.RGB_S3TC_DXT1_Format);else texture=new THREE.DataTexture(new Uint8Array(decodeDXT(new DataView(bytes.buffer),tex.width,tex.height,'dxt1')),tex.width,tex.height,THREE.RGBAFormat);}
   else if(tex?.textureFormat===1){const bitmap=await createImageBitmap(new Blob([tex.bytes],{type:'image/jpeg'}));texture=new THREE.Texture(bitmap);}
   else if(tex)throw new TileError('unsupported_texture','Unknown texture format '+tex.textureFormat,{path:descriptor.path});
   if(texture){texture.flipY=false;texture.colorSpace=THREE.NoColorSpace;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.anisotropy=renderer?Math.min(8,renderer.capabilities.getMaxAnisotropy()):1;texture.needsUpdate=true;asset.gpuBytes+=texture.isCompressedTexture?texture.mipmaps[0].data.byteLength:tex.width*tex.height*4;}
   const water=source===node.waterMesh,material=terrainMaterial(texture,texture?0xffffff:water?0x477c9e:0xa8a291);
   const mesh=new THREE.Mesh(geometry,material);mesh.userData.nodePath=descriptor.path;mesh.userData.tileKey=descriptor.key;mesh.userData.surface=water?'water':'terrain';group.add(mesh);asset.meshes.push(mesh);setTerrainPass(mesh,255);
   asset.gpuBytes+=positions.byteLength+uv.byteLength+vertexOctants.byteLength+geometry.index.array.byteLength;
  }
  asset.fadeEligible=!surfaces.some(surface=>surface.layerBounds?.[5]>surface.layerBounds?.[4]);
  asset.angularWeight=meshAngularWeight(bounds,descriptor.path.length);
  asset.mask=255;
  asset.setMask=mask=>{asset.mask=mask;asset.setRenderPasses([{id:'base',mask,opacity:1,secondary:false}]);};
  asset.setRenderPasses=passes=>{
   let primary=0;for(const pass of passes)if(!pass.secondary)primary|=pass.mask;
   const extra=passes.filter(pass=>pass.secondary&&pass.mask),retained=new Set();
   for(const mesh of asset.meshes)setTerrainPass(mesh,primary);
   for(const pass of extra){
    retained.add(pass.id);let meshes=asset.passes.get(pass.id);
    if(!meshes){meshes=asset.meshes.map(base=>{const mesh=new THREE.Mesh(base.geometry,terrainMaterial(base.material.map));mesh.material.uniforms.tileColor.value.copy(base.material.uniforms.tileColor.value);mesh.userData={...base.userData,transition:true};group.add(mesh);return mesh;});asset.passes.set(pass.id,meshes);}
    for(const mesh of meshes)setTerrainPass(mesh,pass.mask,pass.opacity,true);
   }
   for(const [id,meshes]of asset.passes)if(!retained.has(id)){for(const mesh of meshes){mesh.removeFromParent();mesh.material.dispose();}asset.passes.delete(id);}
   group.visible=primary!==0||extra.length>0;
  };
  return asset;
 }catch(error){disposeAsset(asset);throw error;}
}

// Geographic extent of the decoded mesh owns the oblique-view correction.
export function meshAngularWeight({min,max},depth){
 if(depth<=1)return 0;if(!min.every(Number.isFinite)||!max.every(Number.isFinite))return 1;
 const position=(lon,lat,r)=>new THREE.Vector3(r*Math.cos(lat)*Math.cos(lon),r*Math.cos(lat)*Math.sin(lon),r*Math.sin(lat));
 const a=position(min[0],min[1],min[2]),b=position(max[0],max[1],min[2]),c=position((min[0]+max[0])/2,(min[1]+max[1])/2,max[2]),span=a.distanceTo(b);
 return span>0?Math.max(0,1-a.add(b).multiplyScalar(.5).distanceTo(c)/span)**4:0;
}
