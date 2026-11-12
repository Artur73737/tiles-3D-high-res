// USGS earthquakes (GeoJSON summary feeds, CORS open, no key).
// https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php
import {defineLayer,fetchJson} from '../layer.js';

const FEED='https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/';
export const QUAKE_PERIODS=['hour','day','week','month'];
export const QUAKE_LEVELS=['significant','4.5','2.5','1.0','all'];

// Colour by age: last hour red, last day orange, older yellow.
const ageColor=ms=>{const h=(Date.now()-ms)/3.6e6;return h<1?'#ff3b30':h<24?'#ff9500':'#ffd60a';};

export const earthquakes=defineLayer({
 id:'earthquakes',label:'Earthquakes',group:'Hazards',source:'USGS',scope:'global',refreshMs:60000,
 options:{period:'day',level:'2.5'},
 schema:[{key:'period',label:'Period',type:'select',options:QUAKE_PERIODS.map(p=>[p,'Past '+p])},
  {key:'level',label:'Magnitude',type:'select',options:QUAKE_LEVELS.map(l=>[l,l==='significant'?'Significant':l==='all'?'All':'M'+l+'+'])}],
 async load({signal,options}){
  const j=await fetchJson(`${FEED}${options.level}_${options.period}.geojson`,{signal});
  return (j.features??[]).filter(f=>f.geometry?.coordinates?.length>=2).map(f=>{const [lon,lat,depth]=f.geometry.coordinates,p=f.properties??{};
   return {id:f.id,lat,lon,alt:0,mag:p.mag??null,depthKm:depth??null,place:p.place??'',time:p.time,url:p.url,tsunami:!!p.tsunami,alert:p.alert??null};});
 },
 style:f=>({shape:'ring',color:ageColor(f.time),size:4+Math.max(0,(f.mag??1))*2.6}),
 title:f=>(f.mag!=null?'M'+f.mag.toFixed(1)+' ':'')+f.place,
 details:f=>[['Magnitude',f.mag?.toFixed(1)??'—'],['Depth',f.depthKm!=null?f.depthKm.toFixed(1)+' km':'—'],['Place',f.place],['Time',new Date(f.time).toISOString().replace('T',' ').slice(0,19)+' UTC'],['Tsunami',f.tsunami?'yes':'no'],['Alert',f.alert??'—'],['Source',{href:f.url,text:'USGS event page'}]],
});
