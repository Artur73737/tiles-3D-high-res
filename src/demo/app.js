import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {EarthHQStreaming,SatelliteLayer,geoToECEF,ecefToGeo,localFrame} from '../index.js';
import {Explorer} from './Player.js';
import {PlayerWorld} from './PlayerWorld.js';
import {SprintInput} from './SprintInput.js';
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search),qa=location.hash==='#qa';
const requestedDistance=Number(params.get('visibility')??params.get('radius'));
const visibility=Number.isFinite(requestedDistance)&&requestedDistance>0?requestedDistance:2000;
const requestedAltitude=Number(params.get('hqAltitude'));
const activationAltitudeMeters=Number.isFinite(requestedAltitude)&&requestedAltitude>0?requestedAltitude:2500;
const renderer=new THREE.WebGLRenderer({antialias:true,logarithmicDepthBuffer:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.7));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;$('viewport').appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0xbacfdc);
const camera=new THREE.PerspectiveCamera(52,innerWidth/innerHeight,.1,150000000);camera.up.set(0,0,1);
camera.position.copy(geoToECEF(41.88931,12.49223)).multiplyScalar(2.6);camera.lookAt(0,0,0);
const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=6371050;controls.maxDistance=6371010*8;
controls.enablePan=false;
const globeMaterial=new THREE.MeshBasicMaterial({color:0x142d3c});
const globe=new THREE.Mesh(new THREE.SphereGeometry(6370890,128,96),globeMaterial);globe.rotation.x=Math.PI/2;scene.add(globe);
globe.renderOrder=-2000;
const satellite=new SatelliteLayer({renderer,radius:6370890});scene.add(satellite.group);
const streamer=new EarthHQStreaming({renderer,radiusMeters:visibility,retainRadiusMeters:visibility*1.15,activationAltitudeMeters,previewRadiusMeters:120,maxGpuBytes:4*1024**3,cacheBytes:1024**3,cacheName:qa?'earth-hq-demo-test-v1':'earth-hq-cache-v1'});scene.add(streamer.group);
const world=new PlayerWorld(streamer),input=new SprintInput(),clock=new THREE.Clock();
let player=null,frame=null,mode='loading',locked=false,yaw=0,pitch=.08,navToken=0,lastHud=0,lastToast=0,error=null,booting=false;
function toast(text){$('toast').textContent=text;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),2800);}
function showError(e){if(e.name==='AbortError')return;error=e;$('error').textContent=e.message;$('error').hidden=false;}
streamer.addEventListener('error',({error})=>showError(error));streamer.addEventListener('warning',({error})=>toast(error.message));
function applyPlayerCamera(){if(!frame||!player)return;camera.position.copy(player.eye).applyMatrix4(frame.toECEF);const rotation=new THREE.Quaternion().setFromRotationMatrix(frame.toECEF),look=new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch,yaw,0,'YXZ'));camera.quaternion.copy(rotation.multiply(look));camera.up.copy(frame.up);}
function streamView(focus){
 const normal=focus.clone().normalize();
 const direction=mode==='player'?new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw)).transformDirection(frame.toECEF):camera.getWorldDirection(new THREE.Vector3());
 direction.addScaledVector(normal,-direction.dot(normal));
 const halfAngle=Math.min(Math.PI,Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect)+THREE.MathUtils.degToRad(10));
 streamer.update(camera,{focusECEF:focus,radiusMeters:visibility,viewDirectionECEF:direction.lengthSq()>1e-10?direction:null,viewHalfAngle:halfAngle,nearRadiusMeters:Math.min(60,visibility)});
}
async function enterAt(latitude,longitude){
 if(!Number.isFinite(latitude)||latitude< -90||latitude>90||!Number.isFinite(longitude))throw Error('Coordinate non valide.');
 longitude=((longitude+180)%360+360)%360-180;const token=++navToken;mode='loading';booting=true;error=null;input.reset();document.exitPointerLock();controls.enabled=false;$('error').hidden=true;$('lat').value=latitude.toFixed(6);$('lon').value=longitude.toFixed(6);
 streamer.group.visible=true;
 const planet=await streamer.start();if(token!==navToken)return;
 frame=localFrame(latitude,longitude,planet.radius);const target=geoToECEF(latitude,longitude,0,planet.radius);
 camera.position.copy(target).addScaledVector(frame.up,100).addScaledVector(frame.south,70);camera.up.copy(frame.up);camera.lookAt(target);
 // Local ground first; distant HQ tiles never gate the landing.
 const coverage=await streamer.requestRegion({latitude,longitude,radiusMeters:Math.min(50,visibility)});if(token!==navToken)return;
 if(!coverage.complete)throw Error('Superficie locale incompleta: '+coverage.missingLeaves+' tile mancanti, '+coverage.unknownBranches+' rami irrisolti.');
 if(!coverage.requiredLeaves)throw Error('Il servizio non dichiara tile 3D disponibili in questo punto.');
 world.setFrame(frame);world.refresh(new THREE.Vector3(),{all:true});
 player=new Explorer(world,{min:[-Infinity,-10000,-Infinity],max:[Infinity,10000,Infinity]});player.findSpawn();player.place(player.spawn.clone().add(new THREE.Vector3(0,80,0)));player.flying=true;player.grounded=false;yaw=0;pitch=-.18;mode='player';booting=false;scene.background=new THREE.Color(0xbacfdc);applyPlayerCamera();streamView(player.feet.applyMatrix4(frame.toECEF));
}
function globeView(){navToken++;booting=false;mode='globe';streamer.group.visible=false;streamer.setEnabled(false);input.reset();document.exitPointerLock();scene.background=new THREE.Color(0x070f1d);const direction=frame?frame.up:camera.position.clone().normalize();camera.position.copy(direction).multiplyScalar((streamer.planet?.radius??6371010)*2.6);camera.up.set(0,0,1);camera.lookAt(0,0,0);controls.target.set(0,0,0);controls.enabled=true;controls.update();}
function rebase(){
 const feetECEF=player.feet.applyMatrix4(frame.toECEF),location=ecefToGeo(feetECEF,streamer.planet.radius),newFrame=localFrame(location.latitude,location.longitude,streamer.planet.radius);
 const rotation=new THREE.Quaternion().setFromRotationMatrix(newFrame.toECEF).invert().multiply(camera.quaternion),angles=new THREE.Euler().setFromQuaternion(rotation,'YXZ');yaw=angles.y;pitch=angles.x;
 const safeECEF=player.safe.clone().applyMatrix4(frame.toECEF),spawnECEF=player.spawn.clone().applyMatrix4(frame.toECEF);frame=newFrame;world.setFrame(frame);player.place(feetECEF.applyMatrix4(frame.fromECEF));player.safe.copy(safeECEF.applyMatrix4(frame.fromECEF));player.spawn.copy(spawnECEF.applyMatrix4(frame.fromECEF));world.refresh(player.feet,{all:true});
}
renderer.domElement.addEventListener('click',async()=>{if(mode==='player')try{await renderer.domElement.requestPointerLock();}catch(e){showError(e);}});
function coordinateChange(){if($('lat').value===''||$('lon').value==='')return;const lat=Number($('lat').value),lon=Number($('lon').value);if(!Number.isFinite(lat)||Math.abs(lat)>90||!Number.isFinite(lon)){showError(Error('Coordinate non valide.'));return;}if(mode==='globe'){const radius=streamer.planet?.radius??6371010,height=Math.max(40,camera.position.length()-radius);camera.position.copy(geoToECEF(lat,lon,height,radius));camera.lookAt(0,0,0);controls.update();}else enterAt(lat,lon).catch(e=>{booting=false;showError(e);});}
$('lat').addEventListener('change',coordinateChange);$('lon').addEventListener('change',coordinateChange);$('globe').addEventListener('click',globeView);
$('terrain').addEventListener('click',()=>{if(mode==='globe'){const geo=ecefToGeo(camera.position);enterAt(geo.latitude,geo.longitude).catch(e=>{booting=false;showError(e);});}});
$('home').addEventListener('click',()=>enterAt(41.88931,12.49223).catch(e=>{booting=false;showError(e);}));
$('help').addEventListener('click',()=>{document.exitPointerLock();$('help-dialog').showModal();});
let panelCustomized=false;
function fitPanel(){if(!panelCustomized){const hidden=innerWidth<=620;document.body.classList.toggle('hide-panel',hidden);$('panel-toggle').setAttribute('aria-expanded',String(!hidden));}}
fitPanel();
$('panel-toggle').addEventListener('click',()=>{panelCustomized=true;const hidden=document.body.classList.toggle('hide-panel');$('panel-toggle').setAttribute('aria-expanded',String(!hidden));});
$('north').addEventListener('click',()=>{if(mode==='player'){yaw=0;applyPlayerCamera();}else{camera.up.set(0,0,1);controls.update();}});
function zoomGlobe(factor){if(mode!=='globe')return;const radius=streamer.planet?.radius??6371010,height=Math.max(40,camera.position.length()-radius);camera.position.normalize().multiplyScalar(radius+Math.max(40,height*factor));controls.update();}
$('zoom-in').addEventListener('click',()=>zoomGlobe(.55));$('zoom-out').addEventListener('click',()=>zoomGlobe(1.8));
renderer.domElement.addEventListener('dblclick',event=>{if(mode!=='globe')return;const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2(event.clientX/innerWidth*2-1,1-event.clientY/innerHeight*2),camera);const hit=ray.intersectObject(globe)[0];if(hit){const geo=ecefToGeo(hit.point);enterAt(geo.latitude,geo.longitude).catch(e=>{booting=false;showError(e);});}});
document.addEventListener('pointerlockchange',()=>{locked=document.pointerLockElement===renderer.domElement;input.reset();document.body.classList.toggle('playing',locked);clock.getDelta();});
document.addEventListener('mousemove',event=>{if(locked&&mode==='player'){yaw-=event.movementX*.0021;pitch=THREE.MathUtils.clamp(pitch-event.movementY*.0021,-Math.PI/2+.02,Math.PI/2-.02);}});
document.addEventListener('keydown',event=>{
 if(event.code==='Escape'){document.exitPointerLock();return;}if(!locked||mode!=='player')return;
 if(['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight','KeyG','KeyR'].includes(event.code))event.preventDefault();input.down(event.code,performance.now(),event.repeat);
 if(event.code==='Space'&&!event.repeat&&player.space(performance.now()))toast(player.flying?'Volo attivo · Space ↑ · Shift ↓':'Cammino attivo');
 if(event.code==='KeyG'&&!event.repeat)globeView();if(event.code==='KeyR'&&!event.repeat){player.reset();world.dirty=true;}
});
document.addEventListener('keyup',event=>input.up(event.code));window.addEventListener('blur',()=>input.reset());
window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);fitPanel();});
function animate(){
 requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);
 if(mode==='globe'){
  // OrbitControls zooms relative to the planet centre. Scale by altitude so
  // one wheel step cannot jump from orbit straight through the HQ interval.
  const ratio=Math.max(.00001,Math.min(1,(camera.position.length()-(streamer.planet?.radius??6371010))/camera.position.length()));
  controls.zoomSpeed=ratio;controls.rotateSpeed=ratio;controls.update();
 }
 if(mode==='player'){
  const feet=player.feet;applyPlayerCamera();streamView(feet.clone().applyMatrix4(frame.toECEF));world.refresh(feet);
  const ahead=feet.clone().addScaledVector(player.velocity,dt);
  if(locked&&world.readyAt(ahead)){const steps=Math.max(1,Math.ceil(dt/(1/180)));for(let i=0;i<steps;i++)player.step(dt/steps,input.keys,yaw);}
  else if(locked&&performance.now()-lastToast>5000){lastToast=performance.now();toast('Caricamento della superficie locale…');}
  if(Math.hypot(player.feet.x,player.feet.z)>1500)rebase();applyPlayerCamera();
 }
 if(mode==='globe'||mode==='player')satellite.update(camera);
 renderer.render(scene,camera);
 if(performance.now()-lastHud>250){lastHud=performance.now();const c=streamer.getCoverage(),point=mode==='player'?player.feet.applyMatrix4(frame.toECEF):camera.position,geo=ecefToGeo(point);
  $('mode').textContent=mode==='player'?player.flying?'VOLO':input.keys.sprint?'CORSA':'CAMMINO':mode==='loading'?'SUPERFICIE IN ARRIVO':'GLOBO';$('coordinates').textContent=geo.latitude.toFixed(5)+'° / '+geo.longitude.toFixed(5)+'°';
  $('coverage').textContent=mode==='globe'?'3D in pausa · attiva Esplora 3D':c.status==='waiting-altitude'?'HQ in attesa · avvicinati sotto '+(activationAltitudeMeters/1000).toLocaleString('it-IT')+' km':c.readyLeaves+' / '+c.requiredLeaves+' tile HQ'+(c.status==='discovering'?' · aggiornamento area':c.complete?' · complete':' · streaming')+(c.previewTiles?' · '+c.previewTiles+' anteprime 3D':'');
  const height=Math.max(0,geo.altitude),sat=satellite.status();
  $('altitude').textContent='Quota '+(height>=10000?(height/1000).toLocaleString('it-IT',{maximumFractionDigits:0})+' km':height.toLocaleString('it-IT',{maximumFractionDigits:0})+' m');
  $('distance').textContent='Vista '+(visibility>=1000?(visibility/1000).toLocaleString('it-IT')+' km':visibility+' m');$('cache').textContent=(c.receivedBytes/1048576).toFixed(2)+' MB · '+(c.memoryHits+c.diskHits)+' riusi cache';$('persistent').textContent=c.cachePersistent?'Cache persistente attiva':'Cache in memoria';$('credits').textContent=streamer.getAttribution();
  $('satellite-credits').textContent=satellite.credits;$('satellite-status').textContent=sat.pending?'Aggiornamento del dettaglio…':sat.visible?'Immagini aggiornate allo zoom':sat.error?'Immagini temporaneamente non disponibili':'Caricamento immagini…';
  $('terrain').setAttribute('aria-pressed',String(mode!=='globe'));$('globe').setAttribute('aria-pressed',String(mode==='globe'));$('zoom-in').disabled=$('zoom-out').disabled=mode!=='globe';
  $('place-name').textContent=Math.abs(geo.latitude-41.88931)<.02&&Math.abs(geo.longitude-12.49223)<.02?'Roma · Colosseo':'Posizione esplorata';
  $('status-title').textContent=mode==='globe'||c.status==='waiting-altitude'?'Vista satellitare':c.complete?'Dettaglio 3D pronto':mode==='loading'?'Preparazione della superficie':'Raffinamento del paesaggio';
  $('layer-status').textContent=mode==='globe'?'Attiva Esplora 3D per volare':c.status==='waiting-altitude'?'Si attiva avvicinandoti':'Massimo dettaglio · automatico';
  $('quality').textContent=mode==='globe'?'Scegli Esplora 3D per volare sulla superficie.':c.status==='waiting-altitude'?'Avvicinati sotto '+(activationAltitudeMeters/1000).toLocaleString('it-IT')+' km per il 3D.':c.complete?'Area richiesta caricata al massimo dettaglio.':c.previewTiles?'Panorama visibile · dettaglio massimo in arrivo.':'Caricamento del terreno vicino alla camera.';
  $('progress-track').classList.toggle('busy',mode==='globe'?sat.pending>0:c.status==='discovering'||mode==='loading');$('progress-fill').style.width=mode==='globe'||c.status==='waiting-altitude'?'100%':c.requiredLeaves?Math.min(100,c.readyLeaves/c.requiredLeaves*100)+'%':'0%';
  $('hint').innerHTML=mode==='globe'?'Trascina per ruotare · rotella per zoomare<br>Doppio clic su un punto per esplorarlo in 3D':locked?'<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Muoviti &nbsp; <kbd>Esc</kbd> Libera il mouse<br>Doppio <kbd>Spazio</kbd> Volo &nbsp; <kbd>G</kbd> Globo':'Clicca sulla scena per iniziare a muoverti.<br><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> + mouse · doppio <kbd>Spazio</kbd> per volare';
 }
}
animate();if(params.get('view')==='3d')enterAt(41.88931,12.49223).catch(e=>{booting=false;showError(e);});else{globeView();streamer.start().catch(showError);}
window.addEventListener('pagehide',()=>{satellite.dispose();world.dispose();streamer.dispose();});
if(qa)window.__earthDemo={streamer,satellite,renderer,scene,camera,controls,world,input,enterAt,globeView,state:()=>({mode,locked,busy:booting,error:error?.message??null,sprint:!!input.keys.sprint,visibility,player:player?{feet:player.feet.toArray(),grounded:player.grounded,flying:player.flying,contacts:player.contactCount}:null}),look:(y,p=0)=>{yaw=y;pitch=p;},get player(){return player;},get frame(){return frame;},THREE};
