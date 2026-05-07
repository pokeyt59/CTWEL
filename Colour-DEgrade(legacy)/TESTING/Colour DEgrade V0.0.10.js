// Name: Colour DEgrade (Clean Rewrite)
// Description: Full dithering toolkit – Floyd‑Steinberg, ordered, threshold, pixelate, posterize, monochrome.
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Colour DEgrade must run unsandboxed.");
  }

  // ============================================================
  // RASTER CACHE (compatible with Colour Lab V3)
  // ============================================================
  const GLOBAL_CACHE_KEY = "__colourLabCache";
  const sharedCache = window[GLOBAL_CACHE_KEY] || (window[GLOBAL_CACHE_KEY] = { weakMap: new WeakMap(), version: 0 });
  const rasterCache = sharedCache.weakMap;
  const rasterCacheEntries = new Set();

  let globalScaleOverride = 0;
  let globalRasterEpoch = 0;

  function getRasterCacheEntry(costume) {
    let entry = rasterCache.get(costume);
    if (!entry) {
      entry = { map: new Map(), version: 0 };
      rasterCache.set(costume, entry);
      rasterCacheEntries.add(entry);
    }
    return entry;
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
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    const cleanup = () => { try { URL.revokeObjectURL(objectUrl); } catch (_) {} };
    const promise = new Promise((resolve, reject) => {
      img.onload = () => {
        try {
          const naturalW = img.naturalWidth || img.width || 1;
          const naturalH = img.naturalHeight || img.height || 1;
          const drawW = Math.max(1, Math.round(naturalW * finalScale));
          const drawH = Math.max(1, Math.round(naturalH * finalScale));
          const canvas = document.createElement("canvas");
          canvas.width = drawW;
          canvas.height = drawH;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, 0, 0, drawW, drawH);
          const imageData = ctx.getImageData(0, 0, drawW, drawH);
          const result = { canvas, ctx, imageData, img, scale: finalScale };
          if (cache.version === version) cache.map.set(finalScale, Promise.resolve(result));
          resolve(result);
        } catch (e) {
          cache.map.delete(finalScale);
          reject(e);
        } finally {
          cleanup();
        }
      };
      img.onerror = (e) => { cache.map.delete(finalScale); cleanup(); reject(e); };
      img.src = objectUrl;
    });
    cache.map.set(finalScale, promise);
    return promise;
  }

  // ============================================================
  // HELPER: Clone ImageData (prevents cache mutation)
  // ============================================================
  function cloneImageData(imageData) {
    return new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );
  }

  // ============================================================
  // DITHERING ALGORITHMS (clean re‑implementation)
  // ============================================================

  // Floyd‑Steinberg error diffusion
  function applyFloydSteinberg(imageData, levels, serpentine, strength) {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const step = 255 / (levels - 1);
    const clamp = (v) => Math.min(255, Math.max(0, v));
    const errFactor = strength; // 0..1

    for (let y = 0; y < h; y++) {
      const rowStart = y * w * 4;
      const reverse = serpentine && (y % 2 === 1);
      if (reverse) {
        // scan right to left
        for (let x = w - 1; x >= 0; x--) {
          const idx = rowStart + x * 4;
          if (data[idx + 3] === 0) continue;
          const oldR = data[idx];
          const oldG = data[idx + 1];
          const oldB = data[idx + 2];
          const newR = Math.round(Math.round(oldR / step) * step);
          const newG = Math.round(Math.round(oldG / step) * step);
          const newB = Math.round(Math.round(oldB / step) * step);
          data[idx] = newR;
          data[idx + 1] = newG;
          data[idx + 2] = newB;
          let errR = (oldR - newR) * errFactor;
          let errG = (oldG - newG) * errFactor;
          let errB = (oldB - newB) * errFactor;
          // left (x-1, y)
          if (x - 1 >= 0) {
            const nIdx = idx - 4;
            data[nIdx] = clamp(data[nIdx] + errR * 7/16);
            data[nIdx+1] = clamp(data[nIdx+1] + errG * 7/16);
            data[nIdx+2] = clamp(data[nIdx+2] + errB * 7/16);
          }
          // down‑right (x+1, y+1)
          if (x + 1 < w && y + 1 < h) {
            const nIdx = (y+1)*w*4 + (x+1)*4;
            data[nIdx] = clamp(data[nIdx] + errR * 1/16);
            data[nIdx+1] = clamp(data[nIdx+1] + errG * 1/16);
            data[nIdx+2] = clamp(data[nIdx+2] + errB * 1/16);
          }
          // down (x, y+1)
          if (y + 1 < h) {
            const nIdx = (y+1)*w*4 + x*4;
            data[nIdx] = clamp(data[nIdx] + errR * 5/16);
            data[nIdx+1] = clamp(data[nIdx+1] + errG * 5/16);
            data[nIdx+2] = clamp(data[nIdx+2] + errB * 5/16);
          }
          // down‑left (x-1, y+1)
          if (x - 1 >= 0 && y + 1 < h) {
            const nIdx = (y+1)*w*4 + (x-1)*4;
            data[nIdx] = clamp(data[nIdx] + errR * 3/16);
            data[nIdx+1] = clamp(data[nIdx+1] + errG * 3/16);
            data[nIdx+2] = clamp(data[nIdx+2] + errB * 3/16);
          }
        }
      } else {
        // normal left‑to‑right scan
        for (let x = 0; x < w; x++) {
          const idx = rowStart + x * 4;
          if (data[idx + 3] === 0) continue;
          const oldR = data[idx];
          const oldG = data[idx + 1];
          const oldB = data[idx + 2];
          const newR = Math.round(Math.round(oldR / step) * step);
          const newG = Math.round(Math.round(oldG / step) * step);
          const newB = Math.round(Math.round(oldB / step) * step);
          data[idx] = newR;
          data[idx + 1] = newG;
          data[idx + 2] = newB;
          let errR = (oldR - newR) * errFactor;
          let errG = (oldG - newG) * errFactor;
          let errB = (oldB - newB) * errFactor;
          // right (x+1, y)
          if (x + 1 < w) {
            const nIdx = idx + 4;
            data[nIdx] = clamp(data[nIdx] + errR * 7/16);
            data[nIdx+1] = clamp(data[nIdx+1] + errG * 7/16);
            data[nIdx+2] = clamp(data[nIdx+2] + errB * 7/16);
          }
          // down‑left (x-1, y+1)
          if (x - 1 >= 0 && y + 1 < h) {
            const nIdx = (y+1)*w*4 + (x-1)*4;
            data[nIdx] = clamp(data[nIdx] + errR * 1/16);
            data[nIdx+1] = clamp(data[nIdx+1] + errG * 1/16);
            data[nIdx+2] = clamp(data[nIdx+2] + errB * 1/16);
          }
          // down (x, y+1)
          if (y + 1 < h) {
            const nIdx = (y+1)*w*4 + x*4;
            data[nIdx] = clamp(data[nIdx] + errR * 5/16);
            data[nIdx+1] = clamp(data[nIdx+1] + errG * 5/16);
            data[nIdx+2] = clamp(data[nIdx+2] + errB * 5/16);
          }
          // down‑right (x+1, y+1)
          if (x + 1 < w && y + 1 < h) {
            const nIdx = (y+1)*w*4 + (x+1)*4;
            data[nIdx] = clamp(data[nIdx] + errR * 3/16);
            data[nIdx+1] = clamp(data[nIdx+1] + errG * 3/16);
            data[nIdx+2] = clamp(data[nIdx+2] + errB * 3/16);
          }
        }
      }
    }
    return imageData;
  }

  // Ordered dither (Bayer) with configurable matrix size and monochrome option
  function applyOrderedDither(imageData, matrixSize, monochrome, strength) {
    const data = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    let matrix, dim;
    if (matrixSize === 2) {
      dim = 2;
      matrix = [0, 2, 3, 1];
    } else if (matrixSize === 8) {
      dim = 8;
      matrix = [
        0,32,8,40,2,34,10,42,
        48,16,56,24,50,18,58,26,
        12,44,4,36,14,46,6,38,
        60,28,52,20,62,30,54,22,
        3,35,11,43,1,33,9,41,
        51,19,59,27,49,17,57,25,
        15,47,7,39,13,45,5,37,
        63,31,55,23,61,29,53,21
      ];
    } else {
      dim = 4;
      matrix = [
        0,8,2,10,
        12,4,14,6,
        3,11,1,9,
        15,7,13,5
      ];
    }
    const scale = (255 / (dim * dim)) * strength;
    for (let y = 0; y < h; y++) {
      const yMask = (y % dim) * dim;
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        if (data[idx + 3] === 0) continue;
        const threshold = matrix[yMask + (x % dim)] * scale;
        if (monochrome) {
          const gray = (data[idx] * 299 + data[idx+1] * 587 + data[idx+2] * 114) >> 10;
          const val = gray > threshold ? 255 : 0;
          data[idx] = val;
          data[idx+1] = val;
          data[idx+2] = val;
        } else {
          data[idx]   = data[idx]   > threshold ? 255 : 0;
          data[idx+1] = data[idx+1] > threshold ? 255 : 0;
          data[idx+2] = data[idx+2] > threshold ? 255 : 0;
        }
      }
    }
    return imageData;
  }

  // Threshold dither (posterization)
  function applyThresholdDither(imageData, levels, monochrome) {
    const data = imageData.data;
    const step = 255 / (levels - 1);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i+3] === 0) continue;
      if (monochrome) {
        const gray = (data[i] * 299 + data[i+1] * 587 + data[i+2] * 114) >> 10;
        const v = Math.round(Math.round(gray / step) * step);
        data[i] = v;
        data[i+1] = v;
        data[i+2] = v;
      } else {
        data[i]   = Math.round(Math.round(data[i] / step) * step);
        data[i+1] = Math.round(Math.round(data[i+1] / step) * step);
        data[i+2] = Math.round(Math.round(data[i+2] / step) * step);
      }
    }
    return imageData;
  }

  // Pixelate
  function applyPixelate(imageData, blockSize) {
    const w = imageData.width;
    const h = imageData.height;
    const smallW = Math.max(1, Math.floor(w / blockSize));
    const smallH = Math.max(1, Math.floor(h / blockSize));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, smallW, smallH, 0, 0, w, h);
    const newData = ctx.getImageData(0, 0, w, h);
    imageData.data.set(newData.data);
    return imageData;
  }

  // Posterize (same as threshold)
  const applyPosterize = applyThresholdDither;

  // Monochrome (pure black & white)
  function applyMonochrome(imageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i+3] === 0) continue;
      const gray = (data[i] * 299 + data[i+1] * 587 + data[i+2] * 114) >> 10;
      const val = gray > 127 ? 255 : 0;
      data[i] = val;
      data[i+1] = val;
      data[i+2] = val;
    }
    return imageData;
  }

  // ============================================================
  // APPLY EFFECT (always clones to avoid cache pollution)
  // ============================================================
  async function applyToTarget(runtime, target, effectFunc, ...args) {
    const renderer = runtime.renderer;
    if (!renderer) throw new Error("No renderer");
    const costume = getCurrentCostume(target);
    if (!costume) throw new Error("No current costume");
    const { imageData, scale } = await rasteriseCostume(costume, globalScaleOverride);
    const cloned = cloneImageData(imageData);
    effectFunc(cloned, ...args);
    const canvas = document.createElement("canvas");
    canvas.width = cloned.width;
    canvas.height = cloned.height;
    canvas.getContext("2d").putImageData(cloned, 0, 0);
    const skinResolution = (costume.bitmapResolution || 1) * scale;
    const skinId = renderer.createBitmapSkin(canvas, skinResolution);
    renderer.updateDrawableSkinId(target.drawableID, skinId);
    if (target._degradeSkin) {
      try { renderer.destroySkin(target._degradeSkin); } catch(e) {}
    }
    target._degradeSkin = skinId;
    return skinId;
  }

  function getCurrentCostume(target) {
    const costumes = target.sprite ? target.sprite.costumes_ : target.costumes_;
    return costumes && costumes[target.currentCostume];
  }

  function clearTargetRasterCache(target) {
    const costumes = target.sprite ? target.sprite.costumes_ : target.costumes_;
    if (costumes) {
      for (let i = 0; i < costumes.length; i++) {
        const entry = rasterCache.get(costumes[i]);
        if (entry) { entry.version++; entry.map.clear(); }
      }
    }
  }

  function clearAllRasterCaches() {
    globalRasterEpoch++;
    for (const entry of rasterCacheEntries) {
      entry.version++;
      entry.map.clear();
    }
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
          { blockType: Scratch.BlockType.LABEL, text: "— Dithering Quick Shortcuts —" },
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
        ],
      };
    }

    _resolveTarget(args, util) {
      const name = args.TARGET;
      if (!name || name === "_myself_") return util.target;
      if (name === "_stage_") return this.runtime.getTargetForStage();
      return this.runtime.getSpriteTargetByName(name) || util.target;
    }

    async ditherFloydSteinberg(args, util) {
      const target = this._resolveTarget(args, util);
      const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
      const serpentine = args.SERPENTINE === true || args.SERPENTINE === "true";
      const strength = Math.max(0, Math.min(100, Number(args.STRENGTH))) / 100;
      await applyToTarget(this.runtime, target, applyFloydSteinberg, levels, serpentine, strength);
    }

    async ditherOrdered(args, util) {
      const target = this._resolveTarget(args, util);
      let size = Number(args.SIZE);
      if (size !== 2 && size !== 8) size = 4;
      const monochrome = args.MONO === true || args.MONO === "true";
      const strength = Math.max(0, Math.min(100, Number(args.STRENGTH))) / 100;
      await applyToTarget(this.runtime, target, applyOrderedDither, size, monochrome, strength);
    }

    async ditherThreshold(args, util) {
      const target = this._resolveTarget(args, util);
      const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
      const monochrome = args.MONO === true || args.MONO === "true";
      await applyToTarget(this.runtime, target, applyThresholdDither, levels, monochrome);
    }

    async ditherPixelate(args, util) {
      const target = this._resolveTarget(args, util);
      const size = Math.max(1, Number(args.SIZE));
      await applyToTarget(this.runtime, target, applyPixelate, size);
    }

    async ditherPosterize(args, util) {
      const target = this._resolveTarget(args, util);
      const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
      await applyToTarget(this.runtime, target, applyPosterize, levels, false);
    }

    async ditherMonochrome(args, util) {
      const target = this._resolveTarget(args, util);
      await applyToTarget(this.runtime, target, applyMonochrome);
    }

    async resetDithering(args, util) {
      const target = this._resolveTarget(args, util);
      const renderer = this.runtime.renderer;
      if (target._degradeSkin) {
        try { renderer.destroySkin(target._degradeSkin); } catch(e) {}
        delete target._degradeSkin;
      }
      const costume = getCurrentCostume(target);
      if (costume && renderer) {
        renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
      }
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