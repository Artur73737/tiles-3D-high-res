// On-screen fly controls for touch devices: a virtual stick (move, analog) and up / down buttons.
// State is read every frame by the fly camera: x = strafe right, y = forward, up / down = climb.
export function createFlyPad(stick,knob,upButton,downButton){
 const state={x:0,y:0,up:false,down:false};
 let id=null,center=null,radius=1;
 const set=(cx,cy)=>{
  let dx=cx-center.x,dy=cy-center.y;const len=Math.hypot(dx,dy);if(len>radius){dx*=radius/len;dy*=radius/len;}
  state.x=dx/radius;state.y=-dy/radius;knob.style.transform=`translate(${dx}px,${dy}px)`;
 };
 const reset=()=>{id=null;state.x=state.y=0;knob.style.transform='';};
 stick.addEventListener('pointerdown',e=>{
  e.preventDefault();e.stopPropagation();if(id!==null)return;id=e.pointerId;try{stick.setPointerCapture(id);}catch{}
  const r=stick.getBoundingClientRect();center={x:r.left+r.width/2,y:r.top+r.height/2};radius=r.width/2-knob.offsetWidth/4;set(e.clientX,e.clientY);
 });
 stick.addEventListener('pointermove',e=>{if(e.pointerId===id){e.preventDefault();set(e.clientX,e.clientY);}});
 for(const t of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(t,e=>{if(e.pointerId===id)reset();});
 const hold=(button,key)=>{
  button.addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();state[key]=true;try{button.setPointerCapture(e.pointerId);}catch{}});
  for(const t of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(t,()=>{state[key]=false;});
 };
 hold(upButton,'up');hold(downButton,'down');
 return {state,reset(){reset();state.up=state.down=false;}};
}
