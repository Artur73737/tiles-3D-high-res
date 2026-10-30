import {chromium} from 'playwright-core';
import {writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),start=Date.now(),samples=[];
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
mkdirSync(root+'/test-results',{recursive:true});
const page=await browser.newPage({viewport:{width:800,height:500}}),cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');
await page.addInitScript(()=>{const original=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>original(()=>setTimeout(()=>cb(performance.now()),90));});
const watchdog=setTimeout(()=>browser.close(),30000);
try{
 await page.goto(pathToFileURL(root+'/globo-hq.html').href+'?view=3d#qa');
 for(let i=0;i<8;i++){
  await page.waitForTimeout(1500);const [state,metrics]=await Promise.all([page.evaluate(()=>{const q=window.__earthDemo,s=q.streamer;return {mode:q.state().mode,coverage:s.getCoverage(),queries:s.queryCount,metadata:s.source.bulk.size};}),cdp.send('Performance.getMetrics')]);
  const selected=Object.fromEntries(metrics.metrics.filter(m=>['TaskDuration','JSHeapUsedSize'].includes(m.name)).map(m=>[m.name,m.value]));const sample={seconds:(Date.now()-start)/1000,...state,...selected};samples.push(sample);console.log(JSON.stringify(sample));
 }
}catch(e){console.log('profile bounded stop: '+e.message);}
finally{clearTimeout(watchdog);await browser.close();writeFileSync(root+'/test-results/profile.json',JSON.stringify({renderCadence:'10 fps headless software QA',samples,peakJSHeapBytes:Math.max(0,...samples.map(s=>s.JSHeapUsedSize)),rendererTaskCpuSeconds:samples.at(-1)?.TaskDuration??null,elapsedSeconds:(Date.now()-start)/1000,processFamilyMemory:'not measured',agentTokenCost:'not measured'},null,2));}
