const text=value=>typeof value==='string'?value.trim():'';
export function parsePlaces(body){
 if(!body||!Array.isArray(body.features))throw Error('Invalid place search response.');
 return body.features.flatMap(feature=>{
  const coordinates=feature?.geometry?.coordinates,p=feature?.properties;
  if(feature?.geometry?.type!=='Point'||!Array.isArray(coordinates)||!p)return [];
  const [longitude,latitude]=coordinates;
  if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180)return [];
  const street=[text(p.street),text(p.housenumber)].filter(Boolean).join(' ');
  const name=text(p.name)||street||text(p.city)||text(p.country);
  if(!name)return [];
  const detail=[...new Set([street,text(p.city),text(p.state),text(p.country)].filter(value=>value&&value!==name))].join(', ');
  const type=text(p.type)||text(p.osm_value);
  const height=type==='country'?2200000:type==='state'?600000:type==='city'||type==='county'?35000:type==='town'?15000:type==='village'?6000:1200;
  return [{latitude,longitude,name,detail,height}];
 }).slice(0,5);
}
export function mountLocationSearch(onSelect){
 const $=id=>document.getElementById(id),input=$('location'),panel=$('search-results'),options=$('search-options'),message=$('search-message');
 let controller=null,revision=0;
 const open=value=>{panel.hidden=!value;input.setAttribute('aria-expanded',String(value));document.body.classList.toggle('search-open',value);};
 const cancel=()=>{revision++;controller?.abort();controller=null;};
 const close=()=>{cancel();open(false);};
 $('search-form').addEventListener('submit',async event=>{
  event.preventDefault();cancel();const query=input.value.trim(),current=revision;
  options.replaceChildren();open(true);
  if(query.length<2){message.textContent='Enter at least two characters.';return;}
  message.textContent='Searching…';controller=new AbortController();const owned=controller;
  const timeout=setTimeout(()=>owned.abort(),12000);
  try{
   const url=new URL('https://photon.komoot.io/api/');url.search=new URLSearchParams({q:query,limit:'5',lang:'en'});
   const response=await fetch(url,{signal:owned.signal,credentials:'omit'});
   if(!response.ok)throw Error('Search is temporarily unavailable ('+response.status+'). Try again.');
   const places=parsePlaces(await response.json());if(current!==revision)return;
   message.textContent=places.length?'Select a place':'No places found. Try a city or a more complete address.';
   for(const place of places){
    const button=document.createElement('button'),detail=document.createElement('small');button.type='button';button.textContent=place.name;detail.textContent=place.detail;button.append(detail);
    button.addEventListener('click',()=>{close();input.value=place.name;onSelect(place);});options.append(button);
   }
  }catch(error){if(current===revision)message.textContent=error.name==='AbortError'?'Search timed out. Try again.':error instanceof TypeError?'Unable to connect to place search. Try again.':error.message;}
  finally{clearTimeout(timeout);if(controller===owned)controller=null;}
 });
 input.addEventListener('input',()=>{cancel();open(false);});
 const container=$('location-search');
 container.addEventListener('keydown',event=>{
  if(event.key==='Escape'){close();input.focus();event.stopPropagation();}
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){
   const buttons=[...options.querySelectorAll('button')];if(panel.hidden||!buttons.length)return;
   event.preventDefault();const index=buttons.indexOf(document.activeElement),next=event.key==='ArrowDown'?index+1:index-1;
   if(next<0)input.focus();else buttons[Math.min(next,buttons.length-1)].focus();
  }
 });
 document.addEventListener('pointerdown',event=>{if(!container.contains(event.target))close();});
 window.addEventListener('pagehide',cancel);
 return {close};
}
