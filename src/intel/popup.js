// Details card for the selected feature, inside the map stage. Live features (satellites) refresh.
export function createPopup({doc,stage,onClose}){
 const card=doc.createElement('div');card.className='intel-popup hide';card.setAttribute('role','dialog');stage.append(card);
 let shown=null,last='';
 function render(sel){
  if(!sel){if(shown){card.classList.add('hide');shown=null;last='';}return;}
  const rows=sel.layer.details(sel.feature),key=sel.layer.id+':'+sel.feature.id+':'+JSON.stringify(rows);if(key===last)return;last=key;shown=sel;
  card.textContent='';const head=doc.createElement('div');head.className='ip-head';const t=doc.createElement('b');t.textContent=sel.layer.title(sel.feature)||sel.layer.label;
  const x=doc.createElement('button');x.type='button';x.textContent='×';x.setAttribute('aria-label','Close');x.onclick=()=>onClose?.();head.append(t,x);card.append(head);
  const dl=doc.createElement('dl');for(const [k,v]of rows){const dt=doc.createElement('dt'),dd=doc.createElement('dd');dt.textContent=k;
   if(v&&typeof v==='object'&&v.href){const a=doc.createElement('a');a.href=v.href;a.textContent=v.text;a.target='_blank';a.rel='noopener noreferrer';dd.append(a);}else dd.textContent=String(v??'—');dl.append(dt,dd);}
  const f=sel.feature,coords=doc.createElement('div');coords.className='ip-coords';coords.textContent=`${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}`+(f.alt?` · ${f.alt>=10000?(f.alt/1000).toFixed(0)+' km':Math.round(f.alt)+' m'}`:'');
  card.append(dl,coords);card.classList.remove('hide');
 }
 return {render,dispose(){card.remove();}};
}
