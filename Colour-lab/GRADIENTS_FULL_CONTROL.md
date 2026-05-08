# Costume Colour FX v3.1 ALPHA — Gradients (Full Control)

The blocks under the **— Gradients (Full Control) —** label are the
multi-stop gradient builder. Set the gradient's type, geometry, blend mode,
and opacity, add as many colour stops as you want, then apply. Stops are
held per-sprite until you clear them or apply the gradient.

For two-colour one-shot gradients see the *Gradients (Quick)* sector. For
gradients confined to a single named layer see the layer gradient blocks in
*Layer Effects*.

---

## Workflow

A gradient is built in four phases:

1. **Set the type and angle** with *gradient on [TARGET]: type [TYPE] angle
   [ANGLE]°* (linear, radial, or conic).
2. **Set the centre and radius** (radial / conic only) with *gradient on
   [TARGET]: center X [CX]% Y [CY]% radius [R]%*.
3. **Set blend mode and opacity** with *gradient on [TARGET]: blend [BLEND]
   opacity [OPACITY]%*.
4. **Add stops** with *gradient on [TARGET]: add stop color [COLOR] alpha
   [ALPHA]% at [POS]%*. Repeat for each stop.
5. **Apply** the gradient with *apply gradient to [TARGET]*. The gradient
   composites on top of whatever Costume Effects pixel transform is active
   (or none).

You can call any of steps 1–3 at any time — settings persist on the sprite's
gradient definition until *remove gradient from [TARGET]* clears it. Stops
accumulate; call *clear gradient stops* to start over.

---

## The TARGET and BLEND slots

`TARGET` works the same as everywhere in the extension (sprite name,
`_myself_`, `_stage_`).

The `BLEND` menu offers `multiply`, `screen`, `overlay`, `color`, `hue`,
`saturation`, `luminosity`, `hard-light`, `soft-light`, `color-dodge`,
`color-burn`, `source-over`. The menu accepts reporters.

The `TYPE` menu offers `linear`, `radial`, `conic`.

---

## Block reference

### gradient on [TARGET]: type [TYPE] angle [ANGLE]°

Sets the gradient kind and direction on `TARGET`'s gradient definition.

| Slot   | Default     | Notes                                                       |
|--------|-------------|-------------------------------------------------------------|
| TARGET | `_myself_`  |                                                             |
| TYPE   | `linear`    | `linear`, `radial`, or `conic`.                             |
| ANGLE  | `90`        | Degrees. For `linear` and `conic` this is the gradient axis. Ignored for `radial`. |

If no gradient definition exists for `TARGET` yet, this block creates one
with default centre/radius/blend/opacity values.

### gradient on [TARGET]: center X [CX]% Y [CY]% radius [R]%

Sets the centre and radius for radial and conic gradients. Position is in
percent of the sprite's bounding box (`50%` is centred).

| Slot   | Default     | Notes                                              |
|--------|-------------|----------------------------------------------------|
| TARGET | `_myself_`  |                                                    |
| CX     | `50`        | Horizontal centre, percent.                        |
| CY     | `50`        | Vertical centre, percent.                          |
| R      | `100`       | Outer radius, percent of bounding box's max axis.  |

Has no visible effect on `linear` gradients but the values are remembered if
you change type later.

### gradient on [TARGET]: blend [BLEND] opacity [OPACITY]%

Sets the gradient's compositing blend mode and overall opacity.

| Slot    | Default     | Notes                              |
|---------|-------------|------------------------------------|
| TARGET  | `_myself_`  |                                    |
| BLEND   | `multiply`  | See blend menu list above.         |
| OPACITY | `80`        | Percent. `0` is invisible, `100` fully applied. |

### gradient on [TARGET]: add stop color [COLOR] alpha [ALPHA]% at [POS]%

Adds one colour stop to the gradient. Position `0%` is the start of the
gradient, `100%` the end. Stops can be added in any order.

| Slot   | Default     | Notes                                       |
|--------|-------------|---------------------------------------------|
| TARGET | `_myself_`  |                                             |
| COLOR  | `#ff0000`   |                                             |
| ALPHA  | `100`       | Percent. The stop's own opacity, multiplied by the gradient opacity at apply time. |
| POS    | `0`         | Percent. Stops at duplicate positions are allowed (for hard transitions). |

### clear gradient stops on [TARGET]

Removes every stop from the gradient definition. Type, centre, blend, and
opacity are kept — only the stop list is wiped.

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |

### apply gradient to [TARGET]

Renders the gradient and composites it onto the sprite. Without at least
two stops the result is invisible — the gradient has nothing to interpolate
between. If you have one stop the gradient is a flat colour at that opacity.

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |

The gradient definition is preserved after apply — re-applying with the same
definition is cheap.

### remove gradient from [TARGET]

Deletes the gradient definition and removes the gradient layer from the
sprite. Pixel effects (Costume Effects sector) on the same sprite are kept.

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |

---

## How blocks interact

- **Gradient sits on top of Costume Effects.** The single-layer pixel
  transform (rotate hue, tint, etc.) is rendered first; the gradient is
  composited on top using its own blend and opacity.
- **Gradient is per sprite.** One gradient definition per target. Setting
  type/angle/blend on a sprite that already has a gradient updates the
  existing definition rather than creating a new one.
- **Stops accumulate until you clear or remove.** *clear gradient stops*
  empties the stop list but keeps geometry; *remove gradient* deletes the
  whole definition.
- **For per-layer gradients use Layer Effects.** *layer X on [TARGET]:
  linear gradient* and *radial gradient* live on a named layer and are
  unrelated to this sector's full-control builder.

---

## Common patterns

### Sunset (linear, three stops)

```
when green flag clicked
gradient on _myself_: type linear angle 0
gradient on _myself_: blend source-over opacity 100
clear gradient stops on _myself_
gradient on _myself_: add stop color #ffd28f alpha 100 at 0
gradient on _myself_: add stop color #ff7c5b alpha 100 at 50
gradient on _myself_: add stop color #4a3a8a alpha 100 at 100
apply gradient to _myself_
```

### Soft vignette (radial)

```
gradient on _myself_: type radial angle 0
gradient on _myself_: center X 50 Y 50 radius 90
gradient on _myself_: blend multiply opacity 70
clear gradient stops on _myself_
gradient on _myself_: add stop color #ffffff alpha 100 at 0
gradient on _myself_: add stop color #000000 alpha 100 at 100
apply gradient to _myself_
```

### Two-tone conic

```
gradient on _myself_: type conic angle 0
gradient on _myself_: center X 50 Y 50 radius 100
gradient on _myself_: blend multiply opacity 80
clear gradient stops on _myself_
gradient on _myself_: add stop color #ff00aa alpha 100 at 0
gradient on _myself_: add stop color #00ffaa alpha 100 at 50
gradient on _myself_: add stop color #ff00aa alpha 100 at 100
apply gradient to _myself_
```

### Iterate with a list of stops

```
when green flag clicked
gradient on _myself_: type linear angle 90
clear gradient stops on _myself_
set [i v] to (1)
repeat (length of [stops v])
  gradient on _myself_: add stop color (item (i) of [stops v]) alpha 100 at ((i - 1) * 100 / (length of [stops v] - 1))
  change [i v] by (1)
end
apply gradient to _myself_
```

### Animate the gradient angle

```
when green flag clicked
clear gradient stops on _myself_
gradient on _myself_: add stop color #ff0000 alpha 100 at 0
gradient on _myself_: add stop color #0000ff alpha 100 at 100
forever
  gradient on _myself_: type linear angle (timer * 60)
  apply gradient to _myself_
end
```

---

## Things to know

- **Stops are sorted by position.** You can add them in any order; the
  renderer sorts them at apply time.
- **Alpha multiplies through.** Per-stop alpha and overall gradient opacity
  multiply — a 50% stop in a 50% gradient is 25% in the final pixel.
- **Conic angle starts at 12 o'clock.** A `0°` conic gradient's first stop
  is at the top, sweeping clockwise.
- **Apply isn't required after every change.** You can stage a complete
  gradient (type + geometry + blend + stops) and call *apply* once at the
  end. The work happens in *apply*.
- **Reset clears the gradient.** *reset colors of [TARGET]* (Costume Utility)
  removes the gradient along with all other effects.
