import {build} from 'esbuild';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));process.chdir(root);mkdirSync('dist',{recursive:true});
const options={bundle:true,minify:true,target:['chrome110','firefox115'],legalComments:'inline',logOverride:{'duplicate-case':'silent'}};
// Rocktree decoder worker, bundled to a string and started from a Blob URL (src/core/rocktree/decoder/pool.js).
const worker=await build({...options,entryPoints:['src/core/rocktree/decoder/worker.js'],format:'iife',write:false});
options.define={__TILES_DECODER_WORKER__:JSON.stringify(worker.outputFiles[0].text)};
await build({...options,entryPoints:['src/index.js'],format:'iife',globalName:'EarthHQ',outfile:'dist/earth-hq.bundle.js'});
await build({...options,entryPoints:['src/tiles.js'],format:'iife',globalName:'Tiles',outfile:'dist/3d_tiles.bundle.min.js'});
await build({...options,entryPoints:['src/index.js'],format:'esm',external:['three'],outfile:'dist/earth-hq.esm.js'});
const notice=n=>n+'\n'+readFileSync('node_modules/'+n+'/LICENSE','utf8');
const licenses=['three','decode-dxt'].map(notice).join('\n\n');
for(const name of ['earth-hq.bundle.js','earth-hq.esm.js','3d_tiles.bundle.min.js'])writeFileSync('dist/'+name,readFileSync('dist/'+name,'utf8')+'\n/* Bundled library notices\n'+licenses.replaceAll('*/','* /')+'\n*/\n');
{const esc=x=>x.replaceAll('</script','<\\/script');const page=readFileSync('src/standalone/index.html','utf8').replace('__TILES__',()=>esc(readFileSync('dist/3d_tiles.bundle.min.js','utf8')));writeFileSync('standalone.html',page+'\n<!-- Bundled library notices\n'+licenses+'\n-->\n');}
console.log(JSON.stringify({tilesBytes:readFileSync('dist/3d_tiles.bundle.min.js').length,standaloneBytes:readFileSync('dist/earth-hq.bundle.js').length,esmBytes:readFileSync('dist/earth-hq.esm.js').length}));
