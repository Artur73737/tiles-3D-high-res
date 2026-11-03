import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TileFade} from '../src/transitions.js';
if(!process.argv[2])throw Error('Usage: node test/reference-fade.mjs /path/to/captured/earthplugin_web.wasm');
const bytes=readFileSync(process.argv[2]);
const sha256=createHash('sha256').update(bytes).digest('hex');
if(sha256!=='43a58f7cd6f96202771a05db16ce3b72e0a1cd8d319a1d55bbc8c6ef9b66d63f')throw Error('Reference artifact identity mismatch');
const index={8336:{start:3869613,end:3870264},12315:{start:6479803,end:6479911}};
const leb=n=>{const a=[];do{let b=n&127;n>>>=7;a.push(b|(n?128:0));}while(n);return a;};
const read=(data,pos)=>{let n=0,s=0,b;do{b=data[pos.i++];n|=(b&127)<<s;s+=7;}while(b&128);return n>>>0;};
const sections=new Map();for(let p={i:8};p.i<bytes.length;){let id=bytes[p.i++],len=read(bytes,p);sections.set(id,bytes.subarray(p.i,p.i+len));p.i+=len;}
const functions=sections.get(3),p={i:0},count=read(functions,p),types=[];for(let i=0;i<count;i++)types.push(read(functions,p));
const section=(id,a)=>[id,...leb(a.length),...a];
const body=id=>{const {start,end}=index[id];return [...bytes.subarray(start,end)];};
const bodies=[[0,11],body(12315),body(8336)];
const names=['frame','reset','step'];
const output=new Uint8Array([0,97,115,109,1,0,0,0,...section(1,[...sections.get(1)]),...section(3,[3,...leb(2),...leb(types[12315-385]),...leb(types[8336-385])]),...section(4,[1,0x70,0,2]),...section(5,[1,3,...leb(160),...leb(160)]),...section(7,[4,...names.flatMap((s,i)=>[s.length,...Buffer.from(s),0,i]),6,...Buffer.from('memory'),2,0]),...section(9,[1,0,0x41,0,0x0b,2,0,1]),...section(10,[3,...bodies.flatMap(b=>[...leb(b.length),...b])])]);
const instance=await WebAssembly.instantiate(output),w=instance.instance.exports,d=new DataView(w.memory.buffer),state=2048;
d.setInt32(state,1024,true);d.setInt32(1024+8,0,true);d.setInt32(1024+20,1,true);d.setUint8(9804952,1);d.setFloat32(9804956,1,true);d.setFloat32(9804960,2,true);
let cases=0;for(const base of [0,3600,86400])for(const sequence of [[-.5,-.5,-.5,-.5],[2,-1.5,-1.5,-1.5,-1.5],[-.5,-1.2,-.7,-2,0,3],[-3,-1,-.99,-.2,.2,1],Array.from({length:600},(_,i)=>Math.sin(i*.065)*2-1)]){
 const fade=new TileFade();d.setInt32(state+4,1,true);d.setFloat32(state+8,0,true);d.setFloat32(state+12,-1,true);d.setFloat32(state+16,0,true);d.setFloat64(state+24,-1,true);d.setFloat64(state+32,-1,true);
 for(let i=0;i<sequence.length;i++){const score=sequence[i],now=base+i/60;w.step(state,1,score,now);fade.update(score,now);for(const [name,offset,type]of [['alpha',8,'Float32'],['anchor',16,'Float32'],['lastTime',24,'Float64'],['start',32,'Float64']]){const original=d['get'+type](state+offset,true);if(original!==fade[name])throw Error(JSON.stringify({i,score,name,original,actual:fade[name]}));}cases++;}
}
console.log(JSON.stringify({sha256,cases,ok:true}));
