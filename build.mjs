import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));process.chdir(root);mkdirSync('dist',{recursive:true});
const options={bundle:true,minify:true,target:['chrome110','firefox115'],legalComments:'inline',logOverride:{'duplicate-case':'silent'}};
await build({...options,entryPoints:['src/index.js'],format:'iife',globalName:'EarthHQ',outfile:'dist/earth-hq.bundle.js'});
await build({...options,entryPoints:['src/index.js'],format:'esm',external:['three'],outfile:'dist/earth-hq.esm.js'});
const notice=n=>n+'\n'+readFileSync('node_modules/'+n+'/LICENSE','utf8');
const licenses=['three','decode-dxt'].map(notice).join('\n\n');
for(const name of ['earth-hq.bundle.js','earth-hq.esm.js'])writeFileSync('dist/'+name,readFileSync('dist/'+name,'utf8')+'\n/* Bundled library notices\n'+licenses.replaceAll('*/','* /')+'\n*/\n');
if(existsSync('src/demo/app.js')){
 const result=await build({...options,entryPoints:['src/demo/app.js'],format:'iife',write:false,loader:{'.jpg':'dataurl'}});
 const html=readFileSync('src/demo/index.html','utf8').replace('__APP__',()=>result.outputFiles[0].text.replaceAll('</script','<\\/script'));
 writeFileSync('globo-hq.html',html+'\n<!-- Bundled library notices\n'+licenses+'\n\n'+notice('three-mesh-bvh')+'\n-->\n');
}
console.log(JSON.stringify({standaloneBytes:readFileSync('dist/earth-hq.bundle.js').length,esmBytes:readFileSync('dist/earth-hq.esm.js').length,demo:existsSync('globo-hq.html')}));
