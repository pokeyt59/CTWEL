# Costume Colour FX v3.1 ALPHA — Animation Blocks

The animation blocks in `Colour Lab v3.1 APLHA.js` add time-based costume
colour effects to TurboWarp. Drop a block into your script and the extension
drives every frame for you — no `forever` loop, no `wait` chain. Hue can spin
forever, brightness and saturation can pulse like a heartbeat, and finite
glides yield like a glide block so the rest of your script waits for them to
finish.

This page covers loading the extension, the shared `TARGET` slot, every
animation block with its parameters, common usage patterns, and a few things
worth knowing before you build with it.

---

## Loading the extension

1. Open TurboWarp.
2. Click **Add Extension** (bottom-left of the editor).
3. Choose **Choose an extension** → **Custom Extension**.
4. Use the **File** tab to load `Colour Lab v3.1 APLHA.js` from disk, or the
   **URL** tab if you've hosted it.
5. Tick **I trust this extension** when prompted.
6. A new category, **Costume Colour FX v3.1 ALPHA**, appears in the block
   palette. Scroll inside it to the section labelled **— Animations (rAF) —**.

The animation blocks coexist with the legacy single-layer hue / saturation /
brightness / tint blocks from v2.9. You can mix them in the same project; using
a one-shot legacy block on a sprite that's currently animating cancels that
animation (see *Things to know* below).

---

## The TARGET slot

Every animation block (and the cancel/reporter blocks) takes a `TARGET` input.
It's a free-text string slot — there's no dropdown menu — so you can drop a
variable, a constant, or an expression in there.

| Value             | Resolves to                                  |
|-------------------|----------------------------------------------|
| empty / `_myself_` | the sprite running the script (the default) |
| `_stage_`         | the Stage                                    |
| a sprite name     | that sprite                                  |
| anything else     | falls back to the sprite running the script  |

For most projects you can leave `TARGET` on its default.

---

## Block reference

### animate hue rotation on [TARGET] at [SPEED] °/sec

Continuously rotates the target's hue. Runs forever until something cancels it.

| Slot   | Default      | Notes                                           |
|--------|--------------|-------------------------------------------------|
| TARGET | `_myself_`   |                                                 |
| SPEED  | `90` (°/sec) | Negative values rotate the other way. Wraps at 360°. |

Fire-and-forget — your script continues to the next block immediately.

### pulse brightness on [TARGET] from [LO] to [HI] period [SECS] secs

Smoothly oscillates the brightness factor between two values, sinusoidally,
with a period of `SECS`.

| Slot   | Default    | Notes                                                                     |
|--------|------------|---------------------------------------------------------------------------|
| TARGET | `_myself_` |                                                                           |
| LO     | `0.5`      | Brightness factor at the dim end. `1` = original, `0` = pure black, `>1` = brighter than original. |
| HI     | `1.5`      | Brightness factor at the bright end.                                      |
| SECS   | `1`        | Time for one full LO → HI → LO cycle.                                     |

Fire-and-forget.

### pulse saturation on [TARGET] from [LO]% to [HI]% period [SECS] secs

Smoothly oscillates the saturation between two values, sinusoidally, with a
period of `SECS`.

| Slot   | Default    | Notes                                              |
|--------|------------|----------------------------------------------------|
| TARGET | `_myself_` |                                                    |
| LO     | `0`        | Percent at the dull end. Clamped to 0–100.         |
| HI     | `100`      | Percent at the vivid end. Clamped to 0–100.        |
| SECS   | `1`        | Time for one full LO → HI → LO cycle.              |

Fire-and-forget.

### glide hue on [TARGET] from [START]° to [END]° over [SECS] secs

Linearly interpolates the hue from `START` to `END` over `SECS` seconds, then
stops. **This block yields** — like a Scratch glide block, the next block in
your script does not run until the glide finishes.

| Slot   | Default    | Notes                                          |
|--------|------------|------------------------------------------------|
| TARGET | `_myself_` |                                                |
| START  | `0`        | Starting hue in degrees.                       |
| END    | `360`      | Ending hue in degrees. The default sweeps a full rainbow. |
| SECS   | `1`        | Glide duration.                                |

### glide saturation on [TARGET] from [START]% to [END]% over [SECS] secs

Linearly interpolates the saturation from `START` to `END` percent over `SECS`
seconds. Yields.

| Slot   | Default    | Notes                                                |
|--------|------------|------------------------------------------------------|
| TARGET | `_myself_` |                                                      |
| START  | `100`      | Starting saturation %.                               |
| END    | `0`        | Ending saturation %. The default fades to grey.      |
| SECS   | `1`        | Glide duration.                                      |

### glide brightness on [TARGET] from [START] to [END] over [SECS] secs

Linearly interpolates the brightness factor from `START` to `END` over `SECS`
seconds. Yields.

| Slot   | Default    | Notes                                                          |
|--------|------------|----------------------------------------------------------------|
| TARGET | `_myself_` |                                                                |
| START  | `1`        | Starting brightness factor (`1` = original).                   |
| END    | `0`        | Ending brightness factor. The default fades to black.          |
| SECS   | `1`        | Glide duration.                                                |

### stop animations on [TARGET]

Cancels any running animation on `TARGET`. If `TARGET` isn't currently
animating, this block does nothing. If a script is awaiting a glide on
`TARGET`, that script is unblocked immediately.

### stop all animations

Cancels every animation on every sprite. Any awaiting glide scripts are
unblocked immediately.

### \<[TARGET] is animating?\>

Boolean reporter that returns `true` while `TARGET` has an animation running,
`false` otherwise.

---

## Continuous vs. glide — the key distinction

| Behaviour            | `animate hue` / `pulse brightness` / `pulse saturation` | `glide hue` / `glide saturation` / `glide brightness` |
|----------------------|----------------------------------------------------------|--------------------------------------------------------|
| Runs for             | forever                                                  | a fixed duration                                       |
| Yields the script?   | no                                                       | yes (next block waits)                                 |
| Stops by itself?     | no — needs a stop block, a one-shot legacy block, green flag, or red stop | yes, when the duration elapses |
| Use it for           | breathing pulses, lava shimmer, idle glow                | flashes, fades, scripted transitions                   |

---

## How blocks interact

- **One animation per sprite.** Starting a new animation on a sprite that's
  already animating replaces the previous one. If the previous animation was a
  glide, the script awaiting that glide is released.
- **Legacy blocks cancel animations.** Setting a fixed hue / saturation /
  brightness / tint with the v2.9 single-layer blocks cancels any animation
  running on the same sprite. If you want both behaviours, run the legacy
  block first and the animation block second.
- **Reset / clear-all blocks cancel animations.** Clearing all colour effects
  or clearing all layers also stops any animation on the affected sprite.
- **Green flag and red stop clear everything.** Clicking the green flag or red
  stop button (or running a `stop all` block) cancels every animation on every
  sprite and unblocks any awaiting glide scripts.
- **Deleting a sprite or clone is clean.** When a sprite or clone is removed
  during an animation, the animation is dropped automatically and any awaiting
  script is released.

---

## Common patterns

### Background animation with the rest of your script free

```
when green flag clicked
animate hue rotation on _myself_ at 60 °/sec
forever
  ...your normal game logic...
end
```

The hue keeps rotating in the background while your `forever` loop runs game
code. No interaction needed.

### Sequential glides like an eyeblink

```
when this sprite clicked
glide brightness on _myself_ from 1 to 0 over 0.1 secs
glide brightness on _myself_ from 0 to 1 over 0.1 secs
```

Because glides yield, the second glide doesn't start until the first finishes.

### Switching between continuous and glide cleanly

```
when green flag clicked
animate hue rotation on _myself_ at 90 °/sec
wait 5 secs
glide hue on _myself_ from 0 to 0 over 0.5 secs
```

Starting the `glide hue` block automatically replaces the `animate hue
rotation` — no manual stop is needed.

### Cancel-on-condition

```
when green flag clicked
pulse brightness on _myself_ from 0.5 to 1.5 period 0.8 secs
wait until <touching [Player v]?>
stop animations on _myself_
```

### Read-back with the reporter

```
when green flag clicked
forever
  if <not <_myself_ is animating?>> then
    animate hue rotation on _myself_ at 90 °/sec
  end
end
```

Re-arms a continuous animation if anything else stops it.

---

## Things to know

- **Linear glides only.** v3.1 ALPHA's glides are linear interpolations — no
  easing curves yet. To approximate ease-in-out, run two glides back-to-back
  with different `SECS`.
- **Animations don't combine with gradients.** Animations write to the same
  single-layer slot the legacy hue/saturation/brightness blocks use. They
  don't interact with the layer system or with active gradients on the same
  sprite — those will be overwritten while the animation runs.
- **Costume changes don't cancel.** Changing costume mid-animation is fine; the
  animation re-applies on the new costume on the next frame. There may be a
  one-frame flash of the unprocessed costume the very first time a new costume
  is seen, while it's being prepared.
- **Tab switching pauses, but time keeps moving.** Browsers pause
  `requestAnimationFrame` while the tab is hidden, so animations freeze
  visually. Glide durations, however, are measured in real wall-clock time —
  if a glide's duration elapses while the tab is hidden, the glide reports as
  finished as soon as the tab is visible again, and the awaiting script
  advances.
- **Each sprite has its own slot.** Animations on different sprites are
  independent. Animating ten sprites at once is fine.
- **Clones inherit nothing.** A new clone starts with no animation, even if
  the original was animating at the moment of cloning. Apply animation blocks
  inside `when I start as a clone` if you want the clone to animate.

---

## Quick block-finder

| Looking for…                             | Use…                                    |
|------------------------------------------|-----------------------------------------|
| spinning rainbow forever                 | *animate hue rotation*                  |
| breathing brightness                     | *pulse brightness*                      |
| desaturating then re-saturating in a loop | *pulse saturation*                      |
| a one-off rainbow sweep                  | *glide hue* (default values)            |
| fade to grey                             | *glide saturation* from 100% to 0%      |
| fade to black or fade in                 | *glide brightness*                      |
| stopping just one sprite                 | *stop animations on [TARGET]*           |
| stopping everything                      | *stop all animations*                   |
| checking whether a sprite is animating   | *\<[TARGET] is animating?\>*            |
