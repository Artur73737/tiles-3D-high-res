import * as THREE from 'three';
import decodeDXT from 'decode-dxt';
import {TileError} from './errors.js';
import {terrainMaterial,setTerrainPass} from './terrain-material.js';
import {prepareTileData} from './tile-data.js';
export {meshAngularWeight} from './tile-data.js';
export function disposeAsset(asset){
 if(!asset||asset.disposed)return;asset.disposed=true;
 asset.group.removeFromParent();const geometries=new Set(),materials=new Set(),textures=new Set();
 asset.group.traverse(object=>{if(!object.isMesh)return;geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material]){materials.add(material);if(material.map)textures.add(material.map);}});
 for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();for(const texture of textures){texture.image?.close?.();texture.dispose();}
}
export async function buildAsset(node,descriptor,renderer){
 const data=prepareTileData(node,descriptor),matrix=data.matrixGlobeFromMesh;
 const group=new THREE.Group();group.matrixAutoUpdate=false;group.matrix.fromArray(matrix);group.userData.tileKey=descriptor.key;group.userData.nodePath=descriptor.path;
 const asset={group,meshes:[],passes:new Map(),nonEmptyOctants:data.nonEmptyOctants,angularWeight:data.angularWeight,fadeEligible:data.fadeEligible,gpuBytes:0,copyrightIds:data.copyrightIds,descriptor,disposed:false};
 try{
  for(const prepared of data.meshes){
   const {positions,uv,vertexOctants,indices,octants}=prepared,source=prepared.source;
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Uint8BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setAttribute('tileOctant',new THREE.BufferAttribute(vertexOctants,1));geometry.setIndex(new THREE.BufferAttribute(indices,1));geometry.computeBoundingSphere();geometry.userData.octants=octants;geometry.setDrawRange(0,indices.length);
   let texture=null;const tex=source.texture;
   if(tex?.textureFormat===6){const bytes=new Uint8Array(tex.bytes);if(!renderer||renderer.extensions.has('WEBGL_compressed_texture_s3tc'))texture=new THREE.CompressedTexture([{data:bytes,width:tex.width,height:tex.height}],tex.width,tex.height,THREE.RGB_S3TC_DXT1_Format);else texture=new THREE.DataTexture(new Uint8Array(decodeDXT(new DataView(bytes.buffer),tex.width,tex.height,'dxt1')),tex.width,tex.height,THREE.RGBAFormat);}
   else if(tex?.textureFormat===1){const bitmap=await createImageBitmap(new Blob([tex.bytes],{type:'image/jpeg'}));texture=new THREE.Texture(bitmap);}
   else if(tex)throw new TileError('unsupported_texture','Unknown texture format '+tex.textureFormat,{path:descriptor.path});
   if(texture){texture.flipY=false;texture.colorSpace=THREE.NoColorSpace;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.anisotropy=renderer?Math.min(8,renderer.capabilities.getMaxAnisotropy()):1;texture.needsUpdate=true;asset.gpuBytes+=texture.isCompressedTexture?texture.mipmaps[0].data.byteLength:tex.width*tex.height*4;}
   const water=source===node.waterMesh,material=terrainMaterial(texture,texture?0xffffff:water?0x477c9e:0xa8a291);
   const mesh=new THREE.Mesh(geometry,material);mesh.userData.nodePath=descriptor.path;mesh.userData.tileKey=descriptor.key;mesh.userData.surface=water?'water':'terrain';group.add(mesh);asset.meshes.push(mesh);setTerrainPass(mesh,255);
   asset.gpuBytes+=positions.byteLength+uv.byteLength+vertexOctants.byteLength+geometry.index.array.byteLength;
  }
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
