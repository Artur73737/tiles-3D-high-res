// Fade-in for newly streamed tiles, so detail appears smoothly instead of popping.
// Opacity only: geometry and textures stay at full resolution, and every material gets its
// original opacity and blending back as soon as the fade ends.
const smoothstep=x=>x*x*(3-2*x);

export class FadeIn {
 constructor(durationMs=300){this.durationMs=durationMs;this.items=new Map();}
 add(object,now){
  if(!(this.durationMs>0))return;
  const materials=[];
  object.traverse(o=>{if(!o.material)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){materials.push({m,opacity:m.opacity,transparent:m.transparent});m.transparent=true;m.opacity=0;m.needsUpdate=true;}});
  if(materials.length)this.items.set(object,{start:now,materials});
 }
 update(now){
  for(const [object,item]of this.items){
   const t=Math.min(1,(now-item.start)/this.durationMs),k=smoothstep(Math.max(0,t));
   for(const x of item.materials)x.m.opacity=x.opacity*k;
   if(t>=1)this.finish(object,item);
  }
 }
 finish(object,item=this.items.get(object)){
  if(!item)return;this.items.delete(object);
  for(const x of item.materials){x.m.opacity=x.opacity;if(x.m.transparent!==x.transparent){x.m.transparent=x.transparent;x.m.needsUpdate=true;}}
 }
 // Forget an object that is being disposed (its materials are going away).
 remove(object){this.items.delete(object);}
 get active(){return this.items.size;}
}
