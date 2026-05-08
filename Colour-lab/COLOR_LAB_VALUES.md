# Costume Colour FX v3.1 ALPHA — Color Lab: Values

The blocks under the **— Color Lab: Values —** label are reporters that
produce colours as hex strings (e.g. `#ff7c5b`). They're pure math — they
don't touch any costume, sprite, or skin. Plug their output into any
extension block that takes a colour input, into a list, into a variable,
or into a colour-typed slot on another extension.

These are the foundation of the wider Color Lab section: build colours
here, transform them with *Color Lab: Math*, read their channels with
*Color Lab: Channel Readers*.

---

## Block reference

### (color [COLOR])

Reporter that returns the supplied colour as a hex string. The slot accepts
the standard Scratch colour picker, so this is the easiest way to feed a
fixed colour into any block — including blocks that don't natively support
the colour picker.

| Slot   | Default     |
|--------|-------------|
| COLOR  | `#ff0000`   |

Output format: `#rrggbb` lower-case six-digit hex.

### (random color)

Reporter that returns a fully random colour — every channel independently
chosen from 0–255.

No arguments.

The result is a uniformly random RGB point, which is *not* perceptually
uniform — random colours skew dark and muddy on average. For nicer-looking
random colours use *random hue color* below.

### (random color between [C1] and [C2])

Reporter that returns a random colour whose RGB channels each fall between
the corresponding channels of `C1` and `C2`. Useful for "random shade of
blue" or "random near-white".

| Slot   | Default     |
|--------|-------------|
| C1     | `#0000ff`   |
| C2     | `#ff0000`   |

Each channel is interpolated independently — passing `#000000` and
`#ffffff` reproduces *random color*, but passing `#0040a0` and `#3080ff`
gives a tight blue range.

### (random hue color  saturation [SAT]%  lightness [LIT]%)

Reporter that returns a random colour with a uniformly random hue and
fixed saturation and lightness. This is the perceptually-uniform random
colour generator — every output looks like a deliberate colour choice.

| Slot   | Default     | Notes                                              |
|--------|-------------|----------------------------------------------------|
| SAT    | `100`       | Percent. Higher = more vivid. Clamped to 0–100.    |
| LIT    | `50`        | Percent. `50` is fully saturated, `0` is black, `100` is white. |

Defaults produce a fully saturated, mid-lightness rainbow.

---

## How blocks interact

- **Output plugs into any colour slot.** All four reporters return hex
  strings, which TurboWarp's colour-picker slot accepts. Drop them into
  *tint*, *swap color*, gradient stop colours, the v3.1 *color [...]*
  block on other extensions, or list items.
- **They don't draw anything.** No costume is changed, no skin is created.
  These are pure value producers.
- **They feed the rest of Color Lab.** Use them as the input to *blend
  colors*, *shift hue*, *get hue*, etc. (Color Lab: Math / Channel Readers
  / Build & Compare sectors.)

---

## Common patterns

### Feed a colour into a tint

```
tint _myself_ with color (color #00ffaa) strength 80
```

Useful when you want a copy-pasteable colour value in a single place — edit
the picker once, the rest of the script picks it up.

### Random sprite colour at green flag

```
when green flag clicked
tint _myself_ with color (random hue color saturation 100 lightness 60) strength 100
```

### Random damage flash colour

```
when I receive [hit v]
tint _myself_ with color (random color between #ff8888 and #ff0000) strength 100
wait 0.1 secs
reset colors of _myself_
```

### Build a palette in a list

```
when green flag clicked
delete all of [palette v]
repeat 8
  add (random hue color saturation 80 lightness 55) to [palette v]
end
```

Then later iterate to colour eight sprites:

```
set [i v] to (1)
repeat 8
  tint (item (i) of [palette v]) ...   // pseudocode
  change [i v] by (1)
end
```

### Procedural sky gradient

```
gradient on _myself_: type linear angle 0
clear gradient stops on _myself_
gradient on _myself_: add stop color (random color between #aaccff and #ddeeff) alpha 100 at 0
gradient on _myself_: add stop color (random color between #ff7c5b #ffaa66) alpha 100 at 100
apply gradient to _myself_
```

### Variable as a colour source

```
set [accent v] to (color #66aaff)
tint sprite_a with color (accent) strength 60
tint sprite_b with color (accent) strength 60
```

A single colour update via the picker propagates everywhere.

---

## Things to know

- **Output is always a 7-character hex string.** Including the leading `#`,
  always lower-case, always six-digit. No alpha channel — these reporters
  don't carry transparency. (For RGBA see the gradient stop blocks, which
  take `ALPHA` as a separate input.)
- **`random color` is biased.** Uniform RGB doesn't look uniform to humans.
  Prefer *random hue color* for things the player will see.
- **`random color between` is per-channel uniform.** It's an axis-aligned
  cube in RGB space, which means a "random colour between red and blue"
  also includes purples — anything inside the cube whose corners are
  `#0000ff` and `#ff0000`.
- **The colour picker accepts hex pasted in.** If you have a specific colour
  in mind, paste the hex into a *(color [...])* block instead of fiddling
  with the picker UI.
- **These reporters don't yield.** They evaluate instantly — safe to use
  inside tight loops.
