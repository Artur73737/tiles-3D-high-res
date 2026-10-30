import {chromium} from 'playwright-core';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));mkdirSync(root+'/test-results',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],report={created:new Date().toISOString()};
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(()=>setTimeout(()=>cb(performance.now()),90));});
const watchdog=setTimeout(()=>browser.close(),90000),check=(ok,message)=>{if(!ok)throw Error(message);};
try{
 for(const name of ['earth-hq.bundle.js','earth-hq.esm.js'])check(readFileSync(root+'/dist/'+name,'utf8').includes('mt1.google.com/vt'),'Satellite imagery missing from '+name);
 await page.goto(pathToFileURL(root+'/globo-hq.html').href+'?view=globe&visibility=300#qa');
 await page.waitForFunction(()=>{const s=window.__earthDemo?.satellite.status();return s&&s.visible>=10&&s.pending===0&&s.queued===0;},{},{timeout:30000});
 report.orbit=await page.evaluate(()=>({satellite:window.__earthDemo.satellite.status(),coverage:window.__earthDemo.streamer.getCoverage()}));
 await page.screenshot({path:root+'/test-results/ui-globe.png'});
 await page.evaluate(()=>{const q=window.__earthDemo;q.camera.position.normalize().multiplyScalar(q.streamer.planet.radius+5000);q.controls.update();});
 await page.waitForFunction(()=>{const s=window.__earthDemo.satellite.status();return s.readyZoom>=15&&s.pending===0&&s.queued===0;},{},{timeout:45000});
 report.zoomed=await page.evaluate(()=>({satellite:window.__earthDemo.satellite.status(),coverage:window.__earthDemo.streamer.getCoverage()}));
 check(report.zoomed.satellite.readyZoom>report.orbit.satellite.readyZoom+5,'Zoom did not request more detailed satellite tiles');
 check(report.zoomed.coverage.requiredLeaves===0,'2D imagery is coupled to the 3D engine');
 await page.screenshot({path:root+'/test-results/ui-satellite-close.png'});
 await page.getByRole('button',{name:'Controls',exact:true}).click();check(await page.locator('dialog').isVisible(),'Help dialog did not open');await page.getByRole('button',{name:'Got it'}).click();
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);await page.screenshot({path:root+'/test-results/ui-mobile.png'});
 check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Mobile layout overflows horizontally');
 check((await page.getByRole('button').allTextContents()).every(s=>!/scarica|download/i.test(s)),'Download button present');
 await page.setViewportSize({width:1440,height:900});await page.locator('#terrain').click();
 await page.waitForFunction(()=>window.__earthDemo?.state().mode==='player',{},{timeout:45000});
 check(await page.evaluate(()=>window.__earthDemo.player.flying),'3D mode did not enter flight');
 report.flight=await page.evaluate(()=>window.__earthDemo.state());
 check(!errors.length,'Page errors: '+errors.join('; '));report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;try{report.state=await page.evaluate(()=>({satellite:window.__earthDemo?.satellite.status(),coverage:window.__earthDemo?.streamer.getCoverage()}));await page.screenshot({path:root+'/test-results/ui-failure.png'});}catch{}}
finally{clearTimeout(watchdog);await browser.close();report.errors=errors;writeFileSync(root+'/test-results/viewer.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
