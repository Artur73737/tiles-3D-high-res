import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3} from 'three';
import {Tiles2D,Tiles3D,createTiles,GOOGLE_LAYERS,GOOGLE_LAYER_ORDER,layerConflicts,resolveLayers,lonLatToTile,tileBounds,metersPerPixel,TileError} from '../src/tiles.js';
const fixture=name=>new Uint8Array(readFileSync(new URL('./fixtures/'+name,import.meta.url)));
const tick=(ms=0)=>new Promise(r=>setTimeout(r,ms));
const jpeg=(seed=1)=>new Uint8Array([0xff,0xd8,0xff,0xe0,seed,seed+1,seed+2]);
const q=url=>Object.fromEntries(new URL(url).searchParams);
function mockFetch(handler=()=>({body:jpeg()})){
 const calls=[];const fetch=async(url,init)=>{calls.push({url,init});const r=await handler(url,init,calls.length);if(r instanceof Response)return r;if(r.throw)throw r.throw;return new Response(r.body??jpeg(),{status:r.status??200,headers:{'content-type':'image/jpeg','cache-control':'max-age=600',...r.headers}});};
 return {fetch,calls};
}

// ---------------- 2D (Google) ----------------
test('2D tile math: tile at point, bounds and resolution',()=>{
 assert.deepEqual(lonLatToTile(0,0,1),{x:1,y:1,z:1});
 const t=lonLatToTile(41.89021,12.49223,19);assert.deepEqual(t,{x:280337,y:194839,z:19});
 const b=tileBounds(t.z,t.x,t.y);assert.ok(b.west<=12.49223&&b.east>=12.49223&&b.south<=41.89021&&b.north>=41.89021);
 assert.ok(Math.abs(metersPerPixel(0,0)-156543.03)<0.01);assert.ok(Math.abs(metersPerPixel(0,1,512)-39135.76)<0.01);
});
test('2D Google URL: layers, scale, language, region, style, servers and extra query',()=>{
 const c=new Tiles2D();
 assert.equal(c.tileUrl(3,1,2),'https://mt3.google.com/vt/?lyrs=s&x=1&y=2&z=3&scale=1&hl=en');
 c.setLayers(['s','r']).setScale(4).setLanguage('zh-CN').setRegion('RU').setStyle('s.e:l|p.v:off');
 assert.deepEqual(q(c.tileUrl(3,1,2)),{lyrs:'s,r',x:'1',y:'2',z:'3',scale:'4',hl:'zh-CN',gl:'ru',apistyle:'s.e:l|p.v:off'});assert.match(c.tileUrl(3,1,2),/lyrs=s,r&/);
 assert.equal(c.tileSize,1024);c.setScale(2);assert.equal(c.tileSize,512);
 c.setLayer('y').setRegion(null).setStyle(null);assert.deepEqual(Object.keys(q(c.tileUrl(3,1,2))),['lyrs','x','y','z','scale','hl']);
 c.setServers([1]);assert.match(c.tileUrl(3,1,2),/^https:\/\/mt1\./);c.setServers([0,2]);assert.match(c.tileUrl(3,0,0),/mt0/);assert.match(c.tileUrl(3,1,0),/mt2/);
 c.setLayers('h,m');assert.equal(q(c.tileUrl(1,0,0)).lyrs,'h,m');
 c.setQuery({v:'1'});assert.equal(q(c.tileUrl(1,0,0)).v,'1');c.setQuery({w:2},{merge:false});assert.deepEqual([q(c.tileUrl(1,0,0)).v,q(c.tileUrl(1,0,0)).w],[undefined,'2']);
 for(const l of Object.keys(GOOGLE_LAYERS))c.setLayer(l);
 for(const bad of [()=>c.setLayer('x'),()=>c.setLayers([]),()=>c.setScale(3),()=>c.setLanguage('english!'),()=>c.setRegion('usa'),()=>c.setStyle('   '),()=>c.setServers([4]),()=>c.setServers([]),()=>c.setZoomRange(5,2),()=>c.setZoomRange(0,23),()=>c.setQuery({lyrs:'m'}),()=>c.tileUrl(2,4,0)])assert.throws(bad,TileError);
});
test('2D set() maps every option and rejects unknown ones; getOptions is a snapshot',()=>{
 const {fetch}=mockFetch();
 const c=createTiles('2d',{layers:['y'],scale:2,language:'fr',region:'de',style:'s.t:1|p.v:off',servers:[2],zoomRange:[2,10],query:{a:1},overzoom:true,concurrency:3,timeoutMs:500,retries:[4,10],headers:{'X-A':'1'},maxResponseBytes:1000,credentials:'same-origin',referrerPolicy:'no-referrer',fetch,cache:{mode:'none'}});
 const o=c.getOptions();
 assert.deepEqual(o.tiles,{layers:['y'],scale:2,language:'fr',region:'de',style:'s.t:1|p.v:off',servers:[2],minZoom:2,maxZoom:10,overzoom:true,query:{a:'1'}});
 assert.deepEqual(o.network,{concurrency:3,timeoutMs:500,retries:4,retryDelayMs:10,headers:{'X-A':'1'},maxResponseBytes:1000,fetch:true,credentials:'same-origin',referrerPolicy:'no-referrer'});assert.equal(o.cache.mode,'none');
 o.tiles.layers.push('m');assert.deepEqual(c.options.layers,['y']);
 assert.throws(()=>c.set({provider:'esri'}),/Unknown option provider/);assert.throws(()=>createTiles('4d'));
});
test('2D download: headers, credentials, referrer, content type, bounds and zoom range',async()=>{
 const {fetch,calls}=mockFetch(url=>({body:q(url).lyrs==='h'?new Uint8Array([0x89,0x50,1]):jpeg(),headers:{'content-type':''}}));
 const c=new Tiles2D({fetch,headers:{Authorization:'Bearer t'},credentials:'same-origin',referrerPolicy:'origin'}).setLayer('h').setZoomRange(1,5);
 const tile=await c.getTile(3,1,2);assert.equal(tile.mimeType,'image/png');assert.deepEqual(tile.bounds,tileBounds(3,1,2));assert.equal(tile.crop,null);assert.equal(tile.tileSize,256);
 assert.equal(calls[0].init.headers.Authorization,'Bearer t');assert.equal(calls[0].init.credentials,'same-origin');assert.equal(calls[0].init.referrerPolicy,'origin');
 c.setHeaders({'X-B':'2'},{merge:true});await c.getTile(3,1,3);assert.deepEqual(calls[1].init.headers,{Authorization:'Bearer t','X-B':'2'});
 await assert.rejects(c.getTile(0,0,0),{code:'zoom_range'});await assert.rejects(c.getTile(6,0,0),{code:'zoom_range'});
 const at=await c.getTileAt(41.89,12.49,4);assert.deepEqual([at.z,at.x,at.y],[4,8,5]);
 await c.dispose();
});
test('2D overzoom returns the real parent tile with an exact crop instead of upscaled pixels',async()=>{
 const {fetch,calls}=mockFetch();const c=new Tiles2D({fetch}).setZoomRange(0,2).setOverzoom(true);
 const t=await c.getTile(4,13,6);assert.deepEqual(t.source,{z:2,x:3,y:1});assert.deepEqual(t.crop,{x:64,y:128,width:64,height:64});assert.deepEqual([q(calls[0].url).z,q(calls[0].url).x,q(calls[0].url).y],['2','3','1']);
 c.setScale(2);const t2=await c.getTile(4,13,6);assert.deepEqual(t2.crop,{x:128,y:256,width:128,height:128});
 c.setOverzoom(false);await assert.rejects(c.getTile(4,13,6),{code:'zoom_range'});await c.dispose();
});
test('2D region download over bounds, antimeridian, limits and per-tile errors',async()=>{
 const {fetch}=mockFetch(url=>q(url).z==='3'&&q(url).x==='0'?{status:404}:{});const c=new Tiles2D({fetch,retries:[0]});
 const list=c.tilesInBounds({west:-10,south:-10,east:10,north:10},3);assert.deepEqual(list.map(t=>[t.x,t.y]),[[3,3],[4,3],[3,4],[4,4]]);
 assert.deepEqual(c.tilesInBounds({west:170,south:-1,east:-170,north:1},3).map(t=>t.x).sort(),[0,0,7,7]);
 assert.throws(()=>c.tilesInBounds({west:-180,south:-80,east:180,north:80},10,{maxTiles:10}),{code:'tile_limit'});
 const progress=[];const r=await c.getTiles({west:-180,south:-10,east:-130,north:10},3,{onProgress:p=>progress.push(p.done)});
 assert.equal(r.total,4);assert.equal(r.complete,false);assert.equal(r.errors.length,2);assert.ok(r.errors.every(e=>e.code==='http_error'&&e.x===0));assert.equal(r.tiles.length,2);assert.deepEqual(progress,[1,2,3,4]);assert.equal(r.attribution,'Imagery © Google');
 await c.dispose();
});
test('2D findMaxZoom skips HTTP gaps and shared placeholder images',async()=>{
 const {fetch}=mockFetch(url=>{const z=Number(q(url).z),x=Number(q(url).x);if(z>=8)return {status:400};if(z>=6)return {body:jpeg(99)};return {body:jpeg(x%200)};});
 const c=new Tiles2D({fetch});
 assert.equal((await c.findMaxZoom(41.9,12.5)).z,5);
 assert.equal((await c.findMaxZoom(41.9,12.5,{isValid:()=>true})).z,7);
 assert.equal((await c.findMaxZoom(41.9,12.5,{isValid:()=>false})).z,null);await c.dispose();
});
test('2D getImage reports unsupported environments explicitly',async()=>{
 await assert.rejects(new Tiles2D().getImage({west:0,south:0,east:1,north:1},2),{code:'unsupported_environment'});
});

// ---------------- network / cache (shared) ----------------
test('concurrency is bounded and live-adjustable',async()=>{
 let active=0,peak=0;const release=[];const fetch=async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>release.push(r));active--;return new Response(jpeg(),{headers:{'cache-control':'max-age=60'}});};
 const c=new Tiles2D({fetch,concurrency:2});const all=Promise.all(Array.from({length:6},(_,i)=>c.getTile(3,i,0)));
 await tick(5);assert.equal(peak,2);c.setConcurrency(4);await tick(5);assert.equal(active,4);while(release.length)release.shift()();await tick(5);while(release.length)release.shift()();await all;assert.equal(peak,4);await c.dispose();
});
test('timeout, retries with backoff, and non-retryable errors',async()=>{
 let n=0;const flaky=async()=>{n++;if(n<3)return new Response('',{status:503});return new Response(jpeg());};
 const c=new Tiles2D({fetch:flaky}).setRetries(2,1);await c.getTile(1,0,0);assert.equal(n,3);assert.equal(c.getStats().retries,2);
 n=0;c.setRetries(1,1);await assert.rejects(c.getTile(1,1,0),{code:'http_error'});assert.equal(n,2);
 let m=0;const notFound=new Tiles2D({fetch:async()=>{m++;return new Response('',{status:404});},retries:[5,1]});await assert.rejects(notFound.getTile(1,0,0),{code:'http_error'});assert.equal(m,1);
 const hang=(url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('x','AbortError'))));
 const slow=new Tiles2D({fetch:hang,timeoutMs:20,retries:[1,1]});const t0=Date.now();await assert.rejects(slow.getTile(1,0,0),{code:'timeout'});assert.equal(slow.getStats().networkRequests,2);assert.ok(Date.now()-t0<1000);
 const offline=new Tiles2D({fetch:async()=>{throw new TypeError('fetch failed');},retries:[0]});await assert.rejects(offline.getTile(1,0,0),{code:'network_error'});
 for(const x of [c,notFound,slow,offline])await x.dispose();
});
test('maxResponseBytes limits declared and streamed bodies',async()=>{
 const c=new Tiles2D({fetch:async()=>new Response(new Uint8Array(100)),maxResponseBytes:50});await assert.rejects(c.getTile(1,0,0),{code:'resource_limit'});
 c.setMaxResponseBytes(200);assert.equal((await c.getTile(1,1,0)).bytes.length,100);await c.dispose();
});
test('cache modes: memory hits, none, TTL override, memory budget and switching fetch',async()=>{
 const {fetch,calls}=mockFetch(()=>({headers:{'cache-control':'no-cache'}}));const c=new Tiles2D({fetch});
 await c.getTile(1,0,0);await c.getTile(1,0,0);assert.equal(calls.length,2,'no-cache response is not reused');
 c.setCache({ttlSeconds:60});await c.getTile(1,0,0);await c.getTile(1,0,0);assert.equal(calls.length,3);assert.equal(c.getStats().memoryHits,1);
 c.setCache('none');await c.getTile(1,0,0);await c.getTile(1,0,0);assert.equal(calls.length,5);
 c.setCache({mode:'memory',memoryBytes:8,ttlSeconds:60});await c.getTile(1,0,0);await c.getTile(1,1,0);await c.getTile(1,0,0);assert.equal(calls.length,8,'LRU evicted the older tile under an 8-byte budget');
 c.setCache({mode:'persistent'});await c.getTile(1,0,0);assert.match(c.getStats().cacheWarning,/IndexedDB unavailable/);
 const other=mockFetch();c.setFetch(other.fetch);await c.getTile(2,0,0);assert.equal(other.calls.length,1);
 assert.throws(()=>c.setCache({mode:'disk'}));assert.throws(()=>c.setCache({memoryBytes:-1}));assert.throws(()=>c.setFetch(5));assert.throws(()=>c.setCredentials('all'));assert.throws(()=>c.setHeaders({a:1}));assert.throws(()=>c.setTimeout(-1));assert.throws(()=>c.setConcurrency(0));assert.throws(()=>c.setRetries(-1));
 await c.clearCache();await c.dispose();await assert.rejects(c.getTile(1,0,0),{name:'AbortError'});
});
test('changing transport settings does not abort requests already in flight',async()=>{
 let release;const fetch=async()=>{await new Promise(r=>release=r);return new Response(jpeg());};
 const c=new Tiles2D({fetch});const pending=c.getTile(1,0,0);await tick(5);c.setCache('none');release();assert.equal((await pending).bytes.length,7);await c.dispose();
});

// ---------------- 3D ----------------
function fake3D(){
 const planet=fixture('planet.pb'),bulk=fixture('bulk.pb'),node=fixture('node.pb'),prefix='30427242735060526245',calls=[];
 const fetch=async url=>{calls.push(url);if(url.includes('PlanetoidMetadata'))return new Response(planet);if(url.includes('Copyrights'))return new Response(new Uint8Array());
  if(url.includes('BulkMetadata')){const path=/!1s(\d*)!/.exec(url)[1];if(path!==prefix)return new Response('',{status:404});return new Response(bulk,{headers:{'cache-control':'max-age=600'}});}
  if(url.includes('NodeData'))return new Response(node,{headers:{'cache-control':'max-age=600'}});return new Response('',{status:404});};
 return {fetch,calls,prefix};
}
// The bulk fixture is rooted at a deep prefix; start the walk there to keep the test offline.
async function fixtureClient(options={}){
 const f=fake3D(),c=new Tiles3D({fetch:f.fetch,...options});const source=c.src(),root=source.root.bind(source);
 const realChildren=source.children.bind(source);source.children=async node=>node.root?[{path:f.prefix,leaf:false,bulkEpoch:1016,bulk:{path:f.prefix.slice(0,-4)},empty:false,hasData:false,center:new Vector3(),radius:1e8}]:realChildren(node);
 return {c,f,source,root};
}
test('3D option setters validate and set() maps every option',()=>{
 const {fetch}=fake3D();
 const c=new Tiles3D({fetch,baseUrl:'https://mirror.test/rt',location:[41.9,12.5],radiusMeters:250,headingDegrees:-90,fieldOfViewDegrees:120,nearRadiusMeters:30,maxDepth:18,targetMetersPerTexel:0.5,layers:['terrain'],textureOutput:'rgba',coordinates:'ecef',maxTiles:10,order:'path',concurrency:4,cache:'none'});
 const t=c.getOptions().tiles;
 assert.equal(t.baseUrl,'https://mirror.test/rt/');assert.equal(t.latitude,41.9);assert.equal(t.headingDegrees,270);assert.equal(t.fieldOfViewDegrees,120);assert.equal(t.nearRadiusMeters,30);assert.equal(t.maxDepth,18);assert.equal(t.targetMetersPerTexel,0.5);
 assert.deepEqual(t.layers,{terrain:true,overlay:false,water:false});assert.equal(t.textureOutput,'rgba');assert.equal(t.coordinates,'ecef');assert.equal(t.maxTiles,10);assert.equal(t.order,'path');
 c.setMaxResolution();assert.equal(c.options.maxDepth,null);assert.equal(c.options.targetMetersPerTexel,null);
 c.setView({headingDegrees:null,fieldOfViewDegrees:360});assert.equal(c.options.headingDegrees,null);c.setLocation({latitude:1,longitude:2});assert.equal(c.options.longitude,2);
 c.setLayers({water:true});assert.deepEqual(c.options.layers,{terrain:true,overlay:false,water:true});
 for(const bad of [()=>c.setLocation(91,0),()=>c.setLocation(0,181),()=>c.setRadius(0),()=>c.setFieldOfView(0),()=>c.setFieldOfView(361),()=>c.setMaxDepth(0),()=>c.setTargetResolution(-1),()=>c.setLayers({roads:true}),()=>c.setLayers({terrain:false,water:false}),()=>c.setTextureOutput('png'),()=>c.setCoordinates('wgs'),()=>c.setOrder('x'),()=>c.setMaxTiles(0),()=>c.setBaseUrl('nota url'),()=>c.setBaseUrl('file:///x'),()=>c.set({nope:1})])assert.throws(bad,TileError);
});
test('3D listTiles requires a location and returns terminal (maximum resolution) leaves by default',async()=>{
 const {c,f}=await fixtureClient();await assert.rejects(c.listTiles(),{code:'invalid_focus'});
 const probe=await c.source.loadBulk(f.prefix,1016);const any=c.source.node(probe,0,f.prefix+'0');
 const {latitude,longitude}=(await import('../src/core/geo.js')).ecefToGeo(any.center,6371010);
 c.setLocation(latitude,longitude).setRadius(400);
 const all=await c.listTiles();assert.ok(all.count>0);assert.ok(all.tiles.every(t=>t.leaf));assert.equal(all.epoch,1016);
 for(let i=1;i<all.tiles.length;i++)assert.ok(all.tiles[i-1].distanceMeters<=all.tiles[i].distanceMeters);
 const byPath=await c.listTiles({order:'path'});assert.deepEqual(byPath.tiles.map(t=>t.path),[...byPath.tiles.map(t=>t.path)].sort());
 const small=await c.listTiles({radiusMeters:20});assert.ok(small.count<all.count);
 const shallow=await c.listTiles({maxDepth:f.prefix.length+1});assert.ok(shallow.count<all.count);assert.ok(shallow.tiles.every(t=>t.depth<=f.prefix.length+1||t.leaf));
 const coarse=Math.max(...all.tiles.map(t=>t.metersPerTexel))*4;const target=await c.listTiles({targetMetersPerTexel:coarse});assert.ok(target.count<all.count);assert.ok(target.tiles.every(t=>t.metersPerTexel<=coarse));
 const north=await c.listTiles({headingDegrees:0,fieldOfViewDegrees:30,nearRadiusMeters:0}),south=await c.listTiles({headingDegrees:180,fieldOfViewDegrees:30,nearRadiusMeters:0});assert.ok(north.count<all.count&&south.count<all.count);
 assert.ok(north.tiles.every(t=>t.latitude>=latitude-0.001));assert.ok(south.tiles.every(t=>t.latitude<=latitude+0.001));
 await assert.rejects(c.listTiles({maxTiles:1}),{code:'tile_limit'});await c.dispose();
});
test('3D getTile decodes geometry/texture with layer, texture and coordinate options',async()=>{
 const {c,f}=await fixtureClient();const probe=await c.source.loadBulk(f.prefix,1016),any=c.source.node(probe,0,f.prefix+'0');
 const {latitude,longitude}=(await import('../src/core/geo.js')).ecefToGeo(any.center,6371010);c.setLocation(latitude,longitude).setRadius(100);
 const [d]=(await c.listTiles()).tiles;
 const tile=await c.getTile(d);assert.equal(tile.coordinates,'mesh');assert.ok(tile.meshes.length>0);assert.equal(tile.matrixGlobeFromMesh.length,16);
 const m=tile.meshes[0];assert.ok(m.positions instanceof Uint8Array);assert.equal(m.positions.length,m.vertexCount*3);assert.equal(m.uvs.length,m.vertexCount*2);assert.equal(m.indices.length,m.triangleCount*3);assert.ok(m.indices.every(i=>i<m.vertexCount));
 assert.ok(['dxt1','jpeg'].includes(m.texture.format));
 const ecef=await c.getTile(d,{coordinates:'ecef'}),p=ecef.meshes[0].positions;assert.ok(p instanceof Float64Array);const r=Math.hypot(p[0],p[1],p[2]);assert.ok(Math.abs(r-6371010)<10000,'ECEF on globe: '+r);
 const local=await c.getTile(d,{coordinates:'local'}),q=local.meshes[0].positions;assert.ok(Math.hypot(q[0],q[1])<1000&&Math.abs(q[2])<1000,'ENU near origin');
 const none=await c.getTile(d,{textureOutput:'none'});assert.equal(none.meshes[0].texture,null);
 if(m.texture.format==='dxt1'){const rgba=await c.getTile(d,{textureOutput:'rgba'});const t=rgba.meshes[0].texture;assert.equal(t.format,'rgba');assert.equal(t.data.length,t.width*t.height*4);}
 const water=await c.getTile(d,{layers:{terrain:false,overlay:false,water:true}});assert.ok(water.meshes.every(x=>x.layer==='water'));
 const group=await c.toThree(tile);assert.ok(group.isGroup&&group.children.length>0);assert.ok(group.userData.gpuBytes>0);group.userData.dispose();
 await assert.rejects(c.toThree({}),TileError);await assert.rejects(c.getTile({}),TileError);
 await c.dispose();
});
test('3D streamTiles/getTiles honor concurrency, progress and report failures',async()=>{
 const {c,f}=await fixtureClient();const probe=await c.source.loadBulk(f.prefix,1016),any=c.source.node(probe,0,f.prefix+'0');
 const {latitude,longitude}=(await import('../src/core/geo.js')).ecefToGeo(any.center,6371010);c.setLocation(latitude,longitude).setRadius(60);
 const list=await c.listTiles();let fail=list.tiles[0].url;const load=c.source.loadNode.bind(c.source);c.source.loadNode=async n=>{if(n.key===fail)throw new TileError('http_error','boom',{});return load(n);};
 const seen=[];const r=await c.getTiles({},{concurrency:2,onProgress:p=>seen.push(p.done)});assert.equal(r.total,list.count);assert.equal(r.tiles.length,list.count-1);assert.equal(r.errors[0].path,list.tiles[0].path);assert.equal(r.complete,false);assert.equal(seen.length,list.count);assert.match(r.attribution,/^Google Earth/);
 const ac=new AbortController();ac.abort();await assert.rejects(async()=>{for await(const _ of c.streamTiles({},{signal:ac.signal}));},{name:'AbortError'});
 await c.dispose();
});
test('3D baseUrl applies to every request',async()=>{
 const {fetch,calls}=fake3D();const c=new Tiles3D({fetch}).setBaseUrl('https://mirror.test/rt/earth');await c.getPlanet();assert.ok(calls.every(u=>u.startsWith('https://mirror.test/rt/earth/')));assert.equal(calls[0],'https://mirror.test/rt/earth/PlanetoidMetadata');
 c.setBaseUrl('https://other.test/');await c.getPlanet();assert.ok(calls.at(-1).startsWith('https://other.test/'));await c.dispose();
});
test('3D resolvePath rejects malformed paths',async()=>{const c=new Tiles3D({fetch:fake3D().fetch});await assert.rejects(c.resolvePath('12a'),TileError);await assert.rejects(c.getTile('9'),TileError);await c.dispose();});
test('3D server texture request, normals, BVH, OBB, tile at point and elevation',async()=>{
 const {c,f}=await fixtureClient();const probe=await c.source.loadBulk(f.prefix,1016),any=c.source.node(probe,0,f.prefix+'0');
 const {latitude,longitude}=(await import('../src/core/geo.js')).ecefToGeo(any.center,6371010);c.setLocation(latitude,longitude).setRadius(60);
 const [d]=(await c.listTiles()).tiles;assert.equal(d.obb.extents.length,3);assert.equal(d.obb.rotation.length,9);
 const jpeg=await c.getTile(d,{textureRequest:'jpeg'});assert.match(jpeg.url,/!2e1(!3u\d+)?!4b0$/);assert.equal(jpeg.textureRequest,'jpeg');
 const none=await c.getTile(d,{textureRequest:'none'});assert.match(none.url,/!2e6(!3u\d+)?!4b1$/);
 const dxt=await c.getTile(d);assert.match(dxt.url,/!2e6(!3u\d+)?!4b0$/);assert.equal(dxt.bvh,null);assert.equal(dxt.meshes[0].normals,null);
 const extra=await c.set({normals:true,includeBvh:true}).getTile(d,{coordinates:'local'});const m=extra.meshes[0];
 assert.equal(m.normals.length,m.vertexCount*3);for(let i=0;i<m.normals.length;i+=3)assert.ok(Math.abs(Math.hypot(m.normals[i],m.normals[i+1],m.normals[i+2])-1)<1e-4||Math.hypot(m.normals[i],m.normals[i+1],m.normals[i+2])===0);
 assert.ok(extra.bvh.nodes.length>0);assert.equal(typeof extra.nonEmptyOctants,'number');assert.ok(Array.isArray(m.octantCounts));
 c.set({normals:false,includeBvh:false});
 const at=await c.getTileAt(d.latitude,d.longitude);assert.ok(at.leaf&&at.meshes.length);
 const e=await c.getElevation(d.latitude,d.longitude,{radiusMeters:5});assert.equal(e.reference,'sphere');assert.ok(e.altitude===null||Math.abs(e.altitude-d.altitude)<200,JSON.stringify(e));
 assert.throws(()=>c.setTextureRequest('png'),TileError);await c.dispose();
});
test('2D overlays and structured apistyle rules encode to the verified grammar',()=>{
 const c=new Tiles2D().setLayers('m, traffic,transit,bike');assert.equal(q(c.tileUrl(1,0,0)).lyrs,'m,traffic,transit,bike');
 c.setStyle([{featureId:3,element:'geometry',color:'#FF0000',weight:3},{element:'labels.text',visibility:'off'},{saturation:-100,lightness:50,gamma:2,hue:'#00ff00'}]);
 assert.equal(c.options.style,'s.t:3|s.e:g|p.c:#ffff0000|p.w:3,s.e:l.t|p.v:off,p.h:#ff00ff00|p.s:-100|p.l:50|p.g:2');
 assert.equal(q(c.tileUrl(1,0,0)).apistyle,c.options.style);c.setStyle('s.e:l|p.v:off');assert.equal(c.options.style,'s.e:l|p.v:off');c.setStyle(null);assert.equal(c.options.style,null);
 for(const bad of [[{element:'roads',visibility:'off'}],[{featureId:3}],[{visibility:'maybe'}],[{color:'red'}],[{saturation:200}],[{gamma:0}],[{weight:-1}],[{featureId:-1,visibility:'off'}],[{bogus:1}],[],'  '])assert.throws(()=>c.setStyle(bad),TileError,JSON.stringify(bad));
 const t=new Tiles3D().setMetadataCacheSize(5);assert.equal(t.options.metadataCacheSize,5);assert.equal(t.src().maxParsedMetadata,5);t.setMetadataCacheSize(7);assert.equal(t.source.maxParsedMetadata,7);assert.throws(()=>t.setMetadataCacheSize(0),TileError);
});
test('2D layer combinations: measured rule, canonical order and resolution',()=>{
 const c=new Tiles2D();for(const bad of [['s','y'],['y','h','m'],['h','m','p'],['m','p','r'],['y','h','r'],['m','h','r','traffic','transit','bike']])assert.throws(()=>c.setLayers(bad),{code:'layer_conflict'});
 for(const ok of [['s','m'],['s','p'],['m','s'],['y','t'],['m','p','t'],['s','h','r','traffic','transit','bike'],['s','t','h','r','traffic','transit','bike'],['m','traffic','transit','bike']])c.setLayers(ok);
 c.setLayers(['traffic','m','s']);assert.equal(q(c.tileUrl(1,0,0)).lyrs,'s,m,traffic');
 assert.deepEqual(resolveLayers(['s','y'],'y'),['y']);assert.deepEqual(resolveLayers(['h','m','p','r'],'r'),['p','r']);assert.deepEqual(resolveLayers(['s','y','h','m','p','r','t','traffic','transit','bike'],'bike'),['s','p','t','r','traffic','transit','bike']);
 for(let m=1;m<1024;m++){const sel=GOOGLE_LAYER_ORDER.filter((_,i)=>m&1<<i);assert.equal(layerConflicts(resolveLayers(sel,sel[0])).length,0);}
 assert.throws(()=>c.setCredentials('include'),{code:'cors_rejected'});c.setCredentials('same-origin');
});

// Geocoder: online providers, parsed into one result shape.
import {Geocoder,zoomForBounds} from '../src/tiles.js';
const fakeFetch=(body,seen)=>async(url)=>{seen?.push(url);return {ok:true,status:200,json:async()=>body};};
test('geocoder photon request and parse',async()=>{const seen=[];const g=new Geocoder({fetch:fakeFetch({features:[{geometry:{coordinates:[30.2219,51.2763]},properties:{name:'Chernobyl',state:'Kyiv Oblast',country:'Ukraine',osm_value:'town',extent:[30.17,51.30,30.27,51.25]}}]},seen)});
 const r=await g.search('chernobyl',{purpose:'suggest'});assert.match(seen[0],/photon\.komoot\.io\/api\/\?q=chernobyl&limit=24&lang=en/);assert.equal(g.providerFor('best'),'nominatim');assert.equal(r[0].name,'Chernobyl');assert.equal(r[0].context,'Kyiv Oblast, Ukraine');assert.deepEqual(r[0].bounds,[51.25,30.17,51.30,30.27]);assert.ok(r[0].zoom>=11&&r[0].zoom<=15);});
test('geocoder nominatim and google parse',async()=>{const n=await new Geocoder({provider:'nominatim',language:'it',fetch:fakeFetch([{name:'Roma',lat:'41.9',lon:'12.5',display_name:'Roma, Lazio, Italia',boundingbox:['41.6','42.1','12.2','12.9']}])}).search('roma');
 assert.equal(n[0].context,'Lazio, Italia');assert.equal(n[0].latitude,41.9);
 const seen=[],gg=await new Geocoder({provider:'google',apiKey:'k',fetch:fakeFetch({status:'OK',results:[{formatted_address:'Eiffel Tower, Paris, France',address_components:[{long_name:'Eiffel Tower'}],geometry:{location:{lat:48.858,lng:2.294},viewport:{southwest:{lat:48.857,lng:2.293},northeast:{lat:48.859,lng:2.296}}}}]},seen)}).search('eiffel');
 assert.match(seen[0],/address=eiffel&language=en&key=k/);assert.equal(gg[0].name,'Eiffel Tower');assert.ok(gg[0].zoom>=16);
 await assert.rejects(new Geocoder({provider:'google'}).search('x'),e=>e.code==='missing_api_key');
 await assert.rejects(new Geocoder({provider:'google',apiKey:'k',fetch:fakeFetch({status:'REQUEST_DENIED',error_message:'bad key'})}).search('x'),e=>e.code==='geocode_failed');
 assert.throws(()=>new Geocoder({provider:'bing'}),e=>e.code==='invalid_option');assert.deepEqual(await new Geocoder().search('  '),[]);
 const ranked=await new Geocoder({provider:'photon',fetch:fakeFetch({features:[['Chernobyl','highway','path'],['Chernobyl','highway','path'],['Chornobyl','place','town']].map(([name,k,v])=>({geometry:{coordinates:[1,2]},properties:{name,osm_key:k,osm_value:v,country:'X'}}))})}).search('c');
 assert.deepEqual(ranked.map(r=>r.name),['Chornobyl','Chernobyl']);assert.equal(zoomForBounds(null,9),9);});

test('Tiles3D distance falloff options',()=>{
 const t=new Tiles3D().set({fullDetailRadiusMeters:150,pixelAngleRadians:0.0013});
 assert.equal(t.getOptions().tiles.fullDetailRadiusMeters,150);assert.equal(t.getOptions().tiles.pixelAngleRadians,0.0013);
 t.setFullDetailRadius(null).setPixelAngle(null);assert.equal(t.getOptions().tiles.fullDetailRadiusMeters,null);
 assert.throws(()=>t.setFullDetailRadius(-1),e=>e instanceof TileError);assert.throws(()=>t.setPixelAngle(0),e=>e instanceof TileError);
});
