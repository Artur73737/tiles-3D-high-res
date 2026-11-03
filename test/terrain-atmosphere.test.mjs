import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Vector3,Vector4,PerspectiveCamera,Mesh,Group} from 'three';
import {createTerrainAtmosphereUniforms,cameraRelativeSun,automaticAtmosphereFade} from '../src/terrain-atmosphere.js';

function renderer(){
 const state={target:{host:true},viewport:new Vector4(5,7,91,103),scissor:new Vector4(11,13,83,89),scissorTest:true,renders:0,fail:false};
 return {state,autoClear:true,info:{autoReset:true},xr:{enabled:true},getRenderTarget(){return state.target;},setRenderTarget(v){state.target=v;},getViewport(v){return v.copy(state.viewport);},setViewport(v){state.viewport.copy(v);},getScissor(v){return v.copy(state.scissor);},setScissor(v){state.scissor.copy(v);},getScissorTest(){return state.scissorTest;},setScissorTest(v){state.scissorTest=v;},render(){state.renders++;if(state.fail)throw Error('GPU rejected precompute');}};
}
function frame(){const root=new Group(),mesh=new Mesh(),camera=new PerspectiveCamera(45,1,.1,10000);root.position.set(10,-20,30);root.rotation.z=.4;root.add(mesh);mesh.userData.planetRoot=root;mesh.position.set(6371010,0,0);root.updateMatrixWorld(true);camera.position.set(6371110,0,0).applyMatrix4(root.matrixWorld);camera.lookAt(mesh.getWorldPosition(new Vector3()));camera.updateMatrixWorld();return {root,mesh,camera};}

test('atmosphere LUTs are shared per renderer and released with the final material owner',()=>{
 const a=createTerrainAtmosphereUniforms(),b=createTerrainAtmosphereUniforms(),r=renderer(),{mesh,camera}=frame();a.update(r,camera,mesh);b.update(r,camera,mesh);
 assert.equal(r.state.renders,1);assert.equal(a.uniforms.atmoSampler.value,b.uniforms.atmoSampler.value);assert.equal(a.uniforms.inscatterSampler.value,b.uniforms.inscatterSampler.value);
 let disposed=0;for(const texture of [a.uniforms.atmoSampler.value,a.uniforms.skySampler.value])texture.addEventListener('dispose',()=>disposed++);
 a.release();a.release();assert.equal(disposed,0);b.release();assert.equal(disposed,2);
 const c=createTerrainAtmosphereUniforms();c.update(r,camera,mesh);assert.notEqual(c.uniforms.atmoSampler.value,a.uniforms.atmoSampler.value);assert.equal(r.state.renders,2);c.release();
});

test('atmosphere precompute restores host rendering state when GPU rendering throws and can retry',()=>{
 const a=createTerrainAtmosphereUniforms(),r=renderer(),{mesh,camera}=frame(),target=r.state.target,viewport=r.state.viewport.clone(),scissor=r.state.scissor.clone();r.state.fail=true;
 assert.throws(()=>a.update(r,camera,mesh),/GPU rejected/);assert.equal(r.state.target,target);assert.deepEqual(r.state.viewport,viewport);assert.deepEqual(r.state.scissor,scissor);assert.equal(r.state.scissorTest,true);assert.equal(r.autoClear,true);assert.equal(r.info.autoReset,true);assert.equal(r.xr.enabled,true);
 r.state.fail=false;a.update(r,camera,mesh);assert.equal(r.state.renders,2);a.release();
});

test('atmosphere owns the globe transform and normalizes mesh and camera positions consistently',()=>{
 const a=createTerrainAtmosphereUniforms(),r=renderer(),{mesh,camera}=frame();a.update(r,camera,mesh,{atmosphereFading:.5});
 const cameraPosition=a.uniforms.cameraAtmo.value;assert.ok(cameraPosition.distanceTo(new Vector3(6371110/6371010,0,0))<1e-12);
 const surface=new Vector3().applyMatrix4(a.uniforms.atmoGlobeFromLocal.value);assert.ok(surface.distanceTo(new Vector3(1,0,0))<1e-12);assert.equal(a.uniforms.cameraAndSunState.value.w,.5);
 camera.position.add(new Vector3(0,0,20));camera.updateMatrixWorld();a.update(r,camera,mesh);assert.equal(r.state.renders,2);a.release();
});

// Independent runtime observation: Rome camera/heading and actual program28 uniform.
test('default camera-relative sunlight reproduces the captured directional-light observation',()=>{
 const up=new Vector3(.7268370985984802,.16101299226284027,.6677042245864868).normalize(),east=new Vector3(-up.y,up.x,0).normalize(),north=new Vector3().crossVectors(up,east);
 const actual=cameraRelativeSun(up,east,north,37.4373496*Math.PI/180,147),observed=new Vector3(.908021092414856,-.32466238737106323,.2647492289543152);
 assert.ok(actual.distanceTo(observed)<2e-5); // URL heading rounded; live camera may move slightly.
 assert.ok(Math.abs(actual.dot(up)-1/Math.sqrt(1.625))<1e-12);
 const far=cameraRelativeSun(new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1),0,2000000);
 assert.ok(far.distanceTo(new Vector3(1,-.75,.75).normalize())<1e-12);
});

test('automatic atmosphere fades with camera tilt and view span instead of a captured constant',()=>{
 const fov=35*Math.PI/180;
 assert.equal(automaticAtmosphereFade(100,fov,0),0);
 assert.equal(automaticAtmosphereFade(100,fov,Math.PI/2),1);
 assert.equal(automaticAtmosphereFade(15000000,fov,0),1);
 const low=automaticAtmosphereFade(100,fov,Math.PI/3),high=automaticAtmosphereFade(1000,fov,Math.PI/3);
 assert.ok(low>0&&low<1&&high>low);
});
