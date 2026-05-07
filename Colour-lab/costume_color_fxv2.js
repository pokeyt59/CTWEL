// Name: Costume Color FX
// Description: Modify costume color data at runtime without permanently changing costumes. Supports hue rotation, saturation, brightness, tinting, palette swaps, and per-channel adjustments.
// By: Claude
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Costume Color FX must run unsandboxed.");
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /** Convert hex string (#rrggbb or #rgb) to [r, g, b] 0–255 */
  function hexToRgb(hex) {
    hex = hex.replace(/^#/, "");
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** RGB 0–255 → HSL (h 0–360, s 0–100, l 0–100) */
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

  /** HSL (h 0–360, s 0–100, l 0–100) → RGB 0–255 */
  function hslToRgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
      };
      const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      const p = 2 * l - q;
      r = hue2rgb(p, q, h + 1 / 3);
      g = hue2rgb(p, q, h);
      b = hue2rgb(p, q, h - 1 / 3);
    }
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  /** Clamp value to [0, 255] */
  function clamp255(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  // ─── Core canvas processor ───────────────────────────────────────────────────

  /**
   * Given an ImageData and a transform function (pixel: [r,g,b,a] → [r,g,b,a]),
   * return a new ImageData with the transform applied.
   */
  function processImageData(imageData, transformFn) {
    const src = imageData.data;
    const out = new ImageData(imageData.width, imageData.height);
    const dst = out.data;
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3];
      if (a === 0) {
        // keep fully transparent pixels transparent
        dst[i] = dst[i + 1] = dst[i + 2] = 0;
        dst[i + 3] = 0;
        continue;
      }
      const [nr, ng, nb, na] = transformFn(src[i], src[i + 1], src[i + 2], a);
      dst[i]     = clamp255(nr);
      dst[i + 1] = clamp255(ng);
      dst[i + 2] = clamp255(nb);
      dst[i + 3] = clamp255(na !== undefined ? na : a);
    }
    return out;
  }

  // ─── Costume access utilities ────────────────────────────────────────────────

  /**
   * Get the costume object for a Scratch target by costume name or index.
   * Returns null if not found.
   */
  function getCostume(target, nameOrIndex) {
    if (!target) return null;
    const costumeList = target.sprite ? target.sprite.costumes_ : target.costumes_;
    if (!costumeList) return null;
    if (typeof nameOrIndex === "number") {
      return costumeList[nameOrIndex] || null;
    }
    return costumeList.find((c) => c.name === nameOrIndex) || null;
  }

  /**
   * Rasterise a costume to an offscreen canvas and return {canvas, ctx, imageData, scale}.
   * Works for both SVG and bitmap costumes.
   *
   * @param {object} costume  - Scratch costume object
   * @param {number} [scale]  - Supersample multiplier (default: auto from devicePixelRatio, min 2)
   */
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

        // For SVGs we supersample so the processed bitmap is crisp when displayed at any size.
        // For bitmaps we still allow upscaling when the caller requests it.
        const dpr = (typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) || 1;
        // Auto-scale: for SVG use at least 4×, otherwise 2×; always honour explicit scale arg.
        const autoScale = isSvg ? Math.max(4, dpr * 2) : Math.max(2, dpr);
        const finalScale = (typeof scale === "number" && scale > 0) ? scale : autoScale;

        const drawW = Math.round(naturalW * finalScale);
        const drawH = Math.round(naturalH * finalScale);

        const canvas = document.createElement("canvas");
        canvas.width  = drawW;
        canvas.height = drawH;
        const ctx = canvas.getContext("2d");

        // Use best-quality interpolation when scaling up
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, drawW, drawH);

        try {
          const imageData = ctx.getImageData(0, 0, drawW, drawH);
          resolve({ canvas, ctx, imageData, img, scale: finalScale });
        } catch (e) {
          reject(e);
        }
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

  // ─── Overlay skin system ─────────────────────────────────────────────────────
  // We use the renderer's custom skin/drawable system to overlay a modified
  // bitmap on top of the sprite without touching the real costume data.

  /**
   * Apply a pixel-level transform to the current costume of a target,
   * render it into a BitmapSkin overlay, and swap that skin onto the drawable.
   *
   * transformFn: (r, g, b, a) => [r, g, b, a]
   *
   * Returns the skin id so we can clean it up later.
   */
  async function applyTransformToTarget(runtime, target, transformFn) {
    const renderer = runtime.renderer;
    if (!renderer) throw new Error("No renderer available");

    const costumeIndex = target.currentCostume;
    const costumeList  = target.sprite ? target.sprite.costumes_ : target.costumes_;
    const costume      = costumeList && costumeList[costumeIndex];
    if (!costume) throw new Error("Could not find current costume");

    // Rasterise at high resolution to avoid pixelation
    const { imageData, scale } = await rasteriseCostume(costume, globalScaleOverride || undefined);

    // Apply transform
    const newImageData = processImageData(imageData, transformFn);

    // Build a new canvas with the result
    const outCanvas = document.createElement("canvas");
    outCanvas.width  = newImageData.width;
    outCanvas.height = newImageData.height;
    outCanvas.getContext("2d").putImageData(newImageData, 0, 0);

    // Tell the renderer how many pixels = 1 Scratch unit.
    // Multiplying bitmapResolution by our supersample scale keeps the sprite
    // displaying at its correct logical size even though the canvas is larger.
    const baseBitmapRes = costume.bitmapResolution || 1;
    const skinResolution = baseBitmapRes * scale;

    // Create a BitmapSkin from the canvas
    const skinId = renderer.createBitmapSkin(outCanvas, skinResolution);

    // Swap the drawable's skin
    const drawableId = target.drawableID;
    renderer.updateDrawableSkinId(drawableId, skinId);

    return skinId;
  }

  // ─── Global supersampling scale override ────────────────────────────────────
  // 0 = auto. Set via the "set render quality" block.
  let globalScaleOverride = 0;

  // ─── State storage ───────────────────────────────────────────────────────────
  // Maps targetId → { skinId, originalSkinId }

  const overlayState = new Map();

  function storeOverlay(target, newSkinId) {
    const existing = overlayState.get(target.id);
    // If there's already an overlay skin, dispose it first
    if (existing && existing.skinId !== existing.originalSkinId) {
      try { Scratch.vm.runtime.renderer.destroySkin(existing.skinId); } catch (_) {}
    }
    overlayState.set(target.id, {
      skinId: newSkinId,
      originalSkinId: existing ? existing.originalSkinId : target.skin ? target.skin.id : null,
    });
  }

  function restoreOriginalSkin(runtime, target) {
    const state = overlayState.get(target.id);
    if (!state) return;
    const renderer = runtime.renderer;
    // Get the real original skin from the costume
    const costumeIndex = target.currentCostume;
    const costumeList  = target.sprite ? target.sprite.costumes_ : target.costumes_;
    const costume      = costumeList && costumeList[costumeIndex];
    if (costume && renderer) {
      renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
    }
    // Destroy the overlay skin
    if (state.skinId && renderer) {
      try { renderer.destroySkin(state.skinId); } catch (_) {}
    }
    overlayState.delete(target.id);
  }

  // ─── Extension class ─────────────────────────────────────────────────────────

  class CostumeColorFX {
    constructor(runtime) {
      this.runtime = runtime;
    }

    getInfo() {
      return {
        id: "costumeColourFX",
        name: "Costume Color FX",
        color1: "#7B4FE0",
        color2: "#5A35BD",
        blocks: [
          {
            opcode: "setHue",
            blockType: Scratch.BlockType.COMMAND,
            text: "rotate hue of [TARGET] by [DEGREES]°",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              DEGREES: { type: Scratch.ArgumentType.NUMBER, defaultValue: 90 },
            },
          },
          {
            opcode: "setSaturation",
            blockType: Scratch.BlockType.COMMAND,
            text: "set saturation of [TARGET] to [PERCENT]%",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
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
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              COLOR:  { type: Scratch.ArgumentType.COLOR,  defaultValue: "#ff0000" },
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
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
            },
          },
          {
            opcode: "invert",
            blockType: Scratch.BlockType.COMMAND,
            text: "invert colors of [TARGET]",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
            },
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
          {
            opcode: "resetColors",
            blockType: Scratch.BlockType.COMMAND,
            text: "reset colors of [TARGET]",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
            },
          },
          {
            opcode: "setRenderQuality",
            blockType: Scratch.BlockType.COMMAND,
            text: "set render quality to [SCALE]x (2=default, 4=crisp, 8=ultra)",
            arguments: {
              SCALE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 4 },
            },
          },
          {
            opcode: "hasOverlay",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "[TARGET] has color override?",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
            },
          },
        ],
        menus: {
          // no static menus — users type sprite names or use "_myself_"
        },
      };
    }

    // ── Resolve target ──────────────────────────────────────────────────────────
    _resolveTarget(args, util) {
      const name = args.TARGET;
      if (!name || name === "_myself_") return util.target;
      const stage = this.runtime.getTargetForStage();
      if (name === "_stage_") return stage;
      return this.runtime.getSpriteTargetByName(name) || util.target;
    }

    // ── Block implementations ───────────────────────────────────────────────────

    async setHue(args, util) {
      const target = this._resolveTarget(args, util);
      const deg = Number(args.DEGREES) || 0;
      await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        let [h, s, l] = rgbToHsl(r, g, b);
        h = (h + deg) % 360;
        if (h < 0) h += 360;
        const [nr, ng, nb] = hslToRgb(h, s, l);
        return [nr, ng, nb, a];
      }).then((skinId) => storeOverlay(target, skinId));
    }

    async setSaturation(args, util) {
      const target = this._resolveTarget(args, util);
      const pct = Math.max(0, Number(args.PERCENT)) / 100;
      await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        let [h, , l] = rgbToHsl(r, g, b);
        const [nr, ng, nb] = hslToRgb(h, pct * 100, l);
        return [nr, ng, nb, a];
      }).then((skinId) => storeOverlay(target, skinId));
    }

    async setBrightness(args, util) {
      const target = this._resolveTarget(args, util);
      const factor = Number(args.FACTOR);
      await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        return [r * factor, g * factor, b * factor, a];
      }).then((skinId) => storeOverlay(target, skinId));
    }

    async tintColor(args, util) {
      const target = this._resolveTarget(args, util);
      const [tr, tg, tb] = hexToRgb(args.COLOR);
      const strength = Math.max(0, Math.min(100, Number(args.STRENGTH))) / 100;
      await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        const nr = r + (tr - r) * strength;
        const ng = g + (tg - g) * strength;
        const nb = b + (tb - b) * strength;
        return [nr, ng, nb, a];
      }).then((skinId) => storeOverlay(target, skinId));
    }

    async swapColor(args, util) {
      const target = this._resolveTarget(args, util);
      const [fr, fg, fb] = hexToRgb(args.FROM);
      const [tr, tg, tb] = hexToRgb(args.TO);
      const tol = Number(args.TOL) || 30;
      const tolSq = tol * tol;
      await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        const dr = r - fr, dg = g - fg, db = b - fb;
        const distSq = dr * dr + dg * dg + db * db;
        if (distSq <= tolSq) {
          // blend smoothly at edges
          const blend = 1 - Math.sqrt(distSq) / tol;
          const nr = r + (tr - fr) * blend;
          const ng = g + (tg - fg) * blend;
          const nb = b + (tb - fb) * blend;
          return [nr, ng, nb, a];
        }
        return [r, g, b, a];
      }).then((skinId) => storeOverlay(target, skinId));
    }

    async setChannels(args, util) {
      const target = this._resolveTarget(args, util);
      const mr = Number(args.R), mg = Number(args.G), mb = Number(args.B);
      await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        return [r * mr, g * mg, b * mb, a];
      }).then((skinId) => storeOverlay(target, skinId));
    }

    async grayscale(args, util) {
      const target = this._resolveTarget(args, util);
      await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        return [gray, gray, gray, a];
      }).then((skinId) => storeOverlay(target, skinId));
    }

    async invert(args, util) {
      const target = this._resolveTarget(args, util);
      await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        return [255 - r, 255 - g, 255 - b, a];
      }).then((skinId) => storeOverlay(target, skinId));
    }

    async setAlpha(args, util) {
      const target = this._resolveTarget(args, util);
      const pct = Math.max(0, Math.min(100, Number(args.PERCENT))) / 100;
      await applyTransformToTarget(this.runtime, target, (r, g, b, a) => {
        return [r, g, b, a * pct];
      }).then((skinId) => storeOverlay(target, skinId));
    }

    setRenderQuality(args) {
      const v = Number(args.SCALE);
      globalScaleOverride = (v > 0) ? v : 0;
    }

    resetColors(args, util) {
      const target = this._resolveTarget(args, util);
      restoreOriginalSkin(this.runtime, target);
    }

    hasOverlay(args, util) {
      const target = this._resolveTarget(args, util);
      return overlayState.has(target.id);
    }
  }

  Scratch.extensions.register(new CostumeColorFX(Scratch.vm.runtime));
})(Scratch);
