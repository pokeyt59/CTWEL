// Name: Colour DEgrade (Debug)
// Description: Simplified dithering with console logging.
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    console.error("Colour DEgrade: Must run unsandboxed!");
    throw new Error("Colour DEgrade must run unsandboxed.");
  }

  console.log("Colour DEgrade loading...");

  // Simple canvas pool
  const canvasPool = new Map();
  function getCanvas(w, h) {
    const key = w + "|" + h;
    if (!canvasPool.has(key)) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      canvasPool.set(key, c);
    }
    return canvasPool.get(key);
  }

  // Rasterise a costume to ImageData
  async function rasteriseCostume(costume, scale) {
    console.log("rasteriseCostume", costume, scale);
    const asset = costume.asset;
    if (!asset) throw new Error("No asset");
    const isSvg = asset.assetType?.contentType === "image/svg+xml";
    const finalScale = scale > 0 ? scale : (isSvg ? 4 : 2);
    // Use blob + Image
    const blob = new Blob([isSvg ? asset.decodeText() : asset.data], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    URL.revokeObjectURL(url);
    const w = Math.max(1, Math.round(img.width * finalScale));
    const h = Math.max(1, Math.round(img.height * finalScale));
    const canvas = getCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  // Apply dithering (simple threshold for testing)
  function applySimpleDither(imageData, levels) {
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

  // Core effect application
  async function applyEffect(target, effectFunc) {
    const runtime = Scratch.vm.runtime;
    const renderer = runtime.renderer;
    if (!renderer) throw new Error("No renderer");
    const costume = target.sprite.costumes_[target.currentCostume];
    if (!costume) throw new Error("No costume");
    const scale = 2; // simple fixed scale
    const imageData = await rasteriseCostume(costume, scale);
    effectFunc(imageData);
    const canvas = getCanvas(imageData.width, imageData.height);
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    const skinId = renderer.createBitmapSkin(canvas, costume.bitmapResolution * scale);
    renderer.updateDrawableSkinId(target.drawableID, skinId);
    // store for cleanup (optional)
    if (target._degradeSkin) {
      try { renderer.destroySkin(target._degradeSkin); } catch(e) {}
    }
    target._degradeSkin = skinId;
  }

  class ColourDEgrade {
    constructor(runtime) {
      this.runtime = runtime;
      console.log("Colour DEgrade constructed");
    }

    getInfo() {
      return {
        id: "ColourDEgrade",
        name: "Colour DEgrade",
        color1: "#7B4FE0",
        blocks: [
          {
            opcode: "testRed",
            blockType: Scratch.BlockType.COMMAND,
            text: "TEST: make [TARGET] RED",
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" }
            }
          },
          {
            opcode: "ditherTest",
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
            arguments: {
              TARGET: { type: Scratch.ArgumentType.STRING, defaultValue: "_myself_" }
            }
          }
        ]
      };
    }

    _resolveTarget(args, util) {
      let name = args.TARGET;
      if (!name || name === "_myself_") return util.target;
      if (name === "_stage_") return this.runtime.getTargetForStage();
      return this.runtime.getSpriteTargetByName(name) || util.target;
    }

    async testRed(args, util) {
      console.log("testRed called");
      const target = this._resolveTarget(args, util);
      await applyEffect(target, (imgData) => {
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i+3] === 0) continue;
          data[i] = 255;     // R
          data[i+1] = 0;     // G
          data[i+2] = 0;     // B
        }
      });
    }

    async ditherTest(args, util) {
      console.log("ditherTest called");
      const target = this._resolveTarget(args, util);
      const levels = Math.max(2, Math.min(256, Number(args.LEVELS)));
      await applyEffect(target, (imgData) => {
        applySimpleDither(imgData, levels);
      });
    }

    async reset(args, util) {
      console.log("reset called");
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
  console.log("Colour DEgrade registered");
})(Scratch);