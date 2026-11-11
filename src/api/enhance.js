// Image enhancement for 2D tiles (processed once per tile) and the shared CAS kernel used
// by the 3D post-process. CAS = AMD FidelityFX Contrast Adaptive Sharpening (simplified port).
import {TileError} from '../core/errors.js';

// GLSL body shared by the 2D pipeline and the 3D SharpenPass. Expects `src`, `texel`, `sharpness`.
export const CAS_GLSL=`
vec3 casSample(sampler2D src,vec2 uv,vec2 texel,float sharpness){
 vec3 a=texture(src,uv+texel*vec2(-1.,-1.)).rgb,b=texture(src,uv+texel*vec2(0.,-1.)).rgb,c=texture(src,uv+texel*vec2(1.,-1.)).rgb;
 vec3 d=texture(src,uv+texel*vec2(-1.,0.)).rgb,e=texture(src,uv).rgb,f=texture(src,uv+texel*vec2(1.,0.)).rgb;
 vec3 g=texture(src,uv+texel*vec2(-1.,1.)).rgb,h=texture(src,uv+texel*vec2(0.,1.)).rgb,i=texture(src,uv+texel*vec2(1.,1.)).rgb;
 vec3 mn=min(min(min(d,e),min(f,b)),h),mn2=min(mn,min(min(a,c),min(g,i)));mn+=mn2;
 vec3 mx=max(max(max(d,e),max(f,b)),h),mx2=max(mx,max(max(a,c),max(g,i)));mx+=mx2;
 vec3 amp=sqrt(clamp(min(mn,2.-mx)/max(mx,vec3(1e-5)),0.,1.));
 vec3 w=amp*(-1./mix(8.,5.,clamp(sharpness,0.,1.)));
 return clamp((b*w+d*w+f*w+h*w+e)/(1.+4.*w),0.,1.);
}`;
const VERT=`#version 300 es
out vec2 uv;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`;
// Pass 1: Catmull-Rom bicubic resample (upscale) + edge-preserving bilateral denoise.
// Reads the source image top-down (no UNPACK_FLIP_Y) and writes GL bottom-up orientation.
const PREP=`#version 300 es
precision highp float;in vec2 uv;out vec4 o;uniform sampler2D src;uniform vec2 srcSize;uniform float denoise;
vec4 cubic(float x){float x2=x*x,x3=x2*x;return vec4(-.5*x3+x2-.5*x,1.5*x3-2.5*x2+1.,-1.5*x3+2.*x2+.5*x,.5*x3-.5*x2);}
vec3 bicubic(vec2 p){vec2 t=p*srcSize-.5,f=fract(t);t-=f;vec4 wx=cubic(f.x),wy=cubic(f.y);vec3 s=vec3(0.);
 for(int j=0;j<4;j++)for(int i=0;i<4;i++){vec2 q=(t+vec2(float(i)-1.,float(j)-1.)+.5)/srcSize;s+=texture(src,clamp(q,.5/srcSize,1.-.5/srcSize)).rgb*wx[i]*wy[j];}return s;}
void main(){vec2 p=vec2(uv.x,1.-uv.y);vec3 c=bicubic(p);
 if(denoise>0.){float sc=mix(.03,.18,denoise),ws=1.;vec3 acc=c;vec2 tx=1./srcSize;
  for(int j=-2;j<=2;j++)for(int i=-2;i<=2;i++){if(i==0&&j==0)continue;vec3 n=texture(src,clamp(p+vec2(float(i),float(j))*tx,.5*tx,1.-.5*tx)).rgb;vec3 dc=n-c;
   float w=exp(-dot(dc,dc)/(2.*sc*sc))*exp(-float(i*i+j*j)/4.5);acc+=n*w;ws+=w;}
  c=mix(c,acc/ws,clamp(denoise*1.5,0.,1.));}
 o=vec4(clamp(c,0.,1.),1.);}`;
const SHARP=`#version 300 es
precision highp float;in vec2 uv;out vec4 o;uniform sampler2D src;uniform vec2 texel;uniform float sharpness;uniform float enabled;
${CAS_GLSL}
void main(){o=vec4(enabled>.5?casSample(src,uv,texel,sharpness):texture(src,uv).rgb,1.);}`;

export const enhanceSupported=()=>typeof OffscreenCanvas==='function'&&typeof createImageBitmap==='function'&&!!(()=>{try{return new OffscreenCanvas(1,1).getContext('webgl2');}catch{return null;}})();

// Processes tiles on one shared WebGL2 context. Each call is synchronous on the GPU queue,
// so results are deterministic and never interleave.
export class TileEnhancer {
 constructor(){
  if(typeof OffscreenCanvas!=='function')throw new TileError('unsupported_environment','TileEnhancer needs OffscreenCanvas + WebGL2 (browser/worker)');
  this.canvas=new OffscreenCanvas(256,256);const gl=this.gl=this.canvas.getContext('webgl2',{premultipliedAlpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false});
  if(!gl)throw new TileError('unsupported_environment','WebGL2 is not available for tile enhancement');
  const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new TileError('shader_error',gl.getShaderInfoLog(s));return s;};
  const program=frag=>{const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,VERT));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,frag));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new TileError('shader_error',gl.getProgramInfoLog(p));return p;};
  this.prep=program(PREP);this.sharp=program(SHARP);this.vao=gl.createVertexArray();
  this.srcTex=this.texture();this.midTex=this.texture();this.fbo=gl.createFramebuffer();this.disposed=false;this.stats={processed:0,ms:0};
 }
 texture(){const gl=this.gl,t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);for(const [k,v]of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,k,v);return t;}
 // source: ImageBitmap | HTMLImageElement | Blob | Uint8Array (encoded image). Returns a new ImageBitmap.
 async enhance(source,{sharpness=0.6,sharpen=true,denoise=0,upscale=1}={}){
  if(this.disposed)throw new TileError('disposed','TileEnhancer disposed');
  if(![1,2,4].includes(upscale))throw new TileError('invalid_options','upscale must be 1, 2 or 4');
  if(!(sharpness>=0&&sharpness<=1)||!(denoise>=0&&denoise<=1))throw new TileError('invalid_options','sharpness and denoise must be within [0, 1]');
  let bitmap=source,owned=false;
  if(source instanceof Uint8Array||source instanceof ArrayBuffer)source=new Blob([source]);
  if(source instanceof Blob){bitmap=await createImageBitmap(source);owned=true;}
  const t0=performance.now(),gl=this.gl,w=bitmap.width,h=bitmap.height,W=w*upscale,H=h*upscale;
  try{
   gl.bindVertexArray(this.vao);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.srcTex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,gl.RGBA,gl.UNSIGNED_BYTE,bitmap);
   gl.bindTexture(gl.TEXTURE_2D,this.midTex);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,W,H,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
   gl.bindFramebuffer(gl.FRAMEBUFFER,this.fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.midTex,0);gl.viewport(0,0,W,H);
   gl.useProgram(this.prep);gl.bindTexture(gl.TEXTURE_2D,this.srcTex);gl.uniform1i(gl.getUniformLocation(this.prep,'src'),0);gl.uniform2f(gl.getUniformLocation(this.prep,'srcSize'),w,h);gl.uniform1f(gl.getUniformLocation(this.prep,'denoise'),denoise);gl.drawArrays(gl.TRIANGLES,0,3);
   gl.bindFramebuffer(gl.FRAMEBUFFER,null);this.canvas.width=W;this.canvas.height=H;gl.viewport(0,0,W,H);
   gl.useProgram(this.sharp);gl.bindTexture(gl.TEXTURE_2D,this.midTex);gl.uniform1i(gl.getUniformLocation(this.sharp,'src'),0);gl.uniform2f(gl.getUniformLocation(this.sharp,'texel'),1/W,1/H);gl.uniform1f(gl.getUniformLocation(this.sharp,'sharpness'),sharpness);gl.uniform1f(gl.getUniformLocation(this.sharp,'enabled'),sharpen?1:0);gl.drawArrays(gl.TRIANGLES,0,3);
   const out=this.canvas.transferToImageBitmap();this.stats.processed++;this.stats.ms+=performance.now()-t0;return out;
  }finally{if(owned)bitmap.close?.();}
 }
 dispose(){if(this.disposed)return;this.disposed=true;const gl=this.gl;gl.deleteTexture(this.srcTex);gl.deleteTexture(this.midTex);gl.deleteFramebuffer(this.fbo);gl.deleteProgram(this.prep);gl.deleteProgram(this.sharp);gl.getExtension('WEBGL_lose_context')?.loseContext();}
}
