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

The observed trace separately establishes PlanetoidMetadata/BulkMetadata/NodeData ordering, mixed-depth payloads and texture format/imagery epoch URLs. This asset analysis adds a real screen-projection formula and hysteresis constants. It does not prove all internal rendering, cache, scheduling or eviction behavior has been reconstructed. Raw captures remain ignored local artifacts. The subsequent active shader reconstruction below adapts recovered source and records its notices and provenance; this report preserves artifact hashes and derived findings.

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

These operations resolve the previously unknown angular formula and active global power in the captured view. The subsequent transition and cancellation reports resolve the active fade metric and stale-demand policy. Optional alternate distance modes and the full cache/scheduler implementation remain outside the verified scope.

- live-distance-settings.json: 1557 bytes; SHA-256 fac58b2d4c689e38941b1e9d3c92c72974dd36b7807cecfa783e9c015e58d493

- angular-weight-setter.txt: 9781 bytes; SHA-256 91274370195c77d12ca6148a5f70ef856fa903c007f40f0161f9a40ec852b0e9

- mesh-angular-weight.txt: 8001 bytes; SHA-256 2f72816fd9354397e0ddb94c01cb66f74750860c61c42e3c277ff70fcd053a61

- normalized-geographic-transform.txt: 1921 bytes; SHA-256 cad14f1e243b9eabbd5c18a6e2f73ec19887d8776cd0c64667b820c25aaab24b

- rockmesh-constructor.txt: 23455 bytes; SHA-256 50b75db2d923fe5c406867ff55d2cac7c726a98d14290e424b994d829d7c66ca


## Payload admission, resident staging and request records

Further source analysis separates spatial classification, traversal admission, request touch and rendering. Func6024 (0x29fb78–0x29fced) classifies node bounds against up to six clip volumes, returning0/1/2. It is not a cache or payload-availability check.

The outer RockTraverser walker is func8627, body4085865–4087319 (rock-node-walker.txt). It calls per-node13098 before node initialization (0x3e59ee–0x3e59fc and0x3e5b81–0x3e5b8f), pushes a child traversal frame only when13098 returns true, and calls finalize13097 after descendants (0x3e5d92–0x3e5d99 /0x3e5dbc–0x3e5dc2). An admitted stop node still finalizes:13098 writes an independent admission output flag; rejection writes false at0x6d3a8a–0x6d3a8f.

For cold, non-fading state, admission is score>=lower (with shallow bootstrap), while continuation is score>upper (with shallow bootstrap). Below-lower children are rejected; they do not replace their parent's footprint. Consequently, a parent above upper can remain the visible fallback for child octants whose scores are already below lower. Queuing every visited child before calculating score violates this admission rule. Above-lower ancestors are admitted too; this does not establish a policy requesting only terminal nodes.

There is also a resident-parent gate on continuation. At0x6d3a43–0x6d3a87, continuation bypasses the gate for traverser6448=2/3, no parent frame, no parent node, or parent.node679!=1; otherwise it requires parentFrame[4]!=0. Func6344 (0x2b9a34–0x2b9a59) returns node948, the current resident mesh pointer, only when node679==1. Func13110 at0x6d5fc6–0x6d5fce sets679=!(metadata.flags&8), with later mode-specific suppression possible. The gate tests the immediate parent, not the current node: the current node is admitted/request-touched even if it cannot continue. Hence two data-bearing generations can be touched concurrently, then deeper traversal waits for resident ancestors. This is not a rule requiring each current node's own payload before considering its children. Network response arrival alone does not establish mesh residency, and this analysis does not independently prove every texture/GPU readiness condition.

The additional passive live capture live-fade-settings.json observed view mode3208=2 with6448=1 and mode3208=1 with6448=3; both were active in the same tilted view. These numeric mappings are observed. Assigning photogrammetry/imagery semantic names to these two traversers is an inference, not established by their numeric fields alone. The owned browser exited after the read.

Finalize13097 calls request-touch13112 at0x6d2e4a–0x6d2e50. Func13112 constructs a context containing node pointer, node traversal state, float100, traversal6448 and a time/tag, and forwards metadata resource684 via PlanetFetcher vfunc40 and mesh resources692/728/736/744/752 via vfunc36. The receiver's RTTI identifies PlanetFetcher (3951804), reached from IFetcher by dynamic_cast in8627. Main vtable at file0x149e5d9 maps vfunc40 to13139 and36 to13140.

- Metadata touch13139,0x6dd919–0x6dd940, suppresses when context mode!=0, state exists, and either spatial state16==1 or score28< -0.2.
- Payload touch13140,0x6dda49–0x6dda70, applies the same spatial suppression but its score cutoff is negative largest finitefloat, so ordinary admitted payloads are not rejected by this second score test.
- Both construct records with6332 and append through3979. Func6332 at0x2b8987–0x2b899e copies the traversal score into record.f32[12]; it also preserves explicit request priority record.f32[24], mode/tag record.i32[28] and flags20/21. There is no gaze-cone bucket calculation in this record constructor.
- Func33057 sorts/drains queued categories through10706/10705/10704/4685. Comparator branches in10706 at0x4f8f04–0x4f8f79 compare tag28, request priority24, flag20, score12, flag21. The subsequent ordering section and [cancellation report](request-cancellation-analysis.md) resolve ordinary priority and stale-demand semantics; these comparisons alone do not establish every request category or concurrency policy.

## Postorder octant masks

Before descendants, walker8627 at0x3e5a94–0x3e5ab4 initializes state48=state49=(residentMesh?mesh.byte788:255) and state50=state51=0. Func30206 writes spatial classification16 and zeros mask48 if classification==1.

Finalize13097 updates the immediate parent's octant only when current.state32 is admitted and a parent traversal state exists. A resident current mesh produces state code2. Without a current mesh it uses child coverage8318, converts partial1 to0, and propagates full2; a node with neither data nor terminal flag skips propagation. Func8317,0x3ae596–0x3ae5ec, sets parent's bit51/clears50 for code1, and sets50/clears51 for code2. Code0 leaves them unchanged. Func8318,0x3ae5ed–0x3ae625, returns2 if every mask48 bit is in50,1 if any mask48 bit is in51 or only some in50, and0 otherwise.

The ordinary remaining draw mask is state48 & state49 & ~(state50|state51), used at0x6d2e57–0x6d2e76 and by traversal-state virtual getters. Rejected below-lower children do not finalize or clear their parent octant. Loaded child meshes replace only their own octant. Partial descendants without a resident intermediate mesh do not prove full ancestor-octant coverage.

## Fade dependency continuation and alpha

The prior description of a last-visited frame needs refinement: it is a fade dependency timestamp, not ordinary metadata visitation and not a permanent refined-path set. Func13110 at0x6d5cf0–0x6d5d21 constructs an embedded TimeFadeUnpopState at node840 (=traversalState64), vtable8567020. Its frame field96 is initialized -1 by node936 store at0x6d5da1–0x6d5da5. Getter8485 (0x3d5c83) reads96; setter30321 (0xaed14e) writes96. Those are vfunc56 and52 respectively.

Finalize13097 calls TimeFadeUnpopState30319 with current unpop state, frame, parent IUnpoppable when remaining child mask permits it, current IUnpoppable and current time. In30319,0xaed0ea–0xaed107 marks the **parent argument's** unpop state with current frame after the intermediate paired blending path. Alpha0/1 branches exit earlier (0xaecdfb /0xaece2f), as do absent/incompatible parent and immediate-selection paths. The node's last-frame continuation at0x6d385b–0x6d3874 therefore keeps parents needed for an active child's transition. Marking every visited/refined node, or every rendered partial parent, as recently used can keep traversal permanently over-refined.

Pair prerequisites in30319: current IUnpoppable.vfunc0 reports a resident selected resource; a parent exists; parent.vfunc8 accepts the current child's octant (parent resident mesh mask788 contains that octant); current.vfunc16 permits pairing. The latter RockNode state getter checks spatial-transition bytes34/33/20/16 plus node.hasData, resident mesh and !(mesh.flags792&16). Pairing also records a projected point and uses immediate selection if its movement exceeds a configured NDC/frame threshold. The mesh-layer flag producer and resident spatial history are resolved in [transition eligibility](transition-eligibility-analysis.md).

The passive run observed fadeEnabled byte9804952=1, duration f32[9804956]=1 second, score width f32[9804960]=2 and NDC movement cutoff f32[10573012]=0.10000000149011612. Func8336 (fade-metric-8336.txt,0x3b0bab–0x3b0e37) drives alpha using a metric state embedded at unpopState16. Constructor defaults: alpha0, thresholdT=-1, anchor0, lastTime=-1, start=-1. Source-derived pseudocode for the enabled branch:

    if now <= lastTime: return
    lastTime = now
    if score <= T-W or (score <= T and alpha == 0):
        alpha=0; anchor=T-W; start=-1; return
    if score >= T+W or (score >= T and alpha == 1):
        alpha=1; anchor=T+W; start=-1; return
    q = clamp(abs(anchor-T)/W, 0, 1)
    D = duration * (1-q/2)
    if (score>T) == (anchor<=T) or start == -1:
        anchor=score; start=now-0.05*D
    time = clamp((now-start)/D, 0, 1)
    if anchor >= T:
        spatial=clamp((score-anchor)/(T+W-anchor),0,1)
        alpha=max(alpha,spatial,time)
    else:
        spatial=clamp((score-anchor)/(T-W-anchor),0,1)
        alpha=min(alpha,1-max(spatial,time))

The WASM uses f32 at score/alpha boundaries. Func30319 further clamps alpha and applies smoothstep x*x*(3-2*x) at0xaecff6–0xaed027. Func30323 (0xaed17e) selects current immediately via12315, resetting alpha1,anchor=T+W,start=-1 and pair pointers/masks; it does not stamp a parent dependency. Func30322 clears selection through12315 alpha0,anchor=T-W,start=-1. Intermediate blending stores primary and secondary IUnpoppable pointers and masks for the renderer; recreating only opacity without these coverage rules is not full binary equivalence.


### Verified request ordering and paired output

The two-element path of sort10706 establishes comparator direction by its conditional swap at0x4f7f8c–0x4f80db. Its lexicographic key is record.i32[28] ascending, f32[24] descending, byte20 true first, f32[12] descending, byte21 true first. Func6332 sets record28=context12=traverser6448, not a resource-kind tag. Record24 is100 for ordinary13112 touches. Byte21 denotes the payload-kind context; byte20 is true for metadata-kind, or for payload-kind when score<global10562408. Static initializer45770 sets10562408=99.0 at0x10bf3f1–0x10bf3fc; its only other direct reference is6332. Therefore ordinary admitted score<99 records in the same6448 mode and request-priority class compare by decreasing source view score, with payload-kind first on exact score ties. This is concrete source evidence for removing unrelated gaze-cone buckets; it does not reconstruct every category's final transport/cancellation behavior.

For the normal initial TimeFadeUnpopState setting i32[8]=1, paired output after smoothstep s is:

- s<0.5: primary=parent, primaryMask=1<<childOctant, secondary=current, secondaryMask=currentDrawMask, secondaryBlend=2*s+(1-2*s)/64.
- s>=0.5: primary=current, primaryMask=currentDrawMask, secondary=parent, secondaryMask=1<<childOctant, secondaryBlend=2-2*s+(2*s-1)/64.

The source is30319,0xaed031–0xaed0e7;30327 exposes primary blend1 and secondary blend above. Constructor13110 sets the initial frame/settings pair at node844 to i64 8589934591, i.e. frame-1 and setting1. A separate setting0 branch modifies which side stays primary; it is not the observed constructor default. Endpoint alpha0/1 selects only parent/current respectively. Both intermediate branches stamp the parent's fade dependency frame. Masking applies only the parent octant replaced by this child; a whole-parent opacity change would incorrectly affect unrelated octants. The fragment/depth meaning is established by the shader source and runtime draw-state capture below, independently of the pointer/weight output.

Additional raw artifact live-fade-settings.json has SHA-256 471cbe3a48b7f349c1bc82c20565d99e5e137741932d317a2111d3017dcda847. Newly generated targeted disassemblies and their hashes are retained in ignored assets/manifest.json. The previously listed angular-weight-setter.txt was expanded from a focused excerpt to its complete function; the current manifest, not the earlier excerpt digest, identifies that expanded file.

## Active terrain shader and observed transition draw state

Observed source version: [reference client index](https://earth.google.com/static/multi-threaded/versions/20261015_1200_RC02/index.html), with the previously identified WASM digest. This section records active photogrammetric terrain shading. Other layers, KML overlays, oceans, weather, astronomical-time settings and optional skyboxes remain outside this reconstruction.

The WASM contains intact shader ZIPs at file offsets21631125–21753787 (46 entries) and26286665–26327471 (38 entries), retained under those offset names in ignored assets. The first supplies rockmesh.vp/fp, ground.glsllib, atmosphere.glsllib, atmosphereuniforms.glsllib, inscatter.vp/fp and two atmosphere PNG lookups. The second supplies shared texturefilter.glsllib. Passive GL inspection independently recovered compiled program28 vertex/fragment sources. Its active defines include DRAPED, FLOAT_TEXTURES, ENABLE_ATMOSPHERE, ENABLE_ROCK_NORMALS and TEXTURE_MULTISAMPLE_SHARP. ENABLE_LIGHTING, FRAGMENT_ATMOSPHERE and optional skybox/cloud/water defines are absent. Active terrain atmosphere therefore uses radial lighting. The normal conversion vec3(-aNormal.z,-aNormal.x,aNormal.y) exists for other lighting/drape paths.

Vertex opacity occupies uMeshToWorldMatrix[2][3], with the octant mask in[3][3]. The shader restores the affine last row before transforming positions and rejects octants using floor(fract(mask/(2*aPosition.w))*2), where aPosition.w=2^octant. Final clip position is multiplied by1000 and the selected bit. SHARP filtering averages texture samples at uv±a,uv±b, where a=.33083706448*dFdx(uv)+.16567086877*dFdy(uv) and b=-.16567086877*dFdx(uv)+.33083706448*dFdy(uv). The fragment multiplies alpha by abs(opacity) and emits premultiplied RGB. It has no signed-opacity depth displacement, transition dithering or alpha discard in this active path.

The owned runtime capture runtime-rock-draws-warm-fixed.json observed14,760 program28 draws during gradual zoom, including1,070 with intermediate opacity (minimum .01567264273762703). Primary draws disabled blending and used depth LEQUAL with writes enabled. Secondary draws used ONE/ONE_MINUS_SRC_ALPHA for RGB and alpha, depth LEQUAL and writes disabled. Both used BACK culling, CCW front faces, depth range[0,1], no polygon offset, stencil disabled and the default framebuffer. Secondary draws appeared in contiguous bursts separated by primary gaps, including6648–6650,6716–6724 and6790–6798. This supports primary-then-secondary terrain ordering; the hook did not label complete scene frames and does not prove ordering of unrelated layers. All recorded intermediate opacities were positive. Runtime atmosphere/sky/inscatter textures used LINEAR min/mag, anisotropy1; terrain textures used LINEAR min/mag, anisotropy8.

### Atmosphere resources and formulas

The Bruneton model uses an8×128 RGBA transmittance/multiple-scatter lookup, a64×16 RGBA sky irradiance lookup, and a per-view64×128 float RGBA inscatter target containing two64×64 distance slices. All use linear filtering. Decoded PNG lookup bytes remain raw: the shader explicitly squares sky irradiance, so hardware sRGB conversion would apply a second conversion. The precompute integrates9 trapezoid samples, storing radiance RGB and log(red transmittance) alpha. Normalized constants include inner radius6350/6360, outer6420/6360, Rayleigh scale8/6360 and coefficient(.0058,.0135,.0331)*6360, Mie scale1.2/6360 and coefficient(.004)*6360, Mie extinction/.9, Mie g=.8, maximum inscatter distance800/6360 and inverse white point(.91,.99,1.6).

The vertex evaluates sun irradiance, sky irradiance, aerial transmittance and inscatter. Ground RGB is squared and multiplied by.55/PI and incident irradiance. The night sky minimum is .014*smoothstep(0,.2,-sunZenithCosine). Night color mixes luminance*(.874,.874,2.622) with ground color using1-.75*night. Aerial color is ground*transmittance+inscatter. After exposure multiplication, tone mapping is1-exp(-(sqrt(R)+R)/1.8). Final color mixes raw and tone-mapped input using cameraAndSunState.w. Runtime exposure20, tweak3 and fade .30698299407958984 establish that atmosphere is active rather than an optional omitted fog approximation.

CPU producer6357 (atmosphere-6357.txt, stores0x2bd27f–0x2bd2bc) sets cameraAndSunState=(camera radial distance, dot(camera,sun)/radius,2*planetRadius*(cameraRadius-1)*tan(fovY/2),fade). AtmosphereGpuUploads33122 calls it;13181 binds the result. Default non-astronomical sunlight uses EAST,NORTH,UP: factory503(3), vtable8684936, virtual28→32876→32911,32→32875→32907,36→32908. Rotate east/north around up by negative heading. Near raw sun is UP-.25*EASTrot-.75*NORTHrot; far raw sun is UP-.75*EASTrot+.75*NORTHrot. Interpolate raw vectors with clamp((altitude-1000000)/1000000,0,1), then normalize. This reproduces the observed Rome sun direction within2e-5 using rounded URL heading37.4373496 degrees.

Automatic fade comes from33085 at0xbd219f–0xbd231e, state64→producer40→uniform.w. With above-ground height h, vertical FOV f and width scale k, L=2*h*tan(f/2); widthFade=clamp((L-73900*k)/(147800*k),0,1). Start horizon=asin(min(1,6371010/(h+6371010)))-.55*f. For10000<L<13000000 multiply by(1-(L-10000)/12990000)^2; for L>=13000000 use0. tiltFade=clamp((abs(tilt)-(horizon-PI/12))/(PI/12),0,1). Final fade is max(widthFade,tiltFade). Tilt=acos(clamp(-dot(viewForward,planetUp),-1,1)), confirmed8307 at0x3ad2ad–0x3ad326. Constructor33082 initializes automatic mode1, width scale1, tweak3 and no override at0xbc8289,0xbc82d5,0xbc8263,0xbc8343. Nonautomatic mode or override byte200 sets fade1. The sphere ground provider starts at altitude0 (33082,0xbcd7a9–0xbcd7ab); loaded valid surface providers contribute ground height. The module accepts a sampled ground radius or above-ground height, with the same zero-altitude fallback.

### Verification

An owned local WebGL2 test compiled the actual captured program15 inscatter fragment and the reconstructed precompute with identical lookup bytes and uniforms. Six altitude/sun cases rendered64×128 RGBA32F buffers: maximum absolute component error0, no mismatched nonfinite values. Full results and script are retained in .bench/reference-20261102/atmosphere-numerical.json and verify-atmosphere.mjs. Committed test/fixtures/atmosphere-reference.json retains independent original-shader samples; test/atmosphere-rendering.mjs verifies them on the GPU and compiles/renders the integrated terrain material. This does not establish equality for every terrain geometry or optional scene effect. Focused lifecycle tests cover per-renderer shared LUT ownership, final release, host-state restoration and retry after precompute failure, and consistent globe/mesh/camera transforms.

Ignored shader evidence SHA-256:

- embedded-21631125.zip: a19abb31d40241e50476e14f87962ff2275d7760f4e398d673f176a7d05fa214.
- embedded-26286665.zip: bebdba4a851f4f4fc7ee1a7f7cf2a105f1948edde2d39266d6afe3a6bbf9c3ed.
- shader-program-28-vert.glsl: 9621249a5f251fa3479d43c9416e6fc20852deb4bfcb4cd7ed0580b3212c4bfa.
- shader-program-28-frag.glsl: 9397b234c219f5ab151a170f598865142abcfe9d684612a7983994ef1735c522.
- shader-program-15-frag.glsl: 3cdd7f777f399bc8f1b45724e7e0a43d488cd908096d82fc17821f984a8728a0.
- runtime-rock-draws-warm-fixed.json: fc3f5e0f1e25d887a5aa50663319151c33dda36d5d504c4ae7ddaea0791aa9f9.
- shader-sources/atmospheretransmittance.png: 032100a9c3b15a72cd80e5d6f6b1c4e84aabfa195e76536cd5cf33ae48fb9657.
- shader-sources/skyirradiance.png: 0c2426331dd880ee7f2c9202ec9e5b5d6e63af82bdcee5efd2c9d77260ab69eb.
