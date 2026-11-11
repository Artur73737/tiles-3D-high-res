// Live real-provider check of dist/3d_tiles.bundle.min.js in Chrome.
import {chromium} from 'playwright-core';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));mkdirSync(root+'/test-results',{recursive:true});mkdirSync(root+'/verification',{recursive:true});
const executablePath=process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile=mkdtempSync(root+'/test-results/tiles-profile-'),errors=[],check=(ok,msg)=>{if(!ok)throw Error(msg);};
const open=async()=>{const context=await chromium.launchPersistentContext(profile,{executablePath,headless:true,args:['--disable-web-security','--use-angle=swiftshader','--enable-unsafe-swiftshader']});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(root+'/test/tiles-harness.html').href);return {context,page};};
const report={};let session;
try{
 session=await open();
 report.cold=await session.page.evaluate(async()=>{
  const {Tiles2D,Tiles3D}=window.Tiles,lat=41.89021,lon=12.49223,out={};
  // 3D maximum resolution, persistent cache, all output modes.
  const t=new Tiles3D({cache:{mode:'persistent'},timeoutMs:20000,retries:[2,200]}).setLocation(lat,lon).setRadius(30);
  const list=await t.listTiles();out.leaves=list.count;out.allLeaves=list.tiles.every(x=>x.leaf);out.bestMetersPerTexel=Math.min(...list.tiles.map(x=>x.metersPerTexel));
  const all=await t.getTiles({},{concurrency:8});out.complete=all.complete;out.downloaded=all.tiles.length;out.attribution=all.attribution;
  const first=all.tiles[0];const jpegMesh=all.tiles.flatMap(x=>x.meshes).find(m=>m.texture?.format==='jpeg');
  const rgba=await t.getTile(first,{textureOutput:'rgba',coordinates:'local'});const tx=rgba.meshes[0].texture;out.rgba=tx.format==='rgba'&&tx.data.length===tx.width*tx.height*4;out.localNear=Math.abs(rgba.meshes[0].positions[2])<200;
  out.formats=[...new Set(all.tiles.flatMap(x=>x.meshes.map(m=>m.texture?.format)))];out.jpegSeen=!!jpegMesh;
  const group=await t.toThree(first);out.threeChildren=group.children.length;group.userData.dispose();
  const coarse=await t.listTiles({targetMetersPerTexel:1,radiusMeters:200});out.coarseDepthMax=Math.max(...coarse.tiles.map(x=>x.depth));out.fineDepth=Math.max(...list.tiles.map(x=>x.depth));
  const sector=await t.listTiles({headingDegrees:90,fieldOfViewDegrees:40,nearRadiusMeters:5});out.sectorSmaller=sector.count<list.count;
  const j=await new Tiles2D().getTile(19,280337,194839);const jt=await t.texture({textureFormat:1,bytes:j.bytes,width:256,height:256},'rgba','jpeg');out.jpegRgba=jt.format==='rgba'&&jt.data.length===256*256*4;
  out.stats3d=t.getStats();await t.dispose();
  // 2D satellite: every provider, max zoom detection, stitched image.
  for(const layer of Object.keys(window.Tiles.GOOGLE_LAYERS)){const c=new Tiles2D({layers:[layer],cache:'persistent',retries:[1,200]});const tile=await c.getTileAt(lat,lon,17);out['layer_'+layer]={mime:tile.mimeType,bytes:tile.bytes.length};await c.dispose();}
  {const c=new Tiles2D({cache:'persistent'});const z=await c.findMaxZoom(lat,lon);out.google={maxZoom:z.z,mime:z.tile?.mimeType,bytes:z.tile?.bytes.length};await c.dispose();}
  {const base=new Tiles2D({layers:['m']}),styled=new Tiles2D({layers:['m'],style:'s.e:l|p.v:off'}),ru=new Tiles2D({layers:['m'],region:'ru'}),us=new Tiles2D({layers:['m'],region:'us'}),it=new Tiles2D({layers:['y'],language:'it'}),ja=new Tiles2D({layers:['y'],language:'ja'}),s4=new Tiles2D({scale:4});const same=(a,b)=>a.bytes.length===b.bytes.length&&a.bytes.every((v,i)=>v===b.bytes[i]);
   out.styleWorks=!same(await base.getTile(13,4380,3045),await styled.getTile(13,4380,3045));out.regionWorks=!same(await ru.getTile(6,37,22),await us.getTile(6,37,22));out.languageWorks=!same(await it.getTile(19,280337,194839),await ja.getTile(19,280337,194839));const big=await s4.getTile(19,280337,194839);const bm=await createImageBitmap(new Blob([big.bytes]));out.scale4px=bm.width;bm.close();for(const c of [base,styled,ru,us,it,ja,s4])await c.dispose();}
  const g=new Tiles2D().setScale(2);const img=await g.getImage({west:12.4915,south:41.8897,east:12.4930,north:41.8907},19);out.image={w:img.width,h:img.height,complete:img.complete,tileSize:g.tileSize};
  const blob=await img.blob({type:'image/png'});out.imageBytes=blob.size;await g.dispose();
  const o=new Tiles2D({overzoom:true}).setZoomRange(0,19);const oz=await o.getImage({west:12.4920,south:41.8900,east:12.4924,north:41.8903},21);out.overzoom={w:oz.width,complete:oz.complete};await o.dispose();
  return out;
 });
 await session.context.close();
 // Warm run: persistent IndexedDB cache must serve the same 3D region without network.
 session=await open();
 report.warm=await session.page.evaluate(async()=>{const t=new window.Tiles.Tiles3D({cache:'persistent'}).setLocation(41.89021,12.49223).setRadius(30);const r=await t.getTiles();const s=t.getStats();await t.dispose();return {complete:r.complete,tiles:r.tiles.length,network:s.networkRequests,diskHits:s.diskHits};});
 await session.context.close();session=null;
 const c=report.cold,w=report.warm;
 check(c.leaves>0&&c.allLeaves&&c.complete&&c.downloaded===c.leaves,'3D region incomplete');check(c.bestMetersPerTexel<0.1,'not max resolution');check(c.jpegRgba,'jpeg rgba');check(c.rgba&&c.localNear&&c.threeChildren>0,'3D outputs');
 check(c.coarseDepthMax<c.fineDepth,'targetMetersPerTexel ignored');check(c.sectorSmaller,'heading/FOV ignored');
 check(c.google.maxZoom>=20&&/image/.test(c.google.mime),'google max zoom');for(const l of ['s','y','h','m','p','t','r'])check(c['layer_'+l].bytes>0&&/image/.test(c['layer_'+l].mime),'layer '+l);check(c.styleWorks&&c.regionWorks&&c.languageWorks&&c.scale4px===1024,'google params');
 check(c.image.complete&&c.image.w>=1024&&c.image.tileSize===512,'2D mosaic');check(c.overzoom.complete,'overzoom');
 check(w.complete&&w.tiles===c.leaves&&w.diskHits>0&&w.network<=2,'warm cache: '+JSON.stringify(w));
 check(!errors.length,'page errors: '+errors.join('; '));
 report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{await session?.context.close();report.at=new Date().toISOString();report.pageErrors=errors;writeFileSync(root+'/verification/tiles-browser.json',JSON.stringify(report,null,1));console.log(JSON.stringify(report,null,1));}
