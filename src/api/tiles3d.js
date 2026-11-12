import {Vector3,Matrix4} from 'three';
import decodeDXT from 'decode-dxt';
import {GoogleEarthSource} from '../core/rocktree/source.js';
import {decoderPool} from '../core/rocktree/decoder/pool.js';
import {surfaceArrays,buildAsset,disposeAsset} from '../core/rocktree/geometry.js';
import {geoToECEF,ecefToGeo,intersectsRegion} from '../core/geo.js';
import {TileError,isAbort} from '../core/errors.js';
import {TileClient,fail,positive,positiveInt,nonNegative,latitudeOf,longitudeOf} from './client.js';
const LAYERS=['terrain','overlay','water'];
const TEXTURE_OUTPUTS=['native','rgba','none'];
const COORDINATES=['mesh','ecef','local'];
const ORDERS=['distance','path'];
const TEXTURE_REQUESTS={dxt1:{textureFormat:6,textures:true},jpeg:{textureFormat:1,textures:true},none:{textureFormat:6,textures:false}};
const DEFAULT_BASE='https://kh.google.com/rt/earth/';

async function jpegToRgba(bytes){
 if(typeof createImageBitmap!=='function'||typeof OffscreenCanvas!=='function')throw new TileError('unsupported_environment','JPEG to RGBA conversion needs createImageBitmap and OffscreenCanvas (browser/worker)');
 const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/jpeg'}),{imageOrientation:'none'});
 try{const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);return new Uint8Array(ctx.getImageData(0,0,bitmap.width,bitmap.height).data.buffer);}finally{bitmap.close();}
}
function enuFrame(latitude,longitude,radius){
 const lat=latitude*Math.PI/180,lon=longitude*Math.PI/180;
 const east=new Vector3(-Math.sin(lon),Math.cos(lon),0),up=geoToECEF(latitude,longitude,0,1),north=new Vector3().crossVectors(up,east);
 const toECEF=new Matrix4().makeBasis(east,north,up).setPosition(up.clone().multiplyScalar(radius));return {east,north,up,toECEF,fromECEF:toECEF.clone().invert()};
}

// Headless access to the Rocktree 3D photogrammetry hierarchy. Default selection
// is the service-declared terminal leaves (maximum available resolution).
export class Tiles3D extends TileClient {
 constructor(options={}){
  super({concurrency:12,cacheName:'rea-3d-tiles-v1'});
  this.options={baseUrl:DEFAULT_BASE,latitude:null,longitude:null,radiusMeters:100,headingDegrees:null,fieldOfViewDegrees:90,nearRadiusMeters:60,maxDepth:null,targetMetersPerTexel:null,fullDetailRadiusMeters:null,pixelAngleRadians:null,layers:{terrain:true,overlay:true,water:true},textureOutput:'native',textureRequest:'dxt1',normals:false,includeBvh:false,metadataCacheSize:200,coordinates:'mesh',maxTiles:20000,order:'distance'};
  this.source=null;this.planet=null;this.credits=new Map();this.set(options);
 }
 onTransport(transport){this.source=new GoogleEarthSource({transport,baseUrl:this.options.baseUrl,maxParsedMetadata:this.options.metadataCacheSize});}
 src(){this.transport();return this.source;}
 setBaseUrl(url){let parsed;try{parsed=new URL(url);}catch{fail('baseUrl must be an absolute URL',{baseUrl:url});}if(!/^https?:$/.test(parsed.protocol))fail('baseUrl must be http(s)',{baseUrl:url});this.options.baseUrl=parsed.href.endsWith('/')?parsed.href:parsed.href+'/';if(this.source){this.source.baseUrl=this.options.baseUrl;this.source.clear();}this.planet=null;this.credits=new Map();return this;}
 setLocation(latitude,longitude){if(typeof latitude==='object'&&latitude)({latitude,longitude}=latitude);this.options.latitude=latitudeOf(latitude);this.options.longitude=longitudeOf(longitude);return this;}
 setRadius(meters){this.options.radiusMeters=positive(meters,'radiusMeters');return this;}
 setHeading(degrees){if(degrees!==null&&!Number.isFinite(degrees))fail('headingDegrees must be finite or null');this.options.headingDegrees=degrees===null?null:((degrees%360)+360)%360;return this;}
 setFieldOfView(degrees){if(!Number.isFinite(degrees)||degrees<=0||degrees>360)fail('fieldOfViewDegrees must be within (0, 360]',{degrees});this.options.fieldOfViewDegrees=degrees;return this;}
 setNearRadius(meters){this.options.nearRadiusMeters=nonNegative(meters,'nearRadiusMeters');return this;}
 setView({headingDegrees=this.options.headingDegrees,fieldOfViewDegrees=this.options.fieldOfViewDegrees,nearRadiusMeters=this.options.nearRadiusMeters}={}){return this.setHeading(headingDegrees).setFieldOfView(fieldOfViewDegrees).setNearRadius(nearRadiusMeters);}
 setMaxDepth(depth){if(depth!==null)positiveInt(depth,'maxDepth');this.options.maxDepth=depth;return this;}
 setTargetResolution(metersPerTexel){if(metersPerTexel!==null)positive(metersPerTexel,'targetMetersPerTexel');this.options.targetMetersPerTexel=metersPerTexel;return this;}
 setMaxResolution(){this.options.maxDepth=null;this.options.targetMetersPerTexel=null;return this;}
 // Distance falloff: terminal (maximum) tiles within fullDetailRadiusMeters of the focus; beyond it the
 // coarsest tile whose texels are still no larger than one screen pixel at that distance
 // (metersPerTexel <= distance x pixelAngleRadians). null disables it (terminal tiles everywhere).
 setFullDetailRadius(meters){if(meters!==null)nonNegative(meters,'fullDetailRadiusMeters');this.options.fullDetailRadiusMeters=meters;return this;}
 setPixelAngle(radians){if(radians!==null)positive(radians,'pixelAngleRadians');this.options.pixelAngleRadians=radians;return this;}
 setLayers(layers){if(Array.isArray(layers))layers=Object.fromEntries(LAYERS.map(l=>[l,layers.includes(l)]));if(!layers||typeof layers!=='object')fail('layers must be an object or array');for(const k of Object.keys(layers))if(!LAYERS.includes(k))fail('Unknown layer '+k,{known:LAYERS});const next={...this.options.layers,...layers};if(!LAYERS.some(l=>next[l]))fail('At least one layer must be enabled');for(const l of LAYERS)next[l]=!!next[l];this.options.layers=next;return this;}
 setTextureOutput(mode){if(!TEXTURE_OUTPUTS.includes(mode))fail('textureOutput must be one of '+TEXTURE_OUTPUTS.join(', '));this.options.textureOutput=mode;return this;}
 setTextureRequest(format){if(!(format in TEXTURE_REQUESTS))fail('textureRequest must be one of '+Object.keys(TEXTURE_REQUESTS).join(', '));this.options.textureRequest=format;return this;}
 // Parsed BulkMetadata packets kept in memory (each covers 4 octree levels).
 setMetadataCacheSize(n){this.options.metadataCacheSize=positiveInt(n,'metadataCacheSize');if(this.source)this.source.maxParsedMetadata=n;return this;}
 setNormals(enabled){this.options.normals=!!enabled;return this;}
 setIncludeBvh(enabled){this.options.includeBvh=!!enabled;return this;}
 setCoordinates(mode){if(!COORDINATES.includes(mode))fail('coordinates must be one of '+COORDINATES.join(', '));this.options.coordinates=mode;return this;}
 setMaxTiles(n){this.options.maxTiles=positiveInt(n,'maxTiles');return this;}
 setOrder(order){if(!ORDERS.includes(order))fail('order must be one of '+ORDERS.join(', '));this.options.order=order;return this;}
 getOptions(){return {...super.getOptions(),tiles:structuredClone(this.options)};}

 async getPlanet({refresh=false}={}){
  const source=this.src();
  if(!this.planet||refresh){const planet=await source.root();if(planet.epoch!==this.planet?.epoch){try{this.credits=await source.copyrights(planet.epoch);}catch(error){if(isAbort(error))throw error;this.credits=new Map();}}this.planet=planet;}
  return this.planet;
 }
 region(overrides={}){
  const o={...this.options,...overrides};
  if(o.latitude==null||o.longitude==null)throw new TileError('invalid_focus','Location not set: call setLocation(latitude, longitude) or pass latitude/longitude');
  latitudeOf(o.latitude);longitudeOf(o.longitude);positive(o.radiusMeters,'radiusMeters');nonNegative(o.nearRadiusMeters,'nearRadiusMeters');
  return o;
 }
 spec(o,planet){
  const focus=geoToECEF(o.latitude,o.longitude,0,planet.radius),normal=focus.clone().normalize();let viewDirection=null;
  if(o.headingDegrees!=null&&o.fieldOfViewDegrees<360){const f=enuFrame(o.latitude,o.longitude,planet.radius),h=o.headingDegrees*Math.PI/180;viewDirection=f.north.clone().multiplyScalar(Math.cos(h)).addScaledVector(f.east,Math.sin(h)).normalize();}
  return {focus,normal,radius:o.radiusMeters,viewDirection,viewHalfAngle:o.fieldOfViewDegrees*Math.PI/360,nearRadius:o.nearRadiusMeters};
 }
 select(node,o,spec){
  if(!node.hasData)return false;if(node.leaf)return true;
  if(o.fullDetailRadiusMeters!=null&&o.pixelAngleRadians!=null&&Number.isFinite(node.metersPerTexel)){const gap=node.center.distanceTo(spec.focus)-node.radius;if(gap>o.fullDetailRadiusMeters&&node.metersPerTexel<=gap*o.pixelAngleRadians)return true;}
  if(o.maxDepth!=null&&node.path.length>=o.maxDepth)return true;
  return o.targetMetersPerTexel!=null&&Number.isFinite(node.metersPerTexel)&&node.metersPerTexel<=o.targetMetersPerTexel;
 }
 describe(node,spec,planet){
  const geo=ecefToGeo(node.center,planet.radius),d={path:node.path,depth:node.path.length,url:node.key,leaf:node.leaf,center:[node.center.x,node.center.y,node.center.z],radius:node.radius,latitude:geo.latitude,longitude:geo.longitude,altitude:geo.altitude,distanceMeters:node.center.distanceTo(spec.focus),metersPerTexel:node.metersPerTexel,epoch:node.epoch,imageryEpoch:node.imageryEpoch??null,obb:node.extents?{center:[node.center.x,node.center.y,node.center.z],extents:[...node.extents],rotation:node.rotation}:null};
  Object.defineProperty(d,'node',{value:node,enumerable:false});return d;
 }
 // Lists the tiles selected for a region without downloading their payloads.
 async listTiles(overrides={}){
  const o=this.region(overrides),source=this.src(),planet=await this.getPlanet(),spec=this.spec(o,planet),found=[];let empty=0,truncated=false;
  const walk=async node=>{
   if(truncated)return;if(node.empty){empty++;return;}
   if(!node.root&&!intersectsRegion(node,spec))return;
   if(!node.root&&this.select(node,o,spec)){if(found.length>=o.maxTiles){truncated=true;return;}found.push(node);return;}
   if(node.leaf)return;
   const outcomes=await Promise.allSettled((await source.children(node)).map(walk)),failed=outcomes.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  };
  await walk({root:true,epoch:planet.epoch});
  if(truncated)throw new TileError('tile_limit','Region selects more tiles than maxTiles; reduce radius/field of view, lower resolution, or raise setMaxTiles()',{maxTiles:o.maxTiles});
  const tiles=found.map(n=>this.describe(n,spec,planet));
  tiles.sort(o.order==='path'?(a,b)=>a.path<b.path?-1:a.path>b.path?1:0:(a,b)=>a.distanceMeters-b.distanceMeters);
  return {epoch:planet.epoch,planetRadius:planet.radius,region:{latitude:o.latitude,longitude:o.longitude,radiusMeters:o.radiusMeters,headingDegrees:o.headingDegrees,fieldOfViewDegrees:o.fieldOfViewDegrees,nearRadiusMeters:o.nearRadiusMeters},selection:{maxDepth:o.maxDepth,targetMetersPerTexel:o.targetMetersPerTexel,fullDetailRadiusMeters:o.fullDetailRadiusMeters,pixelAngleRadians:o.pixelAngleRadians},declaredEmptyLeaves:empty,count:tiles.length,tiles};
 }
 // Child tiles of a descriptor (metadata only, no payload). Empty for leaves.
 async children(tile){if(!tile?.node)fail('children expects a descriptor from listTiles()');if(tile.node.leaf)return [];const planet=await this.getPlanet();return (await this.src().children(tile.node)).map(n=>this.describe(n,{focus:n.center},planet));}
 async resolvePath(path){
  if(typeof path!=='string'||!/^[0-7]+$/.test(path))fail('Tile path must be a non-empty octant string [0-7]+',{path});
  const source=this.src(),planet=await this.getPlanet();let node={root:true,epoch:planet.epoch};
  for(let i=1;i<=path.length;i++){const next=(await source.children(node)).find(c=>c.path===path.slice(0,i));if(!next)throw new TileError('not_found','Tile path not present in metadata',{path,missingAt:path.slice(0,i)});node=next;}
  if(!node.hasData)throw new TileError('no_data','Tile has no payload',{path});
  return this.describe(node,{focus:node.center},planet);
 }
 // Downloads and decodes one tile. Accepts a descriptor from listTiles() or an octant path.
 // request.priority: number or tuple, higher first (e.g. [tier, -distance]); request.signal cancels this call.
 async getTile(tile,overrides={},{signal,priority=0}={}){
  const o={...this.options,...overrides},descriptor=typeof tile==='string'?await this.resolvePath(tile):tile;
  if(!descriptor?.node)fail('getTile expects a descriptor from listTiles() or a path string');
  const source=this.src(),request=TEXTURE_REQUESTS[o.textureRequest]??fail('Invalid textureRequest'),url=source.nodeUrl(descriptor.node,request),raw=await source.loadNode(descriptor.node,url,{signal,priority}),matrix=Float64Array.from(raw.matrixGlobeFromMesh??[]);
  if(matrix.length!==16||!matrix.every(Number.isFinite))throw new TileError('invalid_geometry','Invalid tile transform',{path:descriptor.path});
  const toECEF=new Matrix4().fromArray(matrix),frame=o.coordinates==='local'?enuFrame(this.region(o).latitude,o.longitude,this.planet.radius):null,meshes=[];
  const groups=[['terrain',raw.meshes],['overlay',raw.overlaySurfaceMeshes],['water',raw.waterMesh?[raw.waterMesh]:[]]];
  for(const [layer,list]of groups){if(!o.layers[layer])continue;for(const surface of list??[]){
   const arrays=surfaceArrays(surface,descriptor.path);if(!arrays)continue;
   let positions=arrays.positions;
   if(o.coordinates!=='mesh'){const m=frame?new Matrix4().multiplyMatrices(frame.fromECEF,toECEF):toECEF,out=new Float64Array(positions.length),v=new Vector3();for(let i=0;i<positions.length;i+=3){v.set(positions[i],positions[i+1],positions[i+2]).applyMatrix4(m);out[i]=v.x;out[i+1]=v.y;out[i+2]=v.z;}positions=out;}
   meshes.push({layer,vertexCount:arrays.positions.length/3,triangleCount:arrays.indices.length/3,positions,uvs:arrays.uv,indices:arrays.indices,normals:o.normals?vertexNormals(positions,arrays.indices):null,vertexAlphas:surface.vertexAlphas?Uint8Array.from(surface.vertexAlphas):null,octantCounts:surface.octantCounts?Array.from(surface.octantCounts):null,texture:await this.texture(surface.texture,o.textureOutput,descriptor.path)});
  }}
  const result={...descriptor,url,textureRequest:o.textureRequest,nonEmptyOctants:raw.nonEmptyOctants??null,bvh:o.includeBvh&&raw.bvhNodes?{nodes:Float32Array.from(raw.bvhNodes),triPermutation:raw.bvhTriPermutation?Uint32Array.from(raw.bvhTriPermutation):null}:null,coordinates:o.coordinates,matrixGlobeFromMesh:matrix,copyrightIds:[...(raw.copyrightIds??[])],credits:[...new Set((raw.copyrightIds??[]).map(id=>this.credits.get(id)).filter(Boolean))],meshes};
  Object.defineProperty(result,'node',{value:descriptor.node,enumerable:false});Object.defineProperty(result,'raw',{value:raw,enumerable:false});return result;
 }
 async texture(tex,mode,path){
  if(!tex||mode==='none')return null;
  const bytes=new Uint8Array(tex.bytes),base={width:tex.width,height:tex.height};
  if(tex.textureFormat===6)return mode==='rgba'?{...base,format:'rgba',data:new Uint8Array(decodeDXT(new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tex.width,tex.height,'dxt1'))}:{...base,format:'dxt1',data:bytes};
  if(tex.textureFormat===1)return mode==='rgba'?{...base,format:'rgba',data:await jpegToRgba(bytes)}:{...base,format:'jpeg',data:bytes};
  throw new TileError('unsupported_texture','Unknown texture format '+tex.textureFormat,{path});
 }
 // Maximum-resolution tile whose footprint contains the point (nearest centre).
 async getTileAt(latitude,longitude,overrides={}){const list=await this.listTiles({...overrides,latitude,longitude,radiusMeters:overrides.radiusMeters??1,headingDegrees:null,order:'distance'});if(!list.count)throw new TileError('no_data','No 3D tile covers this point',{latitude,longitude});return this.getTile(list.tiles[0],{...overrides,latitude,longitude});}
 // Highest surface hit by a vertical ray at the point, from the selected 3D meshes.
 // altitude is relative to the planet sphere (getPlanet().radius), like the tile data.
 async getElevation(latitude,longitude,{radiusMeters=3,...overrides}={}){
  latitudeOf(latitude);longitudeOf(longitude);
  const o={...overrides,latitude,longitude,radiusMeters,headingDegrees:null,coordinates:'local',textureRequest:'none',textureOutput:'none',normals:false};
  const list=await this.listTiles(o);let best=null;
  for(const d of list.tiles){const tile=await this.getTile(d,o);for(const m of tile.meshes){const h=verticalHit(m.positions,m.indices);if(h!==null&&(best===null||h>best.altitude))best={altitude:h,path:tile.path,layer:m.layer};}}
  return best?{latitude,longitude,...best,reference:'sphere',planetRadius:this.planet.radius}:{latitude,longitude,altitude:null,path:null,reference:'sphere',planetRadius:this.planet.radius,tilesExamined:list.count};
 }
 // Streams decoded tiles for a region, nearest first, with bounded parallelism.
 async *streamTiles(overrides={},{signal,concurrency=this.network.concurrency}={}){
  const list=await this.listTiles(overrides),queue=[...list.tiles],running=new Map();let index=0;
  const launch=()=>{while(running.size<concurrency&&index<queue.length){const i=index++,d=queue[i];running.set(i,this.getTile(d,overrides,{signal,priority:-i}).then(tile=>({i,tile}),error=>({i,error,descriptor:d})));}};
  launch();
  while(running.size){if(signal?.aborted)throw new DOMException('Operation canceled','AbortError');const r=await Promise.race(running.values());running.delete(r.i);launch();yield r.error?{error:r.error,descriptor:r.descriptor,index:r.i,total:queue.length}:{tile:r.tile,index:r.i,total:queue.length};}
 }
 // Downloads a whole region; failures are reported, never silently dropped.
 async getTiles(overrides={},{onProgress,signal,concurrency}={}){
  const tiles=[],errors=[];let total=0,done=0;
  for await(const r of this.streamTiles(overrides,{signal,concurrency})){total=r.total;done++;if(r.error){if(isAbort(r.error))throw r.error;errors.push({path:r.descriptor.path,code:r.error.code??'unavailable',message:r.error.message});}else tiles.push(r.tile);onProgress?.({done,total,tile:r.tile,error:r.error});}
  return {complete:errors.length===0,total,tiles,errors,attribution:this.getAttribution(tiles)};
 }
 getAttribution(tiles=[]){const counts=new Map();for(const t of tiles)for(const c of t.credits??[])counts.set(c,(counts.get(c)??0)+1);return ['Google Earth / Maps',...[...counts].sort((a,b)=>b[1]-a[1]).map(([c])=>c)].join(' · ');}
 // Builds a Three.js Group (ECEF placement) from a tile returned by getTile().
 async toThree(tile,{renderer,layers=this.options.layers}={}){
  if(!tile?.raw)fail('toThree expects a tile returned by getTile()');
  const raw=tile.raw,filtered={...raw,meshes:layers.terrain?raw.meshes:[],overlaySurfaceMeshes:layers.overlay?raw.overlaySurfaceMeshes:[],waterMesh:layers.water?raw.waterMesh:null};
  const asset=await buildAsset(filtered,{path:tile.path,key:tile.url},renderer);asset.group.userData.dispose=()=>disposeAsset(asset);asset.group.userData.gpuBytes=asset.gpuBytes;return asset.group;
 }
 // decoder: 'worker' (off the main thread) or 'inline'.
 getStats(){return {...super.getStats(),decoder:decoderPool().mode};}
 async dispose(){await super.dispose();this.source?.clear();}
}
function vertexNormals(p,idx){const n=new Float32Array(p.length);for(let i=0;i<idx.length;i+=3){const a=idx[i]*3,b=idx[i+1]*3,c=idx[i+2]*3,ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2],x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx;for(const k of [a,b,c]){n[k]+=x;n[k+1]+=y;n[k+2]+=z;}}for(let i=0;i<n.length;i+=3){const l=Math.hypot(n[i],n[i+1],n[i+2])||1;n[i]/=l;n[i+1]/=l;n[i+2]/=l;}return n;}
// Ray x=y=0 along +z in a local ENU frame: highest triangle crossing the origin column.
function verticalHit(p,idx){let best=null;for(let i=0;i<idx.length;i+=3){const a=idx[i]*3,b=idx[i+1]*3,c=idx[i+2]*3,ax=p[a],ay=p[a+1],bx=p[b],by=p[b+1],cx=p[c],cy=p[c+1];const d=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);if(Math.abs(d)<1e-12)continue;const w1=((by-cy)*(-cx)+(cx-bx)*(-cy))/d,w2=((cy-ay)*(-cx)+(ax-cx)*(-cy))/d,w3=1-w1-w2;if(w1<0||w2<0||w3<0)continue;const z=w1*p[a+2]+w2*p[b+2]+w3*p[c+2];if(best===null||z>best)best=z;}return best;}
Tiles3D.optionSetters={...TileClient.optionSetters,baseUrl:{name:'setBaseUrl'},location:{name:'setLocation',spread:true},radiusMeters:{name:'setRadius'},headingDegrees:{name:'setHeading'},fieldOfViewDegrees:{name:'setFieldOfView'},nearRadiusMeters:{name:'setNearRadius'},maxDepth:{name:'setMaxDepth'},targetMetersPerTexel:{name:'setTargetResolution'},layers:{name:'setLayers'},textureOutput:{name:'setTextureOutput'},coordinates:{name:'setCoordinates'},textureRequest:{name:'setTextureRequest'},normals:{name:'setNormals'},metadataCacheSize:{name:'setMetadataCacheSize'},includeBvh:{name:'setIncludeBvh'},maxTiles:{name:'setMaxTiles'},order:{name:'setOrder'},fullDetailRadiusMeters:{name:'setFullDetailRadius'},pixelAngleRadians:{name:'setPixelAngle'}};
