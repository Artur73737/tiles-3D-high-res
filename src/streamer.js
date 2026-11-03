import {Group,Vector3,Vector2,Matrix4,Frustum} from 'three';
import {TerrainTileEngine} from './terrain-engine.js';
import {buildAsset,disposeAsset} from './geometry.js';
export {viewDetailScore} from './terrain-engine.js';

// Rendering adapter only. Traversal, requests, transitions and retention belong to the core.
export class EarthHQStreaming extends TerrainTileEngine {
 constructor(options={}){super({radiusMeters:70,retainRadiusMeters:150,screenSpaceError:0,...options});this.renderer=options.renderer;this.group=new Group();this.group.name='Earth HQ streaming';}
 onPlanet(planet){this.group.userData.planetRadius=planet.radius;}
 createAsset(decoded,node){return buildAsset(decoded,node,this.renderer);}
 disposeAsset(asset){disposeAsset(asset);}
 onAssetLoaded(asset){for(const mesh of asset.meshes)mesh.userData.planetRoot=this.group;this.group.add(asset.group);}
 onDispose(){this.group.removeFromParent();}
 update(camera,options={}){
  if(this.disposed||!this.enabled||!this.planet)return;
  this.group.updateWorldMatrix(true,false);const inverse=new Matrix4().copy(this.group.matrixWorld).invert(),position=camera.getWorldPosition(new Vector3()).applyMatrix4(inverse);
  camera.updateMatrixWorld(true);const projection=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(this.group.matrixWorld),width=this.renderer?.getDrawingBufferSize(new Vector2()).x??1080*camera.aspect;
  this.updateView({projection,position,direction:camera.getWorldDirection(new Vector3()).transformDirection(inverse),frustum:new Frustum().setFromProjectionMatrix(projection),pixelScale:width*camera.projectionMatrix.elements[0]/2},options);
 }
}
