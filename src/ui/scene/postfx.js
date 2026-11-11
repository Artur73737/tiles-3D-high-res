// Real-time CAS sharpening for 3D views (WebGL renderer): scene -> render target -> CAS quad.
import * as THREE from 'three';
import {CAS_GLSL} from '../../api/enhance.js';
export class SharpenPass {
 constructor(renderer,{sharpness=0.5}={}){
  this.renderer=renderer;this.sharpness=sharpness;
  this.target=new THREE.WebGLRenderTarget(1,1,{depthBuffer:true,samples:4,colorSpace:THREE.SRGBColorSpace,type:THREE.UnsignedByteType});
  this.material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,depthTest:false,depthWrite:false,uniforms:{src:{value:this.target.texture},texel:{value:new THREE.Vector2()},sharpness:{value:sharpness}},
   vertexShader:'out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
   fragmentShader:`precision highp float;in vec2 vUv;uniform sampler2D src;uniform vec2 texel;uniform float sharpness;out vec4 o;\n${CAS_GLSL}\nvoid main(){o=vec4(casSample(src,vUv,texel,sharpness),1.);}`});
  this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material);this.quad.frustumCulled=false;this.scene=new THREE.Scene();this.scene.add(this.quad);this.camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
 }
 setSharpness(v){if(!(v>=0&&v<=1))throw new RangeError('sharpness must be within [0, 1]');this.sharpness=v;this.material.uniforms.sharpness.value=v;}
 render(scene,camera){
  const r=this.renderer,size=r.getDrawingBufferSize(new THREE.Vector2());
  if(this.target.width!==size.x||this.target.height!==size.y){this.target.setSize(size.x,size.y);this.material.uniforms.texel.value.set(1/size.x,1/size.y);}
  const prev=r.getRenderTarget();r.setRenderTarget(this.target);r.render(scene,camera);r.setRenderTarget(prev);r.render(this.scene,this.camera);
 }
 dispose(){this.target.dispose();this.material.dispose();this.quad.geometry.dispose();}
}
