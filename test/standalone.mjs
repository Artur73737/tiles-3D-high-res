// Live check of standalone.html (Tiles.createViewer iframe): UI contract, 2D, 3D and 3D Fly.
import {chromium} from 'playwright-core';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));mkdirSync(root+'/test-results',{recursive:true});
const executablePath=process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe';
const errors=[],report={},check=(ok,m)=>{if(!ok)throw Error(m);};
const context=await chromium.launchPersistentContext(mkdtempSync(root+'/test-results/standalone-'),{executablePath,headless:true,viewport:{width:1280,height:800},args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const until=async(fn,ms=90000,arg)=>{const t=Date.now();for(;;){const v=await page.evaluate(fn,arg);if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+fn);await page.waitForTimeout(400);}};
const shot=name=>page.screenshot({path:root+'/test-results/standalone-'+name+'.png'});
try{
 await page.goto(pathToFileURL(root+'/standalone.html').href+'?lat=41.89021&lon=12.49223');
 const f=page.frameLocator('iframe');
 await until(()=>viewer.getStats().loaded2d>=6);
 // UI contract
 report.ui=await page.evaluate(()=>{const d=viewer.document,box=s=>d.querySelector(s).getBoundingClientRect(),hdr=[...d.querySelectorAll('header button,header input')].filter(e=>e.offsetParent).map(e=>Math.round(e.getBoundingClientRect().height));
  return {brand:d.querySelector('.brand').textContent,nativeNumber:d.querySelectorAll('input[type=number]').length,nativeSelect:d.querySelectorAll('select').length,headerHeights:[...new Set(hdr)],goTop:box('#go').top,searchTop:box('#search').top,goH:box('#go').height,searchH:box('#search').height,coordInputs:!!d.getElementById('lat'),steppers:d.querySelectorAll('.step').length,dropdowns:d.querySelectorAll('.dd').length};});
 check(report.ui.brand==='TILES','brand');check(!report.ui.nativeNumber&&!report.ui.nativeSelect,'native controls left');check(report.ui.headerHeights.length===1,'header heights '+report.ui.headerHeights);check(report.ui.goTop===report.ui.searchTop&&report.ui.goH===report.ui.searchH,'GO misaligned with search');check(!report.ui.coordInputs,'coordinate inputs must be gone');
 // Layout: navbar / left sidebar / main + footer / right sidebar. A corner is rounded (7px) only when it does not touch the window edge.
 const corners=()=>page.evaluate(()=>{const d=viewer.document,W=d.documentElement.clientWidth,H=d.documentElement.clientHeight,bad=[],seen=[];
  for(const sel of ['header','#left','#right','#stage','footer']){const el=d.querySelector(sel);if(!el.offsetParent&&sel!=='header')continue;const r=el.getBoundingClientRect(),cs=getComputedStyle(el);seen.push(sel);
   for(const [name,x,y]of [['TopLeft',r.left,r.top],['TopRight',r.right,r.top],['BottomRight',r.right,r.bottom],['BottomLeft',r.left,r.bottom]]){const touches=x<=.5||y<=.5||x>=W-.5||y>=H-.5,rad=parseFloat(cs['border'+name+'Radius']);if(rad!==(touches?0:7))bad.push(sel+' '+name+' '+rad+(touches?' touches':' inside'));}}return {bad,seen};});
 const layout=()=>page.evaluate(()=>{const d=viewer.document,g=id=>d.getElementById(id).getBoundingClientRect(),s=g('stage'),l=g('left'),r=g('right'),c=d.getElementById('map2d');return {stageL:Math.round(s.left),stageR:Math.round(s.right),leftR:Math.round(l.right),rightL:Math.round(r.left),rightW:Math.round(r.width),W:d.documentElement.clientWidth,canvasW:c.width};});
 report.open=await layout();report.cornersOpen=await corners();
 await f.locator('#toggle').click();await page.waitForTimeout(300);report.closedRight=await layout();report.cornersNoRight=await corners();
 await f.locator('#toggleLeft').click();await page.waitForTimeout(300);report.closedBoth=await layout();report.cornersNone=await corners();
 await f.locator('#toggleLeft').click();await f.locator('#toggle').click();await page.waitForTimeout(300);
 for(const k of ['cornersOpen','cornersNoRight','cornersNone'])check(!report[k].bad.length,'corner radius rule '+k+': '+report[k].bad.join(', '));
 check(report.open.leftR<report.open.stageL&&report.open.stageR<report.open.rightL&&report.open.rightW===300,'panels overlap the main view '+JSON.stringify(report.open));
 check(report.closedRight.stageR===report.closedRight.W&&report.closedRight.canvasW>report.open.canvasW+250,'right sidebar did not resize the main view');check(report.closedBoth.stageL===0&&report.closedBoth.stageR===report.closedBoth.W,'main view not full width');
 // Place search: English names, keyboard and GO.
 await f.locator('#search').fill('golden gate bridge');await f.locator('.menu li[role=option]').first().waitFor({timeout:20000});report.searchMenu=await page.evaluate(()=>[...viewer.document.querySelectorAll('.menu li')].map(li=>li.textContent));
 await f.locator('#search').press('Enter');await page.waitForTimeout(800);report.searchView=await page.evaluate(()=>viewer.getView());
 check(/Golden Gate Bridge/.test(report.searchMenu[0])&&Math.abs(report.searchView.latitude-37.8199)<0.02&&Math.abs(report.searchView.longitude+122.4783)<0.02,'place search '+JSON.stringify(report.searchMenu));
 await f.locator('#search').fill('chernobyl');await f.locator('#go').click();await page.waitForFunction(()=>Math.abs(viewer.getView().latitude-51.27)<0.2,null,{timeout:20000});report.goView=await page.evaluate(()=>viewer.getView());check(Math.abs(report.goView.latitude-51.27)<0.2&&Math.abs(report.goView.longitude-30.22)<0.3,'GO search (chernobyl) '+JSON.stringify(report.goView));
 await shot('2d');
 // Dropdown + steppers through the real UI
 await f.getByRole('button',{name:'Scale',exact:true}).click();await f.locator('.menu li',{hasText:'2x'}).click();
 const zrow=f.locator('.row',{hasText:'Max zoom'});await zrow.locator('button[aria-label^="Decrease"]').click();await zrow.locator('button[aria-label^="Decrease"]').click();
 await f.locator('.ck',{hasText:'traffic'}).click();await f.getByRole('button',{name:'Style',exact:true}).click();await f.locator('.menu li',{hasText:'Grayscale'}).click();
 await f.locator('.row',{hasText:'Language'}).locator('input').fill('it');await f.locator('.row',{hasText:'Language'}).locator('input').press('Tab');await page.waitForTimeout(900);
 report.uiUrl=await page.evaluate(()=>viewer.tiles2d.tileUrl(18,1,1));report.uiCfg=await page.evaluate(()=>viewer.getConfig().d2);
 check(/scale=2/.test(report.uiUrl)&&/lyrs=s,traffic&/.test(report.uiUrl)&&/hl=it/.test(report.uiUrl)&&/apistyle=p\.s/.test(report.uiUrl)&&report.uiCfg.maxZoom===20,'UI controls → API: '+report.uiUrl);
 // Programmatic control: same API, UI follows
 await page.evaluate(()=>viewer.set({d2:{layers:['y'],scale:1,language:'en',region:'us',style:'s.e:l|p.v:off',maxZoom:22,servers:[1,2]}}));
 report.setUrl=await page.evaluate(()=>viewer.tiles2d.tileUrl(18,1,1));report.setUi=await page.evaluate(()=>({region:[...viewer.document.querySelectorAll('.row')].find(r=>r.textContent.startsWith('Region')).querySelector('input').value,style:[...viewer.document.querySelectorAll('.row')].find(r=>r.textContent.startsWith('Style')).querySelector('.dd span').textContent}));
 check(/lyrs=y&/.test(report.setUrl)&&/gl=us/.test(report.setUrl)&&!/mt0|mt3/.test(report.setUrl)&&report.setUi.region==='us'&&report.setUi.style==='No labels','set() → UI/API');
 await until(()=>viewer.getStats().loaded2d>=6);
 report.maxZoom=await page.evaluate(()=>viewer.findMaxZoom());check(report.maxZoom>=20,'max zoom');
 const png=await page.evaluate(async()=>{viewer.goTo({zoom:18});const r=await viewer.exportPNG({download:false});return {w:r.width,complete:r.complete};});const stageW=await page.evaluate(()=>viewer.document.getElementById('stage').clientWidth);check(png.w>=stageW&&png.complete,'png '+png.w+' < view '+stageW);report.png=png;
 await page.evaluate(()=>viewer.goTo({latitude:41.89021,longitude:12.49223,zoom:18}));await page.waitForTimeout(2500);await shot('2d-hybrid');
 // Enhancer API: real tile, 2x upscale, CAS on/off produce different pixels.
 report.enhancerApi=await page.evaluate(async()=>{const t=new Tiles.Tiles2D(),e=new Tiles.TileEnhancer(),tile=await t.getTile(19,280337,194839),blob=new Blob([tile.bytes]);
  const px=async b=>{const c=new OffscreenCanvas(b.width,b.height),x=c.getContext('2d');x.drawImage(b,0,0);return x.getImageData(0,0,b.width,b.height).data;};
  const plain=await e.enhance(blob,{upscale:2,sharpen:false}),sharp=await e.enhance(blob,{upscale:2,sharpness:1}),den=await e.enhance(blob,{upscale:1,sharpen:false,denoise:1}),a=await px(plain),b=await px(sharp),d=await px(den);let diff=0,dd=0;for(let i=0;i<a.length;i+=4)diff+=Math.abs(a[i]-b[i]);const orig=await px(await createImageBitmap(blob));for(let i=0;i<orig.length;i+=4)dd+=Math.abs(orig[i]-d[i]);
  const viaApi=await t.getEnhancedTile(19,280337,194839,{upscale:4});const r={w:plain.width,h:plain.height,meanSharpenDelta:diff/(a.length/4),meanDenoiseDelta:dd/(orig.length/4),api4x:viaApi.bitmap.width};e.dispose();await t.dispose();return r;});
 check(report.enhancerApi.w===512&&report.enhancerApi.meanSharpenDelta>0.5&&report.enhancerApi.meanDenoiseDelta>0.2&&report.enhancerApi.api4x===1024,'enhancer api '+JSON.stringify(report.enhancerApi));
 // 2D gating: unavailable below max zoom, available at max zoom, then tiles are processed.
 await page.evaluate(()=>viewer.set({d2:{layers:['s'],style:'',region:'',servers:[0,1,2,3]}}));await page.evaluate(()=>viewer.goTo({zoom:18}));await page.waitForTimeout(1500);
 report.gate2dLow=await page.evaluate(()=>({...viewer.getEnhanceState(),button:viewer.document.getElementById('enhance').disabled}));
 check(!report.gate2dLow.available2d&&report.gate2dLow.button,'2D enhance must be locked below max zoom');
 await page.evaluate(()=>viewer.findMaxZoom());await page.evaluate(()=>viewer.setEnhance({enabled2d:true,upscale2d:2,sharpness2d:.7}));
 await until(()=>(viewer.getStats().enhancer?.processed??0)>=4,60000);
 report.gate2dMax=await page.evaluate(()=>({...viewer.getEnhanceState(),button:viewer.document.getElementById('enhance').disabled,processed:viewer.getStats().enhancer.processed,status:viewer.document.getElementById('status').textContent}));
 check(report.gate2dMax.available2d&&report.gate2dMax.active2d&&!report.gate2dMax.button&&/ENHANCED/.test(report.gate2dMax.status),'2D enhance at max zoom');
 await page.waitForTimeout(1500);await shot('2d-enhanced');
 await page.evaluate(()=>{viewer.setEnhance({enabled2d:false});viewer.goTo({zoom:18});});
 // 3D
 await page.evaluate(()=>viewer.set({d3:{radiusMeters:80}})); await f.locator('header [data-mode="3d"]').click();
 await until(()=>{const s=viewer.getStats().mesh;return s.total>0&&s.done===s.total;},480000);
 report.d3=await page.evaluate(()=>viewer.getStats().mesh);check(report.d3.errors===0,'3D errors');
 await page.waitForTimeout(800);await shot('3d');
 report.gate3d=await page.evaluate(()=>viewer.getEnhanceState());check(report.gate3d.available3d,'3D sharpen must unlock at full maximum detail');
 await page.evaluate(()=>viewer.setEnhance({enabled3d:true,sharpness3d:.8}));await page.waitForTimeout(1200);report.gate3dOn=await page.evaluate(()=>viewer.getEnhanceState().active3d);check(report.gate3dOn,'3D sharpen active');await shot('3d-sharpened');
 await page.evaluate(()=>viewer.setEnhance({enabled3d:false}));
 // Fly
 await f.locator('header [data-mode="fly"]').click();const before=await page.evaluate(()=>[...viewer._internal.loaded.keys()]);
 await page.evaluate(()=>viewer.window.focus());await f.locator('#view3d').focus();
 await page.keyboard.down('ShiftLeft');await page.keyboard.down('KeyW');await page.waitForTimeout(5000);await page.keyboard.up('KeyW');await page.keyboard.up('ShiftLeft');await page.waitForTimeout(1500);
 const moved=await page.evaluate(()=>viewer._internal.camera.position.toArray());
 await until(()=>{const s=viewer.getStats().mesh;return s.total>0&&s.done===s.total;},480000);
 const after=await page.evaluate(()=>[...viewer._internal.loaded.keys()]);report.fly={moved,newTiles:after.filter(k=>!before.includes(k)).length};
 check(Math.hypot(moved[0],moved[1]+60)>150,'fly move '+moved);check(report.fly.newTiles>0,'fly streaming');
 await page.waitForTimeout(800);await shot('fly');
 // Globe view: 2D patches, 3D meshes on the globe, fly with streaming.
 await page.evaluate(()=>{viewer.setMode('2d');viewer.setView('globe');viewer.goTo({latitude:41.89021,longitude:12.49223,zoom:4});});
 await until(()=>{const g=viewer.getStats().globe;return g.patches>=20&&g.patches>=g.wanted*.6;},90000);report.globeFar=await page.evaluate(()=>viewer.getStats().globe);await page.waitForTimeout(800);await shot('globe-far');
 await page.evaluate(()=>viewer.goTo({zoom:17}));await until(()=>{const g=viewer.getStats().globe;return g.finestZoom>=16&&g.patches>=30;},90000);report.globeNear=await page.evaluate(()=>viewer.getStats().globe);await shot('globe-2d');
 await page.evaluate(()=>{viewer.set({d3:{radiusMeters:80}});viewer.setMode('3d');});
 await until(()=>{const m=viewer.getStats().globe.mesh;return m.total>0&&m.done===m.total;},240000);report.globe3d=await page.evaluate(()=>viewer.getStats().globe);await page.waitForTimeout(800);await shot('globe-3d');
 check(report.globe3d.mesh.errors===0&&report.globe3d.mesh.reached,'globe 3D complete');
 await page.evaluate(()=>viewer.setMode('fly'));await page.waitForTimeout(1500);const gBefore=await page.evaluate(()=>viewer._internal.globe.fly.pos.toArray());
 await f.locator('#view3d').focus();await page.keyboard.down('KeyW');await page.waitForTimeout(5000);await page.keyboard.up('KeyW');await page.waitForTimeout(2000);
 const gAfter=await page.evaluate(()=>viewer._internal.globe.fly.pos.toArray());report.globeFly={moved:Math.hypot(gAfter[0]-gBefore[0],gAfter[1]-gBefore[1],gAfter[2]-gBefore[2]),stats:await page.evaluate(()=>viewer.getStats().globe)};
 await page.waitForTimeout(3000);await shot('globe-fly');
 check(report.globeFar.patches>=20&&report.globeNear.finestZoom>=16&&report.globeFly.moved>30,'globe '+JSON.stringify({far:report.globeFar.patches,near:report.globeNear.finestZoom,fly:report.globeFly.moved}));
 check(!errors.length,'page errors: '+errors.join(' | '));report.passed=true;
}catch(e){report.passed=false;report.error=e.message;report.atFailure=await page.evaluate(()=>({stats:viewer.getStats(),status:viewer.document.getElementById('status').textContent,view:viewer.getView()})).catch(x=>x.message);await shot('fail').catch(()=>{});process.exitCode=1;}
finally{report.pageErrors=errors;await context.close();writeFileSync(root+'/verification/standalone.json',JSON.stringify(report,null,1));console.log(JSON.stringify(report,null,1));}
