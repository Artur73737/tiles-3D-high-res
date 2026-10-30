import {Vector3,Matrix4} from 'three';
export function geoToECEF(latitude,longitude,altitude=0,radius=6371010){const lat=latitude*Math.PI/180,lon=longitude*Math.PI/180,r=radius+altitude;return new Vector3(r*Math.cos(lat)*Math.cos(lon),r*Math.cos(lat)*Math.sin(lon),r*Math.sin(lat));}
export function ecefToGeo(point,radius=6371010){const length=point.length();return {latitude:Math.asin(point.z/length)*180/Math.PI,longitude:Math.atan2(point.y,point.x)*180/Math.PI,altitude:length-radius};}
export function localFrame(latitude,longitude,radius=6371010){
 const lat=latitude*Math.PI/180,lon=longitude*Math.PI/180,up=geoToECEF(latitude,longitude,0,1),east=new Vector3(-Math.sin(lon),Math.cos(lon),0),south=new Vector3(Math.sin(lat)*Math.cos(lon),Math.sin(lat)*Math.sin(lon),-Math.cos(lat));
 const toECEF=new Matrix4().makeBasis(east,up,south);toECEF.setPosition(up.clone().multiplyScalar(radius));return {latitude,longitude,toECEF,fromECEF:toECEF.clone().invert(),east,up,south};
}
export function intersectsColumn(node,normal,radius){
 const axial=node.center.dot(normal);if(axial+node.radius<0)return false;
 const lateral=Math.sqrt(Math.max(0,node.center.lengthSq()-axial*axial));return lateral<=radius+node.radius;
}
// Conservative horizontal view sector. Near collision data is always included
// in every direction; bounding spheres that cross the view edges remain selected.
export function intersectsRegion(node,spec){
 if(!intersectsColumn(node,spec.normal,spec.radius))return false;
 if(!spec.viewDirection)return true;
 const delta=node.center.clone().sub(spec.focus);delta.addScaledVector(spec.normal,-delta.dot(spec.normal));
 const distance=delta.length();if(distance<=spec.nearRadius+node.radius)return true;
 const angle=Math.acos(Math.max(-1,Math.min(1,delta.dot(spec.viewDirection)/distance)));
 return angle<=spec.viewHalfAngle+Math.asin(Math.min(1,node.radius/distance));
}
// A preview can retire only when its entire footprint was examined, including
// its edges. A count of zero inside a view sector proves nothing outside it.
export function containsRegion(node,spec){
 const axial=node.center.dot(spec.normal);if(axial-node.radius<0)return false;
 const delta=node.center.clone().addScaledVector(spec.normal,-axial),distance=delta.length();
 if(distance+node.radius>spec.radius)return false;
 if(!spec.viewDirection||distance+node.radius<=spec.nearRadius)return true;
 if(distance<=node.radius)return false;
 const angle=Math.acos(Math.max(-1,Math.min(1,delta.dot(spec.viewDirection)/distance)));
 return angle+Math.asin(Math.min(1,node.radius/distance))<=spec.viewHalfAngle;
}
