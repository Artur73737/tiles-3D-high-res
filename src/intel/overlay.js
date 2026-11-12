// Canvas overlay above the map: draws every point layer, the selected feature's track, raster
// layers and the measuring tools, in all three views (through the map view).
//
// Cost control, per frame:
// - only features inside the visible bounds are projected;
// - above `clusterAbove` visible points, or below the layer's `clusterZoom`, points merge into cells
//   of `cell` pixels drawn as one counted bubble;
// - labels appear from `labelZoom` and only where they do not overlap an earlier label;
// - at most `maxPoints` icons per layer.
import {inBounds,padBounds} from '../core/geodesy.js';

const TAU=Math.PI*2;
export const OVERLAY_DEFAULTS={clusterAbove:400,clusterZoom:7,cell:42,labelZoom:9,maxLabels:120,maxPoints:4000,dense:'bubbles',maxDots:20000};

function icon(ctx,shape,x,y,size,color,rotate){
 ctx.save();ctx.translate(x,y);ctx.fillStyle=color;ctx.strokeStyle=color;ctx.lineWidth=1.6;
 const s=size/2;
 switch(shape){
  case 'ring':ctx.globalAlpha=.28;ctx.beginPath();ctx.arc(0,0,s,0,TAU);ctx.fill();ctx.globalAlpha=1;ctx.beginPath();ctx.arc(0,0,s,0,TAU);ctx.stroke();break;
  case 'diamond':ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s,0);ctx.lineTo(0,s);ctx.lineTo(-s,0);ctx.closePath();ctx.fill();ctx.strokeStyle='#000';ctx.lineWidth=1;ctx.stroke();break;
  case 'sat':ctx.fillRect(-s*.35,-s*.35,s*.7,s*.7);ctx.globalAlpha=.85;ctx.fillRect(-s,-s*.18,s*.55,s*.36);ctx.fillRect(s*.45,-s*.18,s*.55,s*.36);break;
  case 'plane':ctx.rotate(((rotate??0)*Math.PI)/180);ctx.beginPath();ctx.moveTo(0,-s);ctx.lineTo(s*.16,-s*.25);ctx.lineTo(s,s*.18);ctx.lineTo(s,s*.36);ctx.lineTo(s*.16,s*.12);ctx.lineTo(s*.12,s*.68);ctx.lineTo(s*.38,s*.92);ctx.lineTo(-s*.38,s*.92);ctx.lineTo(-s*.12,s*.68);ctx.lineTo(-s*.16,s*.12);ctx.lineTo(-s,s*.36);ctx.lineTo(-s,s*.18);ctx.lineTo(-s*.16,-s*.25);ctx.closePath();ctx.fill();ctx.strokeStyle='rgba(0,0,0,.7)';ctx.lineWidth=.8;ctx.stroke();break;
  default:ctx.beginPath();ctx.arc(0,0,s*.6,0,TAU);ctx.fill();
 }
 ctx.restore();
}

export function createOverlay({stage,map,doc,win,settings=OVERLAY_DEFAULTS}){
 const canvas=doc.createElement('canvas');canvas.className='intel-overlay';
 canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';
 stage.insertBefore(canvas,stage.querySelector('.cross'));
 const ctx=canvas.getContext('2d');let hits=[],stats={};

 function resize(){const r=win.devicePixelRatio||1,{w,h}=map.size(),W=Math.round(w*r),H=Math.round(h*r);if(canvas.width!==W||canvas.height!==H){canvas.width=W;canvas.height=H;}ctx.setTransform(r,0,0,r,0,0);return {w,h};}

 function label(text,x,y,taken,color='#fff'){
  if(!text)return;ctx.font='11px ui-monospace,Consolas,monospace';const tw=ctx.measureText(text).width+8,box=[x+9,y-8,tw,16];
  for(const b of taken)if(box[0]<b[0]+b[2]&&b[0]<box[0]+box[2]&&box[1]<b[1]+b[3]&&b[1]<box[1]+box[3])return;taken.push(box);
  ctx.fillStyle='rgba(8,8,8,.78)';ctx.fillRect(box[0],box[1],box[2],box[3]);ctx.fillStyle=color;ctx.fillText(text,box[0]+4,y+4);
 }
 function polyline(points,color,width=2,dash=null){
  ctx.save();ctx.strokeStyle=color;ctx.lineWidth=width;if(dash)ctx.setLineDash(dash);ctx.beginPath();let pen=false,prev=null;
  for(const p of points){const s=map.project(p.lat,p.lon,p.alt??0);if(!s||(prev&&Math.abs(s.x-prev.x)>map.size().w*.6)){pen=false;prev=s;continue;}if(pen)ctx.lineTo(s.x,s.y);else{ctx.moveTo(s.x,s.y);pen=true;}prev=s;}
  ctx.stroke();ctx.restore();
 }

 // layers: [{layer, features}] in draw order. selected: {layer, feature} | null. tools: {draw(ctx,map)}.
 function render({layers,selected,tools,onDirty}){
  const {w,h}=resize();ctx.clearRect(0,0,w,h);hits=[];stats={};
  const kind=map.kind(),view=map.viewport(),zoom=view.zoom,box=padBounds(view,.05),taken=[];
  for(const {layer}of layers)if(layer.kind==='raster'&&(!layer.views||layer.views.includes(kind)))layer.draw(ctx,map,{onDirty});
  if(selected){const t=selected.layer.track?.(selected.feature)??selected.feature.track;if(t?.length>1)polyline(t,'rgba(255,255,255,.75)',1.5,[5,4]);}
  for(const {layer,features}of layers){
   if(layer.kind!=='points'||zoom<layer.minZoom)continue;const s={...settings,...layer.display};
   // Objects high above the ground (satellites) can be seen beyond the visible ground: projection decides.
   const vis=[];for(const f of features){if(!(kind!=='flat2d'&&(f.alt??0)>100e3)&&!inBounds(box,f.lat,f.lon))continue;const p=map.project(f.lat,f.lon,kind==='flat2d'?0:f.alt??0);if(!p||p.x<-20||p.y<-20||p.x>w+20||p.y>h+20)continue;vis.push([f,p]);}
   const st0=stats[layer.id]={visible:vis.length,icons:0,clusters:0,labels:0,dots:0};
   const dense=vis.length>s.clusterAbove||zoom<s.clusterZoom&&vis.length>40;
   // Very dense layers (satellite constellations): a 2 px dot each shows the real distribution and stays
   // cheap; each dot remains clickable. Sparser layers merge into counted bubbles.
   if(dense&&s.dense==='dots'){
    let last='';for(const [f,p]of vis){if(st0.dots>=s.maxDots)break;const c=layer.dotColor?layer.dotColor(f):layer.style(f).color;if(c!==last){ctx.fillStyle=c;last=c;}ctx.fillRect(p.x-1,p.y-1,2,2);hits.push({x:p.x,y:p.y,r:5,layer,feature:f});st0.dots++;}
    continue;
   }
   if(dense){
    const cells=new Map();for(const [f,p]of vis){const k=Math.floor(p.x/s.cell)+','+Math.floor(p.y/s.cell);let c=cells.get(k);if(!c)cells.set(k,c={n:0,x:0,y:0,f,color:layer.style(f).color});c.n++;c.x+=p.x;c.y+=p.y;}
    for(const c of cells.values()){const x=c.x/c.n,y=c.y/c.n;if(c.n===1){const st=layer.style(c.f);icon(ctx,st.shape,x,y,st.size,st.color,st.rotate);hits.push({x,y,r:st.size/2+6,layer,feature:c.f});st0.icons++;continue;}
     const r=Math.min(16,8+Math.log2(c.n)*1.8);ctx.fillStyle=c.color;ctx.globalAlpha=.85;ctx.beginPath();ctx.arc(x,y,r,0,TAU);ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle='rgba(0,0,0,.6)';ctx.lineWidth=1;ctx.stroke();
     ctx.fillStyle='#000';ctx.font='600 11px ui-monospace,Consolas,monospace';ctx.textAlign='center';ctx.fillText(c.n>999?(c.n/1000).toFixed(1)+'k':String(c.n),x,y+4);ctx.textAlign='left';hits.push({x,y,r,layer,cluster:c.n});st0.clusters++;}
    continue;
   }
   let n=0;const labels=zoom>=s.labelZoom;
   for(const [f,p]of vis){if(n++>=s.maxPoints)break;const st=layer.style(f);icon(ctx,st.shape,p.x,p.y,st.size,st.color,st.rotate);hits.push({x:p.x,y:p.y,r:st.size/2+6,layer,feature:f});st0.icons++;if(labels&&taken.length<s.maxLabels){const n0=taken.length;label(layer.title(f),p.x,p.y,taken);if(taken.length>n0)st0.labels++;}}
  }
  if(selected){const f=selected.feature,p=map.project(f.lat,f.lon,kind==='flat2d'?0:f.alt??0);if(p){ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,13,0,TAU);ctx.stroke();}}
  tools?.draw(ctx,map,{label:(t,x,y)=>label(t,x,y,taken,'#fff'),polyline});
 }
 // Nearest drawn item under a screen point (features before clusters).
 function hit(x,y){let best=null,bd=Infinity;for(const h of hits){const d=Math.hypot(h.x-x,h.y-y);if(d<=h.r&&d<bd){bd=d;best=h;}}return best;}
 return {canvas,render,hit,get stats(){return stats;},dispose(){canvas.remove();}};
}
