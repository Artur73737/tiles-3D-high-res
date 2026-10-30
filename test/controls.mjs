import {chromium} from 'playwright-core';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));mkdirSync(root+'/test-results',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],report={created:new Date().toISOString(),layouts:[]};
page.on('pageerror',error=>errors.push(error.message));
await page.addInitScript(()=>{const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(()=>setTimeout(()=>cb(performance.now()),90));});
const watchdog=setTimeout(()=>browser.close(),150000),check=(ok,message)=>{if(!ok)throw Error(message);};
try{
 await page.goto(pathToFileURL(root+'/globo-hq.html').href+'#qa');
 await page.waitForFunction(()=>window.__earthDemo?.satellite.status().visible>60,{},{timeout:30000});
 await page.screenshot({path:root+'/test-results/controls-globe.png'});
 check(await page.locator('#lat,#lon').count()===0,'Coordinate inputs remain');
 check(await page.locator('html').getAttribute('lang')==='en','Viewer language is not English');
 await page.locator('#location').fill('Rome Italy');await page.locator('#location').press('Enter');
 await page.locator('#search-options button').first().waitFor({timeout:20000});
 report.search=await page.locator('#search-options button').allTextContents();
 await page.screenshot({path:root+'/test-results/controls-search.png'});
 await page.locator('#location').press('ArrowDown');await page.keyboard.press('Enter');
 const selected=await page.evaluate(()=>{const q=window.__earthDemo;return {mode:q.state().mode,radius:q.camera.position.length(),input:document.getElementById('location').value};});
 check(selected.mode==='globe'&&selected.radius<6471010,'Place selection did not centre and zoom the globe');report.selected=selected;
 await page.waitForFunction(()=>window.__earthDemo.satellite.status().readyZoom>=12,{},{timeout:25000});
 await page.screenshot({path:root+'/test-results/controls-satellite.png'});
 for(const [width,height]of [[1440,900],[960,600],[390,844],[844,390]]){
  await page.setViewportSize({width,height});
  for(const details of [false,true]){
   if(await page.locator('#panel-toggle').getAttribute('aria-expanded')!==String(details))await page.locator('#panel-toggle').click();
   const layout=await page.evaluate(()=>{
    const boxes=['.topbar','.navigation','.bottom'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
    const overlaps=[];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.x<b.right&&a.right>b.x&&a.y<b.bottom&&a.bottom>b.y)overlaps.push([a.selector,b.selector]);}
    return {boxes,overlaps,overflow:document.documentElement.scrollWidth>innerWidth||boxes.some(b=>b.x<0||b.y<0||b.right>innerWidth||b.bottom>innerHeight)};
   });report.layouts.push({width,height,details,...layout});check(!layout.overflow&&!layout.overlaps.length,'UI overlap or overflow at '+width+'x'+height+' details='+details);
  }
 }
 await page.locator('#panel-toggle').click();await page.setViewportSize({width:1440,height:900});
 // Controlled service failures exercise the same file-origin browser UI.
 await page.route('https://photon.komoot.io/api/**',route=>route.fulfill({status:503,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{}'}));
 await page.locator('#location').fill('unavailable');await page.locator('#location').press('Enter');
 await page.waitForFunction(()=>document.getElementById('search-message').textContent.includes('503'));
 await page.locator('#location').press('Escape');check(!await page.locator('#search-results').isVisible(),'Escape did not dismiss results');
 await page.unroute('https://photon.komoot.io/api/**');

 const start=Date.now();await page.locator('#home').click();await page.waitForFunction(()=>window.__earthDemo?.state().mode==='player',{},{timeout:45000});
 report.entrySeconds=(Date.now()-start)/1000;console.log('Flight ready: '+report.entrySeconds+' s');
 await page.mouse.move(720,400);await page.mouse.wheel(0,-120);
 await page.waitForFunction(()=>window.__earthDemo.state().flightMultiplier>1);
 report.increasedSpeed=await page.evaluate(()=>window.__earthDemo.state().flightMultiplier);
 await page.mouse.wheel(0,120);await page.mouse.wheel(0,120);await page.waitForFunction(()=>window.__earthDemo.state().flightMultiplier===1);
 // Watch real prioritized retirement, not full 2 km completion.
 await page.waitForFunction(()=>{const s=window.__earthDemo.streamer;return [...s.previewRetirable].some(key=>s.priority(s.previewWanted.get(key),s.lastSpec)[0]===0&&s.previewRemaining.get(key)===0);},{},{timeout:60000});
 report.gazeRefinedSeconds=(Date.now()-start)/1000;
 report.coverage=await page.evaluate(()=>window.__earthDemo.streamer.getCoverage());
 await page.screenshot({path:root+'/test-results/controls-flight.png'});
 check(!errors.length,errors.join('; '));report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;try{report.state=await page.evaluate(()=>({state:window.__earthDemo?.state(),coverage:window.__earthDemo?.streamer.getCoverage(),search:document.getElementById('search-message').textContent}));await page.screenshot({path:root+'/test-results/controls-failure.png'});}catch{}}
finally{clearTimeout(watchdog);await browser.close();report.errors=errors;writeFileSync(root+'/test-results/controls.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
