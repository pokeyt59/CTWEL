# CLAUDE_v3_1.md — Colour Lab v3.1 ALPHA Decision Log

This document is the *v3.1 supplement* to `CLAUDE.md` (which describes Colour
Engine v2.9). v3.1 keeps everything from v3.0 BETA — same costume effects,
layer system, gradients, and Color Lab math — and adds an
**rAF-driven animation system**. Read `CLAUDE.md` first for the pixel-pipeline
and layer-compositing decisions; this doc only covers what's new.

---

## 1. What's new in v3.1

A second block category, **Animations (rAF)**, that lets a Scratch user kick
off time-based effects (continuous hue rotation, sinusoidal pulses, glides
between two values) without putting the effect block in a `forever` loop. The
extension itself drives a `requestAnimationFrame` tick that recomputes the
effect each frame.

Block summary (full names in `getInfo()`):

| Block                              | Type                  | Notes                          |
|------------------------------------|-----------------------|--------------------------------|
| animate hue rotation               | command (no yield)    | continuous, deg/sec            |
| pulse brightness                   | command (no yield)    | sinusoidal, lo↔hi over period  |
| pulse saturation                   | command (no yield)    | sinusoidal                     |
| glide hue                          | command (yields)      | start→end over secs            |
| glide saturation                   | command (yields)      | start→end over secs            |
| glide brightness                   | command (yields)      | start→end over secs            |
| stop animations on [TARGET]        | command               | cancels target's anim          |
| stop all animations                | command               | clears registry, kills rAF     |
| `<[TARGET] is animating?>`         | boolean reporter      | -                              |

Extension ID is **`ColourLabV31A`** so the v3.1 build co-exists with v3.0 BETA
(`ColourLabV3B`) — a project can load either or both without ID collision.

---

## 2. Architecture decisions

### 2a. Why rAF, not a Scratch `forever` loop on the user side

The original "animate by putting `setHue` in a `forever` block" pattern pays
this cost per frame:
- Scratch interpreter dispatches the block (parsed/compiled stack frame).
- The async `setHue` returns a Promise → microtask yield.
- `applyTransformToTarget` → `applyToTarget` → `await rasteriseCostume(...)`
  yields again (cache hit still goes through `await`).
- `processImageData` → `putImageData` → `createBitmapSkin` (GPU upload).

For a 30-fps `forever` script that's two yields and two block dispatches per
frame on top of the actual pixel work. With `requestAnimationFrame` driving
the loop directly, the per-frame cost reduces to:
- One sync `_animationTick` callback.
- `_computeAnimSpec` (small math, no allocations).
- `applyEffectSync` (sync — no awaits since the raster is already cached).
- `createBitmapSkin` (the actual GPU upload — unavoidable).

In TurboWarp's *interpreter* mode the win is large (block dispatch dominates).
In *compiled* mode the win is smaller but real — we still skip the per-frame
microtask yields and batch GPU uploads into one event-loop turn when multiple
sprites are animating.

### 2b. One animation per target

`animations: Map<targetId, AnimEntry>` — at most one animation per sprite.
Registering a new animation **replaces** the previous one, calling
`prev.resolve()` if the previous was a glide so any awaiting Scratch script
unblocks cleanly.

**Why one and not many:**
- Multiple simultaneous animations on the same target would need an effect
  composition strategy (overlay? blend?). That's a real design question and
  v3.1 punts on it.
- "Replace" semantics match Scratch idioms — calling `set hue` overwrites the
  previous hue. Calling `glide hue` overwrites the previous glide. Predictable.
- A user who really wants "rotate hue while pulsing brightness" can apply hue
  via a one-shot block first, then start the pulse — but this is a known
  limitation in v3.1.

If multi-anim is ever needed, the registry shape is the only thing that has
to change; tick/dispatch/cleanup all extend naturally to a list.

### 2c. Resolved-value raster cache (parallel to the Promise map)

The pre-existing raster cache stores `Map<scale, Promise<rasterResult>>` so
concurrent async callers coalesce on one image load. The rAF tick can't await,
so we added a parallel `Map<scale, rasterResult>` that's populated when the
Promise resolves and cleared on the same invalidation paths as the Promise
map.

```
entry = { map, resolved, version }
       ↑     ↑
       async sync rAF
```

`map` and `resolved` are kept in lock-step:
- Populated together inside `img.onload` (under the `cache.version === version`
  guard so a mid-load invalidation doesn't poison either).
- Cleared together in `clearCostumeRasterCache`, `clearAllRasterCaches`.

### 2d. `applyEffectSync` is a sibling, not a refactor of `applyToTarget`

I considered making `applyToTarget` return synchronously when the cache is
warm, but that complicates the contract — sometimes Promise, sometimes
non-Promise. Existing callers all `await`, so changing the return type
silently is asking for trouble.

Instead, `applyEffectSync`:
- Looks up the resolved raster via `_getCachedRasterSync`. If absent,
  fires-and-forgets a `rasteriseCostume(...)` async load and returns `false` —
  the next rAF tick will hit the warm cache.
- Calls `syncTargetVisualState` (which handles costume changes via
  `clearTargetEffectState`) before doing anything — same protective behaviour
  as the async path.
- Mirrors the canvas-pool acquire/release dance from `applyToTarget`.
- Manages `overlayState` directly so the rAF tick doesn't re-enter
  `storeOverlay` (which would ironically cancel the animation it's running —
  see §2g).

There's some duplication between `applyToTarget` and `applyEffectSync`. I left
it that way to keep both paths optimal for their use case rather than
abstracting over a difference (sync vs async) that has real performance
consequences.

### 2e. The rAF loop is on-demand

```js
let rafId = null;
function _ensureRafLoopRunning() {
  if (rafId === null && animations.size > 0) {
    rafId = requestAnimationFrame(_animationTick);
  }
}
```

The loop starts when the first animation is registered and stops the moment
the registry empties (last line of `_animationTick`):

```js
rafId = animations.size > 0 ? requestAnimationFrame(_animationTick) : null;
```

No idle-tick CPU cost. No cleanup needed if the user never starts an
animation.

### 2f. Glide blocks return Promises that the rAF tick resolves

A glide is registered with a `resolve` field captured from the executor:

```js
return new Promise((resolve) => {
  _replaceAnimation(target.id, {
    kind: "glideHue", params: {...}, startTime: ..., resolve,
  });
});
```

When `_computeAnimSpec` reports `done: true` (t ≥ 1), the tick calls
`anim.resolve()` and removes the entry. TurboWarp's runtime, which `await`s
any Promise returned from a command block, then continues the script.

If the glide is *cancelled* (by a one-shot block, `stopAnimation`,
`PROJECT_STOP_ALL`, or sprite removal), the resolve is also called — never
left dangling. A pending-forever Promise would freeze the user's script.

### 2g. Manual one-shot effects cancel the animation

Inside `storeOverlay`:

```js
if (animations.has(target.id)) _stopAnimation(target.id);
```

Reasoning: when the user explicitly says `set hue 90°`, they expect that
value to stick — not be overwritten 16ms later by the next animation tick.
The same applies to `tintColor`, `swapColor`, gradient applies, etc., all of
which funnel through `storeOverlay`.

`resetColors` and `layerRemoveAll` also cancel animations directly (they
don't go through `storeOverlay`).

**Note:** `applyEffectSync` writes to `overlayState` directly, **not** through
`storeOverlay`. This is intentional — if the rAF tick used `storeOverlay`,
the first tick would cancel the animation it's running.

### 2h. Costume changes don't cancel animations

`syncTargetVisualState` detects costume changes and calls
`clearTargetEffectState` to dump effect state. The animation registry is
**not** touched by this path — the next rAF tick re-applies on the new
costume seamlessly (kicking off an async raster load if the new costume
hasn't been cached yet, then catching up on a later frame).

This is a deliberate split: an animation is about a *parameter sweep over
time*, not about a specific costume. Switching costumes mid-animation should
keep the animation running.

### 2i. Lifecycle hooks are idempotent per runtime

```js
function _installRuntimeHooks(runtime) {
  if (runtime.__colourLabV31AlphaHooksInstalled) return;
  runtime.__colourLabV31AlphaHooksInstalled = true;
  // ... runtime.on('PROJECT_STOP_ALL', ...), etc.
}
```

TurboWarp can re-run the extension's IIFE in some cases (e.g. user removes
and re-adds the extension). Installing the same `runtime.on(...)` listeners
twice would mean every `PROJECT_STOP_ALL` clears the registry twice — fine in
isolation, but a footgun for any future state we hang off these handlers. The
installed-flag pattern is cheap insurance.

The hooks themselves:
- `PROJECT_STOP_ALL` → red stop button or `stop all` block: clear registry,
  cancel rAF.
- `PROJECT_START` → green flag pressed: same. Animations from a previous run
  shouldn't bleed into a new run.
- `targetWasRemoved` → sprite/clone deleted: drop just that target's entry.

We do **not** hook `PROJECT_LOADED` (project re-loaded). Animations are
runtime state, not part of the saved project; if the user wants the animation
to come back on reload they should start it in `when green flag clicked`.

---

## 3. Performance characteristics

For a typical "animate hue rotation at 90°/sec on one 256×256 sprite" scenario,
per-frame cost breakdown:

| Path                                        | Per-frame cost                              |
|---------------------------------------------|---------------------------------------------|
| Old (`forever` + `setHue`)                  | block dispatch + 2× microtask yield + work  |
| v3.1 rAF                                    | sync tick callback + work                   |

The "work" itself (`processImageData` + `putImageData` + `createBitmapSkin`)
is identical between the two paths — what we save is the dispatch and yield
overhead, plus we get to batch multiple sprites into one event-loop turn.

For 30 sprites animating simultaneously, the difference between "30 separate
async block dispatches per frame" and "one rAF callback that calls
`applyEffectSync` 30 times in a tight loop" is the difference between
stuttering and fluid in TurboWarp's interpreter mode.

---

## 4. Things v3.1 deliberately does NOT do

**Multiple animations per target.** See §2b. Single-slot replacement
semantics. Add a layer-aware variant in v3.2 if needed.

**Animations on layers.** The animation system targets the legacy single-layer
overlay path (`overlayState`, `applyEffectSync` writes there). The layer
system is for explicit, non-time-based composition; mixing animation with the
layer recompose pipeline added complexity without clear user benefit.

**Easing curves.** Glides use linear interpolation. Sinusoidal pulses use a
fixed sine. Adding ease-in-out / cubic / etc. is a one-line `_computeAnimSpec`
extension when there's a request.

**Animated gradients.** No "rotate gradient angle" animation block. Could be
added but the gradient build cost (createLinearGradient + addColorStop * N)
per frame is non-trivial. Would need profiling.

**Persistent across project reload.** §2i.

**Web Worker / GPU shader path.** Per-pixel processing still on the main
thread. The biggest remaining performance ceiling is here, but it's a
significantly larger architectural change (WebGL fragment shaders, framebuffer
management, integration with the renderer's GL context). Tracked as a v4.0
candidate, not v3.1.

---

## 5. Testing notes

The animation system is hard to unit-test from the command line because it
depends on `requestAnimationFrame`, `Scratch.vm.runtime`, and the renderer.
Exercise it manually in TurboWarp:

```
when green flag clicked
  animate hue rotation on myself at 180°/sec
  forever
    if <touching mouse-pointer?>
      stop animations on myself
      glide hue on myself from 0° to 360° over 0.5 secs
    end
  end
```

Things to verify by inspection:

1. Animation runs smoothly at display refresh rate (60Hz on most monitors).
2. No CPU usage when no animations are active (Chrome devtools → Performance
   tab → confirm no rAF callbacks fire after `stop all animations`).
3. Clicking the stop sign clears all animations across all sprites.
4. Deleting a sprite mid-animation doesn't throw or leak.
5. Switching costumes mid-animation continues seamlessly on the new costume
   (with one possible blank frame on first cache miss).
6. Calling `set hue 90` mid-animation cancels the animation (the value sticks).

---

## 6. File layout

The v3.1 ALPHA file structure mirrors v3.0 BETA with two new sections:

```
Helpers, processImageData, canvas pool, gradients
Costume rasteriser  ← `resolved` map added to entry
applyToTarget (async)
applyEffectSync (sync)  ← NEW
Global state, overlay state, layer system
_RAINBOW_STOPS
ANIMATION SYSTEM       ← NEW (registry, _replaceAnimation, _stopAnimation,
                              _computeAnimSpec, _animationTick,
                              _installRuntimeHooks)
EXTENSION CLASS
  constructor — calls _installRuntimeHooks(runtime)
  getInfo() — adds Section 3.5 block list
  Section 1 implementations
  Section 3.5 implementations  ← NEW
  Sections 2, 3, 4, 5 implementations
```

Search anchors for editors:
- `// ANIMATION SYSTEM (rAF-driven, v3.1)` — registry + tick + hooks.
- `// SECTION 3.5 IMPLEMENTATIONS — Animations` — class methods.
- `function applyEffectSync` — sync render path.
- `function _computeAnimSpec` — kind → spec dispatch table.

---

## 7. Adding a new animation kind

1. Add a `case "yourKind":` branch in `_computeAnimSpec` that returns
   `{ spec, done }` where `spec` is a `processImageData` spec object.
2. Add a block definition in `getInfo()`'s Section 3.5 list.
3. Add a class method that calls `_replaceAnimation(target.id, { kind:
   "yourKind", params: {...}, startTime: performance.now(), resolve? })`.
   Use `resolve` only for finite-duration glides.
4. Decide whether your block should yield (return the Promise with
   `resolve`) or fire-and-forget (no return value).

The animation entry is a duck-typed plain object — add fields to `params` as
needed.
