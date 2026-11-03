import {Vector3} from './math.js';
export function geoToECEF(latitude,longitude,altitude=0,radius=6371010){const lat=latitude*Math.PI/180,lon=longitude*Math.PI/180,r=radius+altitude;return new Vector3(r*Math.cos(lat)*Math.cos(lon),r*Math.cos(lat)*Math.sin(lon),r*Math.sin(lat));}
export function ecefToGeo(point,radius=6371010){point=new Vector3().copy(point);const length=point.length();return {latitude:Math.asin(point.z/length)*180/Math.PI,longitude:Math.atan2(point.y,point.x)*180/Math.PI,altitude:length-radius};}
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
// OBB axes are the columns of the row-major 3x3 metadata rotation.
export function nearestNodePoint(node,point){
 const d=point.clone().sub(node.center);
 if(!node.obb){const distance=d.length();return distance<=node.radius?point.clone():node.center.clone().addScaledVector(d,node.radius/distance);}
 const r=node.obb.rotation,e=node.obb.extents,nearest=node.center.clone();
 for(let i=0;i<3;i++){const projection=Math.max(-e[i],Math.min(e[i],d.x*r[i]+d.y*r[i+3]+d.z*r[i+6]));nearest.x+=r[i]*projection;nearest.y+=r[i+3]*projection;nearest.z+=r[i+6]*projection;}
 return nearest;
}
export function nodeDistance(node,point){return point.distanceTo(nearestNodePoint(node,point));}

export function nodeInFrustum(node,frustum){
 if(!node.obb)return frustum.intersectsSphere({center:node.center,radius:node.radius});
 const r=node.obb.rotation,e=node.obb.extents;
 for(const plane of frustum.planes){const n=plane.normal;let radius=0;for(let i=0;i<3;i++)radius+=Math.abs(n.x*r[i]+n.y*r[i+3]+n.z*r[i+6])*e[i];if(plane.distanceToPoint(node.center)<-radius)return false;}
 return true;
}
