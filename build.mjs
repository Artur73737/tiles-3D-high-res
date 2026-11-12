import {build} from 'esbuild';
import {LOGO_FAVICON as FAVICON} from './src/ui/logo.js';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));process.chdir(root);mkdirSync('dist',{recursive:true});
// satellite.js re-exports an optional WebAssembly build that needs Node modules; the viewer uses the
// JavaScript SGP4 only, so that one module is replaced by an empty one.
const noSgp4Wasm={name:'no-sgp4-wasm',setup(b){b.onResolve({filter:/[\\/]wasm[\\/]index\.js$/},a=>/satellite\.js/.test(a.importer)?{path:'sgp4-wasm',namespace:'empty'}:undefined);b.onLoad({filter:/.*/,namespace:'empty'},()=>({contents:'export {}',loader:'js'}));}};
const options={bundle:true,minify:true,target:['chrome110','firefox115'],legalComments:'inline',logOverride:{'duplicate-case':'silent'},plugins:[noSgp4Wasm]};
// Rocktree decoder worker, bundled to a string and started from a Blob URL (src/core/rocktree/decoder/pool.js).
const worker=await build({...options,entryPoints:['src/core/rocktree/decoder/worker.js'],format:'iife',write:false});
options.define={__TILES_DECODER_WORKER__:JSON.stringify(worker.outputFiles[0].text)};
await build({...options,entryPoints:['src/index.js'],format:'iife',globalName:'EarthHQ',outfile:'dist/earth-hq.bundle.js'});
await build({...options,entryPoints:['src/tiles.js'],format:'iife',globalName:'Tiles',outfile:'dist/3d_tiles.bundle.min.js'});
await build({...options,entryPoints:['src/index.js'],format:'esm',external:['three'],outfile:'dist/earth-hq.esm.js'});
const notice=n=>{const d='node_modules/'+n+'/',f=['LICENSE','LICENSE.md','LICENSE.txt'].find(x=>existsSync(d+x));return n+'\n'+readFileSync(d+f,'utf8');};
const licenses=['three','decode-dxt','satellite.js'].map(notice).join('\n\n');
for(const name of ['earth-hq.bundle.js','earth-hq.esm.js','3d_tiles.bundle.min.js'])writeFileSync('dist/'+name,readFileSync('dist/'+name,'utf8')+'\n/* Bundled library notices\n'+licenses.replaceAll('*/','* /')+'\n*/\n');
{const esc=x=>x.replaceAll('</script','<\\/script');const page=readFileSync('src/standalone/index.html','utf8').replace('__FAVICON__',()=>FAVICON).replace('__TILES__',()=>esc(readFileSync('dist/3d_tiles.bundle.min.js','utf8')));writeFileSync('standalone.html',page+'\n<!-- Bundled library notices\n'+licenses+'\n-->\n');}
console.log(JSON.stringify({tilesBytes:readFileSync('dist/3d_tiles.bundle.min.js').length,standaloneBytes:readFileSync('dist/earth-hq.bundle.js').length,esmBytes:readFileSync('dist/earth-hq.esm.js').length}));
