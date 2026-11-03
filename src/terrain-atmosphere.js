/**
 * Reconstructed active terrain atmosphere, based on the captured reference
 * renderer's Bruneton scattering model. Provenance, source hashes and active
 * feature scope: docs/reference-client-analysis.md.
 *
 */
/*!
 * @license
 * Precomputed Atmospheric Scattering
 * Copyright (c) 2008 INRIA
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the copyright holders nor the names of its
 *    contributors may be used to endorse or promote products derived from
 *    this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

// OpenGL ES adaptations: Copyright 2011 Google Inc.; Eric Bruneton.
import {DataTexture,RGBAFormat,UnsignedByteType,FloatType,LinearFilter,ClampToEdgeWrapping,NoColorSpace,WebGLRenderTarget,ShaderMaterial,Scene,Mesh,PlaneGeometry,OrthographicCamera,Matrix4,Vector3,Vector4,NoBlending} from 'three';

const owners=new WeakMap(),identity=new Matrix4();
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
/** Automatic atmosphere visibility from the reference camera/ground producer. */
export function automaticAtmosphereFade(heightAboveGround,verticalFov,tilt,widthScale=1){
 const viewHeight=2*heightAboveGround*Math.tan(verticalFov/2);
 const widthFade=clamp((viewHeight-73900*widthScale)/(147800*widthScale),0,1);
 let horizon=Math.asin(Math.min(1,6371010/(heightAboveGround+6371010)))-.55*verticalFov;
 if(viewHeight>=13000000)horizon=0;
 else if(viewHeight>10000)horizon*=Math.pow(1-(viewHeight-10000)/12990000,2);
 const tiltFade=clamp((Math.abs(tilt)-(horizon-Math.PI/12))/(Math.PI/12),0,1);
 return Math.max(widthFade,tiltFade);
}
/** Default sunlight follows camera heading; interpolate raw vectors before normalization. */
export function cameraRelativeSun(up,east,north,heading,altitude,result=new Vector3()){
 const blend=clamp((altitude-1000000)/1000000,0,1),c=Math.cos(heading),s=Math.sin(heading);
 const eastWeight=-.25-.5*blend,northWeight=-.75+1.5*blend;
 return result.copy(up).addScaledVector(east,eastWeight*c+northWeight*s).addScaledVector(north,-eastWeight*s+northWeight*c).normalize();
}
const bytes=encoded=>Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
const TRANSMITTANCE="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/fz5Kv7+/Rj+/v4O/v7+B/7+/gPnzprd9+3Whfz48Er+/Pkq/v79GP7+/g7+/v4H/v7+A+fPm9737deG/PjwSv78+Sr+/v0Y/v7+Dv7+/gf+/v4D6M+c3/fu14b8+PBK/vz5Kv7+/Rj+/v4O/v7+B/7+/gPo0J7g9+7Yhvz58Ev+/Pkq/v79GP7+/g7+/v4H/v7+A+nRn+H37tmH/PnxS/78+ir+/v0Y/v7+Dv7+/gf+/v4D6dGg4vfv2Yf8+fFL/vz6Kv7+/Rj+/v4O/v7+B/7+/gPp0qHj+O/ah/z58Uv+/Poq/v79GP7+/g7+/v4H/v7+A+rTouT479qI/PnxS/79+iv+/v0Y/v7+Dv7+/gf+/v4D6tOk5fjv24j8+fFM/v36K/7+/Rj+/v4O/v7+B/7+/gPq1KXl+O/biPz58kz+/for/v79GP7+/g7+/v4H/v7+A+rVpub48NyJ/PnyTP79+iv+/v0Z/v7+Dv7+/gf+/v4D69Wn5/jw3In8+fJM/v36K/7+/Rn+/v4O/v7+B/7+/gPr1qjo+PDdifz58kz+/for/v79Gf7+/g7+/v4H/v7+A+vWqen48N2K/PnyTP79+iv+/v0Z/v7+Dv7+/gj+/v4D69eq6fjx3or8+vNM/v36K/7+/Rn+/v4O/v7+CP7+/gPs16vq+PHeivz6803+/for/v79Gf7+/g7+/v4I/v7+A+zYrOv58d6K/PrzTf79+iv+/v0Z/v7+Dv7+/gj+/v4D7Nit6/nx34v8+vNN/v36K/7+/Rn+/v4O/v7+CP7+/gPs2a3s+fHfi/z6803+/for/v79Gf7+/g7+/v4I/v7+A+3Zru358eCL/PrzTf79+yz+/v0Z/v7+Dv7+/gj+/v4D7dqv7fny4Iv8+vNN/v37LP7+/Rn+/v4O/v7+CP7+/gPt2rDu+fLgi/z69E3+/fss/v79Gf7+/g7+/v4I/v7+A+3ase/58uGM/fr0Tf79+yz+/v0Z/v7+Dv7+/gj+/v4D7tuy8Pny4Yz9+vRO/v37LP7+/Rn+/v4O/v7+CP7+/gPu27Lw+fLhjP369E7+/fss/v79Gf7+/g7+/v4I/v7+BO7cs/H58uKM/fr0Tv79+yz+/v0Z/v7+Dv7+/gj+/v4E7ty08vnz4oz9+vRO/v37LP7+/Rn+/v4O/v7+CP7+/gTu3LXy+fPijf369E7+/fss/v79Gf7+/g7+/v4I/v7+BO/dtvP58+ON/fr1Tv79+yz+/v0Z/v7+Dv7+/gj+/v4E79229Pnz4439+vVO/v37LP7+/Rn+/v4O/v7+CP7+/gTv3rf0+fPjjf369U7+/fss/v79Gf7+/g7+/v4I/v7+BO/euPX68+SN/fv1Tv79+yz+/v0Z/v7+Dv7+/gj+/v4E79649frz5I39+/VO/v37LP7+/Rn+/v4O/v7+CP7+/gTv37n2+vPkjf379U7+/fss/v79Gf7+/g7+/v4I/v7+BPDfuvf69OWO/fv1Tv79+yz+/v0Z/v7+Dv7+/gj+/v4E8N+69/r05Y79+/VP/v37LP7+/Rn+/v4O/v7+CP7+/gTw37v4+vTljv379U/+/fss/v79Gv7+/g/+/v4I/v7+BPDgu/j69OWO/fv1T/79+yz+/v0a/v7+D/7+/gj+/v4E8OC8+fr05o79+/ZP/v37Lf7+/Rr+/v4P/v7+CP7+/gTw4L35+vTmjv379k/+/fst/v79Gv7+/g/+/v4I/v7+BPDhvfr69OaO/fv2T/79+y3+/v0a/v7+D/7+/gj+/v4E8eG++vr05o/9+/ZP/v37Lf7+/Rr+/v4P/v7+CP7+/gTx4b77+vTnj/379k/+/fst/v79Gv7+/g/+/v4I/v7+BA==";
const SKY_IRRADIANCE="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ERMW/xETFv8RExb/ERMW/xETFv8RExb/ERMW/xETFv8RExb/ERMW/xETFv8RExb/ERMW/xETFv8RExb/ERMW/xIUFv8SFBb/EhQW/xIUFv8SFBb/EhQW/xIUFv8SFBb/EhQX/xIUF/8SFBf/EhQX/xIUF/8AAAD/AAAA/wAAAP8BAAD/AwIB/wcGBP8KCgj/DAwM/wwNDv8MDQ7/DA0P/wwND/8MDQ//DA4P/wwOD/8MDg//DA4Q/wwOEP8MDhD/DA4Q/wwOEP8NDhD/DQ4Q/w0OEP8NDhD/DQ4Q/w0OEP8NDhD/DQ4Q/w0OEP8NDhD/DQ4Q/w0OEf8NDhH/DQ4R/w0OEf8NDhH/DQ4R/w0OEf8NDxH/DQ8R/w0PEf8NDxH/DQ8R/w0PEf8NDxH/DQ8R/w0PEf8NDxH/DQ8R/w0PEf8NDxH/DQ8R/w0PEf8NDxH/DQ8R/w0PEf8NDxH/DQ8R/w0PEf8NDxH/Dg8R/w4PEf8ODxH/AAAA/wAAAP8AAAD/AAAA/wMCAf8GBQP/CAgH/wkJCf8JCgr/CQoL/wkKC/8JCgv/CQoL/wkKC/8JCgv/CQoL/wkKDP8JCgz/CQoM/wkKDP8JCgz/CQoM/wkKDP8JCgz/CQoM/wkKDP8JCgz/CQoM/wkKDP8JCwz/CQsM/wkLDP8JCwz/CQsM/wkLDP8JCwz/CQsM/wkLDP8JCwz/CQsM/wkLDP8KCwz/CgsM/woLDP8KCwz/CgsN/woLDf8KCw3/CgsN/woLDf8KCw3/CgsN/woLDf8KCw3/CgsN/woLDf8KCw3/CgsN/woLDf8KCw3/CgsN/woLDf8KCw3/CgsN/wAAAP8AAAD/AAAA/wAAAP8CAQH/BAQD/wYGBf8GBwf/BgcH/wYHCP8GBwj/BgcI/wYHCP8GBwj/BgcI/wYHCP8GBwj/BgcI/wYHCP8GBwj/BgcI/wYHCP8GBwj/BgcI/wYHCP8GBwj/BgcI/wYHCP8GBwj/BgcJ/wYHCf8GBwn/BgcJ/wYHCf8GBwn/BgcJ/wcHCf8HBwn/BwcJ/wcHCf8HBwn/BwcJ/wcHCf8HBwn/BwcJ/wcHCf8HBwn/BwcJ/wcHCf8HCAn/BwgJ/wcICf8HCAn/BwgJ/wcICf8HCAn/BwgJ/wcICf8HCAn/BwgJ/wcICf8HCAn/BwgJ/wcICf8AAAD/AAAA/wAAAP8AAAD/AQEA/wMCAv8DAwP/AwQE/wMEBP8DBAT/AwQE/wMEBP8DBAT/AwQE/wMEBP8DBAT/AwQE/wMEBP8DBAT/AwQE/wMEBf8DBAX/AwQF/wMEBf8DBAX/AwQF/wMEBf8DBAX/AwQF/wMEBf8DBAX/AwQF/wMEBf8DBAX/AwQF/wMEBf8DBAX/AwQF/wMEBf8DBAX/BAQF/wQEBf8EBAX/BAQF/wQEBf8EBAX/BAQF/wQEBf8EBAX/BAQF/wQEBf8EBAX/BAQF/wQEBf8EBAX/BAQF/wQEBf8EBAX/BAQF/wQEBf8EBAX/BAQF/wQEBf8EBAX/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAEA/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/wEBAf8BAQH/AQEB/w==";

const atmosphereConstants=`const float kPi = 3.141592657;
const float kEarthRadius = 1.0;
const float kPlanetRadius = 1.0;
const float kPlanetRadiusInKm = 6360.0;
const float kInnerAtmosphereRadius = 6350.0 / kPlanetRadiusInKm;
const float kOuterAtmosphereRadius = 6420.0 / kPlanetRadiusInKm;
const float kAtmosphereRadius = kOuterAtmosphereRadius;
const float kAtmosphereHeight = kOuterAtmosphereRadius - kPlanetRadius;
const float kMaxHorizonDistSq =
    kOuterAtmosphereRadius * kOuterAtmosphereRadius -
    kInnerAtmosphereRadius * kInnerAtmosphereRadius;
const float kMaxHorizonDist = 0.148657681;
const float kRayleighScale = 8.0 / kPlanetRadiusInKm;
const vec3 kRayleighScatteringCoefficient =
    vec3(5.8e-3, 1.35e-2, 3.31e-2) * kPlanetRadiusInKm;
const float kMieScale = 1.2 / kPlanetRadiusInKm;
const vec3 kMieScatteringCoefficient = vec3(4e-3) * kPlanetRadiusInKm;
const vec3 kMieExtinctionCoefficient = kMieScatteringCoefficient / 0.9;
const float kMieG = 0.8;
const vec3 kMultipleScatteringCoefficient =
    vec3(2.09e-4, 4.76e-4, 1.385e-3) * kPlanetRadiusInKm;
const vec3 kSkyIrradianceCoefficient =
    vec3(0.031586, 0.063477, 0.129883) * 2.0;
const vec3 kInverseWhitePoint = vec3(0.91, 0.99, 1.6);
const float kMaxInscatterDistance = 800.0 / kPlanetRadiusInKm;
const float kMinCameraRadius = kInnerAtmosphereRadius + 1e-7;
const vec3 kAverageExtinctionCoefficient =
    (kRayleighScatteringCoefficient * kRayleighScale +
     kMieExtinctionCoefficient * kMieScale) / (kRayleighScale + kMieScale);
const float kInscatterWidth = 64.0;
const float kInscatterHeight = 64.0;
const int kIntegrationSamples = 9;`;
const atmosphereUniforms=`
uniform vec4 cameraAndSunState;
uniform vec3 cameraAtmo;
uniform vec3 sunDirAtmo;
uniform vec2 uExposureAndAtmoTweak;
uniform sampler2D atmoSampler;
uniform sampler2D skySampler;
uniform sampler2D inscatterSampler;
`;
export const atmospherePrecomputeShader=atmosphereUniforms+atmosphereConstants+`float rayleighPhaseFunction(float nu) {
  return (3.0 / (16.0 * kPi)) * (1.0 + nu * nu);
}
float miePhaseFunction(float nu) {
  float v = (1.0 + kMieG * kMieG) - (2.0 * kMieG) * nu;
  return ((1.0 - kMieG * kMieG) / (4.0 * kPi)) / (v * sqrt(v));
}
vec2 atmoUV(float r, float muS) {
  const vec2 kTextureSize = vec2(8.0, 128.0);
  const vec2 kTextureOffset = vec2(0.5) / kTextureSize;
  const vec2 kTextureScale = (kTextureSize - vec2(1.0)) / kTextureSize;
  const float kH = 0.06868;
  const vec2 kUvScale = vec2(1.0 / kAtmosphereHeight, 1.0 / 1.2);
  const float kRScale = kH * kUvScale.x;
  const vec2 kScale = kUvScale * kTextureScale;
  const vec2 kUvOffset = vec2(-kPlanetRadius, 0.2) * kUvScale;
  const vec2 kROffset = vec2(0.0, kH * (1.0 + kUvOffset.x)) * kScale;
  const vec2 kOffset = kTextureOffset + kUvOffset * kTextureScale + kROffset;
  return vec2(r, r * kRScale + muS) * kScale + kOffset;
}
vec4 atmoTex(float r, float muS) {
  return texture2D(atmoSampler, atmoUV(r, muS));
}
vec3 inscatterRadiance(float r,
                       float mu,
                       float muS,
                       float nu,
                       float dMax,
                       out vec3 transmittance) {
  dMax = min(dMax, kMaxInscatterDistance);
  float halfStep = dMax * (0.5 / float(kIntegrationSamples - 1));
  float oneOverTwoR = 0.5 / r;
  vec3 rayleigh = kRayleighScatteringCoefficient * rayleighPhaseFunction(nu);
  vec3 mie = kMieScatteringCoefficient * miePhaseFunction(nu);
  vec4 atmoI = atmoTex(r, muS);
  vec2 densityI = exp(vec2(min(kPlanetRadius - r, 0.0)) *
                      vec2(1.0 / kRayleighScale, 1.0 / kMieScale));
  vec3 rayI = rayleigh * densityI.x;
  vec3 mieI = mie * densityI.y;
  vec3 ambI = kMultipleScatteringCoefficient * atmoI.a * atmoI.a;
  vec3 inscatterI = (rayI + mieI) * atmoI.rgb + ambI;
  transmittance = vec3(1.0);
  vec3 inscatter = vec3(0.0);
  for (int j = 2; j < 2 * kIntegrationSamples; j += 2) {
    float dJ = float(j) * halfStep;
    float rJ = r + dJ * (mu + dJ * oneOverTwoR);
    float muSJ = (nu * dJ + muS * r) * (1.0 / kPlanetRadius);
    vec4 atmoJ = atmoTex(rJ, muSJ);
    vec2 densityJ = exp(vec2(min(kPlanetRadius - rJ, 0.0)) *
                        vec2(1.0 / kRayleighScale, 1.0 / kMieScale));
    vec3 rayJ = rayleigh * densityJ.x;
    vec3 mieJ = mie * densityJ.y;
    vec3 ambJ = kMultipleScatteringCoefficient * atmoJ.a * atmoJ.a;
    transmittance *= exp(((-2.0 * kRayleighScatteringCoefficient) * densityJ.x +
        (-2.0 * kMieExtinctionCoefficient) * densityJ.y) * halfStep);
    vec3 inscatterJ = ((rayJ + mieJ) * atmoJ.rgb + ambJ) * transmittance;
    inscatter += (inscatterI + inscatterJ) * halfStep;
    inscatterI = inscatterJ;
  }
  return inscatter;
}
float sigmoid(float x) {
  return 2.0 * x / (1.0 + x * x);
}
float smoothmax(float x0, float dx, float x) {
  return x < x0 ? x0 + (1.0 / ((x0 - x) * (1.0 / dx) + 1.0) - 1.0) * dx : x;
}
float getMu(float r, float v) {
  const float kHalfHeight = 0.5 * kInscatterHeight;
  const float kInvHalfHeight = 1.0 / (kHalfHeight - 1.0);
  float horizonDistSq = r * r - kInnerAtmosphereRadius * kInnerAtmosphereRadius;
  float horizonDist = sqrt(horizonDistSq);
  float dMin, dMax, d, mu;
  if (v < kHalfHeight) {
    dMin = r - kInnerAtmosphereRadius;
    dMax = horizonDist;
    d = 1.0 - v * kInvHalfHeight;
    d = clamp(d * dMax, dMin, dMax * 0.999);
    mu = -(horizonDistSq + d * d) / (2.0 * r * d);
    mu = min(mu, -horizonDist / r - 0.001);
  } else {
    dMin = kOuterAtmosphereRadius - r;
    dMax = horizonDist + kMaxHorizonDist;
    d = (v - kHalfHeight) * kInvHalfHeight;
    d = clamp(d * dMax, dMin, dMax * 0.999);
    mu = (kMaxHorizonDistSq - horizonDistSq - d * d) / (2.0 * r * d);
  }
  return mu;
}
vec2 getMuSBound(float r0prime, float mu, float r0primeMuS0, out float t) {
  t = mu + sqrt(mu * mu + r0prime * r0prime - 1.0);
  float muSmin = smoothmax(-0.15, 0.1, r0primeMuS0 - t);
  float muSmax = max(muSmin + 1e-6, min(1.0, r0primeMuS0 + t));
  return vec2(muSmin, muSmax);
}
vec2 getMuSNu(float r0, float mu, float muS0, float u) {
  float r0prime = r0 * (1.0 / kOuterAtmosphereRadius);
  u = sigmoid(u * (2.0 / (kInscatterWidth - 1.0)) - 1.0);
  if (r0prime < 1.0) {
    return vec2(muS0, u);
  } else {
    float t;
    vec2 muSBound = getMuSBound(r0prime, mu, r0prime * muS0, t);
    float muS = (u * 0.5 + 0.5) * (muSBound.y - muSBound.x) + muSBound.x;
    float nu = clamp((muS - r0prime * muS0) / t, -1.0, 1.0);
    return vec2(muS, nu);
  }
}
float getMaxDistance(float r, float mu) {
  float rSq = r * r;
  float rMu = -r * mu;
  float delta0 = rMu * rMu - rSq;
  float delta = delta0 + kOuterAtmosphereRadius * kOuterAtmosphereRadius;
  float deltaSqrt = sqrt(delta);
  float d = rMu + deltaSqrt;
  delta = delta0 + (cameraAndSunState[3] > 0.0 ?
      kPlanetRadius * kPlanetRadius :
      kInnerAtmosphereRadius * kInnerAtmosphereRadius);
  float distanceToGround = delta > 0.0 ? rMu - sqrt(delta) : -1.0;
  return distanceToGround > 0.0 ? distanceToGround : d;
}
vec2 getMaxDistances(float r, float mu, float rMu) {
  const float r0SqA = kPlanetRadius * kPlanetRadius;
  const float rcA = (kOuterAtmosphereRadius + kPlanetRadius) * 0.5;
  const float rzA = (kOuterAtmosphereRadius - kPlanetRadius) * 0.5;
  const float rzxA = rzA / (0.05 * kPlanetRadius);
  const vec4 kEllipseA = vec4(rcA, rzxA * rzxA, 1.0 - rzxA * rzxA, rzA * rzA);
  const float r0SqB = kInnerAtmosphereRadius * kInnerAtmosphereRadius;
  const float rcB = (kOuterAtmosphereRadius + kInnerAtmosphereRadius) * 0.5;
  const float rzB = (kOuterAtmosphereRadius - kInnerAtmosphereRadius) * 0.5;
  const float rzxB = rzB / (0.05 * kInnerAtmosphereRadius);
  const vec4 kEllipseB = vec4(rcB, rzxB * rzxB, 1.0 - rzxB * rzxB, rzB * rzB);
  float r0Sq = cameraAndSunState.x >= kPlanetRadius ? r0SqA : r0SqB;
  vec4 ellipse = cameraAndSunState.x >= kPlanetRadius ? kEllipseA : kEllipseB;
  float dr = r - ellipse.x;
  float A = ellipse.y + mu * mu * ellipse.z;
  float B = dr * mu;
  float C = dr * dr - ellipse.w;
  float dist1 = max((-B + sqrt(B * B - A * C)) / A, 1e-6);
  rMu = min(rMu, -sqrt(r * r - r0Sq) - 0.002);
  float delta = rMu * rMu - r * r + r0Sq;
  float dist2 = -rMu - sqrt(delta);
  return dist1 < dist2 ? vec2(dist1, dist2) : vec2(dist2, dist1);
}
vec4 computeInscatter(vec2 fragCoord, float exposure) {
  vec2 uv = floor(fragCoord);
  float r0 = max(kMinCameraRadius, cameraAndSunState.x);
  float muS0 = cameraAndSunState.y;
  float r = min(r0, kOuterAtmosphereRadius);
  float mu = getMu(r, mod(uv.y, kInscatterHeight));
  vec2 muSNu = getMuSNu(r0, mu, muS0, uv.x);
  float d;
  if (cameraAndSunState.z > 0.5) {
    vec2 dists = getMaxDistances(r, mu, r * mu);
    d = uv.y < kInscatterHeight ? dists.x : dists.y;
  } else {
    d = getMaxDistance(r, mu);
  }
  vec3 transmittance;
  vec3 inscatter = inscatterRadiance(r, mu, muSNu.x, muSNu.y, d, transmittance);
  inscatter *= kInverseWhitePoint;
  transmittance.r = log(transmittance.r);
  return vec4(inscatter, transmittance.r);
}
void main(){gl_FragColor=computeInscatter(gl_FragCoord.xy,uExposureAndAtmoTweak.x);}`;
export const terrainAtmosphereVertexDeclarations=atmosphereUniforms+atmosphereConstants+`
float atmosphereTweak(float r,float mu){
 float radial=cameraAndSunState.z/14500000.0;
 float angular=(1.0+mu)/(1.0-sqrt(1.0-kInnerAtmosphereRadius*kInnerAtmosphereRadius/(r*r)));
 float fading=clamp(max(radial,angular),0.0,1.0);
 float height=clamp((cameraAndSunState.x-kInnerAtmosphereRadius)/(kOuterAtmosphereRadius*1.2-kInnerAtmosphereRadius),0.0,1.0);
 return min(1.0,pow(fading,uExposureAndAtmoTweak.y*(4.0-3.0*height)));
}
vec2 atmoUV(float r, float muS) {
  const vec2 kTextureSize = vec2(8.0, 128.0);
  const vec2 kTextureOffset = vec2(0.5) / kTextureSize;
  const vec2 kTextureScale = (kTextureSize - vec2(1.0)) / kTextureSize;
  const float kH = 0.06868;
  const vec2 kUvScale = vec2(1.0 / kAtmosphereHeight, 1.0 / 1.2);
  const float kRScale = kH * kUvScale.x;
  const vec2 kScale = kUvScale * kTextureScale;
  const vec2 kUvOffset = vec2(-kPlanetRadius, 0.2) * kUvScale;
  const vec2 kROffset = vec2(0.0, kH * (1.0 + kUvOffset.x)) * kScale;
  const vec2 kOffset = kTextureOffset + kUvOffset * kTextureScale + kROffset;
  return vec2(r, r * kRScale + muS) * kScale + kOffset;
}
vec4 atmoTex(float r, float muS) {
  return texture2D(atmoSampler, atmoUV(r, muS));
}
vec2 skyUV(float r, float muS) {
  const vec2 kTextureSize = vec2(64.0, 16.0);
  const vec2 kTextureOffset = vec2(0.5) / kTextureSize;
  const vec2 kTextureScale = (kTextureSize - vec2(1.0)) / kTextureSize;
  const vec2 kUvScale = vec2(1.0 / 1.2, 1.0 / kAtmosphereHeight);
  const vec2 kScale = kUvScale * kTextureScale;
  const vec2 kUvOffset = vec2(0.2, -kPlanetRadius) * kUvScale;
  const vec2 kOffset = kTextureOffset + kUvOffset * kTextureScale;
  return vec2(muS, r) * kScale + kOffset;
}
vec3 skyTex(float r, float muS) {
  vec3 texel = texture2D(skySampler, skyUV(r, muS)).rgb;
  return texel * texel * kSkyIrradianceCoefficient;
}
float smoothmax(float x0, float dx, float x) {
  return x < x0 ? x0 + (1.0 / ((x0 - x) * (1.0 / dx) + 1.0) - 1.0) * dx : x;
}
vec2 getMuSBound(float r0prime, float mu, float r0primeMuS0, out float t) {
  t = mu + sqrt(mu * mu + r0prime * r0prime - 1.0);
  float muSmin = smoothmax(-0.15, 0.1, r0primeMuS0 - t);
  float muSmax = max(muSmin + 1e-6, min(1.0, r0primeMuS0 + t));
  return vec2(muSmin, muSmax);
}
vec2 getMaxDistances(float r, float mu, float rMu) {
  const float r0SqA = kPlanetRadius * kPlanetRadius;
  const float rcA = (kOuterAtmosphereRadius + kPlanetRadius) * 0.5;
  const float rzA = (kOuterAtmosphereRadius - kPlanetRadius) * 0.5;
  const float rzxA = rzA / (0.05 * kPlanetRadius);
  const vec4 kEllipseA = vec4(rcA, rzxA * rzxA, 1.0 - rzxA * rzxA, rzA * rzA);
  const float r0SqB = kInnerAtmosphereRadius * kInnerAtmosphereRadius;
  const float rcB = (kOuterAtmosphereRadius + kInnerAtmosphereRadius) * 0.5;
  const float rzB = (kOuterAtmosphereRadius - kInnerAtmosphereRadius) * 0.5;
  const float rzxB = rzB / (0.05 * kInnerAtmosphereRadius);
  const vec4 kEllipseB = vec4(rcB, rzxB * rzxB, 1.0 - rzxB * rzxB, rzB * rzB);
  float r0Sq = cameraAndSunState.x >= kPlanetRadius ? r0SqA : r0SqB;
  vec4 ellipse = cameraAndSunState.x >= kPlanetRadius ? kEllipseA : kEllipseB;
  float dr = r - ellipse.x;
  float A = ellipse.y + mu * mu * ellipse.z;
  float B = dr * mu;
  float C = dr * dr - ellipse.w;
  float dist1 = max((-B + sqrt(B * B - A * C)) / A, 1e-6);
  rMu = min(rMu, -sqrt(r * r - r0Sq) - 0.002);
  float delta = rMu * rMu - r * r + r0Sq;
  float dist2 = -rMu - sqrt(delta);
  return dist1 < dist2 ? vec2(dist1, dist2) : vec2(dist2, dist1);
}
float inverseSigmoid(float y) {
  return y == 0.0 ? 0.0 : (1.0 - sqrt(1.0 - y * y)) / y;
}
float inverseGetMu(float r0, float mu) {
  const float kHalfInvHeight = 0.5 / kInscatterHeight;
  const float H = kMaxHorizonDist;
  float r = min(r0, kOuterAtmosphereRadius);
  float horizonDistSq = r * r - kInnerAtmosphereRadius * kInnerAtmosphereRadius;
  float horizonDist = sqrt(horizonDistSq);
  float rMu = r * mu;
  float delta = rMu * rMu - horizonDistSq;
  vec2 c = rMu < -horizonDist ? vec2(-1.0, 0.0) : vec2(1.0);
  float v = (sqrt(delta + (H * H) * c.y) - rMu * c.x) / (horizonDist + H * c.y);
  return 0.5 + kHalfInvHeight * c.x + v * (0.5 - 2.0 * kHalfInvHeight);
}
float inverseGetMuSNu(float r0, float mu, float muS0, float muS, float nu) {
  const float kA = 0.5 * (1.0 - 1.0 / kInscatterWidth);
  const float kB = 0.5 / kInscatterWidth + kA;
  float v = nu;
  float r0prime = r0 * (1.0 / kOuterAtmosphereRadius);
  if (r0prime > 1.0) {
    float ignored;
    vec2 muSBound = getMuSBound(r0prime, mu, r0prime * muS0, ignored);
    float x = (muS - muSBound.x) / (muSBound.y - muSBound.x);
    v = clamp(x * 2.0 - 1.0, -1.0, 1.0);
  }
  return inverseSigmoid(v) * kA + kB;
}
vec3 inscatter(
    float r,
    float mu,
    float rMu,
    float muS,
    float nu,
    float d,
    float exposure,
    out vec3 transmittance) {
  float r0 = max(kMinCameraRadius, cameraAndSunState.x);
  float muS0 = cameraAndSunState.y;
  float u = inverseGetMuSNu(r0, mu, muS0, muS, nu);
  float v = inverseGetMu(r0, mu) * 0.5;
  vec4 texel1 = texture2D(inscatterSampler, vec2(u, v));
  vec4 texel2 = texture2D(inscatterSampler, vec2(u, v + 0.5));
  vec2 dists = getMaxDistances(r, mu, rMu);
  vec2 ab = vec2(d / dists.x,
                 (min(dists.y, d) - dists.x) / max(dists.y - dists.x, 1e-6));
  ab = ab.x < 1.0 ? vec2(ab.x, 0.0) : vec2(1.0 - ab.y, ab.y);
  ab *= atmosphereTweak(r, mu);
  float opticalDepth = dot(vec2(texel1.a, texel2.a), ab);
  transmittance = vec3(exp((kAverageExtinctionCoefficient /
      kAverageExtinctionCoefficient.r) * opticalDepth));
  vec3 inscatter1 = texel1.rgb;
  vec3 inscatter2 = texel2.rgb;
  return inscatter1 * ab.x + inscatter2 * ab.y;
}
void aerialPerspective(
    vec3 cameraAtmo,
    vec3 posAtmo,
    vec3 sunDirAtmo,
    float exposure,
    out vec3 outTransmittance,
    out vec3 outInscatter) {
  vec3 viewRay = posAtmo - cameraAtmo;
  vec3 viewRayDir = normalize(viewRay);
  float r = cameraAndSunState.x;
  float rMu = dot(cameraAtmo, viewRayDir);
  float rMuS = dot(cameraAtmo, sunDirAtmo);
  float nu = dot(viewRayDir, sunDirAtmo);
  if (r > kOuterAtmosphereRadius) {
    const float kOuterAtmosphereRadiusSq =
        kOuterAtmosphereRadius * kOuterAtmosphereRadius;
    float delta = rMu * rMu - r * r + kOuterAtmosphereRadiusSq;
    float distanceToAtmosphereEntryPoint = -rMu - sqrt(delta);
    r = kOuterAtmosphereRadius;
    rMu += distanceToAtmosphereEntryPoint;
    rMuS += distanceToAtmosphereEntryPoint * nu;
  }
  vec3 transmittance;
  vec3 inscatterL = inscatter(r, rMu / r, rMu, rMuS / r, nu,
      length(viewRay.xyz), exposure, transmittance);
  outTransmittance = transmittance;
  outInscatter = inscatterL;
}
uniform mat4 atmoGlobeFromLocal;
varying vec4 terrainSunAndSkyR;
varying vec4 terrainTransmittanceAndSkyG;
varying vec4 terrainInscatterAndSkyB;
varying float terrainNight;
void atmosphereVertex(vec3 localPosition){
 vec3 planetPosition=(atmoGlobeFromLocal*vec4(localPosition,1.0)).xyz;
 float radius=length(planetPosition);
 vec3 up=planetPosition/radius;
 float tableRadius=cameraAndSunState.z<1e7?radius:kPlanetRadius;
 float mu=dot(up,sunDirAtmo);
 vec3 sun=atmoTex(tableRadius,mu).rgb*max(mu,0.0);
 vec3 sky=skyTex(tableRadius,mu);
 vec3 attenuation,scatter;
 aerialPerspective(cameraAtmo,planetPosition,sunDirAtmo,uExposureAndAtmoTweak.x,attenuation,scatter);
 terrainSunAndSkyR=vec4(sun,sky.r);
 terrainTransmittanceAndSkyG=vec4(attenuation,sky.g);
 terrainInscatterAndSkyB=vec4(scatter,sky.b);
 terrainNight=smoothstep(0.0,0.2,-mu);
}
`;
export const terrainAtmosphereFragmentDeclarations=`
uniform vec4 cameraAndSunState;
uniform vec2 uExposureAndAtmoTweak;
varying vec4 terrainSunAndSkyR;
varying vec4 terrainTransmittanceAndSkyG;
varying vec4 terrainInscatterAndSkyB;
varying float terrainNight;
vec3 applyTerrainAtmosphere(vec3 rawColor){
 vec3 sky=vec3(terrainSunAndSkyR.w,terrainTransmittanceAndSkyG.w,terrainInscatterAndSkyB.w);
 vec3 incident=terrainSunAndSkyR.xyz+max(sky,vec3(.014*terrainNight));
 vec3 radiance=rawColor*rawColor*(.55/3.141592657)*incident;
 float luminance=dot(radiance,vec3(.2126,.7152,.0722));
 radiance=mix(luminance*vec3(.874,.874,2.622),radiance,1.0-.75*terrainNight);
 radiance=radiance*terrainTransmittanceAndSkyG.xyz+terrainInscatterAndSkyB.xyz;
 radiance*=uExposureAndAtmoTweak.x;
 vec3 mapped=vec3(1.0)-exp(-(sqrt(radiance)+radiance)/1.8);
 return mix(rawColor,mapped,cameraAndSunState.w);
}
`;

function lookupTexture(encoded,width,height){
 const texture=new DataTexture(bytes(encoded),width,height,RGBAFormat,UnsignedByteType);
 texture.colorSpace=NoColorSpace;texture.flipY=false;texture.generateMipmaps=false;
 texture.minFilter=texture.magFilter=LinearFilter;texture.wrapS=texture.wrapT=ClampToEdgeWrapping;texture.unpackAlignment=1;texture.needsUpdate=true;return texture;
}
function createOwner(renderer){
 const atmo=lookupTexture(TRANSMITTANCE,8,128),sky=lookupTexture(SKY_IRRADIANCE,64,16);
 const target=new WebGLRenderTarget(64,128,{type:FloatType,format:RGBAFormat,minFilter:LinearFilter,magFilter:LinearFilter,depthBuffer:false,stencilBuffer:false});
 target.texture.colorSpace=NoColorSpace;target.texture.generateMipmaps=false;
 const material=new ShaderMaterial({uniforms:{cameraAndSunState:{value:new Vector4()},atmoSampler:{value:atmo},uExposureAndAtmoTweak:{value:[20,3]}},vertexShader:'void main(){gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:atmospherePrecomputeShader,depthTest:false,depthWrite:false,blending:NoBlending,toneMapped:false});
 const scene=new Scene(),geometry=new PlaneGeometry(2,2),quad=new Mesh(geometry,material),camera=new OrthographicCamera(-1,1,1,-1,0,1);quad.frustumCulled=false;scene.add(quad);
 const owner={refs:0,atmo,sky,target,key:null,viewport:new Vector4(),scissor:new Vector4(),render(parameters,exposure,tweakValue){
  const key=parameters.x+':'+parameters.y+':'+exposure;if(key===this.key)return;
  const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear,autoReset=renderer.info.autoReset,scissorTest=renderer.getScissorTest(),xr=renderer.xr.enabled;
  renderer.getViewport(this.viewport);renderer.getScissor(this.scissor);
  material.uniforms.cameraAndSunState.value.set(parameters.x,parameters.y,1,0);material.uniforms.uExposureAndAtmoTweak.value=[exposure,tweakValue];
  try{renderer.xr.enabled=false;renderer.autoClear=false;renderer.info.autoReset=false;renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.render(scene,camera);this.key=key;}
  finally{renderer.setRenderTarget(previous);renderer.setViewport(this.viewport);renderer.setScissor(this.scissor);renderer.setScissorTest(scissorTest);renderer.autoClear=autoClear;renderer.info.autoReset=autoReset;renderer.xr.enabled=xr;}
 },dispose(){atmo.dispose();sky.dispose();target.dispose();material.dispose();geometry.dispose();}};
 return owner;
}

/** Own one material's reference to the renderer's shared atmosphere resources. */
export function createTerrainAtmosphereUniforms(){
 const uniforms={atmoGlobeFromLocal:{value:new Matrix4()},cameraAndSunState:{value:new Vector4(1,0,0,0)},cameraAtmo:{value:new Vector3()},sunDirAtmo:{value:new Vector3()},uExposureAndAtmoTweak:{value:[20,3]},atmoSampler:{value:null},skySampler:{value:null},inscatterSampler:{value:null}};
 const inverse=new Matrix4(),normalizer=new Matrix4(),up=new Vector3(),east=new Vector3(),north=new Vector3(),forward=new Vector3(),screenUp=new Vector3();let owner=null,boundRenderer=null,released=false;
 const releaseOwner=()=>{if(owner&&--owner.refs===0){owner.dispose();owners.delete(boundRenderer);}owner=null;boundRenderer=null;};
 return {uniforms,update(renderer,camera,mesh,{worldFromGlobe,radius=6371010,sunDirection,exposure=20,tweak:atmosphereTweakValue=3,atmosphereFading,groundRadius,heightAboveGround,automatic=true,widthScale=1,heading}={}){
  if(released)return;if(!owner||boundRenderer!==renderer){releaseOwner();owner=owners.get(renderer);if(!owner){owner=createOwner(renderer);owners.set(renderer,owner);}owner.refs++;boundRenderer=renderer;uniforms.atmoSampler.value=owner.atmo;uniforms.skySampler.value=owner.sky;uniforms.inscatterSampler.value=owner.target.texture;}
  inverse.copy(worldFromGlobe??mesh.userData.planetRoot?.matrixWorld??identity).invert();normalizer.makeScale(1/radius,1/radius,1/radius).multiply(inverse);
  uniforms.atmoGlobeFromLocal.value.copy(normalizer).multiply(mesh.matrixWorld);
  uniforms.cameraAtmo.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(normalizer);
  const position=uniforms.cameraAtmo.value,radial=position.length(),r=Math.max(6350/6360+1e-7,radial);
  up.copy(position).normalize();east.set(-up.y,up.x,0);if(east.lengthSq()<1e-20)east.set(0,1,0);else east.normalize();north.crossVectors(up,east);
  camera.getWorldDirection(forward).transformDirection(inverse);
  const tangentLength=Math.hypot(forward.dot(east),forward.dot(north));
  if(heading===undefined){if(tangentLength>1e-8)heading=Math.atan2(forward.dot(east),forward.dot(north));else{screenUp.setFromMatrixColumn(camera.matrixWorld,1).transformDirection(inverse);heading=Math.atan2(screenUp.dot(east),screenUp.dot(north));}}
  const sun=uniforms.sunDirAtmo.value;if(sunDirection)sun.copy(sunDirection).normalize();else cameraRelativeSun(up,east,north,heading,(radial-1)*radius,sun);
  const fov=(camera.getEffectiveFOV?.()??camera.fov??35)*Math.PI/180;
  const height=heightAboveGround??radial*radius-(groundRadius??radius),tilt=Math.acos(clamp(-forward.dot(up),-1,1));
  const fading=atmosphereFading??(automatic?automaticAtmosphereFade(height,fov,tilt,widthScale):1);
  uniforms.cameraAndSunState.value.set(r,position.dot(sun)/r,2*radius*(r-1)*Math.tan(fov/2),fading);
  uniforms.uExposureAndAtmoTweak.value[0]=exposure;uniforms.uExposureAndAtmoTweak.value[1]=atmosphereTweakValue;
  owner.render(uniforms.cameraAndSunState.value,exposure,atmosphereTweakValue);
 },release(){if(released)return;released=true;releaseOwner();}};
}
