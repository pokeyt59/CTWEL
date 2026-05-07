// Name: Costume Color FX + Color Lab
// Description: Runtime costume color effects (hue, saturation, brightness, tint, gradients) plus
//              a full color math and randomization toolkit — all without permanently modifying costumes.
// By: Claude + GPT (combined)
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Costume Color FX must run unsandboxed.");
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SHARED HELPERS
  // ════════════════════════════════════════════════════════════════════════════

  /** "#rrggbb" or "#rgb"  →  [r, g, b]  (0–255) */
  function hexToRgb(hex) {
    hex = String(hex).replace(/^#/, "").trim();
    if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
    if (hex.length !== 6) return [0, 0, 0];
    const n = parseInt(hex, 16);
    // parseInt returns NaN for fully invalid strings; guard it
    if (n !== n) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // Hex LUT: pre-built lookup table for int → 2-char hex, avoids toString(16)+padStart per channel
  const _hexLUT = new Array(256);
  for (let i = 0; i < 256; i++) _hexLUT[i] = i.toString(16).padStart(2, "0");

  /** [r, g, b]  (0–255)  →  "#rrggbb" */
  function rgbToHex(r, g, b) {
    return "#" + _hexLUT[clamp255(r)] + _hexLUT[clamp255(g)] + _hexLUT[clamp255(b)];
  }

  /** RGB 0–255  →  HSL  (h 0–360, s 0–100, l 0–100) */
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b);
    const min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    const l = (max + min) * 0.5;
    if (max === min) return [0, 0, l * 100];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else                h = ((r - g) / d + 4) / 6;
    return [h * 360, s * 100, l * 100];
  }

  // hue2rgb hoisted out so hslToRgb doesn't recreate a closure each call
  function _hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 0.5) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  }

  /** HSL  (h 0–360, s 0–100, l 0–100)  →  RGB 0–255 */
  function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(_hue2rgb(p, q, h + 1/3) * 255),
      Math.round(_hue2rgb(p, q, h)       * 255),
      Math.round(_hue2rgb(p, q, h - 1/3) * 255),
    ];
  }

  /** Clamp to integer 0–255.
   *  Using bitwise OR is faster than Math.max/min/round for in-range floats. */
  function clamp255(v) {
    // The (v + 0.5) | 0 trick rounds and truncates simultaneously.
    // Guard the edges explicitly since | 0 wraps on overflow.
    return v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
  }

  /** Linear interpolation */
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ════════════════════════════════════════════════════════════════════════════
  // PIXEL-LEVEL TRANSFORM  (used by Costume FX blocks)
  // ════════════════════════════════════════════════════════════════════════════

  function processImageData(imageData, spec) {
    const src = imageData.data;
    const out = new ImageData(imageData.width, imageData.height);
    const dst = out.data;
    const len = src.length;

    if (!spec) {
      dst.set(src);
      return out;
    }

    if (typeof spec === "function") {
      for (let i = 0; i < len; i += 4) {
        const a = src[i + 3];
        if (a === 0) { dst[i + 3] = 0; continue; }
        const res = spec(src[i], src[i + 1], src[i + 2], a);
        dst[i]   = clamp255(res[0]);
        dst[i+1] = clamp255(res[1]);
        dst[i+2] = clamp255(res[2]);
        dst[i+3] = clamp255(res[3] !== undefined ? res[3] : a);
      }
      return out;
    }

    // OPT: split hue/saturation into separate cases — no per-pixel branch
    const kind = spec.kind;
    switch (kind) {
      case "brightness": {
        const factor = spec.factor;
        for (let i = 0; i < len; i += 4) {
          const a = src[i + 3];
          if (a === 0) { dst[i + 3] = 0; continue; }
          dst[i]   = clamp255(src[i]     * factor);
          dst[i+1] = clamp255(src[i + 1] * factor);
          dst[i+2] = clamp255(src[i + 2] * factor);
          dst[i+3] = a;
        }
        break;
      }
      case "tint": {
        const { tr, tg, tb, strength: s } = spec;
        const inv = 1 - s;
        for (let i = 0; i < len; i += 4) {
          const a = src[i + 3];
          if (a === 0) { dst[i + 3] = 0; continue; }
          dst[i]   = clamp255(src[i]   * inv + tr * s);
          dst[i+1] = clamp255(src[i+1] * inv + tg * s);
          dst[i+2] = clamp255(src[i+2] * inv + tb * s);
          dst[i+3] = a;
        }
        break;
      }
      case "swap": {
        const { fr, fg, fb, tr, tg, tb, tol, tolSq } = spec;
        const dtr = tr - fr, dtg = tg - fg, dtb = tb - fb;
        const invTol = tol > 0 ? 1 / tol : 1;
        for (let i = 0; i < len; i += 4) {
          const a = src[i + 3];
          if (a === 0) { dst[i + 3] = 0; continue; }
          const dr = src[i]   - fr;
          const dg = src[i+1] - fg;
          const db = src[i+2] - fb;
          const distSq = dr * dr + dg * dg + db * db;
          if (distSq <= tolSq) {
            // OPT: avoid sqrt branch — use t=1 when tol=0 (tolSq=0 means distSq must be 0)
            const t = tol > 0 ? (1 - Math.sqrt(distSq) * invTol) : 1;
            dst[i]   = clamp255(src[i]   + dtr * t);
            dst[i+1] = clamp255(src[i+1] + dtg * t);
            dst[i+2] = clamp255(src[i+2] + dtb * t);
          } else {
            dst[i]   = src[i];
            dst[i+1] = src[i+1];
            dst[i+2] = src[i+2];
          }
          dst[i+3] = a;
        }
        break;
      }
      case "channels": {
        const { mr, mg, mb } = spec;
        for (let i = 0; i < len; i += 4) {
          const a = src[i + 3];
          if (a === 0) { dst[i + 3] = 0; continue; }
          dst[i]   = clamp255(src[i]     * mr);
          dst[i+1] = clamp255(src[i + 1] * mg);
          dst[i+2] = clamp255(src[i + 2] * mb);
          dst[i+3] = a;
        }
        break;
      }
      case "grayscale": {
        for (let i = 0; i < len; i += 4) {
          const a = src[i + 3];
          if (a === 0) { dst[i + 3] = 0; continue; }
          // OPT: integer weights (×1024) then >>10 — avoids float multiply per pixel
          const gray = (src[i] * 306 + src[i + 1] * 601 + src[i + 2] * 117) >> 10;
          dst[i] = dst[i+1] = dst[i+2] = gray;
          dst[i+3] = a;
        }
        break;
      }
      case "invert": {
        // OPT: no clamp needed — subtraction from 255 is always in-range for uint8
        for (let i = 0; i < len; i += 4) {
          const a = src[i + 3];
          if (a === 0) { dst[i + 3] = 0; continue; }
          dst[i]   = 255 - src[i];
          dst[i+1] = 255 - src[i + 1];
          dst[i+2] = 255 - src[i + 2];
          dst[i+3] = a;
        }
        break;
      }
      case "alpha": {
        const pct = spec.pct;
        for (let i = 0; i < len; i += 4) {
          const a = src[i + 3];
          if (a === 0) { dst[i + 3] = 0; continue; }
          // OPT: copy RGB as a 32-bit block via typed arrays isn't available here,
          //      but we can skip clamp255 on the 3 RGB channels since they stay the same.
          dst[i]   = src[i];
          dst[i+1] = src[i + 1];
          dst[i+2] = src[i + 2];
          dst[i+3] = clamp255(a * pct);
        }
        break;
      }
      // OPT: split into two separate cases — eliminates per-pixel kind check
      case "hue": {
        const deg = spec.deg || 0;
        for (let i = 0; i < len; i += 4) {
          const a = src[i + 3];
          if (a === 0) { dst[i + 3] = 0; continue; }
          const hsl = rgbToHsl(src[i], src[i + 1], src[i + 2]);
          hsl[0] = ((hsl[0] + deg) % 360 + 360) % 360;
          const outRgb = hslToRgb(hsl[0], hsl[1], hsl[2]);
          dst[i]   = outRgb[0];
          dst[i+1] = outRgb[1];
          dst[i+2] = outRgb[2];
          dst[i+3] = a;
        }
        break;
      }
      case "saturation": {
        const pct = spec.pct;
        for (let i = 0; i < len; i += 4) {
          const a = src[i + 3];
          if (a === 0) { dst[i + 3] = 0; continue; }
          const hsl = rgbToHsl(src[i], src[i + 1], src[i + 2]);
          const outRgb = hslToRgb(hsl[0], pct, hsl[2]);
          dst[i]   = outRgb[0];
          dst[i+1] = outRgb[1];
          dst[i+2] = outRgb[2];
          dst[i+3] = a;
        }
        break;
      }
      default: {
        // Pass-through: just copy
        dst.set(src);
      }
    }
    return out;
  }


  // ════════════════════════════════════════════════════════════════════════════
  // GRADIENT COMPOSITING  (used by Costume FX blocks)
  // ════════════════════════════════════════════════════════════════════════════

  function hexAlpha(hexColor, alpha) {
    const [r, g, b] = hexToRgb(hexColor);
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }

  function normalizeGradientStop(stop) {
    const alpha = stop.alpha !== undefined ? Math.max(0, Math.min(1, Number(stop.alpha))) : 1;
    const pos   = Math.max(0, Math.min(1, Number(stop.pos)));
    return {
      color: stop.color,
      alpha,
      pos,
      // OPT: reuse existing css string if already normalized (avoid re-computing)
      css: stop.css || hexAlpha(stop.color, alpha),
    };
  }

  function applyGradientToCanvas(srcCanvas, gradDef) {
    const w = srcCanvas.width, h = srcCanvas.height;

    const gradCanvas = document.createElement("canvas");
    gradCanvas.width = w; gradCanvas.height = h;
    const gCtx = gradCanvas.getContext("2d");

    let gradient;
    const { type, angle, stops, cx, cy, r: gradR } = gradDef;

    if (type === "radial") {
      const px = ((cx !== undefined ? cx : 50) / 100) * w;
      const py = ((cy !== undefined ? cy : 50) / 100) * h;
      const maxR = Math.sqrt(w * w + h * h) * 0.5;
      const radius = Math.max(1, ((gradR !== undefined ? gradR : 100) / 100) * maxR);
      gradient = gCtx.createRadialGradient(px, py, 0, px, py, radius);
    } else if (type === "conic") {
      const px = ((cx !== undefined ? cx : 50) / 100) * w;
      const py = ((cy !== undefined ? cy : 50) / 100) * h;
      const startRad = ((angle || 0) - 90) * (Math.PI / 180);
      gradient = (typeof gCtx.createConicGradient === "function")
        ? gCtx.createConicGradient(startRad, px, py)
        : gCtx.createLinearGradient(0, 0, w, 0);
    } else {
      const rad = ((angle || 0) - 90) * (Math.PI / 180);
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const halfLen = (Math.abs(cos) * h + Math.abs(sin) * w) * 0.5;
      const mx = w * 0.5, my = h * 0.5;
      gradient = gCtx.createLinearGradient(
        mx - cos * halfLen, my - sin * halfLen,
        mx + cos * halfLen, my + sin * halfLen
      );
    }

    for (let i = 0; i < stops.length; i++) {
      const stop = stops[i];
      gradient.addColorStop(stop.pos, stop.css || hexAlpha(stop.color, stop.alpha !== undefined ? stop.alpha : 1));
    }
    gCtx.fillStyle = gradient;
    gCtx.fillRect(0, 0, w, h);

    // OPT: reuse srcCanvas as the output base — draw gradient + alpha mask on top
    const outCanvas = document.createElement("canvas");
    outCanvas.width = w; outCanvas.height = h;
    const oCtx = outCanvas.getContext("2d");

    oCtx.drawImage(srcCanvas, 0, 0);
    oCtx.globalCompositeOperation = gradDef.blendMode || "multiply";
    oCtx.globalAlpha = Math.max(0, Math.min(1, gradDef.opacity !== undefined ? gradDef.opacity : 1));
    oCtx.drawImage(gradCanvas, 0, 0);
    oCtx.globalCompositeOperation = "destination-in";
    oCtx.globalAlpha = 1;
    oCtx.drawImage(srcCanvas, 0, 0);
    oCtx.globalCompositeOperation = "source-over";

    return outCanvas;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // COSTUME RASTERISER
  // ════════════════════════════════════════════════════════════════════════════

  // OPT: WeakMap keyed on costume objects; Map values keyed by scale
  const rasterCache = new WeakMap();
  const rasterCacheEntries = new Set();

  function getRasterCacheEntry(costume) {
    let entry = rasterCache.get(costume);
    if (!entry) {
      entry = new Map();
      rasterCache.set(costume, entry);
      rasterCacheEntries.add(entry);
    }
    return entry;
  }

  function getCostumeListForTarget(target) {
    return (target && (target.sprite ? target.sprite.costumes_ : target.costumes_)) || [];
  }

  function clearCostumeRasterCache(costume) {
    const entry = costume ? rasterCache.get(costume) : null;
    if (entry) entry.clear();
  }

  function clearTargetRasterCache(target) {
    const costumes = getCostumeListForTarget(target);
    for (let i = 0; i < costumes.length; i++) clearCostumeRasterCache(costumes[i]);
  }

  function clearAllRasterCaches() {
    for (const entry of rasterCacheEntries) entry.clear();
  }

  function rasteriseCostume(costume, scale) {
    const asset = costume && costume.asset;
    if (!asset) return Promise.reject(new Error("No asset on costume"));

    const mimeType = asset.assetType && asset.assetType.contentType;
    const isSvg = mimeType === "image/svg+xml";
    const dpr = (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1;
    const autoScale = isSvg ? Math.max(4, dpr * 2) : Math.max(2, dpr);
    const finalScale = (typeof scale === "number" && scale > 0) ? scale : autoScale;

    const cache = getRasterCacheEntry(costume);
    // OPT: return cached promise immediately — avoids Blob/URL allocation on cache hit
    if (cache.has(finalScale)) return cache.get(finalScale);

    const promise = new Promise((resolve, reject) => {
      const img = new Image();
      // OPT: build Blob once, hold objectUrl until resolved/rejected
      const objectUrl = URL.createObjectURL(
        new Blob(
          [isSvg ? asset.decodeText() : asset.data],
          { type: mimeType || (isSvg ? "image/svg+xml" : "image/png") }
        )
      );

      const cleanup = () => { try { URL.revokeObjectURL(objectUrl); } catch (_) {} };

      img.onload = () => {
        try {
          const naturalW = img.naturalWidth  || img.width  || 1;
          const naturalH = img.naturalHeight || img.height || 1;
          const drawW = Math.max(1, Math.round(naturalW * finalScale));
          const drawH = Math.max(1, Math.round(naturalH * finalScale));

          const canvas = document.createElement("canvas");
          canvas.width  = drawW;
          canvas.height = drawH;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, drawW, drawH);

          const imageData = ctx.getImageData(0, 0, drawW, drawH);
          const result = { canvas, ctx, imageData, img, scale: finalScale };
          cache.set(finalScale, Promise.resolve(result));
          resolve(result);
        } catch (e) {
          cache.delete(finalScale);
          reject(e);
        } finally {
          cleanup();
        }
      };

      img.onerror = (e) => { cache.delete(finalScale); cleanup(); reject(e); };
      img.src = objectUrl;
    });

    cache.set(finalScale, promise);
    return promise;
  }


  // ════════════════════════════════════════════════════════════════════════════
  // CORE APPLY FUNCTION
  // ════════════════════════════════════════════════════════════════════════════

  async function applyToTarget(runtime, target, transformSpec, gradDef) {
    const renderer = runtime.renderer;
    if (!renderer) throw new Error("No renderer available");

    const costumeList = target.sprite ? target.sprite.costumes_ : target.costumes_;
    const costume = costumeList && costumeList[target.currentCostume];
    if (!costume) throw new Error("Could not find current costume");

    const { canvas: srcCanvas, imageData, scale } = await rasteriseCostume(
      costume, globalScaleOverride || undefined
    );

    let workCanvas;
    if (transformSpec) {
      const newImageData = processImageData(imageData, transformSpec);
      workCanvas = document.createElement("canvas");
      workCanvas.width  = newImageData.width;
      workCanvas.height = newImageData.height;
      workCanvas.getContext("2d", { willReadFrequently: true }).putImageData(newImageData, 0, 0);
    } else {
      workCanvas = srcCanvas;
    }

    const outCanvas = gradDef ? applyGradientToCanvas(workCanvas, gradDef) : workCanvas;
    const skinResolution = (costume.bitmapResolution || 1) * scale;
    const skinId = renderer.createBitmapSkin(outCanvas, skinResolution);
    renderer.updateDrawableSkinId(target.drawableID, skinId);
    return skinId;
  }

  // Wrapper that automatically merges any stored gradient for the target
  async function applyTransformToTarget(runtime, target, transformSpec) {
    const state = overlayState.get(target.id);
    const gradDef = (state && state.gradDef) ? state.gradDef : null;
    return applyToTarget(runtime, target, transformSpec, gradDef);
  }


  // ════════════════════════════════════════════════════════════════════════════
  // GLOBAL STATE
  // ════════════════════════════════════════════════════════════════════════════

  let globalScaleOverride = 0;

  // overlayState  :  targetId  →  { skinId, gradDef }
  const overlayState = new Map();

  function storeOverlay(target, newSkinId, gradDef) {
    const existing = overlayState.get(target.id);
    if (existing && existing.skinId) {
      try { Scratch.vm.runtime.renderer.destroySkin(existing.skinId); } catch (_) {}
    }
    overlayState.set(target.id, {
      skinId:  newSkinId,
      gradDef: gradDef !== undefined ? gradDef : (existing ? existing.gradDef : null),
    });
  }

  function restoreOriginalSkin(runtime, target) {
    const state = overlayState.get(target.id);
    if (!state) return;
    const renderer    = runtime.renderer;
    const costumeList = target.sprite ? target.sprite.costumes_ : target.costumes_;
    const costume     = costumeList && costumeList[target.currentCostume];
    if (costume && renderer) renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
    if (state.skinId && renderer) { try { renderer.destroySkin(state.skinId); } catch (_) {} }
    overlayState.delete(target.id);
  }

  // gradientPending  :  targetId  →  gradDef being assembled
  const gradientPending = new Map();

  function getPending(targetId) {
    if (!gradientPending.has(targetId)) {
      gradientPending.set(targetId, {
        type: "linear", angle: 90,
        cx: 50, cy: 50, r: 100,
        opacity: 1, blendMode: "multiply",
        stops: [],
      });
    }
    return gradientPending.get(targetId);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // EXTENSION CLASS
  // ════════════════════════════════════════════════════════════════════════════

  class CostumeColorFX {
    constructor(runtime) { this.runtime = runtime; }

    getInfo() {
      return {
        id: "ColourLabV2",
        name: "Colour Labv2",
        color1: "#7B4FE0",
        color2: "#5A35BD",
        blocks: [

          // ── SECTION 1 : Costume colour transforms ────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: "— Costume Effects —" },
          {
            opcode: "setHue",
            blockType: Scratch.BlockType.COMMAND,
            text: "rotate hue of [TARGET] by [DEGREES]°",
            arguments: {
              TARGET:  { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              DEGREES: { type: Scratch.ArgumentType.NUMBER, defaultValue: 90 },
            },
          },
          {
            opcode: "setSaturation",
            blockType: Scratch.BlockType.COMMAND,
            text: "set saturation of [TARGET] to [PERCENT]%",
            arguments: {
              TARGET:  { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              PERCENT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
            },
          },
          {
            opcode: "setBrightness",
            blockType: Scratch.BlockType.COMMAND,
            text: "multiply brightness of [TARGET] by [FACTOR]",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              FACTOR: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0.5 },
            },
          },
          {
            opcode: "tintColor",
            blockType: Scratch.BlockType.COMMAND,
            text: "tint [TARGET] with color [COLOR] strength [STRENGTH]%",
            arguments: {
              TARGET:   { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              COLOR:    { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
              STRENGTH: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
            },
          },
          {
            opcode: "swapColor",
            blockType: Scratch.BlockType.COMMAND,
            text: "swap color [FROM] → [TO] in [TARGET] tolerance [TOL]",
            arguments: {
              FROM:   { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
              TO:     { type: Scratch.ArgumentType.COLOR,  defaultValue: "#0000ff" },
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              TOL:    { type: Scratch.ArgumentType.NUMBER, defaultValue: 30 },
            },
          },
          {
            opcode: "setChannels",
            blockType: Scratch.BlockType.COMMAND,
            text: "multiply RGB channels of [TARGET] R:[R] G:[G] B:[B]",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              R: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1   },
              G: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0.5 },
              B: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0.5 },
            },
          },
          {
            opcode: "grayscale",
            blockType: Scratch.BlockType.COMMAND,
            text: "make [TARGET] grayscale",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
          },
          {
            opcode: "invert",
            blockType: Scratch.BlockType.COMMAND,
            text: "invert colors of [TARGET]",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
          },
          {
            opcode: "setAlpha",
            blockType: Scratch.BlockType.COMMAND,
            text: "set alpha of [TARGET] to [PERCENT]%",
            arguments: {
              TARGET:  { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              PERCENT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
            },
          },

          "---",
          // ── SECTION 2 : Gradients — full control ─────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: "— Gradients (Full Control) —" },
          {
            opcode: "gradSetType",
            blockType: Scratch.BlockType.COMMAND,
            text: "gradient on [TARGET]: type [TYPE] angle [ANGLE]°",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              TYPE:   { type: Scratch.ArgumentType.STRING, menu: "gradientType", defaultValue: "linear" },
              ANGLE:  { type: Scratch.ArgumentType.NUMBER, defaultValue: 90 },
            },
          },
          {
            opcode: "gradSetCenter",
            blockType: Scratch.BlockType.COMMAND,
            text: "gradient on [TARGET]: center X [CX]% Y [CY]% radius [R]%",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              CX: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50  },
              CY: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50  },
              R:  { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
            },
          },
          {
            opcode: "gradSetBlend",
            blockType: Scratch.BlockType.COMMAND,
            text: "gradient on [TARGET]: blend [BLEND] opacity [OPACITY]%",
            arguments: {
              TARGET:  { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              BLEND:   { type: Scratch.ArgumentType.STRING, menu: "blendMode", defaultValue: "multiply" },
              OPACITY: { type: Scratch.ArgumentType.NUMBER, defaultValue: 80 },
            },
          },
          {
            opcode: "gradAddStop",
            blockType: Scratch.BlockType.COMMAND,
            text: "gradient on [TARGET]: add stop color [COLOR] alpha [ALPHA]% at [POS]%",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              COLOR:  { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
              ALPHA:  { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
              POS:    { type: Scratch.ArgumentType.NUMBER, defaultValue: 0   },
            },
          },
          {
            opcode: "gradClearStops",
            blockType: Scratch.BlockType.COMMAND,
            text: "clear gradient stops on [TARGET]",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
          },
          {
            opcode: "gradApply",
            blockType: Scratch.BlockType.COMMAND,
            text: "apply gradient to [TARGET]",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
          },
          {
            opcode: "gradRemove",
            blockType: Scratch.BlockType.COMMAND,
            text: "remove gradient from [TARGET]",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
          },

          "---",
          // ── SECTION 3 : Gradients — quick shortcuts ───────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: "— Gradients (Quick) —" },
          {
            opcode: "gradLinearQuick",
            blockType: Scratch.BlockType.COMMAND,
            text: "linear gradient on [TARGET] [C1]→[C2] angle [ANGLE]° blend [BLEND] opacity [OPACITY]%",
            arguments: {
              TARGET:  { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              C1:      { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
              C2:      { type: Scratch.ArgumentType.COLOR,  defaultValue: "#0000ff" },
              ANGLE:   { type: Scratch.ArgumentType.NUMBER, defaultValue: 90 },
              BLEND:   { type: Scratch.ArgumentType.STRING, menu: "blendMode", defaultValue: "multiply" },
              OPACITY: { type: Scratch.ArgumentType.NUMBER, defaultValue: 80 },
            },
          },
          {
            opcode: "gradRadialQuick",
            blockType: Scratch.BlockType.COMMAND,
            text: "radial gradient on [TARGET] inner [C1] outer [C2] radius [R]% blend [BLEND] opacity [OPACITY]%",
            arguments: {
              TARGET:  { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              C1:      { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ffffff" },
              C2:      { type: Scratch.ArgumentType.COLOR,  defaultValue: "#000000" },
              R:       { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
              BLEND:   { type: Scratch.ArgumentType.STRING, menu: "blendMode", defaultValue: "multiply" },
              OPACITY: { type: Scratch.ArgumentType.NUMBER, defaultValue: 80 },
            },
          },
          {
            opcode: "gradRainbow",
            blockType: Scratch.BlockType.COMMAND,
            text: "rainbow gradient on [TARGET] angle [ANGLE]° opacity [OPACITY]%",
            arguments: {
              TARGET:  { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              ANGLE:   { type: Scratch.ArgumentType.NUMBER, defaultValue: 90 },
              OPACITY: { type: Scratch.ArgumentType.NUMBER, defaultValue: 70 },
            },
          },

          "---",
          // ── SECTION 4 : Utility ───────────────────────────────────────────────
          { blockType: Scratch.BlockType.LABEL, text: "— Costume Utility —" },
          {
            opcode: "resetColors",
            blockType: Scratch.BlockType.COMMAND,
            text: "reset colors of [TARGET]",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
          },
          {
            opcode: "setRenderQuality",
            blockType: Scratch.BlockType.COMMAND,
            text: "set render quality to [SCALE]x  (2=default  4=crisp  8=ultra)",
            arguments: { SCALE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 4 } },
          },
          {
            opcode: "clearSpriteCache",
            blockType: Scratch.BlockType.COMMAND,
            text: "clear cache of [TARGET]",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
          },
          {
            opcode: "clearAllSpriteCaches",
            blockType: Scratch.BlockType.COMMAND,
            text: "clear ALL sprite caches",
            arguments: {},
          },
          {
            opcode: "hasOverlay",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "[TARGET] has color override?",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
          },

          "---",
          // ══════════════════════════════════════════════════════════════════════
          // SECTION 5 : COLOR LAB — reporters & math
          // ══════════════════════════════════════════════════════════════════════
          { blockType: Scratch.BlockType.LABEL, text: "— Color Lab: Values —" },
          {
            opcode: "solidColor",
            blockType: Scratch.BlockType.REPORTER,
            text: "color [COLOR]",
            arguments: { COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: "#ff0000" } },
          },
          {
            opcode: "randomColor",
            blockType: Scratch.BlockType.REPORTER,
            text: "random color",
            arguments: {},
          },
          {
            opcode: "randomColorInRange",
            blockType: Scratch.BlockType.REPORTER,
            text: "random color between [C1] and [C2]",
            arguments: {
              C1: { type: Scratch.ArgumentType.COLOR, defaultValue: "#0000ff" },
              C2: { type: Scratch.ArgumentType.COLOR, defaultValue: "#ff0000" },
            },
          },
          {
            opcode: "randomHue",
            blockType: Scratch.BlockType.REPORTER,
            text: "random hue color  saturation [SAT]%  lightness [LIT]%",
            arguments: {
              SAT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
              LIT: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50  },
            },
          },

          "---",
          { blockType: Scratch.BlockType.LABEL, text: "— Color Lab: Math —" },
          {
            opcode: "blendColors",
            blockType: Scratch.BlockType.REPORTER,
            text: "blend [C1] and [C2] by [T]%",
            arguments: {
              C1: { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
              C2: { type: Scratch.ArgumentType.COLOR,  defaultValue: "#0000ff" },
              T:  { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
            },
          },
          {
            opcode: "addColors",
            blockType: Scratch.BlockType.REPORTER,
            text: "add [C1] + [C2]",
            arguments: {
              C1: { type: Scratch.ArgumentType.COLOR, defaultValue: "#220000" },
              C2: { type: Scratch.ArgumentType.COLOR, defaultValue: "#002200" },
            },
          },
          {
            opcode: "subtractColors",
            blockType: Scratch.BlockType.REPORTER,
            text: "subtract [C1] − [C2]",
            arguments: {
              C1: { type: Scratch.ArgumentType.COLOR, defaultValue: "#ff8800" },
              C2: { type: Scratch.ArgumentType.COLOR, defaultValue: "#220000" },
            },
          },
          {
            opcode: "multiplyColor",
            blockType: Scratch.BlockType.REPORTER,
            text: "multiply [COLOR] by [FACTOR]",
            arguments: {
              COLOR:  { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
              FACTOR: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0.5 },
            },
          },
          {
            opcode: "invertColor",
            blockType: Scratch.BlockType.REPORTER,
            text: "invert [COLOR]",
            arguments: { COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: "#ff0000" } },
          },
          {
            opcode: "shiftHue",
            blockType: Scratch.BlockType.REPORTER,
            text: "shift hue of [COLOR] by [DEG]°",
            arguments: {
              COLOR: { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
              DEG:   { type: Scratch.ArgumentType.NUMBER, defaultValue: 120 },
            },
          },
          {
            opcode: "setSaturationOf",
            blockType: Scratch.BlockType.REPORTER,
            text: "set saturation of [COLOR] to [SAT]%",
            arguments: {
              COLOR: { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
              SAT:   { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
            },
          },
          {
            opcode: "setLightnessOf",
            blockType: Scratch.BlockType.REPORTER,
            text: "set lightness of [COLOR] to [LIT]%",
            arguments: {
              COLOR: { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
              LIT:   { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
            },
          },

          "---",
          { blockType: Scratch.BlockType.LABEL, text: "— Color Lab: Channel Readers —" },
          {
            opcode: "getChannel",
            blockType: Scratch.BlockType.REPORTER,
            text: "[CHANNEL] of [COLOR]",
            arguments: {
              CHANNEL: { type: Scratch.ArgumentType.STRING, menu: "channel", defaultValue: "red" },
              COLOR:   { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff8800" },
            },
          },
          {
            opcode: "getHue",
            blockType: Scratch.BlockType.REPORTER,
            text: "hue of [COLOR]  (0–360)",
            arguments: { COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: "#ff0000" } },
          },
          {
            opcode: "getSaturation",
            blockType: Scratch.BlockType.REPORTER,
            text: "saturation of [COLOR]  (0–100)",
            arguments: { COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: "#ff0000" } },
          },
          {
            opcode: "getLightness",
            blockType: Scratch.BlockType.REPORTER,
            text: "lightness of [COLOR]  (0–100)",
            arguments: { COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: "#ff0000" } },
          },

          "---",
          { blockType: Scratch.BlockType.LABEL, text: "— Color Lab: Build & Compare —" },
          {
            opcode: "colorFromRGB",
            blockType: Scratch.BlockType.REPORTER,
            text: "color from R:[R] G:[G] B:[B]",
            arguments: {
              R: { type: Scratch.ArgumentType.NUMBER, defaultValue: 255 },
              G: { type: Scratch.ArgumentType.NUMBER, defaultValue: 128 },
              B: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0   },
            },
          },
          {
            opcode: "colorFromHSL",
            blockType: Scratch.BlockType.REPORTER,
            text: "color from H:[H]° S:[S]% L:[L]%",
            arguments: {
              H: { type: Scratch.ArgumentType.NUMBER, defaultValue: 30  },
              S: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
              L: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50  },
            },
          },
          {
            opcode: "colorsEqual",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "[C1] = [C2]  (tolerance [TOL])",
            arguments: {
              C1:  { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
              C2:  { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
              TOL: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
            },
          },
          {
            opcode: "colorDistance",
            blockType: Scratch.BlockType.REPORTER,
            text: "distance between [C1] and [C2]",
            arguments: {
              C1: { type: Scratch.ArgumentType.COLOR, defaultValue: "#ff0000" },
              C2: { type: Scratch.ArgumentType.COLOR, defaultValue: "#0000ff" },
            },
          },
          {
            opcode: "complementColor",
            blockType: Scratch.BlockType.REPORTER,
            text: "complement of [COLOR]",
            arguments: { COLOR: { type: Scratch.ArgumentType.COLOR, defaultValue: "#ff0000" } },
          },
        ],

        menus: {
          gradientType: {
            acceptReporters: true,
            items: ["linear", "radial", "conic"],
          },
          blendMode: {
            acceptReporters: true,
            items: [
              "multiply", "screen", "overlay", "color",
              "hue", "saturation", "luminosity",
              "hard-light", "soft-light", "color-dodge", "color-burn",
              "source-over",
            ],
          },
          channel: {
            acceptReporters: true,
            items: ["red", "green", "blue"],
          },
        },
      };
    }

    // ── Target resolution ──────────────────────────────────────────────────────
    _resolveTarget(args, util) {
      const name = args.TARGET;
      if (!name || name === "_myself_") return util.target;
      if (name === "_stage_") return this.runtime.getTargetForStage();
      return this.runtime.getSpriteTargetByName(name) || util.target;
    }

    // ════════════════════════════════════════════════════════════════════════════
    // SECTION 1 IMPLEMENTATIONS — Costume colour transforms
    // ════════════════════════════════════════════════════════════════════════════

    async setHue(args, util) {
      const target = this._resolveTarget(args, util);
      const deg = Number(args.DEGREES) || 0;
      const skinId = await applyTransformToTarget(this.runtime, target, { kind: "hue", deg });
      storeOverlay(target, skinId);
    }

    async setSaturation(args, util) {
      const target = this._resolveTarget(args, util);
      const pct = Math.max(0, Math.min(100, Number(args.PERCENT)));
      const skinId = await applyTransformToTarget(this.runtime, target, { kind: "saturation", pct });
      storeOverlay(target, skinId);
    }

    async setBrightness(args, util) {
      const target = this._resolveTarget(args, util);
      const factor = Number(args.FACTOR);
      const skinId = await applyTransformToTarget(this.runtime, target, { kind: "brightness", factor });
      storeOverlay(target, skinId);
    }

    async tintColor(args, util) {
      const target = this._resolveTarget(args, util);
      const [tr, tg, tb] = hexToRgb(args.COLOR);
      const strength = Math.max(0, Math.min(100, Number(args.STRENGTH))) / 100;
      const skinId = await applyTransformToTarget(this.runtime, target, {
        kind: "tint", tr, tg, tb, strength,
      });
      storeOverlay(target, skinId);
    }

    async swapColor(args, util) {
      const target = this._resolveTarget(args, util);
      const [fr, fg, fb] = hexToRgb(args.FROM);
      const [tr, tg, tb] = hexToRgb(args.TO);
      const tol = Number(args.TOL) || 30;
      const skinId = await applyTransformToTarget(this.runtime, target, {
        kind: "swap", fr, fg, fb, tr, tg, tb, tol, tolSq: tol * tol,
      });
      storeOverlay(target, skinId);
    }

    async setChannels(args, util) {
      const target = this._resolveTarget(args, util);
      const skinId = await applyTransformToTarget(this.runtime, target, {
        kind: "channels",
        mr: Number(args.R),
        mg: Number(args.G),
        mb: Number(args.B),
      });
      storeOverlay(target, skinId);
    }

    async grayscale(args, util) {
      const target = this._resolveTarget(args, util);
      const skinId = await applyTransformToTarget(this.runtime, target, { kind: "grayscale" });
      storeOverlay(target, skinId);
    }

    async invert(args, util) {
      const target = this._resolveTarget(args, util);
      const skinId = await applyTransformToTarget(this.runtime, target, { kind: "invert" });
      storeOverlay(target, skinId);
    }

    async setAlpha(args, util) {
      const target = this._resolveTarget(args, util);
      const pct = Math.max(0, Math.min(100, Number(args.PERCENT))) / 100;
      const skinId = await applyTransformToTarget(this.runtime, target, { kind: "alpha", pct });
      storeOverlay(target, skinId);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // SECTION 2 IMPLEMENTATIONS — Gradients full control
    // ════════════════════════════════════════════════════════════════════════════

    gradSetType(args, util) {
      const def = getPending(this._resolveTarget(args, util).id);
      def.type  = String(args.TYPE).toLowerCase();
      def.angle = Number(args.ANGLE) || 0;
    }

    gradSetCenter(args, util) {
      const def = getPending(this._resolveTarget(args, util).id);
      def.cx = Number(args.CX); def.cy = Number(args.CY); def.r = Number(args.R);
    }

    gradSetBlend(args, util) {
      const def = getPending(this._resolveTarget(args, util).id);
      def.blendMode = String(args.BLEND);
      def.opacity   = Math.max(0, Math.min(100, Number(args.OPACITY))) / 100;
    }

    gradAddStop(args, util) {
      const def = getPending(this._resolveTarget(args, util).id);
      def.stops.push(normalizeGradientStop({
        color: args.COLOR,
        alpha: Math.max(0, Math.min(100, Number(args.ALPHA))) / 100,
        pos:   Math.max(0, Math.min(100, Number(args.POS)))   / 100,
      }));
      def.stops.sort((a, b) => a.pos - b.pos);
    }

    gradClearStops(args, util) {
      getPending(this._resolveTarget(args, util).id).stops = [];
    }

    async gradApply(args, util) {
      const target = this._resolveTarget(args, util);
      const def = getPending(target.id);
      if (def.stops.length < 2) {
        console.warn("Costume Color FX: gradient needs at least 2 stops.");
        return;
      }
      // OPT: stops are already normalized when added via gradAddStop — no double-normalize
      const skinId = await applyToTarget(this.runtime, target, null, def);
      storeOverlay(target, skinId, JSON.parse(JSON.stringify(def)));
    }

    gradRemove(args, util) {
      const target = this._resolveTarget(args, util);
      const state = overlayState.get(target.id);
      if (state) { state.gradDef = null; restoreOriginalSkin(this.runtime, target); }
    }

    // ════════════════════════════════════════════════════════════════════════════
    // SECTION 3 IMPLEMENTATIONS — Gradients quick
    // ════════════════════════════════════════════════════════════════════════════

    async gradLinearQuick(args, util) {
      const target = this._resolveTarget(args, util);
      const def = {
        type: "linear", angle: Number(args.ANGLE) || 0,
        opacity: Math.max(0, Math.min(100, Number(args.OPACITY))) / 100,
        blendMode: String(args.BLEND),
        stops: [
          normalizeGradientStop({ color: args.C1, alpha: 1, pos: 0 }),
          normalizeGradientStop({ color: args.C2, alpha: 1, pos: 1 }),
        ],
      };
      storeOverlay(target, await applyToTarget(this.runtime, target, null, def), def);
    }

    async gradRadialQuick(args, util) {
      const target = this._resolveTarget(args, util);
      const def = {
        type: "radial", cx: 50, cy: 50, r: Math.max(1, Number(args.R)),
        opacity: Math.max(0, Math.min(100, Number(args.OPACITY))) / 100,
        blendMode: String(args.BLEND),
        stops: [
          normalizeGradientStop({ color: args.C1, alpha: 1, pos: 0 }),
          normalizeGradientStop({ color: args.C2, alpha: 1, pos: 1 }),
        ],
      };
      storeOverlay(target, await applyToTarget(this.runtime, target, null, def), def);
    }

    async gradRainbow(args, util) {
      const target = this._resolveTarget(args, util);
      const def = {
        type: "linear", angle: Number(args.ANGLE) || 0,
        opacity: Math.max(0, Math.min(100, Number(args.OPACITY))) / 100,
        blendMode: "multiply",
        stops: [
          normalizeGradientStop({ color: "#ff0000", alpha: 1, pos: 0    }),
          normalizeGradientStop({ color: "#ff8800", alpha: 1, pos: 0.17 }),
          normalizeGradientStop({ color: "#ffff00", alpha: 1, pos: 0.33 }),
          normalizeGradientStop({ color: "#00cc00", alpha: 1, pos: 0.5  }),
          normalizeGradientStop({ color: "#0000ff", alpha: 1, pos: 0.67 }),
          normalizeGradientStop({ color: "#8800cc", alpha: 1, pos: 0.83 }),
          normalizeGradientStop({ color: "#ff0099", alpha: 1, pos: 1    }),
        ],
      };
      storeOverlay(target, await applyToTarget(this.runtime, target, null, def), def);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // SECTION 4 IMPLEMENTATIONS — Utility
    // ════════════════════════════════════════════════════════════════════════════

    setRenderQuality(args) {
      globalScaleOverride = Number(args.SCALE) > 0 ? Number(args.SCALE) : 0;
    }

    clearSpriteCache(args, util) {
      clearTargetRasterCache(this._resolveTarget(args, util));
    }

    clearAllSpriteCaches() {
      clearAllRasterCaches();
    }

    resetColors(args, util) {
      const target = this._resolveTarget(args, util);
      gradientPending.delete(target.id);
      restoreOriginalSkin(this.runtime, target);
    }

    hasOverlay(args, util) {
      return overlayState.has(this._resolveTarget(args, util).id);
    }

    // ════════════════════════════════════════════════════════════════════════════
    // SECTION 5 IMPLEMENTATIONS — Color Lab (reporters)
    // ════════════════════════════════════════════════════════════════════════════

    solidColor(args) { return String(args.COLOR); }

    randomColor() {
      // OPT: generate one 24-bit int, split — fewer Math.random() calls
      const n = (Math.random() * 0x1000000) | 0;
      return "#" + _hexLUT[(n >> 16) & 255] + _hexLUT[(n >> 8) & 255] + _hexLUT[n & 255];
    }

    randomColorInRange(args) {
      const [r1, g1, b1] = hexToRgb(args.C1);
      const [r2, g2, b2] = hexToRgb(args.C2);
      const t = Math.random();
      return rgbToHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
    }

    randomHue(args) {
      const h = Math.random() * 360;
      const s = Math.max(0, Math.min(100, Number(args.SAT)));
      const l = Math.max(0, Math.min(100, Number(args.LIT)));
      const [r, g, b] = hslToRgb(h, s, l);
      return rgbToHex(r, g, b);
    }

    blendColors(args) {
      const [r1, g1, b1] = hexToRgb(args.C1);
      const [r2, g2, b2] = hexToRgb(args.C2);
      const t = Math.max(0, Math.min(100, Number(args.T))) / 100;
      return rgbToHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
    }

    addColors(args) {
      const [r1, g1, b1] = hexToRgb(args.C1);
      const [r2, g2, b2] = hexToRgb(args.C2);
      return rgbToHex(r1+r2, g1+g2, b1+b2);
    }

    subtractColors(args) {
      const [r1, g1, b1] = hexToRgb(args.C1);
      const [r2, g2, b2] = hexToRgb(args.C2);
      return rgbToHex(r1-r2, g1-g2, b1-b2);
    }

    multiplyColor(args) {
      const [r, g, b] = hexToRgb(args.COLOR);
      const f = Number(args.FACTOR);
      return rgbToHex(r*f, g*f, b*f);
    }

    invertColor(args) {
      const [r, g, b] = hexToRgb(args.COLOR);
      return rgbToHex(255-r, 255-g, 255-b);
    }

    shiftHue(args) {
      const [r, g, b] = hexToRgb(args.COLOR);
      let [h, s, l] = rgbToHsl(r, g, b);
      h = ((h + Number(args.DEG)) % 360 + 360) % 360;
      const [nr, ng, nb] = hslToRgb(h, s, l);
      return rgbToHex(nr, ng, nb);
    }

    setSaturationOf(args) {
      const [r, g, b] = hexToRgb(args.COLOR);
      const [h, , l] = rgbToHsl(r, g, b);
      const s = Math.max(0, Math.min(100, Number(args.SAT)));
      const [nr, ng, nb] = hslToRgb(h, s, l);
      return rgbToHex(nr, ng, nb);
    }

    setLightnessOf(args) {
      const [r, g, b] = hexToRgb(args.COLOR);
      const [h, s] = rgbToHsl(r, g, b);
      const l = Math.max(0, Math.min(100, Number(args.LIT)));
      const [nr, ng, nb] = hslToRgb(h, s, l);
      return rgbToHex(nr, ng, nb);
    }

    getChannel(args) {
      const [r, g, b] = hexToRgb(args.COLOR);
      const ch = String(args.CHANNEL).toLowerCase();
      if (ch === "red")   return r;
      if (ch === "green") return g;
      if (ch === "blue")  return b;
      return 0;
    }

    getHue(args) {
      const [r, g, b] = hexToRgb(args.COLOR);
      return Math.round(rgbToHsl(r, g, b)[0]);
    }

    getSaturation(args) {
      const [r, g, b] = hexToRgb(args.COLOR);
      return Math.round(rgbToHsl(r, g, b)[1]);
    }

    getLightness(args) {
      const [r, g, b] = hexToRgb(args.COLOR);
      return Math.round(rgbToHsl(r, g, b)[2]);
    }

    colorFromRGB(args) {
      return rgbToHex(Number(args.R), Number(args.G), Number(args.B));
    }

    colorFromHSL(args) {
      const [r, g, b] = hslToRgb(
        Number(args.H),
        Math.max(0, Math.min(100, Number(args.S))),
        Math.max(0, Math.min(100, Number(args.L)))
      );
      return rgbToHex(r, g, b);
    }

    colorsEqual(args) {
      const [r1, g1, b1] = hexToRgb(args.C1);
      const [r2, g2, b2] = hexToRgb(args.C2);
      const tol = Math.max(0, Number(args.TOL));
      // OPT: compare squared distances to avoid sqrt when tol === 0
      const dSq = (r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2;
      return tol === 0 ? dSq === 0 : dSq <= tol * tol;
    }

    colorDistance(args) {
      const [r1, g1, b1] = hexToRgb(args.C1);
      const [r2, g2, b2] = hexToRgb(args.C2);
      return Math.round(Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2));
    }

    complementColor(args) {
      const [r, g, b] = hexToRgb(args.COLOR);
      let [h, s, l] = rgbToHsl(r, g, b);
      h = (h + 180) % 360;
      const [nr, ng, nb] = hslToRgb(h, s, l);
      return rgbToHex(nr, ng, nb);
    }
  }

  Scratch.extensions.register(new CostumeColorFX(Scratch.vm.runtime));
})(Scratch);
