import test from 'node:test';
import assert from 'node:assert/strict';
import {TileFade} from '../src/transitions.js';
import {buildAsset,disposeAsset} from '../src/geometry.js';

test('time fade retains the source endpoints and f32 first-step result',()=>{
 const fade=new TileFade();assert.equal(fade.update(-.5,0),0.05000000074505806);
 assert.equal(fade.update(-.5,0),0.05000000074505806);
 assert.equal(fade.update(-.5,1),1);assert.equal(fade.anchor,1);
 assert.equal(fade.update(-3,2),0);assert.equal(fade.anchor,-3);
});

test('paired selection keeps an opaque side and bypasses fade on rapid consecutive projected motion',()=>{
 const fade=new TileFade(),first=fade.pair(-.5,0,{x:0,y:0},1);
 assert.equal(first.current,false);assert.ok(first.blend>1/64&&first.blend<1);
 const rapid=fade.pair(-.5,.016,{x:.2,y:0},2);assert.deepEqual(rapid,{current:true,blend:0});
 const slow=new TileFade();slow.pair(-.5,0,{x:0,y:0},1);
 assert.ok(slow.pair(-.5,.016,{x:.01,y:0},2).blend>0);
});

test('transition passes share immutable geometry and dispose it once with their owning asset',async()=>{
 const vertices=new Uint8Array(24);vertices.set([0,0,0],0);vertices.set([1,0,0],8);vertices.set([0,1,0],16);
 const asset=await buildAsset({matrixGlobeFromMesh:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],meshes:[{vertices,indices:new Uint16Array([0,1,2])}],overlaySurfaceMeshes:[]},{key:'1',path:'1'});
 let disposals=0;const geometry=asset.meshes[0].geometry;geometry.addEventListener('dispose',()=>disposals++);
 asset.setRenderPasses([{id:'base',mask:254,secondary:false},{id:'child',mask:1,opacity:.4,secondary:true}]);
 const secondary=asset.passes.get('child')[0];assert.equal(secondary.geometry,geometry);assert.equal(secondary.material.uniforms.tileMask.value,1);assert.equal(secondary.material.depthWrite,false);
 asset.setRenderPasses([{id:'base',mask:255,secondary:false}]);assert.equal(asset.passes.size,0);assert.equal(disposals,0);
 disposeAsset(asset);disposeAsset(asset);assert.equal(disposals,1);
});


test('nonempty layer four disables paired transitions as in the source mesh flags',async()=>{
 const vertices=new Uint8Array([0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0]);
 const payload={matrixGlobeFromMesh:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],meshes:[{vertices,indices:new Uint16Array([0,1,2]),layerBounds:[0,0,0,3,3,4]}],overlaySurfaceMeshes:[]};
 const asset=await buildAsset(payload,{key:'1',path:'1'});try{assert.equal(asset.fadeEligible,false);}finally{disposeAsset(asset);}
});
