import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const bundle=await build({stdin:{resolveDir:root,contents:`
import * as T from 'three';
import {terrainMaterial,setTerrainPass} from './src/terrain-material.js';
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,64);document.body.appendChild(renderer.domElement);
const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,.1,20);camera.position.z=10;
const make=(color,z)=>{const geometry=new T.PlaneGeometry(2,2);geometry.setAttribute('tileOctant',new T.Float32BufferAttribute([1,1,1,1],1));const mesh=new T.Mesh(geometry,terrainMaterial(null,color));mesh.position.z=z;scene.add(mesh);return mesh;};
const parent=make(0xff0000,0),child=make(0x0000ff,.01),gl=renderer.getContext(),pixel=()=>{const bytes=new Uint8Array(4);gl.readPixels(32,32,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return [...bytes];};
const draw=()=>{renderer.render(scene,camera);return pixel();};
setTerrainPass(parent,255);setTerrainPass(child,1,.25,true);const blended=draw();
setTerrainPass(child,0,.25,true);const parentOnly=draw();
setTerrainPass(parent,254);const masked=draw();
setTerrainPass(child,1,1,false);const childOnly=draw();
const report={blended,parentOnly,masked,childOnly};
window.result=report;
`},bundle:true,write:false,format:'iife'});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const report={};
try{
 const page=await browser.newPage();const errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.setContent('<html><body></body></html>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 Object.assign(report,await page.evaluate(()=>window.result));
 const near=(a,b)=>a.every((v,i)=>Math.abs(v-b[i])<=2);
 if(!near(report.blended,[191,0,64,255])||!near(report.parentOnly,[255,0,0,255])||!near(report.masked,[0,0,0,255])||!near(report.childOnly,[0,0,255,255]))throw Error('Terrain pixel/depth/mask regression: '+JSON.stringify(report));
 if(errors.length)throw Error(errors.join('\n'));report.ok=true;
}catch(error){report.ok=false;report.error=error.message;process.exitCode=1;}
finally{await browser.close();mkdirSync(root+'/test-results',{recursive:true});writeFileSync(root+'/test-results/terrain-rendering.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
