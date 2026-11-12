// Ground elevation for the measuring tools.
// 1. The loaded Google 3D surface (vertical ray on the meshes in view): buildings included, exact.
// 2. Otherwise the Open-Meteo terrain model (Copernicus DEM, ~90 m, bare ground), requested in
//    batches of up to 100 points and cached per ~1 m cell.
// Each sample says which source it came from.
import {fetchJson} from '../intel/layer.js';

const BATCH=100,cache=new Map();
const key=p=>p.lat.toFixed(5)+','+p.lon.toFixed(5);

export async function terrainElevation(points,{signal}={}){
 const out=new Array(points.length),missing=[];
 points.forEach((p,i)=>{const v=cache.get(key(p));if(v!=null)out[i]=v;else missing.push(i);});
 for(let s=0;s<missing.length;s+=BATCH){
  const idx=missing.slice(s,s+BATCH),lat=idx.map(i=>points[i].lat.toFixed(5)).join(','),lon=idx.map(i=>points[i].lon.toFixed(5)).join(',');
  const j=await fetchJson(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`,{signal});
  idx.forEach((i,k)=>{const v=j.elevation?.[k];if(Number.isFinite(v)){out[i]=v;cache.set(key(points[i]),v);while(cache.size>20000)cache.delete(cache.keys().next().value);}});
 }
 return out;
}

// [{alt, source:'3d'|'terrain'|null}] for each point.
export async function elevations(map,points,{signal}={}){
 const surface=points.map(p=>map.surfaceAt(p.lat,p.lon)),need=points.filter((p,i)=>surface[i]==null),terrain=need.length?await terrainElevation(need,{signal}):[];
 let k=0;return points.map((p,i)=>surface[i]!=null?{alt:surface[i],source:'3d'}:(v=>({alt:v??null,source:v!=null?'terrain':null}))(terrain[k++]));
}
