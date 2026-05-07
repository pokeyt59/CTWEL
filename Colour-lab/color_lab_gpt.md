# GPT.md

## Project overview
This project is a TurboWarp custom extension focused on color manipulation. It should stay compatible with the existing `Costume Color FX` extension and follow TurboWarp extension conventions.

## Goals
- Provide color randomization tools.
- Provide color math tools for working with hex colors.
- Provide a single-color output block for returning a solid color value.
- Stay compatible with the existing unsandboxed costume/color effect workflow.

## Compatibility rules
- Assume the extension runs **unsandboxed**.
- Use TurboWarp extension APIs and block formats consistently.
- Prefer hex color values like `#RRGGBB` for block inputs and outputs unless the existing extension requires another format.
- Keep block names and opcodes stable unless a breaking change is requested.
- Avoid introducing dependencies that would make the extension harder to load in TurboWarp.

## Coding style
- Use clear helper functions for color parsing and formatting.
- Clamp numeric color channels to valid ranges.
- Preserve alpha where appropriate.
- Keep the code readable and organized into sections such as helpers, block definitions, and block implementations.

## Preferred features
- Random color generation.
- Color blending and mixing.
- Add, subtract, multiply, invert, and randomize color operations.
- Single-color reporter block.
- Optional solid-color/blob generation only if explicitly needed.

## When modifying the extension
- Make changes carefully so existing blocks continue to work.
- If a block is renamed or removed, update all related logic consistently.
- Keep outputs predictable and easy to use inside Scratch/TurboWarp scripts.

## Notes for future edits
- If a user asks for a downloadable file, provide it in a common text-friendly format such as `.js` or `.md`.
- If a request is ambiguous, choose the simplest compatible implementation that fits the current extension design.

