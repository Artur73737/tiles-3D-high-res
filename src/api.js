import {EventDispatcher} from './math.js';
import {TerrainTileEngine} from './terrain-engine.js';
import {SatelliteTileEngine} from './satellite-engine.js';
import {createView} from './view.js';
export {TerrainTileEngine,SatelliteTileEngine,createView};
export {RocktreeSource} from './source.js';
export {satelliteBounds} from './satellite-engine.js';
export {MemoryByteCache,IndexedDbByteCache,ResilientByteCache} from './cache.js';
export {ByteTransport} from './transport.js';
export {TileError} from './errors.js';
export {geoToECEF,ecefToGeo} from './geo-core.js';
export {TileFade} from './transitions.js';

// The same two engines used by the viewer, with data-only assets and no graphics adapter.
export class EarthTileEngine extends EventDispatcher {
 constructor({terrain={},satellite={},fetch}={}){
  super();this.terrain=terrain===false?null:new TerrainTileEngine({fetch,...terrain});this.satellite=satellite===false?null:new SatelliteTileEngine({fetch,...satellite});
  for(const [layer,engine]of [['3d',this.terrain],['2d',this.satellite]])if(engine)for(const type of ['tile-load','tile-update','tile-unload','progress','error','warning'])engine.addEventListener(type,event=>this.dispatchEvent({...event,layer,tile:event.asset??event.tile}));
 }
 start(){return this.terrain?.start()??Promise.resolve(null);}
 update(view,options={}){const snapshot=createView(view);this.terrain?.updateView(snapshot,options);this.satellite?.updateView(snapshot);}
 getCoverage(){return {terrain:this.terrain?.getCoverage()??null,satellite:this.satellite?.status()??null};}
 async dispose(){await Promise.all([this.terrain?.dispose(),this.satellite?.dispose()]);}
}
