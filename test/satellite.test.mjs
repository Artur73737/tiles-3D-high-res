import test from 'node:test';
import assert from 'node:assert/strict';
import {satelliteBounds,SatelliteLayer} from '../src/satellite.js';
import {Vector3,FrontSide} from 'three';

test('viewer satellite tiles use Web Mercator bounds with continuous edges and longitude wrap',()=>{
 const world=satelliteBounds(0,0,0);assert.equal(world.west,-180);assert.equal(world.east,180);assert.ok(Math.abs(world.north-85.05112878)<1e-7);assert.equal(world.south,-world.north);
 const a=satelliteBounds(18,140000,97000),east=satelliteBounds(18,140001,97000),south=satelliteBounds(18,140000,97001);assert.equal(a.east,east.west);assert.equal(a.south,south.north);
});

test('absent satellite detail retains its parent and prevents repeated child requests',async()=>{
 let requested;
 const s=new SatelliteLayer({fetch:async url=>{requested=new URL(url);return new Response('',{status:404});}});
 try{const node=s.node(20,1,1);s.needed.add(node.key);await s.load(node,new AbortController().signal);assert.ok(node.missingUntil>Date.now());assert.equal(s.resident.size,0);assert.equal(s.status().error,null);assert.equal(s.maxZoom,22);assert.equal(requested.hostname,'mt1.google.com');assert.equal(requested.searchParams.get('lyrs'),'s');assert.equal(requested.searchParams.get('z'),'20');}finally{await s.dispose();}
});

test('satellite patches face outward and cannot paint the hidden hemisphere over the globe',async()=>{
 const s=new SatelliteLayer({renderer:{capabilities:{getMaxAnisotropy:()=>8}}});
 const node=s.node(4,8,8),mesh=s.build(node,{close(){}}),p=mesh.geometry.attributes.position,index=mesh.geometry.index;
 const a=new Vector3().fromBufferAttribute(p,index.getX(0)),b=new Vector3().fromBufferAttribute(p,index.getX(1)),c=new Vector3().fromBufferAttribute(p,index.getX(2)),normal=b.sub(a).cross(c.sub(a));
 assert.equal(mesh.material.side,FrontSide);assert.ok(normal.dot(a.clone().add(node.center))>0);
 mesh.geometry.dispose();mesh.material.map.dispose();mesh.material.dispose();await s.dispose();
});

test('satellite parents stop drawing only after every selected child is resident',()=>{
 const s=new SatelliteLayer(),parent=s.node(3,1,1),children=[s.node(4,2,2),s.node(4,3,2),s.node(4,2,3),s.node(4,3,3)];
 const record=node=>({node,mesh:{visible:true}});s.needed=new Set([parent,...children].map(n=>n.key));s.resident.set(parent.key,record(parent));
 for(const child of children.slice(0,3))s.resident.set(child.key,record(child));s.updateVisibility();assert.equal(s.resident.get(parent.key).mesh.visible,true);
 s.resident.set(children[3].key,record(children[3]));s.updateVisibility();assert.equal(s.resident.get(parent.key).mesh.visible,false);
 s.resident.delete(children[0].key);s.updateVisibility();assert.equal(s.resident.get(parent.key).mesh.visible,true);s.resident.clear();
});
