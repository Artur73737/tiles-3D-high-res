import {chromium} from 'playwright-core';
import {writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));mkdirSync(root+'/test-results',{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],report={};
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
try{
 await page.goto(pathToFileURL(root+'/globo-hq.html').href+'?view=3d&radius=50#qa');await page.waitForFunction(()=>!!window.__earthDemo);
 const start=Date.now();await page.waitForFunction(()=>window.__earthDemo.state().mode==='player',{},{timeout:120000});report.readySeconds=(Date.now()-start)/1000;
 check(await page.locator('#go,#enter,#resume,#overlay').count()===0,'Manual exploration gate remains');
 await page.evaluate(()=>window.__earthDemo.streamer.waitForIdle());report.coverage=await page.evaluate(()=>window.__earthDemo.streamer.getCoverage());check(report.coverage.complete,'Live demo coverage incomplete');
 check(await page.evaluate(()=>window.__earthDemo.scene.fog===null),'Short fog remains');
 check(await page.evaluate(()=>window.__earthDemo.player.flying),'3D entry must start in flight');
 await page.evaluate(()=>window.__earthDemo.player.reset());
 await page.locator('canvas').click({position:{x:800,y:450}});await page.waitForFunction(()=>window.__earthDemo.state().locked);
 await page.waitForTimeout(200);await page.screenshot({path:root+'/test-results/ground.png'});
 const y=await page.evaluate(()=>window.__earthDemo.player.feet.y);await page.keyboard.press('Space');await page.waitForTimeout(180);report.jump=(await page.evaluate(()=>window.__earthDemo.player.feet.y))-y;check(report.jump>.1,'Jump failed');await page.waitForTimeout(1000);
 await page.keyboard.press('Space');await page.waitForTimeout(80);await page.keyboard.press('Space');check(await page.evaluate(()=>window.__earthDemo.player.flying),'Flight toggle failed');
 const flightY=await page.evaluate(()=>window.__earthDemo.player.feet.y);await page.keyboard.down('Space');await page.waitForTimeout(350);await page.keyboard.up('Space');const high=await page.evaluate(()=>window.__earthDemo.player.feet.y);report.ascend=high-flightY;check(report.ascend>.5,'Flight ascend failed');
 await page.keyboard.down('ShiftLeft');await page.waitForTimeout(250);await page.keyboard.up('ShiftLeft');report.descend=high-await page.evaluate(()=>window.__earthDemo.player.feet.y);check(report.descend>.4,'Flight descend failed');
 async function prepareSpeed(){return page.evaluate(()=>{const q=window.__earthDemo;q.input.reset();q.player.place(new q.THREE.Vector3(0,100,0));q.player.flying=true;q.look(0,0);q.world.refresh(q.player.feet,{all:true});return q.player.feet.toArray();});}
 let from=await prepareSpeed();await page.keyboard.down('KeyW');await page.waitForTimeout(350);await page.keyboard.up('KeyW');let to=await page.evaluate(()=>window.__earthDemo.player.feet.toArray());report.normalDistance=Math.hypot(to[0]-from[0],to[2]-from[2]);
 from=await prepareSpeed();await page.keyboard.press('KeyW');await page.waitForTimeout(70);await page.keyboard.down('KeyW');check(await page.evaluate(()=>window.__earthDemo.state().sprint),'Double W did not engage sprint');await page.waitForTimeout(350);await page.keyboard.up('KeyW');to=await page.evaluate(()=>window.__earthDemo.player.feet.toArray());report.sprintDistance=Math.hypot(to[0]-from[0],to[2]-from[2]);check(report.sprintDistance>report.normalDistance*1.6,'Sprint did not accelerate');check(!await page.evaluate(()=>window.__earthDemo.state().sprint),'Sprint stayed active after W release');
 const wall=await page.evaluate(()=>{
  const q=window.__earthDemo,{Vector3,Ray}=q.THREE;
  q.player.place(new Vector3());q.world.refresh(q.player.feet,{all:true});
  for(const x of [0,-5,5,-10,10])for(const z of [0,-5,5,-10,10])for(let angle=0;angle<Math.PI*2;angle+=Math.PI/4){
   const ground=q.world.rayIntersect(new Ray(new Vector3(x,150,z),new Vector3(0,-1,0)));if(!ground)continue;
   const direction=new Vector3(Math.sin(angle),0,Math.cos(angle));
   const hit=q.world.rayIntersect(new Ray(new Vector3(x,ground.position.y+1.2,z),direction));if(!hit||hit.distance<2||hit.distance>15)continue;
   const normal=hit.triangle.getNormal(new Vector3());if(Math.abs(normal.y)>.25)continue;
   const p=hit.position.clone().addScaledVector(normal,1.7);p.y=hit.position.y-.85;q.player.place(p);q.player.flying=true;q.look(Math.atan2(normal.x,normal.z));q.world.refresh(p,{all:true});
   return {point:hit.position.toArray(),normal:normal.toArray(),contacts:q.player.contactCount};
  }return null;
 });
 check(wall,'No live mesh wall for collision check');await page.keyboard.down('KeyW');await page.waitForTimeout(850);await page.keyboard.up('KeyW');
 const state=await page.evaluate(()=>window.__earthDemo.state());report.wall={contacts:state.player.contacts-wall.contacts,distance:state.player.feet.reduce((n,v,i)=>n+(v+(i===1?.85:0)-wall.point[i])*wall.normal[i],0)};check(report.wall.contacts>0&&report.wall.distance>.20,'Player crossed live wall');
 await page.keyboard.press('Escape');await page.waitForTimeout(150);check(!await page.evaluate(()=>window.__earthDemo.state().locked),'Escape failed');await page.locator('#globe').click();check(await page.evaluate(()=>window.__earthDemo.state().mode==='globe'),'Globe switch failed');await page.screenshot({path:root+'/test-results/globe.png'});
 check(!errors.length,'Browser errors: '+errors.join('; '));report.ok=true;report.errors=errors;
}catch(error){report.ok=false;report.error=error.message;report.errors=errors;report.state=await page.evaluate(()=>window.__earthDemo?.state());report.coverage=await page.evaluate(()=>window.__earthDemo?.streamer.getCoverage());await page.screenshot({path:root+'/test-results/demo-error.png'});process.exitCode=1;}
finally{await browser.close();writeFileSync(root+'/test-results/demo.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
