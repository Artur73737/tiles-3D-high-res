// Left-sidebar sections: "Intelligence" (layer toggles, status, options) and "Tools" (measuring
// tools, results, import / export). Built with the shared controls (src/ui/controls.js).
import {TOOLS} from '../tools/measure.js';

const GROUP_ORDER=['Traffic','Space','Hazards','Weather'];

export function createIntelPanel({doc,ui,intel,tools,onFocus,download,notify}){
 const root=doc.createElement('div');root.id='intel';
 const el=(tag,cls,text)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;};
 const rows=new Map();

 // ---------- intelligence layers ----------
 const sec=el('section','intel-layers'),h=el('h3');h.append(el('span',null,'Intelligence'));sec.append(h);
 const groups=[...new Set([...GROUP_ORDER,...intel.layers.map(l=>l.group)])];
 for(const g of groups){const list=intel.layers.filter(l=>l.group===g);if(!list.length)continue;sec.append(el('div','intel-group',g));
  for(const layer of list){
   const head=el('div','intel-layer'),box=el('div','checks');box.style.gridTemplateColumns='1fr';head.append(box);
   const toggle=ui.check(box,layer.label,intel.isEnabled(layer.id),on=>{intel.enable(layer.id,on);refresh();});
   const badge=el('span','badge');head.append(badge);sec.append(head);
   const opts=el('div','intel-opts');for(const f of layer.schema)ui.field(opts,f,layer.options[f.key],v=>intel.setOptions(layer.id,{[f.key]:v}));
   const src=el('p','hint',(layer.hint?layer.hint+' ':'')+'Source: '+layer.source+'.');opts.append(src);sec.append(opts);
   rows.set(layer.id,{toggle,badge,opts});
  }}
 root.append(sec);

 // ---------- tools ----------
 const ts=el('section','intel-tools'),th=el('h3');th.append(el('span',null,'Tools'));ts.append(th);
 const grid=el('div','tool-grid'),toolButtons=new Map();
 for(const [k,t]of Object.entries(TOOLS)){const b=el('button',null,t.label);b.type='button';b.dataset.tool=k;b.onclick=()=>{tools.start(k);refresh();};grid.append(b);toolButtons.set(k,b);}
 ts.append(grid);
 const hint=el('p','hint tool-hint'),draftBar=el('div','actions tool-draft');
 const finish=el('button',null,'Finish'),undo=el('button',null,'Undo'),cancel=el('button',null,'Cancel');for(const b of [finish,undo,cancel])b.type='button';
 finish.onclick=()=>{tools.finish();refresh();};undo.onclick=()=>{tools.undo();refresh();};cancel.onclick=()=>{tools.cancel();refresh();};draftBar.append(finish,undo,cancel);
 const list=el('ul','tool-list'),chart=el('div','profile-chart');
 const io=el('div','actions tool-io'),imp=el('button',null,'Import'),expG=el('button',null,'GeoJSON'),expK=el('button',null,'KML'),clr=el('button',null,'Clear');for(const b of [imp,expG,expK,clr])b.type='button';
 const file=el('input');file.type='file';file.accept='.geojson,.json,.kml,application/geo+json,application/vnd.google-earth.kml+xml';file.hidden=true;
 imp.onclick=()=>file.click();
 file.onchange=async()=>{const f=file.files?.[0];file.value='';if(!f)return;try{const r=tools.import(await f.text(),f.name);notify?.(`Imported ${r.added} item(s)`+(r.skipped?`, ${r.skipped} unsupported skipped`:''));}catch(e){notify?.('Import failed: '+e.message,'err');}refresh();};
 expG.onclick=()=>download('tiles-measurements.geojson',tools.exportGeoJSON(),'application/geo+json');
 expK.onclick=()=>download('tiles-measurements.kml',tools.exportKML(),'application/vnd.google-earth.kml+xml');
 clr.onclick=()=>{tools.clear();refresh();};
 io.append(imp,expG,expK,clr,file);ts.append(hint,draftBar,list,chart,io);root.append(ts);

 function profileSvg(r){
  const s=r.samples;if(!s?.length)return '';const W=244,H=92,P=4,span=Math.max(1,r.max-r.min),L=s.at(-1).d||1;
  const pts=s.map(p=>`${(P+p.d/L*(W-2*P)).toFixed(1)},${(H-P-(p.alt-r.min)/span*(H-2*P)).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Elevation profile"><polygon points="${P},${H-P} ${pts} ${W-P},${H-P}" fill="rgba(255,159,10,.18)"/><polyline points="${pts}" fill="none" stroke="#ff9f0a" stroke-width="1.5"/><text x="${P+2}" y="12" fill="#999" font-size="10">${Math.round(r.max)} m</text><text x="${P+2}" y="${H-P-3}" fill="#999" font-size="10">${Math.round(r.min)} m</text></svg>`;
 }

 // Updates statuses, tool buttons and the result list (cheap; call after any change).
 function refresh(){
  for(const l of intel.layers){const r=rows.get(l.id),on=intel.isEnabled(l.id),st=intel.state(l.id);r.toggle.set(on);r.opts.classList.toggle('hide',!on);
   r.badge.textContent=!on?'':st.status==='loading'?'…':st.status==='error'?'error':st.status==='zoom'?'zoom in':String(st.count);
   r.badge.className='badge'+(st.status==='error'&&on?' err':'');r.badge.title=on&&st.error?st.error:'';}
  for(const [k,b]of toolButtons)b.classList.toggle('on',tools.active===k);
  hint.textContent=tools.active?TOOLS[tools.active].hint+(TOOLS[tools.active].auto?'':' Double-click or Enter to finish, Esc to cancel.'):'Pick a tool, then click on the map.';
  const drafting=!!tools.active&&!TOOLS[tools.active].auto;draftBar.classList.toggle('hide',!drafting);finish.disabled=tools.draft.length<(TOOLS[tools.active]?.min??2);undo.disabled=!tools.draft.length;
  list.textContent='';
  for(const it of [...tools.items].reverse()){
   const li=el('li',it.id===tools.selected?'sel':'');const sw=el('i');sw.style.background=it.color;
   const name=el('input');name.value=it.name;name.setAttribute('aria-label','Name');name.onchange=()=>tools.rename(it.id,name.value.trim()||it.name);
   const res=el('small',it.result?.error?'err':'',it.result?.text??'');
   const go=el('button',null,'⌖'),del=el('button',null,'×');go.type=del.type='button';go.title='Show on map';del.title='Delete';
   go.onclick=()=>{tools.select(it.id);const p=it.points,c={lat:p.reduce((s,q)=>s+q.lat,0)/p.length,lon:p.reduce((s,q)=>s+q.lon,0)/p.length};onFocus(c.lat,c.lon,it.points);};
   del.onclick=()=>{tools.remove(it.id);refresh();};li.onclick=e=>{if(e.target===li||e.target===res){tools.select(it.id);refresh();}};
   const top=el('div','tl-top');top.append(sw,name,go,del);li.append(top,res);list.append(li);
  }
  const sel=tools.items.find(i=>i.id===tools.selected);chart.innerHTML=sel?.type==='profile'&&sel.result?.samples?profileSvg(sel.result):'';
  io.classList.toggle('empty',!tools.items.length);expG.disabled=expK.disabled=clr.disabled=!tools.items.length;
 }
 let queued=false;const schedule=()=>{if(queued)return;queued=true;(doc.defaultView??globalThis).requestAnimationFrame(()=>{queued=false;refresh();});};
 return {el:root,refresh,schedule,mount(parent){parent.append(root);refresh();}};
}
