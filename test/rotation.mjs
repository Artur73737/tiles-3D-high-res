import {chromium} from 'playwright-core';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
mkdirSync(root+'/test-results',{recursive:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),report={created:new Date().toISOString(),radiusMeters:300},errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(()=>{const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(()=>setTimeout(()=>cb(performance.now()),90));});
const watchdog=setTimeout(()=>browser.close(),90000),check=(ok,message)=>{if(!ok)throw Error(message);};
try{
 await page.goto(pathToFileURL(root+'/globo-hq.html').href+'?view=3d&visibility=300#qa');
 await page.waitForFunction(()=>{const q=window.__earthDemo;return q?.state().mode==='player'&&q.streamer.committedSpec?.radius===300&&!q.streamer.discovering&&q.streamer.getCoverage().complete;},{},{timeout:45000});
 report.before=await page.evaluate(()=>{const q=window.__earthDemo,s=q.streamer;window.__rotationAssets=new Map(s.assets);return {coverage:s.getCoverage(),direction:s.lastSpec.viewDirection.toArray()};});
 await page.screenshot({path:root+'/test-results/ui-ground.png'});
 await page.evaluate(()=>window.__earthDemo.look(Math.PI));
 await page.waitForFunction(old=>{const s=window.__earthDemo.streamer,d=s.committedSpec?.viewDirection;return !s.discovering&&s.committedSpec?.radius===300&&d&&d.dot(new window.__earthDemo.THREE.Vector3(...old))<-.9;},report.before.direction,{timeout:35000});
 report.turned=await page.evaluate(()=>{const s=window.__earthDemo.streamer;let retained=0;for(const [key,asset]of window.__rotationAssets)if(s.assets.get(key)===asset&&!asset.disposed&&asset.group.parent===s.group)retained++;return {previous:window.__rotationAssets.size,retained,coverage:s.getCoverage()};});
 check(report.turned.retained===report.turned.previous,'Turning discarded already loaded HQ tiles');
 await page.screenshot({path:root+'/test-results/ui-turned.png'});
 await page.evaluate(()=>window.__earthDemo.look(0));
 await page.waitForFunction(old=>{const s=window.__earthDemo.streamer,d=s.committedSpec?.viewDirection;return !s.discovering&&s.committedSpec?.radius===300&&d&&d.dot(new window.__earthDemo.THREE.Vector3(...old))>.9;},report.before.direction,{timeout:25000});
 report.returned=await page.evaluate(()=>{const s=window.__earthDemo.streamer;return {retained:[...window.__rotationAssets].filter(([key,asset])=>s.assets.get(key)===asset&&!asset.disposed).length,coverage:s.getCoverage()};});
 check(report.returned.retained===report.turned.previous,'Returning to the original direction lost resident detail');check(!errors.length,'Page errors: '+errors.join('; '));report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{clearTimeout(watchdog);await browser.close();report.errors=errors;writeFileSync(root+'/test-results/rotation.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
