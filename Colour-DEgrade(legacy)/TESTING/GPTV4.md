# GPTV4.md

## Scope

This document is a **safe reasoning summary** of the work discussed in this chat. It does **not** include private chain-of-thought or hidden deliberation. It captures the main goals, constraints, architecture choices, and implementation direction.

## Main objective

Build a TurboWarp extension named **Colour DEgrade** that adds runtime dithering to sprite images, while remaining compatible with the provided **Colour Lab V3.0 BETA** extension.

## Constraints carried through the conversation

- Keep the final extension compatible with Colour Lab.
- Avoid breaking existing cache, layer, or snapshot behavior.
- Preserve the visible extension name **Colour DEgrade**.
- Support both fast ordered dithering and optional error diffusion.
- Add palette-based dithering as an option.
- Prefer pipeline integration over destructive overwrite behavior.
- Optimize for performance without changing visual semantics unnecessarily.

## Design decisions

### 1. Compatibility first
The safest path is to avoid global monkey-patching and instead integrate through the existing image transform pipeline. That keeps the extension aligned with Colour Lab’s raster cache, layer map, and revision tracking.

### 2. Dithering as a native transform
Dithering works best as a first-class transform kind, rather than a separate post-process that replaces skins independently. This keeps it compatible with the rest of the rendering pipeline.

### 3. Ordered dithering as the fast path
A Bayer matrix ordered dither is the simplest fast implementation and is a good default for runtime use.

### 4. Error diffusion as an optional mode
Floyd–Steinberg style diffusion gives better quality but costs more. Making it optional lets users choose quality or performance.

### 5. Palette support
Palette-based quantization lets the same machinery work for fixed color sets, which makes the effect more flexible and useful for sprite art.

### 6. Unified extension identity
The merged architecture keeps the extension name **Colour DEgrade** while absorbing the useful parts of the earlier PRO design.

### 7. Worker-based tile renderer
For performance, the next step is a tile-based worker pipeline:
- Split the raster into tiles.
- Process tiles in Web Workers.
- Merge the results back into a single `ImageData`.
- Use the fast ordered path for best parallel scaling.
- Use a strip/halo strategy for diffusion where exact cross-tile error propagation is not practical.

## Implementation direction

### Pipeline shape
`source costume -> raster cache -> transform stage -> optional dithering stage -> gradient/layer composition -> output skin`

### Safe integration points
- `processImageData(...)` for native pixel transforms.
- `applyToTarget(...)` for async worker-based rendering.
- `rasterCache` and `layerMap` remain the authoritative internal systems for Colour Lab behavior.

### Worker tile renderer summary
The tile renderer should:
- detect whether the transform is suitable for parallel processing;
- partition the image into fixed-size tiles;
- send each tile to a worker with its local metadata;
- apply ordered dithering in parallel across tiles;
- for diffusion, use a guarded strategy that avoids visible breaks while still improving throughput;
- return a combined `ImageData` object for the final skin update.

## What was intentionally not included

- Hidden reasoning or internal deliberation.
- Private step-by-step chain-of-thought.
- Claims that the implementation is exact unless it was verified in code.

## Bottom line

The best final shape is a single extension, **Colour DEgrade**, that integrates with Colour Lab’s transform pipeline and uses worker-based tiled rendering for speed where possible, while keeping compatibility and visual stability as the top priorities.
