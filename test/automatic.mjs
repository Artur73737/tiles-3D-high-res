import {chromium} from 'playwright-core';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));mkdirSync(root+'/test-results',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[],report={created:new Date().toISOString(),qaRenderCadence:'~16 fps cap for headless test only'};
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(()=>setTimeout(()=>cb(performance.now()),50));});
const watchdog=setTimeout(()=>browser.close(),150000),check=(ok,message)=>{if(!ok)throw Error(message);};
const snapshot=()=>page.evaluate(()=>{const q=window.__earthDemo,s=q.streamer,c=s.getCoverage(),depths=[...s.viewCut.values()].map(n=>n.path.length);return {state:q.state(),coverage:c,depths:[...new Set(depths)],maxDepth:Math.max(...depths),terminals:[...s.viewCut.values()].filter(n=>n.leaf).length,workers:s.source.decoder.workers.length,drawCalls:q.renderer.info.render.calls,queue:{active:[...s.active.keys()],remaining:s.tileQueue.length-s.tileCursor,dirty:s.viewQualityDirty,decoder:s.source.decoder.queue.length,workerJobs:s.source.decoder.workers.filter(w=>w.job).length,transport:s.transport.jobs.size,missing:[...s.viewCut.keys()].filter(k=>!s.assets.has(k))}};});
try{
 const start=Date.now();await page.goto(pathToFileURL(root+'/globo-hq.html').href+'?view=3d#qa');
 await page.waitForFunction(()=>window.__earthDemo?.state().mode==='player',{},{timeout:45000});report.entrySeconds=(Date.now()-start)/1000;
 await page.waitForFunction(()=>{const s=window.__earthDemo.streamer;return s.viewCut&&s.getCoverage().complete;},{},{timeout:60000});report.viewSeconds=(Date.now()-start)/1000;report.wide=await snapshot();
 check(report.wide.workers>0&&report.wide.coverage.radiusMeters===2000,'Worker-backed two-kilometre view not active');
 check(report.wide.depths.length>1,'View does not select mixed depths');
 await page.screenshot({path:root+'/test-results/view-wide.png'});
 await page.locator('#settings-toggle').click();await page.locator('#tab-picture').click();await page.screenshot({path:root+'/test-results/view-settings.png'});await page.locator('#settings-close').click();
 const beforeTurn=await page.evaluate(()=>{const q=window.__earthDemo;window.__kept=new Map(q.streamer.assets);const before={size:window.__kept.size,generation:q.streamer.generation,direction:q.streamer.lastSpec.viewDirection.toArray()};q.look(Math.PI,-.18);return before;});
 await page.waitForFunction(before=>{const q=window.__earthDemo,s=q.streamer;return s.generation>before.generation&&s.committedSpec.viewDirection?.dot(new q.THREE.Vector3(...before.direction))<-.9&&!s.discovering&&s.viewCut&&s.getCoverage().complete;},beforeTurn,{timeout:45000});
 report.turned=await snapshot();report.retained=await page.evaluate(()=>[...window.__kept].filter(([key,asset])=>window.__earthDemo.streamer.assets.get(key)===asset&&!asset.disposed).length);check(report.retained===beforeTurn.size,'Turning evicted resident tiles');
 const oldGeneration=await page.evaluate(()=>window.__earthDemo.streamer.generation);
 await page.evaluate(()=>{const q=window.__earthDemo;q.player.place(new q.THREE.Vector3(0,29.3,0));q.player.flying=true;q.look(0,-.18);});
 await page.waitForFunction(old=>{const s=window.__earthDemo.streamer;return s.generation>old&&s.getCoverage().complete;},oldGeneration,{timeout:45000});
 report.ground=await snapshot();check(report.ground.maxDepth>=report.wide.maxDepth&&report.ground.terminals>0,'Low altitude failed to reach terminal geometry');
 await page.screenshot({path:root+'/test-results/view-ground.png'});
 const generation=await page.evaluate(()=>{const q=window.__earthDemo;q.player.place(new q.THREE.Vector3(0,178,0));q.player.flying=true;q.player.flightMultiplier=16;q.look(0,-.18);return q.streamer.generation;});
 await page.waitForFunction(old=>{const s=window.__earthDemo.streamer;return s.generation>old&&s.getCoverage().complete;},generation,{timeout:45000});
 const beforeMove=await page.evaluate(()=>window.__earthDemo.player.feet.toArray());
 await page.mouse.click(640,400);await page.waitForFunction(()=>window.__earthDemo.state().locked);
 await page.keyboard.press('KeyW');await page.keyboard.down('KeyW');await page.waitForTimeout(1500);await page.keyboard.up('KeyW');
 report.fastFlight=await page.evaluate(before=>{const q=window.__earthDemo;document.exitPointerLock();return {metres:q.player.feet.distanceTo(new q.THREE.Vector3(...before)),coverage:q.streamer.getCoverage()};},beforeMove);
 check(report.fastFlight.metres>20,'Fast flight could not advance through the examined view');
 await page.evaluate(()=>window.__earthDemo.streamer.dispose());
 check(await page.evaluate(()=>window.__earthDemo.streamer.source.decoder.workers.length===0),'Decoder workers survived disposal');
 check(!errors.length,'Page errors: '+errors.join('; '));report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;try{report.failure=await snapshot();await page.screenshot({path:root+'/test-results/view-failure.png'});}catch{}}
finally{clearTimeout(watchdog);await browser.close();report.errors=errors;writeFileSync(root+'/test-results/view-streaming.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
