import {chromium} from 'playwright-core';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),label=process.argv[2]??'current';
const html=process.argv[3]??root+'/globo-hq.html',radiusMeters=Number(process.argv[4]??50),observeSeconds=Number(process.argv[5]??0),cameraAltitude=Number(process.argv[6]??0);
if(!Number.isFinite(radiusMeters)||radiusMeters<=0||!Number.isFinite(observeSeconds)||observeSeconds<0||observeSeconds>30)throw Error('Invalid benchmark radius or observation interval');
const execute=promisify(execFile),report={label,htmlSha256:createHash('sha256').update(readFileSync(html)).digest('hex'),created:new Date().toISOString(),radiusMeters,observeSeconds,renderCadence:'10 fps headless',agentTokens:'not measured',runs:[]};
mkdirSync(root+'/test-results',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.newContext({viewport:{width:960,height:600}}),browserCdp=await browser.newBrowserCDPSession();
const page=await context.newPage();await page.addInitScript(()=>{const raf=requestAnimationFrame.bind(window);window.requestAnimationFrame=cb=>raf(()=>setTimeout(()=>cb(performance.now()),90));});
const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const watchdog=setTimeout(()=>browser.close(),150000);
async function sample(){
 const {processInfo}=await browserCdp.send('SystemInfo.getProcessInfo');
 const ids=processInfo.map(p=>p.id).filter(Number.isSafeInteger);
 const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$p=Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue; [pscustomobject]@{workingSet=($p|Measure-Object WorkingSet64 -Sum).Sum;privateBytes=($p|Measure-Object PrivateMemorySize64 -Sum).Sum}|ConvertTo-Json -Compress`],{windowsHide:true});
 return {...JSON.parse(stdout),cpuSeconds:processInfo.reduce((n,p)=>n+p.cpuTime,0)};
}
try{
 for(const temperature of ['cold','warm']){
  const before=await sample(),start=performance.now();if(temperature==='warm')await page.reload();else await page.goto(pathToFileURL(html).href+'?view=3d&visibility='+radiusMeters+'#qa');
  let peak=before,finished=false,sampleError=null;
  const sampling=(async()=>{while(!finished){await new Promise(r=>setTimeout(r,1200));if(finished)break;try{const s=await sample();peak={workingSet:Math.max(peak.workingSet,s.workingSet),privateBytes:Math.max(peak.privateBytes,s.privateBytes)};}catch(e){sampleError=e.message;}}})();
  try{
   await page.waitForFunction(()=>window.__earthDemo?.state().mode==='player',{},{timeout:60000});
   const entrySeconds=(performance.now()-start)/1000;
   if(cameraAltitude)await page.evaluate(height=>{const q=window.__earthDemo;q.player.place(new q.THREE.Vector3(0,height-1.63,0));q.player.flying=true;q.look(0,-.18);},cameraAltitude);
   if(observeSeconds)await page.waitForTimeout(observeSeconds*1000);else await page.evaluate(()=>window.__earthDemo.streamer.waitForIdle(60000));
   const observationSeconds=(performance.now()-start)/1000,completeSeconds=observeSeconds?null:observationSeconds;
   const result=await page.evaluate(()=>{const q=window.__earthDemo;return {coverage:q.streamer.getCoverage(),camera:q.camera.position.toArray(),keys:[...q.streamer.wanted.keys()].sort(),drawCalls:q.renderer.info.render.calls};});
   if((!observeSeconds&&!result.coverage.complete)||!result.coverage.readyLeaves)throw Error('Incomplete representative task');
   const after=await sample(),metrics=await cdp.send('Performance.getMetrics');
   report.runs.push({temperature,entrySeconds,cameraAltitude,camera:result.camera,completeSeconds,observationSeconds,coverage:result.coverage,demandKeysSha256:createHash('sha256').update(result.keys.join('\n')).digest('hex'),drawCalls:result.drawCalls,cpuSeconds:after.cpuSeconds-before.cpuSeconds,peakSampledWorkingSet:Math.max(peak.workingSet,after.workingSet),peakSampledPrivateBytes:Math.max(peak.privateBytes,after.privateBytes),sampleError,rendererMetrics:Object.fromEntries(metrics.metrics.filter(m=>['TaskDuration','JSHeapUsedSize'].includes(m.name)).map(m=>[m.name,m.value]))});
   console.log(JSON.stringify(report.runs.at(-1)));
  }finally{finished=true;await sampling;}
 }
 report.ok=!errors.length;report.errors=errors;
}catch(e){report.ok=false;report.error=e.message;process.exitCode=1;}
finally{clearTimeout(watchdog);await browser.close();report.memoryAccounting='Sampled sums of dedicated browser CDP process working sets and private bytes. Shared working-set pages may be counted more than once; peaks between samples and exited processes are not captured. CPU is CDP process cumulative delta; test harness/PowerShell CPU excluded.';writeFileSync(root+'/test-results/performance-'+label+'.json',JSON.stringify(report,null,2));}
