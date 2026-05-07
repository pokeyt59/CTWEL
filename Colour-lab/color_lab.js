// TurboWarp extension: color randomisation, color math, and solid-color blobs
// Compatible with unsandboxed custom extensions and with extensions that expect
// hex color strings as inputs/outputs.
//
// Save as .js and load in TurboWarp as a custom extension.

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Color Lab must run unsandboxed.");
  }

  const BlockType = Scratch.BlockType;
  const ArgumentType = Scratch.ArgumentType;

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const round = (n) => Math.round(Number(n) || 0);

  function hex2(n) {
    return clamp(round(n), 0, 255).toString(16).padStart(2, "0");
  }

  function toNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function parseColor(input) {
    const s = String(input ?? "").trim();
    if (!s) return null;

    // Hex formats: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
    const hex = s.replace(/^#/, "");
    if (/^[0-9a-fA-F]{3,4}$/.test(hex) || /^[0-9a-fA-F]{6,8}$/.test(hex)) {
      let r, g, b, a = 255;
      if (hex.length === 3 || hex.length === 4) {
        r = parseInt(hex[0] + hex[0], 16);
        g = parseInt(hex[1] + hex[1], 16);
        b = parseInt(hex[2] + hex[2], 16);
        if (hex.length === 4) a = parseInt(hex[3] + hex[3], 16);
        return { r, g, b, a };
      }
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
      if (hex.length === 8) a = parseInt(hex.slice(6, 8), 16);
      return { r, g, b, a };
    }

    // Fallback to browser color parser
    const ctx = parseColor._ctx || (parseColor._ctx = document.createElement("canvas").getContext("2d"));
    if (!ctx) return null;

    ctx.fillStyle = "#000000";
    ctx.fillStyle = s;
    const normalized = String(ctx.fillStyle).trim();

    let m = normalized.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const parts = m[1].split(",").map(v => v.trim());
      const r = clamp(round(parts[0]), 0, 255);
      const g = clamp(round(parts[1]), 0, 255);
      const b = clamp(round(parts[2]), 0, 255);
      const a = parts.length > 3 ? clamp(round(Number(parts[3]) * 255), 0, 255) : 255;
      return { r, g, b, a };
    }

    m = normalized.match(/^#([0-9a-f]{6})$/i);
    if (m) {
      const hex6 = m[1];
      return {
        r: parseInt(hex6.slice(0, 2), 16),
        g: parseInt(hex6.slice(2, 4), 16),
        b: parseInt(hex6.slice(4, 6), 16),
        a: 255
      };
    }

    return null;
  }

  function rgbaToHex({ r, g, b, a = 255 }) {
    return `#${hex2(r)}${hex2(g)}${hex2(b)}${a === 255 ? "" : hex2(a)}`;
  }

  function rgbaToCss({ r, g, b, a = 255 }) {
    const alpha = a / 255;
    return a === 255
      ? `rgb(${round(r)}, ${round(g)}, ${round(b)})`
      : `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${alpha})`;
  }

  function rgbaToObject(c) {
    return { r: round(c.r), g: round(c.g), b: round(c.b), a: round(c.a ?? 255) };
  }

  function formatColor(color, format) {
    const c = rgbaToObject(color);
    switch (String(format)) {
      case "rgb":
        return `rgb(${c.r}, ${c.g}, ${c.b})`;
      case "rgba":
        return `rgba(${c.r}, ${c.g}, ${c.b}, ${(c.a / 255).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")})`;
      case "int":
        return String(((c.r & 255) << 16) | ((c.g & 255) << 8) | (c.b & 255));
      case "hex":
      default:
        return rgbaToHex(c);
    }
  }

  function randomColor() {
    return {
      r: Math.floor(Math.random() * 256),
      g: Math.floor(Math.random() * 256),
      b: Math.floor(Math.random() * 256),
      a: 255
    };
  }

  function blendChannel(a, b, t) {
    return round(a + (b - a) * t);
  }

  function mixColors(a, b, t) {
    return {
      r: blendChannel(a.r, b.r, t),
      g: blendChannel(a.g, b.g, t),
      b: blendChannel(a.b, b.b, t),
      a: blendChannel(a.a, b.a, t)
    };
  }

  function addColors(a, b) {
    return {
      r: clamp(a.r + b.r, 0, 255),
      g: clamp(a.g + b.g, 0, 255),
      b: clamp(a.b + b.b, 0, 255),
      a: clamp(a.a + b.a - 255, 0, 255)
    };
  }

  function subtractColors(a, b) {
    return {
      r: clamp(a.r - b.r, 0, 255),
      g: clamp(a.g - b.g, 0, 255),
      b: clamp(a.b - b.b, 0, 255),
      a: clamp(a.a, 0, 255)
    };
  }

  function multiplyColor(a, factor) {
    return {
      r: clamp(a.r * factor, 0, 255),
      g: clamp(a.g * factor, 0, 255),
      b: clamp(a.b * factor, 0, 255),
      a: clamp(a.a, 0, 255)
    };
  }

  function randomizeColor(base, amountPercent) {
    const amount = clamp(toNumber(amountPercent, 50), 0, 100) / 100;
    const rand = randomColor();
    return {
      r: blendChannel(base.r, rand.r, amount),
      g: blendChannel(base.g, rand.g, amount),
      b: blendChannel(base.b, rand.b, amount),
      a: base.a
    };
  }

  function invertColor(c) {
    return { r: 255 - c.r, g: 255 - c.g, b: 255 - c.b, a: c.a };
  }

  function solidSvgDataUri(color, width, height) {
    const w = clamp(Math.floor(toNumber(width, 64)), 1, 4096);
    const h = clamp(Math.floor(toNumber(height, 64)), 1, 4096);
    const css = rgbaToCss(color);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${css}"/></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  class ColorLab {
    getInfo() {
      return {
        id: "colorLab",
        name: "Color Lab",
        color1: "#6b5bff",
        color2: "#4a3fd1",
        color3: "#2f278f",
        blocks: [
          {
            opcode: "randomColorReporter",
            blockType: BlockType.REPORTER,
            text: "random color as [FORMAT]",
            arguments: {
              FORMAT: {
                type: ArgumentType.STRING,
                menu: "COLOR_FORMAT",
                defaultValue: "hex"
              }
            }
          },
          {
            opcode: "randomizeColor",
            blockType: BlockType.REPORTER,
            text: "randomize [COLOR] by [AMOUNT]%",
            arguments: {
              COLOR: { type: ArgumentType.COLOR, defaultValue: "#ff4c4c" },
              AMOUNT: { type: ArgumentType.NUMBER, defaultValue: 35 }
            }
          },
          {
            opcode: "mixColors",
            blockType: BlockType.REPORTER,
            text: "mix [A] with [B] by [AMOUNT]%",
            arguments: {
              A: { type: ArgumentType.COLOR, defaultValue: "#ff4c4c" },
              B: { type: ArgumentType.COLOR, defaultValue: "#4c4cff" },
              AMOUNT: { type: ArgumentType.NUMBER, defaultValue: 50 }
            }
          },
          {
            opcode: "addColors",
            blockType: BlockType.REPORTER,
            text: "[A] plus [B]",
            arguments: {
              A: { type: ArgumentType.COLOR, defaultValue: "#202020" },
              B: { type: ArgumentType.COLOR, defaultValue: "#101010" }
            }
          },
          {
            opcode: "subtractColors",
            blockType: BlockType.REPORTER,
            text: "[A] minus [B]",
            arguments: {
              A: { type: ArgumentType.COLOR, defaultValue: "#808080" },
              B: { type: ArgumentType.COLOR, defaultValue: "#202020" }
            }
          },
          {
            opcode: "multiplyColor",
            blockType: BlockType.REPORTER,
            text: "[COLOR] times [FACTOR]",
            arguments: {
              COLOR: { type: ArgumentType.COLOR, defaultValue: "#808080" },
              FACTOR: { type: ArgumentType.NUMBER, defaultValue: 1.2 }
            }
          },
          {
            opcode: "invertColor",
            blockType: BlockType.REPORTER,
            text: "invert [COLOR]",
            arguments: {
              COLOR: { type: ArgumentType.COLOR, defaultValue: "#ff4c4c" }
            }
          },
          {
            opcode: "solidBlob",
            blockType: BlockType.REPORTER,
            text: "single color blob [COLOR] [WIDTH] x [HEIGHT]",
            arguments: {
              COLOR: { type: ArgumentType.COLOR, defaultValue: "#ff4c4c" },
              WIDTH: { type: ArgumentType.NUMBER, defaultValue: 64 },
              HEIGHT: { type: ArgumentType.NUMBER, defaultValue: 64 }
            }
          },
          {
            opcode: "colorInfo",
            blockType: BlockType.REPORTER,
            text: "components of [COLOR] as [FORMAT]",
            arguments: {
              COLOR: { type: ArgumentType.COLOR, defaultValue: "#ff4c4c" },
              FORMAT: { type: ArgumentType.STRING, menu: "COLOR_FORMAT", defaultValue: "rgb" }
            }
          }
        ],
        menus: {
          COLOR_FORMAT: {
            acceptReporters: true,
            items: [
              { text: "hex", value: "hex" },
              { text: "rgb()", value: "rgb" },
              { text: "rgba()", value: "rgba" },
              { text: "packed integer", value: "int" }
            ]
          }
        }
      };
    }

    randomColorReporter(args) {
      return formatColor(randomColor(), args.FORMAT);
    }

    randomizeColor(args) {
      const base = parseColor(args.COLOR) || { r: 255, g: 76, b: 76, a: 255 };
      return formatColor(randomizeColor(base, args.AMOUNT), "hex");
    }

    mixColors(args) {
      const a = parseColor(args.A) || { r: 255, g: 76, b: 76, a: 255 };
      const b = parseColor(args.B) || { r: 76, g: 76, b: 255, a: 255 };
      const t = clamp(toNumber(args.AMOUNT, 50) / 100, 0, 1);
      return formatColor(mixColors(a, b, t), "hex");
    }

    addColors(args) {
      const a = parseColor(args.A) || { r: 0, g: 0, b: 0, a: 255 };
      const b = parseColor(args.B) || { r: 0, g: 0, b: 0, a: 255 };
      return formatColor(addColors(a, b), "hex");
    }

    subtractColors(args) {
      const a = parseColor(args.A) || { r: 0, g: 0, b: 0, a: 255 };
      const b = parseColor(args.B) || { r: 0, g: 0, b: 0, a: 255 };
      return formatColor(subtractColors(a, b), "hex");
    }

    multiplyColor(args) {
      const c = parseColor(args.COLOR) || { r: 128, g: 128, b: 128, a: 255 };
      const factor = toNumber(args.FACTOR, 1);
      return formatColor(multiplyColor(c, factor), "hex");
    }

    invertColor(args) {
      const c = parseColor(args.COLOR) || { r: 0, g: 0, b: 0, a: 255 };
      return formatColor(invertColor(c), "hex");
    }

    solidBlob(args) {
      const c = parseColor(args.COLOR) || { r: 255, g: 76, b: 76, a: 255 };
      return solidSvgDataUri(c, args.WIDTH, args.HEIGHT);
    }

    colorInfo(args) {
      const c = parseColor(args.COLOR) || { r: 255, g: 76, b: 76, a: 255 };
      return formatColor(c, args.FORMAT);
    }
  }

  Scratch.extensions.register(new ColorLab());
})(Scratch);
