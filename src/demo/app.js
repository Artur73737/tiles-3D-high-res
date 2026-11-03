import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EarthHQStreaming,SatelliteLayer,TileError,geoToECEF,ecefToGeo,localFrame} from '../index.js';
import {Explorer} from './Player.js';
import {PlayerWorld} from './PlayerWorld.js';
import {mountLocationSearch} from './LocationSearch.js';
import {SprintInput} from './SprintInput.js';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),qa=location.hash==='#qa';
const requestedDistance=Number(params.get('visibility')??params.get('radius'));
let visibility=Number.isFinite(requestedDistance)&&requestedDistance>0?requestedDistance:2000;
const requestedAltitude=Number(params.get('hqAltitude'));
const activationAltitudeMeters=Number.isFinite(requestedAltitude)&&requestedAltitude>0?requestedAltitude:2500;
const renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;$('viewport').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0xbacfdc);
const camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,.1,150000000);camera.up.set(0,0,1);
camera.position.copy(geoToECEF(41.88931,12.49223)).multiplyScalar(2.6);camera.lookAt(0,0,0);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=false;controls.minDistance=6371050;controls.maxDistance=6371010*8;
controls.enablePan=false;controls.enableRotate=false;
const globeMaterial=new THREE.MeshBasicMaterial({color:0x142d3c});
const globe=new THREE.Mesh(new THREE.SphereGeometry(6370890,128,96),globeMaterial);globe.rotation.x=Math.PI/2;scene.add(globe);
globe.renderOrder=-2000;
const satellite=new SatelliteLayer({renderer,radius:6370890});scene.add(satellite.group);
const streamer=new EarthHQStreaming({renderer,radiusMeters:visibility,retainRadiusMeters:visibility*1.15,activationAltitudeMeters,screenSpaceError:1,maxGpuBytes:4*1024**3,cacheBytes:1024**3,cacheName:qa?'earth-hq-demo-test-v1':'earth-hq-cache-v1'});scene.add(streamer.group);
const world=new PlayerWorld(streamer),input=new SprintInput(),clock=new THREE.Clock();
const preferences={speed:1,sensitivity:1,invert:false,crosshair:true,satellite:true};
let walkingPreparation=false,navigationController=null;
let player=null,frame=null,mode='loading',locked=false,yaw=0,pitch=.08,navToken=0,lastHud=0,lastToast=0,error=null,booting=false;
// Drag the actual surface point under the cursor, with no velocity or inertia.
const dragRay=new THREE.Raycaster(),dragSphere=new THREE.Sphere(new THREE.Vector3(),globe.geometry.parameters.radius);
let globeDrag=null;
function surfaceAtPointer(event){
 const rect=renderer.domElement.getBoundingClientRect();camera.updateMatrixWorld(true);
 dragRay.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);
 return dragRay.ray.intersectSphere(dragSphere,new THREE.Vector3());
}
function endGlobeDrag(){const drag=globeDrag;globeDrag=null;if(drag&&renderer.domElement.hasPointerCapture(drag.pointerId))renderer.domElement.releasePointerCapture(drag.pointerId);}
renderer.domElement.addEventListener('pointerdown',event=>{
 if(!event.isPrimary){endGlobeDrag();return;}
 if(mode!=='globe'||event.button!==0)return;
 const point=surfaceAtPointer(event);if(!point)return;
 globeDrag={pointerId:event.pointerId,point};renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove',event=>{
 if(mode!=='globe'||globeDrag?.pointerId!==event.pointerId)return;
 const hit=surfaceAtPointer(event);if(!hit)return;
 const rotation=new THREE.Quaternion().setFromUnitVectors(hit.normalize(),globeDrag.point.clone().normalize());
 camera.position.applyQuaternion(rotation);camera.up.applyQuaternion(rotation);camera.lookAt(controls.target);controls.update();
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(type,event=>{if(globeDrag?.pointerId===event.pointerId)endGlobeDrag();});
function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),2800);}
function showError(e){if(e.name==='AbortError')return;error=e;$('error').textContent=['network_error','network_timeout'].includes(e.code)?(mode==='player'?'3D tile connection temporarily unavailable. Streaming will retry automatically.':'Unable to connect to 3D tiles after automatic retries. Check your connection and try Fly 3D again.'):e.message;$('error').hidden=false;}
streamer.addEventListener('error',({error})=>showError(error));streamer.addEventListener('warning',({error})=>toast(error.message));
streamer.addEventListener('progress',({coverage})=>{if(coverage.complete&&['network_error','network_timeout','http_error'].includes(error?.code)){error=null;$('error').hidden=true;}});
function applyPlayerCamera(){if(!frame||!player)return;camera.position.copy(player.eye).applyMatrix4(frame.toECEF);const rotation=new THREE.Quaternion().setFromRotationMatrix(frame.toECEF),look=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ'));camera.quaternion.copy(rotation.multiply(look));camera.up.copy(frame.up);}
function streamView(focus){
 const normal=focus.clone().normalize();
 const direction=mode==='player'?new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)).transformDirection(frame.toECEF):camera.getWorldDirection(new THREE.Vector3());
 direction.addScaledVector(normal,-direction.dot(normal));
 const halfAngle=Math.min(Math.PI,Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect)+THREE.MathUtils.degToRad(10));
 streamer.update(camera,{focusECEF:focus,radiusMeters:visibility,viewDirectionECEF:direction.lengthSq()>1e-10?direction:null,viewHalfAngle:halfAngle,nearRadiusMeters:Math.min(60,visibility),collisionRadiusMeters:mode==='player'&&!player.flying?12:0});
}
async function enterAt(latitude,longitude){
 endGlobeDrag();navigationController?.abort();navigationController=new AbortController();const token=++navToken;
 try{
 if(!Number.isFinite(latitude)||latitude< -90||latitude>90||!Number.isFinite(longitude))throw Error('Invalid coordinates.');
 longitude=((longitude+180)%360+360)%360-180;walkingPreparation=false;mode='loading';booting=true;error=null;input.reset();document.exitPointerLock();controls.enabled=false;$('error').hidden=true;locationSearch.close();
 streamer.group.visible=true;
 const planet=await streamer.start();if(token!==navToken)return;
 frame=localFrame(latitude,longitude,planet.radius);const target=geoToECEF(latitude,longitude,0,planet.radius);
 camera.position.copy(target).addScaledVector(frame.up,100).addScaledVector(frame.south,70);camera.up.copy(frame.up);camera.lookAt(target);
 // Resolve only local metadata for a safe camera elevation. No terminal
 // disk, payload download, or collision inventory gates flight entry.
 const ceiling=await streamer.source.surfaceCeiling(frame.up,planet,{isCurrent:()=>token===navToken,signal:navigationController.signal});if(token!==navToken)return;
 world.setFrame(frame);streamer.group.userData.atmosphere={groundRadius:planet.radius};
 player=new Explorer(world,{min:[-Infinity,-10000,-Infinity],max:[Infinity,10000,Infinity]});player.place(new THREE.Vector3(0,ceiling+80,0));player.spawn.copy(player.feet);player.safe.copy(player.feet);player.flying=true;player.flightMultiplier=preferences.speed;player.grounded=false;yaw=0;pitch=-.18;mode='player';booting=false;streamer.setEnabled(true);scene.background=new THREE.Color(0xbacfdc);applyPlayerCamera();streamView(player.feet.applyMatrix4(frame.toECEF));
 }catch(e){if(token!==navToken)return;globeView();showError(e);}
}
async function startWalking(){
 if(mode!=='player'||walkingPreparation)return;
 walkingPreparation=true;const token=navToken;input.reset();document.exitPointerLock();syncSettings(streamer.getCoverage());
 try{
  const feet=player.feet,focus=feet.clone().applyMatrix4(frame.toECEF);
  const coverage=await streamer.requestRegion({focusECEF:focus,radiusMeters:12});if(token!==navToken)return;
  if(!coverage.complete)throw Error('Walking ground is not ready. Retry Walk after the tiles load.');
  world.refresh(feet,{all:true});player.findSpawn(feet);world.dirty=true;
 }catch(error){if(token===navToken)showError(error);}finally{if(token===navToken)walkingPreparation=false;}
}
function globeView(){navigationController?.abort();walkingPreparation=false;endGlobeDrag();navToken++;booting=false;mode='globe';streamer.group.visible=false;streamer.setEnabled(false);input.reset();document.exitPointerLock();scene.background=new THREE.Color(0x070f1d);const direction=frame?frame.up:camera.position.clone().normalize();camera.position.copy(direction).multiplyScalar((streamer.planet?.radius??6371010)*2.6);camera.up.set(0,0,1);camera.lookAt(0,0,0);controls.target.set(0,0,0);controls.enabled=true;controls.update();}
function rebase(){
 const feetECEF=player.feet.applyMatrix4(frame.toECEF),location=ecefToGeo(feetECEF,streamer.planet.radius),newFrame=localFrame(location.latitude,location.longitude,streamer.planet.radius);
 const rotation=new THREE.Quaternion().setFromRotationMatrix(newFrame.toECEF).invert().multiply(camera.quaternion),angles=new THREE.Euler().setFromQuaternion(rotation,'YXZ');yaw=angles.y;pitch=angles.x;
 const safeECEF=player.safe.clone().applyMatrix4(frame.toECEF),spawnECEF=player.spawn.clone().applyMatrix4(frame.toECEF);frame=newFrame;world.setFrame(frame);player.place(feetECEF.applyMatrix4(frame.fromECEF));player.safe.copy(safeECEF.applyMatrix4(frame.fromECEF));player.spawn.copy(spawnECEF.applyMatrix4(frame.fromECEF));world.refresh(player.feet,{all:true});
}
renderer.domElement.addEventListener('click',async()=>{if(mode==='player')try{await renderer.domElement.requestPointerLock();}catch(e){showError(e);}});
const locationSearch=mountLocationSearch(place=>{
 globeView();const radius=streamer.planet?.radius??6371010;
 camera.position.copy(geoToECEF(place.latitude,place.longitude,place.height,radius));camera.lookAt(0,0,0);controls.update();
 $('place-name').textContent=[place.name,place.detail].filter(Boolean).join(' · ');
});
$('globe').addEventListener('click',globeView);
renderer.domElement.addEventListener('wheel',event=>{
 if(mode!=='player'||!player.flying)return;
 event.preventDefault();preferences.speed=player.adjustFlightSpeed(event.deltaY);
},{passive:false});
$('speed').addEventListener('click',()=>{preferences.speed=1;if(player)player.flightMultiplier=1;});
$('terrain').addEventListener('click',()=>{if(mode==='globe'){const geo=ecefToGeo(camera.position);enterAt(geo.latitude,geo.longitude);}});
$('home').addEventListener('click',()=>{$('location').value='';$('place-name').textContent='Rome · Colosseum';enterAt(41.88931,12.49223);});
$('help').addEventListener('click',showHelp);
$('panel-toggle').addEventListener('click',()=>{const panel=$('details-panel');panel.hidden=!panel.hidden;$('panel-toggle').setAttribute('aria-expanded',String(!panel.hidden));});
function setSettingsOpen(open){
 $('settings-panel').hidden=!open;document.body.classList.toggle('settings-open',open);$('settings-toggle').setAttribute('aria-expanded',String(open));
 if(open){document.exitPointerLock();input.reset();locationSearch.close();$('settings-close').focus();}else if($('settings-panel').contains(document.activeElement))$('settings-toggle').focus();
}
function showHelp(){document.exitPointerLock();setSettingsOpen(false);$('help-dialog').showModal();}
for(const tab of document.querySelectorAll('[data-panel]'))tab.addEventListener('click',()=>{
 for(const item of document.querySelectorAll('[data-panel]')){const active=item===tab;item.setAttribute('aria-selected',String(active));$('controls-'+item.dataset.panel).hidden=!active;}
});
$('settings-toggle').addEventListener('click',()=>setSettingsOpen($('settings-panel').hidden));
for(const id of ['settings-close','settings-done'])$(id).addEventListener('click',()=>setSettingsOpen(false));
$('location').addEventListener('focus',()=>setSettingsOpen(false));
$('show-shortcuts').addEventListener('click',showHelp);
$('visit-rome').addEventListener('click',()=>{$('home').click();});
function refreshDetail(){if(mode==='player'&&streamer.enabled){streamer.requestRegion({...streamer.regionOptions(),radiusMeters:visibility,waitForCompletion:false}).catch(showError);}}
const distanceSelect=$('view-distance');if(![...distanceSelect.options].some(option=>Number(option.value)===visibility))distanceSelect.add(new Option((visibility/1000)+' km',String(visibility)));distanceSelect.value=String(visibility);
$('view-distance').addEventListener('change',()=>{visibility=Number($('view-distance').value);streamer.radiusMeters=visibility;streamer.retainRadiusMeters=visibility*1.15;refreshDetail();});
$('detail-level').addEventListener('change',()=>{streamer.screenSpaceError=Number($('detail-level').value);refreshDetail();});
$('render-scale').addEventListener('change',()=>{renderer.setPixelRatio($('render-scale').value==='auto'?Math.min(devicePixelRatio,1.7):Number($('render-scale').value));renderer.setSize(innerWidth,innerHeight);});
$('field-of-view').addEventListener('input',()=>{camera.fov=Number($('field-of-view').value);camera.updateProjectionMatrix();$('field-of-view-value').textContent=camera.fov+'°';});
$('flight-speed').addEventListener('input',()=>{preferences.speed=Number($('flight-speed').value);if(player)player.flightMultiplier=preferences.speed;syncSettings(streamer.getCoverage());});
$('look-sensitivity').addEventListener('input',()=>{preferences.sensitivity=Number($('look-sensitivity').value);$('look-sensitivity-value').textContent=preferences.sensitivity+'×';});
$('invert-look').addEventListener('change',()=>preferences.invert=$('invert-look').checked);
$('show-crosshair').addEventListener('change',()=>{preferences.crosshair=$('show-crosshair').checked;$('crosshair').hidden=!preferences.crosshair;});
$('satellite-visible').addEventListener('change',()=>{preferences.satellite=$('satellite-visible').checked;satellite.group.visible=preferences.satellite;});
for(const [id,flying]of [['movement-fly',true],['movement-walk',false]])$(id).addEventListener('click',()=>{if(!player||mode!=='player')return;if(!flying){startWalking();return;}player.flying=true;player.velocity.set(0,0,0);player.jumpQueued=false;player.lastSpace=-Infinity;syncSettings(streamer.getCoverage());});
$('return-spawn').addEventListener('click',()=>{if(mode!=='player')return;player.reset();world.dirty=true;applyPlayerCamera();});
$('gpu-budget').addEventListener('change',()=>streamer.setGpuBudget(Number($('gpu-budget').value)*1024**3));
$('stream-pause').addEventListener('click',()=>{if(mode==='player')streamer.setEnabled(!streamer.enabled);syncSettings(streamer.getCoverage());});
$('stream-retry').addEventListener('click',()=>{if(mode==='player')streamer.retryFailed().catch(showError);});
$('reset-settings').addEventListener('click',()=>{
 for(const [id,value,event]of [['view-distance','2000','change'],['detail-level','1','change'],['render-scale','auto','change'],['field-of-view','52','input'],['flight-speed','1','input'],['look-sensitivity','1','input'],['gpu-budget','4','change']]){$(id).value=value;$(id).dispatchEvent(new Event(event));}
 for(const [id,checked]of [['satellite-visible',true],['invert-look',false],['show-crosshair',true]]){$(id).checked=checked;$(id).dispatchEvent(new Event('change'));}
 if(mode==='player')streamer.setEnabled(true);
});
function syncSettings(coverage){
 const playing=mode==='player',speed=player?.flightMultiplier??preferences.speed;
 if(document.activeElement!==$('flight-speed'))$('flight-speed').value=String(speed);
 $('flight-speed-value').textContent=Number(speed.toFixed(2))+'× · '+Math.round(speed*8)+' m/s';
 for(const id of ['movement-fly','movement-walk','return-spawn','stream-pause','stream-retry'])$(id).disabled=!playing||walkingPreparation;
 $('movement-fly').setAttribute('aria-pressed',String(playing&&player.flying));$('movement-walk').setAttribute('aria-pressed',String(playing&&!player.flying));
 $('stream-pause').textContent=streamer.enabled?'Pause 3D':'Resume 3D';
 $('memory-usage').textContent=(coverage.gpuBytes/1048576).toFixed(0)+' MB of '+(streamer.maxGpuBytes/1024**3)+' GB tile budget · '+(coverage.cachePersistent?'Persistent cache':'Memory cache');
 $('settings-status').textContent=!playing?'3D starts in flight mode':!streamer.enabled?'3D streaming paused':coverage.complete?'Current view ready':'Refining current view';
}
$('north').addEventListener('click',()=>{if(mode==='player'){yaw=0;applyPlayerCamera();}else{camera.up.set(0,0,1);controls.update();}});
function zoomGlobe(factor){if(mode!=='globe')return;const radius=streamer.planet?.radius??6371010,height=Math.max(40,camera.position.length()-radius);camera.position.normalize().multiplyScalar(radius+Math.max(40,height*factor));controls.update();}
$('zoom-in').addEventListener('click',()=>zoomGlobe(.55));$('zoom-out').addEventListener('click',()=>zoomGlobe(1.8));
renderer.domElement.addEventListener('dblclick',event=>{if(mode!=='globe')return;const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(event.clientX/innerWidth*2-1,1-event.clientY/innerHeight*2),camera);const hit=ray.intersectObject(globe)[0];if(hit){const geo=ecefToGeo(hit.point);enterAt(geo.latitude,geo.longitude);}});
document.addEventListener('pointerlockchange',()=>{locked=document.pointerLockElement===renderer.domElement;input.reset();document.body.classList.toggle('playing',locked);clock.getDelta();});
document.addEventListener('mousemove',event=>{if(locked&&mode==='player'){yaw-=event.movementX*.0021*preferences.sensitivity;pitch=THREE.MathUtils.clamp(pitch-event.movementY*.0021*preferences.sensitivity*(preferences.invert?-1:1),-Math.PI/2+.02,Math.PI/2-.02);}});
document.addEventListener('keydown',event=>{
 if(event.code==='Escape'){document.exitPointerLock();setSettingsOpen(false);return;}if(!locked||mode!=='player')return;
 if(['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight','KeyG','KeyR'].includes(event.code))event.preventDefault();input.down(event.code,performance.now(),event.repeat);
 if(event.code==='Space'&&!event.repeat&&player.space(performance.now())){if(!player.flying){player.flying=true;startWalking();}else toast('Flight enabled · Space up · Shift down');}
 if(event.code==='KeyG'&&!event.repeat)globeView();if(event.code==='KeyR'&&!event.repeat){player.reset();world.dirty=true;}
});
document.addEventListener('keyup',event=>input.up(event.code));window.addEventListener('blur',()=>{input.reset();endGlobeDrag();});
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
function animate(){
 requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);
 if(mode==='globe'){
  // OrbitControls zooms relative to the planet centre. Scale by altitude so
  // one wheel step cannot jump from orbit straight through the HQ interval.
  const ratio=Math.max(.00001,Math.min(1,(camera.position.length()-(streamer.planet?.radius??6371010))/camera.position.length()));
  controls.zoomSpeed=ratio;controls.update();
 }
 if(mode==='player'){
  const feet=player.feet;applyPlayerCamera();if(!walkingPreparation)streamView(feet.clone().applyMatrix4(frame.toECEF));world.refresh(feet);
  const ahead=feet.clone().addScaledVector(player.velocity,dt);
  if(locked&&!walkingPreparation&&(player.flying||world.readyAt(ahead))){const maxSpeed=player.flying?Math.hypot(8*(input.keys.sprint?3:1),6)*player.flightMultiplier:10,steps=Math.max(1,Math.ceil(dt/(1/180)),Math.ceil(Math.max(maxSpeed,player.velocity.length())*dt/(player.radius*.75)));for(let i=0;i<steps;i++)player.step(dt/steps,input.keys,yaw);}
  else if(locked&&performance.now()-lastToast>5000){lastToast=performance.now();toast('Loading nearby ground…');}
  if(Math.hypot(player.feet.x,player.feet.z)>1500)rebase();applyPlayerCamera();
 }
 if(preferences.satellite&&(mode==='globe'||mode==='player'))satellite.update(camera);
 renderer.render(scene,camera);
 if(performance.now()-lastHud>250){lastHud=performance.now();
  if(mode==='player'){const feet=player.feet,ground=player.ground(feet.x,feet.z),radius=streamer.planet.radius;streamer.group.userData.atmosphere.groundRadius=ground?Math.max(radius,ground.applyMatrix4(frame.toECEF).length()):radius;}
  const c=streamer.getCoverage(),point=mode==='player'?player.feet.applyMatrix4(frame.toECEF):camera.position,geo=ecefToGeo(point);
  syncSettings(c);
  $('mode').textContent=walkingPreparation?'GROUND':mode==='player'?player.flying?'FLIGHT':input.keys.sprint?'SPRINT':'WALK':mode==='loading'?'LOADING':'GLOBE';
  $('speed').hidden=mode!=='player'||!player.flying;
  if(player)$('speed').textContent=Number(player.flightMultiplier.toFixed(2))+'× · '+Math.round(8*player.flightMultiplier*(input.keys.sprint?3:1))+' m/s';
  $('coordinates').textContent=geo.latitude.toFixed(5)+'° / '+geo.longitude.toFixed(5)+'°';
  $('coverage').textContent=mode==='globe'?'3D paused':c.readyLeaves+' / '+c.requiredLeaves+' 3D tiles'+(c.status==='discovering'?' · discovering area':c.complete?' · complete':' · streaming');
  const height=Math.max(0,geo.altitude),sat=satellite.status();
  $('altitude').textContent='Altitude '+(height>=10000?(height/1000).toLocaleString('en-US',{maximumFractionDigits:0})+' km':height.toLocaleString('en-US',{maximumFractionDigits:0})+' m');
  $('distance').textContent='View '+(visibility>=1000?(visibility/1000).toLocaleString('en-US')+' km':visibility+' m');
  $('cache').textContent=(c.receivedBytes/1048576).toFixed(1)+' MB · '+(c.memoryHits+c.diskHits)+' cache hits';
  $('persistent').textContent=c.cachePersistent?'Persistent cache active':'Memory cache active';$('credits').textContent=streamer.getAttribution();
  $('satellite-status').textContent=sat.pending?'Satellite: refining imagery':sat.visible?'Satellite: ready at current zoom':sat.error?'Satellite: temporarily unavailable':'Satellite: loading';
  $('terrain').setAttribute('aria-pressed',String(mode!=='globe'));$('globe').setAttribute('aria-pressed',String(mode==='globe'));$('zoom-in').disabled=$('zoom-out').disabled=mode!=='globe';
  $('status-title').textContent=mode==='player'&&!streamer.enabled?'3D streaming paused':mode==='globe'||c.status==='waiting-altitude'?'Satellite view':c.complete?'View detail ready':mode==='loading'?'Preparing local ground':'Refining your view';
  $('layer-status').textContent=mode==='globe'?'Select Fly 3D to explore':c.status==='waiting-altitude'?'3D activates below '+activationAltitudeMeters+' m':'3D: maximum detail · automatic';
  $('quality').textContent=mode==='globe'?'Search a place, then select Fly 3D.':c.status==='waiting-altitude'?'Descend below '+activationAltitudeMeters+' m to stream 3D.':c.complete?'Visible tiles refined for this view.':'Centre of view first, then surrounding terrain.';
  $('progress-track').classList.toggle('busy',mode==='globe'?sat.pending>0:c.status==='discovering'||mode==='loading');
  $('progress-fill').style.width=mode==='globe'||c.status==='waiting-altitude'?'100%':c.requiredLeaves?Math.min(100,c.readyLeaves/c.requiredLeaves*100)+'%':'0%';
  $('hint').textContent=mode==='globe'?'Drag to rotate · scroll to zoom · double-click for 3D':locked?'W A S D move · scroll for speed · Space / Shift up / down · Esc release':'Click scene to fly · W A S D move · scroll for speed';
 }
}
animate();if(params.get('view')==='3d')enterAt(41.88931,12.49223);else{globeView();streamer.start().catch(showError);}
window.addEventListener('pagehide',()=>{satellite.dispose();world.dispose();streamer.dispose();});
if(qa)window.__earthDemo={streamer,satellite,renderer,scene,camera,controls,world,input,enterAt,globeView,state:()=>({mode,locked,busy:booting,error:error?.message??null,sprint:!!input.keys.sprint,visibility,flightMultiplier:player?.flightMultiplier??1,player:player?{feet:player.feet.toArray(),grounded:player.grounded,flying:player.flying,contacts:player.contactCount}:null}),look:(y,p=0)=>{yaw=y;pitch=p;},get player(){return player;},get frame(){return frame;},THREE};
