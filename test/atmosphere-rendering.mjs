import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const dir=fileURLToPath(new URL('..',import.meta.url)),golden=JSON.parse(readFileSync(new URL('./fixtures/atmosphere-reference.json',import.meta.url),'utf8'));
const bundle=await build({stdin:{resolveDir:dir,contents:String.raw`
import * as T from 'three';
import {atmospherePrecomputeShader,createTerrainAtmosphereUniforms} from './src/terrain-atmosphere.js';
import {terrainMaterial} from './src/terrain-material.js';
const renderer=new T.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(64,128);document.body.append(renderer.domElement);
const planet=new T.Group();planet.userData.planetRadius=6371010;
const mesh=new T.Mesh(new T.PlaneGeometry(200,200),terrainMaterial(null,0x997744));mesh.geometry.setAttribute('tileOctant',new T.Float32BufferAttribute([1,1,1,1],1));mesh.userData.planetRoot=planet;mesh.position.set(6371010,0,0);mesh.rotation.y=Math.PI/2;planet.add(mesh);planet.updateMatrixWorld(true);
const camera=new T.PerspectiveCamera(45,.5,.1,20000);camera.position.set(6371110,0,0);camera.up.set(0,0,1);camera.lookAt(6371010,0,0);camera.updateMatrixWorld();
const atmosphere=createTerrainAtmosphereUniforms();atmosphere.update(renderer,camera,mesh,{atmosphereFading:.3});
const scene=new T.Scene();scene.add(planet);planet.userData.atmosphere={atmosphereFading:.3};renderer.render(scene,camera);
const integrated=new Uint8Array(4);renderer.getContext().readPixels(32,64,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,integrated);
const unshaded=new Uint8Array(4);planet.userData.atmosphere.atmosphereFading=0;renderer.render(scene,camera);renderer.getContext().readPixels(32,64,1,1,renderer.getContext().RGBA,renderer.getContext().UNSIGNED_BYTE,unshaded);
if(integrated[3]!==255||!integrated.slice(0,3).some(v=>v>0)||integrated.every((v,i)=>v===unshaded[i]))throw Error('Active atmosphere did not shade the integrated terrain');
const lut=atmosphere.uniforms.atmoSampler.value.image;
const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');gl.getExtension('EXT_color_buffer_float');
const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
const convert=s=>s.replace(/^#version 100\s*/,'').replace(/^#extension GL_OES_standard_derivatives.*$/mg,'').replace(/\btexture2D\b/g,'texture').replace(/\btexture2DProj\b/g,'textureProj').replace(/\bgl_FragColor\b/g,'outColor');
const program=s=>{const p=gl.createProgram();gl.attachShader(p,shader(gl.VERTEX_SHADER,'#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));gl.attachShader(p,shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;out vec4 outColor;\n'+convert(s)));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;};
const programs=[program(atmospherePrecomputeShader)];
const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,lut.width,lut.height,0,gl.RGBA,gl.UNSIGNED_BYTE,lut.data);
const target=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,target);gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA32F,64,128);const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('float framebuffer incomplete');gl.viewport(0,0,64,128);
const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
const cases=${JSON.stringify(golden.cases)},results=[];
for(const c of cases){const p=programs[0];gl.useProgram(p);const a=gl.getAttribLocation(p,'p');gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,0,0);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);gl.uniform1i(gl.getUniformLocation(p,'atmoSampler'),0);gl.uniform4f(gl.getUniformLocation(p,'cameraAndSunState'),c.r,c.mu,1,0);gl.uniform2f(gl.getUniformLocation(p,'uExposureAndAtmoTweak'),20,3);gl.drawArrays(gl.TRIANGLES,0,6);const pixels=new Float32Array(64*128*4);gl.readPixels(0,0,64,128,gl.RGBA,gl.FLOAT,pixels);
let maxError=0;for(const sample of c.samples){const offset=(sample.y*64+sample.x)*4;for(let k=0;k<4;k++){const actual=pixels[offset+k];if(!Number.isFinite(actual))throw Error('Nonfinite atmospheric lookup');maxError=Math.max(maxError,Math.abs(actual-sample.value[k]));}}results.push({r:c.r,mu:c.mu,maxError});}
atmosphere.release();mesh.material.dispose();renderer.dispose();window.result={integrated:[...integrated],unshaded:[...unshaded],cases:results};
`},bundle:true,write:false,format:'iife'});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE??'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await page.setContent('<html><body></body></html>');await page.addScriptTag({content:bundle.outputFiles[0].text});const result=await page.evaluate(()=>window.result)??{};result.errors=errors;mkdirSync(dir+'/test-results',{recursive:true});writeFileSync(dir+'/test-results/atmosphere-rendering.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(!result.cases||errors.length||result.cases?.some(c=>c.maxError>5e-5))process.exitCode=1;}finally{await browser.close();}
