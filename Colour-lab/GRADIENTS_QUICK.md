# Costume Colour FX v3.1 ALPHA — Gradients (Quick)

The blocks under the **— Gradients (Quick) —** label are one-shot gradient
blocks. Drop one in your script, fill in the colours and blend, and you're
done — no need to set type/centre/blend/stops separately.

Each Quick block builds and applies a complete gradient in a single call.
Internally they create the same gradient definition the *Gradients (Full
Control)* sector uses, so they coexist with that sector — running a Quick
block replaces whatever full-control gradient was previously on the sprite.

For multi-stop gradients or gradients you want to mutate over time, use the
Full Control sector instead.

---

## The TARGET slot

| Value             | Resolves to                                |
|-------------------|--------------------------------------------|
| empty / `_myself_`| the sprite running the script (default)    |
| `_stage_`         | the Stage                                  |
| a sprite name     | that sprite                                |
| anything else     | falls back to the sprite running the script|

---

## The BLEND menu

`multiply`, `screen`, `overlay`, `color`, `hue`, `saturation`, `luminosity`,
`hard-light`, `soft-light`, `color-dodge`, `color-burn`, `source-over`.

The menu accepts reporters, so a variable can drive the blend mode.

---

## Block reference

### linear gradient on [TARGET] [C1]→[C2] angle [ANGLE]° blend [BLEND] opacity [OPACITY]%

Builds and applies a two-stop linear gradient from `C1` (at 0%) to `C2`
(at 100%). The gradient axis is rotated by `ANGLE` degrees.

| Slot    | Default     |
|---------|-------------|
| TARGET  | `_myself_`  |
| C1      | `#ff0000`   |
| C2      | `#0000ff`   |
| ANGLE   | `90`        |
| BLEND   | `multiply`  |
| OPACITY | `80`        |

### radial gradient on [TARGET] inner [C1] outer [C2] radius [R]% blend [BLEND] opacity [OPACITY]%

Builds and applies a two-stop radial gradient from `C1` at the centre to
`C2` at the outer edge. `R` is the outer radius as a percent of the
sprite's bounding box.

| Slot    | Default     |
|---------|-------------|
| TARGET  | `_myself_`  |
| C1      | `#ffffff`   |
| C2      | `#000000`   |
| R       | `100`       |
| BLEND   | `multiply`  |
| OPACITY | `80`        |

The centre is fixed at 50%/50%. For off-centre radial gradients use the
Full Control sector.

### rainbow gradient on [TARGET] angle [ANGLE]° opacity [OPACITY]%

Applies a seven-stop rainbow (red → orange → yellow → green → blue → indigo
→ violet) as a linear gradient at `ANGLE`. Blend mode is fixed at
`multiply` so it tints whatever the costume's existing colour is.

| Slot    | Default     |
|---------|-------------|
| TARGET  | `_myself_`  |
| ANGLE   | `90`        |
| OPACITY | `70`        |

---

## How blocks interact

- **Quick blocks replace the gradient.** Running any Quick block on a
  sprite that already has a gradient (Quick or Full Control) replaces the
  full gradient definition.
- **Quick blocks coexist with Costume Effects.** The Quick gradient sits on
  top of any active Costume Effects pixel transform.
- **Per-layer gradients are different.** *layer X on [TARGET]: linear/radial
  gradient* (Layer Effects sector) writes to a named layer and does not
  interact with this sector's gradient.
- **Reset clears the gradient.** *reset colors of [TARGET]* and *remove
  gradient from [TARGET]* (Costume Utility / Full Control sectors) both
  remove what a Quick block applied.

---

## Common patterns

### Quick rainbow on green flag

```
when green flag clicked
rainbow gradient on _myself_ angle 90 opacity 70
```

### Heat-up effect on a button

```
when this sprite clicked
linear gradient on _myself_ #ff8800 → #ff0000 angle 90 blend multiply opacity 100
```

### Soft glow

```
when green flag clicked
radial gradient on _myself_ inner #ffffff outer #000000 radius 80 blend screen opacity 50
```

### Animate the angle

```
when green flag clicked
forever
  linear gradient on _myself_ #ff00ff → #00ffff angle (timer * 60) blend multiply opacity 80
end
```

(Smoother: use the rAF animation sector or the Full Control sector with
`apply gradient to` only when stops change.)

### Recolour a sprite tint

```
when green flag clicked
linear gradient on _myself_ #aa0000 → #aa0000 angle 0 blend color opacity 100
```

A two-stop gradient with the same colour at both ends is the same as a
flat colour wash. Combined with the `color` blend mode it recolours the
sprite while preserving the costume's luminosity.

---

## Things to know

- **The gradient survives between green-flag runs unless cleared.**
  Apply a Quick block once and it stays applied. Use *reset colors of* or
  *remove gradient from* to clear.
- **Quick block opacity is the gradient opacity.** Per-stop alpha is fixed
  at 100% in Quick blocks; for per-stop alpha control use the Full Control
  sector.
- **The rainbow block is multiply.** It can't be re-blended without going
  through the Full Control sector. To get a `screen`-blended rainbow, build
  it manually with seven stops in Full Control.
