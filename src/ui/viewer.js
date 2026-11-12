// Tiles viewer: an iframe with the full control panel, driven by the same Tiles2D/Tiles3D API.
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {Tiles2D,GOOGLE_LAYERS,resolveLayers} from '../api/tiles2d.js';
import {Tiles3D} from '../api/tiles3d.js';
import {geoToECEF,ecefToGeo} from '../core/geo.js';
import {HTML} from './template.js';
import {Geocoder} from '../api/geocode.js';
import {TileEnhancer,enhanceSupported} from '../api/enhance.js';
import {SharpenPass} from './scene/postfx.js';
import {createGlobe} from './scene/globe.js';
import {detectDevice,inputOf,DEVICES} from './input/device.js';
import {trackGestures} from './input/gestures.js';
import {createFlyPad} from './input/flypad.js';
import {createTileStream,cameraEye,MAX_RADIUS_M} from './scene/stream3d.js';

const LAYER_LABEL={s:'satellite',y:'hybrid',h:'labels',m:'roadmap',p:'terrain+',t:'relief',r:'roads',traffic:'traffic',transit:'transit',bike:'bike'};
const STYLE_PRESETS={'':'None','s.e:l|p.v:off':'No labels','p.s:-100':'Grayscale','p.s:-100|p.l:-60':'Dark gray','s.t:3|p.v:off':'No roads','p.v:simplified':'Simplified','custom':'Custom'};
const REFERRER=['','no-referrer','no-referrer-when-downgrade','origin','origin-when-cross-origin','same-origin','strict-origin','strict-origin-when-cross-origin','unsafe-url'];
export const VIEWER_DEFAULTS={
 d2:{layers:['s'],scale:1,language:'en',region:'',stylePreset:'',style:'',servers:[0,1,2,3],minZoom:0,maxZoom:22,overzoom:false,query:''},
 d3:{radiusMeters:MAX_RADIUS_M,fullDetailMeters:150,nearRadiusMeters:60,headingDegrees:null,fieldOfViewDegrees:360,viewPriority:true,fadeMs:300,detail:'max',maxDepth:18,targetMetersPerTexel:0.1,textureRequest:'dxt1',layers:['terrain','overlay','water'],normals:false,order:'distance',maxTiles:20000,metadataCacheSize:200,baseUrl:'',dropDistanceMeters:3000,gpuBudgetMb:null,flySpeed:30},
 network:{concurrency:12,timeoutMs:30000,retries:2,retryDelayMs:250,headers:'',credentials:'omit',referrerPolicy:'',maxResponseMb:64},
 cache:{mode:'persistent',memoryMb:128,diskMb:1024,ttlSeconds:null},
 enhance:{sharpen2d:true,sharpness2d:0.6,denoise2d:0,upscale2d:2,enabled2d:false,sharpen3d:true,sharpness3d:0.5,enabled3d:false},
};
// One schema drives the panel, validation of UI input and programmatic set().
const SCHEMA=[
 {title:'2D layers',cls:'m2',group:'d2',side:'left',fields:[
  {key:'layers',label:'Layers',type:'checks',wide:true,resolve:resolveLayers,options:Object.keys(GOOGLE_LAYERS).map(k=>[k,LAYER_LABEL[k]===k?k:k+' · '+LAYER_LABEL[k]])},
  {key:'scale',label:'Scale',type:'select',options:[[1,'1x  256 px'],[2,'2x  512 px'],[4,'4x  1024 px']]},
  {key:'language',label:'Language',type:'text',placeholder:'hl  en, it, ja, zh-CN'},
  {key:'region',label:'Region',type:'text',placeholder:'gl  us, ru, in'},
  {key:'stylePreset',label:'Style',type:'select',options:Object.entries(STYLE_PRESETS)},
  {key:'style',label:'apistyle',type:'text',placeholder:'s.t:3|s.e:g|p.c:#ffff0000',when:c=>c.d2.stylePreset==='custom'},
 ],hint:'Satellite or hybrid, not both; at most two of hybrid, labels, roadmap, terrain+, roads. Enabling one drops the conflicting layer. Style applies to vector layers; region changes disputed borders.'},
 {title:'3D layers',cls:'m3',group:'d3',side:'left',fields:[
  {key:'layers',label:'Surfaces',type:'checks',wide:true,options:[['terrain','terrain'],['overlay','overlay'],['water','water']]},
  {key:'textureRequest',label:'Texture',type:'select',options:[['dxt1','DXT1'],['jpeg','JPEG'],['none','None  geometry']]},
  {key:'detail',label:'Detail',type:'select',options:[['max','Maximum  terminal'],['depth','Max depth'],['mpt','Target m/texel']]},
  {key:'maxDepth',label:'Max depth',type:'number',min:1,max:30,step:1,when:c=>c.d3.detail==='depth'},
  {key:'targetMetersPerTexel',label:'Target m/texel',type:'number',min:0.001,step:0.05,when:c=>c.d3.detail==='mpt'},
  {key:'normals',label:'Normals',type:'bool',text:'Compute vertex normals'},
 ]},
 {title:'2D options',cls:'m2',group:'d2',side:'right',fields:[
  {key:'servers',label:'Servers',type:'checks',options:[0,1,2,3].map(n=>[n,'mt'+n])},
  {key:'minZoom',label:'Min zoom',type:'number',min:0,max:22,step:1},
  {key:'maxZoom',label:'Max zoom',type:'number',min:0,max:22,step:1},
  {key:'overzoom',label:'Overzoom',type:'bool',text:'Use real parent tile'},
  {key:'query',label:'Extra query',type:'text',placeholder:'{"key":"value"}'},
 ]},
 {title:'3D options',cls:'m3',group:'d3',side:'right',fields:[
  {key:'radiusMeters',label:'Radius m',type:'number',min:1,max:MAX_RADIUS_M,step:50},
  {key:'fullDetailMeters',label:'Full detail m',type:'number',min:0,max:MAX_RADIUS_M,step:25,when:c=>c.d3.detail==='max'},
  {key:'nearRadiusMeters',label:'Near radius m',type:'number',min:0,step:10},
  {key:'headingDegrees',label:'Heading',type:'number',min:0,max:359,step:15,optional:true,placeholder:'all'},
  {key:'fieldOfViewDegrees',label:'Field of view',type:'number',min:1,max:360,step:15},
  {key:'viewPriority',label:'View first',type:'bool',text:'Load where the camera looks first'},
  {key:'fadeMs',label:'Fade ms',type:'number',min:0,max:2000,step:50},
  {key:'flySpeed',label:'Fly speed m/s',type:'number',min:1,max:2000,step:5,cls:'mf'},
  {key:'order',label:'Order',type:'select',options:[['distance','Distance'],['path','Octree path']]},
  {key:'maxTiles',label:'Max tiles',type:'number',min:1,step:1000},
  {key:'metadataCacheSize',label:'Metadata cache',type:'number',min:1,step:50},
  {key:'dropDistanceMeters',label:'Drop beyond m',type:'number',min:MAX_RADIUS_M,step:500},
  {key:'gpuBudgetMb',label:'GPU budget MB',type:'number',min:128,step:512,optional:true,placeholder:'auto'},
  {key:'baseUrl',label:'Endpoint',type:'text',placeholder:'https://kh.google.com/rt/earth/'},
 ]},
 {title:'Enhance',group:'enhance',id:'enhance',side:'left',fields:[
  {key:'enabled2d',label:'2D upscaler',type:'bool',text:'Enable at max zoom',cls:'m2 gate2d'},
  {key:'upscale2d',label:'Upscale',type:'select',options:[[1,'1x  sharpen only'],[2,'2x  bicubic'],[4,'4x  bicubic']],cls:'m2 gate2d'},
  {key:'sharpen2d',label:'CAS sharpen',type:'bool',text:'Contrast adaptive sharpen',cls:'m2 gate2d'},
  {key:'sharpness2d',label:'Sharpness',type:'number',min:0,max:1,step:0.05,cls:'m2 gate2d'},
  {key:'denoise2d',label:'Denoise',type:'number',min:0,max:1,step:0.05,cls:'m2 gate2d'},
  {key:'enabled3d',label:'3D sharpen',type:'bool',text:'Enable at max detail',cls:'m3 gate3d'},
  {key:'sharpness3d',label:'Sharpness',type:'number',min:0,max:1,step:0.05,cls:'m3 gate3d'},
 ]},
 {title:'Network',group:'network',side:'right',fields:[
  {key:'concurrency',label:'Concurrency',type:'number',min:1,max:64,step:1},
  {key:'timeoutMs',label:'Timeout ms',type:'number',min:0,step:1000},
  {key:'retries',label:'Retries',type:'number',min:0,max:10,step:1},
  {key:'retryDelayMs',label:'Retry delay ms',type:'number',min:0,step:50},
  {key:'maxResponseMb',label:'Max resp. MiB',type:'number',min:1,step:8},
  {key:'credentials',label:'Credentials',type:'select',options:[['omit','omit'],['same-origin','same-origin']]},
  {key:'referrerPolicy',label:'Referrer',type:'select',options:REFERRER.map(r=>[r,r||'default'])},
  {key:'headers',label:'Headers',type:'text',placeholder:'{"Accept-Language":"it"}'},
 ]},
 {title:'Cache',group:'cache',side:'right',fields:[
  {key:'mode',label:'Mode',type:'select',options:[['persistent','Persistent  IndexedDB'],['memory','Memory'],['none','None']]},
  {key:'memoryMb',label:'Memory MiB',type:'number',min:1,step:32},
  {key:'diskMb',label:'Disk MiB',type:'number',min:1,step:128,when:c=>c.cache.mode==='persistent'},
  {key:'ttlSeconds',label:'TTL s',type:'number',min:0,step:60,optional:true,placeholder:'server'},
 ]},
];
const clone=v=>JSON.parse(JSON.stringify(v));
const DEG=Math.PI/180;
const json=(text,name)=>{if(!text||!String(text).trim())return null;if(typeof text==='object')return text;try{return JSON.parse(text);}catch{throw new Error(name+': invalid JSON');}};

export function createViewer(target,options={}){
 const host=typeof target==='string'?document.querySelector(target):target;if(!host)throw new Error('createViewer: target not found');
 const iframe=document.createElement('iframe');iframe.title='Tiles viewer';iframe.setAttribute('allow','fullscreen; pointer-lock');
 iframe.style.cssText='border:0;display:block;width:'+(options.width??'100%')+';height:'+(options.height??'100%');host.append(iframe);
 const doc=iframe.contentDocument,win=iframe.contentWindow;doc.open();doc.write(HTML);doc.close();
 const $=id=>doc.getElementById(id),app=$('app'),listeners=new Map(),emit=(type,detail)=>{for(const fn of listeners.get(type)??[])try{fn(detail);}catch(e){console.error(e);}};
 const cfg=clone(VIEWER_DEFAULTS);for(const g of Object.keys(cfg))Object.assign(cfg[g],clone(options[g]??{}));
 if(cfg.d2.style&&!options.d2?.stylePreset)cfg.d2.stylePreset=cfg.d2.style in STYLE_PRESETS?cfg.d2.style:'custom';
 const state={view:options.view??'flat',maxReal:null,maxRealKey:'',reached3d:false,mode:options.mode??'2d',lat:options.latitude??41.89021,lon:options.longitude??12.49223,zoom:options.zoom??18,note:''};
 let controller=null;
 const status=(text,cls='')=>{const s=$('status');s.textContent=text;s.className=cls;emit('status',{text,level:cls||'info'});};
 const fail=e=>{status(e.message,'err');emit('error',e);};

 // ---------- controls ----------
 const controls=new Map();let menu=null;
 const closeMenu=()=>{if(!menu)return;menu.el.remove();menu.dd.classList.remove('open');menu.button.setAttribute('aria-expanded','false');menu=null;};
 function dropdown(parent,opts,value,onChange,label){
  const dd=doc.createElement('div');dd.className='dd';const button=doc.createElement('button');button.type='button';button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');if(label)button.setAttribute('aria-label',label);
  const text=doc.createElement('span'),caret=doc.createElement('i');button.append(text,caret);dd.append(button);parent.append(dd);
  let current=value;const set=v=>{current=v;const o=opts.find(o=>String(o[0])===String(v));text.textContent=o?o[1]:String(v??'');};set(value);
  const open=()=>{closeMenu();const ul=doc.createElement('ul');ul.className='menu';ul.setAttribute('role','listbox');let act=Math.max(0,opts.findIndex(o=>String(o[0])===String(current)));
   const paint=()=>[...ul.children].forEach((li,i)=>{li.classList.toggle('act',i===act);if(i===act)li.scrollIntoView({block:'nearest'});});
   opts.forEach(([v,l],i)=>{const li=doc.createElement('li');li.setAttribute('role','option');li.textContent=l;li.setAttribute('aria-selected',String(String(v)===String(current)));li.onpointerenter=()=>{act=i;paint();};li.onpointerdown=e=>{e.preventDefault();choose(i);};ul.append(li);});
   const r=button.getBoundingClientRect(),below=win.innerHeight-r.bottom;ul.style.left=r.left+'px';ul.style.minWidth=r.width+'px';doc.body.append(ul);
   const h=Math.min(ul.scrollHeight,280);if(below<h+8&&r.top>below)ul.style.top=(r.top-h+1)+'px';else ul.style.top=(r.bottom-1)+'px';
   const choose=i=>{closeMenu();button.focus();const v=opts[i][0];if(String(v)!==String(current)){set(v);onChange(v);}};
   menu={el:ul,dd,button,key:e=>{if(e.key==='ArrowDown'){act=Math.min(opts.length-1,act+1);paint();}else if(e.key==='ArrowUp'){act=Math.max(0,act-1);paint();}else if(e.key==='Enter'||e.key===' ')choose(act);else if(e.key==='Escape'){closeMenu();button.focus();}else return;e.preventDefault();}};
   dd.classList.add('open');button.setAttribute('aria-expanded','true');paint();
  };
  button.onclick=()=>menu?.dd===dd?closeMenu():open();
  button.onkeydown=e=>{if(menu?.dd===dd)return menu.key(e);if(['ArrowDown','ArrowUp','Enter',' '].includes(e.key)){e.preventDefault();open();}};
  return {set,get:()=>current,el:dd};
 }
 doc.addEventListener('pointerdown',e=>{if(menu&&!menu.el.contains(e.target)&&!menu.dd.contains(e.target))closeMenu();});
 win.addEventListener('blur',closeMenu);doc.addEventListener('scroll',closeMenu,true);
 function stepper(parent,f,value,onChange){
  const wrap=doc.createElement('div');wrap.className='step';const minus=doc.createElement('button'),input=doc.createElement('input'),plus=doc.createElement('button');
  minus.type=plus.type='button';minus.textContent='−';plus.textContent='+';minus.setAttribute('aria-label','Decrease '+f.label);plus.setAttribute('aria-label','Increase '+f.label);input.inputMode='decimal';input.setAttribute('aria-label',f.label);if(f.placeholder)input.placeholder=f.placeholder;
  wrap.append(minus,input,plus);parent.append(wrap);
  const decimals=String(f.step??1).split('.')[1]?.length??0,fmt=v=>v==null?'':String(Number(v.toFixed(Math.max(decimals,3)))),clamp=v=>Math.min(f.max??Infinity,Math.max(f.min??-Infinity,v));
  const set=v=>{input.value=fmt(v);};set(value);
  const read=()=>{const t=input.value.trim();if(!t&&f.optional)return null;const v=Number(t);if(!Number.isFinite(v))throw new Error(f.label+': not a number');return clamp(v);};
  const commit=v=>{set(v);onChange(v);};
  const bump=d=>{let v;try{v=read();}catch{v=null;}const base=v??(d>0?(f.min??0):(f.max??f.min??0));commit(clamp(Number((base+d*(f.step??1)).toFixed(6))));};
  let hold;const press=d=>{bump(d);let delay=380;const rep=()=>{bump(d);delay=Math.max(40,delay*.8);hold=setTimeout(rep,delay);};hold=setTimeout(rep,delay);};const release=()=>clearTimeout(hold);
  for(const [b,d]of [[minus,-1],[plus,1]]){b.onpointerdown=e=>{e.preventDefault();press(d);};b.onpointerup=b.onpointerleave=release;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();bump(d);}};}
  input.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();bump(e.key==='ArrowUp'?1:-1);}else if(e.key==='Enter')input.blur();};
  input.onchange=()=>{try{commit(read());}catch(e){fail(e);set(cfgValue(f));}};
  return {set};
 }
 function check(parent,label,value,onChange){
  const el=doc.createElement('div');el.className='ck';el.tabIndex=0;el.setAttribute('role','checkbox');const box=doc.createElement('span');box.className='box';const t=doc.createElement('span');t.textContent=label;el.append(box,t);parent.append(el);
  const set=v=>el.setAttribute('aria-checked',String(!!v));set(value);const toggle=()=>{const v=el.getAttribute('aria-checked')!=='true';set(v);onChange(v);};
  el.onclick=toggle;el.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();toggle();}};return {set,el};
 }
 const fieldId=(g,f)=>g+'.'+f.key;let cfgValue=f=>undefined;
 function buildPanel(){
  const left=$('left'),right=$('right');left.textContent='';right.textContent='';
  for(const sec of SCHEMA){
   const s=doc.createElement('section');if(sec.cls)s.className=sec.cls;const h=doc.createElement('h3');const ht=doc.createElement('span');ht.textContent=sec.title;h.append(ht);s.append(h);
   if(sec.id==='enhance'){const t=doc.createElement('button');t.id='enhance';t.type='button';t.disabled=true;t.textContent='Off';h.append(t);}
   for(const f of sec.fields){
    const row=doc.createElement('div');row.className='row'+(f.type==='checks'?' top':'')+(f.wide?' wide':'')+(f.cls?' '+f.cls:'');const k=doc.createElement('span');k.className='k';k.textContent=f.label;row.append(k);s.append(row);
    const get=()=>cfg[sec.group][f.key],put=v=>{cfg[sec.group][f.key]=v;refreshVisibility();if(sec.group==='enhance')enhanceChanged();else dirty();};let ctl;
    if(f.type==='number')ctl=stepper(row,f,get(),put);
    else if(f.type==='select')ctl=dropdown(row,f.options,get(),v=>{if(sec.group==='d2'&&f.key==='stylePreset'&&v!=='custom')cfg.d2.style=v;put(typeof f.options[0][0]==='number'?Number(v):v);},f.label);
    else if(f.type==='text'){const i=doc.createElement('input');i.setAttribute('aria-label',f.label);i.placeholder=f.placeholder??'';i.value=get()??'';i.onchange=()=>put(i.value.trim());i.onkeydown=e=>{if(e.key==='Enter'){put(i.value.trim());apply();}};row.append(i);ctl={set:v=>{i.value=v??'';}};}
    else if(f.type==='bool'){const box=doc.createElement('div');box.className='checks';box.style.gridTemplateColumns='1fr';row.append(box);ctl=check(box,f.text,get(),put);}
    else if(f.type==='checks'){const box=doc.createElement('div');box.className='checks';row.append(box);const items=f.options.map(([v,l])=>[v,check(box,l,get().includes(v),on=>{const cur=new Set(get());on?cur.add(v):cur.delete(v);let next=f.options.map(o=>o[0]).filter(x=>cur.has(x));if(on&&f.resolve)next=f.resolve(next,v);items.forEach(([x,c])=>c.set(next.includes(x)));put(next);})]);ctl={set:list=>items.forEach(([v,c])=>c.set(list.includes(v)))};}
    controls.set(fieldId(sec.group,f),{f,row,ctl,group:sec.group});
   }
   if(sec.hint){const p=doc.createElement('p');p.className='hint';p.textContent=sec.hint;s.append(p);}
   if(sec.id==='enhance'){const p=doc.createElement('p');p.className='hint';p.id='enhance-hint';s.append(p);}
   (sec.side==='left'?left:right).append(s);
  }
  const a=doc.createElement('div');a.className='actions';a.innerHTML='<button id="clear" type="button">Clear cache</button><button id="reset" type="button">Reset</button>';right.append(a);
  refreshVisibility();
 }
 cfgValue=f=>{for(const c of controls.values())if(c.f===f)return cfg[c.group][f.key];};
 function refreshVisibility(){for(const c of controls.values())if(c.f.when)c.row.classList.toggle('hide',!c.f.when(cfg));}
 function syncControls(){for(const c of controls.values())c.ctl.set(cfg[c.group][c.f.key]);refreshVisibility();}
 let pendingApply=false,applyTimer=0;const dirty=()=>{pendingApply=true;$('apply')?.classList.add('on');clearTimeout(applyTimer);applyTimer=setTimeout(()=>{if(pendingApply)apply();},350);};

 // ---------- API clients from cfg ----------
 function network(){const n=cfg.network,c=cfg.cache;return {concurrency:n.concurrency,timeoutMs:n.timeoutMs,retries:[n.retries,n.retryDelayMs],headers:json(n.headers,'Headers')??{},credentials:n.credentials,referrerPolicy:n.referrerPolicy||undefined,maxResponseBytes:n.maxResponseMb*1048576,cache:{mode:c.mode,memoryBytes:c.memoryMb*1048576,diskBytes:c.diskMb*1048576,ttlSeconds:c.ttlSeconds}};}
 function build2d(){const d=cfg.d2;if(!d.layers.length)throw new Error('Select at least one layer');if(!d.servers.length)throw new Error('Select at least one server');
  const c=new Tiles2D(network());c.set({layers:d.layers,scale:d.scale,language:d.language||'en',region:d.region||null,style:(d.stylePreset==='custom'?d.style:d.stylePreset)||null,servers:d.servers,zoomRange:[d.minZoom,d.maxZoom],overzoom:d.overzoom});
  const q=json(d.query,'Extra query');if(q)c.setQuery(q,{merge:false});return c;}
 function build3d(){const d=cfg.d3;if(!d.layers.length)throw new Error('Select at least one surface');
  const c=new Tiles3D({...network(),radiusMeters:d.radiusMeters,nearRadiusMeters:d.nearRadiusMeters,maxTiles:d.maxTiles,order:d.order,layers:{terrain:d.layers.includes('terrain'),overlay:d.layers.includes('overlay'),water:d.layers.includes('water')},textureRequest:d.textureRequest,normals:d.normals,metadataCacheSize:d.metadataCacheSize,coordinates:'local',textureOutput:'native'});
  if(d.baseUrl)c.setBaseUrl(d.baseUrl);c.setFieldOfView(d.fieldOfViewDegrees).setHeading(d.headingDegrees);
  if(d.detail==='depth')c.setMaxDepth(d.maxDepth);else if(d.detail==='mpt')c.setTargetResolution(d.targetMetersPerTexel);else c.setMaxResolution();return c;}

 // ---------- 2D ----------
 const canvas2d=$('map2d'),ctx2d=canvas2d.getContext('2d');let client2d=null,bitmaps=new Map(),pending=new Set(),gen2d=0;
 const dpr=()=>win.devicePixelRatio||1;
 const project=(lat,lon,z)=>{const n=2**z,s=Math.sin(Math.max(-85.05,Math.min(85.05,lat))*Math.PI/180);return {x:(lon+180)/360*n,y:(.5-Math.log((1+s)/(1-s))/(4*Math.PI))*n};};
 const unproject=(x,y,z)=>{const n=2**z;return {lon:x/n*360-180,lat:Math.atan(Math.sinh(Math.PI*(1-2*y/n)))*180/Math.PI};};
 function apply2d(){const next=build2d();client2d?.dispose();bitmaps.forEach(b=>b.bmp?.close());bitmaps=new Map();pending.clear();gen2d++;client2d=next;draw2d();}
 let raf2d=0;const draw2d=()=>{if(!raf2d)raf2d=win.requestAnimationFrame(()=>{raf2d=0;paint2d();});};
 function paint2d(){
  if(state.mode!=='2d'||state.view!=='flat'||!client2d)return;const r=dpr(),W=canvas2d.width=Math.round(canvas2d.clientWidth*r),H=canvas2d.height=Math.round(canvas2d.clientHeight*r);
  const z=drawZoom(),size=256*2**(state.zoom-z)*r,c=project(state.lat,state.lon,z),n=2**z;
  ctx2d.imageSmoothingQuality='high';ctx2d.fillStyle='#000';ctx2d.fillRect(0,0,W,H);
  const x0=Math.floor(c.x-W/2/size),x1=Math.floor(c.x+W/2/size),y0=Math.max(0,Math.floor(c.y-H/2/size)),y1=Math.min(n-1,Math.floor(c.y+H/2/size));let shown=0,want=0,errors=0;
  for(let y=y0;y<=y1;y++)for(let xx=x0;xx<=x1;xx++){const x=((xx%n)+n)%n,key=z+'/'+x+'/'+y,px=Math.round(W/2+(xx-c.x)*size),py=Math.round(H/2+(y-c.y)*size),sz=Math.round(W/2+(xx+1-c.x)*size)-px,szy=Math.round(H/2+(y+1-c.y)*size)-py;want++;
   const e=bitmaps.get(key);
   if(e?.bmp){const img=enhancedFor(e,z,x,y,key),k=e.crop;if(img&&!k){ctx2d.drawImage(img,px,py,sz,szy);shown++;continue;}if(k)ctx2d.drawImage(e.bmp,k.x*e.bmp.width/e.ts,k.y*e.bmp.height/e.ts,k.width*e.bmp.width/e.ts,k.height*e.bmp.height/e.ts,px,py,sz,szy);else ctx2d.drawImage(e.bmp,px,py,sz,szy);shown++;continue;}
   for(let d=1;d<=4&&z-d>=0;d++){const p=bitmaps.get((z-d)+'/'+(x>>d)+'/'+(y>>d));if(p?.bmp&&!p.crop){const f=2**d,s=p.bmp.width/f;ctx2d.drawImage(p.bmp,(x%f)*s,(y%f)*s,s,s,px,py,sz,szy);break;}}
   if(e?.error){errors++;ctx2d.strokeStyle='#3a1416';ctx2d.lineWidth=r;ctx2d.strokeRect(px+.5,py+.5,sz-1,szy-1);ctx2d.fillStyle='#e5484d';ctx2d.font=11*r+'px ui-monospace,Consolas,monospace';ctx2d.fillText(e.error,px+8*r,py+18*r);continue;}
   if(!pending.has(key))load2d(z,x,y,key);
  }
  checkMaxReal();updateEnhanceUi();const st=client2d.getStats(),mpp=40075016.686*Math.cos(state.lat*Math.PI/180)/(256*2**state.zoom);
  status(`2D   z${state.zoom.toFixed(1).replace('.0','')}   ${shown}/${want} tiles${errors?`   ${errors} errors`:''}   ${state.lat.toFixed(5)}, ${state.lon.toFixed(5)}   ${mpp<1?(mpp*100).toFixed(1)+' cm':mpp.toFixed(1)+' m'}/px   net ${st.networkRequests}   cache ${st.memoryHits+st.diskHits}${state.note?'   '+state.note:''}${active2d()?'   ENHANCED '+cfg.enhance.upscale2d+'x':''}`,errors?'warn':'');
 }
 // Tile zoom so each texel maps to at most one device pixel (never magnified), within the zoom range.
 function drawZoom(){const texels=client2d?.tileSize??256,want=state.zoom+Math.log2(256*dpr()/texels);return Math.max(cfg.d2.minZoom,Math.min(cfg.d2.overzoom?26:cfg.d2.maxZoom,Math.ceil(want-1e-6)));}
 function load2d(z,x,y,key){const g=gen2d;pending.add(key);
  client2d.getTile(z,x,y).then(async t=>{const bmp=await win.createImageBitmap(new win.Blob([t.bytes],{type:t.mimeType}));if(g!==gen2d){bmp.close();return;}bitmaps.set(key,{bmp,crop:t.crop,ts:t.tileSize});while(bitmaps.size>800){const k=bitmaps.keys().next().value;bitmaps.get(k).bmp?.close();bitmaps.delete(k);}emit('tile',{mode:'2d',z,x,y});},
   e=>{if(g===gen2d&&e.name!=='AbortError')bitmaps.set(key,{error:e.code==='zoom_range'?'out of range':e.code??'error'});}).finally(()=>{pending.delete(key);if(g===gen2d)draw2d();});}
 {let drag=null;canvas2d.onpointerdown=e=>{if(e.pointerType==='touch')return;drag={x:e.clientX,y:e.clientY};canvas2d.setPointerCapture(e.pointerId);};
  canvas2d.onpointermove=e=>{if(!drag)return;const z=state.zoom,c=project(state.lat,state.lon,z),p=unproject(c.x-(e.clientX-drag.x)/256,c.y-(e.clientY-drag.y)/256,z);state.lat=Math.max(-85,Math.min(85,p.lat));state.lon=((p.lon+540)%360)-180;drag={x:e.clientX,y:e.clientY};state.note='';syncCoords();draw2d();};
  canvas2d.onpointerup=canvas2d.onpointercancel=()=>{if(drag)emit('move',getView());drag=null;};
  // Touch: one or two fingers pan, pinch zooms around the fingers' midpoint.
  const pan2d=(dx,dy)=>{const z=state.zoom,c=project(state.lat,state.lon,z),p=unproject(c.x-dx/256,c.y-dy/256,z);state.lat=Math.max(-85,Math.min(85,p.lat));state.lon=((p.lon+540)%360)-180;};
  trackGestures(canvas2d,{onPan:(dx,dy)=>{pan2d(dx,dy);state.note='';syncCoords();draw2d();},
   onPinch:({scale,x,y})=>{const r=canvas2d.getBoundingClientRect(),mx=x-r.width/2,my=y-r.height/2,c=project(state.lat,state.lon,state.zoom),before=unproject(c.x+mx/256,c.y+my/256,state.zoom);
    state.zoom=Math.max(cfg.d2.minZoom,Math.min(cfg.d2.overzoom?26:cfg.d2.maxZoom,state.zoom+Math.log2(scale)));const c2=project(before.lat,before.lon,state.zoom),p=unproject(c2.x-mx/256,c2.y-my/256,state.zoom);state.lat=p.lat;state.lon=p.lon;state.note='';syncCoords();draw2d();},
   onEnd:()=>emit('move',getView())});
  canvas2d.addEventListener('wheel',e=>{e.preventDefault();const r=canvas2d.getBoundingClientRect(),mx=e.clientX-r.left-r.width/2,my=e.clientY-r.top-r.height/2,c=project(state.lat,state.lon,state.zoom),before=unproject(c.x+mx/256,c.y+my/256,state.zoom);
   state.zoom=Math.max(cfg.d2.minZoom,Math.min(cfg.d2.overzoom?26:cfg.d2.maxZoom,state.zoom-Math.sign(e.deltaY)*.5));const c2=project(before.lat,before.lon,state.zoom),p=unproject(c2.x-mx/256,c2.y-my/256,state.zoom);state.lat=p.lat;state.lon=p.lon;state.note='';syncCoords();draw2d();emit('move',getView());},{passive:false});}
 async function findMaxZoom(){status('Probing highest real zoom');const r=await client2d.findMaxZoom(state.lat,state.lon);if(r.z===null){status('No real imagery here','warn');return null;}state.note='max real zoom '+r.z;state.maxReal=r.z;state.maxRealKey='';state.zoom=r.z;syncCoords();if(state.view==='globe')globe.enter(state.mode,{lat:state.lat,lon:state.lon,zoom:r.z});else draw2d();updateEnhanceUi();emit('maxzoom',{zoom:r.z});return r.z;}
 async function exportPNG({download=true}={}){const z=Math.min(cfg.d2.maxZoom,Math.ceil(state.zoom-1e-6)),r=(state.view==='globe'?view:canvas2d).getBoundingClientRect(),c=project(state.lat,state.lon,z),a=unproject(c.x-r.width/512,c.y-r.height/512,z),b=unproject(c.x+r.width/512,c.y+r.height/512,z);status('Composing image');
  const img=await client2d.getImage({west:a.lon,north:a.lat,east:b.lon,south:b.lat},z,{maxTiles:600}),blob=await img.blob({type:'image/png'});
  if(download){const url=URL.createObjectURL(blob),l=doc.createElement('a');l.href=url;l.download=`tiles_${cfg.d2.layers.join('-')}_z${z}.png`;doc.body.append(l);l.click();l.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  status(`PNG ${img.width}x${img.height}${img.complete?'':'   incomplete: '+img.errors.length+' errors'}`,img.complete?'':'warn');return {blob,width:img.width,height:img.height,bounds:img.bounds,complete:img.complete,errors:img.errors};}

 // ---------- 3D / Fly ----------
 const view=$('view3d'),renderer=new THREE.WebGLRenderer({canvas:view,antialias:true,logarithmicDepthBuffer:true,preserveDrawingBuffer:!!options.preserveDrawingBuffer});
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x0b0b0b);
 const camera=new THREE.PerspectiveCamera(60,1,.1,1e8);camera.up.set(0,0,1);
 const orbit=new OrbitControls(camera,view);orbit.enableDamping=true;orbit.maxPolarAngle=Math.PI*.495;
 const world=new THREE.Group();scene.add(world);const dxt=renderer.extensions.has('WEBGL_compressed_texture_s3tc');
 let client3d=null,origin=null;
 const disposeMesh=g=>g.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.map?.dispose();o.material.dispose();}});
 const textureOutput=()=>!dxt&&cfg.d3.textureRequest==='dxt1'?'rgba':'native';
 // gpuBudgetMb null = by device. Browsers do not expose VRAM, so the automatic value is conservative;
 // set it to match your GPU (for example 8192 on a 12 GB card).
 const settings3d=()=>({...cfg.d3,concurrency:cfg.network.concurrency,gpuBudgetMb:cfg.d3.gpuBudgetMb??(device==='mobile'?256:device==='tablet'?512:2048)});
 // Angle of one device pixel: beyond fullDetailMeters a tile's texel must not exceed it.
 const pixelAngle=()=>camera.fov*Math.PI/180/Math.max(1,view.clientHeight*dpr());
 // Flat 3D: tiles in local ENU metres around origin; priority uses the camera converted to ECEF.
 const tiles=createTileStream({group:world,getClient:()=>client3d,makeMesh:t=>makeMesh(t),disposeMesh,place:()=>{},settings:settings3d,pixelAngle,now:()=>win.performance.now(),
  tileOptions:()=>({latitude:origin.lat,longitude:origin.lon,textureOutput:textureOutput()}),
  eye:()=>origin?cameraEye(camera,enu(origin.lat,origin.lon)):null,
  onTile:e=>emit('tile',{mode:state.mode,...e}),onError:e=>emit('error',e),onComplete:()=>{if(cfg.d3.detail==='max'){state.reached3d=true;updateEnhanceUi();}}});
 function clear3d(){state.reached3d=false;tiles.clear();}
 async function apply3d(){const next=build3d();clear3d();await client3d?.dispose();client3d=next;const o=origin={lat:state.lat,lon:state.lon,ground:0};
  try{const e=await next.getElevation(o.lat,o.lon,{radiusMeters:3});o.ground=e.altitude??0;}catch(e){if(e.name==='AbortError')return;}
  // A view, mode or position change during the elevation lookup superseded this apply.
  if(origin!==o||client3d!==next)return;
  // Start framing the full-detail area, not the whole streaming radius.
  const g=o.ground,R=Math.min(cfg.d3.radiusMeters,cfg.d3.fullDetailMeters||150);if(state.mode==='fly'){camera.position.set(0,-60,g+40);yaw=0;pitch=-.25;}else{camera.position.set(0,-R*.9,g+R*.6);orbit.target.set(0,0,g);orbit.update();}
  refresh3d(true);}
 async function makeMesh(tile){const group=new THREE.Group();
  for(const m of tile.meshes){const p=Float32Array.from(m.positions);if(m.layer!=='terrain')for(let i=2;i<p.length;i+=3)p[i]+=m.layer==='water'?.12:.06;const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(p,3));geo.setAttribute('uv',new THREE.BufferAttribute(m.uvs,2));geo.setIndex(new THREE.BufferAttribute(m.indices,1));if(m.normals)geo.setAttribute('normal',new THREE.BufferAttribute(m.normals,3));
   let map=null;const t=m.texture;
   if(t?.format==='dxt1')map=new THREE.CompressedTexture([{data:t.data,width:t.width,height:t.height}],t.width,t.height,THREE.RGB_S3TC_DXT1_Format);
   else if(t?.format==='rgba')map=new THREE.DataTexture(t.data,t.width,t.height,THREE.RGBAFormat);
   else if(t?.format==='jpeg')map=new THREE.Texture(await win.createImageBitmap(new win.Blob([t.data],{type:'image/jpeg'}),{imageOrientation:'none'}));
   if(map){map.flipY=false;map.colorSpace=THREE.SRGBColorSpace;map.minFilter=map.magFilter=THREE.LinearFilter;map.generateMipmaps=false;map.needsUpdate=true;}
   const water=m.layer==='water',mat=m.normals&&!map?new THREE.MeshNormalMaterial({side:THREE.DoubleSide}):new THREE.MeshBasicMaterial({map,color:map?0xffffff:water?0x3d6f8f:0x9a948a,side:THREE.DoubleSide,transparent:water,opacity:water?.75:1});
   group.add(new THREE.Mesh(geo,mat));}
  return group;}
 const enu=(lat,lon)=>{const e=new THREE.Vector3(-Math.sin(lon*Math.PI/180),Math.cos(lon*Math.PI/180),0),u=geoToECEF(lat,lon,0,1),up=new THREE.Vector3(u.x,u.y,u.z),n=new THREE.Vector3().crossVectors(up,e);return new THREE.Matrix4().makeBasis(e,n,up).setPosition(up.clone().multiplyScalar(6371010));};
 function focusGeo(){const p=state.mode==='fly'?camera.position:orbit.target,g=ecefToGeo(new THREE.Vector3(p.x,p.y,0).applyMatrix4(enu(origin.lat,origin.lon)));return {lat:g.latitude,lon:g.longitude};}
 const heading=()=>{const d=camera.getWorldDirection(new THREE.Vector3());return (Math.atan2(d.x,d.y)*180/Math.PI+360)%360;};
 async function refresh3d(force=false){
  if(!client3d||!origin||state.mode==='2d')return;const here=focusGeo();state.lat=here.lat;state.lon=here.lon;syncCoords();
  try{await tiles.update(here,{force});}catch(e){if(e.name!=='AbortError')fail(e);}}
 const statusTimer=win.setInterval(()=>{updateEnhanceUi();if(state.view==='globe'){globeStatus();return;}if(state.mode==='2d'||!client3d)return;refresh3d();const s=client3d.getStats(),stats3d=tiles.stats();
  if($('status').className!=='err')status(`${state.mode==='fly'?'FLY':'3D '}   ${stats3d.done}/${stats3d.total} tiles${stats3d.errors?'   '+stats3d.errors+' errors':''}${stats3d.best?'   '+(stats3d.best*100).toFixed(1)+' cm/texel':''}   resident ${stats3d.resident} (${stats3d.gpuMB} MB)   net ${s.networkRequests}  ${(s.receivedBytes/1048576).toFixed(1)} MiB   cache ${s.memoryHits+s.diskHits}${state.mode==='fly'?`   alt ${(camera.position.z-(origin?.ground??0)).toFixed(0)} m   ${cfg.d3.flySpeed.toFixed(0)} m/s`:''}`,stats3d.errors?'warn':'');},500);
 const keys=new Set();let yaw=0,pitch=-.25,last=win.performance.now();
 const sharpen=new SharpenPass(renderer,{sharpness:cfg.enhance.sharpness3d});
 const globe=createGlobe({win,view,camera,cfg,keys,dpr,tileTexels:()=>client2d?.tileSize??256,getClient3d:()=>client3d,makeMesh,disposeMesh,settings3d,pixelAngle,flyPad:()=>flyPad.state,
  textureOutput,tileImage,onTile:e=>emit('tile',e),onError:e=>{emit('error',e);},onMove:()=>{const v=globe.getView();state.lat=v.lat;state.lon=v.lon;state.zoom=v.zoom;syncCoords();},onFlySpeed:()=>controls.get('d3.flySpeed')?.ctl.set(cfg.d3.flySpeed)});
 win.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT')return;keys.add(e.code);});win.addEventListener('keyup',e=>keys.delete(e.code));win.addEventListener('blur',()=>keys.clear());
 view.addEventListener('click',()=>{if(state.view==='flat'&&state.mode==='fly')view.requestPointerLock?.();});
 doc.addEventListener('mousemove',e=>{if(state.view!=='flat'||doc.pointerLockElement!==view)return;yaw-=e.movementX*.0025;pitch=Math.max(-1.55,Math.min(1.55,pitch-e.movementY*.0025));});
 view.addEventListener('wheel',e=>{if(state.view!=='flat'||state.mode!=='fly')return;cfg.d3.flySpeed=Math.max(1,Math.min(2000,Math.round(cfg.d3.flySpeed*(e.deltaY<0?1.2:1/1.2))));controls.get('d3.flySpeed')?.ctl.set(cfg.d3.flySpeed);},{passive:true});
 function resize(){draw2d();const w=view.clientWidth,h=view.clientHeight;if(!w||!h)return;renderer.setPixelRatio(dpr());renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
 const ro=new win.ResizeObserver(resize);ro.observe($('stage'));
 // ---------- touch devices ----------
 const flyPad=createFlyPad($('stick'),$('knob'),$('flyUp'),$('flyDown'));
 // Flat fly on touch: drag the view to look around (the world follows the finger).
 trackGestures(view,{filter:e=>e.pointerType==='touch'&&state.view==='flat'&&state.mode==='fly',onPan:(dx,dy)=>{yaw+=dx*.005;pitch=Math.max(-1.55,Math.min(1.55,pitch+dy*.005));}});
 let device='desktop',hintTimer=0;
 // Touch hints show for a few seconds after a view or mode change, then fade out.
 function showHints(){if(app.dataset.input!=='touch')return;app.classList.add('hints-on');win.clearTimeout(hintTimer);hintTimer=win.setTimeout(()=>app.classList.remove('hints-on'),6000);}
 const header=doc.querySelector('header'),placeDrawers=()=>app.style.setProperty('--top',(header.getBoundingClientRect().bottom+4)+'px');
 new win.ResizeObserver(placeDrawers).observe(header);
 function applyDevice(next){
  next=detectDevice(win,next??options.device??'auto');const changed=next!==device;device=next;app.dataset.device=device;app.dataset.input=inputOf(device);
  if(changed){if(device!=='desktop'){togglePanel(false);toggleLayers(false);}else{togglePanel(options.panel!==false);toggleLayers(options.layersPanel!==false);}flyPad.reset();showHints();placeDrawers();win.requestAnimationFrame(resize);emit('device',device);}
  return device;}
 $('scrim').addEventListener('click',()=>{togglePanel(false);toggleLayers(false);});
 win.addEventListener('resize',()=>{if((options.device??'auto')==='auto')applyDevice();placeDrawers();});
 // Frames per second of the viewer loop, shown in the footer.
 let fpsFrames=0,fpsSince=win.performance.now(),fps=0;const fpsEl=$('fps');
 renderer.setAnimationLoop(()=>{const now=win.performance.now(),dt=Math.min(.1,(now-last)/1000);last=now;updateNeedle();tiles.tick(now);
  fpsFrames++;if(now-fpsSince>=500){fps=fpsFrames*1000/(now-fpsSince);fpsFrames=0;fpsSince=now;fpsEl.textContent=Math.round(fps)+' fps';}
  if(state.view==='globe'){globe.update(dt);if(active3d()){sharpen.setSharpness(cfg.enhance.sharpness3d);sharpen.render(globe.scene,camera);}else renderer.render(globe.scene,camera);return;}
  if(state.mode==='2d')return;
  if(state.mode==='fly'){const fwd=new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch)),right=new THREE.Vector3(Math.cos(yaw),Math.sin(yaw),0),v=new THREE.Vector3(),k=(keys.has('ShiftLeft')||keys.has('ShiftRight')?4:1)*cfg.d3.flySpeed*dt;
   if(keys.has('KeyW'))v.add(fwd);if(keys.has('KeyS'))v.sub(fwd);if(keys.has('KeyD'))v.add(right);if(keys.has('KeyA'))v.sub(right);if(keys.has('KeyE')||keys.has('Space'))v.z+=1;if(keys.has('KeyQ')||keys.has('ControlLeft'))v.z-=1;
   if(v.lengthSq())v.normalize();const pad=flyPad.state;v.addScaledVector(fwd,pad.y).addScaledVector(right,pad.x);v.z+=(pad.up?1:0)-(pad.down?1:0);if(v.lengthSq()>1)v.normalize();
   if(v.lengthSq())camera.position.addScaledVector(v,k);
   const hit=new THREE.Raycaster(new THREE.Vector3(camera.position.x,camera.position.y,camera.position.z+500),new THREE.Vector3(0,0,-1),0,2000).intersectObjects(world.children,true)[0];if(hit&&camera.position.z<hit.point.z+1.7)camera.position.z=hit.point.z+1.7;
   camera.lookAt(camera.position.clone().add(fwd));}else orbit.update();
  if(active3d()){sharpen.setSharpness(cfg.enhance.sharpness3d);sharpen.render(scene,camera);}else renderer.render(scene,camera);});

 // ---------- enhancement ----------
 let enhancer=null,enhQueue=Promise.resolve();const enhOk=enhanceSupported();
 const enhKey=()=>{const e=cfg.enhance;return [e.upscale2d,e.sharpen2d,e.sharpness2d,e.denoise2d].join('/');};
 const zoomCap=()=>state.maxReal??cfg.d2.maxZoom;
 // 2D upscaler is offered only once the view reaches the highest zoom with real imagery here.
 const available2d=()=>enhOk&&(state.view==='globe'?globe.stats().finestZoom:Math.round(state.zoom))>=zoomCap();
 const active2d=()=>cfg.enhance.enabled2d&&available2d()&&(cfg.enhance.sharpen2d||cfg.enhance.denoise2d>0||cfg.enhance.upscale2d>1);
 // 3D sharpen is offered only once every terminal (maximum-resolution) tile of the area is loaded.
 const available3d=()=>state.mode!=='2d'&&cfg.d3.detail==='max'&&(state.view==='globe'?globe.stats().mesh.reached:state.reached3d);
 const active3d=()=>cfg.enhance.enabled3d&&available3d();
 function getEnhanceState(){return {supported:enhOk,maxZoom:zoomCap(),maxZoomProbed:state.maxReal!=null,available2d:available2d(),active2d:active2d(),available3d:available3d(),active3d:active3d(),settings:clone(cfg.enhance)};}
 function enhancedFor(e,z,x,y,key){if(!active2d()||z<zoomCap())return null;const k=enhKey();if(e.enh&&e.enhKey===k)return e.enh;if(!e.enhPending){e.enhPending=true;enhQueue=enhQueue.then(async()=>{try{enhancer??=new TileEnhancer();const s=cfg.enhance,out=await enhancer.enhance(e.bmp,{sharpness:s.sharpness2d,sharpen:s.sharpen2d,denoise:s.denoise2d,upscale:s.upscale2d});if(bitmaps.get(key)!==e){out.close();return;}e.enh?.close();e.enh=out;e.enhKey=k;draw2d();}catch(err){fail(err);}finally{e.enhPending=false;}});}return null;}
 async function tileImage(z,x,y,priority=0){const t=await client2d.getTile(z,x,y,{priority}),bmp=await win.createImageBitmap(new win.Blob([t.bytes],{type:t.mimeType}));
  if(active2d()&&z>=zoomCap()){const s=cfg.enhance;return enhQueue=enhQueue.then(async()=>{enhancer??=new TileEnhancer();try{return await enhancer.enhance(bmp,{sharpness:s.sharpness2d,sharpen:s.sharpen2d,denoise:s.denoise2d,upscale:s.upscale2d});}finally{bmp.close();}});}return bmp;}
 let probeTimer=0;function checkMaxReal(){const z=Math.round(state.zoom);if(z<17||!client2d)return;const t=client2d.tileAt(state.lat,state.lon,12),key=t.x+'/'+t.y+'/'+cfg.d2.layers.join(',')+'/'+cfg.d2.maxZoom;if(key===state.maxRealKey)return;
  clearTimeout(probeTimer);probeTimer=setTimeout(async()=>{if(key===state.maxRealKey)return;state.maxRealKey=key;try{const r=await client2d.findMaxZoom(state.lat,state.lon,{from:cfg.d2.maxZoom,to:Math.max(cfg.d2.minZoom,12)});state.maxReal=r.z;emit('maxzoom',{zoom:r.z});updateEnhanceUi();draw2d();}catch(e){state.maxRealKey='';}},500);}
 function enhanceChanged(){for(const e of bitmaps.values()){e.enh?.close();e.enh=null;e.enhKey=null;}if(state.view==='globe')globe.invalidate2d();updateEnhanceUi();draw2d();emit('enhance',getEnhanceState());}
 function updateEnhanceUi(){const a2=available2d(),a3=available3d(),is2=state.mode==='2d';
  for(const c of controls.values()){if(c.row.classList.contains('gate2d'))c.row.classList.toggle('off',!a2);if(c.row.classList.contains('gate3d'))c.row.classList.toggle('off',!a3);}
  const h=$('enhance-hint');if(h)h.textContent=!enhOk?'WebGL2 unavailable: enhancement disabled.':is2?(a2?'Max zoom reached (z'+zoomCap()+'). Upscaler available.':'Available at max zoom: z'+zoomCap()+(state.maxReal==null?' (not probed yet)':'')+', now z'+Math.round(state.view==='globe'?globe.stats().finestZoom:state.zoom)+'.'):(a3?'Maximum detail loaded. Sharpen available.':cfg.d3.detail!=='max'?'Available with Detail = Maximum.':'Available once every terminal tile is loaded.');
  const b=$('enhance');if(b){const av=is2?a2:a3,on=is2?active2d():active3d();b.disabled=!av;b.classList.toggle('on',on);b.textContent=on?'On':'Off';b.title=h?.textContent??'';}}
 // ---------- globe ----------
 async function groundFor(lat,lon){try{const c=client3d??build3d();const e=await c.getElevation(lat,lon,{radiusMeters:3});globe.setGround(e.altitude??0);if(!client3d)c.dispose();}catch{globe.setGround(0);}}
 function globeStatus(){const g=globe.stats(),v=globe.getView(),s3=client3d?.getStats();
  state.lat=v.lat;state.lon=v.lon;state.zoom=v.zoom;syncCoords();
  if($('status').className==='err')return;const alt=v.altitude>=1000?(v.altitude/1000).toFixed(1)+' km':v.altitude.toFixed(0)+' m';
  status('GLOBE '+(state.mode==='fly'?'FLY':state.mode.toUpperCase())+'   alt '+alt+'   2D z'+g.finestZoom+' '+g.patches+'/'+g.wanted+' patches'+(state.mode!=='2d'?(v.altitude>g.activation?'   3D below '+g.activation+' m':'   3D '+g.mesh.done+'/'+g.mesh.total+' tiles'+(g.mesh.best?'  '+(g.mesh.best*100).toFixed(1)+' cm/texel':'')+(g.mesh.errors?'  '+g.mesh.errors+' errors':'')):'')+(s3?'   net '+s3.networkRequests:'')+(active2d()&&state.mode==='2d'?'   ENHANCED '+cfg.enhance.upscale2d+'x':'')+(active3d()?'   CAS':''),g.mesh.errors?'warn':'');}
 function setView(v){if(!['flat','globe'].includes(v))throw new Error("view must be 'flat' or 'globe'");if(v===state.view)return controller;
  if(state.view==='globe'){const gv=globe.getView();state.lat=gv.lat;state.lon=gv.lon;state.zoom=Math.min(gv.zoom,22);globe.leave();}else clear3d();
  state.view=v;app.dataset.view=v;showHints();for(const b of doc.querySelectorAll('header [data-view]'))b.classList.toggle('on',b.dataset.view===v);origin=null;
  if(v==='globe'){groundFor(state.lat,state.lon);}camera.up.set(0,0,1);
  setMode(state.mode);if(v==='flat'&&state.mode==='2d')draw2d();emit('view',v);return controller;}
 // ---------- zoom / north controls ----------
 const flatHeading=()=>state.mode==='fly'?((-yaw/DEG)%360+360)%360:heading();
 const currentHeading=()=>state.view==='globe'?globe.heading():state.mode==='2d'?0:flatHeading();
 function zoomStep(dir){
  if(state.view==='globe')globe.zoomBy(dir>0?1/1.6:1.6);
  else if(state.mode==='2d'){state.zoom=Math.max(cfg.d2.minZoom,Math.min(cfg.d2.overzoom?26:cfg.d2.maxZoom,Math.round(state.zoom)+dir));state.note='';syncCoords();draw2d();}
  else if(state.mode==='3d'){const off=camera.position.clone().sub(orbit.target).multiplyScalar(dir>0?.7:1/.7);if(off.length()>2&&off.length()<5e4){camera.position.copy(orbit.target).add(off);orbit.update();}}
  else{cfg.d3.flySpeed=Math.max(1,Math.min(2000,Math.round(cfg.d3.flySpeed*(dir>0?1.5:1/1.5))));controls.get('d3.flySpeed')?.ctl.set(cfg.d3.flySpeed);}
  emit('move',getView());return controller;}
 function resetNorth(){
  if(state.view==='globe')globe.resetNorth();
  else if(state.mode==='3d'){const off=camera.position.clone().sub(orbit.target),hz=Math.hypot(off.x,off.y);camera.position.set(orbit.target.x,orbit.target.y-hz,camera.position.z);orbit.update();}
  else if(state.mode==='fly')yaw=0;
  emit('move',getView());return controller;}
 const needle=$('needle');let lastNeedle=NaN;function updateNeedle(){const h=Math.round(currentHeading()*10)/10;if(h!==lastNeedle){lastNeedle=h;needle.style.transform='rotate('+(-h)+'deg)';$('north').title='Heading '+h.toFixed(0)+'°  reset north';}}
 // ---------- header / modes ----------
 const syncCoords=()=>{};
 function setMode(mode){if(!['2d','3d','fly'].includes(mode))throw new Error("mode must be '2d', '3d' or 'fly'");const prev=state.mode;state.mode=mode;app.dataset.mode=mode;flyPad.reset();showHints();
  if(state.view==='globe'){for(const b of doc.querySelectorAll('header [data-mode]'))b.classList.toggle('on',b.dataset.mode===mode);orbit.enabled=false;if(doc.pointerLockElement)doc.exitPointerLock();win.requestAnimationFrame(resize);
   if(mode!=='2d'&&!client3d)safe(()=>{client3d=build3d();});globe.enter(mode,{lat:state.lat,lon:state.lon,zoom:state.zoom});emit('mode',mode);return controller;}
  for(const b of doc.querySelectorAll('[data-mode]'))if(b!==app)b.classList.toggle('on',b.dataset.mode===mode);orbit.enabled=mode==='3d';if(mode!=='fly'&&doc.pointerLockElement)doc.exitPointerLock();
  win.requestAnimationFrame(resize);
  if(mode==='2d'){if(!client2d)safe(apply2d);else draw2d();}
  else{if(mode==='fly'&&prev==='3d'){const d=camera.getWorldDirection(new THREE.Vector3());yaw=Math.atan2(-d.x,d.y);pitch=Math.max(-.25,Math.asin(Math.max(-1,Math.min(1,d.z))));}if(!client3d||!origin)apply3d().catch(fail);else refresh3d(true);}
  emit('mode',mode);return controller;}
 function goTo({latitude=state.lat,longitude=state.lon,zoom=state.zoom}={}){if(!Number.isFinite(latitude)||latitude<-85||latitude>85||!Number.isFinite(longitude)||longitude<-180||longitude>180)throw new Error('Invalid coordinates');
  state.lat=latitude;state.lon=longitude;if(Number.isFinite(zoom))state.zoom=Math.max(0,Math.min(26,zoom));state.note='';syncCoords();origin=null;
  if(state.view==='globe'){globe.invalidate3d();groundFor(latitude,longitude);globe.enter(state.mode,{lat:latitude,lon:longitude,zoom:state.zoom});}
  else if(state.mode==='2d')draw2d();else apply3d().catch(fail);emit('move',getView());return controller;}
 const safe=fn=>{try{fn();}catch(e){fail(e);}};
 function apply(){pendingApply=false;$('apply')?.classList.remove('on');try{apply2d();}catch(e){fail(e);return false;}
  if(state.view==='globe'){globe.invalidate2d();globe.invalidate3d();const prev=client3d;client3d=null;prev?.dispose();if(state.mode!=='2d'){try{client3d=build3d();}catch(e){fail(e);return false;}}}
  else if(state.mode!=='2d')apply3d().catch(fail);else origin=null;emit('apply',getConfig());return true;}
 const getView=()=>({view:state.view,mode:state.mode,latitude:state.lat,longitude:state.lon,zoom:state.zoom});
 const getConfig=()=>clone(cfg);
 function set(patch={}){for(const [g,v]of Object.entries(patch)){if(!(g in cfg))throw new Error('Unknown config group '+g);for(const [k,val]of Object.entries(v)){if(!(k in cfg[g]))throw new Error('Unknown option '+g+'.'+k);cfg[g][k]=clone(val);}}
  if(patch.d2?.style!==undefined&&patch.d2?.stylePreset===undefined)cfg.d2.stylePreset=!cfg.d2.style?'':cfg.d2.style in STYLE_PRESETS?cfg.d2.style:'custom';
  // Enhancement settings are live post-processing: they never rebuild clients or reload tiles.
  if(Object.keys(patch).every(g=>g==='enhance')){syncControls();enhanceChanged();return controller;}
  syncControls();const ok=apply();if(!ok)throw new Error($('status').textContent);return controller;}
 function togglePanel(open){const want=open??app.classList.contains('no-right');if(want&&app.dataset.input==='touch'&&!app.classList.contains('no-left'))toggleLayers(false);app.classList.toggle('no-right',!want);$('toggle').classList.toggle('on',want);return controller;}
 function toggleLayers(open){const want=open??app.classList.contains('no-left');if(want&&app.dataset.input==='touch'&&!app.classList.contains('no-right'))togglePanel(false);app.classList.toggle('no-left',!want);$('toggleLeft').classList.toggle('on',want);return controller;}

 buildPanel();
 for(const b of doc.querySelectorAll('header [data-mode]'))b.onclick=()=>setMode(b.dataset.mode);
 for(const b of doc.querySelectorAll('header [data-view]'))b.onclick=()=>setView(b.dataset.view);
 $('enhance').onclick=()=>{const k=state.mode==='2d'?'enabled2d':'enabled3d';set({enhance:{[k]:!cfg.enhance[k]}});};
 // Place search through an online geocoder (options.geocoder). "lat, lon" is also accepted.
 const geocoder=new Geocoder(options.geocoder??{});
 const search=$('search');let chose=false,results=[],resultsFor=null,sel=0,menuEl=null,searchReq=null,searchTimer=0,searchSeq=0;
 const closeResults=()=>{menuEl?.remove();menuEl=null;};
 function resultsMenu(note){closeResults();sel=0;const ul=doc.createElement('ul');ul.className='menu';ul.setAttribute('role','listbox');
  if(note){const li=doc.createElement('li');li.className='empty';li.textContent=note;ul.append(li);}
  else results.forEach((r,i)=>{const li=doc.createElement('li');li.setAttribute('role','option');const nm=doc.createElement('span');nm.textContent=r.name;li.append(nm);const sm=doc.createElement('small');sm.textContent=r.context;li.append(sm);li.onpointerenter=()=>{sel=i;chose=true;paint();};li.onpointerdown=ev=>{ev.preventDefault();pick(i);};ul.append(li);});
  const rc=search.parentElement.getBoundingClientRect();ul.style.left=rc.left+'px';ul.style.top=(rc.bottom+4)+'px';ul.style.width=rc.width+'px';doc.body.append(ul);menuEl=ul;paint();}
 const paint=()=>menuEl&&[...menuEl.children].forEach((li,i)=>li.classList.toggle('act',i===sel));
 // Latest query wins: earlier requests are aborted and their late answers ignored.
 async function lookup(text,purpose='best'){searchReq?.abort();const ac=searchReq=new AbortController(),id=++searchSeq;resultsMenu('Searching…');
  try{const r=await geocoder.search(text,{signal:ac.signal,purpose});if(id!==searchSeq)return null;results=r;resultsFor=text;r.length?resultsMenu():resultsMenu('No place found');return r;}
  catch(err){if(err?.name==='AbortError'||id!==searchSeq)return null;results=[];resultsFor=null;resultsMenu('Search failed: '+err.message);status('Place search failed: '+err.message,'warn');return null;}}
 function onInput(){chose=false;clearTimeout(searchTimer);const text=search.value.trim();if(!text){searchReq?.abort();searchSeq++;results=[];resultsFor=null;closeResults();return;}
  if(geocoder.providerFor('suggest')==='nominatim')return; // Nominatim policy forbids search-as-you-type: GO / Enter only.
  searchTimer=setTimeout(()=>lookup(text,'suggest'),300);}
 function pick(i){const r=results[i];closeResults();if(!r)return;search.value=r.name;search.blur();safe(()=>goTo({latitude:r.latitude,longitude:r.longitude,zoom:r.zoom}));emit('place',r);}
 async function goSearch(){clearTimeout(searchTimer);const text=search.value.trim();if(!text)return;const m=text.match(/^(-?d+(?:.d+)?)s*[,s]s*(-?d+(?:.d+)?)$/);if(m){closeResults();safe(()=>goTo({latitude:+m[1],longitude:+m[2]}));return;}
  if(chose&&resultsFor===text&&results[sel]){pick(sel);return;}const r=await lookup(text);if(r?.length)pick(0);else if(r)status('No place found for "'+text+'"','warn');}
 async function searchPlaces(query,opts){return geocoder.search(query,opts);}
 search.addEventListener('input',onInput);search.addEventListener('focus',()=>{if(results.length&&resultsFor===search.value.trim())resultsMenu();});search.addEventListener('blur',()=>setTimeout(closeResults,120));
 search.addEventListener('keydown',ev=>{if(ev.key==='ArrowDown'){chose=true;sel=Math.min(results.length-1,sel+1);paint();ev.preventDefault();}else if(ev.key==='ArrowUp'){chose=true;sel=Math.max(0,sel-1);paint();ev.preventDefault();}else if(ev.key==='Enter'){goSearch();ev.preventDefault();}else if(ev.key==='Escape'){closeResults();search.blur();}});
 $('go').onclick=goSearch;$('toggleLeft').onclick=()=>toggleLayers();
 $('zin').onclick=()=>zoomStep(1);$('zout').onclick=()=>zoomStep(-1);$('north').onclick=()=>resetNorth();
 $('toggle').onclick=()=>togglePanel();$('maxzoom').onclick=()=>findMaxZoom().catch(fail);$('png').onclick=()=>exportPNG().catch(fail);
 $('reset').onclick=()=>{Object.assign(cfg,clone(VIEWER_DEFAULTS));for(const g of Object.keys(cfg))Object.assign(cfg[g],clone(options[g]??{}));syncControls();apply();};
 $('clear').onclick=async()=>{await Promise.all([client2d?.clearCache(),client3d?.clearCache()]);status('Cache cleared');apply();};
 if(options.panel===false)togglePanel(false);if(options.layersPanel===false)toggleLayers(false);
 applyDevice();
 controller={iframe,window:win,document:doc,
  get tiles2d(){return client2d;},get tiles3d(){return client3d;},get mode(){return state.mode;},
  zoomIn:()=>zoomStep(1),zoomOut:()=>zoomStep(-1),resetNorth,getHeading:()=>currentHeading(),toggleLayers,searchPlaces,getDevice:()=>device,setDevice:d=>{if(d!=='auto'&&!DEVICES.includes(d))throw new Error('device must be auto, '+DEVICES.join(', '));options.device=d;applyDevice(d);return controller;},setGeocoder:o=>{geocoder.set(o);results=[];resultsFor=null;return controller;},geocoder,setMode,setView,goTo,set,apply,getConfig,getView,togglePanel,findMaxZoom,exportPNG,getEnhanceState,setEnhance:(e)=>set({enhance:e}),get view(){return state.view;},globe,
  getFps:()=>fps,getStats:()=>({fps,globe:state.view==='globe'?globe.stats():null,enhancer:enhancer?.stats??null,view:getView(),tiles2d:client2d?.getStats()??null,tiles3d:client3d?.getStats()??null,mesh:tiles.stats(),loaded2d:[...bitmaps.values()].filter(b=>b.bmp).length}),
  on(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);return ()=>listeners.get(type).delete(fn);},
  off(type,fn){listeners.get(type)?.delete(fn);},
  async destroy(){win.clearInterval(statusTimer);globe.dispose();sharpen.dispose();enhancer?.dispose();ro.disconnect();renderer.setAnimationLoop(null);clear3d();renderer.dispose();bitmaps.forEach(b=>b.bmp?.close());await Promise.all([client2d?.dispose(),client3d?.dispose()]);iframe.remove();listeners.clear();},
  _internal:{camera,keys,loaded:tiles.loaded,globe,bitmaps:()=>bitmaps,stats3d:()=>tiles.stats()}};
 syncCoords();safe(apply2d);app.dataset.view=state.view;for(const b of doc.querySelectorAll('header [data-view]'))b.classList.toggle('on',b.dataset.view===state.view);if(state.view==='globe')groundFor(state.lat,state.lon);setMode(state.mode);
 return controller;
}
