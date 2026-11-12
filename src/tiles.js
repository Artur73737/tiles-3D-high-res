// Standalone tile API: Google 2D imagery and Google 3D photogrammetry (maximum resolution).
// API-only: Tiles2D/Tiles3D. With UI: createViewer(target, options) mounts an iframe viewer on the same API.
import {Tiles2D,GOOGLE_LAYERS,GOOGLE_SCALES,GOOGLE_MAX_ZOOM,GOOGLE_LAYER_ORDER,GOOGLE_VECTOR_LIMIT,layerConflicts,resolveLayers,STYLE_ELEMENTS,encodeStyle,lonLatToTile,tileBounds,metersPerPixel} from './api/tiles2d.js';
import {Tiles3D} from './api/tiles3d.js';
export {Tiles2D,Tiles3D,GOOGLE_LAYERS,GOOGLE_SCALES,GOOGLE_MAX_ZOOM,GOOGLE_LAYER_ORDER,GOOGLE_VECTOR_LIMIT,layerConflicts,resolveLayers,STYLE_ELEMENTS,encodeStyle,lonLatToTile,tileBounds,metersPerPixel};
export {TileError} from './core/errors.js';
export {geoToECEF,ecefToGeo} from './core/geo.js';
export {Geocoder,GEOCODER_PROVIDERS,zoomForBounds} from './api/geocode.js';
export {TileEnhancer,enhanceSupported,CAS_GLSL} from './api/enhance.js';
export {SharpenPass} from './ui/scene/postfx.js';
export {LOGO_SVG,LOGO_FAVICON} from './ui/logo.js';
export {routeUrl,discoverProxy} from './core/net/proxy.js';
// Intelligence layers (data sources usable without the viewer) and measuring helpers.
export {makeLayers,LAYER_IDS} from './intel/index.js';
export {snapBounds} from './intel/scheduler.js';
export {position as satellitePosition,SAT_GROUPS} from './intel/layers/satellites.js';
export {distance,bearing,interpolate,pathLength,polygonArea,formatDistance,formatArea} from './core/geodesy.js';
export {distanceResult,areaResult,heightResult,samplePath,TOOLS} from './tools/measure.js';
export {terrainElevation} from './tools/elevation.js';
export {toGeoJSON,fromGeoJSON,toKML,fromKML,parseGeo} from './tools/geoformat.js';
export {createViewer,VIEWER_DEFAULTS} from './ui/viewer.js';
export const VERSION='1.1.0';
export function createTiles(mode,options={}){if(mode==='2d')return new Tiles2D(options);if(mode==='3d')return new Tiles3D(options);throw new TypeError("createTiles mode must be '2d' or '3d'");}
