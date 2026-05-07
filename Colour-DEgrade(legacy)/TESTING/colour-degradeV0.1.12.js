// Name: Colour DEgrade
// Description: Runtime dithering for sprite images with multiple algorithms (Floyd-Steinberg, Bayer, Atkinson, Sierra).
// By: Claude
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Colour DEgrade must run unsandboxed.");
  }

  // ── CONSTANTS ────────────────────────────────────────────────────────────
  
  // Bayer 4×4 matrix (pre-normalized to [0,1])
  const BAYER_4x4 = new Float32Array([
     0/16,  8/16,  2/16, 10/16,
    12/16,  4/16, 14/16,  6/16,
     3/16, 11/16,  1/16,  9/16,
    15/16,  7/16, 13/16,  5/16
  ]);

  // Floyd-Steinberg error diffusion kernel (right, down-left, down, down-right)
  const FS_KERNEL = new Float32Array([7/16, 3/16, 5/16, 1/16]);

  // Atkinson kernel (right, down-left, down, down-right, 2-down, 2-down-right)
  const ATKINSON_KERNEL = new Float32Array([1/8, 1/8, 1/8, 1/8, 1/8, 1/8]);

  // Sierra Lite kernel
  const SIERRA_KERNEL = new Float32Array([2/4, 1/4, 1/4]);

  // ── HELPERS ──────────────────────────────────────────────────────────────

  // Fast clamp to [0, 255] with bitwise rounding
  function clamp255(v) {
    return v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
  }

  // Find nearest color in a palette (Euclidean distance in RGB space)
  function findNearestColor(r, g, b, palette) {
    let minDist = Infinity;
    let bestIdx = 0;
    const plen = palette.length;
    
    for (let i = 0; i < plen; i += 3) {
      const dr = r - palette[i];
      const dg = g - palette[i + 1];
      const db = b - palette[i + 2];
      const dist = dr * dr + dg * dg + db * db;
      
      if (dist < minDist) {
        minDist = dist;
        bestIdx = i;
        if (dist === 0) break; // exact match
      }
    }
    
    return bestIdx;
  }

  // Build a palette from a bit depth (1-8 bits per channel)
  function buildPalette(bits) {
    bits = Math.max(1, Math.min(8, bits));
    const levels = 1 << bits; // 2^bits
    const step = 255 / (levels - 1);
    const palette = new Uint8Array(levels * levels * levels * 3);
    let idx = 0;
    
    for (let ri = 0; ri < levels; ri++) {
      const r = (ri * step + 0.5) | 0;
      for (let gi = 0; gi < levels; gi++) {
        const g = (gi * step + 0.5) | 0;
        for (let bi = 0; bi < levels; bi++) {
          const b = (bi * step + 0.5) | 0;
          palette[idx++] = r;
          palette[idx++] = g;
          palette[idx++] = b;
        }
      }
    }
    
    return palette;
  }

  // ── DITHERING ALGORITHMS ─────────────────────────────────────────────────

  // Ordered dithering (Bayer 4×4)
  function ditherBayer(imageData, bits) {
    const src = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const out = new ImageData(w, h);
    const dst = out.data;
    const palette = buildPalette(bits);
    const threshold = 255 / ((1 << bits) - 1);
    
    for (let y = 0; y < h; y++) {
      const by = (y & 3) << 2; // (y % 4) * 4
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) << 2;
        const a = src[i + 3];
        
        if (a === 0) continue; // dst already zero
        
        const bx = x & 3; // x % 4
        const bayerValue = BAYER_4x4[by + bx];
        
        const r = src[i];
        const g = src[i + 1];
        const b = src[i + 2];
        
        // Apply Bayer threshold
        const nr = clamp255(r + threshold * (bayerValue - 0.5));
        const ng = clamp255(g + threshold * (bayerValue - 0.5));
        const nb = clamp255(b + threshold * (bayerValue - 0.5));
        
        // Find nearest palette color
        const pidx = findNearestColor(nr, ng, nb, palette);
        dst[i]     = palette[pidx];
        dst[i + 1] = palette[pidx + 1];
        dst[i + 2] = palette[pidx + 2];
        dst[i + 3] = a;
      }
    }
    
    return out;
  }

  // Floyd-Steinberg error diffusion
  function ditherFloydSteinberg(imageData, bits) {
    const w = imageData.width;
    const h = imageData.height;
    const out = new ImageData(w, h);
    const dst = out.data;
    const palette = buildPalette(bits);
    
    // Working buffer with error accumulation (RGB as floats)
    const buf = new Float32Array(w * h * 3);
    const src = imageData.data;
    
    // Initialize buffer from source
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) << 2;
        const bi = (y * w + x) * 3;
        buf[bi]     = src[i];
        buf[bi + 1] = src[i + 1];
        buf[bi + 2] = src[i + 2];
      }
    }
    
    // Error diffusion pass
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) << 2;
        const bi = (y * w + x) * 3;
        const a = src[i + 3];
        
        if (a === 0) continue; // dst already zero
        
        const r = clamp255(buf[bi]);
        const g = clamp255(buf[bi + 1]);
        const b = clamp255(buf[bi + 2]);
        
        // Find nearest palette color
        const pidx = findNearestColor(r, g, b, palette);
        const nr = palette[pidx];
        const ng = palette[pidx + 1];
        const nb = palette[pidx + 2];
        
        dst[i]     = nr;
        dst[i + 1] = ng;
        dst[i + 2] = nb;
        dst[i + 3] = a;
        
        // Compute error
        const er = buf[bi] - nr;
        const eg = buf[bi + 1] - ng;
        const eb = buf[bi + 2] - nb;
        
        // Diffuse error (Floyd-Steinberg pattern)
        if (x + 1 < w) {
          const ri = bi + 3;
          buf[ri]     += er * FS_KERNEL[0];
          buf[ri + 1] += eg * FS_KERNEL[0];
          buf[ri + 2] += eb * FS_KERNEL[0];
        }
        if (y + 1 < h) {
          if (x > 0) {
            const dli = bi + w * 3 - 3;
            buf[dli]     += er * FS_KERNEL[1];
            buf[dli + 1] += eg * FS_KERNEL[1];
            buf[dli + 2] += eb * FS_KERNEL[1];
          }
          const di = bi + w * 3;
          buf[di]     += er * FS_KERNEL[2];
          buf[di + 1] += eg * FS_KERNEL[2];
          buf[di + 2] += eb * FS_KERNEL[2];
          
          if (x + 1 < w) {
            const dri = bi + w * 3 + 3;
            buf[dri]     += er * FS_KERNEL[3];
            buf[dri + 1] += eg * FS_KERNEL[3];
            buf[dri + 2] += eb * FS_KERNEL[3];
          }
        }
      }
    }
    
    return out;
  }

  // Atkinson dithering
  function ditherAtkinson(imageData, bits) {
    const w = imageData.width;
    const h = imageData.height;
    const out = new ImageData(w, h);
    const dst = out.data;
    const palette = buildPalette(bits);
    
    const buf = new Float32Array(w * h * 3);
    const src = imageData.data;
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) << 2;
        const bi = (y * w + x) * 3;
        buf[bi]     = src[i];
        buf[bi + 1] = src[i + 1];
        buf[bi + 2] = src[i + 2];
      }
    }
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) << 2;
        const bi = (y * w + x) * 3;
        const a = src[i + 3];
        
        if (a === 0) continue;
        
        const r = clamp255(buf[bi]);
        const g = clamp255(buf[bi + 1]);
        const b = clamp255(buf[bi + 2]);
        
        const pidx = findNearestColor(r, g, b, palette);
        const nr = palette[pidx];
        const ng = palette[pidx + 1];
        const nb = palette[pidx + 2];
        
        dst[i]     = nr;
        dst[i + 1] = ng;
        dst[i + 2] = nb;
        dst[i + 3] = a;
        
        const er = buf[bi] - nr;
        const eg = buf[bi + 1] - ng;
        const eb = buf[bi + 2] - nb;
        
        // Atkinson pattern: right, down-left, down, down-right, 2-down, 2-down-right
        if (x + 1 < w) {
          const ri = bi + 3;
          buf[ri]     += er * ATKINSON_KERNEL[0];
          buf[ri + 1] += eg * ATKINSON_KERNEL[0];
          buf[ri + 2] += eb * ATKINSON_KERNEL[0];
        }
        if (y + 1 < h) {
          if (x > 0) {
            const dli = bi + w * 3 - 3;
            buf[dli]     += er * ATKINSON_KERNEL[1];
            buf[dli + 1] += eg * ATKINSON_KERNEL[1];
            buf[dli + 2] += eb * ATKINSON_KERNEL[1];
          }
          const di = bi + w * 3;
          buf[di]     += er * ATKINSON_KERNEL[2];
          buf[di + 1] += eg * ATKINSON_KERNEL[2];
          buf[di + 2] += eb * ATKINSON_KERNEL[2];
          
          if (x + 1 < w) {
            const dri = bi + w * 3 + 3;
            buf[dri]     += er * ATKINSON_KERNEL[3];
            buf[dri + 1] += eg * ATKINSON_KERNEL[3];
            buf[dri + 2] += eb * ATKINSON_KERNEL[3];
          }
        }
        if (y + 2 < h) {
          const d2i = bi + w * 6;
          buf[d2i]     += er * ATKINSON_KERNEL[4];
          buf[d2i + 1] += eg * ATKINSON_KERNEL[4];
          buf[d2i + 2] += eb * ATKINSON_KERNEL[4];
          
          if (x + 1 < w) {
            const d2ri = bi + w * 6 + 3;
            buf[d2ri]     += er * ATKINSON_KERNEL[5];
            buf[d2ri + 1] += eg * ATKINSON_KERNEL[5];
            buf[d2ri + 2] += eb * ATKINSON_KERNEL[5];
          }
        }
      }
    }
    
    return out;
  }

  // Sierra Lite dithering (simpler, faster)
  function ditherSierra(imageData, bits) {
    const w = imageData.width;
    const h = imageData.height;
    const out = new ImageData(w, h);
    const dst = out.data;
    const palette = buildPalette(bits);
    
    const buf = new Float32Array(w * h * 3);
    const src = imageData.data;
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) << 2;
        const bi = (y * w + x) * 3;
        buf[bi]     = src[i];
        buf[bi + 1] = src[i + 1];
        buf[bi + 2] = src[i + 2];
      }
    }
    
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) << 2;
        const bi = (y * w + x) * 3;
        const a = src[i + 3];
        
        if (a === 0) continue;
        
        const r = clamp255(buf[bi]);
        const g = clamp255(buf[bi + 1]);
        const b = clamp255(buf[bi + 2]);
        
        const pidx = findNearestColor(r, g, b, palette);
        const nr = palette[pidx];
        const ng = palette[pidx + 1];
        const nb = palette[pidx + 2];
        
        dst[i]     = nr;
        dst[i + 1] = ng;
        dst[i + 2] = nb;
        dst[i + 3] = a;
        
        const er = buf[bi] - nr;
        const eg = buf[bi + 1] - ng;
        const eb = buf[bi + 2] - nb;
        
        // Sierra Lite: right, down-left, down
        if (x + 1 < w) {
          const ri = bi + 3;
          buf[ri]     += er * SIERRA_KERNEL[0];
          buf[ri + 1] += eg * SIERRA_KERNEL[0];
          buf[ri + 2] += eb * SIERRA_KERNEL[0];
        }
        if (y + 1 < h) {
          if (x > 0) {
            const dli = bi + w * 3 - 3;
            buf[dli]     += er * SIERRA_KERNEL[1];
            buf[dli + 1] += eg * SIERRA_KERNEL[1];
            buf[dli + 2] += eb * SIERRA_KERNEL[1];
          }
          const di = bi + w * 3;
          buf[di]     += er * SIERRA_KERNEL[2];
          buf[di + 1] += eg * SIERRA_KERNEL[2];
          buf[di + 2] += eb * SIERRA_KERNEL[2];
        }
      }
    }
    
    return out;
  }

  // Simple threshold dithering (no error diffusion)
  function ditherThreshold(imageData, bits) {
    const src = imageData.data;
    const w = imageData.width;
    const h = imageData.height;
    const out = new ImageData(w, h);
    const dst = out.data;
    const palette = buildPalette(bits);
    
    for (let i = 0; i < src.length; i += 4) {
      const a = src[i + 3];
      if (a === 0) continue;
      
      const r = src[i];
      const g = src[i + 1];
      const b = src[i + 2];
      
      const pidx = findNearestColor(r, g, b, palette);
      dst[i]     = palette[pidx];
      dst[i + 1] = palette[pidx + 1];
      dst[i + 2] = palette[pidx + 2];
      dst[i + 3] = a;
    }
    
    return out;
  }

  // ── STATE ────────────────────────────────────────────────────────────────
  
  // Cache for rasterized costumes: WeakMap<costume> -> Promise<ImageData>
  const rasterCache = new WeakMap();

  // ── RASTERIZATION ────────────────────────────────────────────────────────

  async function rasterizeCostume(costume) {
    if (rasterCache.has(costume)) {
      return rasterCache.get(costume);
    }

    const asset = costume.asset;
    const rotationCenterX = costume.rotationCenterX || 0;
    const rotationCenterY = costume.rotationCenterY || 0;

    const promise = (async () => {
      let bitmap;
      
      if (asset.assetType && asset.assetType.contentType === "image/svg+xml") {
        // SVG: decode, create blob, load as image
        const svgText = asset.decodeText();
        const blob = new Blob([svgText], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        
        try {
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
          });
          
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          bitmap = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } finally {
          URL.revokeObjectURL(url);
        }
      } else {
        // Bitmap: create blob from asset.data
        const blob = new Blob([asset.data], { type: asset.assetType ? asset.assetType.contentType : "image/png" });
        const url = URL.createObjectURL(blob);
        
        try {
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = url;
          });
          
          const canvas = document.createElement("canvas");
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0);
          bitmap = ctx.getImageData(0, 0, canvas.width, canvas.height);
        } finally {
          URL.revokeObjectURL(url);
        }
      }

      return bitmap;
    })();

    rasterCache.set(costume, promise);
    return promise;
  }

  // ── EXTENSION CLASS ──────────────────────────────────────────────────────

  class ColourDEgrade {
    constructor(runtime) {
      this.runtime = runtime;
    }

    getInfo() {
      return {
        id: "colourdegrade",
        name: "Colour DEgrade",
        color1: "#9966FF",
        color2: "#774DC2",
        blocks: [
          {
            opcode: "ditherSprite",
            blockType: Scratch.BlockType.COMMAND,
            text: "dither [TARGET] with [ALGORITHM] [BITS] bits/channel",
            arguments: {
              TARGET: {
                type: Scratch.ArgumentType.STRING,
                menu: "targets",
                defaultValue: "_myself_",
              },
              ALGORITHM: {
                type: Scratch.ArgumentType.STRING,
                menu: "algorithms",
                defaultValue: "floyd-steinberg",
              },
              BITS: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 2,
              },
            },
          },
          "---",
          {
            opcode: "ditherCostume",
            blockType: Scratch.BlockType.COMMAND,
            text: "dither costume [COSTUME] of [TARGET] with [ALGORITHM] [BITS] bits/channel",
            arguments: {
              COSTUME: {
                type: Scratch.ArgumentType.STRING,
                defaultValue: "costume1",
              },
              TARGET: {
                type: Scratch.ArgumentType.STRING,
                menu: "targets",
                defaultValue: "_myself_",
              },
              ALGORITHM: {
                type: Scratch.ArgumentType.STRING,
                menu: "algorithms",
                defaultValue: "floyd-steinberg",
              },
              BITS: {
                type: Scratch.ArgumentType.NUMBER,
                defaultValue: 2,
              },
            },
          },
        ],
        menus: {
          targets: {
            acceptReporters: true,
            items: "_getTargets",
          },
          algorithms: {
            acceptReporters: true,
            items: [
              { text: "Floyd-Steinberg", value: "floyd-steinberg" },
              { text: "Bayer", value: "bayer" },
              { text: "Atkinson", value: "atkinson" },
              { text: "Sierra Lite", value: "sierra" },
              { text: "Threshold", value: "threshold" },
            ],
          },
        },
      };
    }

    _getTargets() {
      const targets = [{ text: "myself", value: "_myself_" }];
      const stage = this.runtime.getTargetForStage();
      if (stage) targets.push({ text: "Stage", value: "_stage_" });
      
      for (const target of this.runtime.targets) {
        if (target.isOriginal && !target.isStage) {
          targets.push({ text: target.getName(), value: target.getName() });
        }
      }
      
      return targets;
    }

    _resolveTarget(args, util) {
      const name = String(args.TARGET);
      if (!name || name === "_myself_") return util.target;
      if (name === "_stage_") return this.runtime.getTargetForStage();
      return this.runtime.getSpriteTargetByName(name) || util.target;
    }

    async ditherSprite(args, util) {
      const target = this._resolveTarget(args, util);
      const algorithm = String(args.ALGORITHM);
      const bits = Math.max(1, Math.min(8, Math.round(Number(args.BITS))));
      
      const costumeList = target.sprite ? target.sprite.costumes_ : target.getCostumes();
      if (!costumeList || costumeList.length === 0) return;
      
      const costume = costumeList[target.currentCostume];
      if (!costume) return;
      
      await this._ditherCostume(target, costume, algorithm, bits);
    }

    async ditherCostume(args, util) {
      const target = this._resolveTarget(args, util);
      const costumeName = String(args.COSTUME);
      const algorithm = String(args.ALGORITHM);
      const bits = Math.max(1, Math.min(8, Math.round(Number(args.BITS))));
      
      const costumeList = target.sprite ? target.sprite.costumes_ : target.getCostumes();
      if (!costumeList) return;
      
      const costume = costumeList.find(c => c.name === costumeName);
      if (!costume) return;
      
      await this._ditherCostume(target, costume, algorithm, bits);
    }

    async _ditherCostume(target, costume, algorithm, bits) {
      // Rasterize costume to ImageData
      const imageData = await rasterizeCostume(costume);
      
      // Apply dithering
      let dithered;
      switch (algorithm) {
        case "floyd-steinberg":
          dithered = ditherFloydSteinberg(imageData, bits);
          break;
        case "bayer":
          dithered = ditherBayer(imageData, bits);
          break;
        case "atkinson":
          dithered = ditherAtkinson(imageData, bits);
          break;
        case "sierra":
          dithered = ditherSierra(imageData, bits);
          break;
        case "threshold":
          dithered = ditherThreshold(imageData, bits);
          break;
        default:
          dithered = ditherFloydSteinberg(imageData, bits);
      }
      
      // Create canvas from dithered ImageData
      const canvas = document.createElement("canvas");
      canvas.width = dithered.width;
      canvas.height = dithered.height;
      const ctx = canvas.getContext("2d");
      ctx.putImageData(dithered, 0, 0);
      
      // Create new skin from canvas
      const renderer = this.runtime.renderer;
      const skinId = renderer.createBitmapSkin(canvas, 1);
      
      // Update sprite's skin
      renderer.updateDrawableSkinId(target.drawableID, skinId);
      
      // Invalidate cache for this costume so re-application works
      rasterCache.delete(costume);
    }
  }

  Scratch.extensions.register(new ColourDEgrade(Scratch.vm.runtime));
})(Scratch);
