// Online place search (geocoding). Every query goes to the selected provider; nothing is hardcoded.
// auto (default): suggestions while typing from photon, the best match on GO/Enter from nominatim (ranked by importance;
// its usage policy forbids search-as-you-type). photon and nominatim use OpenStreetMap data; google needs a Geocoding API key.
import {TileError} from '../core/errors.js';

export const GEOCODER_PROVIDERS={
 auto:null,
 photon:'https://photon.komoot.io/api/',
 nominatim:'https://nominatim.openstreetmap.org/search',
 google:'https://maps.googleapis.com/maps/api/geocode/json',
};

// Zoom that fits a [south, west, north, east] box in roughly one 1000 px view.
export function zoomForBounds(bounds,fallback=14){
 if(!bounds||bounds.some(v=>!Number.isFinite(v)))return fallback;
 const [s,w,n,e]=bounds,lat=(s+n)/2,lonSpan=Math.max(1e-6,Math.abs(e-w)*Math.cos(lat*Math.PI/180)),latSpan=Math.max(1e-6,Math.abs(n-s));
 const z=Math.log2(360*4/Math.max(lonSpan,latSpan));return Math.max(2,Math.min(19,Math.round(z)));
}

const KIND_RANK={place:0,boundary:0,historic:1,tourism:1,natural:1,man_made:2,bridge:2,building:2,waterway:2,aeroway:2,leisure:3,amenity:4,railway:4,landuse:4,shop:5,highway:6};
const parsers={
 photon(json){return (json.features??[]).map(f=>{const p=f.properties??{},[lon,lat]=f.geometry?.coordinates??[],x=p.extent;
  const bounds=Array.isArray(x)&&x.length===4?[x[3],x[0],x[1],x[2]]:null;
  const context=[p.city!==p.name?p.city:null,p.state!==p.name?p.state:null,p.country!==p.name?p.country:null].filter(Boolean).join(', ');
  return {rank:KIND_RANK[p.osm_key]??4,name:p.name??[p.street,p.housenumber].filter(Boolean).join(' ')??'',context,latitude:lat,longitude:lon,bounds,zoom:zoomForBounds(bounds,p.osm_key==='place'&&p.osm_value==='house'?19:17),kind:p.osm_value??p.type??null,source:'photon'};});},
 nominatim(json){return (Array.isArray(json)?json:[]).map(r=>{const b=r.boundingbox?.map(Number),bounds=b?.length===4?[b[0],b[2],b[1],b[3]]:null,parts=String(r.display_name??'').split(', ');
  return {name:r.name||parts[0]||'',context:parts.slice(1).join(', '),latitude:Number(r.lat),longitude:Number(r.lon),bounds,zoom:zoomForBounds(bounds),kind:r.type??null,source:'nominatim'};});},
 google(json){if(json.status&&json.status!=='OK'&&json.status!=='ZERO_RESULTS')throw new TileError('geocode_failed',`Google geocoding: ${json.status}${json.error_message?' '+json.error_message:''}`);
  return (json.results??[]).map(r=>{const l=r.geometry?.location??{},v=r.geometry?.viewport,bounds=v?[v.southwest.lat,v.southwest.lng,v.northeast.lat,v.northeast.lng]:null,parts=String(r.formatted_address??'').split(', ');
  return {name:r.address_components?.[0]?.long_name??parts[0]??'',context:parts.slice(1).join(', '),latitude:l.lat,longitude:l.lng,bounds,zoom:zoomForBounds(bounds),kind:r.types?.[0]??null,source:'google'};});},
};

export class Geocoder{
 constructor(options={}){this.provider='auto';this.language='en';this.limit=8;this.apiKey=null;this.url=null;this.fetch=globalThis.fetch?.bind(globalThis);this.set(options);}
 set(o={}){
  if(o.provider!==undefined){if(!(o.provider in GEOCODER_PROVIDERS))throw new TileError('invalid_option',`Unknown geocoder provider ${o.provider}`);this.provider=o.provider;}
  if(o.language!==undefined)this.language=String(o.language||'en');
  if(o.limit!==undefined){const n=Number(o.limit);if(!Number.isInteger(n)||n<1||n>50)throw new TileError('invalid_option','limit must be an integer 1-50');this.limit=n;}
  if(o.apiKey!==undefined)this.apiKey=o.apiKey||null;
  if(o.url!==undefined)this.url=o.url||null;
  if(o.fetch!==undefined)this.fetch=o.fetch;
  return this;
 }
 requestUrl(query,provider=this.provider){
  const u=new URL(this.url??GEOCODER_PROVIDERS[provider]),q=u.searchParams;
  if(provider==='photon'){q.set('q',query);q.set('limit',Math.min(50,this.limit*3));if(['en','de','fr'].includes(this.language))q.set('lang',this.language);}
  else if(provider==='nominatim'){q.set('q',query);q.set('format','jsonv2');q.set('limit',this.limit);q.set('accept-language',this.language);}
  else{if(!this.apiKey)throw new TileError('missing_api_key','The google geocoder needs an apiKey');q.set('address',query);q.set('language',this.language);q.set('key',this.apiKey);}
  return u.href;
 }
 // Which provider answers: with auto, 'suggest' (typing) uses photon and 'best' (GO/Enter) uses nominatim.
 providerFor(purpose='best'){return this.provider!=='auto'?this.provider:purpose==='suggest'?'photon':'nominatim';}
 // Returns [{name, context, latitude, longitude, bounds:[s,w,n,e]|null, zoom, kind, source}].
 async search(query,{signal,purpose='best'}={}){
  const text=String(query??'').trim();if(!text)return [];const provider=this.providerFor(purpose);
  const res=await this.fetch(this.requestUrl(text,provider),{signal,headers:{Accept:'application/json'}});
  if(!res.ok)throw new TileError('geocode_failed',`${provider} geocoding HTTP ${res.status}`);
  let list=parsers[provider](await res.json()).filter(r=>Number.isFinite(r.latitude)&&Number.isFinite(r.longitude));
  if(provider==='photon'){const seen=new Set();list=list.map((r,i)=>[r,i]).sort((a,b)=>a[0].rank-b[0].rank||a[1]-b[1]).map(([r])=>r).filter(r=>{const k=r.name+'|'+r.context;if(seen.has(k))return false;seen.add(k);return true;});}
  return list.slice(0,this.limit).map(({rank,...r})=>r);
 }
}
