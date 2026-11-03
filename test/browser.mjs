import {chromium} from 'playwright-core';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));mkdirSync(root+'/test-results',{recursive:true});
const profile=mkdtempSync(root+'/test-results/profile-'),executablePath=process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe';
const report={};let context;const errors=[];
const check=(ok,text)=>{if(!ok)throw Error(text);};
async function open(){context=await chromium.launchPersistentContext(profile,{executablePath,headless:true,viewport:{width:1100,height:760}});const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(pathToFileURL(root+'/test/harness.html').href);await page.evaluate(()=>window.harness.ready);return page;}
try{
 let page=await open();
 report.cold=await page.evaluate(()=>window.harness.query(41.88931,12.49223,12));check(report.cold.complete,'Cold live coverage incomplete: '+JSON.stringify(report.cold));
 check(report.cold.requiredLeaves>0,'No live terminal tiles');
 report.data=await page.evaluate(()=>{const s=window.harness.engine,tile=[...s.assets.values()][0];return {exports:Object.keys(EarthHQ),canvases:document.querySelectorAll('canvas').length,hasThree:'THREE' in EarthHQ,workers:s.source.decoder.workers.length,meshCount:tile.meshes.length,positions:tile.meshes[0].positions.length,indices:tile.meshes[0].indices.length,textureBytes:tile.meshes[0].texture.bytes.byteLength,matrix:tile.matrixGlobeFromMesh.length};});check(!report.data.hasThree&&!report.data.canvases&&report.data.workers>0&&report.data.indices>0&&report.data.textureBytes>0,'API did not return raw data independently of a renderer');
 await page.evaluate(()=>window.harness.engine.dispose());await context.close();context=null;
 page=await open();report.warm=await page.evaluate(()=>window.harness.query(41.88931,12.49223,12));check(report.warm.complete,'Warm coverage incomplete');check(report.warm.diskHits>0,'IndexedDB was not reused after browser restart');check(report.warm.receivedBytes<report.cold.receivedBytes*.1,'Warm browser fetched tile bodies again');
 report.otherCity=await page.evaluate(()=>window.harness.query(45.4642,9.19,6));check(report.otherCity.complete&&report.otherCity.requiredLeaves>0,'Global navigation did not reach another city');
 await page.evaluate(()=>{
  const target=EarthHQ.geoToECEF(41.88931,12.49223),normal=target.clone().normalize();
  window.apiSatellite=new EarthHQ.SatelliteTileEngine({radius:6371010,maxZoom:22});
  window.apiSatellite.update({position:target.clone().addScaledVector(normal,10).toArray(),direction:normal.clone().multiplyScalar(-1).toArray(),up:[0,0,1],fovYDegrees:52,viewportWidth:1024,viewportHeight:1024});
 });
 await page.waitForFunction(()=>!window.apiSatellite.active.size&&!window.apiSatellite.queue.length,{},{timeout:60000});
 report.satellite=await page.evaluate(async()=>{const s=window.apiSatellite,records=[...s.resident.values()],finest=records.sort((a,b)=>b.node.z-a.node.z)[0],image=await createImageBitmap(finest.blob),result={...s.status(),finestZoom:finest.node.z,bytes:finest.data.byteLength,mimeType:finest.mimeType,width:image.width,height:image.height,canvases:document.querySelectorAll('canvas').length};image.close();await s.dispose();return result;});
 check(report.satellite.finestZoom===22&&report.satellite.bytes>0&&report.satellite.width===256&&report.satellite.height===256&&report.satellite.canvases===0,'Raw maximum-zoom satellite API failed');
 const disposed=await page.evaluate(async()=>{const h=window.harness;await h.engine.dispose();return {tiles:h.engine.assets.size,status:h.engine.getCoverage().status};});check(disposed.tiles===0&&disposed.status==='disposed','Dispose retained tiles');
 check(errors.length===0,'Browser errors: '+errors.join('; '));report.ok=true;report.errors=errors;
}catch(error){report.ok=false;report.error=error.message;report.errors=errors;process.exitCode=1;}finally{await context?.close();writeFileSync(root+'/test-results/browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
