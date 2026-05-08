# Costume Colour FX v3.1 ALPHA — Costume Utility

The blocks under the **— Costume Utility —** label control the engine
itself: clearing effects, managing the rasterisation cache, choosing render
quality, and checking whether a sprite has any effect applied.

These blocks don't apply visual effects directly — they clean up after the
other sectors or tune how those sectors work.

---

## The TARGET slot

| Value             | Resolves to                                |
|-------------------|--------------------------------------------|
| empty / `_myself_`| the sprite running the script (default)    |
| `_stage_`         | the Stage                                  |
| a sprite name     | that sprite                                |
| anything else     | falls back to the sprite running the script|

---

## Block reference

### reset colors of [TARGET]

Removes every colour effect from `TARGET` — Costume Effects, Layer Effects,
gradients, and any active animation. The sprite's drawable is pointed back
at its untouched costume. This is the universal "undo all colour effects"
block.

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |

The original costume asset is never touched, so this block is always cheap
and always reversible by re-applying any effect.

### set render quality to [SCALE]x clear cache [CLEAR_CACHE]

Sets the global rasterisation scale for SVG (vector) costumes. Higher scales
look sharper at the cost of memory and a one-time per-costume rasterisation
delay.

| Slot        | Default     | Notes                                                                 |
|-------------|-------------|-----------------------------------------------------------------------|
| SCALE       | `4`         | Multiplier. `1` = native size, `4` = 4× the size, etc. Useful range is 1–8. |
| CLEAR_CACHE | `true`      | Boolean. `true` (default) wipes the existing raster cache so the new scale takes effect immediately. `false` keeps the cache (older costumes stay at the previous scale). |

The scale only affects vector costumes — bitmap costumes are always rendered
at their native pixel size.

If you change scale during a session and leave `CLEAR_CACHE` on, every
sprite's next colour-effect call re-rasterises its costume at the new
scale. There may be a one-frame flash of the unprocessed costume during
that re-rasterisation.

### clear cache of [TARGET]

Wipes the rasterised cache for `TARGET`'s costumes only. The next colour
effect on that sprite will re-rasterise. Use this to free memory after a
sprite is done being colour-effected, or to force a re-render after a
costume has been swapped in via another extension.

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |

This block does **not** remove visible effects — it only invalidates the
cache. Use *reset colors of [TARGET]* to clear the visual state.

### clear ALL sprite caches

Wipes the rasterised cache globally. Equivalent to running *clear cache of*
on every sprite. The next colour effect on each sprite will re-rasterise
that sprite's costume.

This block takes no arguments.

### \<[TARGET] has color override?\>

Boolean reporter — `true` if `TARGET` currently has any colour effect
applied (Costume Effects, Layer Effects, gradient, or animation).
`false` if the sprite is showing its untouched costume.

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |

Useful for guard conditions — "only apply the tint if the sprite isn't
already tinted", or "show the reset button only when something is
applied".

---

## How blocks interact

- **reset clears every other sector.** *reset colors* removes Costume
  Effects, Layer Effects, gradients (Quick and Full Control), and active
  animations on the same sprite in one call.
- **Cache changes affect first-paint only.** Once a costume is in the cache,
  every subsequent effect on it is microseconds. Clearing the cache forces
  the next effect to re-rasterise — not faster, not slower for steady-state.
- **Render quality is a global setting.** It affects every sprite using
  vector costumes. Per-sprite scale isn't supported.
- **Animations don't survive reset.** *reset colors* cancels any running
  animation on the target and unblocks any awaiting glide script.

---

## Common patterns

### Crisp text rendering

```
when green flag clicked
set render quality to 6 x clear cache true
```

For sprites that contain text, increasing the scale dramatically improves
sharpness, especially after `tint` or `set saturation` blocks.

### Free up memory after a cutscene

```
when I receive [end_cutscene v]
reset colors of cutscene_actor1
reset colors of cutscene_actor2
clear cache of cutscene_actor1
clear cache of cutscene_actor2
```

The reset removes effects; the cache clear releases the rasterised costume
buffers (a few hundred KB each).

### Conditional reset

```
when this sprite clicked
if <_myself_ has color override?> then
  reset colors of _myself_
else
  rotate hue of _myself_ by 60
end
```

A toggle: clicking flips between tinted and pristine.

### Quality switch mid-game

```
when [q v] key pressed
set render quality to 2 x clear cache true   // performance mode
when [w v] key pressed
set render quality to 6 x clear cache true   // quality mode
```

Or with `clear cache false` if you want both scales cached side-by-side
(a manual *clear cache of* later flushes the redundant entries).

### Reset everyone

```
when [r v] key pressed
broadcast [reset_all v]

when I receive [reset_all v]
reset colors of _myself_
```

(Place the receiving script under every sprite that may be tinted.)

---

## Things to know

- **`reset colors` is always safe.** The original costume asset is never
  modified — reset just stops pointing at the rendered overlay. Run it as
  often as you like, on as many sprites as you like.
- **Cache size scales with `(costumes × scales × sprites_using_them)`.**
  Most projects use one scale per session, so the cache is roughly one
  entry per costume per sprite — small.
- **Lower scales aren't always faster.** The bottleneck is the per-pixel
  loop, not the rasterisation. A 4× scale on a 16×16 vector costume takes
  almost no time at all because the resulting raster is still tiny.
- **`has color override?` is a registry lookup.** It's free to call — use
  it inside `forever` loops without worry.
