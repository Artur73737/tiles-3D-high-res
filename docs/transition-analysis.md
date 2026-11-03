# Terrain transition reconstruction

Reference artifact: the 20261015_1200_RC02 renderer WASM identified in [the capture report](reference-client-analysis.md). SHA-256: `43a58f7cd6f96202771a05db16ce3b72e0a1cd8d319a1d55bbc8c6ef9b66d63f`.

## Executed comparison

`test/reference-fade.mjs` constructs an isolated WebAssembly module from the **unchanged function bodies** of TimeFadeMetric update (8336, file bytes 3869613–3870263) and reset (12315, 6479803–6479910). It preserves the original type section, supplies a shared memory and a two-entry virtual table, and uses a no-op frame bookkeeping callback. It does not execute the full application or contact the provider. The input artifact digest is checked before extraction; binary bodies are not committed.

The test compares alpha, anchor, last-time and start-time against `src/transitions.js` after each original invocation. Rising, falling, reversed and oscillating score sequences run at time origins 0, 3600 and 86400 seconds. **1,863 steps matched exactly**, including float32 roundoff. This establishes the metric arithmetic for these cases, not full renderer equivalence.

The compiled falling branch compares score to anchor and then the lower endpoint in the order retained in the implementation. Replacing this with a presumed symmetric interpolation changes observable behavior. The float32 conversion of time endpoints also matters at long time origins.

Run the comparison with an explicitly supplied matching capture:

```sh
node test/reference-fade.mjs /path/to/earthplugin_web.wasm
```

## Paired selection

Function30319 supplies parent/current primary and secondary selections with octant masks. It uses the smoothstep of the metric alpha, changes the primary at 0.5, and computes the secondary coefficient with a 1/64 offset. Parent dependency is retained only during the intermediate pair. Projected motion beyond 0.1 NDC per consecutive frame selects the current mesh immediately. Parent/current endpoints do not keep that dependency alive. The source addresses and runtime settings are recorded in the capture report.


The UnpopState virtual-table slot 12 resolves to function13108, which reads object float32 offset28: the embedded metric's threshold at16+12. Thus the fully visible retention test in13098 is score > threshold -0.2, not "previous score minus0.2". Intermediate-alpha retention uses score >= threshold -2. The implementation distinguishes these bands and requires current spatial visibility; retained off-screen meshes cannot keep selecting themselves merely because alpha was one.

The projected motion point is the node bounding-sphere center. Finalize13097 passes node+828 as the IUnpoppable; vtable3955776 slot20 resolves to28705, which follows the owner node and calls virtual12→2475 returning node+64. Constructor13110 stores the bounds-sphere center there and the radius at88. This establishes use of `node.center` rather than an arbitrary mesh vertex. Layer eligibility and consecutive resident reentry are traced in [transition eligibility](transition-eligibility-analysis.md).
