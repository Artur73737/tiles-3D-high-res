// Contract shared by every intelligence layer.
//
// A layer is a plain object:
//   id, label, group            identity and panel grouping
//   kind: 'points' | 'raster'   points are drawn by the overlay, raster layers draw themselves
//   scope: 'viewport' | 'global'
//       viewport: load(ctx) receives the visible bounds and is called again when the view moves to a
//                 new grid cell or the refresh interval passes (aircraft)
//       global:   load(ctx) returns the whole dataset, refreshed on the interval and filtered by the
//                 overlay to what is on screen (earthquakes, events, satellites)
//   minZoom                     below it the layer neither loads nor draws
//   refreshMs                   reload interval while enabled
//   options, schema             user settings (rendered in the left sidebar under the layer toggle)
//   load({bounds, zoom, signal, options}) -> Feature[]
//   tick?(now, features)        per-frame update (satellites propagate their orbits here)
//   style(feature) -> {shape, color, size, rotate?}
//   dotColor?(feature) -> colour   fast path for dense layers drawn as dots (no object per point)
//   rank?(feature) -> number    wins its grid cell when thinning (default: stable hash of the id)
//   display?                    overlay overrides: {cell, dense:'dots', dotsAbove, labelZoom, ...}
//   title(feature) -> string    short text shown next to the icon when zoomed in enough
//   details(feature) -> [[key, value], ...] shown in the info popup
//
// Feature: {id, lat, lon, alt (m, 0 = surface), time?, ...source fields}
import {TileError} from '../core/errors.js';

// JSON GET with a time limit, so a service that never answers shows an error instead of loading forever.
export async function fetchJson(url,{signal,timeoutMs=20000,fetch:fetcher=globalThis.fetch}={}){
 const ctl=new AbortController(),stop=()=>ctl.abort();signal?.addEventListener('abort',stop,{once:true});
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;ctl.abort();},timeoutMs);
 try{
  let res;
  try{res=await fetcher(url,{signal:ctl.signal,headers:{Accept:'application/json'}});}
  catch(e){if(timedOut)throw new TileError('timeout','No answer within '+timeoutMs/1000+' s: '+url,{url});if(e?.name==='AbortError')throw e;throw new TileError('network_error','Request failed (network or CORS): '+url,{url});}
  if(!res.ok)throw new TileError('http_error','HTTP '+res.status+' for '+url,{url,status:res.status});
  try{return await res.json();}catch(e){if(timedOut)throw new TileError('timeout','No answer within '+timeoutMs/1000+' s: '+url,{url});throw e;}
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',stop);}
}

export const defineLayer=layer=>({kind:'points',scope:'global',minZoom:0,refreshMs:60000,options:{},schema:[],title:()=>'',details:()=>[],...layer});
