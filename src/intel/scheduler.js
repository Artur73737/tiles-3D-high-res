// Loads layer data in batches that follow the view, so panning and zooming never flood the network.
//
// - Nothing loads while the camera moves: a request starts once the view has been still for settleMs.
// - Viewport layers load a box snapped to a tile grid whose level follows the zoom (one level per
//   zoom step, a few levels coarser than the view). Small pans stay inside the same cells and reuse
//   the data; a request is made only when the snapped box changes or the refresh interval passes.
// - Global layers load once, then on their refresh interval.
// - One request per layer at a time; a newer request aborts the older one.
import {padBounds} from '../core/geodesy.js';

const tileOf=(lat,lon,z)=>{const n=2**z,s=Math.sin(Math.max(-85.05,Math.min(85.05,lat))*Math.PI/180);return {x:Math.floor((lon+180)/360*n),y:Math.floor((.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n)};};
const tileLon=(x,z)=>x/2**z*360-180,tileLat=(y,z)=>Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))*180/Math.PI;

// Visible bounds expanded and snapped to whole grid cells at level g.
export function snapBounds(b,zoom,{gridOffset=3,gridMin=1,gridMax=12}={}){
 const g=Math.max(gridMin,Math.min(gridMax,Math.floor(zoom)-gridOffset)),p=padBounds(b,.15);
 if(p.west>p.east||p.east-p.west>=359)return {key:g+':world',grid:g,bounds:{south:p.south,north:p.north,west:-180,east:180}};
 const a=tileOf(p.north,p.west,g),c=tileOf(p.south,p.east,g),n=2**g-1,x0=Math.max(0,a.x),x1=Math.min(n,c.x),y0=Math.max(0,a.y),y1=Math.min(n,c.y);
 return {key:`${g}:${x0}-${x1}:${y0}-${y1}`,grid:g,bounds:{west:tileLon(x0,g),east:tileLon(x1+1,g),north:tileLat(y0,g),south:tileLat(y1+1,g)}};
}

export function createScheduler({viewport,now=()=>performance.now(),settleMs=450,onData,onError,onState}){
 const slots=new Map();let lastView='',stillSince=0;
 const slot=layer=>{let s=slots.get(layer.id);if(!s){s={layer,features:[],key:null,loadedAt:-Infinity,ctl:null,status:'idle',error:null};slots.set(layer.id,s);}return s;};
 const set=(s,status,error=null)=>{s.status=status;s.error=error;onState?.(s.layer,status,error);};

 async function run(s,view,snap){
  s.ctl?.abort();const ctl=s.ctl=new AbortController();set(s,'loading');
  try{
   const features=await s.layer.load({bounds:snap?.bounds??view,zoom:view.zoom,center:view.center,signal:ctl.signal,options:s.layer.options});
   if(ctl.signal.aborted)return;s.features=features;s.key=snap?.key??'global';s.loadedAt=now();set(s,'ready');onData?.(s.layer,features);
  // A failed load retries after 30 s (or the refresh interval if shorter), not after a full interval.
  }catch(e){if(e?.name==='AbortError'||ctl.signal.aborted)return;s.loadedAt=now()-s.layer.refreshMs+Math.min(30000,s.layer.refreshMs);set(s,'error',e);onError?.(s.layer,e);}
  finally{if(s.ctl===ctl)s.ctl=null;}
 }

 // Called every animation frame with the enabled layers; cheap when nothing is due.
 function tick(layers){
  const t=now(),view=viewport();if(!view)return;
  const sig=`${view.zoom.toFixed(1)}|${view.south.toFixed(3)}|${view.west.toFixed(3)}|${view.north.toFixed(3)}|${view.east.toFixed(3)}`;
  if(sig!==lastView){lastView=sig;stillSince=t;}
  const still=t-stillSince>=settleMs;
  for(const layer of layers){
   const s=slot(layer);if(s.ctl)continue;
   if(view.zoom<layer.minZoom){if(s.status!=='zoom')set(s,'zoom');continue;}
   const due=t-s.loadedAt>=layer.refreshMs;
   if(layer.scope==='global'){if(due&&(still||s.loadedAt===-Infinity))run(s,view,null);continue;}
   if(!still)continue;
   const snap=snapBounds(view,view.zoom,layer.grid);
   if(snap.key!==s.key||due)run(s,view,snap);
  }
 }
 return {
  tick,
  features:id=>slots.get(id)?.features??[],
  state:id=>{const s=slots.get(id);return s?{status:s.status,error:s.error?.message??null,count:s.features.length,loadedAt:s.loadedAt}:{status:'off',error:null,count:0};},
  // Forget a layer's data (disabled or options changed): the next tick reloads it.
  reset(id){const s=slots.get(id);if(!s)return;s.ctl?.abort();s.ctl=null;s.features=[];s.key=null;s.loadedAt=-Infinity;set(s,'idle');},
  dispose(){for(const s of slots.values())s.ctl?.abort();slots.clear();},
 };
}
