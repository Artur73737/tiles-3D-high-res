// NASA EONET natural events: wildfires, volcanoes, severe storms, floods, ice... (CORS open, no key).
// https://eonet.gsfc.nasa.gov/docs/v3
import {defineLayer,fetchJson} from '../layer.js';

export const EVENT_CATEGORIES={wildfires:['Wildfires','#ff6b35'],volcanoes:['Volcanoes','#ff2d55'],severeStorms:['Severe storms','#5e9cff'],floods:['Floods','#30b0c7'],
 seaLakeIce:['Sea and lake ice','#a8e6ff'],earthquakes:['Earthquakes','#ffd60a'],landslides:['Landslides','#c69c6d'],dustHaze:['Dust and haze','#d4b483'],drought:['Drought','#e0a040'],
 manmade:['Manmade','#bf5af2'],snow:['Snow','#ffffff'],tempExtremes:['Temperature extremes','#ff9f0a'],waterColor:['Water color','#64d2ff']};

export const events=defineLayer({
 id:'events',label:'Natural events',group:'Hazards',source:'NASA EONET',scope:'global',refreshMs:600000,
 options:{days:30,categories:['wildfires','volcanoes','severeStorms','floods']},
 schema:[{key:'days',label:'Last days',type:'number',min:1,max:365,step:1},
  {key:'categories',label:'Categories',type:'checks',wide:true,options:Object.entries(EVENT_CATEGORIES).map(([k,[l]])=>[k,l])}],
 async load({signal,options}){
  const cats=options.categories?.length?'&category='+options.categories.join(','):'';
  const j=await fetchJson(`https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=${options.days}${cats}`,{signal});
  const out=[];
  for(const e of j.events??[]){
   // The latest point geometry is the current position (storm tracks have many).
   const g=[...(e.geometry??[])].reverse().find(x=>x.type==='Point');if(!g)continue;const [lon,lat]=g.coordinates,cat=e.categories?.[0]?.id??'';
   out.push({id:e.id,lat,lon,alt:0,title:e.title,category:cat,time:Date.parse(g.date),magnitude:g.magnitudeValue!=null?g.magnitudeValue+' '+(g.magnitudeUnit??''):null,track:(e.geometry??[]).filter(x=>x.type==='Point').map(x=>({lat:x.coordinates[1],lon:x.coordinates[0]})),url:e.sources?.[0]?.url??e.link});
  }
  return out;
 },
 style:f=>({shape:'diamond',color:EVENT_CATEGORIES[f.category]?.[1]??'#ffffff',size:11}),
 title:f=>f.title,
 details:f=>[['Event',f.title],['Category',EVENT_CATEGORIES[f.category]?.[0]??f.category],['Updated',new Date(f.time).toISOString().slice(0,10)],['Magnitude',f.magnitude??'—'],['Track points',String(f.track.length)],['Source',{href:f.url,text:'Source report'}]],
});
