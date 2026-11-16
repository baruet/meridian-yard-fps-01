// input.js — keyboard + mouse capture for MERIDIAN YARD.
// The sim runs at a fixed 60 Hz, so clicks that land between steps must not
// be lost: keydown/mousedown set edge flags, and main.js clears them after
// each fixed step via clearEdges(). Held keys live on the input object and
// are sampled fresh by snapshot() every step.
export const LOOK_SENS = 0.0021;

export function createInput() {
  return {
    f: false, b: false, l: false, r: false,
    crouch: false, jump: false, walk: false,
    ads: false, use: false, fire: false,
    fireEdge: false, reloadEdge: false, fragEdge: false, smokeEdge: false,
    slot: -1, buyToggle: false, restartEdge: false,
    yawDelta: 0, pitchDelta: 0, locked: false,
  };
}

// Keys that stay held while pressed (code -> input field).
const HELD_KEYS = {
  KeyW: 'f', KeyS: 'b', KeyA: 'l', KeyD: 'r',
  ControlLeft: 'crouch', KeyC: 'crouch',
  ShiftLeft: 'walk', ShiftRight: 'walk',
  Space: 'jump', KeyE: 'use',
};

export function bindInput(input, canvas, onLockChange) {
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') e.preventDefault(); // never scroll the page on jump
    const held = HELD_KEYS[e.code];
    if (held) { input[held] = true; return; }
    if (e.code === 'KeyR') input.reloadEdge = true;
    else if (e.code === 'KeyG') input.fragEdge = true;
    else if (e.code === 'KeyQ') input.smokeEdge = true;
    else if (e.code === 'KeyB') input.buyToggle = true;
    else if (e.code === 'KeyM') input.restartEdge = true;
    else if (e.code === 'Digit1') input.slot = 0;
    else if (e.code === 'Digit2') input.slot = 1;
    else if (e.code === 'Digit3') input.slot = 2;
    else if (e.code === 'Digit4') input.slot = 3;
  });
  window.addEventListener('keyup', (e) => {
    const held = HELD_KEYS[e.code];
    if (held) input[held] = false;
  });
  // Losing the window must never leave a movement key stuck down.
  window.addEventListener('blur', () => {
    for (const k of ['f', 'b', 'l', 'r', 'crouch', 'jump', 'walk', 'use']) input[k] = false;
    input.fire = false; input.ads = false;
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (onLockChange) onLockChange(input.locked);
  });
  document.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.yawDelta -= e.movementX * LOOK_SENS;
    input.pitchDelta -= e.movementY * LOOK_SENS;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (!input.locked) {
      const lock = canvas.requestPointerLock();
      if (lock && lock.catch) lock.catch(() => {});
      return;
    }
    if (e.button === 0) { input.fire = true; input.fireEdge = true; }
    if (e.button === 2) input.ads = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.fire = false;
    if (e.button === 2) input.ads = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// One fixed step's worth of input: held keys plus this step's edges.
// `out` is a reusable object so the hot loop never allocates.
export function snapshot(input, out) {
  out.f = input.f; out.b = input.b; out.l = input.l; out.r = input.r;
  out.crouch = input.crouch; out.jump = input.jump; out.walk = input.walk;
  out.ads = input.ads; out.use = input.use;
  out.fire = input.fire || input.fireEdge;
  out.reload = input.reloadEdge;
  out.frag = input.fragEdge; out.smoke = input.smokeEdge;
  out.slot = input.slot;
  return out;
}

// Edges are single-step: call after every fixed step.
export function clearEdges(input) {
  input.fireEdge = false; input.reloadEdge = false;
  input.fragEdge = false; input.smokeEdge = false;
  input.slot = -1; input.buyToggle = false; input.restartEdge = false;
}
