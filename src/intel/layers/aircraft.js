// Live aircraft (ADS-B) from the readsb-compatible API of adsb.lol or adsb.fi.
//
// Those services do not send CORS headers, so a browser page cannot call them directly: set
// `proxyUrl` to a CORS proxy you control. The proxy receives the full upstream URL appended to
// proxyUrl (for example proxyUrl "https://proxy.example/?url=" ->
// "https://proxy.example/?url=https%3A%2F%2Fapi.adsb.lol%2F..."). Without a proxy the layer reports
// that it is blocked instead of failing silently.
//
// Viewport layer: one request covers the centre of the snapped view box with a radius large enough for
// the box, capped at the API limit (250 NM).
import {defineLayer,fetchJson} from '../layer.js';
import {TileError} from '../../core/errors.js';
import {distance} from '../../core/geodesy.js';

export const AIRCRAFT_SOURCES={
 adsblol:['adsb.lol','https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{nm}'],
 adsbfi:['adsb.fi','https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}'],
};
const FT=.3048,KT=.514444;

export const aircraft=defineLayer({
 id:'aircraft',label:'Aircraft',group:'Traffic',source:'ADS-B',scope:'viewport',minZoom:6,refreshMs:10000,grid:{gridOffset:2,gridMin:4,gridMax:10},
 options:{source:'adsblol',proxyUrl:''},
 schema:[{key:'source',label:'Source',type:'select',options:Object.entries(AIRCRAFT_SOURCES).map(([k,[l]])=>[k,l])},
  {key:'proxyUrl',label:'CORS proxy',type:'text',placeholder:'https://proxy/?url='}],
 hint:'ADS-B services block browsers (CORS): set a proxy you control.',
 async load({bounds,signal,options}){
  if(!options.proxyUrl)throw new TileError('cors_blocked','Aircraft need a CORS proxy: set "CORS proxy" in the layer options.');
  const c={lat:(bounds.north+bounds.south)/2,lon:(bounds.east+bounds.west)/2};
  const nm=Math.min(250,Math.ceil(distance(c,{lat:bounds.north,lon:bounds.east})/1852));
  const upstream=AIRCRAFT_SOURCES[options.source][1].replace('{lat}',c.lat.toFixed(4)).replace('{lon}',c.lon.toFixed(4)).replace('{nm}',nm);
  const j=await fetchJson(options.proxyUrl+encodeURIComponent(upstream),{signal});
  return (j.ac??j.aircraft??[]).filter(a=>Number.isFinite(a.lat)&&Number.isFinite(a.lon)).map(a=>({
   id:a.hex,lat:a.lat,lon:a.lon,alt:typeof a.alt_baro==='number'?a.alt_baro*FT:a.alt_geom!=null?a.alt_geom*FT:0,ground:a.alt_baro==='ground',
   callsign:(a.flight??'').trim(),reg:a.r??'',type:a.t??'',desc:a.desc??'',track:a.track??a.true_heading??null,speed:a.gs!=null?a.gs*KT:null,squawk:a.squawk??'',seen:a.seen??null}));
 },
 style:f=>({shape:'plane',color:f.ground?'#8e8e93':f.alt<3000?'#30d158':f.alt<9000?'#ffd60a':'#ff9f0a',size:12,rotate:f.track}),
 title:f=>f.callsign||f.reg||f.id,
 details:f=>[['Callsign',f.callsign||'—'],['Registration',f.reg||'—'],['Type',[f.type,f.desc].filter(Boolean).join(' · ')||'—'],['Altitude',f.ground?'on ground':Math.round(f.alt)+' m ('+Math.round(f.alt/FT)+' ft)'],
  ['Speed',f.speed!=null?Math.round(f.speed*3.6)+' km/h':'—'],['Track',f.track!=null?Math.round(f.track)+'°':'—'],['Squawk',f.squawk||'—'],['ICAO hex',f.id]],
});
