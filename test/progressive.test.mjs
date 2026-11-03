import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Vector3,Group,PerspectiveCamera} from 'three';
import decode from '../src/vendor/rocktree-decoder.cjs';
import {EarthHQStreaming} from '../src/streamer.js';
import {PlayerWorld} from '../src/demo/PlayerWorld.js';
import {localFrame,geoToECEF} from '../src/geo.js';
import {ByteTransport} from '../src/transport.js';
import {MemoryByteCache} from '../src/cache.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
const payload=async()=>(await decode(1,new Uint8Array(readFileSync(new URL('./fixtures/node.pb',import.meta.url))))).payload;
function source(){
 const parent={path:'1',key:'parent',leaf:false,hasData:true,center:new Vector3(6371010,0,0),radius:100,epoch:1};
 const leaves=[{...parent,path:'10',key:'a',radius:10,leaf:true},{...parent,path:'11',key:'b',radius:10,leaf:true}];
 return {parent,leaves,root:async()=>({radius:6371010,epoch:1}),copyrights:async()=>new Map(),children:async n=>n.root?[parent]:leaves,loadNode:payload,clear(){}};
}

test('local collision inventory ignores far arrivals but refreshes after movement and demand replacement',()=>{
 const s=new EarthHQStreaming({source:source()}),world=new PlayerWorld(s),frame=localFrame(0,0);
 const node=(key,east)=>({key,center:geoToECEF(0,0).add(new Vector3(0,east,0)),radius:1});
 const near=node('near',0),far=node('far',100),asset=n=>({descriptor:n,group:new Group()});
 s.wanted=new Map([['near',near],['far',far]]);s.assets.set('near',asset(near));s.committedSpec={focus:geoToECEF(0,0),radius:200};
 world.setFrame(frame);world.refresh(new Vector3(),{all:true});assert.equal(world.readyAt(new Vector3()),true);assert.equal(world.nearRequired.size,1);
 s.assets.set('far',asset(far));s.dispatchEvent({type:'tile-load',asset:s.assets.get('far')});assert.equal(world.dirty,false);
 s.wanted=new Map([['missing',node('missing',0)]]);assert.equal(world.readyAt(new Vector3()),false);
 s.wanted=new Map([['far',far]]);world.refresh(new Vector3(100,0,0),{all:true});assert.equal(world.nearRequired.has('far'),true);assert.equal(world.readyAt(new Vector3(100,0,0)),true);
 world.dispose();
});

test('GPU capacity exhaustion stops scheduling distant downloads and can resume after a budget increase',async()=>{
 const data=source();data.leaves=Array.from({length:40},(_,i)=>({...data.leaves[0],path:'1'+i,key:'leaf-'+i}));data.children=async n=>n.root?[data.parent]:data.leaves;
 let loads=0;data.loadNode=async()=>{loads++;return payload();};
 const s=new EarthHQStreaming({source:data,concurrency:2,maxGpuBytes:1});
 try{const result=await s.requestRegion({latitude:0,longitude:0});assert.equal(result.complete,false);assert.equal(result.requiredLeaves,40);assert.ok(loads<=2);s.setGpuBudget(128*1024**2);const retried=await s.waitForIdle();assert.equal(retried.complete,true);assert.equal(retried.readyLeaves,40);}finally{await s.dispose();}
});

test('visible payload requests bypass queued metadata while concurrency and deduplication remain bounded',async()=>{
 const order=[];let release;const cache=new MemoryByteCache(),transport=new ByteTransport({cache,concurrency:1,fetch:async url=>{order.push(url);if(order.length===1)await new Promise(r=>{release=r;});return new Response(new Uint8Array([1]));}});
 try{const first=transport.get('first');while(!release)await tick();const metadata=transport.get('metadata'),visible=transport.get('visible',{priority:1}),duplicate=transport.get('visible',{priority:1});await tick();release();await Promise.all([first,metadata,visible,duplicate]);assert.deepEqual(order,['first','visible','metadata']);}finally{await transport.dispose();await cache.close();}
});

test('reference queue order uses traversal mode and score before payload-kind tie breaking',async()=>{
 const order=[];let release;const cache=new MemoryByteCache(),transport=new ByteTransport({cache,concurrency:1,fetch:async url=>{order.push(url);if(order.length===1)await new Promise(r=>release=r);return new Response('ok');}});
 try{const first=transport.get('first');while(!release)await tick();
 const jobs=[transport.get('imagery',{priority:[-3,100,1,10,1]}),transport.get('low-payload',{priority:[-1,100,1,1,1]}),transport.get('high-metadata',{priority:[-1,100,1,5,0]}),transport.get('high-payload',{priority:[-1,100,1,5,1]})];
 await tick();release();await Promise.all([first,...jobs]);assert.deepEqual(order,['first','high-payload','high-metadata','low-payload','imagery']);}finally{await transport.dispose();await cache.close();}
});

test('canceling discovery waits for bounded active branches without requesting the obsolete frontier',async()=>{
 const data=source(),releases=[];
 data.children=async node=>node.root?Array.from({length:8},(_,i)=>({...data.parent,path:String(i),key:'branch-'+i})):new Promise(resolve=>{releases.push(()=>resolve(data.leaves));});
 const s=new EarthHQStreaming({source:data,concurrency:6});const pending=s.requestRegion({latitude:0,longitude:0}).catch(error=>error);
 try{
  for(let i=0;i<1000&&releases.length<6;i++)await tick();
  assert.equal(releases.length,6);s.setEnabled(false);for(const release of releases)release();
  await pending;assert.equal(releases.length,6);assert.equal(s.assets.size,0);assert.equal(s.getCoverage().status,'paused');
 }finally{for(const release of releases)release();await s.dispose();}
});

test('view demand ranks larger projected errors ahead of smaller texels',()=>{
 const s=new EarthHQStreaming({source:source(),screenSpaceError:1}),position=new Vector3(6371110,0,0),direction=new Vector3(0,1,0),spec={focus:new Vector3(6371010,0,0),cameraView:{position,direction,pixelScale:1000}};
 const base={path:'100',flags:0,center:new Vector3(6371010,500,0),radius:10},a={...base,key:'a',metersPerTexel:10},b={...base,key:'b',metersPerTexel:.1};s.wanted=new Map([['b',b],['a',a]]);s.sortTileQueue(spec);assert.equal(s.nextTile().key,'a');assert.equal(s.nextTile().key,'b');
});
