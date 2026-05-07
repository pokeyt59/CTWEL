# ANIMATION_RAF.md — rAF Animation Sector Reference

Reference documentation for the **animation sector** of
`Colour Lab v3.1 APLHA.js`. Focused on *what's there, where it lives, and
how the pieces fit together*. For the *why* behind these design choices, see
`CLAUDE_v3_1.md` (especially §2). For the underlying pixel pipeline and layer
system, see `CLAUDE.md`.

This file is a snapshot of the sector as of the current v3.1 ALPHA build.

---

## 1. Overview

The animation sector lets a Scratch user start a time-based effect (continuous
hue rotation, sinusoidal pulses, finite glides) and let the extension drive
each frame via `requestAnimationFrame`. The user does **not** put effect
blocks inside a `forever` loop.

It consists of:

- A **registry** mapping each target id to one active animation.
- A **single rAF loop** that walks the registry every frame.
- **Block methods** that register/cancel animations.
- A **sync render path** (`applyEffectSync`) the tick uses instead of the
  async `applyToTarget`.
- **Lifecycle hooks** that clear the registry on stop / start / target removal.

Block names exposed to Scratch (see `getInfo()` Section 3.5):

| Block                              | Type                  | Returns Promise? |
|------------------------------------|-----------------------|------------------|
| animate hue rotation               | command               | no               |
| pulse brightness                   | command               | no               |
| pulse saturation                   | command               | no               |
| glide hue                          | command               | yes (yields)     |
| glide saturation                   | command               | yes (yields)     |
| glide brightness                   | command               | yes (yields)     |
| stop animations on [TARGET]        | command               | no               |
| stop all animations                | command               | no               |
| `<[TARGET] is animating?>`         | boolean reporter      | -                |

---

## 2. File anchors

All line numbers refer to `Colour Lab v3.1 APLHA.js`.

| Symbol                          | Line  | Purpose                                          |
|---------------------------------|-------|--------------------------------------------------|
| `applyEffectSync` (comment)     | 720   | Section header explaining the sync render path   |
| `applyEffectSync` (function)    | 744   | Sync sibling of `applyToTarget` used by the tick |
| `storeOverlay` cancels anim     | 882   | One-shot blocks cancel the active animation      |
| `const animations = new Map()`  | 1143  | Registry definition                              |
| `let rafId = null`              | 1144  | rAF handle holder                                |
| `_ensureRafLoopRunning`         | 1146  | Arms rAF iff registry is non-empty               |
| `_cancelRafLoop`                | 1152  | Cancels the rAF                                  |
| `_replaceAnimation`             | 1159  | Insert/replace registry entry                    |
| `_stopAnimation`                | 1166  | Remove one entry, resolve its Promise            |
| `_stopAllAnimations`            | 1174  | Clear all entries, resolve all Promises          |
| `_computeAnimSpec`              | 1184  | `kind → { spec, done }` dispatch                 |
| `_animationTick`                | 1225  | Per-frame loop body                              |
| `_installRuntimeHooks`          | 1260  | Idempotent stop/start/remove subscriptions       |
| `animateHueLoop`                | 2077  | Block method (continuous hue rotation)           |
| `animateBrightnessPulse`        | 2086  | Block method (sinusoidal brightness)             |
| `animateSaturationPulse`        | 2099  | Block method (sinusoidal saturation)             |
| `glideHue`                      | 2112  | Block method (yielding finite hue glide)         |
| `glideSaturation`               | 2127  | Block method (yielding finite saturation glide)  |
| `glideBrightness`               | 2142  | Block method (yielding finite brightness glide)  |
| `stopAnimation`                 | 2157  | Block method                                     |
| `stopAllAnimations`             | 2162  | Block method                                     |
| `isAnimating`                   | 2166  | Boolean reporter                                 |

---

## 3. Module-level state

Two private values inside the IIFE:

```js
const animations = new Map(); // targetId → { kind, params, startTime, resolve? }
let rafId = null;
```

### 3.1 Registry entry shape

```js
{
  kind:      "hueLoop" | "brightnessPulse" | "saturationPulse"
           | "glideHue" | "glideSaturation" | "glideBrightness",
  params:    { /* shape depends on kind — see §6 */ },
  startTime: <DOMHighResTimeStamp from performance.now()>,
  resolve?:  <function — present only for glide entries>,
}
```

- **One entry per target.** Registering a new animation replaces the previous
  one (and resolves the previous Promise, if any).
- `resolve` is only set on glides. The other three kinds are continuous and
  their block methods return nothing.

### 3.2 `rafId`

`null` when no animation is registered (idle), the value returned by
`requestAnimationFrame` while the loop is armed.

---

## 4. Helper functions (private, IIFE-scoped)

### 4.1 `_ensureRafLoopRunning()` — line 1146

```js
function _ensureRafLoopRunning() {
  if (rafId === null && animations.size > 0) {
    rafId = requestAnimationFrame(_animationTick);
  }
}
```

Idempotent. Called by `_replaceAnimation`. Skips if a tick is already
queued or if the registry is empty.

### 4.2 `_cancelRafLoop()` — line 1152

```js
function _cancelRafLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}
```

Called by `_stopAnimation` (when registry empties) and by
`_stopAllAnimations`.

### 4.3 `_replaceAnimation(targetId, anim)` — line 1159

```js
function _replaceAnimation(targetId, anim) {
  const prev = animations.get(targetId);
  if (prev && prev.resolve) prev.resolve(); // unblock any awaiting glide
  animations.set(targetId, anim);
  _ensureRafLoopRunning();
}
```

Single insertion point for new entries. Always resolves the previous entry's
Promise so awaiting Scratch scripts unblock cleanly.

### 4.4 `_stopAnimation(targetId)` — line 1166

```js
function _stopAnimation(targetId) {
  const prev = animations.get(targetId);
  if (!prev) return;
  animations.delete(targetId);
  if (prev.resolve) prev.resolve();
  if (animations.size === 0) _cancelRafLoop();
}
```

Removes one target's entry. Cancels rAF only when the registry becomes empty.

### 4.5 `_stopAllAnimations()` — line 1174

```js
function _stopAllAnimations() {
  for (const anim of animations.values()) {
    if (anim.resolve) anim.resolve();
  }
  animations.clear();
  _cancelRafLoop();
}
```

Used by `PROJECT_STOP_ALL`, `PROJECT_START`, the `stop all animations` block.

---

## 5. Block methods

All block methods live on the extension class (`CostumeColorFX`). They share
the pattern:

```js
const target = this._resolveTarget(args, util);
_replaceAnimation(target.id, { kind, params, startTime: performance.now() /*, resolve */ });
```

### 5.1 Continuous (no Promise) — lines 2077, 2086, 2099

`animateHueLoop`, `animateBrightnessPulse`, `animateSaturationPulse` register
the entry and return `undefined`. The rAF tick keeps running them
indefinitely. They never set `done: true`.

### 5.2 Finite glides (Promise-returning) — lines 2112, 2127, 2142

`glideHue`, `glideSaturation`, `glideBrightness` return
`new Promise((resolve) => { ... })` and pass `resolve` into the registry entry:

```js
return new Promise((resolve) => {
  _replaceAnimation(target.id, {
    kind: "glideHue",
    params: { start, end, secs },
    startTime: performance.now(),
    resolve,
  });
});
```

The Promise resolves when:

1. The tick reaches `t >= 1` and removes the entry (normal completion).
2. Another animation replaces this one (cancelled by `_replaceAnimation`).
3. `_stopAnimation` removes this entry.
4. `_stopAllAnimations` clears the registry.
5. The target gets removed (sprite/clone deleted) and the tick drops the entry.

### 5.3 Cancellation blocks — lines 2157, 2162

```js
stopAnimation(args, util)    { _stopAnimation(this._resolveTarget(args, util).id); }
stopAllAnimations()          { _stopAllAnimations(); }
```

### 5.4 Reporter — line 2166

```js
isAnimating(args, util) { return animations.has(this._resolveTarget(args, util).id); }
```

Pure registry lookup. No rAF interaction.

---

## 6. `_computeAnimSpec` — line 1184

Pure function. Given an entry and the elapsed seconds since `startTime`,
returns `{ spec, done }` where `spec` is a `processImageData`-compatible
descriptor.

```js
function _computeAnimSpec(anim, elapsed) {
  const p = anim.params;
  switch (anim.kind) { ... }
}
```

| `kind`             | `params`                       | Formula                                                             | `done`     |
|--------------------|--------------------------------|---------------------------------------------------------------------|------------|
| `hueLoop`          | `{ speed }`                    | `deg = ((elapsed * speed) % 360 + 360) % 360`                       | `false`    |
| `brightnessPulse`  | `{ lo, hi, secs }`             | `factor = lo + (hi-lo) * (sin(2π·phase)+1)/2`, `phase = (elapsed%secs)/secs` | `false`    |
| `saturationPulse`  | `{ lo, hi, secs }`             | `pct = lo + (hi-lo) * (sin(2π·phase)+1)/2`                          | `false`    |
| `glideHue`         | `{ start, end, secs }`         | `deg = start + (end-start) * t`, `t = min(elapsed/secs, 1)`         | `t >= 1`   |
| `glideSaturation`  | `{ start, end, secs }`         | `pct = start + (end-start) * t`                                     | `t >= 1`   |
| `glideBrightness`  | `{ start, end, secs }`         | `factor = start + (end-start) * t`                                  | `t >= 1`   |
| (default)          | -                              | `spec: null`                                                        | `true`     |

The returned `spec` is a plain object like `{ kind: "hue", deg }` — exactly
the shape `processImageData` accepts.

The default case (unknown kind) returns `done: true` so the tick will drop
the entry and break any deadlock from a corrupt registry.

---

## 7. The tick — `_animationTick(now)` — line 1225

```js
function _animationTick(now) {
  const runtime = Scratch.vm.runtime;
  // Snapshot keys — we may delete during iteration when glides finish.
  const ids = [];
  for (const id of animations.keys()) ids.push(id);

  for (let i = 0; i < ids.length; i++) {
    const targetId = ids[i];
    const anim = animations.get(targetId);
    if (!anim) continue;

    const target = runtime.getTargetById ? runtime.getTargetById(targetId) : null;
    if (!target) {
      // Sprite/clone gone — drop the animation.
      animations.delete(targetId);
      if (anim.resolve) anim.resolve();
      continue;
    }

    const elapsed = (now - anim.startTime) / 1000;
    const { spec, done } = _computeAnimSpec(anim, elapsed);
    if (spec) applyEffectSync(runtime, target, spec, null);

    if (done) {
      animations.delete(targetId);
      if (anim.resolve) anim.resolve();
    }
  }

  rafId = animations.size > 0 ? requestAnimationFrame(_animationTick) : null;
}
```

### 7.1 Per-frame execution path

1. **Snapshot keys.** Copy `animations.keys()` into `ids[]` so deletion
   during the loop body doesn't disturb iteration order.
2. **Skip stale entries.** `animations.get(targetId)` may return `undefined`
   if a previous iteration's `applyEffectSync` somehow triggered cancellation.
3. **Drop dead targets.** If `runtime.getTargetById(targetId)` returns null,
   the sprite or clone was removed — delete and resolve.
4. **Compute spec.** Convert elapsed seconds to a `processImageData` spec
   using `_computeAnimSpec`.
5. **Render synchronously.** Call `applyEffectSync(runtime, target, spec, null)`.
   The `null` arg is `gradDef` — animations don't combine with gradients
   in v3.1.
6. **Resolve glides on completion.** When `done: true`, delete and resolve.
7. **Re-arm or stop.** Last line decides whether to schedule another frame.

### 7.2 Why a key snapshot?

Iterating a `Map` while deleting from it is technically safe in JS, but the
snapshot also future-proofs against `_replaceAnimation` calls triggered
indirectly from inside `applyEffectSync` (e.g. via a future hook that
mutates the registry).

---

## 8. The sync render path — `applyEffectSync` — line 744

The tick **cannot await**. Every microtask yield in the loop costs a frame.
`applyEffectSync` mirrors `applyToTarget` but reads the raster from the
cache's `resolved` map (a sync sibling of the Promise map).

Behaviour summary:

- Cache hit: runs the full render synchronously, returns `true`.
- Cache miss: kicks off `rasteriseCostume` async, returns `false`. The next
  rAF tick (16 ms later) will see the cache populated and render.
- Costume change detected: clears effect state via `clearTargetEffectState`,
  same as `applyToTarget`.
- Manages `overlayState` directly — does **not** call `storeOverlay`. (See
  §9.1.)

The duplication between `applyToTarget` and `applyEffectSync` is
intentional — see `CLAUDE_v3_1.md` §2d.

---

## 9. Cross-cutting interactions

### 9.1 One-shot blocks cancel animations — line 882

`storeOverlay` (the funnel for every legacy single-layer effect block) calls
`_stopAnimation(target.id)` before storing the new overlay state. Setting
`hue` to a fixed value should not be overwritten 16 ms later by the next
animation tick.

The animation-tick path **must not** call `storeOverlay`, or the first tick
would cancel the animation it's running. `applyEffectSync` writes to
`overlayState` directly to break this cycle.

Other call sites that cancel animations directly:

- `resetColors` (line 2308) — clearing all effects implies stopping
  animations too.
- `layerRemoveAll` (line 2574) — same reasoning for the layer system.

### 9.2 Lifecycle hooks — line 1260

```js
function _installRuntimeHooks(runtime) {
  if (runtime.__colourLabV31AlphaHooksInstalled) return;
  runtime.__colourLabV31AlphaHooksInstalled = true;
  const stop = () => _stopAllAnimations();
  runtime.on && runtime.on("PROJECT_STOP_ALL", stop);
  runtime.on && runtime.on("PROJECT_START",    stop);
  runtime.on && runtime.on("targetWasRemoved", (t) => {
    if (t && t.id) _stopAnimation(t.id);
  });
}
```

Installed once per runtime via the `__colourLabV31AlphaHooksInstalled` flag,
so re-registering the extension doesn't double-subscribe.

| Event              | Handler              | Effect                              |
|--------------------|----------------------|-------------------------------------|
| `PROJECT_STOP_ALL` | `_stopAllAnimations` | Red stop / `stop all` block         |
| `PROJECT_START`    | `_stopAllAnimations` | Green flag — fresh slate            |
| `targetWasRemoved` | `_stopAnimation`     | Sprite/clone delete                 |

`PROJECT_LOADED` is **not** hooked — animations are runtime state.

### 9.3 Costume changes do not cancel animations

`syncTargetVisualState` (called from inside `applyEffectSync`) detects costume
switches and clears effect state, but the registry entry is preserved. The
next tick re-applies on the new costume — kicking off an async rasterise
load if needed and catching up on a later frame.

---

## 10. The "always resolve" invariant

> **Every code path that removes an animation entry must call `resolve()` on
> it (if present).**

A glide block returns a Promise that TurboWarp `await`s. If we drop the
entry without resolving, the awaiting Scratch script **never advances**.

Enforced at:

- `_replaceAnimation` (line 1161) — replacing an existing entry.
- `_stopAnimation` (line 1170) — explicit cancel of one entry.
- `_stopAllAnimations` (line 1175) — bulk clear.
- `_animationTick` "target gone" branch (line 1240) — sprite/clone removed.
- `_animationTick` "done" branch (line 1250) — glide finished naturally.

Continuous animations (`hueLoop`, `brightnessPulse`, `saturationPulse`)
have no `resolve` field, so the conditional `if (anim.resolve)` is the
no-op for them.

---

## 11. Adding a new animation kind

1. Add a `case "yourKind":` branch in `_computeAnimSpec` returning
   `{ spec, done }`.
2. Add a block definition in `getInfo()` Section 3.5.
3. Add a class method that calls `_replaceAnimation(target.id, { kind:
   "yourKind", params: {...}, startTime: performance.now(), resolve? })`.
4. Decide whether the block yields:
   - **Finite + yielding:** include `resolve`, return `new Promise(...)`,
     ensure your formula sets `done: true` at end.
   - **Continuous + fire-and-forget:** omit `resolve`, return nothing,
     always set `done: false`.

---

## 12. Quick reference: end-to-end trace of `glide hue`

1. User script: `glide hue on myself from 0 to 360 over 1 secs`.
2. `glideHue` (line 2112) returns `new Promise(resolve => _replaceAnimation(...))`.
3. `_replaceAnimation` (line 1159) inserts the entry, calls
   `_ensureRafLoopRunning`.
4. `_ensureRafLoopRunning` arms `requestAnimationFrame(_animationTick)`.
5. ~16 ms later, `_animationTick` fires:
   - elapsed ≈ 0.016, `t ≈ 0.016`, `deg ≈ 5.76`, `done: false`.
   - `applyEffectSync` renders the new hue.
   - Re-arms rAF.
6. Steps 5 repeat ~60 times. On the tick after `elapsed >= 1.0`,
   `_computeAnimSpec` returns `done: true`.
7. Tick deletes the entry, calls `resolve()`.
8. `animations.size === 0` → `rafId = null`. rAF stops.
9. TurboWarp's awaiter sees the Promise resolve, advances the user script.
