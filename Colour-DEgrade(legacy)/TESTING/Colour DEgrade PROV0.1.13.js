(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Colour DEgrade must run unsandboxed.");
  }

  // ════════════════════════════════════════════════════════════════
  // INTERNAL CACHE (SAFE — NO COLLISION WITH COLOUR LAB)
  // ════════════════════════════════════════════════════════════════

  const localCache = new WeakMap();

  function getCached(target) {
    return localCache.get(target);
  }

  function setCached(target, data) {
    localCache.set(target, data);
  }

  // ════════════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════════════

  function clamp255(v) {
    return v <= 0 ? 0 : v >= 255 ? 255 : (v + 0.5) | 0;
  }

  function hexToRgb(hex) {
    hex = hex.replace("#", "");
    if (hex.length === 3) {
      hex = hex.split("").map(x => x + x).join("");
    }
    const n = parseInt(hex, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function nearestPaletteColor(r, g, b, palette) {
    let best = 0;
    let bestDist = 1e9;

    for (let i = 0; i < palette.length; i++) {
      const pr = palette[i][0];
      const pg = palette[i][1];
      const pb = palette[i][2];

      const dr = r - pr;
      const dg = g - pg;
      const db = b - pb;

      const dist = dr*dr + dg*dg + db*db;

      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }

    return palette[best];
  }

  // ════════════════════════════════════════════════════════════════
  // ORDERED DITHER (FAST)
  // ════════════════════════════════════════════════════════════════

  const BAYER = [
    [0,8,2,10],
    [12,4,14,6],
    [3,11,1,9],
    [15,7,13,5]
  ];

  function orderedDither(data, w, h, levels, strength, palette) {
    const inv = levels - 1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y*w + x)*4;
        if (data[i+3] === 0) continue;

        const t = (BAYER[y&3][x&3]/16 - 0.5) * strength;

        let r = data[i]   / 255 + t;
        let g = data[i+1] / 255 + t;
        let b = data[i+2] / 255 + t;

        r = Math.min(1, Math.max(0, r));
        g = Math.min(1, Math.max(0, g));
        b = Math.min(1, Math.max(0, b));

        if (palette) {
          const c = nearestPaletteColor(r*255,g*255,b*255,palette);
          data[i]=c[0]; data[i+1]=c[1]; data[i+2]=c[2];
        } else {
          data[i]   = clamp255(Math.round(r*inv)/inv*255);
          data[i+1] = clamp255(Math.round(g*inv)/inv*255);
          data[i+2] = clamp255(Math.round(b*inv)/inv*255);
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // FLOYD–STEINBERG (OPTIONAL)
  // ════════════════════════════════════════════════════════════════

  function diffusionDither(data, w, h, levels, palette) {
    const inv = levels - 1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y*w + x)*4;
        if (data[i+3] === 0) continue;

        let oldR = data[i];
        let oldG = data[i+1];
        let oldB = data[i+2];

        let newR, newG, newB;

        if (palette) {
          const c = nearestPaletteColor(oldR,oldG,oldB,palette);
          newR=c[0]; newG=c[1]; newB=c[2];
        } else {
          newR = Math.round(oldR/255*inv)/inv*255;
          newG = Math.round(oldG/255*inv)/inv*255;
          newB = Math.round(oldB/255*inv)/inv*255;
        }

        data[i]=newR; data[i+1]=newG; data[i+2]=newB;

        const errR = oldR - newR;
        const errG = oldG - newG;
        const errB = oldB - newB;

        function spread(ix, factor) {
          if (ix < 0 || ix >= data.length) return;
          data[ix]   = clamp255(data[ix]   + errR*factor);
          data[ix+1] = clamp255(data[ix+1] + errG*factor);
          data[ix+2] = clamp255(data[ix+2] + errB*factor);
        }

        spread(i+4,   7/16);
        spread(i+w*4-4, 3/16);
        spread(i+w*4,   5/16);
        spread(i+w*4+4, 1/16);
      }
    }
  }

  // ════════════════════════════════════════════════════════════════
  // CORE APPLY (CACHE-AWARE)
  // ════════════════════════════════════════════════════════════════

  async function getImage(runtime, target) {
    const cached = getCached(target);
    if (cached) return cached;

    const renderer = runtime.renderer;
    const drawable = renderer._allDrawables[target.drawableID];
    const skin = drawable._skin;

    const canvas = skin._canvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    const img = ctx.getImageData(0,0,canvas.width,canvas.height);

    const obj = { img, w: canvas.width, h: canvas.height };
    setCached(target, obj);
    return obj;
  }

  async function apply(runtime, target, imgData) {
    const renderer = runtime.renderer;

    const c = document.createElement("canvas");
    c.width = imgData.width;
    c.height = imgData.height;

    c.getContext("2d").putImageData(imgData,0,0);

    const id = renderer.createBitmapSkin(c,1);
    renderer.updateDrawableSkinId(target.drawableID,id);
  }

  // ════════════════════════════════════════════════════════════════
  // EXTENSION
  // ════════════════════════════════════════════════════════════════

  class ColourDEgradePRO {
    constructor(runtime) {
      this.runtime = runtime;
    }

    getInfo() {
      return {
        id: "colourDEgradePRO",
        name: "Colour DEgrade",
        blocks: [
          {
            opcode: "dither",
            blockType: Scratch.BlockType.COMMAND,
            text: "dither [TARGET] mode [MODE] levels [L] strength [S] palette [P]",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" },
              MODE:   { type: Scratch.ArgumentType.STRING, menu: "mode" },
              L:      { type: Scratch.ArgumentType.NUMBER, defaultValue: 4 },
              S:      { type: Scratch.ArgumentType.NUMBER, defaultValue: 0.5 },
              P:      { type: Scratch.ArgumentType.STRING, defaultValue: "" }
            }
          }
        ],
        menus: {
          mode: ["ordered","diffusion"]
        }
      };
    }

    async dither(args, util) {
      const target = args.TARGET === "_myself_" ? util.target :
        this.runtime.targets.find(t => t.getName && t.getName() === args.TARGET);

      if (!target) return;

      const { img, w, h } = await getImage(this.runtime, target);

      const data = new Uint8ClampedArray(img.data);
      const out = new ImageData(data, w, h);

      let palette = null;
      if (args.P.trim()) {
        palette = args.P.split(",").map(c => hexToRgb(c.trim()));
      }

      if (args.MODE === "diffusion") {
        diffusionDither(out.data, w, h, args.L | 0, palette);
      } else {
        orderedDither(out.data, w, h, args.L | 0, args.S, palette);
      }

      await apply(this.runtime, target, out);
    }
  }

  Scratch.extensions.register(new ColourDEgradePRO(Scratch.vm.runtime));

})(Scratch);