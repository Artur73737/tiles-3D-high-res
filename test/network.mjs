import {chromium} from 'playwright-core';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));mkdirSync(root+'/test-results',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report={created:new Date().toISOString(),scenarios:[]},check=(ok,message)=>{if(!ok)throw Error(message);};
const watchdog=setTimeout(()=>browser.close(),120000);
try{
 for(const scenario of ['metadata-once','payload-once','metadata-offline','startup-offline']){
  const context=await browser.newContext({viewport:{width:1100,height:750}}),page=await context.newPage(),errors=[];
  let failures=0,blocked=true;
  const pattern=scenario==='startup-offline'?'**/PlanetoidMetadata':scenario==='payload-once'?'**/NodeData/**':'**/BulkMetadata/**';
  page.on('pageerror',error=>errors.push(error.message));
  await page.route(pattern,async route=>{if(blocked&&(!scenario.endsWith('once')||failures===0)){failures++;await route.abort('failed');}else await route.continue();});
  await page.goto(pathToFileURL(root+'/globo-hq.html').href+'?visibility=500#qa');
  if(scenario==='startup-offline'){
   await page.waitForFunction(()=>window.__earthDemo?.state().error,{},{timeout:15000});blocked=false;
  }else await page.waitForFunction(()=>window.__earthDemo?.streamer.planet);
  await page.locator('#terrain').click();
  if(scenario==='metadata-offline'){
   await page.waitForFunction(()=>{const s=window.__earthDemo.state();return s.mode==='globe'&&s.error;},{},{timeout:15000});
   check(failures===3,'Persistent failure did not stop after three attempts');
   check(await page.locator('#error').isVisible(),'Persistent failure was hidden');
   blocked=false;await page.locator('#terrain').click();
  }
  await page.waitForFunction(()=>window.__earthDemo.state().mode==='player',{},{timeout:45000});
  await page.waitForFunction(()=>window.__earthDemo.streamer.getCoverage().complete,{},{timeout:45000});
  const coverage=await page.evaluate(()=>window.__earthDemo.streamer.getCoverage());
  check(coverage.requiredLeaves>0&&coverage.failedLeaves===0,'Recovery did not complete real tile demand');
  const state=await page.evaluate(()=>window.__earthDemo.state());
  check(state.player.flying&&!state.error,'Recovery did not enter flight cleanly');
  check(!await page.locator('#error').isVisible(),'Stale error remains after recovery');
  check(!errors.length,'Page errors: '+errors.join('; '));
  report.scenarios.push({scenario,injectedFailures:failures,state,coverage,ok:true});await context.close();
 }
 report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{clearTimeout(watchdog);await browser.close();writeFileSync(root+'/test-results/network.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
