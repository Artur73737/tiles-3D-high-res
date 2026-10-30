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
 await page.screenshot({path:root+'/test-results/live-rome.png'});
 await page.evaluate(()=>window.harness.engine.dispose());await context.close();context=null;
 page=await open();report.warm=await page.evaluate(()=>window.harness.query(41.88931,12.49223,12));check(report.warm.complete,'Warm coverage incomplete');check(report.warm.diskHits>0,'IndexedDB was not reused after browser restart');check(report.warm.receivedBytes<report.cold.receivedBytes*.1,'Warm browser fetched tile bodies again');
 report.otherCity=await page.evaluate(()=>window.harness.query(45.4642,9.19,6));check(report.otherCity.complete&&report.otherCity.requiredLeaves>0,'Global navigation did not reach another city');
 const disposed=await page.evaluate(async()=>{const h=window.harness;await h.engine.dispose();h.renderer.render(h.scene,h.camera);return {tiles:h.engine.group.children.length,status:h.engine.getCoverage().status};});check(disposed.tiles===0&&disposed.status==='disposed','Dispose left owned meshes');
 check(errors.length===0,'Browser errors: '+errors.join('; '));report.ok=true;report.errors=errors;
}catch(error){report.ok=false;report.error=error.message;report.errors=errors;process.exitCode=1;}finally{await context?.close();writeFileSync(root+'/test-results/browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
