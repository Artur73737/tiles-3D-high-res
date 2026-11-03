# Resident mesh eligibility for paired fades

This note supplements `transition-analysis.md` and uses the same captured reference client `20261015_1200_RC02`. Its WebAssembly SHA-256 is `43a58f7cd6f96202771a05db16ce3b72e0a1cd8d319a1d55bbc8c6ef9b66d63f`. Function numbers and hexadecimal addresses refer to that compiled artifact.

The original transition eligibility virtual function 16 maps to function 32997. It requires a ready node (byte 679 equals 1), a resident mesh pointer at offset 948, and a clear bit 16 in the resident mesh's uint16 flags at offset 792. That resident-mesh bit is not the metadata node flags.

The producing boundary establishes what the bit means:

- Loader function 33030 at `0xbb8abb–0xbb8b9a` calls function 1671 for layer indices 0 through 8 and ORs `1 << layer` into the resident mesh flags when it returns true. The layer-4 call is at `0xbb8b1f–0xbb8b23`; its bit is stored at `0xbb8b33`.
- Function 1671 at `0x0ad94c` checks that the requested layer is below the mesh layer count and compares consecutive index bounds: `bounds[layer] < bounds[layer + 1]`.
- Function 33030 at `0xbb4992–0xbb499f` derives the layer count as `(octantCountLength + 7) >> 3`. This matches the decoder representation with eight octant index counts per layer.
- Loader function 6329 initializes the flags to zero at `0x2b747e`, then performs the same per-layer presence union at `0x2b74bc–0x2b759b`.

Therefore, bit 16 is the union of nonempty layer 4 across the resident asset's decoded surfaces. The direct integration predicate is to reject pairing if any surface has `layerBounds[4] < layerBounds[5]`. This preserves the source meaning without inventing a semantic name for that layer. Bounds belong to the decoded geometry boundary; consumers should use a derived geometry eligibility field rather than reinterpret metadata flags.

Function 32997 also has a spatial-history exclusion: it rejects when all of `state.byte34 == 1`, `(state.byte33 & 1) != 0`, `state.i32[20] == 1` and `state.i32[16] != 1` hold. The producing boundaries resolve those fields:

- Walker 8627 at `0x3e5a83` and `0x3e5d64` assigns byte 33 from `6344(node) != 0`. Function 6344 returns the resident mesh at node offset 948 only when node byte 679 equals 1. Byte 33 is therefore current resident presence.
- Function 30207 at `0xade3b8–0xade3d8` copies byte 33 into byte 34 and classification 16 into classification 20 only when its argument equals 1. Otherwise it stores previous presence zero and previous classification -1.
- Walker 8627 at `0x3e5b07–0x3e5b47` passes current traversal frame minus previous traversal frame to the node-state virtual function 8. Constructor 13110 at `0x6d5ce8–0x6d5cf8` installs that state at node offset 776 with vtable 3955720, whose slot 8 maps to function 30207. The snapshot is therefore valid only for consecutive traversals.
- Function 30206 writes current classification 16. Classification function 6024 returns 1 for invalid/outside bounds and rejection by a clip volume; it returns 0 or 2 for the admitted classifications.

The exclusion means: a resident mesh that was present in both consecutive frames, was outside in the previous classification and is now visible cannot begin a parent/child fade. Its selection is immediate. This is different from an arriving mesh that did not exist in the previous frame. History must include residency and traversal continuity, rather than treating every offscreen-to-onscreen transition as equivalent.

The retained ignored evidence is in `.bench/reference-20261102/assets/mesh-flags-*.txt`, `state-vfunc-*.txt`, `state-constructor-13110.txt`, `state-spatial-*.txt` and the captured WebAssembly function, table and passive-memory indexes. These are source-derived findings. The production transition-selection tests separately verify fallback coverage, refinement, coarsening, nested pairs and release of stale offscreen meshes.
