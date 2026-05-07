// Name: Costume Color FX
// Description: Modify costume color data at runtime without permanently changing costumes. Supports hue rotation, saturation, brightness, tinting, palette swaps, per-channel adjustments, and gradients.
// By: Claude
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Costume Color FX must run unsandboxed.");
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function hexToRgb(hex) {
    hex = hex.replace(/^#/, "");
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
        case g: h = ((b - r) / d + 2) / 6; break;
        case b: h = ((r - g) / d + 4) / 6; break;
      }
    }
    return [h * 360, s * 100, l * 100];
  }

  function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1/6) return p + (q - p) * 6 * t;
        if (t < 1/2) return q;
        if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1/3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1/3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  // ─── Pixel-level transform ───────────────────────────────────────────────────

  function processImageData(imageData, transformFn) {
    const src = imageData.data;
    const out = new ImageData(imageData.width, imageData.height);
    const dst = out.data;
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3];
      if (a === 0) { dst[i+3] = 0; continue; }
      const [nr, ng, nb, na] = transformFn(src[i], src[i+1], src[i+2], a);
      dst[i]   = clamp255(nr);
      dst[i+1] = clamp255(ng);
      dst[i+2] = clamp255(nb);
      dst[i+3] = clamp255(na !== undefined ? na : a);
    }
    return out;
  }

  // ─── Gradient compositing ────────────────────────────────────────────────────

  function hexAlpha(hexColor, alpha) {
    const [r, g, b] = hexToRgb(hexColor);
    return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
  }

  /**
   * Paint a gradient over srcCanvas using the given gradDef.
   * The costume's original alpha mask is preserved so transparent areas stay transparent.
   *
   * gradDef shape:
   *   type      : "linear" | "radial" | "conic"
   *   angle     : degrees (linear: direction, conic: start angle)
   *   cx, cy    : center percent 0-100   (radial / conic)
   *   r         : radius percent 0-100   (radial)
   *   stops     : [{ color, alpha 0-1, pos 0-1 }, ...]  sorted by pos
   *   blendMode : CSS composite operation string
   *   opacity   : 0-1
   */
  function applyGradientToCanvas(srcCanvas, gradDef) {
    const w = srcCanvas.width, h = srcCanvas.height;

    // 1. Build the gradient on its own canvas
    const gradCanvas = document.createElement("canvas");
    gradCanvas.width = w; gradCanvas.height = h;
    const gCtx = gradCanvas.getContext("2d");

    let gradient;
    const { type, angle, stops, cx, cy, r: gradR } = gradDef;

    if (type === "radial") {
      const px = ((cx !== undefined ? cx : 50) / 100) * w;
      const py = ((cy !== undefined ? cy : 50) / 100) * h;
      const maxR = Math.sqrt(w * w + h * h) / 2;
      const radius = Math.max(1, ((gradR !== undefined ? gradR : 100) / 100) * maxR);
      gradient = gCtx.createRadialGradient(px, py, 0, px, py, radius);
    } else if (type === "conic") {
      const px = ((cx !== undefined ? cx : 50) / 100) * w;
      const py = ((cy !== undefined ? cy : 50) / 100) * h;
      const startRad = ((angle || 0) - 90) * (Math.PI / 180);
      if (typeof gCtx.createConicGradient === "function") {
        gradient = gCtx.createConicGradient(startRad, px, py);
      } else {
        // Fallback: linear if conic unsupported
        gradient = gCtx.createLinearGradient(0, 0, w, 0);
      }
    } else {
      // linear (default)
      const rad = ((angle || 0) - 90) * (Math.PI / 180);
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const halfLen = (Math.abs(cos) * h + Math.abs(sin) * w) / 2;
      const mx = w / 2, my = h / 2;
      gradient = gCtx.createLinearGradient(
        mx - cos * halfLen, my - sin * halfLen,
        mx + cos * halfLen, my + sin * halfLen
      );
    }

    for (const stop of stops) {
      gradient.addColorStop(
        Math.max(0, Math.min(1, stop.pos)),
        hexAlpha(stop.color, stop.alpha !== undefined ? stop.alpha : 1)
      );
    }
    gCtx.fillStyle = gradient;
    gCtx.fillRect(0, 0, w, h);

    // 2. Composite: draw costume, then paint gradient with blend mode on top
    const outCanvas = document.createElement("canvas");
    outCanvas.width = w; outCanvas.height = h;
    const oCtx = outCanvas.getContext("2d");

    oCtx.drawImage(srcCanvas, 0, 0);

    oCtx.globalCompositeOperation = gradDef.blendMode || "multiply";
    oCtx.globalAlpha = Math.max(0, Math.min(1, gradDef.opacity !== undefined ? gradDef.opacity : 1));
    oCtx.drawImage(gradCanvas, 0, 0);
    oCtx.globalCompositeOperation = "source-over";
    oCtx.globalAlpha = 1;

    // 3. Restore the original alpha mask so transparent pixels stay transparent
    oCtx.globalCompositeOperation = "destination-in";
    oCtx.drawImage(srcCanvas, 0, 0);
    oCtx.globalCompositeOperation = "source-over";

    return outCanvas;
  }

  // ─── Costume rasteriser ──────────────────────────────────────────────────────

  function rasteriseCostume(costume, scale) {
    return new Promise((resolve, reject) => {
      const asset = costume.asset;
      if (!asset) return reject(new Error("No asset on costume"));

      const mimeType = asset.assetType && asset.assetType.contentType;
      const isSvg = mimeType === "image/svg+xml";

      const img = new Image();
      img.onload = () => {
        const naturalW = img.naturalWidth  || img.width  || 1;
        const naturalH = img.naturalHeight || img.height || 1;

        const dpr = (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1;
        const autoScale = isSvg ? Math.max(4, dpr * 2) : Math.max(2, dpr);
        const finalScale = (typeof scale === "number" && scale > 0) ? scale : autoScale;

        const drawW = Math.round(naturalW * finalScale);
        const drawH = Math.round(naturalH * finalScale);

        const canvas = document.createElement("canvas");
        canvas.width = drawW; canvas.height = drawH;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, drawW, drawH);

        try {
          const imageData = ctx.getImageData(0, 0, drawW, drawH);
          resolve({ canvas, ctx, imageData, img, scale: finalScale });
        } catch (e) { reject(e); }
      };
      img.onerror = reject;

      if (isSvg) {
        const blob = new Blob([asset.decodeText()], { type: "image/svg+xml" });
        img.src = URL.createObjectURL(blob);
      } else {
        const blob = new Blob([asset.data], { type: mimeType || "image/png" });
        img.src = URL.createObjectURL(blob);
      }
    });
  }

  // ─── Core apply function ─────────────────────────────────────────────────────

  /**
   * Rasterise the current costume, run an optional pixel transform, apply
   * an optional gradient, then push the result as a BitmapSkin overlay.
   *
   * transformFn : (r,g,b,a)=>[r,g,b,a] | null
   * gradDef     : gradient definition object | null
   */
  async function applyToTarget(runtime, target, transformFn, gradDef) {
    const renderer = runtime.renderer;
    if (!renderer) throw new Error("No renderer available");

    const costumeIndex = target.currentCostume;
    const costumeList  = target.sprite ? target.sprite.costumes_ : target.costumes_;
    const costume      = costumeList && costumeList[costumeIndex];
    if (!costume) throw new Error("Could not find current costume");

    const { canvas: srcCanvas, imageData, scale } = await rasteriseCostume(
      costume, globalScaleOverride || undefined
    );

    // Pixel transform
    let workCanvas;
    if (transformFn) {
      const newImageData = processImageData(imageData, transformFn);
      workCanvas = document.createElement("canvas");
      workCanvas.width = newImageData.width; workCanvas.height = newImageData.height;
      workCanvas.getContext("2d").putImageData(newImageData, 0, 0);
    } else {
      workCanvas = srcCanvas;
    }

    // Gradient composite
    const outCanvas = gradDef ? applyGradientToCanvas(workCanvas, gradDef) : workCanvas;

    const skinResolution = (costume.bitmapResolution || 1) * scale;
    const skinId = renderer.createBitmapSkin(outCanvas, skinResolution);
    renderer.updateDrawableSkinId(target.drawableID, skinId);
    return skinId;
  }

  // Wrapper for colour-transform blocks: merges stored gradient automatically
  async function applyTransformToTarget(runtime, target, transformFn) {
    const state = overlayState.get(target.id);
    const gradDef = (state && state.gradDef) ? state.gradDef : null;
    return applyToTarget(runtime, target, transformFn, gradDef);
  }

  // ─── Global state ────────────────────────────────────────────────────────────

  let globalScaleOverride = 0;

  // overlayState : targetId → { skinId, gradDef }
  const overlayState = new Map();

  function storeOverlay(target, newSkinId, gradDef) {
    const existing = overlayState.get(target.id);
    if (existing && existing.skinId) {
      try { Scratch.vm.runtime.renderer.destroySkin(existing.skinId); } catch (_) {}
    }
    overlayState.set(target.id, {
      skinId: newSkinId,
      gradDef: gradDef !== undefined ? gradDef : (existing ? existing.gradDef : null),
    });
  }

  function restoreOriginalSkin(runtime, target) {
    const state = overlayState.get(target.id);
    if (!state) return;
    const renderer = runtime.renderer;
    const costumeList = target.sprite ? target.sprite.costumes_ : target.costumes_;
    const costume     = costumeList && costumeList[target.currentCostume];
    if (costume && renderer) renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
    if (state.skinId && renderer) { try { renderer.destroySkin(state.skinId); } catch (_) {} }
    overlayState.delete(target.id);
  }

  // gradientPending : targetId → gradDef being built
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

  // ─── Extension ───────────────────────────────────────────────────────────────

  class CostumeColorFX {
    constructor(runtime) { this.runtime = runtime; }

    getInfo() {
      return {
        id: "costumeColourGradientFX",
        name: "Costume Color and Gradient FX",
        color1: "#7B4FE0",
        color2: "#5A35BD",
        blocks: [

          // ── Colour transforms ──────────────────────────────────────────────
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
              R: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 },
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
          // ── Gradient — full control ────────────────────────────────────────
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
              CX: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
              CY: { type: Scratch.ArgumentType.NUMBER, defaultValue: 50 },
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
              POS:    { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
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
          // ── Gradient — quick one-liners ────────────────────────────────────
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
          // ── Utility ────────────────────────────────────────────────────────
          {
            opcode: "resetColors",
            blockType: Scratch.BlockType.COMMAND,
            text: "reset colors of [TARGET]",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
          },
          {
            opcode: "setRenderQuality",
            blockType: Scratch.BlockType.COMMAND,
            text: "set render quality to [SCALE]x (2=default, 4=crisp, 8=ultra)",
            arguments: { SCALE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 4 } },
          },
          {
            opcode: "hasOverlay",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "[TARGET] has color override?",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
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
        },
      };
    }

    // ── Target resolution ────────────────────────────────────────────────────────
    _resolveTarget(args, util) {
      const name = args.TARGET;
      if (!name || name === "_myself_") return util.target;
      if (name === "_stage_") return this.runtime.getTargetForStage();
      return this.runtime.getSpriteTargetByName(name) || util.target;
    }

    // ── Colour transforms ────────────────────────────────────────────────────────

    async setHue(args, util) {
      const target = this._resolveTarget(args, util);
      const deg = Number(args.DEGREES) || 0;
      const skinId = await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        let [h, s, l] = rgbToHsl(r, g, b);
        h = ((h + deg) % 360 + 360) % 360;
        const [nr, ng, nb] = hslToRgb(h, s, l);
        return [nr, ng, nb, a];
      });
      storeOverlay(target, skinId);
    }

    async setSaturation(args, util) {
      const target = this._resolveTarget(args, util);
      const pct = Math.max(0, Number(args.PERCENT)) / 100;
      const skinId = await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        const [h, , l] = rgbToHsl(r, g, b);
        const [nr, ng, nb] = hslToRgb(h, pct * 100, l);
        return [nr, ng, nb, a];
      });
      storeOverlay(target, skinId);
    }

    async setBrightness(args, util) {
      const target = this._resolveTarget(args, util);
      const factor = Number(args.FACTOR);
      const skinId = await applyTransformToTarget(this.runtime, target, (r, g, b, a) =>
        [r * factor, g * factor, b * factor, a]
      );
      storeOverlay(target, skinId);
    }

    async tintColor(args, util) {
      const target = this._resolveTarget(args, util);
      const [tr, tg, tb] = hexToRgb(args.COLOR);
      const s = Math.max(0, Math.min(100, Number(args.STRENGTH))) / 100;
      const skinId = await applyTransformToTarget(this.runtime, target, (r, g, b, a) =>
        [r + (tr - r) * s, g + (tg - g) * s, b + (tb - b) * s, a]
      );
      storeOverlay(target, skinId);
    }

    async swapColor(args, util) {
      const target = this._resolveTarget(args, util);
      const [fr, fg, fb] = hexToRgb(args.FROM);
      const [tr, tg, tb] = hexToRgb(args.TO);
      const tol = Number(args.TOL) || 30;
      const skinId = await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        const dr = r - fr, dg = g - fg, db = b - fb;
        const dist = Math.sqrt(dr*dr + dg*dg + db*db);
        if (dist <= tol) {
          const blend = 1 - dist / tol;
          return [r + (tr - fr) * blend, g + (tg - fg) * blend, b + (tb - fb) * blend, a];
        }
        return [r, g, b, a];
      });
      storeOverlay(target, skinId);
    }

    async setChannels(args, util) {
      const target = this._resolveTarget(args, util);
      const mr = Number(args.R), mg = Number(args.G), mb = Number(args.B);
      const skinId = await applyTransformToTarget(this.runtime, target, (r, g, b, a) =>
        [r * mr, g * mg, b * mb, a]
      );
      storeOverlay(target, skinId);
    }

    async grayscale(args, util) {
      const target = this._resolveTarget(args, util);
      const skinId = await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        return [gray, gray, gray, a];
      });
      storeOverlay(target, skinId);
    }

    async invert(args, util) {
      const target = this._resolveTarget(args, util);
      const skinId = await applyTransformToTarget(this.runtime, target, (r, g, b, a) =>
        [255 - r, 255 - g, 255 - b, a]
      );
      storeOverlay(target, skinId);
    }

    async setAlpha(args, util) {
      const target = this._resolveTarget(args, util);
      const pct = Math.max(0, Math.min(100, Number(args.PERCENT))) / 100;
      const skinId = await applyTransformToTarget(this.runtime, target, (r, g, b, a) =>
        [r, g, b, a * pct]
      );
      storeOverlay(target, skinId);
    }

    // ── Gradient — full control ──────────────────────────────────────────────────

    gradSetType(args, util) {
      const target = this._resolveTarget(args, util);
      const def = getPending(target.id);
      def.type  = String(args.TYPE).toLowerCase();
      def.angle = Number(args.ANGLE) || 0;
    }

    gradSetCenter(args, util) {
      const target = this._resolveTarget(args, util);
      const def = getPending(target.id);
      def.cx = Number(args.CX);
      def.cy = Number(args.CY);
      def.r  = Number(args.R);
    }

    gradSetBlend(args, util) {
      const target = this._resolveTarget(args, util);
      const def = getPending(target.id);
      def.blendMode = String(args.BLEND);
      def.opacity   = Math.max(0, Math.min(100, Number(args.OPACITY))) / 100;
    }

    gradAddStop(args, util) {
      const target = this._resolveTarget(args, util);
      const def = getPending(target.id);
      def.stops.push({
        color: args.COLOR,
        alpha: Math.max(0, Math.min(100, Number(args.ALPHA))) / 100,
        pos:   Math.max(0, Math.min(100, Number(args.POS)))   / 100,
      });
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
      const skinId = await applyToTarget(this.runtime, target, null, def);
      storeOverlay(target, skinId, JSON.parse(JSON.stringify(def)));
    }

    gradRemove(args, util) {
      const target = this._resolveTarget(args, util);
      const state = overlayState.get(target.id);
      if (state) {
        state.gradDef = null;
        restoreOriginalSkin(this.runtime, target);
      }
    }

    // ── Gradient — quick shortcuts ───────────────────────────────────────────────

    async gradLinearQuick(args, util) {
      const target = this._resolveTarget(args, util);
      const def = {
        type: "linear",
        angle: Number(args.ANGLE) || 0,
        opacity: Math.max(0, Math.min(100, Number(args.OPACITY))) / 100,
        blendMode: String(args.BLEND),
        stops: [
          { color: args.C1, alpha: 1, pos: 0 },
          { color: args.C2, alpha: 1, pos: 1 },
        ],
      };
      const skinId = await applyToTarget(this.runtime, target, null, def);
      storeOverlay(target, skinId, def);
    }

    async gradRadialQuick(args, util) {
      const target = this._resolveTarget(args, util);
      const def = {
        type: "radial",
        cx: 50, cy: 50,
        r: Math.max(1, Number(args.R)),
        opacity: Math.max(0, Math.min(100, Number(args.OPACITY))) / 100,
        blendMode: String(args.BLEND),
        stops: [
          { color: args.C1, alpha: 1, pos: 0 },
          { color: args.C2, alpha: 1, pos: 1 },
        ],
      };
      const skinId = await applyToTarget(this.runtime, target, null, def);
      storeOverlay(target, skinId, def);
    }

    async gradRainbow(args, util) {
      const target = this._resolveTarget(args, util);
      const def = {
        type: "linear",
        angle: Number(args.ANGLE) || 0,
        opacity: Math.max(0, Math.min(100, Number(args.OPACITY))) / 100,
        blendMode: "multiply",
        stops: [
          { color: "#ff0000", alpha: 1, pos: 0    },
          { color: "#ff8800", alpha: 1, pos: 0.17 },
          { color: "#ffff00", alpha: 1, pos: 0.33 },
          { color: "#00cc00", alpha: 1, pos: 0.5  },
          { color: "#0000ff", alpha: 1, pos: 0.67 },
          { color: "#8800cc", alpha: 1, pos: 0.83 },
          { color: "#ff0099", alpha: 1, pos: 1    },
        ],
      };
      const skinId = await applyToTarget(this.runtime, target, null, def);
      storeOverlay(target, skinId, def);
    }

    // ── Utility ──────────────────────────────────────────────────────────────────

    setRenderQuality(args) {
      const v = Number(args.SCALE);
      globalScaleOverride = v > 0 ? v : 0;
    }

    resetColors(args, util) {
      const target = this._resolveTarget(args, util);
      gradientPending.delete(target.id);
      restoreOriginalSkin(this.runtime, target);
    }

    hasOverlay(args, util) {
      return overlayState.has(this._resolveTarget(args, util).id);
    }
  }

  Scratch.extensions.register(new CostumeColorFX(Scratch.vm.runtime));
})(Scratch);
