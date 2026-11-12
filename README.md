# Tiles

Google satellite imagery (2D) and Google photorealistic 3D at full resolution, in one standalone
script: `dist/3d_tiles.bundle.min.js`. Three.js is bundled. The script exposes the global `Tiles`.

Two ways to use it, sharing the same API:

- **API only.** `Tiles.Tiles2D` and `Tiles.Tiles3D` fetch tiles and decode them for you.
- **Viewer.** `Tiles.createViewer(target, options)` mounts an iframe with the full UI on top of the same API.

| 3D fly | 2D satellite | Globe |
|---|---|---|
| ![3D fly](docs/previews/image.png) | ![2D satellite](docs/previews/image%20copy.png) | ![Globe](docs/previews/image%20copy%202.png) |

## Build

```bash
npm ci
npm run build      # dist/3d_tiles.bundle.min.js + standalone.html
npm test
```

`standalone.html` is a ready-to-open demo: the bundle plus a single `createViewer` call.
It is published on GitHub Pages at <https://artur73737.github.io/tiles-3D-high-res/> on every push to `main`.
It accepts `?view=flat|globe&mode=2d|3d|fly&lat=..&lon=..&zoom=..`.

### Local server with CORS proxy

```bash
python serve.py                 # http://127.0.0.1:8080
```

`serve.py` uses only the Python standard library. It serves `standalone.html` and `dist/` (nothing
else from the folder), with CORS headers. It also adds a CORS proxy, `/proxy?url=…`, for feeds that
block browsers, such as live aircraft. When the page is opened through it, the viewer detects the proxy
and sends its 2D tiles and data feeds through it (3D stays direct: Rocktree already sends CORS headers). That
turns on live aircraft, and makes missing Google tiles readable: they are reported quietly (204 +
`X-Upstream-Status: 404`) instead of filling the console with CORS errors. Only the hosts the proxy lists at `/proxy/health` are sent to it (everything else goes direct), so an older or
narrower proxy cannot break requests it does not forward. Any page can do the same with `Tiles.discoverProxy(location.href)`, or
`network: { proxyUrl: 'http://127.0.0.1:8080/proxy?url=' }` (or `Tiles2D.setProxy(url)`).

The proxy is not open:

- it accepts only GET over https;
- it forwards only to the ADS-B hosts it knows, unless you pass `--allow HOST`;
- responses are limited in size and time.

It listens on 127.0.0.1 unless you pass `--host`.

## Load

```html
<script src="3d_tiles.bundle.min.js"></script>
<script>
  console.log(Tiles.VERSION);
</script>
```

## Viewer (iframe UI)

```html
<div id="map" style="width:100%;height:600px"></div>
<script src="3d_tiles.bundle.min.js"></script>
<script>
  const viewer = Tiles.createViewer('#map', {
    view: 'flat',            // 'flat' | 'globe'
    mode: '3d',              // '2d' | '3d' | 'fly'
    latitude: 41.89021,
    longitude: 12.49223,
    zoom: 18,
    panel: true,             // right sidebar (options)
    layersPanel: true,       // left sidebar (layers + enhance)
    d2: { layers: ['s', 'h'], scale: 2, language: 'en' },
    d3: { radiusMeters: 500, fullDetailMeters: 150, dropDistanceMeters: 3000, gpuBudgetMb: 8192 },
    network: { concurrency: 12, retries: 2 },
    cache: { mode: 'persistent', diskMb: 1024 },
  });

  viewer.goTo({ latitude: 48.8584, longitude: 2.2945, zoom: 17 });
  viewer.setView('globe');
  viewer.setMode('fly');
  viewer.set({ d2: { layers: ['y'] } });          // changes apply live
  viewer.on('place', p => console.log(p.name));   // also: move, mode, view, tile, error, status
  // viewer.destroy();
</script>
```

Loaded 3D tiles stay when the camera moves or turns. A tile is removed only in three cases:

- It is replaced by tiles covering the same ground. Detail never goes down, and a coarse tile stays
  until all of its finer tiles are ready.
- It is farther than `dropDistanceMeters` from you (3000 by default).
- The loaded tiles use more than `gpuBudgetMb` of GPU memory, measured on the actual buffers and
  textures. The farthest tiles go first. Browsers do not report VRAM, so the default is conservative:
  2048 MB on desktop, 512 MB on tablet, 256 MB on phone. Raise it to match your GPU (for example 8192
  on a 12 GB card).

### Intelligence layers and tools

The left sidebar has the live data layers and the measuring tools, in all views (flat 2D, flat 3D,
globe).

| Layer | Source | Notes |
|---|---|---|
| Aircraft | ADS-B (adsb.lol / adsb.fi) | needs a CORS proxy (`serve.py` provides one); from zoom 6 |
| Satellites | CelesTrak + SGP4 | live positions, ground track of the selected one; one download per group every 2 h (cached) |
| Earthquakes | USGS | past hour / day / week / month, by magnitude |
| Natural events | NASA EONET | wildfires, volcanoes, storms, floods… |
| Weather radar | RainViewer | flat 2D map |

How the layers stay fast:

- Data loads only for the visible area, on a grid that follows the zoom, once the camera stops.
- Small pans reuse what is already loaded.
- At low zoom, dense layers are drawn as dots (satellites) or counted bubbles; labels appear when you
  zoom in.

Click an object to see its details.

Tools: distance, area, height (base then top, works on 3D buildings), elevation profile, line of sight
and markers. For elevation they use the loaded Google 3D surface, or a terrain model where nothing 3D
is loaded. Results export to and import from GeoJSON and KML.

```js
viewer.intel.enable('earthquakes');
viewer.intel.set('earthquakes', { period: 'week', level: '4.5' });
viewer.intel.set('aircraft', { proxyUrl: 'http://127.0.0.1:8080/proxy?url=' });
viewer.intel.layers();                    // [{id, enabled, status, count, error, options}, ...]
viewer.tools.start('distance');           // then click on the map; Enter / double-click finishes
viewer.tools.items;                       // [{type, name, points, result: {text, ...}}, ...]
const geojson = viewer.tools.exportGeoJSON();
```

The same building blocks work without the viewer: `Tiles.makeLayers()` returns the data sources (each
has `load({bounds, zoom, options})`), and the bundle exports the geodesy helpers (`Tiles.distance`,
`Tiles.polygonArea`, …), `Tiles.satellitePosition` and the GeoJSON / KML converters.

### Phones and tablets

The viewer detects the device (`desktop`, `tablet` or `mobile`) and adapts:

- The sidebars become drawers over the map.
- The navbar is compact, and touch targets are larger.
- Touch gestures:
  - 2D: drag to pan, pinch to zoom.
  - 3D: drag to orbit, two fingers to pan.
  - Globe: drag to pan, pinch to zoom, twist to rotate, two-finger drag to tilt.
- Fly mode has an on-screen stick, up / down buttons, and drag to look around.

Desktop is unchanged. To force a device class, pass `createViewer(target, { device: 'mobile' })` or
call `viewer.setDevice('tablet')`. `viewer.getDevice()` returns the current class, and the `device`
event fires when it changes.

Other controller methods: `zoomIn()`, `zoomOut()`, `resetNorth()`, `searchPlaces(text)`,
`setGeocoder({...})`, `setEnhance({...})`, `exportPNG()`, `getView()`, `getStats()`, `getFps()`.

## API only

### 2D imagery

```js
const t2 = new Tiles.Tiles2D({ layers: ['s'], scale: 2, language: 'en' });

const tile = await t2.getTile(18, 140111, 97411);          // { bytes, mimeType, ... }
const url  = t2.tileUrl(18, 140111, 97411);
const max  = await t2.findMaxZoom(41.89021, 12.49223);      // deepest real imagery

const img = await t2.getImage(
  { west: 12.490, north: 41.892, east: 12.494, south: 41.888 }, 18);
document.body.append(img.canvas);                           // or await img.blob()
```

Scale: `1`, `1.5`, `2`, `3` or `4` (256 to 1024 px tiles, the values Google accepts). The viewer
defaults to `2`. A larger tile holds the same detail as the next zoom level in one image, so on screen
it means fewer, heavier requests rather than sharper imagery. Google lacks some tiles above scale 1 (seen at z11-12, mostly over sea); those are
rebuilt from the scale-1 tiles one level deeper (same detail), or from the scale-1 tile itself where nothing finer
exists.

Layers: `s` satellite, `y` hybrid, `h` labels, `m` roadmap, `p` terrain+, `t` relief,
`r` roads, `traffic`, `transit`, `bike`. Styles go through `setStyle('s.t:3|p.v:off')`.

### 3D meshes

```js
const t3 = new Tiles.Tiles3D({ radiusMeters: 150, coordinates: 'local' });
t3.setLocation(41.89021, 12.49223);

const list = await t3.listTiles();                 // descriptors, no payload yet
const tile = await t3.getTile(list.tiles[0]);      // positions, uvs, indices, texture per mesh
const h    = await t3.getElevation(41.89021, 12.49223);

// Three.js scene object (Three.js is in the bundle; any renderer works)
const group = await t3.toThree(tile, { renderer });
scene.add(group);

// Everything in the area, with progress
await t3.getTiles({}, { onProgress: p => console.log(p.done, '/', p.total) });
```

### Place search

```js
const geo = new Tiles.Geocoder();                  // 'auto' | 'photon' | 'nominatim' | 'google' (apiKey)
const [best] = await geo.search('chernobyl');      // { name, context, latitude, longitude, zoom }
```

Every option has a setter and can also be passed to `set({...})`. Examples: `setLayers`, `setScale`,
`setRadius`, `setFullDetailRadius`, `setConcurrency`, `setRetries`, `setCache`.

## React

Load the bundle once (for example in `index.html`), then mount the viewer in an effect:

```jsx
import { useEffect, useRef } from 'react';

export function TilesViewer({ lat, lon, zoom = 18, mode = '3d' }) {
  const host = useRef(null);
  const viewer = useRef(null);

  useEffect(() => {
    viewer.current = window.Tiles.createViewer(host.current, {
      latitude: lat, longitude: lon, zoom, mode,
    });
    return () => viewer.current.destroy();
  }, []);

  useEffect(() => {
    viewer.current?.goTo({ latitude: lat, longitude: lon, zoom });
  }, [lat, lon, zoom]);

  return <div ref={host} style={{ width: '100%', height: 600 }} />;
}
```

API only in React works the same way: create a `Tiles2D` or `Tiles3D` in an effect and call
`dispose()` in the cleanup.

## Source

```
src/tiles.js         bundle entry (global Tiles)
src/core/            errors, geo, net/ (transport, cache, shared requests, priority), rocktree/ (decoder workers)
src/api/             Tiles2D, Tiles3D, Geocoder, enhancer
src/core/            also geodesy (distances, areas, bounds)
src/ui/              viewer, template, controls, input/ (device, gestures, fly pad),
                     scene/ (globe, 3D streaming, fade, sharpen, map view: geo <-> screen in every view)
src/intel/           scheduler (batched, zoom-aware loading), overlay, panel, popup, feed cache,
                     layers/ (aircraft, satellites, earthquakes, events, radar)
src/tools/           measuring tools, elevation, GeoJSON / KML
serve.py             local server + restricted CORS proxy
```
