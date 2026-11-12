// Shared form controls for the viewer panels: dropdown, stepper (+/-), checkbox, text, checkbox group.
// All of them render with the viewer's CSS classes and call onChange with the new value.
export function createControls({doc,win,onError}){
 let menu=null;
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
 // Scrolling the page or a panel moves the button away from the open list, so the list closes; scrolling
 // inside the list itself (long option lists such as satellite groups) must not.
 win.addEventListener('blur',closeMenu);doc.addEventListener('scroll',e=>{if(menu&&!menu.el.contains(e.target))closeMenu();},true);
 function stepper(parent,f,value,onChange){
  const wrap=doc.createElement('div');wrap.className='step';const minus=doc.createElement('button'),input=doc.createElement('input'),plus=doc.createElement('button');
  minus.type=plus.type='button';minus.textContent='−';plus.textContent='+';minus.setAttribute('aria-label','Decrease '+f.label);plus.setAttribute('aria-label','Increase '+f.label);input.inputMode='decimal';input.setAttribute('aria-label',f.label);if(f.placeholder)input.placeholder=f.placeholder;
  wrap.append(minus,input,plus);parent.append(wrap);
  const decimals=String(f.step??1).split('.')[1]?.length??0,fmt=v=>v==null?'':String(Number(v.toFixed(Math.max(decimals,3)))),clamp=v=>Math.min(f.max??Infinity,Math.max(f.min??-Infinity,v));
  let last=value;const set=v=>{last=v;input.value=fmt(v);};set(value);
  const read=()=>{const t=input.value.trim();if(!t&&f.optional)return null;const v=Number(t);if(!Number.isFinite(v))throw new Error(f.label+': not a number');return clamp(v);};
  const commit=v=>{set(v);onChange(v);};
  const bump=d=>{let v;try{v=read();}catch{v=null;}const base=v??(d>0?(f.min??0):(f.max??f.min??0));commit(clamp(Number((base+d*(f.step??1)).toFixed(6))));};
  let hold;const press=d=>{bump(d);let delay=380;const rep=()=>{bump(d);delay=Math.max(40,delay*.8);hold=setTimeout(rep,delay);};hold=setTimeout(rep,delay);};const release=()=>clearTimeout(hold);
  for(const [b,d]of [[minus,-1],[plus,1]]){b.onpointerdown=e=>{e.preventDefault();press(d);};b.onpointerup=b.onpointerleave=release;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();bump(d);}};}
  input.onkeydown=e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();bump(e.key==='ArrowUp'?1:-1);}else if(e.key==='Enter')input.blur();};
  input.onchange=()=>{try{commit(read());}catch(e){onError?.(e);set(last);}};
  return {set};
 }
 function check(parent,label,value,onChange){
  const el=doc.createElement('div');el.className='ck';el.tabIndex=0;el.setAttribute('role','checkbox');const box=doc.createElement('span');box.className='box';const t=doc.createElement('span');t.textContent=label;el.append(box,t);parent.append(el);
  const set=v=>el.setAttribute('aria-checked',String(!!v));set(value);const toggle=()=>{const v=el.getAttribute('aria-checked')!=='true';set(v);onChange(v);};
  el.onclick=toggle;el.onkeydown=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();toggle();}};return {set,el};
 }

 function text(parent,f,value,onChange){const i=doc.createElement('input');i.setAttribute('aria-label',f.label);i.placeholder=f.placeholder??'';i.value=value??'';i.spellcheck=false;i.onchange=()=>onChange(i.value.trim());i.onkeydown=e=>{if(e.key==='Enter')i.blur();};parent.append(i);return {set:v=>{i.value=v??'';},el:i};}
 function checks(parent,f,value,onChange){const box=doc.createElement('div');box.className='checks';parent.append(box);let cur=new Set(value);
  const items=f.options.map(([v,l])=>[v,check(box,l,cur.has(v),on=>{on?cur.add(v):cur.delete(v);onChange(f.options.map(o=>o[0]).filter(x=>cur.has(x)));})]);
  return {set:v=>{cur=new Set(v);for(const [k,c]of items)c.set(cur.has(k));},el:box};}
 // One labelled row for a schema field {key,label,type:number|select|text|bool|checks,...}.
 function field(parent,f,value,onChange){
  const row=doc.createElement('div');row.className='row'+(f.type==='checks'?' top':'')+(f.wide?' wide':'');const k=doc.createElement('span');k.className='k';k.textContent=f.label;row.append(k);parent.append(row);
  let ctl;if(f.type==='number')ctl=stepper(row,f,value,onChange);
  else if(f.type==='select')ctl=dropdown(row,f.options,value,v=>onChange(typeof f.options[0][0]==='number'?Number(v):v),f.label);
  else if(f.type==='text')ctl=text(row,f,value,onChange);
  else if(f.type==='bool'){const box=doc.createElement('div');box.className='checks';box.style.gridTemplateColumns='1fr';row.append(box);ctl=check(box,f.text??'',value,onChange);}
  else if(f.type==='checks')ctl=checks(row,f,value,onChange);
  return {row,ctl};
 }
 return {dropdown,stepper,check,text,checks,field,closeMenu};
}
