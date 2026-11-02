# Captured renderer asset analysis

Target: https://earth.google.com/static/multi-threaded/versions/20261015_1200_RC02/index.html

Asset acquisition is read-only. This report analyzes downloaded shipping artifacts, not an original C++ source tree. The loader exposes C++/Emscripten renderer code in earthplugin_web.wasm; main.dart.js is primarily the Flutter UI. Its advertised main.dart.js.map returned HTTP 404. No WASM name/DWARF/source-map custom sections are present. Node WebAssembly.Module accepted the module (static compile, no module execution). WABT executables were not installed. Installed LLVM llvm-objdump was used for selected disassembly; these are ordinary local observations rather than REA Evidence IDs.

## Confirmed projection calculation

WASM function 12218, body offsets 6374201–6374460; disassembly view-metric-formula.txt, addresses 0x614337–0x61443b:

- Copies view eye and forward vectors to output object offsets 0/24.
- Stores horizontal FOV at output[48].
- output[56] = tan(horizontalFov / 2) / (viewportWidth / 2).
- output[64] = tan(verticalFov / 2) / (viewportHeight / 2).
- output[72] = max(output[56], output[64]) squared.

Frame setup function32980, body12245632–12246426, copies this80-byte object to traverser[3264]. Thus traverser[3320] is inverse horizontal pixel scale. The renderer does not select detail from a latitude/longitude radius alone.

## Confirmed detail score operations

RockTraverser identity inferred from C++ RTTI string at WASM file21626621, with its preceding vtable at21626497. Vtable slot0xa677 maps via element table to function32980 (camera setup). Setup reads/writes traverser[3240], [3244], [3248], [3252], [3256]; cross-references to these fields locate actual per-node function13098, body7155408–7158430 (rock-selection-candidate.txt).

Key disassembly addresses:

- 0x6d3582–0x6d358c: nodeMetric = availabilityFactor * metricNode.f32[648].
- 0x6d35ae–0x6d3618: distance denominator is camera-to-nearest-box Euclidean distance or absolute forward-depth, times inverse horizontal pixel scale. Branch uses traverser mode/flags. Denominator is clamped above approximately1e-20.
- 0x6d362b–0x6d3734: optional angular correction, enabled when nodeAngularWeight[656] >0 and traverser[3344] >0. The dot product of normalized directions enters an additional divisor. This optional setting's actual live value is unknown.
- 0x6d3747–0x6d375b: projectedMetric = 256 * nodeMetric / denominator.
- 0x6d3760–0x6d3778: score = traverserBias[3240] + log(projectedMetric / qualityFactor[3256]) *1.442695 (log2 conversion).
- 0x6d379a–0x6d37a8: a per-node selection flag is score >= threshold[3244]. Additional fading paths below this threshold handle a -2 window or prior score minus0.2.
- 0x6d384a–0x6d387c: continuation flag = score > upperThreshold[3248] OR lastVisitFrame == currentFrame-1 OR nodeDepth <3.

The constructor function13078 (traverser-constructor.txt,0x6cfb09–0x6cfb23) initializes3252=256,3256=256,bias3240=0,threshold3244=0. Frame setup at0xbadd21–0xbadd3f sets upper3248=threshold3244+0.8, then3256=3252*setting709()/setting710(). The latter functions wrap dynamic global setting values; the observed live values below establish their ratio for one captured run.

For ordinary nodes, with equal quality setting ratio, these operations simplify to:

    projectedTexels = metersPerTexel * horizontalPixelScale / cameraDistance
    score = bias + log2(projectedTexels)

where cameraDistance uses nearest oriented-box distance or forward depth, depending on mode. Optional angular correction can further modify it.

## Observed live settings (source-identified memory fields)

After the static field/vtable reconstruction, an owned reference browser was launched and CDP Runtime.evaluate passively read its global WASM memory. Two RockTraverser instances were found by their vtable pointer3957892 at heap offsets82543304 and82555936. Both had the same settings:

| Field | Value |
| --- | --- |
| Bias3240 | -0.32192808389663696, approximately log2(0.8) |
| Lower threshold3244 | -1 |
| Upper threshold3248 | -0.19999998807907104 |
| Nominal tile size3252 | 256 |
| Quality factor3256 | 256 |
| Global quality settings709 /710 | 96 /96 |
| Inverse horizontal pixel scale3320 | 0.0007833510282707663 |
| Maximum depth3356 | -1 (sentinel for no configured level cap) |
| Traversal mode3208 | 2 and1 respectively |

For these observed settings, the cold refinement threshold is projectedTexels >2^(upper-bias), approximately1.088188. The lower selection threshold is projectedTexels >=2^(lower-bias), approximately0.625. A recently visited path can continue across the threshold band; fade-state conditions also influence exact transitions. This is a positive0.8 log2 band, not a negative-0.8 coarsening threshold.

The results and target URL are preserved in live-settings-page.json. The script only read typed values from existing memory; it did not alter application variables, code or configuration. The dedicated browser was closed. An earlier attempt to read every pthread target hit per-target Runtime deadlines; its remaining Node harness was stopped after confirming the browser had exited. The successful page-session observation is a separate complete result. These values describe this version/run, not every configuration or future release. A subsequent bounded run resolves the angular correction setting and mode-specific distance flag below. A full binary-equivalence claim is not established.

## Node metric semantics and parent fallback

Function13110 (node-metric-assignment.txt,0x6d61f7–0x6d6243) reads one metadata float (either singular source at offset80 or repeated-list element), scales it by the global world-coordinate scale and stores node[648]. The same value immediately expands packed metadata OBB coordinates/extents. At0x6d6578–0x6d6587 a fallback stores2*boxExtent/256. These operations establish a world-units-per-texel metric; calling it metersPerTexel is a derivation from the dataflow rather than a retained C++ field name.

Function13098 at0x6d2f26–0x6d2f49 sets availabilityFactor=.5 and substitutes parent.node only when parent metadata is borrowed. Ordinary current-node metadata uses factor1. Earlier branching depends on traverser.flags6456 and node.flags681&1, so .5 must not be applied to every child merely because it has a parent.

## Threading and fetching

- earthplugin_web.js line779: pthreadPoolSize = Math.min(navigator.hardwareConcurrency,12), preallocated workers. Workers reuse the same compiled WASM module/shared memory.
- Loader lines~9760–9820 map the C++ fetch request to XMLHttpRequest or FetchXHR based on the streaming flag. Request URL, method, timeout and headers come from WASM-side structs.
- FetchXHR.send at line~10165 uses fetch with AbortController, streamed body reads and progress reporting.
- No application-level tile concurrency limit was established from these transport wrappers. The12-worker pool is not proof of12 network requests.

## Boundaries

The observed trace separately establishes PlanetoidMetadata/BulkMetadata/NodeData ordering, mixed-depth payloads and texture format/imagery epoch URLs. This asset analysis adds a real screen-projection formula and hysteresis constants. It does not prove all internal rendering, cache, scheduling or eviction behavior has been reconstructed. No renderer source was copied into production; raw captures remain ignored local artifacts; this report preserves their hashes and the derived findings.

## Artifacts and SHA-256
- index.html: 16220 bytes; SHA-256 79b3da439dd96e6b07505ceec72a1c5a95c09ffef22668ee8e0d86e587d68bd8
- main.dart.js: 11425334 bytes; SHA-256 44b1ef7351a064daf355b1e455428ac8ac36df03f1a7a5b7ce6c9d2a37802a0d
- earthplugin_web.js: 438741 bytes; SHA-256 8485d9f7b0beab207aea6c41e9877e460362f2d8c238a6dfa9eb0f5cad85ff4e
- earthplugin_web.wasm: 27469502 bytes; SHA-256 43a58f7cd6f96202771a05db16ce3b72e0a1cd8d319a1d55bbc8c6ef9b66d63f
- rock-traverser-vfunc.txt: 11341 bytes; SHA-256 25c1fbdf02a98ea331a8a2dd9d051f3a077be46ff996cd2261204a59a9f3ae59
- rock-selection-candidate.txt: 52118 bytes; SHA-256 49001c533565a53f79b06dafac4bd7b36db6e3afbc7bc4d3b95ef5c4829529d2
- view-metric-formula.txt: 4328 bytes; SHA-256 8c00aaf07bb2e8fa1e2f98c08b79cda8681a88a2b42e20b8eaec704ad3db157a
- node-metric-assignment.txt: 21767 bytes; SHA-256 7224ab1e11adf86fe96f00385ea27a50e4930f87188339bf0764f626bbcf9fa7
- traverser-constructor.txt: 18868 bytes; SHA-256 034e579c58b78a9147688a557e3c955d0624d7afa4dfb13f74aca207a646d0f6

- live-settings-page.json: 1372 bytes; SHA-256 76fc2119eaf63aaf9ddc0128c9060bce5c2d4bb538c4bca332d12cc813ea6892

## Verified active distance and angular correction

A subsequent owned page-session read (live-distance-settings.json) found flags3352=0 and angularPower3344=0.2 for both active modes1/2. Static branch0x6d35b2–0x6d3617 selects absolute forward depth when mode!=0 and !(flags3352&1); other branches use Euclidean nearest-box distance. Thus the observed view uses:

    cameraDistance = abs(dot(viewForward, closestOBBPoint - eye))

Before projection, func13098 at0x6d3666–0x6d3733 applies the following angular factor when nodeWeight656>0 and angularPower3344>0:

    outward = normalize(closestOBBPoint - globeOrigin)
    ray = normalize(closestOBBPoint - eye)
    cosine = max(0, -dot(outward, ray))
    factor = max(1e-9, 1-nodeWeight + nodeWeight*pow(cosine, angularPower))
    adjustedProjectedTexels = projectedTexels * factor

The correction is implemented as division of the distance denominator by factor, hence multiplication of final projected texels. Function1144 is f64,f64→f64 power, including x==1/y==0 special cases. The upper/lower thresholds and bias described above apply after this factor.

### Mesh-derived nodeWeight

Node weight is not a fixed metadata constant. Func13107 at0x6d594f–0x6d5957 copies loaded RockMesh.f64[1080] to RockNode.f64[656]; absence of mesh resets it to0. RockMesh weight is calculated by func13125, body7191750–7192236, excerpt mesh-angular-weight.txt:

- Geographic min bounds: mesh.f64[728,736,744]. Max bounds: [752,760,768]. Invalid/empty bounds produce weight1.
- Mesh.i32[192]<=1 produces weight0. Constructor func13122,0x6d8b1f–0x6d8b32, copies this integer from the first word of its path argument; the same argument is passed to the octant-extraction function4222 at0x6d8ceb. This supports path-depth semantics, not vertex count.
- A=G(minLongitude,minLatitude,minAltitude), B=G(maxLongitude,maxLatitude,minAltitude), C=G(midLongitude,midLatitude,maxAltitude).
- weight=max(0,1-distance((A+B)/2,C)/distance(A,B))^4.

G is confirmed by func1217, body540601–540724 (normalized-geographic-transform.txt): it reads three doubles, multiplies longitude/latitude bypi, adds longitude offsetpi/2, applies sin/cos and radius1+altitude. It does not take or read a mesh transform matrix. The rotation of its output frame does not affect the distance ratio; production can use its ECEF convention after converting mesh vertices through the payload matrix and deriving normalized geographic bounds.

These operations resolve the previously unknown angular formula and active global power in the captured view. Exact fade-state behavior, optional alternate distance modes and all cache/scheduler policies remain outside the reconstructed scope.

- live-distance-settings.json: 1557 bytes; SHA-256 fac58b2d4c689e38941b1e9d3c92c72974dd36b7807cecfa783e9c015e58d493

- angular-weight-setter.txt: 9781 bytes; SHA-256 91274370195c77d12ca6148a5f70ef856fa903c007f40f0161f9a40ec852b0e9

- mesh-angular-weight.txt: 8001 bytes; SHA-256 2f72816fd9354397e0ddb94c01cb66f74750860c61c42e3c277ff70fcd053a61

- normalized-geographic-transform.txt: 1921 bytes; SHA-256 cad14f1e243b9eabbd5c18a6e2f73ec19887d8776cd0c64667b820c25aaab24b

- rockmesh-constructor.txt: 23455 bytes; SHA-256 50b75db2d923fe5c406867ff55d2cac7c726a98d14290e424b994d829d7c66ca
