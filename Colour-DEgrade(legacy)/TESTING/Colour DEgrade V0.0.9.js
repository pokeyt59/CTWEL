// Name: Colour DEgrade (Ultra Optimized + Cloning Fix)
// Description: Runtime dithering effects – Floyd‑Steinberg, ordered, threshold, pixelate, posterize, monochrome.
// Optimizations: integer error diffusion, LUT caching, OffscreenCanvas, canvas pooling.
// Fix: cloned ImageData to avoid mutating the shared cache.
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Colour DEgrade must run unsandboxed.");
  }

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
  // CANVAS POOL (reuse canvases to reduce GC)
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
  // LUT CACHING (by number of levels)
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
  // PRE‑COMPUTED BAYER MATRICES (flat Uint8Array)
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
  // ORDERED DITHER THRESHOLD CACHE (by matrix size + strength)
  // ============================================================
  const orderedThresholdCache = new Map();
  function getOrderedThresholds(matrixSize, strength) {
    const key = `${matrixSize}|${strength}`;
    if (orderedThresholdCache.has(key)) return orderedThresholdCache.get(key);
    let matrix, dim;
    if (matrixSize === 2) { matrix = BAYER_2; dim = 2; }
    else if (matrixSize === 8) { matrix = BAYER_8; dim = 8; }
    else { matrix = BAYER_4; dim = 4; }
    const scale = 255 / (dim * dim);
    const lut = new Uint8Array(dim * dim);
    for (let i = 0; i < lut.length; i++) {
      lut[i] = Math.round(matrix[i] * scale * strength);
    }
    orderedThresholdCache.set(key, { lut, dim });
    return { lut, dim };
  }

  // ============================================================
  // FLOYD‑STEINBERG DITHERING (integer error diffusion)
  // ============================================================
  function floydSteinberg(imageData, options) {
    const { levels, serpentine, strength } = options;
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    const lut = getClampLUT(levels);
    const errScaleInt = Math.round(strength * 16);
    if (errScaleInt === 0) return imageData;

    for (let y = 0; y < height; y++) {
      const rowStart = y * width * 4;
      const isOdd = serpentine && (y & 1);
      if (isOdd) {
        // Right‑to‑left scan (mirrored distribution)
        for (let x = width - 1; x >= 0; x--) {
          const idx = rowStart + x * 4;
          if (data[idx + 3] === 0) continue;

          const oldR = data[idx];
          const oldG = data[idx + 1];
          const oldB = data[idx + 2];

          const newR = lut[oldR];
          const newG = lut[oldG];
          const newB = lut[oldB];
          data[idx] = newR;
          data[idx + 1] = newG;
          data[idx + 2] = newB;

          let errR = (oldR - newR) * errScaleInt;
          let errG = (oldG - newG) * errScaleInt;
          let errB = (oldB - newB) * errScaleInt;

          // left neighbour (x-1, y) -> weight 7/16
          if (x - 1 >= 0) {
            const nIdx = idx - 4;
            data[nIdx]     += (errR * 7) >> 4;
            data[nIdx + 1] += (errG * 7) >> 4;
            data[nIdx + 2] += (errB * 7) >> 4;
          }
          // down‑right (x+1, y+1) -> weight 1/16
          if (x + 1 < width && y + 1 < height) {
            const nIdx = (y + 1) * width * 4 + (x + 1) * 4;
            data[nIdx]     += (errR * 1) >> 4;
            data[nIdx + 1] += (errG * 1) >> 4;
            data[nIdx + 2] += (errB * 1) >> 4;
          }
          // down (x, y+1) -> weight 5/16
          if (y + 1 < height) {
            const nIdx = (y + 1) * width * 4 + x * 4;
            data[nIdx]     += (errR * 5) >> 4;
            data[nIdx + 1] += (errG * 5) >> 4;
            data[nIdx + 2] += (errB * 5) >> 4;
          }
          // down‑left (x-1, y+1) -> weight 3/16
          if (x - 1 >= 0 && y + 1 < height) {
            const nIdx = (y + 1) * width * 4 + (x - 1) * 4;
            data[nIdx]     += (errR * 3) >> 4;
            data[nIdx + 1] += (errG * 3) >> 4;
            data[nIdx + 2] += (errB * 3) >> 4;
          }
        }
      } else {
        // Left‑to‑right scan (standard distribution)
        for (let x = 0; x < width; x++) {
          const idx = rowStart + x * 4;
          if (data[idx + 3] === 0) continue;

          const oldR = data[idx];
          const oldG = data[idx + 1];
          const oldB = data[idx + 2];

          const newR = lut[oldR];
          const newG = lut[oldG];
          const newB = lut[oldB];
          data[idx] = newR;
          data[idx + 1] = newG;
          data[idx + 2] = newB;

          let errR = (oldR - newR) * errScaleInt;
          let errG = (oldG - newG) * errScaleInt;
          let errB = (oldB - newB) * errScaleInt;

          // right neighbour (x+1, y) -> weight 7/16
          if (x + 1 < width) {
            const nIdx = idx + 4;
            data[nIdx]     += (errR * 7) >> 4;
            data[nIdx + 1] += (errG * 7) >> 4;
            data[nIdx + 2] += (errB * 7) >> 4;
          }
          // down‑left (x-1, y+1) -> weight 1/16
          if (x - 1 >= 0 && y + 1 < height) {
            const nIdx = (y + 1) * width * 4 + (x - 1) * 4;
            data[nIdx]     += (errR * 1) >> 4;
            data[nIdx + 1] += (errG * 1) >> 4;
            data[nIdx + 2] += (errB * 1) >> 4;
          }
          // down (x, y+1) -> weight 5/16
          if (y + 1 < height) {
            const nIdx = (y + 1) * width * 4 + x * 4;
            data[nIdx]     += (errR * 5) >> 4;
            data[nIdx + 1] += (errG * 5) >> 4;
            data[nIdx + 2] += (errB * 5) >> 4;
          }
          // down‑right (x+1, y+1) -> weight 3/16
          if (x + 1 < width && y + 1 < height) {
            const nIdx = (y + 1) * width * 4 + (x + 1) * 4;
            data[nIdx]     += (errR * 3) >> 4;
            data[nIdx + 1] += (errG * 3) >> 4;
            data[nIdx + 2] += (errB * 3) >> 4;
          }
        }
      }
    }
    return imageData;
  }

  // ============================================================
  // ORDERED DITHERING (Bayer)
  // ============================================================
  function orderedDither(imageData, options) {
    const { matrixSize, monochrome, strength } = options;
    const { lut, dim } = getOrderedThresholds(matrixSize, strength);
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width * 4;
      const yMask = (y % dim) * dim;
      for (let x = 0; x < width; x++) {
        const idx = rowOffset + x * 4;
        if (data[idx + 3] === 0) continue;
        const threshold = lut[yMask + (x % dim)];
        if (monochrome) {
          const gray = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) >> 10;
          const val = gray > threshold ? 255 : 0;
          data[idx] = val;
          data[idx + 1] = val;
          data[idx + 2] = val;
        } else {
          data[idx]     = data[idx]     > threshold ? 255 : 0;
          data[idx + 1] = data[idx + 1] > threshold ? 255 : 0;
          data[idx + 2] = data[idx + 2] > threshold ? 255 : 0;
        }
      }
    }
    return imageData;
  }

  // ============================================================
  // THRESHOLD DITHERING (posterization)
  // ============================================================
  function thresholdDither(imageData, options) {
    const { levels, monochrome } = options;
    const lut = getClampLUT(levels);
    const data = imageData.data;
    const len = data.length;

    if (monochrome) {
      for (let i = 0; i < len; i += 4) {
        if (data[i + 3] === 0) continue;
        const gray = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) >> 10;
        const v = lut[gray];
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
      }
    } else {
      for (let i = 0; i < len; i += 4) {
        if (data[i + 3] === 0) continue;
        data[i]     = lut[data[i]];
        data[i + 1] = lut[data[i + 1]];
        data[i + 2] = lut[data[i + 2]];
      }
    }
    return imageData;
  }

  // ============================================================
  // QUICK EFFECTS
  // ============================================================
  function pixelate(imageData, blockSize) {
    const w = imageData.width;
    const h = imageData.height;
    const smallW = Math.max(1, Math.floor(w / blockSize));
    const smallH = Math.max(1, Math.floor(h / blockSize));
    const canvas = getCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.putImageData(imageData, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0, smallW, smallH, 0, 0, w, h);
    const newData = ctx.getImageData(0, 0, w, h);
    imageData.data.set(newData.data);
    return imageData;
  }

  function posterize(imageData, levels) {
    return thresholdDither(imageData, { levels, monochrome: false });
  }

  function monochrome(imageData) {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      const gray = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) >> 10;
      const val = gray > 127 ? 255 : 0;
      data[i] = val;
      data[i + 1] = val;
      data[i + 2] = val;
    }
    return imageData;
  }

  // ============================================================
  // RASTERISATION (with OffscreenCanvas support)
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
    if (entry) {
      entry.version++;
      entry.map.clear();
    }
  }

  function clearTargetRasterCache(target) {
    const costumes = getCostumeListForTarget(target);
    for (let i = 0; i < costumes.length; i++) clearCostumeRasterCache(costumes[i]);
  }

  function clearAllRasterCaches() {
    globalRasterEpoch++;
    for (const entry of rasterCacheEntries) {
      entry.version++;
      entry.map.clear();
    }
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

        let canvas, ctx;
        if (typeof OffscreenCanvas !== "undefined") {
          canvas = new OffscreenCanvas(drawW, drawH);
          ctx = canvas.getContext("2d", { willReadFrequently: true });
        } else {
          canvas = getCanvas(drawW, drawH);
          ctx = canvas.getContext("2d", { willReadFrequently: true });
        }
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
  // PER‑TARGET STATE (compatible with Colour Lab)
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
    targetOverlayState.set(target.id, {
      skinId: skinId,
      ditherDef: ditherDef !== undefined ? ditherDef : (existing ? existing.ditherDef : null),
    });
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

  // ============================================================
  // APPLY DITHER TO TARGET (with cloning to avoid cache mutation)
  // ============================================================
  async function applyDitherToTarget(runtime, target, ditherSpec) {
    const renderer = runtime.renderer;
    if (!renderer) throw new Error("No renderer available");

    const costume = getCurrentCostume(target);
    if (!costume) throw new Error("Could not find current costume");

    const { imageData, scale } = await rasteriseCostume(costume, globalScaleOverride || 2);

    // CRITICAL FIX: clone the ImageData to avoid mutating the cached original
    const clonedImageData = new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );

    let processedImageData;
    switch (ditherSpec.type) {
      case "floyd-steinberg":
        processedImageData = floydSteinberg(clonedImageData, {
          levels: ditherSpec.levels,
          serpentine: ditherSpec.serpentine,
          strength: ditherSpec.strength,
        });
        break;
      case "ordered":
        processedImageData = orderedDither(clonedImageData, {
          matrixSize: ditherSpec.matrixSize,
          monochrome: ditherSpec.monochrome,
          strength: ditherSpec.strength,
        });
        break;
      case "threshold":
        processedImageData = thresholdDither(clonedImageData, {
          levels: ditherSpec.levels,
          monochrome: ditherSpec.monochrome,
        });
        break;
      default:
        processedImageData = clonedImageData;
    }

    const workCanvas = getCanvas(processedImageData.width, processedImageData.height);
    const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
    ctx.putImageData(processedImageData, 0, 0);

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
      const skinId = await applyDitherToTarget(this.runtime, target, {
        type: "floyd-steinberg",
        levels,
        serpentine,
        strength,
      });
      storeOverlay(target, skinId, { type: "floyd-steinberg", levels, serpentine, strength });
    }

    async ditherOrdered(args, util) {
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
    }

    async ditherThreshold(args, util) {
      const target = this._resolveTarget(args, util);
      const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
      const monochrome = args.MONO === true || args.MONO === "true";
      const skinId = await applyDitherToTarget(this.runtime, target, {
        type: "threshold",
        levels,
        monochrome,
      });
      storeOverlay(target, skinId, { type: "threshold", levels, monochrome });
    }

    async ditherPixelate(args, util) {
      const target = this._resolveTarget(args, util);
      const size = Math.max(1, Number(args.SIZE));
      const costume = getCurrentCostume(target);
      if (!costume) return;

      const { imageData, scale } = await rasteriseCostume(costume, globalScaleOverride || 2);
      // Clone before modifying
      const cloned = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
      pixelate(cloned, size);

      const workCanvas = getCanvas(cloned.width, cloned.height);
      workCanvas.getContext("2d").putImageData(cloned, 0, 0);
      const skinResolution = (costume.bitmapResolution || 1) * scale;
      const skinId = this.runtime.renderer.createBitmapSkin(workCanvas, skinResolution);
      this.runtime.renderer.updateDrawableSkinId(target.drawableID, skinId);
      storeOverlay(target, skinId, { type: "pixelate", size });
    }

    async ditherPosterize(args, util) {
      const target = this._resolveTarget(args, util);
      const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
      const costume = getCurrentCostume(target);
      if (!costume) return;

      const { imageData, scale } = await rasteriseCostume(costume, globalScaleOverride || 2);
      const cloned = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
      posterize(cloned, levels);

      const workCanvas = getCanvas(cloned.width, cloned.height);
      workCanvas.getContext("2d").putImageData(cloned, 0, 0);
      const skinResolution = (costume.bitmapResolution || 1) * scale;
      const skinId = this.runtime.renderer.createBitmapSkin(workCanvas, skinResolution);
      this.runtime.renderer.updateDrawableSkinId(target.drawableID, skinId);
      storeOverlay(target, skinId, { type: "posterize", levels });
    }

    async ditherMonochrome(args, util) {
      const target = this._resolveTarget(args, util);
      const costume = getCurrentCostume(target);
      if (!costume) return;

      const { imageData, scale } = await rasteriseCostume(costume, globalScaleOverride || 2);
      const cloned = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
      monochrome(cloned);

      const workCanvas = getCanvas(cloned.width, cloned.height);
      workCanvas.getContext("2d").putImageData(cloned, 0, 0);
      const skinResolution = (costume.bitmapResolution || 1) * scale;
      const skinId = this.runtime.renderer.createBitmapSkin(workCanvas, skinResolution);
      this.runtime.renderer.updateDrawableSkinId(target.drawableID, skinId);
      storeOverlay(target, skinId, { type: "monochrome" });
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