// Live aircraft (ADS-B) from the readsb-compatible API of adsb.lol or adsb.fi.
//
// Those services do not send CORS headers, so a browser page cannot call them directly: set
// `proxyUrl` to a CORS proxy you control (serve.py provides one and the standalone page detects it).
// The proxy receives the full upstream URL appended to proxyUrl, URL-encoded. Without a proxy the
// layer reports that it is blocked instead of failing silently.
//
// Loading follows the view without large bursts:
// - one request covers a circle of up to 250 NM (the API limit); a wider view uses at most
//   `maxRequests` (5) circles: the centre plus four spread over the view (see coverage), one at a time, 1 s apart,
//   each shown as it arrives;
// - circles snap to a fixed lattice and each answer is reused until it is due again, so panning does
//   not repeat requests;
// - HTTP 429 (rate limit) pauses all requests (Retry-After, else 30 s doubling to 5 min); meanwhile
//   cached aircraft stay on the map;
// - wide views refresh less often (refreshAt), close views every 10 s;
// - between refreshes each aircraft moves along its track at its ground speed (dead reckoning), so
//   markers and the selection follow it smoothly.
// What is drawn is then thinned by the overlay grid: zooming in shows more aircraft.
import {defineLayer,fetchJson} from '../layer.js';
import {TileError} from '../../core/errors.js';
import {distance} from '../../core/geodesy.js';

export const AIRCRAFT_SOURCES={
 adsblol:['adsb.lol','https://api.adsb.lol/v2/lat/{lat}/lon/{lon}/dist/{nm}'],
 adsbfi:['adsb.fi','https://opendata.adsb.fi/api/v2/lat/{lat}/lon/{lon}/dist/{nm}'],
};
const FT=.3048,KT=.514444,NM=1852,MAX_NM=250,D=Math.PI/180;

// Request circles for a box. Close views: a grid of circles that overlap into full coverage. Views wider
// than maxRequests circles can cover: one circle at the centre plus the rest spread evenly over the box,
// so the middle and every side of a wide view get a sample (granularity); zooming in turns the sample
// into full coverage.
export function coverage(b,{maxRequests=5}={}){
 const c={lat:(b.north+b.south)/2,lon:(b.east+b.west)/2},step=MAX_NM*NM*Math.SQRT2*.98;
 const hKm=distance({lat:b.south,lon:c.lon},{lat:b.north,lon:c.lon}),wKm=distance({lat:c.lat,lon:b.west},{lat:c.lat,lon:b.east});
 let rows=Math.max(1,Math.ceil(hKm/step)),cols=Math.max(1,Math.ceil(wKm/step));
 if(rows*cols===1){const nm=Math.min(MAX_NM,Math.ceil(distance(c,{lat:b.north,lon:b.east})/NM));return [{lat:c.lat,lon:c.lon,nm}];}
 const out=[];
 if(rows*cols>maxRequests){
  // Wider than the budget: the centre first (where the user looks), then the rest spread evenly.
  out.push({lat:c.lat,lon:c.lon,nm:MAX_NM});const n=maxRequests-1;if(n<1)return out;
  const r=Math.min(rows,Math.max(1,Math.round(Math.sqrt(n*rows/cols)))),k=Math.min(cols,Math.max(1,Math.floor(n/r)));
  for(let i=0;i<r;i++)for(let j=0;j<k;j++)out.push({lat:b.south+(b.north-b.south)*(i+.5)/r,lon:b.west+(b.east-b.west)*(j+.5)/k,nm:MAX_NM});
  return out;
 }
 for(let i=0;i<rows;i++)for(let j=0;j<cols;j++)out.push({lat:b.south+(b.north-b.south)*(i+.5)/rows,lon:b.west+(b.east-b.west)*(j+.5)/cols,nm:MAX_NM});
 return out;
}

const parse=(a,now)=>({id:a.hex,lat0:a.lat,lon0:a.lon,lat:a.lat,lon:a.lon,t0:now-(a.seen_pos??a.seen??0)*1000,
 alt:typeof a.alt_baro==='number'?a.alt_baro*FT:a.alt_geom!=null?a.alt_geom*FT:0,ground:a.alt_baro==='ground',
 callsign:(a.flight??'').trim(),reg:a.r??'',type:a.t??'',desc:a.desc??'',track:a.track??a.true_heading??null,speed:a.gs!=null?a.gs*KT:null,squawk:a.squawk??'',seen:a.seen??null});

export const aircraft=defineLayer({
 id:'aircraft',label:'Aircraft',group:'Traffic',source:'ADS-B',scope:'viewport',minZoom:4,refreshMs:10000,// Grid at the view zoom: the loaded box stays close to the visible area, so the request circles land on screen.
 grid:{gridOffset:0,gridMin:3,gridMax:12},
 refreshAt:zoom=>zoom<6?30000:zoom<8?15000:10000,
 options:{source:'adsblol',proxyUrl:'',maxRequests:5,spacingMs:1000},
 schema:[{key:'source',label:'Source',type:'select',options:Object.entries(AIRCRAFT_SOURCES).map(([k,[l]])=>[k,l])},
  {key:'proxyUrl',label:'CORS proxy',type:'text',placeholder:'https://proxy/?url='}],
 hint:'ADS-B services block browsers (CORS): set a proxy you control, or open the viewer through serve.py.',
 async load({bounds,zoom,signal,options,emit}){
  if(!options.proxyUrl)throw new TileError('cors_blocked','Aircraft need a CORS proxy: set "CORS proxy" in the layer options, or open the viewer through serve.py.');
  // Per-viewer state: recent answers per circle, and the rate-limit pause.
  const st=this._state??={circles:new Map(),coolUntil:0,strikes:0},now0=Date.now(),fresh=this.refreshAt(zoom)*.9;
  // Circles snap to a fixed lattice, so a small pan asks for the same circles (reused from cache).
  const circles=coverage(bounds,{maxRequests:options.maxRequests}).map(c=>{const q=c.nm>=MAX_NM?1:.1;return {lat:Math.round(c.lat/q)*q,lon:Math.round(c.lon/q)*q,nm:c.nm>=MAX_NM?MAX_NM:Math.min(MAX_NM,Math.ceil(c.nm/10)*10+10)};});
  const tpl=AIRCRAFT_SOURCES[options.source][1],byId=new Map(),add=list=>{for(const f of list)if(!byId.has(f.id))byId.set(f.id,f);};
  let failures=0,lastError=null,requested=0;
  for(const c of circles){
   const key=options.source+':'+c.lat.toFixed(1)+','+c.lon.toFixed(1)+','+c.nm,hit=st.circles.get(key);
   // Fresh answer for this circle, or paused after a 429: no request, use what is cached.
   if(hit&&(now0-hit.t<fresh||Date.now()<st.coolUntil)){add(hit.list);continue;}
   if(Date.now()<st.coolUntil)continue;
   if(requested++)await new Promise((r,j)=>{const t=setTimeout(r,options.spacingMs);signal?.addEventListener('abort',()=>{clearTimeout(t);j(new DOMException('Aborted','AbortError'));},{once:true});});
   const upstream=tpl.replace('{lat}',c.lat.toFixed(4)).replace('{lon}',c.lon.toFixed(4)).replace('{nm}',c.nm);
   try{const j=await fetchJson(options.proxyUrl+encodeURIComponent(upstream),{signal}),now=Date.now(),list=[];
    for(const a of j.ac??j.aircraft??[])if(Number.isFinite(a.lat)&&Number.isFinite(a.lon))list.push(parse(a,now));
    st.circles.set(key,{t:now,list});st.strikes=0;add(list);emit?.([...byId.values()]);
    while(st.circles.size>64)st.circles.delete(st.circles.keys().next().value);}
   catch(e){if(e?.name==='AbortError')throw e;failures++;lastError=e;
    // Rate limited: pause every request (Retry-After if given, else 30 s doubling up to 5 min).
    if(e?.details?.status===429){st.strikes++;st.coolUntil=Date.now()+(e.details.retryAfterS?e.details.retryAfterS*1000:Math.min(300e3,30e3*2**(st.strikes-1)));break;}}
  }
  if(!byId.size&&(failures||Date.now()<st.coolUntil))throw Date.now()<st.coolUntil?new TileError('rate_limited','ADS-B service rate limit reached: paused for '+Math.ceil((st.coolUntil-Date.now())/1000)+' s.'):lastError;
  return [...byId.values()];
 },
 // Dead reckoning along the track; returns true when something moved (the overlay redraws at most 4 Hz).
 tick(now,features){
  const t=Date.now();let moved=false;
  for(const f of features){if(f.ground||!f.speed||f.track==null)continue;const dt=Math.min(60,(t-f.t0)/1000),m=f.speed*dt,h=f.track*D;
   f.lat=f.lat0+m*Math.cos(h)/111320;f.lon=f.lon0+m*Math.sin(h)/(111320*Math.max(.05,Math.cos(f.lat0*D)));moved=true;}
  return moved;
 },
 style:f=>({shape:'plane',color:f.ground?'#8e8e93':f.alt<3000?'#30d158':f.alt<9000?'#ffd60a':'#ff9f0a',size:12,rotate:f.track}),
 title:f=>f.callsign||f.reg||f.id,
 details:f=>[['Callsign',f.callsign||'—'],['Registration',f.reg||'—'],['Type',[f.type,f.desc].filter(Boolean).join(' · ')||'—'],['Altitude',f.ground?'on ground':Math.round(f.alt)+' m ('+Math.round(f.alt/FT)+' ft)'],
  ['Speed',f.speed!=null?Math.round(f.speed*3.6)+' km/h':'—'],['Track',f.track!=null?Math.round(f.track)+'°':'—'],['Squawk',f.squawk||'—'],['ICAO hex',f.id]],
});
