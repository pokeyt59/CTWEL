# CLAUDE.md — Colour Engine v2.9 Decision Log

This document explains the *why* behind every significant architectural and optimisation
decision in `Colour_enginev2_9.js`. It is written for a future AI session (or human
developer) picking up this codebase. Read it before touching anything non-trivial.

---

## 1. What this extension does

Runtime costume colour effects for TurboWarp/Scratch, applied without permanently
modifying the source costume. Effects are processed on a canvas, uploaded as a new GPU
skin, and the sprite's drawable is pointed at that skin. When effects are cleared, the
drawable is re-pointed at the original costume skin.

The extension has four parts:
- **Section 1/1b** — Per-pixel transforms (hue, saturation, brightness, tint, etc.) and
  the same transforms applied per named layer with independent blend modes.
- **Sections 2–3** — Gradient compositing (full-control builder and quick-access blocks).
- **Section 4** — Utility (render quality, cache management, reset).
- **Section 5** — Color Lab: pure math reporters (blend, shift hue, distance, etc.) that
  don't touch costumes at all.

---

## 2. Core architecture decisions

### 2a. Never modify the source costume

Every effect works by rasterising the costume into a canvas, processing that canvas, and
pushing the result as a **new** `BitmapSkin`. The original costume asset and its `skinId`
are never touched. Cleanup just calls `renderer.updateDrawableSkinId` back to the costume's
own `skinId` and calls `renderer.destroySkin` on the effect skin.

**Why:** Scratch costumes are shared assets. Modifying them would corrupt every clone and
any other sprite using the same costume, and the change would persist across green-flag
restarts. The new-skin approach is fully reversible and clone-safe.

### 2b. One live skin per sprite at all times

No matter how many layers are active, only one GPU skin is alive per sprite at any moment.
Layer canvases are built in memory during `compositeAndPush`, drawn onto a single output
canvas, and then that canvas is uploaded as the one skin. The previous skin is destroyed
in the same call.

**Why:** GPU skins are expensive VRAM textures. Keeping one per layer would multiply VRAM
usage by the layer count and thrash the GPU upload pipeline. The intermediate layer canvases
are plain CPU `ImageData`/`HTMLCanvasElement` objects — cheap, GC-able, never uploaded.

### 2c. Raster cache (WeakMap + per-scale Map)

`rasteriseCostume(costume, scale)` is expensive: it creates a Blob, a BlobURL, an Image,
draws it to a canvas, and reads back the ImageData. This is done at most once per
`(costume, scale)` pair. The result is cached in a `WeakMap<costume, Map<scale, Promise>>`.

**WeakMap outer key:** costume objects are GC'd when a sprite deletes a costume. WeakMap
entries are automatically released — no manual cleanup needed.

**Map inner key (scale):** the same costume can be rasterised at multiple scales (e.g. the
user switches quality mid-session). Each scale is a separate cache entry.

**Promise stored, not result:** the cache stores the in-flight Promise, not the resolved
value. This means concurrent calls for the same (costume, scale) collapse onto one load
operation rather than spawning multiple Image loads.

**When the cache is invalidated:**
- `clearSpriteCache(target)` — clears all scale entries for all costumes of that sprite.
- `clearAllSpriteCaches()` — clears all entries globally.
- `setRenderQuality(scale, clearCache=true)` — clears all entries when the scale changes
  (see §5 for why this was a bug).

### 2d. `processImageData` operates on a fresh `ImageData`

Every pixel transform reads from `src` (the cached imageData) and writes to a **new**
`ImageData`. The source is never mutated.

**Why:** the cached raster must remain clean so different effects and different layers can
all read from the same source. Mutating it would corrupt every subsequent call for that
costume.

---

## 3. Pixel loop optimisation decisions

The pixel loops are the hottest code paths. A 512×512 costume = 262,144 pixels. Every
saved instruction per pixel is multiplied by that count.

### 3a. `ImageData` is zero-initialised — never write 0

`new ImageData(w, h)` fills all bytes with 0. Writing `dst[i+3] = 0` for a transparent
pixel is a wasted store. All loops use `if (a === 0) continue` — not
`if (a === 0) { dst[i+3] = 0; continue; }`.

### 3b. Inline `clamp255` and eliminate it where provably safe

The `clamp255` function (call overhead + `Math.max`/`Math.min`/`Math.round`) is replaced
with inline expressions wherever possible:

- **No clamp at all:** `invert` (255−uint8 is always [0,255]), `grayscale` (integer weight
  sum stays [0,255]), `tint` (convex blend: `inv+s=1`, so result ≤ 255), `alpha` (a∈[1,255]
  × pct∈[0,1] ≤ 255), HSL output (`_hue2rgb` returns [p,q] ⊂ [0,1]).
- **Upper-only clamp:** `brightness` and `channels` (src≥0, multiplier>0, so result≥0;
  only overflow check needed).
- **Full inline clamp:** `swap` delta blend (delta can go in either direction).

The fast clamp form is `v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0`. The `(v+0.5)|0`
trick rounds and truncates in one bitwise op — equivalent to `Math.round` for non-negative
values but without the function call.

### 3c. Hue and saturation loops are fully inlined

These are the most complex loops — each pixel calls `rgbToHsl` and `hslToRgb`, each of
which returns a new `[r,g,b]` or `[h,s,l]` array. For a 256×256 sprite that's ~131,000
array allocations per effect call, putting serious pressure on the GC.

**Decision:** inline both functions completely inside the loop body. No arrays allocated
per pixel. Additionally:

- **`(q-p)` hoisted as `qp`:** used 6 times inside the inlined hue→RGB conversion
  branches; computing it once saves 6 subtractions per pixel.
- **Hue shift in 0–1 space:** the original code did `hh * 360 + deg) % 360 / 360` —
  three multiplies, two modulos, one divide per pixel. Now `degN = deg/360` is computed
  once before the loop and the per-pixel shift is `hh += degN; if (hh >= 1) hh -= 1` —
  one add, one conditional subtract.
- **Division constants replaced with literals:** `1/6 → 0.16666...`, `1/3 → 0.33333...`,
  `2/3 → 0.66666...` — computed at parse time rather than runtime.

### 3d. `hue` and `saturation` are separate switch cases

The original code merged them into one case with a per-pixel `if (kind === "hue")` branch.
Since `kind` is constant for the lifetime of a single `processImageData` call, this branch
is predictable but still costs a comparison per pixel. They are now separate cases.

### 3e. Brightness `factor ≤ 0` fast path

When factor is zero or negative, all RGB channels become 0. Rather than entering the
per-pixel loop, the code copies only the alpha channel (`for (let i = 3; i < len; i += 4)`)
since RGB stays 0 from zero-init. One store per pixel instead of four.

### 3f. Swap: exact-match vs fuzzy-match split

`tol === 0` means exact integer match — no sqrt, no per-pixel branch on `tol`. The two
paths are split into separate loops to keep each tight. The fuzzy path pre-computes
`invTol = 1 / tol` outside the loop to turn the per-pixel division into a multiply.

---

## 4. Math helper decisions

### 4a. `_hue2rgb` hoisted to module level

Was an inner function recreated on every `hslToRgb` call (new closure object each time).
Hoisted to module level — one function object for the session. The callers always pass
`t ∈ [-1/3, 4/3]`, so the two sequential `if (t<0)` / `if (t>1)` guards are fused into
`if (t<0) t+=1; else if (t>1) t-=1;` — at most one branch taken, never both.

### 4b. `hslToRgb` inlines `_hue2rgb` with `qp` hoisted

For the standalone `hslToRgb` used by Lab reporters, `_hue2rgb` is inlined using the same
`qp = q - p` hoist. This reduces 6 `(q-p)` subtractions to 1.

### 4c. `Math.round` → `(x + 0.5) | 0`

Bitwise truncation after adding 0.5 is equivalent to round-half-up for all non-negative
finite floats. HSL values (always ≥ 0), pixel channel results after multiplication, and
LUT indices are all non-negative — safe to use this everywhere `Math.round` appeared.

### 4d. `Math.max`/`Math.min` → ternary in `rgbToHsl`

For the scalar `max`/`min` of three channel values, ternary comparisons are faster than
two function calls.

### 4e. `rgbToHex` split into `rgbToHex` (clamping) and `rgbToHexRaw` (no clamp)

Lab reporters that receive output from `hslToRgb` or `hexToRgb` know their values are
already valid integers in [0,255]. They use `rgbToHexRaw` which skips the three
`clamp255` calls. `rgbToHex` remains for cases where input range is unknown.

---

## 5. The `setRenderQuality` bug and fix

**The bug:** `setRenderQuality` set `globalScaleOverride` correctly, but the raster cache
is keyed by `(costume, scale)`. Once a costume is cached at scale 4, every future call to
`rasteriseCostume` finds that entry and returns immediately — the new scale is never
reached. The block appeared to do nothing.

**The fix:** when `globalScaleOverride` changes, `clearAllRasterCaches()` is called. This
evicts every stored raster so the next effect block re-rasterises at the new scale.

**The toggle:** a `CLEAR_CACHE: BOOLEAN` argument (default `true`) was added to the block.
Set to `false` during setup scripts where you want to change quality without losing
pre-warmed rasters from a previous scale. You can then call `clearSpriteCache` or
`clearAllSpriteCaches` manually at the right moment.

**Why `args.CLEAR_CACHE !== false` not `Boolean(args.CLEAR_CACHE)`:** TurboWarp passes an
empty string `""` for an unconnected boolean slot, which is falsy. The `!== false` check
correctly treats an empty slot as "true" (use the safe default behaviour).

---

## 6. Allocation decisions

### 6a. Hex lookup table `_hexLUT`

Pre-built `Array(256)` mapping integer → 2-char hex string. Replaces
`v.toString(16).padStart(2, "0")` which allocates a new string on every call.
`rgbToHex` now does three array lookups per call.

### 6b. `normalizeGradientStop` caches the CSS string

`hexAlpha()` (which produces `"rgba(r,g,b,a)"`) is called only once per stop —
the result is stored in `stop.css`. Subsequent gradient renders use `stop.css` directly,
skipping hex parse and string construction.

### 6c. `_RAINBOW_STOPS` is a module-level constant

The 7 normalized gradient stops for the rainbow gradient were being constructed on every
`gradRainbow` block call. They're static, so they're built once at load time.

### 6d. `gradApply` uses manual shallow clone instead of `JSON.parse(JSON.stringify(...))`

The gradient definition is a plain object with primitive values and an array of plain
objects. Manual spread per stop (`{ color, alpha, pos, css }`) is ~3× faster than the
JSON round-trip which serialises to a string and re-parses it.

### 6e. Map double-lookup eliminated in `getPending` and `getRasterCacheEntry`

`Map.has(k)` followed by `Map.get(k)` is two hash lookups. Replaced with
`let v = map.get(k); if (!v) { v = default; map.set(k, v); }` — one lookup on the
common case (key exists).

---

## 7. Layer system design

### 7a. Data model

```
layerMap : Map<targetId, Map<layerName, LayerEntry>>

LayerEntry = {
  imageData : ImageData | null,   // processed pixels (null = no pixel effect)
  gradDef   : object | null,      // gradient composited over imageData
  blendMode : string,             // CSS composite-op for this layer
  opacity   : number,             // 0–1
  order     : number,             // draw order (ascending = bottom first)
}
```

### 7b. Why CPU ImageData per layer, not GPU skins

The alternative was to store a GPU skin per layer and composite them with `drawImage`.
Rejected because:
- GPU skins are VRAM textures — one per layer per sprite multiplies VRAM quickly.
- `renderer.createBitmapSkin` and `destroySkin` involve driver calls; doing them per layer
  per recomposite would thrash the GPU pipeline.
- Storing `ImageData` (CPU memory) is cheap. A 256×256 RGBA buffer is 262,144 bytes ≈
  256 KB. Five layers on one sprite = ~1.3 MB CPU RAM, zero extra GPU textures.

### 7c. Single output skin per recomposite

`compositeAndPush` creates one output canvas, draws the base, iterates layers in order
(each as a temporary CPU canvas that's GC'd after the drawImage call), then creates
exactly one new GPU skin. The old skin is destroyed in the same function.

### 7d. Alpha mask clip via `destination-in`

After all layers are composited onto the output canvas, the original rasterised base is
drawn with `globalCompositeOperation = "destination-in"`. This clips the output to the
sprite's original alpha silhouette — no colour effect can "bleed outside" the costume
shape.

### 7e. `applyToLayer` always re-reads from the raster cache

Each layer's `imageData` is produced by calling `processImageData(baseImageData, spec)`
where `baseImageData` is the cached raster of the original costume. Layers are independent
transformations of the same source — they don't pipeline through each other. This means:
- Layer order affects compositing, not pixel computation.
- Changing one layer doesn't require re-processing any other layer.
- The raster cache handles deduplication of the expensive decode/draw step.

### 7f. `layerSetBlend` fires `compositeAndPush` asynchronously

`layerSetBlend` is a synchronous block (no `await` on the block boundary), but it needs
to recomposite. It calls `compositeAndPush(...).catch(() => {})` — fire-and-forget. The
`.catch` prevents unhandled rejection if the recomposite fails (e.g. sprite deleted). This
is intentional: blend-mode changes are "soft" — if the recomposite races with another
block, the last write wins, which is the correct behaviour for a visual parameter.

### 7g. Layer order uses insertion index as default

When a layer is created, `order` is set to `m.size` (the current count before insertion).
This gives stable FIFO ordering by default — layers appear in the order they were first
used. The `layerSetOrder` block lets the user override this with any integer.

---

## 8. Gradient system design

### 8a. `applyGradientToCanvas` uses two canvases

The gradient is drawn on a scratch canvas (`gradCanvas`). Then the output canvas starts
with the source drawn onto it, the gradient is composited using the def's `blendMode` and
`opacity`, and finally `destination-in` masks back to the source's alpha. Three `drawImage`
calls total. The final `globalCompositeOperation = "source-over"` reset was removed — the
canvas is consumed by `createBitmapSkin` immediately and never reused.

### 8b. Stop CSS strings are pre-computed at normalisation time

`normalizeGradientStop` calls `hexAlpha()` once and stores the result in `stop.css`.
The `addColorStop` loop uses `stop.css` directly — no hex parsing or string construction
per gradient render.

---

## 9. Caching strategy summary

| Cache | Key | Invalidated by |
|-------|-----|---------------|
| Raster cache (`WeakMap`) | `(costume object, scale)` | `clearSpriteCache`, `clearAllSpriteCaches`, `setRenderQuality(scale, true)` |
| Gradient stop CSS | `stop.css` on the stop object | Never — stops are immutable once normalised |
| Rainbow stops | `_RAINBOW_STOPS` module const | Never — static |
| Overlay state | `targetId → {skinId, gradDef}` | `restoreOriginalSkin`, `resetColors` |
| Layer map | `targetId → Map<name, entry>` | `layerRemove`, `layerRemoveAll`, `resetColors` |

---

## 10. Things that are intentionally NOT done

**No per-layer skin IDs.** Layers live only as CPU ImageData. See §7b.

**No streaming / per-frame update loop.** Effects are one-shot: run a block, get a result.
There's no `requestAnimationFrame` ticker. If you want animated effects, call the effect
block in a Scratch loop. This keeps the extension stateless with respect to the Scratch
runtime tick loop.

**No SVG manipulation.** SVG costumes are rasterised to canvas first (at 4× or higher
scale for sharpness), then pixel effects are applied to the raster. SVG paths are not
edited. This is simpler, universally correct, and keeps the pixel pipeline uniform.

**No costume asset mutation.** See §2a.

**No intermediate GPU skins per layer.** See §7b.

**`gradApply` does not re-normalise already-normalised stops.** Stops are normalised when
added via `gradAddStop`. The `gradApply` call previously called `normalizeGradientStop`
again on each stop — wasted work. Removed.

---

## 11. Naming conventions

| Pattern | Meaning |
|---------|---------|
| `_hexLUT`, `_RAINBOW_STOPS`, `_hue2rgb` | Module-level private constants/helpers |
| `_getLayerMap`, `_getOrCreateLayer` | Private layer system helpers |
| `storeOverlay` / `restoreOriginalSkin` | Legacy single-layer skin management |
| `compositeAndPush` | Multi-layer: builds final canvas and uploads skin |
| `applyToLayer` | Sets a layer's pixel content and triggers recomposite |
| `processImageData` | Pure pixel transform — no side effects, no skin management |
| `applyToTarget` | Single-layer legacy: rasterise → transform → push skin |
| `applyTransformToTarget` | Wrapper for `applyToTarget` that merges stored gradDef |

---

## 12. Safe extension points

If you need to add a new pixel effect:

1. Add a `case "yourEffect":` block in `processImageData`'s switch.
2. Add the block definition in `getInfo()`.
3. Add the method in the class (call `applyTransformToTarget` for single-layer,
   `applyToLayer` for layer-aware).
4. Optionally add a `layerYourEffect` block following the existing layer block pattern.

The spec object passed to `processImageData` is duck-typed — add any fields you need.
Keep the loop body tight: check `src[i+3] === 0` first and `continue`, exploit zero-init
where possible, avoid function calls inside the loop for the hot path.

If you need to add a new gradient type, add a branch in `applyGradientToCanvas`.
`stop.css` is always pre-computed — don't call `hexAlpha` inside the rendering loop.
