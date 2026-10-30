import test from 'node:test';
import assert from 'node:assert/strict';
import {Explorer} from '../src/demo/Player.js';
import {parsePlaces} from '../src/demo/LocationSearch.js';

test('wheel flight speed increases actual movement, clamps to default and leaves walking unchanged',()=>{
 const world={capsuleIntersect:()=>false,rayIntersect:()=>false},bounds={min:[-1e6,-1e6,-1e6],max:[1e6,1e6,1e6]},p=new Explorer(world,bounds);
 p.adjustFlightSpeed(-100);assert.equal(p.flightMultiplier,1);
 p.flying=true;p.adjustFlightSpeed(-100);assert.equal(p.flightMultiplier,1.25);
 for(let i=0;i<240;i++)p.step(1/240,{KeyW:true,Space:true},0);
 assert.ok(p.velocity.z< -9.9);assert.equal(p.velocity.y,7.5);
 for(let i=0;i<100;i++)p.adjustFlightSpeed(-100);assert.equal(p.flightMultiplier,16);
 for(let i=0;i<100;i++)p.adjustFlightSpeed(100);assert.equal(p.flightMultiplier,1);
 for(const invalid of [0,NaN,Infinity])p.adjustFlightSpeed(invalid);assert.equal(p.flightMultiplier,1);
 p.flightMultiplier=16;p.flying=false;for(let i=0;i<240;i++)p.step(1/240,{KeyW:true},0);assert.ok(Math.abs(p.velocity.z+3.1)<.001);
});

test('place search validates GeoJSON coordinates and keeps provider names as text',()=>{
 const feature=(coordinates,properties)=>({type:'Feature',geometry:{type:'Point',coordinates},properties});
 const places=parsePlaces({features:[feature([12.5,41.9],{name:'Rome',country:'Italy',osm_value:'city'}),feature([13,42],{street:'Via Roma',housenumber:'5',city:'Town'}),feature([1,2],{name:'<script>name</script>'}),feature([12,42],{name:'Italy',type:'country'}),feature([12.4,41.9],{name:'Via Roma',type:'street'}),feature(['12',41],{name:'Invalid'}),feature([12,100],{name:'Invalid'}),null]});
 assert.equal(places.length,5);assert.equal(places[3].height,2200000);assert.equal(places[4].height,1200);assert.equal(places[0].height,35000);assert.equal(places[0].latitude,41.9);assert.equal(places[1].name,'Via Roma 5');assert.equal(places[2].name,'<script>name</script>');
 assert.throws(()=>parsePlaces({}),/Invalid/);assert.deepEqual(parsePlaces({features:[]}),[]);
});
