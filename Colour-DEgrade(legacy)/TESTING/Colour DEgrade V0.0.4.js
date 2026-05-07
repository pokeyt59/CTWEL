// Name: Colour DEgrade (Debug & Fix)
// Description: Fixed dithering with console logging.
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Colour DEgrade must run unsandboxed.");
  }

  // ========== RASTERISATION (identical to Colour Lab V3) ==========
  const rasterCache = new WeakMap();
  const rasterCacheEntries = new Set();

  function getRasterCacheEntry(costume) {
    let entry = rasterCache.get(costume);
    if (!entry) {
      entry = { map: new Map(), version: 0 };
      rasterCache.set(costume, entry);
      rasterCacheEntries.add(entry);
    }
    return entry;
  }

  let globalScaleOverride = 0;
  let globalRasterEpoch = 0;

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
    const effectiveMime = mimeType || "image/png";
    const blob = new Blob([isSvg ? asset.decodeText() : asset.data], { type: effectiveMime });
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

  // ========== DITHERING FUNCTIONS (with console logs) ==========
  function floydSteinberg(imageData, levels) {
    console.log("floydSteinberg called with levels", levels);
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    const step = 255 / (levels - 1);
    const clamp = (v) => Math.min(255, Math.max(0, v));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
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
        const errR = oldR - newR;
        const errG = oldG - newG;
        const errB = oldB - newB;
        // distribute errors
        if (x + 1 < width) {
          const nIdx = idx + 4;
          data[nIdx] = clamp(data[nIdx] + errR * 7 / 16);
          data[nIdx + 1] = clamp(data[nIdx + 1] + errG * 7 / 16);
          data[nIdx + 2] = clamp(data[nIdx + 2] + errB * 7 / 16);
        }
        if (x - 1 >= 0 && y + 1 < height) {
          const nIdx = (y + 1) * width * 4 + (x - 1) * 4;
          data[nIdx] = clamp(data[nIdx] + errR * 3 / 16);
          data[nIdx + 1] = clamp(data[nIdx + 1] + errG * 3 / 16);
          data[nIdx + 2] = clamp(data[nIdx + 2] + errB * 3 / 16);
        }
        if (y + 1 < height) {
          const nIdx = (y + 1) * width * 4 + x * 4;
          data[nIdx] = clamp(data[nIdx] + errR * 5 / 16);
          data[nIdx + 1] = clamp(data[nIdx + 1] + errG * 5 / 16);
          data[nIdx + 2] = clamp(data[nIdx + 2] + errB * 5 / 16);
        }
        if (x + 1 < width && y + 1 < height) {
          const nIdx = (y + 1) * width * 4 + (x + 1) * 4;
          data[nIdx] = clamp(data[nIdx] + errR * 1 / 16);
          data[nIdx + 1] = clamp(data[nIdx + 1] + errG * 1 / 16);
          data[nIdx + 2] = clamp(data[nIdx + 2] + errB * 1 / 16);
        }
      }
    }
    console.log("floydSteinberg done");
    return imageData;
  }

  function orderedDither(imageData, matrixSize) {
    console.log("orderedDither called with size", matrixSize);
    const data = imageData.data;
    const width = imageData.width;
    const height = imageData.height;
    let matrix, dim;
    if (matrixSize === 2) {
      dim = 2;
      matrix = [0, 2, 3, 1];
    } else if (matrixSize === 8) {
      dim = 8;
      matrix = [0,32,8,40,2,34,10,42,48,16,56,24,50,18,58,26,12,44,4,36,14,46,6,38,60,28,52,20,62,30,54,22,3,35,11,43,1,33,9,41,51,19,59,27,49,17,57,25,15,47,7,39,13,45,5,37,63,31,55,23,61,29,53,21];
    } else {
      dim = 4;
      matrix = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
    }
    const scale = 255 / (dim * dim);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        if (data[idx + 3] === 0) continue;
        const threshold = matrix[(y % dim) * dim + (x % dim)] * scale;
        data[idx] = data[idx] > threshold ? 255 : 0;
        data[idx + 1] = data[idx + 1] > threshold ? 255 : 0;
        data[idx + 2] = data[idx + 2] > threshold ? 255 : 0;
      }
    }
    console.log("orderedDither done");
    return imageData;
  }

  function thresholdDither(imageData, levels) {
    console.log("thresholdDither called with levels", levels);
    const data = imageData.data;
    const step = 255 / (levels - 1);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue;
      for (let c = 0; c < 3; c++) {
        const v = data[i + c];
        data[i + c] = Math.round(Math.round(v / step) * step);
      }
    }
    console.log("thresholdDither done");
    return imageData;
  }

  // ========== APPLY EFFECT ==========
  async function applyToTarget(runtime, target, effectFunc, ...args) {
    console.log("applyToTarget called with effect", effectFunc.name, args);
    const renderer = runtime.renderer;
    if (!renderer) throw new Error("No renderer");
    const costume = target.sprite.costumes_[target.currentCostume];
    if (!costume) throw new Error("No costume");
    console.log("Costume", costume.name);
    const { imageData, scale } = await rasteriseCostume(costume, 2);
    console.log("ImageData size", imageData.width, imageData.height);
    effectFunc(imageData, ...args);
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    const skinResolution = (costume.bitmapResolution || 1) * scale;
    const skinId = renderer.createBitmapSkin(canvas, skinResolution);
    renderer.updateDrawableSkinId(target.drawableID, skinId);
    if (target._degradeSkin) {
      try { renderer.destroySkin(target._degradeSkin); } catch(e) {}
    }
    target._degradeSkin = skinId;
    console.log("New skin created", skinId);
  }

  // ========== EXTENSION ==========
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
          {
            opcode: "testRed",
            blockType: Scratch.BlockType.COMMAND,
            text: "TEST: turn [TARGET] red",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } }
          },
          {
            opcode: "floydSteinberg",
            blockType: Scratch.BlockType.COMMAND,
            text: "Floyd-Steinberg dither [TARGET] to [LEVELS] levels",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              LEVELS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 4 }
            }
          },
          {
            opcode: "orderedDither",
            blockType: Scratch.BlockType.COMMAND,
            text: "Ordered dither [TARGET] with matrix size [SIZE]",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              SIZE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 4 }
            }
          },
          {
            opcode: "thresholdDither",
            blockType: Scratch.BlockType.COMMAND,
            text: "Threshold dither [TARGET] to [LEVELS] levels",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              LEVELS: { type: Scratch.ArgumentType.NUMBER, defaultValue: 4 }
            }
          },
          {
            opcode: "reset",
            blockType: Scratch.BlockType.COMMAND,
            text: "reset [TARGET]",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } }
          }
        ]
      };
    }
    _resolveTarget(args, util) {
      const name = args.TARGET;
      if (!name || name === "_myself_") return util.target;
      if (name === "_stage_") return this.runtime.getTargetForStage();
      return this.runtime.getSpriteTargetByName(name) || util.target;
    }
    async testRed(args, util) {
      console.log("testRed block clicked");
      const target = this._resolveTarget(args, util);
      await applyToTarget(this.runtime, target, (imgData) => {
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i+3] !== 0) {
            data[i] = 255;
            data[i+1] = 0;
            data[i+2] = 0;
          }
        }
      });
    }
    async floydSteinberg(args, util) {
      console.log("floydSteinberg block clicked");
      const target = this._resolveTarget(args, util);
      const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
      await applyToTarget(this.runtime, target, floydSteinberg, levels);
    }
    async orderedDither(args, util) {
      console.log("orderedDither block clicked");
      const target = this._resolveTarget(args, util);
      let size = Number(args.SIZE);
      if (size !== 2 && size !== 8) size = 4;
      await applyToTarget(this.runtime, target, orderedDither, size);
    }
    async thresholdDither(args, util) {
      console.log("thresholdDither block clicked");
      const target = this._resolveTarget(args, util);
      const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
      await applyToTarget(this.runtime, target, thresholdDither, levels);
    }
    async reset(args, util) {
      console.log("reset block clicked");
      const target = this._resolveTarget(args, util);
      const renderer = this.runtime.renderer;
      if (target._degradeSkin) {
        try { renderer.destroySkin(target._degradeSkin); } catch(e) {}
        delete target._degradeSkin;
      }
      const costume = target.sprite.costumes_[target.currentCostume];
      if (costume && renderer) {
        renderer.updateDrawableSkinId(target.drawableID, costume.skinId);
      }
    }
  }

  Scratch.extensions.register(new ColourDEgrade(Scratch.vm.runtime));
})(Scratch);