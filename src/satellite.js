import * as THREE from 'three';
import {geoToECEF} from './geo.js';
import {SatelliteTileEngine} from './satellite-engine.js';
export {satelliteBounds,SATELLITE_SERVICE} from './satellite-engine.js';
const latitude=y=>Math.atan(Math.sinh(Math.PI*(1-2*y)))*180/Math.PI;

export class SatelliteLayer extends SatelliteTileEngine {
 constructor(options={}){super(options);this.renderer=options.renderer;this.group=new THREE.Group();this.group.name='Satellite 2D';this.matrix=new THREE.Matrix4();this.frustum=new THREE.Frustum();this.cameraPosition=new THREE.Vector3();}
 update(camera){
  if(this.disposed||performance.now()-this.lastUpdate<160)return;
  camera.updateWorldMatrix(true,false);camera.getWorldPosition(this.cameraPosition);this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.matrix);
  const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());this.updateView({position:this.cameraPosition,frustum:this.frustum,pixelScale:size.y/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))});
 }
 setVisible(record,visible){record.visible=visible;record.mesh.visible=visible;}
 isVisible(record){return record.mesh.visible;}
 async createRecord(node,blob){const bitmap=await createImageBitmap(blob,{imageOrientation:'flipY'});try{if(bitmap.width!==256||bitmap.height!==256)throw Error('Invalid satellite tile dimensions');const mesh=this.build(node,bitmap);this.group.add(mesh);return {node,mesh,visible:true,used:performance.now()};}catch(error){bitmap.close();throw error;}}
 disposeRecord(record){const mesh=record.mesh;mesh.removeFromParent();mesh.geometry.dispose();mesh.material.map.image.close();mesh.material.map.dispose();mesh.material.dispose();}
 onDispose(){this.group.removeFromParent();}
 build(node,bitmap){
  const segments=Math.max(4,Math.ceil(64/2**node.z)),positions=[],uv=[],indices=[],n=2**node.z;
  for(let row=0;row<=segments;row++)for(let col=0;col<=segments;col++){
   const u=col/segments,v=row/segments,lat=latitude((node.y+v)/n),lon=(node.x+u)/n*360-180;
   const point=geoToECEF(lat,lon,0,this.radius).sub(node.center);positions.push(point.x,point.y,point.z);uv.push(u,1-v);
  }
  for(let row=0;row<segments;row++)for(let col=0;col<segments;col++){const a=row*(segments+1)+col,b=a+1,c=a+segments+1,d=c+1;indices.push(a,c,b,b,c,d);}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);geometry.computeBoundingSphere();
  const texture=new THREE.Texture(bitmap);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());texture.needsUpdate=true;
  const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.FrontSide,depthTest:false,depthWrite:true});
  const mesh=new THREE.Mesh(geometry,material);mesh.position.copy(node.center);mesh.renderOrder=-1000+node.z;mesh.matrixAutoUpdate=false;mesh.updateMatrix();return mesh;
 }
}
