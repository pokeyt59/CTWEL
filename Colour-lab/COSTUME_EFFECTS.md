# Costume Colour FX v3.1 ALPHA — Costume Effects

The blocks under the **— Costume Effects —** label apply a single colour
transformation to a sprite's costume at runtime. Effects do not modify the
costume asset — they're rendered onto a temporary skin that the extension
swaps in front of the original. Clearing or resetting points the sprite back
at its untouched costume.

These are the legacy single-layer effect blocks. They share **one effect slot
per sprite**: running a new Costume Effects block on the same sprite replaces
the previous one (a *swap color* call replaces a *rotate hue* call, etc.).
For independent, stackable transformations use the Layer Effects sector.

---

## The TARGET slot

Every block in this sector takes a `TARGET` input — a free-text string slot,
no menu.

| Value             | Resolves to                                |
|-------------------|--------------------------------------------|
| empty / `_myself_`| the sprite running the script (default)    |
| `_stage_`         | the Stage                                  |
| a sprite name     | that sprite                                |
| anything else     | falls back to the sprite running the script|

---

## Block reference

### rotate hue of [TARGET] by [DEGREES]°

Shifts every pixel's hue by `DEGREES` degrees on the colour wheel. Pure red at
0° becomes yellow at 60°, green at 120°, and so on. Wraps around 360°.

| Slot    | Default     |
|---------|-------------|
| TARGET  | `_myself_`  |
| DEGREES | `90`        |

### set saturation of [TARGET] to [PERCENT]%

Sets the saturation of every pixel to `PERCENT` percent. `0%` is fully grey,
`100%` is fully vivid. Values above 100% over-saturate.

| Slot    | Default     |
|---------|-------------|
| TARGET  | `_myself_`  |
| PERCENT | `50`        |

### multiply brightness of [TARGET] by [FACTOR]

Multiplies every pixel's RGB values by `FACTOR`. `1` leaves brightness
unchanged, `0` is pure black, `2` is twice as bright (clamped at 255 per
channel). `FACTOR` of zero or below produces a fully black silhouette.

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |
| FACTOR | `0.5`       |

### tint [TARGET] with color [COLOR] strength [STRENGTH]%

Blends every visible pixel toward `COLOR` by `STRENGTH` percent. `0%` is no
change, `100%` is a full flat tint.

| Slot     | Default     |
|----------|-------------|
| TARGET   | `_myself_`  |
| COLOR    | `#ff0000`   |
| STRENGTH | `50`        |

### swap color [FROM] → [TO] in [TARGET] tolerance [TOL]

Replaces every pixel close to `FROM` with `TO`. `TOL` is the colour-distance
tolerance — `0` means an exact match, larger numbers catch a wider range of
similar colours. Useful for recolouring specific costume parts (a shirt, a
flame).

| Slot   | Default     |
|--------|-------------|
| FROM   | `#ff0000`   |
| TO     | `#0000ff`   |
| TARGET | `_myself_`  |
| TOL    | `30`        |

### multiply RGB channels of [TARGET] R:[R] G:[G] B:[B]

Multiplies each colour channel independently. Use it to fade out one channel
while preserving the others, or to recolour with a hand-mixed scale.

| Slot   | Default     | Notes                                    |
|--------|-------------|------------------------------------------|
| TARGET | `_myself_`  |                                          |
| R      | `1`         | `1` keeps the channel as-is. `0` removes it. |
| G      | `0.5`       |                                          |
| B      | `0.5`       |                                          |

### make [TARGET] grayscale

Replaces every pixel with its luminance (a perceptually weighted grey).

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |

### invert colors of [TARGET]

Inverts every channel — produces the photographic negative of the costume.

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |

### set alpha of [TARGET] to [PERCENT]%

Multiplies the costume's alpha channel by `PERCENT / 100`. `100%` keeps the
sprite fully opaque, `0%` makes it fully transparent. Stacks below the
sprite's normal "ghost" effect.

| Slot    | Default     |
|---------|-------------|
| TARGET  | `_myself_`  |
| PERCENT | `50`        |

---

## How blocks interact

- **One effect slot per sprite.** Running a second Costume Effects block
  replaces the first. To combine effects (e.g. tint *and* rotate hue), use
  Layer Effects instead.
- **Animations cancel this slot.** Starting an animation block (rAF sector)
  on a sprite overrides whatever Costume Effect was active. Conversely,
  running a Costume Effect on an animating sprite cancels the animation.
- **Gradients pair with one Costume Effect.** A gradient applied via
  *apply gradient to* or the Quick gradient blocks is composited *on top of*
  whatever pixel effect is currently in this slot. Use Layer Effects for
  finer control.
- **Reset clears it.** *reset colors of [TARGET]* (Costume Utility sector)
  removes the effect and points the sprite back at its raw costume.
- **Costume changes survive.** Switching costume mid-effect is fine — the
  same effect re-applies to the new costume on the next render. There may be
  a brief one-frame flash on the very first time a new costume is seen.

---

## Common patterns

### Single tint at green flag

```
when green flag clicked
tint _myself_ with color #00ffff strength 60
```

### Hue cycle in a Scratch loop

```
when green flag clicked
forever
  rotate hue of _myself_ by 5
end
```

(For a smoother, frame-perfect version use *animate hue rotation* from the
Animations sector.)

### Recolour a specific costume colour

```
when green flag clicked
swap color #ffd1a4 → #c2e8b0 in _myself_ tolerance 25
```

### Damage flash

```
when I receive [hit v]
tint _myself_ with color #ff0000 strength 100
wait 0.1 secs
reset colors of _myself_
```

### Fade out

```
repeat 20
  set alpha of _myself_ to ((20 - i) * 5)
end
```

(Or use *glide brightness* / *glide hue* for vsync-synced fades — see the
Animations sector.)

---

## Things to know

- **Effects are reversible.** *reset colors of [TARGET]* always restores the
  pristine costume — the source asset is never modified.
- **Clones are independent.** Each clone has its own effect slot. Cloning a
  sprite mid-effect copies the visual state but the new clone tracks its own
  slot from then on.
- **Render quality affects sharpness.** Vector costumes are rasterised at a
  scale chosen by *set render quality* (Costume Utility sector). Higher
  scales look sharper but use more memory and take longer to first-paint.
- **Effects re-apply per costume.** The first time a costume is seen at a
  given quality scale it must be rasterised; subsequent uses hit the cache
  and apply effects in microseconds.
