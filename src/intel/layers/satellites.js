// Satellites from CelesTrak GP data (CORS open, no key), positioned with SGP4 (satellite.js).
// https://celestrak.org/NORAD/documentation/gp-data-formats.php
//
// Positions are propagated in time slices: each frame advances at most `budgetMs` of work through the
// list, so even the 11k "active" group refreshes about once per second without dropping frames.
import {json2satrec,propagate,gstime,eciToGeodetic,degreesLat,degreesLong} from 'satellite.js';
import {defineLayer} from '../layer.js';
import {cachedJson} from '../feedcache.js';
// CelesTrak allows one download per group every 2 hours; elements stay usable for days.
const MIN_AGE=2*3600e3,MAX_AGE=3*86400e3; // large groups are several MB and CelesTrak can be slow: 2 min limit

export const SAT_GROUPS={stations:'Space stations',visual:'100 brightest',active:'All active',starlink:'Starlink',oneweb:'OneWeb','gps-ops':'GPS',galileo:'Galileo',
 'glo-ops':'GLONASS',beidou:'BeiDou',weather:'Weather',resource:'Earth observation',sarsat:'Search and rescue',geo:'Geostationary',science:'Science',military:'Military'};
const ORBIT=a=>a<2000e3?'LEO':a<35000e3?'MEO':'GEO';

// Geodetic position of a satrec at a date, or null when SGP4 fails (decayed / bad elements).
export function position(satrec,date){
 const pv=propagate(satrec,date);if(!pv?.position||typeof pv.position==='boolean')return null;
 const g=eciToGeodetic(pv.position,gstime(date)),v=pv.velocity;
 return {lat:degreesLat(g.latitude),lon:degreesLong(g.longitude),alt:g.height*1000,speed:v?Math.hypot(v.x,v.y,v.z)*1000:null};
}

export const satellites=defineLayer({
 id:'satellites',label:'Satellites',group:'Space',source:'CelesTrak',scope:'global',refreshMs:6*3600e3,display:{dense:'dots',clusterAbove:600,labelZoom:6},
 options:{group:'stations',budgetMs:3},
 schema:[{key:'group',label:'Group',type:'select',options:Object.entries(SAT_GROUPS)}],
 async load({signal,options}){
  const {data:list,fetchedAt}=await cachedJson(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(options.group)}&FORMAT=json`,{minAgeMs:MIN_AGE,maxAgeMs:MAX_AGE,signal,timeoutMs:120000});
  const now=new Date(),out=[];
  for(const gp of Array.isArray(list)?list:[]){let satrec;try{satrec=json2satrec(gp);}catch{continue;}const p=position(satrec,now);if(!p)continue;
   out.push({id:String(gp.NORAD_CAT_ID),fetchedAt,name:gp.OBJECT_NAME,intl:gp.OBJECT_ID,epoch:gp.EPOCH,satrec,periodMin:1440/gp.MEAN_MOTION,inclination:gp.INCLINATION,...p});}
  return out;
 },
 // Time-sliced propagation: continue where the previous frame stopped.
 tick(now,features){
  if(!features.length)return false;const s=this._slice??={i:0},end=performance.now()+(this.options.budgetMs??3),date=new Date();let moved=false;
  while(performance.now()<end){const f=features[s.i%features.length];s.i++;const p=position(f.satrec,date);if(p){f.lat=p.lat;f.lon=p.lon;f.alt=p.alt;f.speed=p.speed;moved=true;}if(s.i%features.length===0)break;}
  return moved;
 },
 // Ground track for the selected satellite: one orbit centred on now, one point per minute.
 track(f){const t=Date.now(),half=Math.min(100,f.periodMin/2),pts=[];for(let m=-half;m<=half;m++){const p=position(f.satrec,new Date(t+m*60000));if(p)pts.push(p);}return pts;},
 dotColor:f=>f.alt<2000e3?'#64d2ff':f.alt<35000e3?'#bf5af2':'#ff9f0a',
 style(f){return {shape:'sat',color:this.dotColor(f),size:8};},
 title:f=>f.name,
 details:f=>[['Name',f.name],['NORAD',f.id],['International',f.intl],['Altitude',(f.alt/1000).toFixed(0)+' km ('+ORBIT(f.alt)+')'],['Speed',f.speed?(f.speed/1000).toFixed(2)+' km/s':'—'],['Period',f.periodMin.toFixed(1)+' min'],['Inclination',f.inclination.toFixed(2)+'°'],['Elements epoch',String(f.epoch).replace('T',' ').slice(0,19)+' UTC'],['Downloaded',new Date(f.fetchedAt).toISOString().replace('T',' ').slice(0,16)+' UTC'],['Source',{href:`https://celestrak.org/satcat/table-satcat.php?CATNR=${f.id}`,text:'CelesTrak SATCAT'}]],
});
