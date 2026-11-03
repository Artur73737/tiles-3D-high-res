import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Matrix4,Frustum} from 'three';
import {EarthHQStreaming} from '../src/streamer.js';
import {TileFade} from '../src/transitions.js';

function scene(){
 const streamer=new EarthHQStreaming({source:{},screenSpaceError:1});
 streamer.viewCut=new Map();streamer.currentDemand={normal:new Vector3(1,0,0),radius:2000,collisionRadius:0};
 streamer.cameraView={position:new Vector3(6371010,0,0),direction:new Vector3(0,1,0),pixelScale:1000,projection:new Matrix4(),frustum:new Frustum()};
 const add=(path,score=2,mask=255)=>{
  const descriptor={key:path,path,center:new Vector3(6371010,500,0),radius:0,metersPerTexel:2**score*500/800,leaf:false,hasData:true};
  const asset={descriptor,nonEmptyOctants:mask,angularWeight:0,fade:new TileFade(),passes:[],setRenderPasses(passes){this.passes=passes;}};
  streamer.assets.set(path,asset);streamer.viewTree.set(path,descriptor);return asset;
 };
 const score=(asset,value)=>{asset.descriptor.metersPerTexel=2**value*500/800;};
 const frame=now=>{streamer.renderFrame++;streamer.updateTransitions(now);};
 const primary=asset=>asset.passes.filter(pass=>!pass.secondary).reduce((mask,pass)=>mask|pass.mask,0);
 const covered=path=>[...streamer.assets.values()].some(asset=>path.startsWith(asset.descriptor.path)&&path.length>asset.descriptor.path.length&&(primary(asset)&(1<<Number(path[asset.descriptor.path.length]))));
 const assertCoverage=paths=>{for(const path of paths)assert.equal(covered(path),true,'No primary coverage for '+path);};
 return {streamer,add,score,frame,primary,assertCoverage};
}

test('pending finer metadata never removes the resident fallback octant',()=>{
 const s=scene(),parent=s.add('100');s.streamer.viewTree.set('1003',{path:'1003',hasData:true,leaf:true});s.streamer.viewChildren.set('100',['1003']);
 s.frame(0);assert.equal(s.primary(parent),255);s.assertCoverage(Array.from({length:8},(_,n)=>'100'+n));assert.equal(s.streamer.transitioning,0);assert.equal(parent.fade.dependencyFrame,-1);
});

test('refinement pairs only the replaced parent octant and endpoints stop stamping dependency',()=>{
 const s=scene(),parent=s.add('100'),child=s.add('1003',-.5,5),all=Array.from({length:8},(_,n)=>'100'+n);
 s.frame(0);assert.equal(parent.passes.find(pass=>pass.id==='100').mask,247);assert.equal(s.primary(parent),255);assert.equal(s.primary(child),0);assert.equal(child.passes.find(pass=>pass.secondary).mask,5);assert.equal(parent.fade.dependencyFrame,1);s.assertCoverage(all);
 s.frame(.6);assert.equal(s.primary(parent),247);assert.equal(s.primary(child),5);assert.equal(parent.passes.find(pass=>pass.secondary).mask,8);assert.equal(parent.fade.dependencyFrame,2);s.assertCoverage(['1000','1001','1002','10030','10032','1004','1005','1006','1007']);
 s.frame(2);assert.equal(s.streamer.transitioning,0);assert.equal(parent.fade.dependencyFrame,2);assert.equal(child.fade.dependencyFrame,-1);assert.equal(child.passes.length,1);s.frame(3);assert.equal(parent.fade.dependencyFrame,2);
});

test('coarsening a resident child restores fallback coverage immediately and does not keep stale mesh passes',()=>{
 const s=scene(),parent=s.add('100'),child=s.add('1003',2);s.frame(0);assert.equal(s.primary(parent),247);assert.equal(s.primary(child),255);
 // A completed fade below T-.2 is no longer selected. Its cached metric need
 // not be advanced to zero; visible coverage and absence of passes are decisive.
 s.score(child,-2);s.frame(1);s.assertCoverage(Array.from({length:8},(_,n)=>'100'+n+'0'));s.frame(3);assert.equal(s.primary(parent),255);assert.deepEqual(child.passes,[]);assert.equal(s.streamer.transitioning,0);s.frame(4);assert.equal(s.primary(parent),255);assert.deepEqual(child.passes,[]);
});

test('nested transitions preserve the intermediate mask and stamp only their immediate dependency',()=>{
 const s=scene(),parent=s.add('100'),child=s.add('1003',2,5),grandchild=s.add('10030',-.5);
 s.frame(0);assert.equal(s.primary(parent),247);assert.equal(s.primary(child),5);assert.equal(s.primary(grandchild),0);assert.equal(child.fade.dependencyFrame,1);assert.equal(parent.fade.dependencyFrame,-1);s.assertCoverage(['1000','1001','1002','100300','10032','1004','1005','1006','1007']);
 s.frame(.6);assert.equal(s.primary(child),4);assert.equal(s.primary(grandchild),255);assert.equal(child.passes.find(pass=>pass.secondary).mask,1);assert.equal(parent.passes.some(pass=>pass.secondary),false);s.assertCoverage(['100300','100301','100307','10032']);
 s.score(grandchild,-3.1);s.frame(1);assert.deepEqual(grandchild.passes,[]);assert.equal(s.primary(child),5);assert.equal(s.primary(parent),247);s.assertCoverage(['100300','10032']);
});

test('standalone and incompatible-parent selection neither blends nor stamps a parent dependency',()=>{
 const s=scene(),parent=s.add('100',2,247),child=s.add('1003',-.5);child.fade.dependencyFrame=0;s.frame(0);
 assert.equal(s.primary(parent),247);assert.equal(s.primary(child),255);assert.equal(child.fade.alpha,1);assert.equal(child.fade.point,null);assert.equal(parent.fade.dependencyFrame,-1);assert.equal(child.fade.dependencyFrame,0);assert.equal(s.streamer.transitioning,0);
 s.streamer.assets.delete('100');s.frame(1);assert.equal(s.primary(child),255);assert.equal(child.fade.dependencyFrame,0);assert.equal(s.streamer.transitioning,0);
});

test('retained off-screen meshes do not stay selected solely because an earlier fade reached one',()=>{
 const s=scene(),parent=s.add('100'),child=s.add('1003',2);s.frame(0);assert.equal(child.fade.alpha,1);
 // Deterministic spatial boundary: only the retained child moves outside the view.
 child.descriptor.center.z=-100;s.streamer.cameraView.frustum={intersectsSphere:({center})=>center.z>=0};
 s.frame(1);assert.deepEqual(child.passes,[]);assert.equal(s.primary(parent),255);assert.equal(s.streamer.transitioning,0);
 s.frame(2);assert.deepEqual(child.passes,[]);assert.equal(s.primary(parent),255);
});

test('resident meshes reenter immediately while newly arrived and interrupted residents still fade',()=>{
 const s=scene(),parent=s.add('100'),child=s.add('1003',-.5);
 s.streamer.cameraView.frustum={intersectsSphere:({center})=>center.z>=0};
 s.frame(0);assert.ok(child.fade.alpha>0&&child.fade.alpha<1);assert.equal(s.primary(child),0);
 child.descriptor.center.z=-100;s.frame(.1);assert.deepEqual(child.passes,[]);assert.equal(s.primary(parent),255);
 // Unchanged render frames can skip selection traversal; this must not erase
 // the last observed resident/outside classification when the camera returns.
 s.streamer.renderFrame+=20;child.descriptor.center.z=0;s.frame(.2);
 assert.equal(s.primary(child),255);assert.equal(s.primary(parent),247);assert.equal(child.fade.alpha,1);assert.equal(child.fade.point,null);assert.equal(s.streamer.transitioning,0);
 child.descriptor.center.z=-100;s.frame(.3);s.streamer.assets.delete('1003');
 const replacement=s.add('1003',-.5);s.frame(.4);
 assert.ok(replacement.fade.alpha>0&&replacement.fade.alpha<1);assert.equal(s.primary(replacement),0);assert.equal(s.primary(parent),255);
 replacement.descriptor.center.z=-100;s.frame(.5);s.streamer.assets.delete('1003');s.frame(.6);
 replacement.descriptor.center.z=0;s.streamer.assets.set('1003',replacement);s.frame(.7);
 assert.ok(replacement.fade.alpha<1);assert.equal(s.streamer.transitioning,1);assert.equal(parent.passes.some(pass=>pass.id==='1003'),true);
});
