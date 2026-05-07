// Name: Colour DEgrade (Stable)
// Description: Runtime dithering effects – fully compatible with Colour Lab V3.
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

  function getCostumeListForTarget(target) {
    return (target && (target.sprite ? target.sprite.costumes_ : target.costumes_)) || [];
  }

  function clearCostumeRasterCache(costume) {
    const entry = costume ? rasterCache.get(costume) : null;
    if (entry) {
      entry.version++;
      entry.map.clear();
    }
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

  // ========== DITHERING FUNCTIONS ==========
  function simpleDither(imageData, levels) {
    const data = imageData.data;
    const step = 255 / (levels - 1);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i+3] === 0) continue;
      for (let c = 0; c < 3; c++) {
        const v = data[i+c];
        data[i+c] = Math.round(Math.round(v / step) * step);
      }
    }
    return imageData;
  }

  // ========== APPLY EFFECT ==========
  async function applyToTarget(runtime, target, ditherFunc, ...args) {
    const renderer = runtime.renderer;
    if (!renderer) throw new Error("No renderer");
    const costume = target.sprite.costumes_[target.currentCostume];
    if (!costume) throw new Error("No costume");
    const { imageData, scale } = await rasteriseCostume(costume, 2); // fixed scale for reliability
    ditherFunc(imageData, ...args);
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    const skinResolution = (costume.bitmapResolution || 1) * scale;
    const skinId = renderer.createBitmapSkin(canvas, skinResolution);
    renderer.updateDrawableSkinId(target.drawableID, skinId);
    if (target._degradeSkin) renderer.destroySkin(target._degradeSkin);
    target._degradeSkin = skinId;
  }

  // ========== EXTENSION ==========
  class ColourDEgrade {
    constructor(runtime) { this.runtime = runtime; }
    getInfo() {
      return {
        id: "ColourDEgrade",
        name: "Colour DEgrade",
        color1: "#7B4FE0",
        blocks: [
          {
            opcode: "testRed",
            blockType: Scratch.BlockType.COMMAND,
            text: "TEST: turn [TARGET] red",
            arguments: { TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" } }
          },
          {
            opcode: "ditherSimple",
            blockType: Scratch.BlockType.COMMAND,
            text: "apply simple dither to [TARGET] with [LEVELS] levels",
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
    async ditherSimple(args, util) {
      const target = this._resolveTarget(args, util);
      const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
      await applyToTarget(this.runtime, target, simpleDither, levels);
    }
    async reset(args, util) {
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