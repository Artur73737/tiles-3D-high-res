import {Vector3,Ray} from 'three';
import {Capsule} from 'three/addons/math/Capsule.js';

export class Explorer {
 constructor(world,bounds){
  this.world=world;this.bounds=bounds;this.radius=.28;this.height=1.72;
  this.capsule=new Capsule(new Vector3(),new Vector3(),this.radius);
  this.velocity=new Vector3();this.grounded=false;this.flying=false;this.flightMultiplier=1;
  this.lastSpace=-Infinity;this.safe=new Vector3();this.spawn=new Vector3();
  this.spawnIsGround=false;this.contactCount=0;this.edgeBlocked=false;this.jumpQueued=false;
 }
 get feet(){return new Vector3(this.capsule.start.x,this.capsule.start.y-this.radius,this.capsule.start.z);}
 get eye(){return this.feet.add(new Vector3(0,1.63,0));}
 place(feet){
  this.capsule.start.copy(feet).add(new Vector3(0,this.radius,0));
  this.capsule.end.copy(feet).add(new Vector3(0,this.height-this.radius,0));
  this.velocity.set(0,0,0);
 }
 ground(x,z,from=this.bounds.max[1]+20){
  const hit=this.world.rayIntersect(new Ray(new Vector3(x,from,z),new Vector3(0,-1,0)));
  if(!hit)return null;
  const normal=hit.triangle.getNormal(new Vector3());
  return normal.y>.55?hit.position:null;
 }
 findSpawn(centre=this.feet){
  const candidates=[];
  for(const z of [0,3,-3,8,-8,15,-15])for(const x of [0,-3,3,-8,8,-15,15]){
   const p=this.ground(centre.x+x,centre.z+z);if(p)candidates.push(p);
  }
  if(!candidates.length)throw Error('No walkable surface found in the available tiles.');
  // Favor the exterior plaza, away from rooftop surfaces.
  const low=Math.min(...candidates.map(p=>p.y));
  const visible=candidates.filter(p=>{
   const direction=new Vector3(centre.x-p.x,0,centre.z-p.z).normalize();
   const hit=this.world.rayIntersect(new Ray(p.clone().add(new Vector3(0,1.6,0)),direction));
   return !hit||hit.distance>12;
  });
  const good=(visible.length?visible:candidates).filter(p=>p.y<low+5).sort((a,b)=>Math.hypot(a.x-centre.x,a.z-centre.z)-Math.hypot(b.x-centre.x,b.z-centre.z));
  if(!good.length)good.push(...candidates.sort((a,b)=>a.y-b.y));
  this.spawnIsGround=true;this.spawn.copy(good[0]);this.spawn.y+=.025;
  this.reset();return this.spawn;
 }
 adjustFlightSpeed(delta){if(this.flying&&Number.isFinite(delta)&&delta!==0)this.flightMultiplier=Math.max(1,Math.min(16,this.flightMultiplier*(delta<0?1.25:.8)));return this.flightMultiplier;}
 reset(){this.place(this.spawn);this.safe.copy(this.spawn);this.flying=!this.spawnIsGround;this.grounded=this.spawnIsGround;this.lastSpace=-Infinity;}
 space(time){
  if(time-this.lastSpace<310){this.flying=!this.flying;this.velocity.set(0,0,0);this.jumpQueued=false;this.lastSpace=-Infinity;return true;}
  this.lastSpace=time;if(!this.flying&&this.grounded)this.jumpQueued=true;return false;
 }
 resolve(){
  let floor=false;
  for(let i=0;i<4;i++){
   const contact=this.world.capsuleIntersect(this.capsule);
   if(!contact||contact.depth<.000001)break;
   this.contactCount++;
   const n=contact.normal;
   if(n.y>.55)floor=true;
   const into=this.velocity.dot(n);if(into<0)this.velocity.addScaledVector(n,-into);
   this.capsule.translate(n.clone().multiplyScalar(contact.depth+.00005));
  }
  return floor;
 }
 step(dt,keys,yaw){
  this.edgeBlocked=false;
  const forward=new Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
  const right=new Vector3(Math.cos(yaw),0,-Math.sin(yaw));
  const wish=new Vector3().addScaledVector(forward,Number(!!keys.KeyW)-Number(!!keys.KeyS)).addScaledVector(right,Number(!!keys.KeyD)-Number(!!keys.KeyA));
  if(wish.lengthSq()>1)wish.normalize();
  const speed=(this.flying?8*this.flightMultiplier:3.1)*(keys.sprint?3:1);
  const blend=1-Math.exp(-12*dt);
  this.velocity.x+=(wish.x*speed-this.velocity.x)*blend;
  this.velocity.z+=(wish.z*speed-this.velocity.z)*blend;
  if(this.flying){
   this.velocity.y=((keys.Space?1:0)-(keys.ShiftLeft||keys.ShiftRight?1:0))*6*this.flightMultiplier;
   this.jumpQueued=false;
  }else{
   if(this.jumpQueued){this.velocity.y=5.1;this.grounded=false;this.jumpQueued=false;}
   this.velocity.y-=18*dt;
  }
  const previous=this.feet,wasGrounded=this.grounded;
  const delta=this.velocity.clone().multiplyScalar(dt);
  if(!this.flying&&wasGrounded&&this.velocity.y<=0){
   const support=this.ground(previous.x+delta.x,previous.z+delta.z,previous.y+.5);
   if(!support||previous.y-support.y>1.0){delta.x=delta.z=0;this.velocity.x=this.velocity.z=0;this.edgeBlocked=true;}
  }
  this.capsule.translate(delta);
  this.grounded=this.resolve();
  // Small photogrammetry steps should not stop an otherwise grounded walk.
  const moved=this.feet.clone().sub(previous);moved.y=0;
  if(!this.flying&&wasGrounded&&this.velocity.y<=0&&delta.clone().setY(0).length()>.001&&moved.length()<delta.clone().setY(0).length()*.3){
   const before=this.feet;
   this.place(previous.clone().add(new Vector3(delta.x,.28,delta.z)));
   this.resolve();
   const after=this.feet,support=this.ground(after.x,after.z,after.y+.02);
   if(support&&after.y-support.y<.35&&after.clone().sub(previous).setY(0).length()>moved.length()+.001){
    this.place(support.clone().add(new Vector3(0,.002,0)));this.grounded=this.resolve()||true;
   }else this.place(before);
  }
  if(!this.flying&&this.velocity.y<=0){
   const feet=this.feet,p=this.ground(feet.x,feet.z,feet.y+.08);
   if(p&&feet.y-p.y<.11&&feet.y>=p.y-.02){
    this.capsule.translate(new Vector3(0,p.y-feet.y+.0005,0));this.velocity.y=0;this.grounded=true;
   }
  }
  if(this.grounded&&!this.flying)this.safe.copy(this.feet);
  if(this.feet.y<this.bounds.min[1]-18){this.place(this.safe);this.grounded=true;}
 }
}
