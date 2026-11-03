import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));process.chdir(root);mkdirSync('dist',{recursive:true});
const options={absWorkingDir:root,bundle:true,minify:true,target:['chrome110','firefox115'],legalComments:'inline',logOverride:{'duplicate-case':'silent'}};
const worker=await build({...options,entryPoints:['src/decode-worker.js'],format:'iife',write:false,metafile:true});
options.define={__EARTH_DECODER_WORKER__:JSON.stringify(worker.outputFiles[0].text)};
const api=await build({...options,entryPoints:['src/api.js'],format:'iife',globalName:'EarthHQ',outfile:'dist/earth-hq.bundle.js',metafile:true});
const inputs=[...new Set([...Object.keys(api.metafile.inputs),...Object.keys(worker.metafile.inputs)])];
const unexpected=inputs.filter(path=>path.includes('node_modules/three')||path.startsWith('src/demo/')||/src\/(geometry|terrain-material|terrain-atmosphere|streamer|satellite)\.js$/.test(path));
if(unexpected.length)throw Error('API bundle contains renderer/UI dependencies: '+unexpected.join(', '));
writeFileSync('dist/api-inputs.json',JSON.stringify(inputs,null,2));
await build({...options,entryPoints:['src/api.js'],format:'esm',outfile:'dist/earth-hq.esm.js'});
const notice=n=>n+'\n'+readFileSync('node_modules/'+n+'/LICENSE','utf8');
const licenses='Provider-derived decoder provenance: see SOURCE-NOTICES.txt in the source repository. No blanket license is asserted for this code.';
for(const name of ['earth-hq.bundle.js','earth-hq.esm.js'])writeFileSync('dist/'+name,readFileSync('dist/'+name,'utf8')+'\n/* Bundled library notices\n'+licenses.replaceAll('*/','* /')+'\n*/\n');
const demo=!process.argv.includes('--api-only')&&existsSync('src/demo/app.js');
if(demo){
 const result=await build({...options,entryPoints:['src/demo/app.js'],format:'iife',write:false,loader:{'.jpg':'dataurl'}});
 const html=readFileSync('src/demo/index.html','utf8').replace('__APP__',()=>result.outputFiles[0].text.replaceAll('</script','<\\/script'));
 writeFileSync('globo-hq.html',html+'\n<!-- Bundled library notices\n'+['three','decode-dxt','three-mesh-bvh'].map(notice).join('\n\n')+'\n-->\n');
}
console.log(JSON.stringify({standaloneBytes:readFileSync('dist/earth-hq.bundle.js').length,esmBytes:readFileSync('dist/earth-hq.esm.js').length,demo}));
