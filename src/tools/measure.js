// Results of the measuring tools, computed from geographic points {lat, lon, alt}.
import {distance,pathLength,polygonArea,bearing,interpolate,formatDistance,formatArea} from '../core/geodesy.js';
import {elevations} from './elevation.js';

export const TOOLS={
 distance:{label:'Distance',min:2,auto:0,hint:'Click points; finish to end the line.'},
 area:{label:'Area',min:3,auto:0,hint:'Click the corners; finish to close the polygon.'},
 height:{label:'Height',min:2,auto:2,hint:'Click the base, then the top (3D surface for buildings).'},
 profile:{label:'Profile',min:2,auto:0,hint:'Click a path; finish to compute the elevation profile.'},
 sight:{label:'Line of sight',min:2,auto:2,hint:'Click the observer, then the target.'},
 marker:{label:'Marker',min:1,auto:1,hint:'Click to place a marker.'},
};
export const EYE_HEIGHT=1.7;

export function distanceResult(points){const m=pathLength(points);return {meters:m,text:formatDistance(m)+(points.length>2?' · '+(points.length-1)+' segments':'')};}
export function areaResult(points){const a=polygonArea(points),p=pathLength([...points,points[0]]);return {squareMeters:a,perimeter:p,text:formatArea(a)+' · perimeter '+formatDistance(p)};}
export function heightResult([a,b]){
 const dz=(b.alt??0)-(a.alt??0),dh=distance(a,b),slope=dh>0.01?Math.atan2(Math.abs(dz),dh)*180/Math.PI:90;
 return {height:dz,horizontal:dh,slope,text:`Δh ${dz>=0?'+':'−'}${formatDistance(Math.abs(dz))} · ${formatDistance(dh)} horizontal · ${slope.toFixed(1)}°`};
}

// Samples along the path, spaced evenly in distance (at most `samples`).
export function samplePath(points,samples=96){
 const total=pathLength(points);if(!total)return [{...points[0],d:0}];const out=[],step=total/(samples-1);let seg=0,acc=0;
 for(let i=0;i<samples;i++){const d=Math.min(total,i*step);while(seg<points.length-2&&acc+distance(points[seg],points[seg+1])<d){acc+=distance(points[seg],points[seg+1]);seg++;}
  const L=distance(points[seg],points[seg+1])||1,p=interpolate(points[seg],points[seg+1],Math.min(1,(d-acc)/L));out.push({...p,d});}
 return out;
}

export async function profileResult(map,points,{signal}={}){
 const s=samplePath(points),e=await elevations(map,s,{signal}),pts=s.map((p,i)=>({d:p.d,lat:p.lat,lon:p.lon,alt:e[i].alt,source:e[i].source})).filter(p=>p.alt!=null);
 if(!pts.length)return {samples:[],text:'No elevation data'};
 let gain=0,loss=0;for(let i=1;i<pts.length;i++){const dz=pts[i].alt-pts[i-1].alt;if(dz>0)gain+=dz;else loss-=dz;}
 const alts=pts.map(p=>p.alt),min=Math.min(...alts),max=Math.max(...alts),src=[...new Set(pts.map(p=>p.source))].join('+');
 return {samples:pts,min,max,gain,loss,length:pathLength(points),source:src,text:`${formatDistance(pathLength(points))} · ${Math.round(min)}–${Math.round(max)} m · +${Math.round(gain)} / −${Math.round(loss)} m (${src})`};
}

// Line of sight from a (eye at +1.7 m) to b. Uses the loaded 3D surface when there is one,
// otherwise the terrain profile between the two points.
export async function sightResult(map,[a,b],{signal}={}){
 const eye={...a,alt:(a.alt??0)+EYE_HEIGHT},target={...b,alt:(b.alt??0)+.5},dist=distance(a,b);
 const s=map.sight(eye,target);
 if(s)return s.visible?{visible:true,distance:dist,source:'3d',text:'Visible · '+formatDistance(dist)+' (3D surface)'}:{visible:false,blockedAt:s.blockedAt,distance:dist,source:'3d',text:'Blocked at '+formatDistance(s.distance)+' of '+formatDistance(dist)+' (3D surface)'};
 const p=await profileResult(map,[a,b],{signal});if(!p.samples.length)return {visible:null,text:'No elevation data'};
 const h0=(p.samples[0].alt)+EYE_HEIGHT,h1=p.samples.at(-1).alt+.5,L=p.length||1;
 for(const q of p.samples.slice(1,-1)){const line=h0+(h1-h0)*q.d/L,curve=q.d*(L-q.d)/(2*6371008.8);if(q.alt+curve>line)return {visible:false,blockedAt:q,distance:dist,source:'terrain',text:'Blocked at '+formatDistance(q.d)+' of '+formatDistance(dist)+' (terrain)'};}
 return {visible:true,distance:dist,source:'terrain',text:'Visible · '+formatDistance(dist)+' (terrain)'};
}
export {bearing};
