// Intelligence layers: registry, batched loading (scheduler), drawing (overlay), selection.
import {createScheduler} from './scheduler.js';
import {createOverlay} from './overlay.js';
import {earthquakes} from './layers/earthquakes.js';
import {events} from './layers/events.js';
import {satellites} from './layers/satellites.js';
import {aircraft} from './layers/aircraft.js';
import {createRadar} from './layers/radar.js';

// Fresh layer objects for one viewer (options are per viewer).
export function makeLayers(){return [earthquakes,events,satellites,aircraft,createRadar()].map(l=>({...l,options:structuredClone(l.options)}));}
export const LAYER_IDS=['earthquakes','events','satellites','aircraft','radar'];

export function createIntel({doc,win,stage,map,tools,options={},onChange,onError,onZoomTo}){
 const layers=makeLayers(),byId=new Map(layers.map(l=>[l.id,l])),enabled=new Set();
 for(const [id,o]of Object.entries(options)){const l=byId.get(id);if(!l)throw new Error('Unknown intel layer '+id);const {enabled:on,...rest}=o;Object.assign(l.options,rest);if(on)enabled.add(id);}
 // needsDraw: data, tools or selection changed (redraw now). liveDirty: only live objects moved (satellites),
 // redrawn at most LIVE_MS apart while the view is still. lastSig: view signature of the last drawn frame.
 const LIVE_MS=250;let selected=null,lastTick=0,needsDraw=true,liveDirty=false,lastLive=0,lastSig='',blank=true;
 const scheduler=createScheduler({viewport:()=>map.viewport(),onData:()=>{needsDraw=true;onChange?.();},onState:()=>onChange?.(),onError:(l,e)=>onError?.(l,e)});
 const overlay=createOverlay({stage,map,doc,win});
 const active=()=>layers.filter(l=>enabled.has(l.id));

 // Every animation frame: schedule loads (5 Hz), advance live layers, redraw the overlay only when the view
 // moved, something changed, or (for live objects alone) every LIVE_MS.
 function frame(now){
  const list=active();
  if(now-lastTick>200){lastTick=now;scheduler.tick(list);}
  for(const l of list)if(l.tick&&l.tick(now,scheduler.features(l.id)))liveDirty=true;
  const hasTools=tools&&(tools.items.length||tools.draft.length);
  if(!list.length&&!hasTools&&!selected){if(!blank){overlay.render({layers:[],selected:null,tools:null});blank=true;lastSig='';}return;}
  const sig=map.begin();
  try{
   const moved=sig!==lastSig,live=liveDirty&&now-lastLive>=LIVE_MS;
   if(!moved&&!needsDraw&&!live&&!blank)return;
   needsDraw=false;blank=false;lastSig=sig;if(live||moved){liveDirty=false;lastLive=now;}
   overlay.render({layers:list.map(l=>({layer:l,features:scheduler.features(l.id)})),selected,tools,onDirty:()=>{needsDraw=true;}});
  }finally{map.end();}
 }
 return {
  layers,frame,
  redraw(){needsDraw=true;},
  isEnabled:id=>enabled.has(id),
  enable(id,on=true){if(!byId.has(id))throw new Error('Unknown intel layer '+id);if(on)enabled.add(id);else{enabled.delete(id);scheduler.reset(id);if(selected?.layer.id===id)selected=null;}needsDraw=true;onChange?.();},
  setOptions(id,patch){const l=byId.get(id);if(!l)throw new Error('Unknown intel layer '+id);Object.assign(l.options,patch);scheduler.reset(id);needsDraw=true;onChange?.();},
  state:id=>scheduler.state(id),
  // Last frame, per layer: {visible, icons, clusters, labels}.
  get drawStats(){return overlay.stats;},
  features:id=>scheduler.features(id),
  get selected(){return selected;},
  select(sel){selected=sel;needsDraw=true;onChange?.();},
  // Click on the map: a feature becomes selected; a cluster zooms in on its position.
  click(x,y){
   const h=overlay.hit(x,y);
   if(!h){if(selected){selected=null;needsDraw=true;onChange?.();}return null;}
   if(h.cluster){const g=map.pick(x,y,{surface:false});if(g)onZoomTo?.(g.lat,g.lon,Math.min(18,map.zoom()+2));return h;}
   selected={layer:h.layer,feature:h.feature};needsDraw=true;onChange?.();return h;
  },
  dispose(){scheduler.dispose();overlay.dispose();},
 };
}
