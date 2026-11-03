import {Vector3,Matrix4,Frustum} from './math.js';
import {TileError} from './errors.js';
const vector=(value,name)=>{const v=new Vector3().copy(value??[]);if(!v.toArray().every(Number.isFinite)||!v.lengthSq())throw new TileError('invalid_view','Invalid '+name);return v;};
// ECEF metres, column-major matrices, WebGL clip depth [-1,+1], drawing-buffer pixels.
export function createView({position,direction,up,viewProjection,projection,pixelScale,viewportWidth,viewportHeight,fovYDegrees=52,near=.1,far=150000000}={}){
 position=vector(position,'position');direction=vector(direction,'direction').normalize();
 let matrix;
 if(viewProjection||projection){matrix=new Matrix4().copy(viewProjection??projection);if(matrix.elements.length!==16||!matrix.elements.every(Number.isFinite))throw new TileError('invalid_view','Invalid view-projection matrix');}
 else{
  if(!(viewportWidth>0&&viewportHeight>0&&Number.isFinite(viewportWidth)&&Number.isFinite(viewportHeight)&&fovYDegrees>0&&fovYDegrees<180&&near>0&&far>near&&Number.isFinite(far)))throw new TileError('invalid_view','Invalid perspective viewport');
  const right=direction.clone().cross(vector(up,'up')).normalize();if(right.lengthSq()<1e-20)throw new TileError('invalid_view','Up and direction are parallel');
  const vertical=right.clone().cross(direction),v=new Matrix4(),p=new Matrix4(),cot=1/Math.tan(fovYDegrees*Math.PI/360);
  v.elements=[right.x,vertical.x,-direction.x,0,right.y,vertical.y,-direction.y,0,right.z,vertical.z,-direction.z,0,-right.dot(position),-vertical.dot(position),direction.dot(position),1];
  p.elements=[cot*viewportHeight/viewportWidth,0,0,0,0,cot,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0];
  matrix=new Matrix4().multiplyMatrices(p,v);pixelScale=viewportHeight*cot/2;
 }
 if(!Number.isFinite(pixelScale)||pixelScale<=0)throw new TileError('invalid_view','A matrix view needs a positive pixelScale');
 const frustum=new Frustum().setFromProjectionMatrix(matrix);if(!frustum.planes.every(p=>p.normal.toArray().every(Number.isFinite)&&Number.isFinite(p.constant)))throw new TileError('invalid_view','Degenerate clipping matrix');
 return {position,direction,projection:matrix,pixelScale,frustum};
}
