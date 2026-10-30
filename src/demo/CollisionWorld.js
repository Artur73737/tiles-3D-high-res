import {BufferGeometry,BufferAttribute,Box3,Vector3,Line3,Triangle,DoubleSide} from 'three';
import {MeshBVH,CENTER} from 'three-mesh-bvh';

export class CollisionWorld {
 constructor(geometries){
  let vertices=0,indices=0;
  for(const geometry of geometries){vertices+=geometry.attributes.position.count;indices+=geometry.index.count;}
  const positions=new Float32Array(vertices*3),index=new Uint32Array(indices);
  let vertexOffset=0,indexOffset=0;
  for(const geometry of geometries){
   positions.set(geometry.attributes.position.array,vertexOffset*3);
   const source=geometry.index.array;
   for(let i=0;i<source.length;i++)index[indexOffset+i]=source[i]+vertexOffset;
   vertexOffset+=geometry.attributes.position.count;indexOffset+=source.length;
  }
  this.geometry=new BufferGeometry();this.geometry.setAttribute('position',new BufferAttribute(positions,3));this.geometry.setIndex(new BufferAttribute(index,1));
  this.bvh=new MeshBVH(this.geometry,{strategy:CENTER,maxLeafTris:12});
  this.segment=new Line3();this.box=new Box3();this.onTriangle=new Vector3();this.onCapsule=new Vector3();this.direction=new Vector3();
 }
 rayIntersect(ray){
  const hit=this.bvh.raycastFirst(ray,DoubleSide);
  if(!hit)return false;
  const p=this.geometry.attributes.position,f=hit.face;
  const triangle=new Triangle(new Vector3().fromBufferAttribute(p,f.a),new Vector3().fromBufferAttribute(p,f.b),new Vector3().fromBufferAttribute(p,f.c));
  return {position:hit.point,distance:hit.distance,triangle};
 }
 capsuleIntersect(capsule){
  const segment=this.segment;segment.start.copy(capsule.start);segment.end.copy(capsule.end);
  this.box.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end).expandByScalar(capsule.radius);
  let collided=false;
  this.bvh.shapecast({
   intersectsBounds:box=>box.intersectsBox(this.box),
   intersectsTriangle:triangle=>{
    const distance=triangle.closestPointToSegment(segment,this.onTriangle,this.onCapsule);
    if(distance>=capsule.radius)return false;
    collided=true;
    this.direction.copy(this.onCapsule).sub(this.onTriangle);
    if(distance<1e-8){
     triangle.getNormal(this.direction);
     const center=segment.start.clone().add(segment.end).multiplyScalar(.5);
     if(this.direction.dot(center.sub(triangle.a))<0)this.direction.negate();
    }else this.direction.multiplyScalar(1/distance);
    const depth=capsule.radius-distance;
    segment.start.addScaledVector(this.direction,depth);segment.end.addScaledVector(this.direction,depth);
    return false;
   }
  });
  if(!collided)return false;
  const displacement=segment.start.clone().sub(capsule.start),depth=displacement.length();
  return depth>1e-8?{normal:displacement.multiplyScalar(1/depth),depth}:false;
 }
}
