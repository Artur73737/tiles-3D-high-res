import * as THREE from 'three';
import decodeDXT from 'decode-dxt';
import {TileError} from './errors.js';
export function disposeAsset(asset){
 if(!asset||asset.disposed)return;asset.disposed=true;
 asset.group.removeFromParent();asset.group.traverse(object=>{if(!object.isMesh)return;object.geometry.dispose();const materials=Array.isArray(object.material)?object.material:[object.material];for(const material of materials){if(material.map){material.map.image?.close?.();material.map.dispose();}material.dispose();}});
}
export async function buildAsset(node,descriptor,renderer){
 const matrix=node.matrixGlobeFromMesh;if(!matrix||matrix.length!==16||!Array.from(matrix).every(Number.isFinite))throw new TileError('invalid_geometry','Invalid tile transform',{path:descriptor.path});
 const group=new THREE.Group();group.matrixAutoUpdate=false;group.matrix.fromArray(matrix);group.userData.tileKey=descriptor.key;group.userData.nodePath=descriptor.path;
 const asset={group,gpuBytes:0,copyrightIds:node.copyrightIds??[],descriptor,disposed:false};
 try{
  const surfaces=[...node.meshes,...node.overlaySurfaceMeshes];if(node.waterMesh)surfaces.push(node.waterMesh);
  for(const source of surfaces){
   const v=source.vertices,n=v.length/8;if(!Number.isInteger(n))throw new TileError('invalid_geometry','Invalid vertex layout');
   const positions=new Uint8Array(n*3),uv=new Float32Array(n*2);
   for(let i=0;i<n;i++){positions.set(v.subarray(i*8,i*8+3),i*3);const s=source.uvOffsetAndScale;uv[i*2]=s?(v[i*8+4]+v[i*8+5]*256+s[0])*s[2]:0;uv[i*2+1]=s?(v[i*8+6]+v[i*8+7]*256+s[1])*s[3]:0;}
   const strip=source.indices,indices=[];
   // Standard visible terrain/overground layers; hidden and skirt layers are not duplicate surfaces.
   const end=Math.min(source.layerBounds?.[3]??strip.length,strip.length-2);
   for(let i=0;i<end;i++){const a=strip[i],b=strip[i+(i%2?2:1)],c=strip[i+(i%2?1:2)];if(a===b||a===c||b===c)continue;if(a>=n||b>=n||c>=n)throw new TileError('invalid_geometry','Vertex index outside tile');indices.push(a,b,c);}
   if(!indices.length)continue;
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Uint8BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeBoundingSphere();
   let texture=null;const tex=source.texture;
   if(tex?.textureFormat===6){const bytes=new Uint8Array(tex.bytes);if(!renderer||renderer.extensions.has('WEBGL_compressed_texture_s3tc'))texture=new THREE.CompressedTexture([{data:bytes,width:tex.width,height:tex.height}],tex.width,tex.height,THREE.RGB_S3TC_DXT1_Format);else texture=new THREE.DataTexture(new Uint8Array(decodeDXT(new DataView(bytes.buffer),tex.width,tex.height,'dxt1')),tex.width,tex.height,THREE.RGBAFormat);}
   else if(tex?.textureFormat===1){const bitmap=await createImageBitmap(new Blob([tex.bytes],{type:'image/jpeg'}));texture=new THREE.Texture(bitmap);}
   else if(tex)throw new TileError('unsupported_texture','Unknown texture format '+tex.textureFormat,{path:descriptor.path});
   if(texture){texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearFilter;texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.anisotropy=renderer?Math.min(4,renderer.capabilities.getMaxAnisotropy()):1;texture.needsUpdate=true;asset.gpuBytes+=texture.isCompressedTexture?texture.mipmaps[0].data.byteLength:tex.width*tex.height*4;}
   const water=source===node.waterMesh,material=new THREE.MeshBasicMaterial({map:texture,color:texture?0xffffff:water?0x477c9e:0xa8a291,side:THREE.DoubleSide,transparent:water,opacity:water?.75:1});
   const mesh=new THREE.Mesh(geometry,material);mesh.userData.nodePath=descriptor.path;mesh.userData.tileKey=descriptor.key;mesh.userData.surface=water?'water':'terrain';group.add(mesh);
   asset.gpuBytes+=positions.byteLength+uv.byteLength+geometry.index.array.byteLength;
  }
  return asset;
 }catch(error){disposeAsset(asset);throw error;}
}
