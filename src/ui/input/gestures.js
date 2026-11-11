// Touch gestures on one element: one finger pans; two fingers pan (midpoint), pinch (scale) and
// twist (rotation). Only pointers accepted by `filter` are tracked (default: touch), so mouse
// handling elsewhere is untouched. Adding or lifting a finger re-anchors, so nothing jumps.
export function trackGestures(el,{filter=e=>e.pointerType==='touch',onStart,onPan,onPinch,onEnd}={}){
 const pts=new Map();let prev=null;
 const snap=()=>{
  const a=[...pts.values()];if(!a.length)return null;
  if(a.length===1)return {n:1,x:a[0].x,y:a[0].y};
  const [p,q]=a;return {n:2,x:(p.x+q.x)/2,y:(p.y+q.y)/2,d:Math.max(1,Math.hypot(q.x-p.x,q.y-p.y)),a:Math.atan2(q.y-p.y,q.x-p.x)};
 };
 const local=e=>{const r=el.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
 const down=e=>{
  if(!filter(e)||pts.size>=2)return;
  e.preventDefault();try{el.setPointerCapture(e.pointerId);}catch{}
  pts.set(e.pointerId,local(e));prev=snap();onStart?.(prev,e);
 };
 const move=e=>{
  if(!pts.has(e.pointerId))return;e.preventDefault();
  pts.set(e.pointerId,local(e));const cur=snap();
  if(prev&&cur&&prev.n===cur.n){
   onPan?.(cur.x-prev.x,cur.y-prev.y,cur.n,cur);
   if(cur.n===2){let da=cur.a-prev.a;if(da>Math.PI)da-=2*Math.PI;if(da<-Math.PI)da+=2*Math.PI;onPinch?.({scale:cur.d/prev.d,rotate:da,x:cur.x,y:cur.y});}
  }
  prev=cur;
 };
 const up=e=>{if(!pts.delete(e.pointerId))return;prev=snap();if(!pts.size)onEnd?.(e);};
 el.addEventListener('pointerdown',down);el.addEventListener('pointermove',move);
 el.addEventListener('pointerup',up);el.addEventListener('pointercancel',up);
 return {
  get active(){return pts.size;},
  dispose(){el.removeEventListener('pointerdown',down);el.removeEventListener('pointermove',move);el.removeEventListener('pointerup',up);el.removeEventListener('pointercancel',up);pts.clear();},
 };
}
