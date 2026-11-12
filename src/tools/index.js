// Measuring and annotation tools: state, clicks, results and drawing on the overlay.
// The tool set does not know about cameras: it works through the map view (pick / project / sight).
import {TOOLS,distanceResult,areaResult,heightResult,profileResult,sightResult} from './measure.js';
import {toGeoJSON,toKML,parseGeo} from './geoformat.js';
import {formatDistance} from '../core/geodesy.js';

const COLORS={distance:'#ffd60a',area:'#30d158',height:'#64d2ff',profile:'#ff9f0a',sight:'#bf5af2',marker:'#ff375f'};

export function createTools({map,onChange}){
 let active=null,draft=[],items=[],seq=0,selected=null;const busy=new Map();
 const changed=()=>onChange?.();
 const nameFor=type=>TOOLS[type].label+' '+(items.filter(i=>i.type===type).length+1);

 async function compute(it){
  if(it.type==='distance')it.result=distanceResult(it.points);
  else if(it.type==='area')it.result=areaResult(it.points);
  else if(it.type==='height')it.result=heightResult(it.points);
  else if(it.type==='marker'){const p=it.points[0];it.result={text:`${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`+(p.alt?` · ${p.alt.toFixed(1)} m`:'')};}
  else{
   // Profile / line of sight need elevation (3D surface or terrain service): async, cancellable.
   busy.get(it.id)?.abort();const ctl=new AbortController();busy.set(it.id,ctl);it.result={text:'Computing…',pending:true};changed();
   try{it.result=it.type==='profile'?await profileResult(map,it.points,{signal:ctl.signal}):await sightResult(map,it.points,{signal:ctl.signal});}
   catch(e){if(e?.name==='AbortError')return;it.result={text:'Failed: '+e.message,error:true};}
   finally{if(busy.get(it.id)===ctl)busy.delete(it.id);}
  }
  changed();
 }
 function commit(){
  const t=TOOLS[active];if(!t||draft.length<t.min)return false;
  const it={id:++seq,type:active,name:nameFor(active),points:draft,color:COLORS[active]};items.push(it);draft=[];selected=it.id;compute(it);changed();return true;
 }
 return {
  get active(){return active;},get draft(){return draft;},get items(){return items;},get selected(){return selected;},
  start(type){if(type&&!TOOLS[type])throw new Error('Unknown tool '+type);active=type===active?null:type;draft=[];changed();},
  cancel(){draft=[];active=null;changed();},
  // Ends the current drawing; the tool stays active for the next measurement.
  finish(){const ok=commit();changed();return ok;},
  undo(){draft.pop();changed();},
  // A click on the map while a tool is active (screen coordinates in the stage).
  click(x,y){
   if(!active)return false;const p=map.pick(x,y);if(!p)return true;draft.push(p);
   const auto=TOOLS[active].auto;if(auto&&draft.length>=auto)commit();else changed();return true;
  },
  select(id){selected=id;changed();},
  remove(id){busy.get(id)?.abort();items=items.filter(i=>i.id!==id);if(selected===id)selected=null;changed();},
  rename(id,name){const it=items.find(i=>i.id===id);if(it){it.name=name;changed();}},
  clear(){for(const c of busy.values())c.abort();busy.clear();items=[];draft=[];selected=null;changed();},
  exportGeoJSON:()=>JSON.stringify(toGeoJSON(items),null,1),
  exportKML:()=>toKML(items),
  import(text,fileName=''){const {items:list,skipped}=parseGeo(text,fileName);for(const it of list){Object.assign(it,{id:++seq,color:COLORS[it.type]});items.push(it);compute(it);}changed();return {added:list.length,skipped};},
  draw(ctx,map,{label,polyline}){
   const all=[...items,...(active&&draft.length?[{id:0,type:active,points:draft,color:COLORS[active],draft:true}]:[])];
   for(const it of all){
    const pts=it.points,sel=it.id===selected||it.draft;
    if(it.type!=='marker'){const ring=it.type==='area'&&pts.length>2?[...pts,pts[0]]:pts;polyline(ring,it.color,sel?3:2,it.draft?[6,4]:null);
     if(it.type==='sight'&&it.result?.blockedAt){const b=map.project(it.result.blockedAt.lat,it.result.blockedAt.lon,it.result.blockedAt.alt??0);if(b){ctx.fillStyle='#ff3b30';ctx.beginPath();ctx.arc(b.x,b.y,6,0,Math.PI*2);ctx.fill();}}}
    for(const p of pts){const s=map.project(p.lat,p.lon,map.kind()==='flat2d'?0:p.alt??0);if(!s)continue;
     if(it.type==='marker'){ctx.fillStyle=it.color;ctx.beginPath();ctx.moveTo(s.x,s.y);ctx.arc(s.x,s.y-14,7,Math.PI*.8,Math.PI*2.2);ctx.closePath();ctx.fill();ctx.fillStyle='#000';ctx.beginPath();ctx.arc(s.x,s.y-14,2.6,0,Math.PI*2);ctx.fill();}
     else{ctx.fillStyle='#000';ctx.strokeStyle=it.color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(s.x,s.y,4,0,Math.PI*2);ctx.fill();ctx.stroke();}}
    const last=pts.at(-1),s=last&&map.project(last.lat,last.lon,map.kind()==='flat2d'?0:last.alt??0);
    if(s)label(it.draft?(it.type==='distance'&&pts.length>1?distanceResult(pts).text:TOOLS[it.type].label+' · '+pts.length+' pt'):it.type==='marker'?it.name:it.result?.text??'',s.x,s.y);
   }
  },
  summary:it=>it.result?.text??'',
  formatDistance,
 };
}
