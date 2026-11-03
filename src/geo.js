import {Vector3,Matrix4} from 'three';
import {geoToECEF as coordinates} from './geo-core.js';
export * from './geo-core.js';
export function geoToECEF(...args){return new Vector3().copy(coordinates(...args));}
export function localFrame(latitude,longitude,radius=6371010){
 const lat=latitude*Math.PI/180,lon=longitude*Math.PI/180,up=geoToECEF(latitude,longitude,0,1),east=new Vector3(-Math.sin(lon),Math.cos(lon),0),south=new Vector3(Math.sin(lat)*Math.cos(lon),Math.sin(lat)*Math.sin(lon),-Math.cos(lat));
 const toECEF=new Matrix4().makeBasis(east,up,south);toECEF.setPosition(up.clone().multiplyScalar(radius));return {latitude,longitude,toECEF,fromECEF:toECEF.clone().invert(),east,up,south};
}
