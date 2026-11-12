import {TileError,isAbort} from '../core/errors.js';
import {TileClient,fail,latitudeOf,longitudeOf} from './client.js';
import {TileEnhancer} from './enhance.js';
const EARTH_CIRCUMFERENCE=2*Math.PI*6378137;
export const MAX_MERCATOR_LATITUDE=85.0511287798066;
// Google 2D raster layers (lyrs). Verified live: s/y/t/p return JPEG, h/m/r return PNG;
// traffic/transit/bike are overlays, composited server side with any base layer.
export const GOOGLE_LAYERS={s:'satellite',y:'hybrid (satellite + labels)',h:'labels only',m:'roadmap',p:'terrain + roads',t:'terrain shading',r:'roads',traffic:'live traffic overlay',transit:'transit overlay',bike:'bicycling overlay'};
// apistyle grammar (verified live): s.t feature id, s.e element, p.* stylers; rules joined by ','.
export const STYLE_ELEMENTS={all:null,geometry:'g','geometry.fill':'g.f','geometry.stroke':'g.s',labels:'l','labels.icon':'l.i','labels.text':'l.t','labels.text.fill':'l.t.f','labels.text.stroke':'l.t.s'};
const STYLERS={visibility:'v',color:'c',hue:'h',saturation:'s',lightness:'l',gamma:'g',weight:'w'};
export function encodeStyle(rules){
 if(typeof rules==='string')return rules.trim();if(!Array.isArray(rules)||!rules.length)fail('style must be an apistyle string or a non-empty array of rules');
 return rules.map((rule,i)=>{
  if(!rule||typeof rule!=='object')fail('style rule '+i+' must be an object');const parts=[];
  for(const k of Object.keys(rule))if(!['featureId','element',...Object.keys(STYLERS)].includes(k))fail('Unknown style key '+k,{known:['featureId','element',...Object.keys(STYLERS)]});
  if(rule.featureId!=null){if(!Number.isInteger(rule.featureId)||rule.featureId<0)fail('featureId must be an integer >= 0');parts.push('s.t:'+rule.featureId);}
  if(rule.element!=null){if(!(rule.element in STYLE_ELEMENTS))fail('Unknown style element '+rule.element,{known:Object.keys(STYLE_ELEMENTS)});if(STYLE_ELEMENTS[rule.element])parts.push('s.e:'+STYLE_ELEMENTS[rule.element]);}
  const color=v=>{const m=/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(String(v));if(!m)fail('colors must be #rrggbb or #aarrggbb',{value:v});return '#'+(m[1].length===6?'ff'+m[1]:m[1]).toLowerCase();};
  const range=(k,v,min,max)=>{if(!Number.isFinite(v)||v<min||v>max)fail(k+' must be within ['+min+', '+max+']');return v;};
  for(const [k,code]of Object.entries(STYLERS)){if(rule[k]==null)continue;const v=rule[k];
   parts.push('p.'+code+':'+(k==='visibility'?(['on','off','simplified'].includes(v)?v:fail('visibility must be on, off or simplified')):k==='color'||k==='hue'?color(v):k==='saturation'||k==='lightness'?range(k,v,-100,100):k==='gamma'?range(k,v,0.01,10):range(k,v,0,8)));}
  if(!parts.some(p=>p.startsWith('p.')))fail('style rule '+i+' needs at least one styler');return parts.join('|');
 }).join(',');
}
// Base-layer pairs the server rejects (no CORS headers, unusable in browsers). Measured in Chrome:
// every overlay (h, r, traffic, transit, bike) combines with anything; s+t, m+p, m+t, p+t also work.
// Measured in Chrome over all 1023 subsets (canonical order, two locations, zero exceptions):
// Google rejects s+y together and more than two of y/h/m/p/r; everything else combines.
// lyrs order matters to the server, so layers are always sent in GOOGLE_LAYER_ORDER.
export const GOOGLE_LAYER_ORDER=['s','y','h','m','p','t','r','traffic','transit','bike'];
export const GOOGLE_VECTOR_LIMIT={layers:['y','h','m','p','r'],max:2};
export function layerConflicts(list){const out=[];if(list.includes('s')&&list.includes('y'))out.push(['s','y']);const v=GOOGLE_VECTOR_LIMIT.layers.filter(l=>list.includes(l));if(v.length>GOOGLE_VECTOR_LIMIT.max)out.push(v);return out;}
// Smallest change that makes a selection valid while keeping `keep` (the layer just enabled).
export function resolveLayers(list,keep){const out=GOOGLE_LAYER_ORDER.filter(l=>list.includes(l));const drop=l=>{const i=out.indexOf(l);if(i>=0)out.splice(i,1);};
 if(out.includes('s')&&out.includes('y'))drop(keep==='y'?'s':'y');
 while(GOOGLE_VECTOR_LIMIT.layers.filter(l=>out.includes(l)).length>GOOGLE_VECTOR_LIMIT.max){const v=GOOGLE_VECTOR_LIMIT.layers.filter(l=>out.includes(l)&&l!==keep);if(!v.length)break;drop(v[0]);}
 return out;}
// Tile pixel scale accepted by Google (measured): 1.5 -> 384 px, 3 -> 768 px; above 4 it is ignored.
export const GOOGLE_SCALES=[1,1.5,2,3,4];
export const GOOGLE_MAX_ZOOM=22;
const clampLat=lat=>Math.max(-MAX_MERCATOR_LATITUDE,Math.min(MAX_MERCATOR_LATITUDE,lat));
export function lonLatToTile(latitude,longitude,z){const n=2**z,lat=clampLat(latitude)*Math.PI/180;return {x:Math.min(n-1,Math.max(0,Math.floor((longitude+180)/360*n))),y:Math.min(n-1,Math.max(0,Math.floor((1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*n))),z};}
export function tileBounds(z,x,y){const n=2**z,lon=v=>v/n*360-180,lat=v=>Math.atan(Math.sinh(Math.PI*(1-2*v/n)))*180/Math.PI;return {west:lon(x),east:lon(x+1),north:lat(y),south:lat(y+1)};}
export function metersPerPixel(latitude,z,tileSize=256){return EARTH_CIRCUMFERENCE*Math.cos(clampLat(latitude)*Math.PI/180)/(tileSize*2**z);}

// Headless Google 2D tile client (mt0-3.google.com/vt). Every request parameter is a setter.
export class Tiles2D extends TileClient {
 constructor(options={}){
  super({concurrency:8,cacheName:'rea-google-2d-v1'});
  this.options={layers:['s'],scale:1,language:'en',region:null,style:null,servers:[0,1,2,3],minZoom:0,maxZoom:GOOGLE_MAX_ZOOM,overzoom:false,query:{}};
  this.set(options);
 }
 // One or more lyrs codes; several are composited server side (e.g. ['s','r']).
 setLayers(layers){const list=typeof layers==='string'?layers.split(',').map(s=>s.trim()).filter(Boolean):layers;if(!Array.isArray(list)||!list.length)fail('layers must be a non-empty array of '+Object.keys(GOOGLE_LAYERS).join(', '));for(const l of list)if(!(l in GOOGLE_LAYERS))fail('Unknown Google layer '+l,{known:Object.keys(GOOGLE_LAYERS)});const bad=layerConflicts(list);if(bad.length)throw new TileError('layer_conflict','Google rejects these layer combinations: '+bad.map(p=>p.join('+')).join(', '),{conflicts:bad});this.options.layers=GOOGLE_LAYER_ORDER.filter(l=>list.includes(l));return this;}
 setLayer(layer){return this.setLayers([layer]);}
 setScale(scale){if(!GOOGLE_SCALES.includes(scale))fail('scale must be one of '+GOOGLE_SCALES.join(', '));this.options.scale=scale;return this;}
 setLanguage(code){if(typeof code!=='string'||!/^[a-z]{2,3}([-_][A-Za-z0-9]{2,8})*$/.test(code))fail('language must be a BCP-47 code such as en, it, zh-CN',{language:code});this.options.language=code;return this;}
 setRegion(code){if(code!==null&&(typeof code!=='string'||!/^[a-z]{2}$/i.test(code)))fail('region must be a 2-letter country code or null',{region:code});this.options.region=code&&code.toLowerCase();return this;}
 // Map styling for vector-rendered layers (m, p, h, r, overlays): raw apistyle string,
 // rule objects ({featureId, element, visibility, color, hue, saturation, lightness, gamma, weight}) or null.
 setStyle(style){if(style===null||style===''){this.options.style=null;return this;}if(typeof style==='string'&&!style.trim())fail('style must not be blank');this.options.style=encodeStyle(style);return this;}
 setServers(list){if(!Array.isArray(list)||!list.length||list.some(n=>![0,1,2,3].includes(n)))fail('servers must be a non-empty subset of [0, 1, 2, 3]');this.options.servers=[...new Set(list)];return this;}
 setZoomRange(minZoom,maxZoom){if(typeof minZoom==='object'&&minZoom)({minZoom,maxZoom}=minZoom);for(const [k,v]of [['minZoom',minZoom],['maxZoom',maxZoom]])if(!Number.isInteger(v)||v<0||v>GOOGLE_MAX_ZOOM)fail(k+' must be an integer within [0, '+GOOGLE_MAX_ZOOM+']');if(minZoom>maxZoom)fail('minZoom must be <= maxZoom');Object.assign(this.options,{minZoom,maxZoom});return this;}
 setCredentials(mode){if(mode==='include')throw new TileError('cors_rejected',"Google 2D tiles reject credentials 'include' (CORS); use 'omit' or 'same-origin'");return super.setCredentials(mode);}
 setOverzoom(enabled){this.options.overzoom=!!enabled;return this;}
 setQuery(query,{merge=true}={}){if(!query||typeof query!=='object')fail('query must be an object');const q=Object.fromEntries(Object.entries(query).map(([k,v])=>{if(['lyrs','x','y','z','scale','hl','gl','apistyle'].includes(k))fail('query key '+k+' is owned by a dedicated setter');return [k,String(v)];}));this.options.query=merge?{...this.options.query,...q}:q;return this;}
 get tileSize(){return 256*this.options.scale;}
 getOptions(){return {...super.getOptions(),tiles:structuredClone(this.options)};}
 getAttribution(){return 'Imagery © Google';}

 checkTile(z,x,y){if(!Number.isInteger(z)||z<0||z>30)fail('z must be an integer within [0, 30]',{z});const n=2**z;if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=n||y>=n)fail('x/y outside tile matrix at z'+z,{z,x,y});}
 tileUrl(z,x,y){return this.tileUrlAt(z,x,y,this.options.scale);}
 tileUrlAt(z,x,y,scale){
  this.checkTile(z,x,y);const o=this.options,server=o.servers[(x+y)%o.servers.length],u=new URL(`https://mt${server}.google.com/vt/`);
  u.searchParams.set('lyrs',o.layers.join(','));u.searchParams.set('x',x);u.searchParams.set('y',y);u.searchParams.set('z',z);u.searchParams.set('scale',scale);u.searchParams.set('hl',o.language);
  if(o.region)u.searchParams.set('gl',o.region);if(o.style)u.searchParams.set('apistyle',o.style);for(const [k,v]of Object.entries(o.query))u.searchParams.set(k,v);
  return u.href.replace(/lyrs=[^&]*/,'lyrs='+o.layers.join(','));
 }
 // With overzoom, z above maxZoom returns the real ancestor at maxZoom plus the crop to apply.
 // priority: higher values are fetched first when requests are queued (default 0).
 async getTile(z,x,y,{priority=0}={}){
  if(typeof z==='object'&&z)({z,x,y}=z);this.checkTile(z,x,y);const o=this.options;
  if(z<o.minZoom)throw new TileError('zoom_range','Zoom below minimum',{z,minZoom:o.minZoom});
  let source={z,x,y},crop=null;
  if(z>o.maxZoom){if(!o.overzoom)throw new TileError('zoom_range','Zoom above maximum; enable setOverzoom(true) to use the parent tile',{z,maxZoom:o.maxZoom});const d=z-o.maxZoom,f=2**d;source={z:o.maxZoom,x:x>>d,y:y>>d};const size=this.tileSize/f;crop={x:(x-source.x*f)*size,y:(y-source.y*f)*size,width:size,height:size};}
  const url=this.tileUrl(source.z,source.x,source.y),transport=this.transport();let bytes;
  try{if(o.scale!==1&&!crop&&this.isMissing(url))throw new TileError('http_error','Known missing tile',{url,status:404});bytes=new Uint8Array(await transport.get(url,{priority}));}
  catch(e){
   // Google sometimes has no tile at scale > 1 where the 256 px one exists (measured: ~1 in 5 at z11-12).
   // A missing tile answers 404 without CORS headers, which a browser reports as a network error.
   if(o.scale===1||crop||isAbort(e)||!(e?.code==='network_error'||e?.details?.status===404))throw e;
   this.markMissing(url);
   const c=await this.composeFromChildren(source.z,source.x,source.y,{priority}).catch(()=>null);if(!c)throw e;
   return {z,x,y,url,source,crop,bytes:c.bytes,mimeType:'image/png',tileSize:this.tileSize,bounds:tileBounds(z,x,y),composedFrom:c.from};
  }
  return {z,x,y,url,source,crop,bytes,mimeType:transport.getContentType(url)??sniff(bytes),tileSize:this.tileSize,bounds:tileBounds(z,x,y)};
 }
 // Tiles known to be missing (404, or a CORS-hidden one) are not asked again for an hour (bounded).
 isMissing(url){const t=this._missing?.get(url);if(t==null)return false;if(Date.now()-t>3600e3){this._missing.delete(url);return false;}return true;}
 markMissing(url){const m=this._missing??=new Map();m.delete(url);m.set(url,Date.now());while(m.size>4096)m.delete(m.keys().next().value);}
 // Rebuilds a missing scaled tile from what Google does have, at tileSize pixels:
 // 1. the 256 px tiles one or two levels deeper (2^k >= scale): the detail a scaled tile would hold
 //    (a 2x tile equals its four children), never magnified;
 // 2. where those are missing too (open sea, edges of coverage), the same tile at scale 1 underneath:
 //    the finest imagery that exists there.
 // Browser / worker only (needs OffscreenCanvas).
 async composeFromChildren(z,x,y,{priority=0}={}){
  if(typeof OffscreenCanvas!=='function'||typeof createImageBitmap!=='function')throw new TileError('unsupported_environment','Composing tiles needs OffscreenCanvas');
  const k=Math.ceil(Math.log2(this.options.scale)),n=2**k,size=this.tileSize,cell=size/n,transport=this.transport();
  const bitmap=async u=>{if(this.isMissing(u))return null;try{return await createImageBitmap(new Blob([await transport.get(u,{priority})]));}catch(err){if(isAbort(err))throw err;if(err?.code==='network_error'||err?.details?.status===404)this.markMissing(u);return null;}};
  // Deeper tiles only exist up to the imagery maximum (maxZoom, at most z22): beyond it, the base alone.
  const urls=[];if(z+k<=Math.min(30,this.options.maxZoom))for(let j=0;j<n;j++)for(let i=0;i<n;i++)urls.push([i,j,this.tileUrlAt(z+k,x*n+i,y*n+j,1)]);
  const parts=await Promise.all(urls.map(async([i,j,u])=>[i,j,await bitmap(u)])),found=parts.filter(p=>p[2]).length;
  const base=found<n*n?await bitmap(this.tileUrlAt(z,x,y,1)):null;
  if(!found&&!base)throw new TileError('no_data','No imagery for this tile at any scale',{z,x,y});
  const canvas=new OffscreenCanvas(size,size),g=canvas.getContext('2d');g.imageSmoothingQuality='high';
  if(base){g.drawImage(base,0,0,size,size);base.close();}
  for(const [i,j,bmp]of parts)if(bmp){g.drawImage(bmp,i*cell,j*cell,cell,cell);bmp.close();}
  return {bytes:new Uint8Array(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer()),from:{z:z+k,scale:1,tiles:found,base:base?{z,scale:1}:null}};
 }
 // Tile processed once with CAS sharpening, optional bicubic upscale and denoise (browser/worker).
 async getEnhancedTile(z,x,y,{sharpness=0.6,sharpen=true,denoise=0,upscale=1}={}){
  const tile=await this.getTile(z,x,y);this.enhancer??=new TileEnhancer();
  const bitmap=await this.enhancer.enhance(new Blob([tile.bytes],{type:tile.mimeType}),{sharpness,sharpen,denoise,upscale});
  return {...tile,bitmap,enhanced:{sharpness,sharpen,denoise,upscale,width:bitmap.width,height:bitmap.height}};
 }
 async dispose(){this.enhancer?.dispose();this.enhancer=null;return super.dispose();}
 tileAt(latitude,longitude,z){latitudeOf(latitude);longitudeOf(longitude);this.checkTile(z,0,0);return lonLatToTile(latitude,longitude,z);}
 getTileAt(latitude,longitude,z){const t=this.tileAt(latitude,longitude,z);return this.getTile(t.z,t.x,t.y);}
 tilesInBounds({west,south,east,north},z,{maxTiles=4096}={}){
  longitudeOf(west);longitudeOf(east);latitudeOf(south);latitudeOf(north);if(south>north)fail('south must be <= north');this.checkTile(z,0,0);
  const a=lonLatToTile(north,west,z),b=lonLatToTile(south,east,z),n=2**z,xs=[];
  if(west<=east)for(let x=a.x;x<=b.x;x++)xs.push(x);else{for(let x=a.x;x<n;x++)xs.push(x);for(let x=0;x<=b.x;x++)xs.push(x);}
  const count=xs.length*(b.y-a.y+1);if(count>maxTiles)throw new TileError('tile_limit','Bounds select too many tiles',{count,maxTiles});
  const out=[];for(let y=a.y;y<=b.y;y++)for(const x of xs)out.push({z,x,y});return out;
 }
 async getTiles(bounds,z,{maxTiles,onProgress,signal}={}){
  const list=this.tilesInBounds(bounds,z,{maxTiles}),tiles=[],errors=[];let done=0;
  await Promise.all(list.map(t=>this.getTile(t.z,t.x,t.y).then(tile=>{tiles.push(tile);},error=>{if(isAbort(error))throw error;errors.push({...t,code:error.code??'unavailable',message:error.message});}).finally(()=>{if(signal?.aborted)return;onProgress?.({done:++done,total:list.length});})));
  tiles.sort((p,q)=>p.y-q.y||p.x-q.x);return {complete:!errors.length,total:list.length,tiles,errors,attribution:this.getAttribution()};
 }
 // A tile byte-identical to its neighbour is a shared placeholder, not real imagery.
 async isRealImagery(tile){
  const n=2**tile.z,neighbour=await this.getTile(tile.z,(tile.x+1)%n,tile.y).catch(error=>{if(isAbort(error))throw error;return null;});
  if(!neighbour)return true;const a=tile.bytes,b=neighbour.bytes;if(a.length!==b.length)return true;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return true;return false;
 }
 // Highest zoom with real imagery at a point, probing from maxZoom downward.
 async findMaxZoom(latitude,longitude,{from=this.options.maxZoom,to=this.options.minZoom,isValid=tile=>this.isRealImagery(tile)}={}){
  for(let z=from;z>=to;z--){try{const tile=await this.getTileAt(latitude,longitude,z);if(!isValid||await isValid(tile))return {z,tile};}catch(error){if(isAbort(error)||error.code==='network_error'||error.code==='timeout')throw error;}}
  return {z:null,tile:null};
 }
 // Stitches the tiles covering bounds into one image (browser/worker only).
 async getImage(bounds,z,options={}){
  if(typeof createImageBitmap!=='function'||typeof OffscreenCanvas!=='function')throw new TileError('unsupported_environment','getImage needs createImageBitmap and OffscreenCanvas (browser/worker)');
  const result=await this.getTiles(bounds,z,options);if(!result.tiles.length)throw new TileError('no_data','No tile in bounds could be loaded',{errors:result.errors});
  const size=this.tileSize,xs=[...new Set(result.tiles.map(t=>t.x))],x0=Math.min(...xs),y0=Math.min(...result.tiles.map(t=>t.y)),cols=Math.max(...xs)-x0+1,rows=Math.max(...result.tiles.map(t=>t.y))-y0+1;
  const canvas=new OffscreenCanvas(cols*size,rows*size),ctx=canvas.getContext('2d');
  for(const t of result.tiles){const bmp=await createImageBitmap(new Blob([t.bytes],{type:t.mimeType}));try{const c=t.crop;if(c)ctx.drawImage(bmp,c.x*bmp.width/size,c.y*bmp.height/size,c.width*bmp.width/size,c.height*bmp.height/size,(t.x-x0)*size,(t.y-y0)*size,size,size);else ctx.drawImage(bmp,(t.x-x0)*size,(t.y-y0)*size,size,size);}finally{bmp.close();}}
  const nw=tileBounds(z,x0,y0),se=tileBounds(z,x0+cols-1,y0+rows-1);
  return {canvas,width:canvas.width,height:canvas.height,bounds:{west:nw.west,north:nw.north,east:se.east,south:se.south},complete:result.complete,errors:result.errors,attribution:result.attribution,blob:opts=>canvas.convertToBlob(opts)};
 }
}
function sniff(b){if(b[0]===0xff&&b[1]===0xd8)return 'image/jpeg';if(b[0]===0x89&&b[1]===0x50)return 'image/png';return 'application/octet-stream';}
Tiles2D.optionSetters={...TileClient.optionSetters,layers:{name:'setLayers'},layer:{name:'setLayer'},scale:{name:'setScale'},language:{name:'setLanguage'},region:{name:'setRegion'},style:{name:'setStyle'},servers:{name:'setServers'},zoomRange:{name:'setZoomRange',spread:true},overzoom:{name:'setOverzoom'},query:{name:'setQuery'}};
