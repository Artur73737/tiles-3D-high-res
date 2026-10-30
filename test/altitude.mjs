import {chromium} from 'playwright-core';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
mkdirSync(root+'/test-results',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:960,height:600}}),errors=[],report={created:new Date().toISOString(),qaRenderCadence:'10 fps cap for headless software rendering'};
const check=(ok,message)=>{if(!ok)throw Error(message);};
const watchdog=setTimeout(()=>browser.close(),90000);
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>raf(()=>setTimeout(()=>callback(performance.now()),90));});
try{
 await page.goto(pathToFileURL(root+'/globo-hq.html').href+'?view=3d&visibility=50#qa');
 await page.waitForFunction(()=>window.__earthDemo?.state().mode==='player',{},{timeout:45000});
 await page.evaluate(()=>window.__earthDemo.streamer.waitForIdle(30000));
 report.initial=await page.evaluate(()=>window.__earthDemo.streamer.getCoverage());
 check(report.initial.complete&&report.initial.readyLeaves>0,'Initial low-altitude automatic loading failed');
 check(await page.getByRole('button').allTextContents().then(labels=>labels.every(label=>!/scarica|download/i.test(label))),'Unexpected manual download control');
 await page.getByRole('button',{name:'Globo',exact:true}).click();
 await page.waitForFunction(()=>window.__earthDemo.streamer.getCoverage().status==='paused');
 await page.evaluate(()=>window.__earthDemo.streamer.waitForIdle(30000));
 report.orbit=await page.evaluate(()=>window.__earthDemo.streamer.getCoverage());
 await page.waitForTimeout(1000);
 check(await page.evaluate(()=>window.__earthDemo.streamer.getCoverage().networkRequests)===report.orbit.networkRequests,'Orbit keeps downloading');
 await page.locator('#terrain').click();
 await page.waitForFunction(()=>window.__earthDemo.state().mode==='player');
 check(await page.evaluate(()=>window.__earthDemo.player.flying),'3D entry is not flight');
 // Move the flying player; the real animation loop owns the altitude gate.
 // No direct engine update or region request is made by this test.
 await page.evaluate(()=>{const q=window.__earthDemo;q.player.place(new q.THREE.Vector3(350,3400,0));});
 await page.waitForFunction(()=>{const h=window.__earthDemo.streamer.getCoverage().cameraAltitudeMeters;return h>3300&&h<3500;});
 await page.evaluate(()=>{const q=window.__earthDemo;q.player.place(new q.THREE.Vector3(350,2400,0));});
 await page.waitForFunction(()=>window.__earthDemo.streamer.getCoverage().status!=='waiting-altitude',{},{timeout:10000});
 await page.waitForFunction(()=>window.__earthDemo.streamer.getCoverage().complete,{},{timeout:30000});
 report.descended=await page.evaluate(()=>window.__earthDemo.streamer.getCoverage());
 check(report.descended.cameraAltitudeMeters<2500,'Flight never reached low altitude');
 check(report.descended.readyLeaves>0&&report.descended.networkRequests>report.orbit.networkRequests,'New area did not load automatically');
 await page.screenshot({path:root+'/test-results/altitude-low.png'});
 await page.evaluate(()=>{const q=window.__earthDemo;q.player.place(new q.THREE.Vector3(350,3400,0));});
 await page.waitForFunction(()=>window.__earthDemo.streamer.getCoverage().status==='waiting-altitude',{},{timeout:10000});
 await page.evaluate(()=>window.__earthDemo.streamer.waitForIdle(30000));
 report.ascended=await page.evaluate(()=>window.__earthDemo.streamer.getCoverage());
 await page.waitForTimeout(1000);check(await page.evaluate(()=>window.__earthDemo.streamer.getCoverage().networkRequests)===report.ascended.networkRequests,'Ascent failed to pause downloads');
 await page.evaluate(()=>{const q=window.__earthDemo;q.player.place(new q.THREE.Vector3(350,2400,0));});
 await page.waitForFunction(()=>window.__earthDemo.streamer.getCoverage().complete,{},{timeout:30000});
 report.resumed=await page.evaluate(()=>window.__earthDemo.streamer.getCoverage());
 check(report.resumed.readyLeaves>0,'Descent did not resume');
 check(!errors.length,'Browser errors: '+errors.join('; '));report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{clearTimeout(watchdog);await browser.close();report.errors=errors;writeFileSync(root+'/test-results/altitude.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
