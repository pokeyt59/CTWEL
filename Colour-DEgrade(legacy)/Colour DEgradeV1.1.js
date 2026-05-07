// Name: Colour DEgrade (Stable)
// Description: Runtime dithering effects – compatible with Colour Lab V3.
// License: MIT

(function (Scratch) {
  "use strict";

  // ============================================================
  // SHARED CACHE (compatible with Colour Lab V3)
  // ============================================================
  const GLOBAL_CACHE_KEY = "__colourLabCache";
  const sharedCache = window[GLOBAL_CACHE_KEY] || (window[GLOBAL_CACHE_KEY] = { weakMap: new WeakMap(), version: 0 });
  const rasterCache = sharedCache.weakMap;
  const rasterCacheEntries = new Set();

  let globalScaleOverride = 0;
  let globalRasterEpoch = 0;

  // ============================================================
  // CANVAS POOL
  // ============================================================
  const canvasPool = new Map();
  function getCanvas(width, height) {
    const key = `${width}|${height}`;
    let canvas = canvasPool.get(key);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvasPool.set(key, canvas);
    }
    return canvas;
  }

  // ============================================================
  // LUT CACHING
  // ============================================================
  const lutCache = new Map();
  function getClampLUT(levels) {
    if (lutCache.has(levels)) return lutCache.get(levels);
    const step = 255 / (levels - 1);
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      lut[i] = Math.round(Math.round(i / step) * step);
    }
    lutCache.set(levels, lut);
    return lut;
  }

  // ============================================================
  // PRE‑COMPUTED BAYER MATRICES
  // ============================================================
  const BAYER_2 = new Uint8Array([0, 2, 3, 1]);
  const BAYER_4 = new Uint8Array([
    0,8,2,10,
    12,4,14,6,
    3,11,1,9,
    15,7,13,5
  ]);
  const BAYER_8 = new Uint8Array([
    0,32,8,40,2,34,10,42,
    48,16,56,24,50,18,58,26,
    12,44,4,36,14,46,6,38,
    60,28,52,20,62,30,54,22,
    3,35,11,43,1,33,9,41,
    51,19,59,27,49,17,57,25,
    15,47,7,39,13,45,5,37,
    63,31,55,23,61,29,53,21
  ]);

  // ============================================================
  // FLOYD‑STEINBERG (integer, safe clamping)
  // ============================================================
  function floydSteinberg(imageData, options) {
    const { levels, serpentine, strength } = options;
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const lut = getClampLUT(levels);
    const errScale = strength; // 0..1

    for (let y = 0; y < height; y++) {
      const rowStart = y * width * 4;
      const isOdd = serpentine && (y & 1);
      if (isOdd) {
        for (let x = width - 1; x >= 0; x--) {
          const idx = rowStart + x * 4;
          if (data[idx + 3] === 0) continue;
          const oldR = data[idx], oldG = data[idx+1], oldB = data[idx+2];
          const newR = lut[oldR], newG = lut[oldG], newB = lut[oldB];
          data[idx] = newR; data[idx+1] = newG; data[idx+2] = newB;
          let errR = (oldR - newR) * errScale;
          let errG = (oldG - newG) * errScale;
          let errB = (oldB - newB) * errScale;
          // distribute (mirrored)
          if (x - 1 >= 0) {
            const nIdx = idx - 4;
            data[nIdx]   = Math.min(255, Math.max(0, data[nIdx]   + errR * 7/16));
            data[nIdx+1] = Math.min(255, Math.max(0, data[nIdx+1] + errG * 7/16));
            data[nIdx+2] = Math.min(255, Math.max(0, data[nIdx+2] + errB * 7/16));
          }
          if (x + 1 < width && y + 1 < height) {
            const nIdx = (y+1)*width*4 + (x+1)*4;
            data[nIdx]   = Math.min(255, Math.max(0, data[nIdx]   + errR * 1/16));
            data[nIdx+1] = Math.min(255, Math.max(0, data[nIdx+1] + errG * 1/16));
            data[nIdx+2] = Math.min(255, Math.max(0, data[nIdx+2] + errB * 1/16));
          }
          if (y + 1 < height) {
            const nIdx = (y+1)*width*4 + x*4;
            data[nIdx]   = Math.min(255, Math.max(0, data[nIdx]   + errR * 5/16));
            data[nIdx+1] = Math.min(255, Math.max(0, data[nIdx+1] + errG * 5/16));
            data[nIdx+2] = Math.min(255, Math.max(0, data[nIdx+2] + errB * 5/16));
          }
          if (x - 1 >= 0 && y + 1 < height) {
            const nIdx = (y+1)*width*4 + (x-1)*4;
            data[nIdx]   = Math.min(255, Math.max(0, data[nIdx]   + errR * 3/16));
            data[nIdx+1] = Math.min(255, Math.max(0, data[nIdx+1] + errG * 3/16));
            data[nIdx+2] = Math.min(255, Math.max(0, data[nIdx+2] + errB * 3/16));
          }
        }
      } else {
        for (let x = 0; x < width; x++) {
          const idx = rowStart + x * 4;
          if (data[idx + 3] === 0) continue;
          const oldR = data[idx], oldG = data[idx+1], oldB = data[idx+2];
          const newR = lut[oldR], newG = lut[oldG], newB = lut[oldB];
          data[idx] = newR; data[idx+1] = newG; data[idx+2] = newB;
          let errR = (oldR - newR) * errScale;
          let errG = (oldG - newG) * errScale;
          let errB = (oldB - newB) * errScale;
          if (x + 1 < width) {
            const nIdx = idx + 4;
            data[nIdx]   = Math.min(255, Math.max(0, data[nIdx]   + errR * 7/16));
            data[nIdx+1] = Math.min(255, Math.max(0, data[nIdx+1] + errG * 7/16));
            data[nIdx+2] = Math.min(255, Math.max(0, data[nIdx+2] + errB * 7/16));
          }
          if (x - 1 >= 0 && y + 1 < height) {
            const nIdx = (y+1)*width*4 + (x-1)*4;
            data[nIdx]   = Math.min(255, Math.max(0, data[nIdx]   + errR * 1/16));
            data[nIdx+1] = Math.min(255, Math.max(0, data[nIdx+1] + errG * 1/16));
            data[nIdx+2] = Math.min(255, Math.max(0, data[nIdx+2] + errB * 1/16));
          }
          if (y + 1 < height) {
            const nIdx = (y+1)*width*4 + x*4;
            data[nIdx]   = Math.min(255, Math.max(0, data[nIdx]   + errR * 5/16));
            data[nIdx+1] = Math.min(255, Math.max(0, data[nIdx+1] + errG * 5/16));
            data[nIdx+2] = Math.min(255, Math.max(0, data[nIdx+2] + errB * 5/16));
          }
          if (x + 1 < width && y + 1 < height) {
            const nIdx = (y+1)*width*4 + (x+1)*4;
            data[nIdx]   = Math.min(255, Math.max(0, data[nIdx]   + errR * 3/16));
            data[nIdx+1] = Math.min(255, Math.max(0, data[nIdx+1] + errG * 3/16));
            data[nIdx+2] = Math.min(255, Math.max(0, data[nIdx+2] + errB * 3/16));
          }
        }
      }
    }
    return imageData;
  }

  // ============================================================
  // ORDERED DITHER
  // ============================================================
  function orderedDither(imageData, options) {
    const { matrixSize, monochrome, strength } = options;
    let matrix, dim;
    if (matrixSize === 2) { matrix = BAYER_2; dim = 2; }
    else if (matrixSize === 8) { matrix = BAYER_8; dim = 8; }
    else { matrix = BAYER_4; dim = 4; }
    const scale = 255 / (dim * dim);
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width * 4;
      const yMask = (y % dim) * dim;
      for (let x = 0; x < width; x++) {
        const idx = rowOffset + x * 4;
        if (data[idx + 3] === 0) continue;
        const threshold = matrix[yMask + (x % dim)] * scale * strength;
        if (monochrome) {
          const gray = (data[idx] * 299 + data[idx+1] * 587 + data[idx+2] * 114) >> 10;
          const val = gray > threshold ? 255 : 0;
          data[idx] = val; data[idx+1] = val; data[idx+2] = val;
        } else {
          data[idx]   = data[idx]   > threshold ? 255 : 0;
          data[idx+1] = data[idx+1] > threshold ? 255 : 0;
          data[idx+2] = data[idx+2] > threshold ? 255 : 0;
        }
      }
    }
    return imageData;
  }

  // ============================================================
  // THRESHOLD DITHER
  // ============================================================
  function thresholdDither(imageData, options) {
    const { levels, monochrome } = options;
    const lut = getClampLUT(levels);
    const data = imageData.data;
    const len = data.length;
    if (monochrome) {
      for (let i = 0; i < len; i += 4) {
        if (data[i+3] === 0) continue;
        const gray = (data[i] * 299 + data[i+1] * 587 + data[i+2] * 114) >> 10;
        const v = lut[gray];
        data[i] = v; data[i+1] = v; data[i+2] = v;
      }
    } else {
      for (let i = 0; i < len; i += 4) {
        if (data[i+3] === 0) continue;
        data[i]   = lut[data[i]];
        data[i+1] = lut[data[i+1]];
        data[i+2] = lut[data[i+2]];
      }
    }
    return imageData;
  }

  // ============================================================
  // RASTERISATION (no OffscreenCanvas, reliable)
  // ============================================================
  function getRasterCacheEntry(costume) {
    let entry = rasterCache.get(costume);
    if (!entry) {
      entry = { map: new Map(), version: 0 };
      rasterCache.set(costume, entry);
      rasterCacheEntries.add(entry);
    }
    return entry;
  }

  function clearCostumeRasterCache(costume) {
    const entry = costume ? rasterCache.get(costume) : null;
    if (entry) { entry.version++; entry.map.clear(); }
  }

  function clearTargetRasterCache(target) {
    const costumes = getCostumeListForTarget(target);
    for (let i = 0; i < costumes.length; i++) clearCostumeRasterCache(costumes[i]);
  }

  function clearAllRasterCaches() {
    globalRasterEpoch++;
    for (const entry of rasterCacheEntries) { entry.version++; entry.map.clear(); }
  }

  function getCostumeListForTarget(target) {
    return (target && (target.sprite ? target.sprite.costumes_ : target.costumes_)) || [];
  }

  async function rasteriseCostume(costume, scale) {
    const asset = costume && costume.asset;
    if (!asset) throw new Error("No asset on costume");
    const mimeType = asset.assetType && asset.assetType.contentType;
    const isSvg = mimeType === "image/svg+xml";
    let finalScale;
    if (typeof scale === "number" && scale > 0) {
      finalScale = scale;
    } else {
      const dpr = typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1;
      finalScale = isSvg ? Math.max(4, dpr * 2) : Math.max(2, dpr);
    }
    const cache = getRasterCacheEntry(costume);
    const version = cache.version;
    if (cache.map.has(finalScale)) return cache.map.get(finalScale);
    const blob = new Blob([isSvg ? asset.decodeText() : asset.data], { type: mimeType || "image/png" });
    const promise = (async () => {
      try {
        const bitmap = await createImageBitmap(blob);
        const drawW = Math.max(1, Math.round(bitmap.width * finalScale));
        const drawH = Math.max(1, Math.round(bitmap.height * finalScale));
        const canvas = getCanvas(drawW, drawH);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bitmap, 0, 0, drawW, drawH);
        bitmap.close();
        const imageData = ctx.getImageData(0, 0, drawW, drawH);
        const result = { canvas, ctx, imageData, img: null, scale: finalScale };
        if (cache.version === version) cache.map.set(finalScale, Promise.resolve(result));
        return result;
      } catch (e) {
        cache.map.delete(finalScale);
        throw e;
      }
    })();
    cache.map.set(finalScale, promise);
    return promise;
  }

  // ============================================================
  // PER‑TARGET STATE
  // ============================================================
  const targetOverlayState = new Map();

  function getCurrentCostume(target) {
    const costumeList = target && (target.sprite ? target.sprite.costumes_ : target.costumes_);
    return (costumeList && costumeList[target.currentCostume]) || null;
  }

  function storeOverlay(target, skinId, ditherDef) {
    const existing = targetOverlayState.get(target.id);
    if (existing && existing.skinId) {
      const rdr = Scratch.vm.runtime.renderer;
      if (rdr) try { rdr.destroySkin(existing.skinId); } catch (_) {}
    }
    targetOverlayState.set(target.id, { skinId, ditherDef });
  }

  function restoreOriginalSkin(runtime, target) {
    const state = targetOverlayState.get(target.id);
    if (!state) return;
    const renderer = runtime.renderer;
    const costumeList = target.sprite ? target.sprite.costumes_ : target.costumes_;
    const costume = costumeList && costumeList[target.currentCostume];
    if (costume && renderer) renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
    if (state.skinId && renderer) { try { renderer.destroySkin(state.skinId); } catch (_) {} }
    targetOverlayState.delete(target.id);
  }

  function clearTargetEffectState(runtime, target) {
    restoreOriginalSkin(runtime, target);
  }

  async function applyDitherToTarget(runtime, target, ditherSpec) {
    const renderer = runtime.renderer;
    if (!renderer) throw new Error("Renderer not available");
    const costume = getCurrentCostume(target);
    if (!costume) throw new Error("No current costume");
    const { imageData, scale } = await rasteriseCostume(costume, globalScaleOverride);
    let processed;
    switch (ditherSpec.type) {
      case "floyd-steinberg":
        processed = floydSteinberg(imageData, {
          levels: ditherSpec.levels,
          serpentine: ditherSpec.serpentine,
          strength: ditherSpec.strength,
        });
        break;
      case "ordered":
        processed = orderedDither(imageData, {
          matrixSize: ditherSpec.matrixSize,
          monochrome: ditherSpec.monochrome,
          strength: ditherSpec.strength,
        });
        break;
      case "threshold":
        processed = thresholdDither(imageData, {
          levels: ditherSpec.levels,
          monochrome: ditherSpec.monochrome,
        });
        break;
      default:
        processed = imageData;
    }
    const workCanvas = getCanvas(processed.width, processed.height);
    const ctx = workCanvas.getContext("2d");
    ctx.putImageData(processed, 0, 0);
    const skinResolution = (costume.bitmapResolution || 1) * scale;
    const skinId = renderer.createBitmapSkin(workCanvas, skinResolution);
    renderer.updateDrawableSkinId(target.drawableID, skinId);
    return skinId;
  }

  // ============================================================
  // EXTENSION CLASS
  // ============================================================
  class ColourDEgrade {
    constructor(runtime) {
      this.runtime = runtime;
    }

    getInfo() {
      return {
        id: "ColourDEgrade",
        name: "Colour DEgrade",
        color1: "#7B4FE0",
        color2: "#5A35BD",
        blocks: [
          { blockType: Scratch.BlockType.LABEL, text: "— Dithering Effects —" },
          {
            opcode: "ditherFloydSteinberg",
            blockType: Scratch.BlockType.COMMAND,
            text: "apply Floyd-Steinberg dithering to [TARGET] with [LEVELS] levels, serpentine [SERPENTINE] strength [STRENGTH]%",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              LEVELS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 8 },
              SERPENTINE: { type: Scratch.ArgumentType.BOOLEAN, defaultValue: false },
              STRENGTH: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
            },
          },
          {
            opcode: "ditherOrdered",
            blockType: Scratch.BlockType.COMMAND,
            text: "apply ordered dithering to [TARGET] with matrix size [SIZE] monochrome [MONO] strength [STRENGTH]%",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              SIZE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 4 },
              MONO: { type: Scratch.ArgumentType.BOOLEAN, defaultValue: false },
              STRENGTH: { type: Scratch.ArgumentType.NUMBER, defaultValue: 100 },
            },
          },
          {
            opcode: "ditherThreshold",
            blockType: Scratch.BlockType.COMMAND,
            text: "apply threshold dithering to [TARGET] with [LEVELS] levels monochrome [MONO]",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              LEVELS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 8 },
              MONO: { type: Scratch.ArgumentType.BOOLEAN, defaultValue: false },
            },
          },
          "---",
          { blockType: Scratch.BlockType.LABEL, text: "— Quick Shortcuts —" },
          {
            opcode: "ditherPixelate",
            blockType: Scratch.BlockType.COMMAND,
            text: "pixelate [TARGET] to [SIZE]px pixels",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              SIZE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 4 },
            },
          },
          {
            opcode: "ditherPosterize",
            blockType: Scratch.BlockType.COMMAND,
            text: "posterize [TARGET] to [LEVELS] levels",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              LEVELS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 8 },
            },
          },
          {
            opcode: "ditherMonochrome",
            blockType: Scratch.BlockType.COMMAND,
            text: "make [TARGET] monochrome (black & white)",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
          },
          "---",
          { blockType: Scratch.BlockType.LABEL, text: "— Utility —" },
          {
            opcode: "resetDithering",
            blockType: Scratch.BlockType.COMMAND,
            text: "reset dithering of [TARGET]",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } },
          },
          {
            opcode: "setRenderQuality",
            blockType: Scratch.BlockType.COMMAND,
            text: "set render quality to [SCALE]x clear cache [CLEAR_CACHE]",
            arguments: {
              SCALE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 4 },
              CLEAR_CACHE: { type: Scratch.ArgumentType.BOOLEAN, defaultValue: true },
            },
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
          },
          "---",
          { blockType: Scratch.BlockType.LABEL, text: "— Test —" },
          {
            opcode: "isAlive",
            blockType: Scratch.BlockType.REPORTER,
            text: "Colour DEgrade alive?",
          },
        ],
      };
    }

    _resolveTarget(args, util) {
      const name = args.TARGET;
      if (!name || name === "_myself_") return util.target;
      if (name === "_stage_") return this.runtime.getTargetForStage();
      return this.runtime.getSpriteTargetByName(name) || util.target;
    }

    isAlive() { return "yes"; }

    async ditherFloydSteinberg(args, util) {
      try {
        const target = this._resolveTarget(args, util);
        const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
        const serpentine = args.SERPENTINE === true || args.SERPENTINE === "true";
        const strength = Math.max(0, Math.min(100, Number(args.STRENGTH))) / 100;
        const skinId = await applyDitherToTarget(this.runtime, target, {
          type: "floyd-steinberg",
          levels,
          serpentine,
          strength,
        });
        storeOverlay(target, skinId, { type: "floyd-steinberg", levels, serpentine, strength });
      } catch (e) { console.error(e); }
    }

    async ditherOrdered(args, util) {
      try {
        const target = this._resolveTarget(args, util);
        let size = Number(args.SIZE);
        if (size !== 2 && size !== 8) size = 4;
        const monochrome = args.MONO === true || args.MONO === "true";
        const strength = Math.max(0, Math.min(100, Number(args.STRENGTH))) / 100;
        const skinId = await applyDitherToTarget(this.runtime, target, {
          type: "ordered",
          matrixSize: size,
          monochrome,
          strength,
        });
        storeOverlay(target, skinId, { type: "ordered", matrixSize: size, monochrome, strength });
      } catch (e) { console.error(e); }
    }

    async ditherThreshold(args, util) {
      try {
        const target = this._resolveTarget(args, util);
        const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
        const monochrome = args.MONO === true || args.MONO === "true";
        const skinId = await applyDitherToTarget(this.runtime, target, {
          type: "threshold",
          levels,
          monochrome,
        });
        storeOverlay(target, skinId, { type: "threshold", levels, monochrome });
      } catch (e) { console.error(e); }
    }

    async ditherPixelate(args, util) {
      try {
        const target = this._resolveTarget(args, util);
        const size = Math.max(1, Number(args.SIZE));
        const costume = getCurrentCostume(target);
        if (!costume) return;
        const { canvas, scale } = await rasteriseCostume(costume, globalScaleOverride);
        const w = canvas.width, h = canvas.height;
        const smallW = Math.max(1, Math.floor(w / size));
        const smallH = Math.max(1, Math.floor(h / size));
        const pixelCanvas = getCanvas(w, h);
        const ctx = pixelCanvas.getContext("2d");
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(canvas, 0, 0, smallW, smallH, 0, 0, w, h);
        const skinResolution = (costume.bitmapResolution || 1) * scale;
        const skinId = this.runtime.renderer.createBitmapSkin(pixelCanvas, skinResolution);
        this.runtime.renderer.updateDrawableSkinId(target.drawableID, skinId);
        storeOverlay(target, skinId, { type: "pixelate", size });
      } catch (e) { console.error(e); }
    }

    async ditherPosterize(args, util) {
      try {
        const target = this._resolveTarget(args, util);
        const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
        const costume = getCurrentCostume(target);
        if (!costume) return;
        const { imageData, scale } = await rasteriseCostume(costume, globalScaleOverride);
        const processed = thresholdDither(imageData, { levels, monochrome: false });
        const workCanvas = getCanvas(processed.width, processed.height);
        workCanvas.getContext("2d").putImageData(processed, 0, 0);
        const skinResolution = (costume.bitmapResolution || 1) * scale;
        const skinId = this.runtime.renderer.createBitmapSkin(workCanvas, skinResolution);
        this.runtime.renderer.updateDrawableSkinId(target.drawableID, skinId);
        storeOverlay(target, skinId, { type: "posterize", levels });
      } catch (e) { console.error(e); }
    }

    async ditherMonochrome(args, util) {
      try {
        const target = this._resolveTarget(args, util);
        const costume = getCurrentCostume(target);
        if (!costume) return;
        const { imageData, scale } = await rasteriseCostume(costume, globalScaleOverride);
        const data = imageData.data;
        for (let i = 0, len = data.length; i < len; i += 4) {
          if (data[i+3] === 0) continue;
          const gray = (data[i] * 299 + data[i+1] * 587 + data[i+2] * 114) >> 10;
          const val = gray > 127 ? 255 : 0;
          data[i] = val; data[i+1] = val; data[i+2] = val;
        }
        const workCanvas = getCanvas(imageData.width, imageData.height);
        workCanvas.getContext("2d").putImageData(imageData, 0, 0);
        const skinResolution = (costume.bitmapResolution || 1) * scale;
        const skinId = this.runtime.renderer.createBitmapSkin(workCanvas, skinResolution);
        this.runtime.renderer.updateDrawableSkinId(target.drawableID, skinId);
        storeOverlay(target, skinId, { type: "monochrome" });
      } catch (e) { console.error(e); }
    }

    async resetDithering(args, util) {
      const target = this._resolveTarget(args, util);
      clearTargetEffectState(this.runtime, target);
    }

    setRenderQuality(args) {
      const s = Number(args.SCALE);
      const next = s > 0 ? s : 0;
      const shouldClear = args.CLEAR_CACHE !== false;
      if (next !== globalScaleOverride) {
        globalScaleOverride = next;
        globalRasterEpoch++;
        if (shouldClear) clearAllRasterCaches();
      }
    }

    clearSpriteCache(args, util) {
      const target = this._resolveTarget(args, util);
      clearTargetRasterCache(target);
      globalRasterEpoch++;
    }

    clearAllSpriteCaches() {
      clearAllRasterCaches();
    }
  }

  Scratch.extensions.register(new ColourDEgrade(Scratch.vm.runtime));
})(Scratch);