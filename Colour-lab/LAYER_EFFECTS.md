# Costume Colour FX v3.1 ALPHA — Layer Effects

The blocks under the **— Layer Effects —** label let you stack named,
independent colour layers on a single sprite. Each layer can hold one pixel
transform OR a gradient, plus its own blend mode and opacity. Layers
compose bottom-up by an `order` value — bottom layers drawn first, top
layers blended on top.

Layers give you the kind of multi-effect compositing you can't get from
the legacy single-layer Costume Effects sector. You can have a hue rotation
on one layer, a multiply tint on another, and a radial gradient on a third
— all on the same sprite, switchable independently.

---

## The TARGET and LAYER slots

`TARGET` works the same as everywhere in the extension:

| Value             | Resolves to                                |
|-------------------|--------------------------------------------|
| empty / `_myself_`| the sprite running the script (default)    |
| `_stage_`         | the Stage                                  |
| a sprite name     | that sprite                                |
| anything else     | falls back to the sprite running the script|

`LAYER` is a free-text name (default `layer1`). You can use any string —
`base`, `glow`, `damage_tint`, `slot_3`. The first time a `(target, layer)`
pair is referenced the layer is created; subsequent calls update it.

---

## The BLEND menu

Several blocks in this sector take a `BLEND` slot. The menu offers:

`multiply`, `screen`, `overlay`, `color`, `hue`, `saturation`, `luminosity`,
`hard-light`, `soft-light`, `color-dodge`, `color-burn`, `source-over`.

These are standard CSS canvas composite operations. The menu accepts
reporters too, so you can pass a variable instead of a fixed mode.

---

## Block reference

### layer [LAYER] on [TARGET]: rotate hue by [DEGREES]°

Sets `LAYER`'s pixel content to a hue-rotated copy of the costume. Re-running
on the same layer replaces the previous content.

| Slot    | Default     |
|---------|-------------|
| LAYER   | `layer1`    |
| TARGET  | `_myself_`  |
| DEGREES | `90`        |

### layer [LAYER] on [TARGET]: set saturation to [PERCENT]%

| Slot    | Default     |
|---------|-------------|
| LAYER   | `layer1`    |
| TARGET  | `_myself_`  |
| PERCENT | `50`        |

### layer [LAYER] on [TARGET]: multiply brightness by [FACTOR]

| Slot   | Default     |
|--------|-------------|
| LAYER  | `layer1`    |
| TARGET | `_myself_`  |
| FACTOR | `0.5`       |

### layer [LAYER] on [TARGET]: tint [COLOR] strength [STRENGTH]%

| Slot     | Default     |
|----------|-------------|
| LAYER    | `layer1`    |
| TARGET   | `_myself_`  |
| COLOR    | `#ff0000`   |
| STRENGTH | `50`        |

### layer [LAYER] on [TARGET]: grayscale

| Slot   | Default     |
|--------|-------------|
| LAYER  | `layer1`    |
| TARGET | `_myself_`  |

### layer [LAYER] on [TARGET]: invert

| Slot   | Default     |
|--------|-------------|
| LAYER  | `layer1`    |
| TARGET | `_myself_`  |

### layer [LAYER] on [TARGET]: set alpha to [PERCENT]%

| Slot    | Default     |
|---------|-------------|
| LAYER   | `layer1`    |
| TARGET  | `_myself_`  |
| PERCENT | `50`        |

### layer [LAYER] on [TARGET]: multiply RGB R:[R] G:[G] B:[B]

| Slot   | Default     |
|--------|-------------|
| LAYER  | `layer1`    |
| TARGET | `_myself_`  |
| R      | `1`         |
| G      | `0.5`       |
| B      | `0.5`       |

### layer [LAYER] on [TARGET]: blend mode [BLEND] opacity [OPACITY]%

Sets the blend mode and opacity of an *existing* layer without changing its
pixel content. If the layer doesn't exist yet it's created with no pixel
content (which means it composites a transparent layer — set its content
first).

| Slot    | Default       |
|---------|---------------|
| LAYER   | `layer1`      |
| TARGET  | `_myself_`    |
| BLEND   | `source-over` |
| OPACITY | `80`          |

### layer [LAYER] on [TARGET]: linear gradient [C1]→[C2] angle [ANGLE]° blend [BLEND] opacity [OPACITY]%

Sets `LAYER`'s content to a two-stop linear gradient from `C1` to `C2`. The
gradient is masked to the costume's alpha shape (it can't bleed outside).

| Slot    | Default     |
|---------|-------------|
| LAYER   | `layer1`    |
| TARGET  | `_myself_`  |
| C1      | `#ff0000`   |
| C2      | `#0000ff`   |
| ANGLE   | `90`        |
| BLEND   | `multiply`  |
| OPACITY | `80`        |

### layer [LAYER] on [TARGET]: radial gradient inner [C1] outer [C2] radius [R]% blend [BLEND] opacity [OPACITY]%

Sets `LAYER`'s content to a radial gradient from the centre outward. `R` is
the outer radius as a percent of the sprite's bounding box.

| Slot    | Default     |
|---------|-------------|
| LAYER   | `layer1`    |
| TARGET  | `_myself_`  |
| C1      | `#ffffff`   |
| C2      | `#000000`   |
| R       | `100`       |
| BLEND   | `multiply`  |
| OPACITY | `80`        |

### clear layer [LAYER] on [TARGET]

Empties a layer's pixel content but keeps the layer entry itself (its blend
mode, opacity, and order are remembered for next use).

| Slot   | Default     |
|--------|-------------|
| LAYER  | `layer1`    |
| TARGET | `_myself_`  |

### remove layer [LAYER] from [TARGET]

Deletes a layer entirely. Its content, blend mode, opacity, and order are
discarded. If `LAYER` doesn't exist this is a no-op.

| Slot   | Default     |
|--------|-------------|
| LAYER  | `layer1`    |
| TARGET | `_myself_`  |

### remove all layers from [TARGET]

Wipes every layer on the sprite and re-points it at the unmodified costume.
Equivalent to *reset colors of [TARGET]* for the layer system.

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |

### set layer [LAYER] on [TARGET] order to [ORDER]

Sets a layer's draw order. Lower numbers render first (further back). Layers
created without an explicit order get an insertion-index value, so by
default they stack in the order you first used them.

| Slot   | Default     |
|--------|-------------|
| LAYER  | `layer1`    |
| TARGET | `_myself_`  |
| ORDER  | `0`         |

### \<[TARGET] has layer [LAYER]?\>

Boolean reporter — `true` if a layer of that name exists on the sprite.

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |
| LAYER  | `layer1`    |

### (layer count of [TARGET])

Reporter — the number of active layers on the sprite.

| Slot   | Default     |
|--------|-------------|
| TARGET | `_myself_`  |

---

## How blocks interact

- **One transform OR one gradient per layer.** A pixel-effect block on
  `layer1` replaces a gradient previously set on `layer1`, and vice versa.
  Want both? Put them on different layers.
- **Layers compose over the costume.** The original costume is the base; all
  layers are blended on top in `order` ascending. The final composite is
  always clipped to the costume's alpha silhouette — colour can't escape the
  sprite's outline.
- **Layer Effects and Costume Effects share the live skin.** Both sectors
  push to the same single GPU skin per sprite. Running a Costume Effects
  block replaces *all* layers (it's the legacy single-slot path); running a
  Layer Effects block replaces whatever the Costume Effects block last set.
- **Animations don't currently combine with layers.** The rAF animation
  sector writes to the legacy single-layer slot, so an animation overrides
  any layer composition on that sprite while it runs.
- **Reset clears everything.** *reset colors of [TARGET]* (Costume Utility)
  removes every layer and points the sprite at its raw costume.

---

## Common patterns

### Two-layer hue + tint

```
when green flag clicked
layer base on _myself_: rotate hue by 30
layer tint on _myself_: tint #ffaa00 strength 40
layer tint on _myself_: blend mode multiply opacity 80
```

The base layer holds the hue-rotated costume; the tint layer multiplies a
warm orange over the top.

### Damage tint as a separate layer

```
when I receive [hit v]
layer damage on _myself_: tint #ff0000 strength 100
layer damage on _myself_: blend mode source-over opacity 60
wait 0.15 secs
remove layer damage from _myself_
```

The hit flash lives on its own layer so the rest of the sprite's effects are
preserved during the flash.

### Idle glow with radial gradient

```
when green flag clicked
layer glow on _myself_: radial gradient inner #ffffff outer #000000 radius 70 blend screen opacity 40
```

### Stacking order

```
layer back on _myself_: tint #444444 strength 100
set layer back on _myself_ order to 0
layer front on _myself_: rotate hue by 90
set layer front on _myself_ order to 1
```

The `back` layer renders behind `front`.

### Removing one layer without disturbing others

```
remove layer damage from _myself_
```

(Vs. *remove all layers from* which clears every layer the sprite has.)

---

## Things to know

- **Recompositing happens automatically.** Every layer block triggers a
  recomposite of the sprite's final visual. You don't need to call an
  "apply" block.
- **Layers are CPU memory, not GPU textures.** A 256×256 layer is ~256 KB of
  RAM. Five layers per sprite is ~1.3 MB — fine on every modern device.
- **Clones don't inherit layers.** A new clone starts blank. Set up its
  layers under *when I start as a clone* if you want the same look.
- **Layer names are case-sensitive.** `Layer1` and `layer1` are different
  layers.
- **`source-over` is the regular alpha-over blend.** Use it for layers that
  should sit on top without colour interaction.
