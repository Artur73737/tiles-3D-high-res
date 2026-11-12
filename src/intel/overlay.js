// Canvas overlay above the map: draws every point layer, the selected feature's track, raster
// layers and the measuring tools, in all three views (through the map view).
//
// Granularity, per frame:
// - only features inside the visible bounds are projected;
// - points are thinned on a grid anchored to the map (Web Mercator pixels at the integer zoom), one
//   object per `cell` pixels: the one with the highest rank (layer.rank, else a stable hash of its id).
//   Cells halve at each zoom step, so zooming in only adds objects and the ones shown never jump around;
// - dense layers that opt in (satellites) are drawn as 2 px dots instead;
// - labels appear from `labelZoom` and only where they do not overlap an earlier label.
import {inBounds,padBounds} from '../core/geodesy.js';

const TAU=Math.PI*2;
export const OVERLAY_DEFAULTS={cell:30,labelZoom:9,maxLabels:120,maxPoints:4000,dense:'icons',dotsAbove:600,maxDots:20000};
// Stable rank in [0,1) from an id, so the same object wins its cell frame after frame.
export function idRank(id){let h=2166136261;const s=String(id);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0)/4294967296;}
const mercY=lat=>{const t=Math.sin(Math.max(-85.05,Math.min(85.05,lat))*Math.PI/180);return .5-Math.log((1+t)/(1-t))/(4*Math.PI);};
// Keeps one entry per map-anchored grid cell (Web Mercator pixels at the integer zoom), the highest rank.
// entries: [feature, ...rest]; rank(feature) -> number; keep: feature that always wins its cell.
export function thinByGrid(entries,{zoom,cell,rank=f=>idRank(f.id),keep=null}){
 const scale=256*2**Math.max(0,Math.floor(zoom)),best=new Map();
 for(const e of entries){const f=e[0],k=Math.floor((f.lon+180)/360*scale/cell)+','+Math.floor(mercY(f.lat)*scale/cell),r=f===keep?Infinity:rank(f),cur=best.get(k);if(!cur||r>cur.r)best.set(k,{e,r});}
 return [...best.values()].map(x=>x.e);
}
// Selection reticle: four corner brackets and four short ticks, white with a dark edge.
function reticle(ctx,x,y){
 ctx.save();ctx.translate(Math.round(x)+.5,Math.round(y)+.5);const r=15,l=6,t=4;
 for(const [w,c]of [[3,'rgba(0,0,0,.55)'],[1.25,'#fff']]){ctx.lineWidth=w;ctx.strokeStyle=c;ctx.beginPath();
  for(const [sx,sy]of [[-1,-1],[1,-1],[1,1],[-1,1]]){ctx.moveTo(sx*r,sy*(r-l));ctx.lineTo(sx*r,sy*r);ctx.lineTo(sx*(r-l),sy*r);}
  ctx.moveTo(0,-r-t);ctx.lineTo(0,-r+1);ctx.moveTo(0,r-1);ctx.lineTo(0,r+t);ctx.moveTo(-r-t,0);ctx.lineTo(-r+1,0);ctx.moveTo(r-1,0);ctx.lineTo(r+t,0);ctx.stroke();}
 ctx.restore();
}

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

 // dx: gap between the point and the label (larger for the selected object, clear of the reticle).
 function label(text,x,y,taken,color='#fff',dx=9){
  if(!text)return;ctx.font='11px ui-monospace,Consolas,monospace';const tw=ctx.measureText(text).width+8,box=[x+dx,y-8,tw,16];
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
   const st0=stats[layer.id]={visible:vis.length,icons:0,thinned:0,labels:0,dots:0};
   // Dense constellations: every object as a 2 px dot (still clickable).
   if(s.dense==='dots'&&vis.length>s.dotsAbove){
    let last='';for(const [f,p]of vis){if(st0.dots>=s.maxDots)break;const c=layer.dotColor?layer.dotColor(f):layer.style(f).color;if(c!==last){ctx.fillStyle=c;last=c;}ctx.fillRect(p.x-1,p.y-1,2,2);hits.push({x:p.x,y:p.y,r:5,layer,feature:f});st0.dots++;}
    continue;
   }
   // One object per map-anchored cell, highest rank wins; the selected object is always kept.
   const kept=thinByGrid(vis,{zoom,cell:s.cell,rank:layer.rank?f=>layer.rank(f):undefined,keep:selected?.layer===layer?selected.feature:null});
   st0.thinned=vis.length-kept.length;
   let n=0;const labels=zoom>=s.labelZoom;
   for(const [f,p]of kept){if(n++>=s.maxPoints)break;const st=layer.style(f);icon(ctx,st.shape,p.x,p.y,st.size,st.color,st.rotate);hits.push({x:p.x,y:p.y,r:st.size/2+6,layer,feature:f});st0.icons++;const isSel=selected?.layer===layer&&selected.feature===f;if((labels||isSel)&&taken.length<s.maxLabels){const n0=taken.length;label(layer.title(f),p.x,p.y,taken,'#fff',isSel?24:9);if(taken.length>n0)st0.labels++;}}
  }
  if(selected){const f=selected.feature,p=map.project(f.lat,f.lon,kind==='flat2d'?0:f.alt??0);if(p)reticle(ctx,p.x,p.y);}
  tools?.draw(ctx,map,{label:(t,x,y)=>label(t,x,y,taken,'#fff'),polyline});
 }
 // Nearest drawn object under a screen point.
 function hit(x,y){let best=null,bd=Infinity;for(const h of hits){const d=Math.hypot(h.x-x,h.y-y);if(d<=h.r&&d<bd){bd=d;best=h;}}return best;}
 return {canvas,render,hit,get stats(){return stats;},dispose(){canvas.remove();}};
}
