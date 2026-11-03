import {ShaderMaterial,Color,FrontSide,CustomBlending,NoBlending,OneFactor,OneMinusSrcAlphaFactor,AddEquation,LessEqualDepth} from 'three';
import {terrainAtmosphereVertexDeclarations,terrainAtmosphereFragmentDeclarations,createTerrainAtmosphereUniforms} from './terrain-atmosphere.js';

// Reconstructed active RockMesh path: octant vertex rejection, four rotated
// derivative samples and premultiplied unpop output. Three's depth chunks keep
// this material in the same depth convention as the host's other scene layers.
export function terrainMaterial(map,color=0xffffff){
 const atmosphere=createTerrainAtmosphereUniforms();
 const material=new ShaderMaterial({
  uniforms:{...atmosphere.uniforms,tileTexture:{value:map},tileColor:{value:new Color(color)},tileMask:{value:255},tileOpacity:{value:1}},
  defines:map?{TILE_TEXTURE:1}:{},side:FrontSide,depthFunc:LessEqualDepth,
  premultipliedAlpha:true,blending:CustomBlending,blendEquation:AddEquation,blendSrc:OneFactor,blendDst:OneMinusSrcAlphaFactor,
  vertexShader:`
attribute float tileOctant;
uniform float tileMask;
varying vec2 tileUv;
#include <common>
#include <logdepthbuf_pars_vertex>
${terrainAtmosphereVertexDeclarations}
void main(){
 tileUv=uv;
 if(cameraAndSunState.w>0.0)atmosphereVertex(position);
 gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
 #include <logdepthbuf_vertex>
 float selected=floor(fract(tileMask/(2.0*tileOctant))*2.0);
 gl_Position*=1000.0*selected;
}`,
  fragmentShader:`
uniform sampler2D tileTexture;
uniform vec3 tileColor;
uniform float tileOpacity;
varying vec2 tileUv;
#include <logdepthbuf_pars_fragment>
${terrainAtmosphereFragmentDeclarations}
void main(){
 #include <logdepthbuf_fragment>
 vec4 pixel=vec4(tileColor,1.0);
 #ifdef TILE_TEXTURE
 vec2 dx=dFdx(tileUv),dy=dFdy(tileUv);
 vec2 a=0.33083706448*dx+0.16567086877*dy;
 vec2 b=-0.16567086877*dx+0.33083706448*dy;
 pixel*=0.25*(texture2D(tileTexture,tileUv+a)+texture2D(tileTexture,tileUv-a)+texture2D(tileTexture,tileUv+b)+texture2D(tileTexture,tileUv-b));
 #endif
 if(cameraAndSunState.w>0.0)pixel.rgb=applyTerrainAtmosphere(pixel.rgb);
 pixel.a*=abs(tileOpacity);
 gl_FragColor=vec4(pixel.rgb*pixel.a,pixel.a);
}`
 });
 material.map=map;
 material.onBeforeRender=(renderer,scene,camera,geometry,mesh)=>{const root=mesh.userData.planetRoot;if(root)atmosphere.update(renderer,camera,mesh,{radius:root.userData.planetRadius??6371010,...root.userData.atmosphere});};
 material.addEventListener('dispose',()=>atmosphere.release());return material;
}

export function setTerrainPass(mesh,mask,opacity=1,secondary=false){
 const material=mesh.material;
 mesh.visible=mask!==0;material.uniforms.tileMask.value=mask;material.uniforms.tileOpacity.value=opacity;
 material.transparent=secondary;material.blending=secondary?CustomBlending:NoBlending;material.depthWrite=!secondary;mesh.renderOrder=secondary?2:1;
}
