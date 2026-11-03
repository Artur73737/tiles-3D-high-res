// Small CPU-only geometry types. No scene, DOM, WebGL or renderer dependency.
export class Vector3 {
 constructor(x=0,y=0,z=0){this.x=x;this.y=y;this.z=z;}
 set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
 copy(v){return this.set(v.x??v[0],v.y??v[1],v.z??v[2]);}
 clone(){return new Vector3(this.x,this.y,this.z);}
 fromArray(a,i=0){return this.set(a[i],a[i+1],a[i+2]);}
 toArray(a=[],i=0){a[i]=this.x;a[i+1]=this.y;a[i+2]=this.z;return a;}
 add(v){return this.set(this.x+v.x,this.y+v.y,this.z+v.z);}
 sub(v){return this.set(this.x-v.x,this.y-v.y,this.z-v.z);}
 multiplyScalar(s){return this.set(this.x*s,this.y*s,this.z*s);}
 addScaledVector(v,s){return this.set(this.x+v.x*s,this.y+v.y*s,this.z+v.z*s);}
 dot(v){return this.x*v.x+this.y*v.y+this.z*v.z;}
 lengthSq(){return this.dot(this);}
 length(){return Math.sqrt(this.lengthSq());}
 normalize(){return this.multiplyScalar(1/(this.length()||1));}
 distanceToSquared(v){return (this.x-v.x)**2+(this.y-v.y)**2+(this.z-v.z)**2;}
 distanceTo(v){return Math.sqrt(this.distanceToSquared(v));}
 equals(v){return this.x===v.x&&this.y===v.y&&this.z===v.z;}
 cross(v){return this.crossVectors(this.clone(),v);}
 crossVectors(a,b){return this.set(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x);}
 applyMatrix4(m){const e=m.elements??m,x=this.x,y=this.y,z=this.z,w=1/(e[3]*x+e[7]*y+e[11]*z+e[15]);return this.set((e[0]*x+e[4]*y+e[8]*z+e[12])*w,(e[1]*x+e[5]*y+e[9]*z+e[13])*w,(e[2]*x+e[6]*y+e[10]*z+e[14])*w);}
}
export class Matrix4 {
 constructor(){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];}
 copy(m){this.elements=Array.from(m.elements??m);return this;}
 clone(){return new Matrix4().copy(this);}
 multiplyMatrices(a,b){const x=a.elements,y=b.elements,e=[];for(let c=0;c<4;c++)for(let r=0;r<4;r++)e[c*4+r]=x[r]*y[c*4]+x[4+r]*y[c*4+1]+x[8+r]*y[c*4+2]+x[12+r]*y[c*4+3];this.elements=e;return this;}
}
class Plane {
 constructor(x,y,z,w){const length=Math.hypot(x,y,z);this.normal=new Vector3(x/length,y/length,z/length);this.constant=w/length;}
 distanceToPoint(p){return this.normal.dot(p)+this.constant;}
}
export class Frustum {
 setFromProjectionMatrix(m){const e=m.elements;this.planes=[new Plane(e[3]-e[0],e[7]-e[4],e[11]-e[8],e[15]-e[12]),new Plane(e[3]+e[0],e[7]+e[4],e[11]+e[8],e[15]+e[12]),new Plane(e[3]+e[1],e[7]+e[5],e[11]+e[9],e[15]+e[13]),new Plane(e[3]-e[1],e[7]-e[5],e[11]-e[9],e[15]-e[13]),new Plane(e[3]-e[2],e[7]-e[6],e[11]-e[10],e[15]-e[14]),new Plane(e[3]+e[2],e[7]+e[6],e[11]+e[10],e[15]+e[14])];return this;}
 intersectsSphere(s){return this.planes.every(p=>p.distanceToPoint(s.center)>=-s.radius);}
}
export class EventDispatcher {
 addEventListener(type,listener){this.listeners??=new Map();if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
 removeEventListener(type,listener){this.listeners?.get(type)?.delete(listener);}
 hasEventListener(type,listener){return this.listeners?.get(type)?.has(listener)??false;}
 dispatchEvent(event){event.target=this;try{for(const listener of [...this.listeners?.get(event.type)??[]])listener.call(this,event);}finally{event.target=null;}}
}
