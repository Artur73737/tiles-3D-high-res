# Atmosphere CPU uniforms: reference evidence

This analysis uses the shipped `20261015_1200_RC02` WebAssembly client captured from `https://earth.google.com/static/multi-threaded/versions/20261015_1200_RC02/index.html`. The WebAssembly file is 27,469,502 bytes, SHA-256 `43a58f7cd6f96202771a05db16ce3b72e0a1cd8d319a1d55bbc8c6ef9b66d63f`. It is compiled shipping code, not recovered original C++ source. Function numbers and hexadecimal addresses below identify this artifact only.

The ignored investigation directory `.bench/reference-20261102/assets/` retains the artifact, exact function index, table-slot index, passive-segment memory map and `atmosphere-<function>.txt` LLVM disassemblies. Memory addresses are mapped through individual passive segments; a single file-to-memory offset is insufficient. `atmosphere-cpu-evidence.json` records hashes of the relevant retained evidence.

## Uniform ownership

`AtmosphereGpuUploads` function 33122 calls function 6357 to produce its CPU uniform structure, then function 13181 binds those fields. The `cameraAndSunState` vector uses float32 fields 216, 220, 224 and 228. Function 6357 at `0x2bd2b4–0x2bd305` produces:

- `x`: camera radius in planet-radius units.
- `y`: dot product of the normalized camera position and normalized sun direction.
- `z`: `2 * R * (cameraRadius - 1) * tan(fovY / 2)`.
- `w`: the atmosphere fade computed by the renderer and copied to CPU structure double field 40.

The normal planet radius is `R = 6371010` meters. Function 537 returns `1 / R`; function 718 supplies the planet radius. The `z` width uses altitude above the reference sphere, while the fade calculation below uses altitude above the sampled ground. These are separate inputs in the reference.

## Default sun direction

Function 6357 obtains the planet projection from factory function 503 with selector 3. That factory returns an object with vtable at linear address 8684936. The basis is established by its actual virtual functions:

| Vtable byte offset | Functions | Result |
| --- | --- | --- |
| 28 | 32876, then 32911 | Normalized derivative with respect to longitude: east |
| 32 | 32875, then 32907 | Normalized derivative with respect to latitude: north |
| 36 | 32908 | Normalized radial up |

The internal planet axes convert to shader ECEF axes as `(-internalZ, -internalX, internalY)`. This is a proper rotation, so the basis and axis-angle rotation retain their orientation.

Functions 1442, 8307 and 4881 produce camera angles. Function 6357 takes the resulting heading, negates it, and calls function 1006 to construct a quaternion around radial up. With `E`, `N`, `U` denoting the local east, north and up basis, and `h` the heading in radians:

```text
Er = rotateAroundAxis(E, U, -h)
Nr = rotateAroundAxis(N, U, -h)
near = U - 0.25 * Er - 0.75 * Nr
far  = U - 0.75 * Er + 0.75 * Nr
t = clamp((altitudeMeters - 1000000) / 1000000, 0, 1)
sun = normalize((1 - t) * near + t * far)
```

The reference blends the unnormalized vectors and normalizes the result once. The construction and blend are in function 6357 at `0x2bac96–0x2baecb`; output conversion and float32 storage are at `0x2baeeb–0x2baf14`. The low-altitude east coefficient before normalization is `-0.25*cos(h) - 0.75*sin(h)`, and north is `0.25*sin(h) - 0.75*cos(h)`.

The separately captured low-altitude uniforms have radial sun component approximately `0.78446458`, matching `1 / sqrt(1 + 0.25^2 + 0.75^2)`. This is a consistency check, not a substitute for the basis derivation. Captured heading was not independently recorded.

There is also a timestamp-driven astronomical branch after `0x2baf18`, involving functions 2635 and 6348 and an additional blending field. The default relative-light calculation above must not be described as a complete reconstruction of that separate feature.

## Automatic atmosphere fade

Renderer function 33085 owns the atmosphere settings at renderer offset 9480. It calculates the fade in settings double field 64, copies that value to the GPU CPU-structure field 40 at `0xbd2975–0xbd2987`, and function 6357 converts it to the uniform's float32 `w`.

The automatic calculation at `0xbd219f–0xbd231e`, with angles in radians, is:

```text
R = 6371010
h = (cameraAltitudePlanetUnits - sampledGroundPlanetUnits) * R
L = 2 * h * tan(fovY / 2)
widthFade = clamp((L - 73900 * widthScale) / (147800 * widthScale), 0, 1)

if L >= 13000000:
    horizon = 0
else:
    horizon = asin(min(1, R / (h + R))) - 0.55 * fovY
    if L > 10000:
        horizon *= (1 - (L - 10000) / 12990000)^2

tiltFade = clamp((abs(tiltFromNadir) - (horizon - PI / 12)) / (PI / 12), 0, 1)
fade = max(widthFade, tiltFade)
```

Function 8307 computes tilt from the camera forward vector and radial normal through `acos(clamp(-dot(forward, normal), -1, 1))`, with a signed-camera-orientation adjustment; the fade consumes its absolute value. Function 1432 is the `asin` implementation, function 983 is `acos`, and function 685 is `tan`.

Initial settings are proven by constructor function 33082:

- `0xbc8289–0xbc828f`: automatic mode field 4 is 1.
- `0xbc82d5–0xbc82e1`: `widthScale`, field 104, is double 1.
- `0xbc8343–0xbc8347`: special override byte 200 is zero.
- `0xbc8263–0xbc826e`: tweak field 24 is double 3.

If the special override byte is 1, function 33085 sets fade to 1. Nonautomatic modes also set fade to 1. Function 13154 changes the width scale to 20 for its mode selector 1 and to 1 for selector 0; the user-facing names of those two selectors are not inferred here.

## Ground sampling and the initial fallback

The fade does not require an invented constant ground elevation. Renderer constructor 33082 installs `mirth::earth::PlanetGeoSurface` at renderer field 548, vtable 3952060. At `0xbd2182–0xbd2192`, the fade calls that object's virtual function 12 with the camera geographic location, selector 3 and a false option. Function 6312 forwards to virtual function 16, function 33053.

Function 33053 checks its available surface providers and uses the applicable sampling paths through functions 4227 and 4997. When both contribute valid heights, the greater value wins. A separate active-provider branch also exists. When the normal sampled providers are absent, it delegates to its owned fallback at field 56.

That fallback is `mirth::geodesy::SphereGeoSurface`, vtable 3252108. Constructor 33082 initializes its double field 24 to zero at `0xbcd7a9–0xbcd7ab`. Its virtual sampler, function 32880, returns that field for selector 3. Thus zero altitude is the proven initial spherical fallback. Supplying an available actual mesh ground intersection and falling back to zero reproduces this boundary for a mesh-only viewer; it does not imply that every original terrain provider has been reconstructed.

## Verification scope

The formulas above are derived from the retained compiled artifact and checked against the previously captured uniform relationships. They do not by themselves establish image equivalence at every camera angle, location, altitude or historical timestamp. GPU equations, lookup tables and render comparisons have separate evidence and tests. No browser session was operated as part of this CPU investigation.
