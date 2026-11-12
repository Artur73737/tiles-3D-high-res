// GeoJSON and KML import / export of markers and measurements.
// Item: {type: marker|distance|area|height|profile|sight, name, points:[{lat,lon,alt}], result?}
const coord=p=>[+p.lon.toFixed(7),+p.lat.toFixed(7),...(p.alt!=null&&Number.isFinite(p.alt)?[+p.alt.toFixed(2)]:[])];
const point=c=>({lon:c[0],lat:c[1],alt:c[2]??0});
const esc=s=>String(s??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));

export function toGeoJSON(items){
 return {type:'FeatureCollection',features:items.map(it=>{
  const geometry=it.type==='marker'?{type:'Point',coordinates:coord(it.points[0])}:it.type==='area'?{type:'Polygon',coordinates:[[...it.points,it.points[0]].map(coord)]}:{type:'LineString',coordinates:it.points.map(coord)};
  const props={name:it.name,tool:it.type};if(it.result?.text)props.result=it.result.text;if(it.color)props.color=it.color;
  return {type:'Feature',geometry,properties:props};})};
}

export function toKML(items,title='Tiles'){
 const pm=it=>{const c=it.points.map(p=>coord(p).join(',')).join(' '),g=it.type==='marker'?`<Point><coordinates>${coord(it.points[0]).join(',')}</coordinates></Point>`:it.type==='area'?`<Polygon><outerBoundaryIs><LinearRing><coordinates>${c} ${coord(it.points[0]).join(',')}</coordinates></LinearRing></outerBoundaryIs></Polygon>`:`<LineString><tessellate>1</tessellate><coordinates>${c}</coordinates></LineString>`;
  return `<Placemark><name>${esc(it.name)}</name><description>${esc(it.result?.text??'')}</description><ExtendedData><Data name="tool"><value>${it.type}</value></Data></ExtendedData>${g}</Placemark>`;};
 return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(title)}</name>${items.map(pm).join('')}</Document></kml>\n`;
}

// Geometry -> items. Unknown geometry types are skipped and counted.
function fromGeometry(g,name,tool,out){
 if(!g)return 0;
 if(g.type==='Point'){out.push({type:'marker',name,points:[point(g.coordinates)]});return 0;}
 if(g.type==='LineString'){out.push({type:['distance','profile','height','sight'].includes(tool)?tool:'distance',name,points:g.coordinates.map(point)});return 0;}
 if(g.type==='Polygon'){const r=g.coordinates[0].map(point);if(r.length>1&&r[0].lat===r.at(-1).lat&&r[0].lon===r.at(-1).lon)r.pop();out.push({type:'area',name,points:r});return 0;}
 if(g.type.startsWith('Multi')){let n=0;for(const c of g.coordinates)n+=fromGeometry({type:g.type.slice(5),coordinates:c},name,tool,out);return n;}
 if(g.type==='GeometryCollection'){let n=0;for(const x of g.geometries)n+=fromGeometry(x,name,tool,out);return n;}
 return 1;
}
export function fromGeoJSON(json){
 const out=[];let skipped=0;const feats=json.type==='FeatureCollection'?json.features:json.type==='Feature'?[json]:[{type:'Feature',geometry:json,properties:{}}];
 feats.forEach((f,i)=>{skipped+=fromGeometry(f.geometry,f.properties?.name??f.properties?.title??'Feature '+(i+1),f.properties?.tool,out);});
 return {items:out,skipped};
}
export function fromKML(text,DOMParserImpl=globalThis.DOMParser){
 const doc=new DOMParserImpl().parseFromString(text,'application/xml');if(doc.getElementsByTagName('parsererror').length)throw new Error('Invalid KML');
 const out=[];let skipped=0;const coords=el=>el.textContent.trim().split(/\s+/).filter(Boolean).map(t=>t.split(',').map(Number));
 [...doc.getElementsByTagName('Placemark')].forEach((pm,i)=>{const name=pm.getElementsByTagName('name')[0]?.textContent?.trim()||'Placemark '+(i+1);
  const tool=[...pm.getElementsByTagName('Data')].find(d=>d.getAttribute('name')==='tool')?.getElementsByTagName('value')[0]?.textContent;
  const pt=pm.getElementsByTagName('Point')[0],ls=pm.getElementsByTagName('LineString')[0],pg=pm.getElementsByTagName('Polygon')[0];
  const c=(pt??ls??pg)?.getElementsByTagName('coordinates')[0];if(!c){skipped++;return;}
  skipped+=fromGeometry({type:pt?'Point':ls?'LineString':'Polygon',coordinates:pt?coords(c)[0]:pg?[coords(c)]:coords(c)},name,tool,out);});
 return {items:out,skipped};
}
export function parseGeo(text,name=''){
 const t=text.trim();if(/\.kml$/i.test(name)||t.startsWith('<'))return fromKML(t);
 return fromGeoJSON(JSON.parse(t));
}
