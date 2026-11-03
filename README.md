# Tiles 3D High Res API

A compiled, renderer-independent JavaScript API for satellite tiles and maximum-detail photogrammetric 3D data. It is the tile engine extracted from `globo-hq.html`: the viewer and this API share the same traversal, request priority, refinement, cache, cancellation, retention and transition code.

**Use `dist/earth-hq.bundle.js`.** It exposes `globalThis.EarthHQ` through a classic script. The file contains the metadata parser, payload decoder and embedded decoder workers. It contains **no Three.js, UI, canvas, WebGL renderer, terrain shader, camera controller or animation loop**. Your application supplies the camera state and consumes image bytes and mesh arrays.

`dist/earth-hq.esm.js` is the same self-contained API as an ES module. It has no external Three.js import. You need only one format.

## Build

Use Node.js 24.22.1 and npm 11.10.1, pinned in `.nvmrc` and `package.json`.

```sh
npm ci
npm run build:api
```

This compiles the API files and writes `dist/api-inputs.json`, the actual dependency inventory. The build fails if the API graph contains the viewer, its rendering adapters or Three.js. No runtime npm installation is needed when loading the compiled browser bundle.

`npm run build` additionally builds the optional `globo-hq.html` viewer. Its Three.js integration stays outside the API bundle. See [viewer and previews](docs/viewer.md). Generated files, downloaded provider data and local test reports are excluded from Git.

## Start the engine

```html
<script src="earth-hq.bundle.js"></script>
<script>
const engine = new EarthHQ.EarthTileEngine();

engine.addEventListener('tile-load', ({ layer, tile }) => {
  if (layer === '3d') {
    // Consume tile.meshes and tile.matrixGlobeFromMesh in your own renderer.
    console.log(tile.descriptor.key, tile.meshes, tile.matrixGlobeFromMesh);
  } else {
    // Unmodified encoded image; no resizing or raster-to-mesh conversion.
    console.log(tile.node.bounds, tile.data, tile.mimeType);
  }
});
engine.addEventListener('tile-update', ({ layer, tile }) => {
  // 3D: apply tile.mask and tile.passes. 2D: apply tile.visible.
});
engine.addEventListener('tile-unload', ({ layer, tile }) => {
  // Release your application's graphics resources for this tile.
});
engine.addEventListener('error', ({ layer, error }) => console.error(layer, error));

awaitStart().catch(console.error);
async function awaitStart() {
  await engine.start();
  const surface = EarthHQ.geoToECEF(41.88931, 12.49223);
  const normal = surface.clone().normalize();
  engine.update({
    position: surface.clone().addScaledVector(normal, 150).toArray(),
    direction: normal.clone().multiplyScalar(-1).toArray(),
    up: [0, 0, 1],
    fovYDegrees: 52,
    viewportWidth: 1280,
    viewportHeight: 800
  });
}
// In your host's frame loop: engine.update(currentCameraState).
// On shutdown: await engine.dispose().
</script>
```

The engine starts requests automatically from camera demand. It never creates a screen, starts a render loop or captures input. Call `update` every host frame so that request retirement and parent/child transition timing continue even when the camera is stationary. Start once before updating. Public positions accept `[x, y, z]` arrays or `{x, y, z}` objects.

For module consumers:

```js
import { EarthTileEngine } from './earth-hq.esm.js';
const engine = new EarthTileEngine();
```

## Camera contract

Coordinates are Earth-centred, Earth-fixed (ECEF) metres. Direction and up are world-space vectors. `fovYDegrees` is the vertical field of view. Viewport dimensions are **drawing-buffer pixels**, including your device-pixel/render scale. The default clipping distances are 0.1 and 150,000,000 metres; pass `near` and `far` to match your host.

If your host already calculates matrices, pass `position`, `direction`, a 16-element column-major `viewProjection` matrix that maps ECEF to clip space, and `pixelScale`. Clip depth uses the WebGL/OpenGL range `[-1, +1]`. `pixelScale` is drawing-buffer width multiplied by the horizontal perspective projection coefficient divided by two. No renderer-specific camera object is required. `createView(input)` validates and normalizes either representation.

Optional second argument to `engine.update(view, options)` controls the terrain region: `radiusMeters`, `focusECEF`, `viewDirectionECEF`, `viewHalfAngle`, `nearRadiusMeters` and `collisionRadiusMeters`. Default 3D range is 2 km. 3D camera streaming activates below 2,500 m with 500 m altitude hysteresis; the 2D engine continues independently.

## Data returned

### 3D tiles

`tile-load` supplies a terrain asset with these fields:

| Field | Meaning |
| --- | --- |
| `descriptor` | Provider path, epoch, terminal flag, texel size, ECEF bounds and request key |
| `matrixGlobeFromMesh` | Float64Array of 16 column-major affine coefficients, local mesh to ECEF |
| `meshes` | Prepared geometry and source textures, without graphics objects |
| `decoded` | Complete decoded provider payload, including original packed geometry and layers |
| `copyrightIds` | Provider copyright identifiers |
| `mask` | Currently selected octants, one bit per octant |
| `passes` | Current primary/secondary transition plan: `id`, `mask`, `opacity`, `secondary` |
| `byteLength` | Estimated retained payload/array storage, excluding general JS object overhead |
| `disposed` | Whether the engine released this asset |

Each prepared mesh contains `positions` (Uint8Array, three local components per vertex), `uv` (Float32Array, two components per vertex), `indices` (Uint16Array or Uint32Array, triangle list), `vertexOctants` (Float32Array of `2 ** octant`), `octants` (eight index arrays), `surface`, `texture` and the original decoded `source` mesh. Positions use the supplied affine transform; they are not normalized coordinates.

`texture` retains provider `textureFormat`, `width`, `height` and encoded `bytes`. The observed format 6 contains DXT1 blocks and format 1 contains JPEG bytes. The API does not downsample, convert to RGBA or upload them. Prepared triangles use the viewer's visible terrain layers; `decoded` and `mesh.source` preserve the remaining provider layers and attributes rather than discarding them.

Transition plans preserve the viewer's octant coverage and paired parent/child selection. A host that wants the same visual transitions must implement the corresponding draw passes. Graphics shader execution, atmosphere and blending belong to the renderer; the existing viewer adapter remains an implementation example.

### 2D tiles

A satellite record contains `node` (`z`, `x`, `y`, `key`, geographic `bounds` and texel size), `data` (Uint8Array of the original encoded image), `blob`, `mimeType`, `visible` and `used`. No ImageBitmap or graphics object is created by the API. Your host decodes the image if needed. Missing fine imagery keeps the parent selected, as in the viewer.

Assets are engine-owned. Release host GPU resources on `tile-unload`; copy buffers if they must outlive eviction/disposal. `dispose()` cancels owned requests and workers and releases cached/resident state. Merely retaining an event's asset in your own application can keep its JavaScript arrays alive.

## Maximum detail

Camera-driven 3D selection uses the same projected-texel thresholds, mesh angular correction, parent dependencies and request comparator as the viewer. It descends to actual provider terminals as their projected detail requires it. There is no fixed depth-22 or depth-25 ceiling. Nearby and visible detail is refined before lower-priority requests. Decoded meshes and texture bytes remain at their delivered resolution.

To require **all actual terminal meshes in a bounded area**, independently of camera pixel size:

```js
const terrain = new EarthHQ.TerrainTileEngine();
await terrain.start();
terrain.addEventListener('tile-load', ({ asset }) => consume(asset));
const coverage = await terrain.requestRegion({
  latitude: 41.88931,
  longitude: 12.49223,
  radiusMeters: 25
});
if (!coverage.complete) console.error(coverage.errors);
// Use terrain.getAttribution() wherever you display the content.
await terrain.dispose();
```

A terminal-area request can be much larger than the camera-selected view. It is explicit and bypasses automatic altitude gating. Keep the area and memory budget appropriate for your application. Unknown metadata, failed selected tiles and capacity exhaustion remain incomplete; no missing branch is silently declared complete.

Satellite selection retains the viewer's adaptive Web Mercator traversal, with `maxZoom: 22` by default and an explicit configurable ceiling up to 30. The configured ceiling is **not proof that the provider supplies distinct high-resolution imagery at every level/location**. Missing images retain their parents; neither the viewer nor the API can manufacture source detail. Source imagery and photogrammetry coverage vary geographically.

## Options and controls

```js
const engine = new EarthHQ.EarthTileEngine({
  terrain: {
    radiusMeters: 2000,
    retainRadiusMeters: 2300,
    screenSpaceError: 1,
    concurrency: 18,
    maxResidentBytes: 512 * 1024 ** 2,
    cacheBytes: 512 * 1024 ** 2,
    cacheName: 'my-tile-cache',
    activationAltitudeMeters: 2500,
    altitudeHysteresisMeters: 500
  },
  satellite: { maxZoom: 22, maxTiles: 512, concurrency: 8 }
});
```

Set `terrain: false` or `satellite: false` to disable that engine. `fetch` at the top level supplies a custom transport function to both; a per-engine `fetch` overrides it. The 3D source supports a custom `baseUrl` or `source`. Smaller positive `screenSpaceError` values demand more camera detail. Region requests without a camera traverse terminals regardless of that value.

`engine.terrain` is the shared `TerrainTileEngine`; `engine.satellite` is the shared `SatelliteTileEngine`. They are also exported separately.

Terrain methods include `start`, `update`, `requestRegion`, `getCoverage`, `getAttribution`, `waitForIdle`, `retryFailed`, `setEnabled` and `dispose`. `setGpuBudget(bytes)` is retained from the viewer for compatibility and controls the same capacity accounting; in this data-only API it limits retained data, without allocating a GPU. `maxResidentBytes` is the preferred constructor option. Coverage supplies `residentBytes`; `gpuBytes` remains a legacy alias. `complete` describes data readiness, while `transitioning` counts visual plans still changing.

Satellite methods include `update`, `status`, `getAttribution` and `dispose`. `resident` exposes loaded records and `needed` the selected keys. `status()` reports target/ready zoom, resident/visible count, pending/queued work and the latest error. A ready zoom does not prove that every selected tile is ready.

Unified events are `tile-load`, `tile-update`, `tile-unload`, `progress`, `warning` and `error`; `layer` identifies `3d` or `2d`. A standalone terrain engine uses `asset` in tile events; the unified engine additionally exposes it as `tile`. Progress/warning events are emitted by the terrain workflow; satellite changes use its tile events and `status()`.

Low-level exports are `RocktreeSource`, `ByteTransport`, `MemoryByteCache`, `IndexedDbByteCache`, `ResilientByteCache`, `TileError`, `TileFade`, `geoToECEF`, `ecefToGeo`, `satelliteBounds` and `createView`. These are this project's APIs, not a claim to expose every private API of the reference application.

## Request and cache behavior

The 3D pipeline uses bounded, deduplicated requests with independent demand subscriptions, reprioritization and real aborts. Obsolete camera payloads survive the reference two-frame grace interval and are retired on the following frame. Canceling an old consumer does not abort a request still needed by another. Active and queued stale requests are canceled, partial downloads are not cached and late canceled results cannot attach a tile. Transient failures retry up to three attempts with a 15-second timeout per attempt.

3D bytes use freshness-aware memory/IndexedDB caches. IndexedDB failure falls back to RAM and is reported. The satellite engine retains its separate bounded LRU of encoded images and browser HTTP caching, queue, missing-image backoff and off-view cancellation. Persistent-cache availability depends on browser origin and storage policy. No whole-planet offline download is implied.

## Validation and provenance

```sh
npm run fixtures
npm test
npm run build
npm run test:browser
npm run test:automatic
```

Fixture acquisition verifies pinned hashes and does not silently replace changed captures. Browser checks use installed Chrome; set `BROWSER_EXECUTABLE` to override its path. Ignored reports are in `test-results/`.

The source suite passes 81 tests. The extraction tests compare camera projection/frustum decisions, 3D requested/selected inventories and masks, geometry arrays, and 2D selected keys/request order between the API and the viewer. They also exercise terminal depth 32, raw texture/image bytes and renderer-free event/disposal behavior. The existing cancellation, cache, capacity, altitude, transition and collision tests continue to exercise the shared implementation. The compiled API browser check passed with 21 terminal tiles in Rome and 5 in Milan, 36 persistent-cache hits after browser restart, and 173 satellite tiles including level-22 JPEG data. It verified embedded workers, decoded mesh/texture arrays, 256×256 raster dimensions and disposal with no canvas or Three.js export. This verifies delivered level-22 data at the sampled location, not distinct source detail worldwide.

Reference evidence: [traversal and renderer analysis](docs/reference-client-analysis.md), [request cancellation](docs/request-cancellation-analysis.md), [transitions](docs/transition-analysis.md), [transition eligibility](docs/transition-eligibility-analysis.md), and [atmosphere analysis](docs/atmosphere-cpu-analysis.md). Atmosphere/shader rendering stays in the optional viewer, outside this API. The documented comparisons establish those paths, not full binary identity with the reference application.

Both layers use Google-operated services: Rocktree at `https://kh.google.com/rt/earth/` and satellite raster tiles at `https://mt1.google.com/vt`. These are undocumented endpoints with provider-dependent availability, CORS and protocol behavior. No API key is embedded. Display provider attribution when rendering the data. Imagery, geometry and client-derived decoder code are not relicensed by this project; see [SOURCE-NOTICES.txt](SOURCE-NOTICES.txt).

## Source ownership

- `src/api.js`: renderer-independent public exports and unified facade.
- `src/terrain-engine.js`: the shared 3D scheduler, traversal, transitions and lifetime.
- `src/satellite-engine.js`: the shared 2D selector, request queue and lifetime.
- `src/tile-data.js`: one owner for decoded geometry interpretation and angular correction.
- `src/view.js`, `src/math.js`, `src/geo-core.js`: CPU camera and geographic calculations.
- `src/source.js`, `src/transport.js`, `src/demand.js`, `src/cache.js`, `src/decoder.js`: shared data pipeline.
- `src/streamer.js`, `src/satellite.js`, `src/geometry.js`: optional Three.js adapters.
- `src/demo/`: optional viewer UI and navigation.

Migration: the compiled API no longer exports `THREE`, `EarthHQStreaming` or the graphical `SatelliteLayer`. Use the data classes above. The legacy source adapters remain available to the viewer; its application is compiled separately.
