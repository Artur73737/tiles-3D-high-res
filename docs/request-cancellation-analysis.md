# Reference request cancellation

This supplements [the renderer analysis](reference-client-analysis.md). It examines the distributed `20261015_1200_RC02` client at `https://earth.google.com/static/multi-threaded/versions/20261015_1200_RC02/index.html`, using the retained JavaScript and WASM artifacts. It does not claim access to the original C++ source tree or full binary equivalence. Function numbers and hexadecimal instruction addresses below refer to this exact WASM build.

## Provenance

| Artifact | SHA-256 |
| --- | --- |
| `earthplugin_web.wasm` | `43a58f7cd6f96202771a05db16ce3b72e0a1cd8d319a1d55bbc8c6ef9b66d63f` |
| `earthplugin_web.js` | `8485d9f7b0beab207aea6c41e9877e460362f2d8c238a6dfa9eb0f5cad85ff4e` |

The local, ignored evidence directory is `.bench/reference-20261102/assets/`. `function-index.json` identifies function body ranges, `table-index.json` resolves indirect-call slots, and `passive-memory-map.json` maps passive data segments to linear-memory addresses. Mapping uses each segment independently; a single file-to-memory offset does not work throughout this module. `cancellation-evidence.json` records hashes of the selected disassembly and loader artifacts. These are ordinary local artifact observations, not REA Evidence IDs.

## Frame age and ownership

Function **32918**, body bytes 12221135–12222146, contains the stale-fetch cancellation sweep:

1. At `0xba7b05` and `0xba7b13`, its lazy initializer references the strings at linear-memory addresses 65426 and 312096. The strings identify `/mirth/mode/framework/MirthMode/cancel_old_fetches` and describe the number of **frames** after which an untouched asset's loader is canceled.
2. At `0xba7b1c–0xba7b23`, the initialized flag byte at 10572648 is set to 1. At `0xba7b61–0xba7b78`, the sweep reads the current counter from argument 2's atomic field 56 and selects a grace of **2 when the flag is nonzero, otherwise 0**. It only continues if the counter is greater than that grace.
3. At `0xba7c5e–0xba7c89`, an entry is eligible only when its asset's virtual method at byte offset 56 returns true, `asset[80] < currentFrame - grace`, and `asset.atomic[36] <= 0`. Entries already marked at entry byte 40 are skipped.
4. At `0xba7c92–0xba7ca0`, the manager increments its cancellation count and marks the entry. It finds the corresponding loader work and calls function **13064** at `0xba7da3`.
5. At `0xba7e13–0xba7e27`, the collected request handles are passed to the network interface's virtual method at byte offset 16.

The strict comparison matters: an asset last touched in frame `f` survives frames `f+1` and `f+2`, and becomes eligible at `f+3` when the default flag is active. There is no millisecond timeout in this stale-demand predicate. The initializer establishes the compiled default; a live read is needed to establish the setting in a specific running instance.

Function **33174**, `0xbf69db–0xbf69f9`, copies `manager[144].atomic[56]` into `asset[80]` if it differs. Its vtable is associated with the retained `mirth::cache::AssetManager` RTTI name. This establishes that field 80 records the asset's most recent touch in the same frame domain used by the sweep. Functions **3639** and **2029** respectively increment and decrement atomic field 36 and notify the manager at the zero-to-one and one-to-zero transitions. Interpreting this field as active use or a pin count follows those paired operations; it is separate from the C++ shared-pointer lifetime counter.

Function **13064**, beginning at `0x6cd843`, marks loader work at byte 108, locks its handle list, moves the active request handles into the caller's cancellation collection, clears the loader's list/count, and unlocks. Thus stale demand is marked separately from network cancellation and reference cleanup. Function **8615** contains an unconditional sweep over active entries with the same handle collection and network-interface call; its wider caller context has not been characterized here.

## Queue refresh and transport abort

The PlanetFetcher vtable maps slots to functions **33057** (sort/drain), **33060** (clear touch queues), **13140** (payload touch), and **13139** (metadata touch). Function 33060 releases the temporary per-category queue records; that action alone is not evidence of aborting an in-flight HTTP request. Function 33057 sorts the current request records before draining them. The concrete stale in-flight predicate is in function 32918 above.

The distributed JavaScript provides a second, directly readable transport boundary:

- `_emscripten_fetch_free`, lines 6668–6677, frees the registered request handle **before** calling `xhr.abort()` when its ready state indicates an active request.
- Callback wrappers at lines 9854, 9866, 9874, 9881, and 9919 check that the handle is still registered before dispatching callbacks.
- `FetchXHR.send` constructs an `AbortController`, supplies its signal to `fetch`, and reads the response body incrementally. Its exception/finalization path at lines 10245–10261 suppresses the normal completion callback after abort.
- `FetchXHR.abort`, lines 10266–10272, sets `_aborted`, resets status, changes the ready state, and calls the underlying controller's `abort()`.

These observations establish actual request abort and stale-callback suppression in the shipped transport. The entire indirect-call chain from function 32918's network-interface method to `_emscripten_fetch_free` has not been resolved, so that connection is an architectural inference rather than a proven direct call graph.

## Bundle implementation

The bundle translates the observed ownership boundary into browser APIs:

- `SharedDemand` owns one operation and independent consumer subscriptions. Releasing an old view cancels its subscription; the underlying operation is aborted only after its final consumer releases demand.
- `ByteTransport.get` accepts an `AbortSignal`. Obsolete queued jobs are removed before dispatch. Running requests propagate cancellation into `fetch` and the body stream, and cancellation does not retry.
- `ByteTransport.reprioritize` updates queued priority without adding another consumer or network request. The view scheduler owns the current priority and touch frame.
- Cancellation removes only the matching pending entry. Immediate reacquisition creates a new operation, and a late result from the old operation cannot delete its replacement or publish stale decoded metadata.
- Completed valid response bytes retain cache ownership through an already-started cache commit. Disposal waits for that commit; partial or canceled downloads do not enter the byte cache.
- `RocktreeSource` shares metadata decode demand independently from transport demand and checks cancellation again after asynchronous decode. It preserves another view's active demand.

These are reconstructed semantics using the bundle's existing fetch/cache/decoder architecture. They do not imply identical C++ containers, thread scheduling, request limits, or undocumented backend behavior.

## Verification

`test/transport-cancellation.test.mjs` exercises shared-consumer cancellation, removal of obsolete queued work, cancellation during streaming, immediate reacquisition with late old completion, priority refresh without extra subscribers, cancellation during cache finalization, metadata sharing using a captured binary fixture, and canceled decode isolation. Together with `test/network.test.mjs`, the focused run passes all 12 tests. Those tests establish the local implementation's ownership and cancellation behavior; they are not reference-client runtime performance measurements.

`test/streamer-cancellation.test.mjs` additionally passes two production-boundary scenarios using real camera/frustum updates, the byte transport, and captured-node decode/mesh construction. Turning away preserves requests for two frames, then aborts a streaming request and removes its queued neighbor; the newly viewed payload completes without obsolete retries or reported errors. Reversing direction before the canceled promises finish cleanup reacquires the same payload and completes the current view without stranded active tasks. HTTP completion is controlled by the test; these are not live service latency measurements.
