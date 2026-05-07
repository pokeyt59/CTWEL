// Name: Touch Sprite
// ID: touchSpriteGestures
// Description: Two-finger pinch resizes a sprite, two-finger double-tap duplicates it. Works on clones too.
// By: Claude (vibe-coded)
// License: MIT

(function (Scratch) {
  "use strict";

  if (!Scratch.extensions.unsandboxed) {
    throw new Error("Touch Sprite must run unsandboxed.");
  }

  const vm = Scratch.vm;
  const runtime = vm.runtime;

  // Sprite names whose targets (and clones) respond to gestures.
  const enabledSpriteNames = new Set();

  // Resize bounds (percent). Scratch's setSize will further clamp these.
  let minScale = 5;
  let maxScale = 1000;

  // Gesture timing/threshold constants.
  const TAP_MAX_DURATION = 300;   // ms, max length of a single 2-finger tap
  const TAP_MAX_MOVEMENT = 20;    // CSS px, max finger drift to still count as a tap
  const DOUBLE_TAP_GAP = 500;     // ms, max gap between the two 2-finger taps

  // Active gesture and last-tap tracking.
  let gesture = null;
  let lastTap = null;
  let canvas = null;

  function getCanvas() {
    if (canvas && document.contains(canvas)) return canvas;
    const r = runtime.renderer;
    if (r) {
      if (r.canvas) canvas = r.canvas;
      else if (r.gl && r.gl.canvas) canvas = r.gl.canvas;
    }
    return canvas;
  }

  function isEnabledTarget(target) {
    if (!target || target.isStage || !target.sprite) return false;
    return enabledSpriteNames.has(target.sprite.name);
  }

  function clientToCanvas(clientX, clientY) {
    const c = getCanvas();
    if (!c) return null;
    const rect = c.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function pickTarget(canvasX, canvasY) {
    const r = runtime.renderer;
    if (!r) return null;
    let drawableID;
    try {
      drawableID = r.pick(canvasX, canvasY);
    } catch (_) {
      return null;
    }
    if (drawableID == null || drawableID < 0) return null;
    for (const t of runtime.targets) {
      if (t.drawableID === drawableID) return t;
    }
    return null;
  }

  function distance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  function midpoint(p1, p2) {
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  }

  function findTouch(touchList, id) {
    for (let i = 0; i < touchList.length; i++) {
      if (touchList[i].identifier === id) return touchList[i];
    }
    return null;
  }

  function targetExists(target) {
    return target && runtime.targets.indexOf(target) !== -1;
  }

  function duplicateTarget(target) {
    if (!target || target.isStage) return null;
    if (!targetExists(target)) return null;
    if (typeof target.makeClone !== "function") return null;
    const clone = target.makeClone();
    if (!clone) return null;
    runtime.addTarget(clone);
    if (typeof clone.goBehindOther === "function") clone.goBehindOther(target);
    if (typeof runtime.startHats === "function") {
      runtime.startHats("control_start_as_clone", null, clone);
    }
    return clone;
  }

  function onTouchStart(e) {
    if (e.touches.length !== 2) return;
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    const p1 = clientToCanvas(t1.clientX, t1.clientY);
    const p2 = clientToCanvas(t2.clientX, t2.clientY);
    if (!p1 || !p2) return;

    const mid = midpoint(p1, p2);
    let target = pickTarget(mid.x, mid.y);
    if (!isEnabledTarget(target)) target = pickTarget(p1.x, p1.y);
    if (!isEnabledTarget(target)) target = pickTarget(p2.x, p2.y);
    if (!isEnabledTarget(target)) return;

    gesture = {
      startTime: Date.now(),
      finger1Id: t1.identifier,
      finger2Id: t2.identifier,
      finger1Start: p1,
      finger2Start: p2,
      target,
      initialDistance: distance(p1, p2),
      initialSize: target.size,
      mode: "pending",
      moved: false
    };
    if (e.cancelable) e.preventDefault();
  }

  function onTouchMove(e) {
    if (!gesture) return;
    const t1 = findTouch(e.touches, gesture.finger1Id);
    const t2 = findTouch(e.touches, gesture.finger2Id);
    if (!t1 || !t2) return;
    const p1 = clientToCanvas(t1.clientX, t1.clientY);
    const p2 = clientToCanvas(t2.clientX, t2.clientY);
    if (!p1 || !p2) return;

    const drift = Math.max(
      distance(p1, gesture.finger1Start),
      distance(p2, gesture.finger2Start)
    );
    if (drift > TAP_MAX_MOVEMENT) gesture.moved = true;

    if (gesture.mode === "pending") {
      const longEnough = (Date.now() - gesture.startTime) > TAP_MAX_DURATION;
      if (gesture.moved || longEnough) gesture.mode = "pinch";
    }

    if (gesture.mode === "pinch") {
      if (e.cancelable) e.preventDefault();
      if (gesture.initialDistance > 0 && targetExists(gesture.target)) {
        const ratio = distance(p1, p2) / gesture.initialDistance;
        let newSize = gesture.initialSize * ratio;
        if (Number.isFinite(newSize)) {
          newSize = Math.max(minScale, Math.min(maxScale, newSize));
          try { gesture.target.setSize(newSize); } catch (_) {}
        }
      }
    }
  }

  function onTouchEnd(e) {
    if (!gesture) return;

    if (gesture.mode === "pending" && !gesture.moved) {
      const duration = Date.now() - gesture.startTime;
      if (duration <= TAP_MAX_DURATION) {
        const now = Date.now();
        if (
          lastTap &&
          lastTap.target === gesture.target &&
          targetExists(gesture.target) &&
          now - lastTap.time <= DOUBLE_TAP_GAP
        ) {
          duplicateTarget(gesture.target);
          lastTap = null;
        } else {
          lastTap = { time: now, target: gesture.target };
        }
      }
    }

    const f1 = findTouch(e.touches, gesture.finger1Id);
    const f2 = findTouch(e.touches, gesture.finger2Id);
    if (!f1 || !f2) gesture = null;
  }

  function attach() {
    const c = getCanvas();
    if (!c) return false;
    if (c.__touchSpriteAttached) return true;
    c.__touchSpriteAttached = true;
    const opts = { passive: false };
    c.addEventListener("touchstart", onTouchStart, opts);
    c.addEventListener("touchmove", onTouchMove, opts);
    c.addEventListener("touchend", onTouchEnd, opts);
    c.addEventListener("touchcancel", onTouchEnd, opts);
    return true;
  }

  if (!attach()) {
    const interval = setInterval(() => { if (attach()) clearInterval(interval); }, 200);
  }

  if (typeof runtime.on === "function") {
    runtime.on("PROJECT_STOP_ALL", () => {
      gesture = null;
      lastTap = null;
    });
  }

  class TouchSprite {
    getInfo() {
      return {
        id: "touchSpriteGestures",
        name: "Touch Sprite",
        color1: "#3FA9F5",
        color2: "#2A8AD0",
        blocks: [
          {
            opcode: "enableThis",
            blockType: Scratch.BlockType.COMMAND,
            text: "enable touch resize and duplicate for this sprite"
          },
          {
            opcode: "disableThis",
            blockType: Scratch.BlockType.COMMAND,
            text: "disable touch resize and duplicate for this sprite"
          },
          {
            opcode: "isEnabled",
            blockType: Scratch.BlockType.BOOLEAN,
            text: "touch gestures enabled for this sprite?"
          },
          "---",
          {
            opcode: "setBounds",
            blockType: Scratch.BlockType.COMMAND,
            text: "set resize bounds: min [MIN]% max [MAX]%",
            arguments: {
              MIN: { type: Scratch.ArgumentType.NUMBER, defaultValue: 5 },
              MAX: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1000 }
            }
          },
          "---",
          {
            opcode: "duplicateNow",
            blockType: Scratch.BlockType.COMMAND,
            text: "duplicate this sprite now"
          }
        ]
      };
    }

    enableThis(_, util) {
      const t = util.target;
      if (!t || t.isStage || !t.sprite) return;
      enabledSpriteNames.add(t.sprite.name);
      attach();
    }

    disableThis(_, util) {
      const t = util.target;
      if (!t || t.isStage || !t.sprite) return;
      enabledSpriteNames.delete(t.sprite.name);
    }

    isEnabled(_, util) {
      const t = util.target;
      if (!t || t.isStage || !t.sprite) return false;
      return enabledSpriteNames.has(t.sprite.name);
    }

    setBounds(args) {
      const lo = Math.max(0, Number(args.MIN) || 0);
      const hi = Math.max(lo + 1, Number(args.MAX) || lo + 1);
      minScale = lo;
      maxScale = hi;
    }

    duplicateNow(_, util) {
      duplicateTarget(util.target);
    }
  }

  Scratch.extensions.register(new TouchSprite());
})(Scratch);
