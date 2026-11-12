// Spherical-earth geodesy for overlays and measuring tools (mean radius; good to ~0.3%).
export const EARTH_RADIUS=6371008.8;
const D=Math.PI/180;

// Great-circle distance in metres.
export function distance(a,b){
 const dLat=(b.lat-a.lat)*D,dLon=(b.lon-a.lon)*D,s=Math.sin(dLat/2)**2+Math.cos(a.lat*D)*Math.cos(b.lat*D)*Math.sin(dLon/2)**2;
 return 2*EARTH_RADIUS*Math.asin(Math.min(1,Math.sqrt(s)));
}
// Initial bearing from a to b, degrees clockwise from north.
export function bearing(a,b){
 const y=Math.sin((b.lon-a.lon)*D)*Math.cos(b.lat*D),x=Math.cos(a.lat*D)*Math.sin(b.lat*D)-Math.sin(a.lat*D)*Math.cos(b.lat*D)*Math.cos((b.lon-a.lon)*D);
 return (Math.atan2(y,x)/D+360)%360;
}
// Point at fraction t along the great circle a -> b.
export function interpolate(a,b,t){
 const d=distance(a,b)/EARTH_RADIUS;if(d<1e-12)return {lat:a.lat,lon:a.lon};
 const A=Math.sin((1-t)*d)/Math.sin(d),B=Math.sin(t*d)/Math.sin(d),la=a.lat*D,lo=a.lon*D,lb=b.lat*D,ob=b.lon*D;
 const x=A*Math.cos(la)*Math.cos(lo)+B*Math.cos(lb)*Math.cos(ob),y=A*Math.cos(la)*Math.sin(lo)+B*Math.cos(lb)*Math.sin(ob),z=A*Math.sin(la)+B*Math.sin(lb);
 return {lat:Math.atan2(z,Math.hypot(x,y))/D,lon:Math.atan2(y,x)/D};
}
export const pathLength=points=>points.slice(1).reduce((s,p,i)=>s+distance(points[i],p),0);
// Area of a simple polygon on the sphere, square metres (ring need not be closed).
export function polygonArea(points){
 if(points.length<3)return 0;let s=0;
 for(let i=0;i<points.length;i++){const p=points[i],q=points[(i+1)%points.length];s+=(q.lon-p.lon)*D*(2+Math.sin(p.lat*D)+Math.sin(q.lat*D));}
 return Math.abs(s*EARTH_RADIUS*EARTH_RADIUS/2);
}
export function formatDistance(m){return m<1000?m.toFixed(m<10?2:1)+' m':(m/1000).toFixed(m<10000?3:1)+' km';}
export function formatArea(m2){return m2<1e6?Math.round(m2).toLocaleString('en')+' m²':(m2/1e6).toFixed(m2<1e8?3:1)+' km²';}
// Bounding box helpers. Longitudes may wrap: west > east means the box crosses the antimeridian.
export function inBounds(b,lat,lon){if(lat<b.south||lat>b.north)return false;return b.west<=b.east?lon>=b.west&&lon<=b.east:lon>=b.west||lon<=b.east;}
export function padBounds(b,f){const h=(b.north-b.south)*f,w=((b.east-b.west+360)%360||360)*f;return {south:Math.max(-90,b.south-h),north:Math.min(90,b.north+h),west:((b.west-w+540)%360)-180,east:((b.east+w+540)%360)-180};}
