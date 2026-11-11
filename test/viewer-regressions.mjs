// Live regressions for reported viewer defects: flat 2D seams, attribution text, globe pan/tilt
// axes, overlapping globe patches (z-fighting) and the zoom / north controls.
import {chromium} from 'playwright-core';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {pathToFileURL,fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));mkdirSync(root+'/test-results',{recursive:true});
const executablePath=process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe';
const errors=[],report={},check=(ok,m)=>{if(!ok)throw Error(m);};
const context=await chromium.launchPersistentContext(mkdtempSync(root+'/test-results/regress-'),{executablePath,headless:true,viewport:{width:1426,height:807},args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const until=async(fn,ms=90000,arg)=>{const t=Date.now();for(;;){const v=await page.evaluate(fn,arg);if(v)return v;if(Date.now()-t>ms)throw Error('timeout: '+fn);await page.waitForTimeout(300);}};
const shot=n=>page.screenshot({path:root+'/test-results/regress-'+n+'.png'});
try{
 await page.goto(pathToFileURL(root+'/standalone.html').href+'?lat=42.108137&lon=22.064096&zoom=5.4&panel=0');
 const f=page.frameLocator('iframe');
 // 1. Flat 2D seams at fractional zoom: no row of the map may be mostly pure black.
 for(const z of [5.4,7.3,12.6]){
  await page.evaluate(z=>viewer.goTo({zoom:z}),z);await until(()=>{const s=viewer.document.getElementById('status').textContent.match(/(\d+)\/(\d+) tiles/);return s&&s[1]===s[2];});await page.waitForTimeout(400);
  const seams=await page.evaluate(()=>{const c=viewer.document.getElementById('map2d'),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,W=c.width,H=c.height,rows=[],cols=[];
   for(let y=0;y<H;y++){let k=0;for(let x=0;x<W;x++){const i=(y*W+x)*4;if(d[i]<4&&d[i+1]<4&&d[i+2]<4)k++;}if(k>W*.2)rows.push(y);}
   for(let x=0;x<W;x+=1){let k=0;for(let y=0;y<H;y++){const i=(y*W+x)*4;if(d[i]<4&&d[i+1]<4&&d[i+2]<4)k++;}if(k>H*.2)cols.push(x);}return {rows:rows.length,cols:cols.length,W,H};});
  report['seams_z'+z]=seams;check(!seams.rows&&!seams.cols,'black seams at z'+z+' '+JSON.stringify(seams));
 }
 await shot('flat-2d');
 // Never magnify in flat 2D: fractional zoom 5.4 must draw z6 tiles (texel <= device pixel).
 await page.evaluate(()=>viewer.goTo({zoom:5.4}));await page.waitForTimeout(2500);
 report.flatTileZooms=await page.evaluate(()=>[...new Set([...viewer._internal.bitmaps().entries()].filter(([k,e])=>e.bmp).map(([k])=>+k.split('/')[0]))]);
 check(report.flatTileZooms.includes(6),'flat 2D at z5.4 must load z6 tiles '+report.flatTileZooms);
 // Options apply live, without pressing Apply.
 await page.evaluate(()=>viewer.togglePanel(true));await f.locator('.ck',{hasText:'y · hybrid'}).click();await page.waitForTimeout(900);
 report.liveLayers=await page.evaluate(()=>viewer.tiles2d.options.layers);check(report.liveLayers.join()==='y','hybrid must replace satellite (s+y is rejected by Google) and apply live '+report.liveLayers);
 await until(()=>{const m=viewer.document.getElementById('status').textContent.match(/(\d+)\/(\d+) tiles/);return m&&m[1]===m[2]&&!/errors/.test(viewer.document.getElementById('status').textContent);});
 await f.locator('.ck',{hasText:'traffic'}).click();await page.waitForTimeout(900);report.liveOverlay=await page.evaluate(()=>viewer.tiles2d.options.layers);check(report.liveOverlay.join()==='y,traffic','overlay combines live');
 await until(()=>{const m=viewer.document.getElementById('status').textContent.match(/(\d+)\/(\d+) tiles/);return m&&m[1]===m[2]&&!/errors/.test(viewer.document.getElementById('status').textContent);});
 await f.locator('.ck',{hasText:'traffic'}).click();await f.locator('.ck',{hasText:'s · satellite'}).click();await page.waitForTimeout(900);
 // "Enable everything": click every layer in turn; each state must be a valid Google request with no tile errors.
 report.noApplyButton=await page.evaluate(()=>!viewer.document.getElementById('apply'));check(report.noApplyButton,'Apply button must not exist');
 const loadedOk=()=>until(()=>{const t=viewer.document.getElementById('status').textContent,m=t.match(/(\d+)\/(\d+) tiles/);return m&&m[1]===m[2]&&!/errors/.test(t);},60000);
 report.allLayers=[];for(const label of ['s · satellite','y · hybrid','h · labels','m · roadmap','p · terrain+','t · relief','r · roads','traffic','transit','bike']){
  const el=f.locator('.ck',{hasText:label});if(await el.getAttribute('aria-checked')!=='true')await el.click();await page.waitForTimeout(700);await loadedOk();
  report.allLayers.push(await page.evaluate(()=>viewer.tiles2d.options.layers.join(',')));}
 check(report.allLayers.every(Boolean),'layers');
 // Headers: safelisted ones work live; others are refused with a clear message and the map keeps working.
 const hdr=f.locator('.row',{hasText:'Headers'}).locator('input');await hdr.fill('{"Accept-Language":"it"}');await hdr.press('Enter');await page.waitForTimeout(900);await loadedOk();
 await hdr.fill('{"X-Name":"v"}');await hdr.press('Enter');await page.waitForTimeout(900);report.badHeader=await page.evaluate(()=>viewer.document.getElementById('status').textContent);check(/CORS|preflight/i.test(report.badHeader),'bad header must be refused clearly');
 await hdr.fill('');await hdr.press('Enter');await page.waitForTimeout(900);await loadedOk();
 report.credentialOptions=await page.evaluate(()=>{const b=[...viewer.document.querySelectorAll('.dd button')].find(x=>x.getAttribute('aria-label')==='Credentials');b.click();const o=[...viewer.document.querySelectorAll('.menu li')].map(li=>li.textContent);b.click();return o;});check(!report.credentialOptions.includes('include'),'credentials include must not be offered');
 await page.evaluate(()=>viewer.set({d2:{layers:['s']}}));await page.evaluate(()=>viewer.togglePanel(false));
 report.footer=await page.evaluate(()=>({text:viewer.document.querySelector('footer').textContent,attrib:!!viewer.document.getElementById('attrib'),fps:viewer.document.getElementById('fps').textContent}));check(!report.footer.attrib&&!/Google|Vexcel|Imagery/.test(report.footer.text),'credit text must be gone '+report.footer.text);check(/^\d+ fps$/.test(report.footer.fps),'fps in footer '+report.footer.fps);
 // 2. Zoom buttons in flat 2D.
 const z0=await page.evaluate(()=>viewer.getView().zoom);await f.locator('#zin').click();const z1=await page.evaluate(()=>viewer.getView().zoom);await f.locator('#zout').click();await f.locator('#zout').click();const z2=await page.evaluate(()=>viewer.getView().zoom);
 report.flatZoom=[z0,z1,z2];check(z1===Math.round(z0)+1&&z2===z1-2,'flat zoom buttons '+report.flatZoom);
 // 3. Globe: pan follows the pointer at heading 0 and 90; shift-drag up tilts toward the horizon.
 await page.evaluate(()=>{viewer.setView('globe');viewer.goTo({latitude:41.89021,longitude:12.49223,zoom:15});});await page.waitForTimeout(2500);
 const box=await f.locator('#view3d').boundingBox(),cx=box.x+box.width/2,cy=box.y+box.height/2;
 const drag=async(dx,dy,mod)=>{if(mod)await page.keyboard.down(mod);await page.mouse.move(cx,cy);await page.mouse.down();await page.mouse.move(cx+dx,cy+dy,{steps:8});await page.mouse.up();if(mod)await page.keyboard.up(mod);await page.waitForTimeout(150);};
 const nav=()=>page.evaluate(()=>({...viewer.globe.nav}));
 await page.evaluate(()=>{viewer.globe.nav.heading=0;viewer.globe.nav.tilt=0;});let a=await nav();await drag(200,0);let b=await nav();report.panH0={dLon:b.lon-a.lon,dLat:b.lat-a.lat};
 check(b.lon<a.lon&&Math.abs(b.lat-a.lat)<Math.abs(b.lon-a.lon)*.2,'heading 0: drag right must move the target west '+JSON.stringify(report.panH0));
 a=await nav();await drag(0,200);b=await nav();report.panH0v={dLat:b.lat-a.lat};check(b.lat>a.lat,'heading 0: drag down must move the target north');
 await page.evaluate(()=>{viewer.globe.nav.heading=90;});a=await nav();await drag(200,0);b=await nav();report.panH90={dLon:b.lon-a.lon,dLat:b.lat-a.lat};
 check(b.lat>a.lat&&Math.abs(b.lon-a.lon)*Math.cos(a.lat*Math.PI/180)<Math.abs(b.lat-a.lat)*.2,'heading 90 (facing east): drag right must move the target north '+JSON.stringify(report.panH90));
 a=await nav();await drag(0,-120,'Shift');b=await nav();report.tilt=[a.tilt,b.tilt];check(b.tilt>a.tilt,'shift-drag up must tilt toward the horizon');
 // 4. North control resets heading; zoom buttons change distance.
 await f.locator('#north').click();report.northGlobe=await page.evaluate(()=>viewer.getHeading());check(report.northGlobe===0,'globe north');
 const d0=(await nav()).dist;await f.locator('#zin').click();const d1=(await nav()).dist;check(d1<d0,'globe zoom in');
 // 5. Non-overlapping quadtree: no visible patch is an ancestor of another, at several altitudes and tilts.
 const overlap=()=>page.evaluate(()=>{const keys=viewer.globe.visibleKeys().map(k=>k.split('/').map(Number));let bad=0;for(const [z,x,y]of keys)for(const [z2,x2,y2]of keys)if(z2>z&&x2>>(z2-z)===x&&y2>>(z2-z)===y)bad++;return {visible:keys.length,overlaps:bad};});
 for(const [zoom,tilt] of [[4,0],[11,30],[16,70]]){await page.evaluate(([zoom,tilt])=>{viewer.goTo({latitude:41.89021,longitude:12.49223,zoom});viewer.globe.nav.tilt=tilt;},[zoom,tilt]);await page.waitForTimeout(5000);const o=await overlap();report['overlap_z'+zoom+'_t'+tilt]=o;check(o.visible>0&&o.overlaps===0,'overlapping globe patches '+JSON.stringify(o));await shot('globe-z'+zoom);}
 // 5b. Reported scenario: hilly ground (~740 m), wheel-zoom to the surface. Patches must reach the
 // maximum zoom and never be magnified (device pixel <= texel) where a finer zoom exists.
 await page.evaluate(()=>{viewer.goTo({latitude:44.259914,longitude:11.556398,zoom:6});viewer.globe.nav.tilt=0;});await page.waitForTimeout(2500);
 await page.mouse.move(cx,cy);for(let i=0;i<120;i++){await page.mouse.wheel(0,-120);await page.waitForTimeout(40);}
 await until(()=>{const g=viewer.getStats().globe,n=[...viewer.globe.debugNodes()];return !n.some(t=>t.state==='loading')&&g.patches>0;},120000);await page.waitForTimeout(1500);
 report.hilly=await page.evaluate(()=>{const g=viewer.getStats().globe;return {finest:g.finestZoom,magnification:g.magnification,altitude:g.altitude,patches:g.patches,above:viewer.globe.nav.dist};});await shot('globe-hilly');
 check(report.hilly.finest===22||report.hilly.magnification<=1.0001,'globe patches magnified '+JSON.stringify(report.hilly));
 // 6. Globe 3D aligned on 2D; flat 3D north reset.
 await page.evaluate(()=>viewer.goTo({latitude:41.89021,longitude:12.49223,zoom:16}));
 await page.evaluate(()=>{viewer.set({d3:{radiusMeters:60}});viewer.goTo({zoom:18});viewer.globe.nav.tilt=55;viewer.setMode('3d');});
 await until(()=>{const m=viewer.getStats().globe.mesh;return m.total>0&&m.done===m.total;},240000);await page.waitForTimeout(800);await shot('globe-3d');report.globe3d=await page.evaluate(()=>viewer.getStats().globe.mesh);
 await page.evaluate(()=>viewer.setView('flat'));await until(()=>{const m=viewer.getStats().mesh;return m.total>0&&m.done===m.total;},240000);
 await page.evaluate(()=>{const c=viewer._internal.camera;c.position.set(80,40,c.position.z);});await page.waitForTimeout(300);await f.locator('#north').click();await page.waitForTimeout(300);
 report.northFlat3d=await page.evaluate(()=>viewer.getHeading());check(Math.min(report.northFlat3d,360-report.northFlat3d)<1,'flat 3D north '+report.northFlat3d);await shot('flat-3d');
 // 7. Switching view or position while a 3D apply waits for ground elevation must not crash ("reading 'ground'").
 const before=errors.length;
 await page.evaluate(()=>{viewer.setMode('2d');viewer.setMode('3d');viewer.setView('globe');viewer.goTo({latitude:48.8584,longitude:2.2945,zoom:17});viewer.setView('flat');viewer.setMode('fly');viewer.setView('globe');});
 await page.waitForTimeout(4000);check(errors.length===before,'race during 3D apply: '+errors.slice(before).join(' | '));
 // 8. Crosshair visible in every view and mode, with the auto-contrast backdrop filter.
 report.cross=[];for(const view of ['flat','globe'])for(const mode of ['2d','3d','fly']){report.cross.push(await page.evaluate(([v,m])=>{viewer.setView(v);viewer.setMode(m);const d=viewer.document,c=d.querySelector('.cross'),r=c.getBoundingClientRect(),st=d.getElementById('stage').getBoundingClientRect(),bf=getComputedStyle(c,'::before').backdropFilter;return {v,m,shown:!!c.offsetParent&&r.width>0,centered:Math.abs(r.left+r.width/2-(st.left+st.width/2))<=1.5&&Math.abs(r.top+r.height/2-(st.top+st.height/2))<=1.5,bf};},[view,mode]));}
 for(const c of report.cross)check(c.shown&&c.centered&&/invert/.test(c.bf),'crosshair '+JSON.stringify(c));
 await page.evaluate(()=>viewer.setMode('2d'));
 check(!errors.length,'page errors: '+errors.join(' | '));report.passed=true;
}catch(e){report.passed=false;report.error=e.message;await shot('fail').catch(()=>{});process.exitCode=1;}
finally{report.pageErrors=errors;await context.close();writeFileSync(root+'/verification/viewer-regressions.json',JSON.stringify(report,null,1));console.log(JSON.stringify(report,null,1));}
