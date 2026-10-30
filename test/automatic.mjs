import {chromium} from 'playwright-core';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
mkdirSync(root+'/test-results',{recursive:true});
const page=await browser.newPage({viewport:{width:960,height:600}}),errors=[],report={qaRenderCadence:'10 fps cap for headless software rendering'};
await page.addInitScript(()=>{const original=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=callback=>original(()=>setTimeout(()=>callback(performance.now()),90));});
const watchdog=setTimeout(()=>browser.close(),90000);
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const check=(ok,text)=>{if(!ok)throw Error(text);};
try{
 const started=Date.now();await page.goto(pathToFileURL(root+'/globo-hq.html').href+'?view=3d#qa');
 await page.waitForFunction(()=>window.__earthDemo?.state().mode==='player',{},{timeout:40000});report.automaticGroundSeconds=(Date.now()-started)/1000;console.log('automatic ground ready in '+report.automaticGroundSeconds+' s');
 check(await page.locator('#go,#enter,#resume,#overlay').count()===0,'Manual rendering gate remains');
 await page.waitForFunction(()=>{const s=window.__earthDemo.streamer;return [...s.previews.values()].some(a=>a.descriptor.center.distanceTo(s.lastSpec.focus)>1500);},{},{timeout:40000});report.distantPreviewSeconds=(Date.now()-started)/1000;
 await page.waitForFunction(()=>{const q=window.__earthDemo;return q.streamer.committedSpec?.radius===2000&&q.streamer.assets.size>500;},{},{timeout:60000});console.log('long-range metadata committed');
 // Observe actual progressive network rendering, without requiring every remote
 // tile to download as a prerequisite for a useful local scene.
 await page.waitForFunction(()=>{const q=window.__earthDemo,s=q.streamer;return [...s.assets.values()].some(a=>a.descriptor.center.distanceTo(s.committedSpec.focus)>120);},{},{timeout:40000});
 report.before=await page.evaluate(()=>{const q=window.__earthDemo,s=q.streamer;let maxResidentDistance=0,farthestRequired=0;for(const a of s.assets.values())maxResidentDistance=Math.max(maxResidentDistance,a.descriptor.center.distanceTo(s.committedSpec.focus));for(const n of s.wanted.values())farthestRequired=Math.max(farthestRequired,n.center.distanceTo(s.committedSpec.focus));return {state:q.state(),fog:q.scene.fog,coverage:s.getCoverage(),maxResidentDistance,farthestRequired};});
 check(report.before.state.visibility===2000&&report.before.fog===null,'Long visibility / fog configuration wrong');check(report.before.farthestRequired>1900,'Demand did not reach long-range terminal tiles');
 await page.evaluate(()=>{const q=window.__earthDemo;q.player.place(new q.THREE.Vector3(0,110,0));q.player.flying=true;q.look(0,-.25);});await page.waitForTimeout(700);await page.screenshot({path:root+'/test-results/automatic-wide.png'});
 const direction=await page.evaluate(()=>window.__earthDemo.streamer.lastSpec.viewDirection.toArray());
 await page.evaluate(()=>window.__earthDemo.look(Math.PI,-.25));await page.waitForFunction(old=>{const v=window.__earthDemo.streamer.lastSpec.viewDirection;return v&&v.x*old[0]+v.y*old[1]+v.z*old[2]<-.9;},direction);
 report.rotationFollowed=true;
 const oldFocus=await page.evaluate(()=>window.__earthDemo.streamer.lastSpec.focus.toArray());
 await page.evaluate(()=>{const q=window.__earthDemo;q.player.place(new q.THREE.Vector3(45,110,0));q.player.flying=true;});await page.waitForFunction(old=>window.__earthDemo.streamer.lastSpec.focus.distanceTo(new window.__earthDemo.THREE.Vector3(...old))>30,oldFocus);report.positionFollowed=true;
 report.errors=errors;check(!errors.length,'Browser errors: '+errors.join('; '));report.ok=true;report.elapsedSeconds=(Date.now()-started)/1000;
}catch(e){report.ok=false;report.error=e.message;report.errors=errors;process.exitCode=1;}
finally{clearTimeout(watchdog);await browser.close();writeFileSync(root+'/test-results/automatic.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
