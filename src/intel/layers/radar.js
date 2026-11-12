// Precipitation radar from RainViewer (tiles CORS open, no key). Raster overlay on the flat 2D map.
// https://www.rainviewer.com/api.html
//
// Tile level follows the map zoom, capped at z7 (the finest RainViewer serves). Tiles load in small
// batches (at most `maxLoads` at once, nearest to the centre first) and stay in a bounded cache.
import {defineLayer,fetchJson} from '../layer.js';

export const RADAR_COLORS={2:'Universal blue',4:'The Weather Channel',6:'NEXRAD level III',7:'Rainbow',8:'Dark sky',1:'Original'};
const MAX_Z=7,CACHE=256;

export function createRadar(){
 const cache=new Map();let loads=0,host='',frame=null,dirty=null;
 const url=(z,x,y,o)=>`${host}${frame.path}/256/${z}/${x}/${y}/${o.color}/${o.smooth?1:0}_${o.snow?1:0}.png`;
 function image(key,src,maxLoads){
  let e=cache.get(key);if(e){cache.delete(key);cache.set(key,e);return e.ready?e.img:null;}
  if(loads>=maxLoads)return null;loads++;
  const img=new Image();img.crossOrigin='anonymous';e={img,ready:false};cache.set(key,e);
  img.onload=()=>{e.ready=true;loads--;dirty?.();};img.onerror=()=>{loads--;cache.delete(key);};img.src=src;
  while(cache.size>CACHE)cache.delete(cache.keys().next().value);
  return null;
 }
 return defineLayer({
  id:'radar',label:'Weather radar',group:'Weather',source:'RainViewer',kind:'raster',scope:'global',refreshMs:300000,views:['flat2d'],
  options:{opacity:.65,color:2,smooth:true,snow:true,maxLoads:6},
  schema:[{key:'opacity',label:'Opacity',type:'number',min:.1,max:1,step:.05},{key:'color',label:'Colours',type:'select',options:Object.entries(RADAR_COLORS).map(([k,l])=>[Number(k),l])},
   {key:'smooth',label:'Smooth',type:'bool',text:'Smoothed radar'},{key:'snow',label:'Snow',type:'bool',text:'Show snow'}],
  hint:'Radar is drawn on the flat 2D map.',
  async load({signal}){const j=await fetchJson('https://api.rainviewer.com/public/weather-maps.json',{signal});host=j.host;frame=j.radar?.past?.at(-1)??null;cache.clear();return frame?[{id:'frame',lat:0,lon:0,alt:0,time:frame.time*1000}]:[];},
  // Draws the radar under the point layers. ctx is in CSS pixels; map is the map view.
  draw(ctx,map,{onDirty}){
   dirty=onDirty;if(!frame||map.kind()!=='flat2d')return;
   const o=this.options,{w,h}=map.size(),v=map.viewport(),z=Math.max(0,Math.min(MAX_Z,Math.floor(v.zoom))),n=2**z,tl=map.project(v.north,v.west),scale=2**(v.zoom-z)*256;
   const c=map.project(v.center.lat,v.center.lon),cx=(c.x-tl.x)/scale,cy=(c.y-tl.y)/scale;
   const tx0=Math.floor((v.west+180)/360*n),tilesX=Math.ceil(w/scale)+2,tilesY=Math.ceil(h/scale)+2;
   const merc=lat=>{const s=Math.sin(lat*Math.PI/180);return (.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n;},ty0=Math.floor(merc(Math.min(85.05,v.north)));
   const ox=tl.x-((v.west+180)/360*n-tx0)*scale,oy=tl.y-(merc(Math.min(85.05,v.north))-ty0)*scale,list=[];
   for(let j=0;j<tilesY;j++)for(let i=0;i<tilesX;i++){const ty=ty0+j;if(ty<0||ty>=n)continue;const tx=((tx0+i)%n+n)%n;list.push([Math.hypot(i-cx,j-cy),i,j,tx,ty]);}
   list.sort((a,b)=>a[0]-b[0]);ctx.save();ctx.globalAlpha=o.opacity;ctx.imageSmoothingEnabled=true;
   for(const [,i,j,tx,ty]of list){const img=image(`${frame.path}/${z}/${tx}/${ty}/${o.color}${o.smooth}${o.snow}`,url(z,tx,ty,o),o.maxLoads);if(img)ctx.drawImage(img,Math.round(ox+i*scale),Math.round(oy+j*scale),Math.ceil(scale),Math.ceil(scale));}
   ctx.restore();
  },
  title:()=>'',details:f=>[['Frame',new Date(f.time).toISOString().replace('T',' ').slice(0,16)+' UTC'],['Source',{href:'https://www.rainviewer.com',text:'RainViewer'}]],
 });
}
