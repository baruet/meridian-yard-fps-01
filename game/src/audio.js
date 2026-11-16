// audio.js — procedural sound, zero audio assets. Everything is synthesised
// with WebAudio: shots are filtered noise bursts, reloads are clicks, the
// explosion is a low thump, the planted charge beeps. The context is created
// lazily on the first user gesture (autoplay policy); the screenshot staging
// path never calls initAudio, so staged shots stay silent.
let ctx = null, master = null, audible = true;
let noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    // One shared white-noise buffer, reused by every shot/explosion.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (err) { ctx = null; }
}

export function setMuted(m) {
  audible = !m;
  if (master) master.gain.value = m ? 0 : 0.22;
}

// Short burst of filtered noise with an exponential decay envelope.
// `rate` shifts the shared noise buffer's playback speed per weapon.
function hiss(dur, freq, q, gain, kind, rate) {
  if (!ctx || !audible) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.playbackRate.value = rate || 1;
  const filter = ctx.createBiquadFilter();
  filter.type = kind || 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filter); filter.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur);
}

// Short oscillator tone, optionally sliding down in pitch.
function ping(freq, dur, gain, slideTo, delay) {
  if (!ctx || !audible) return;
  const t = ctx.currentTime + (delay || 0);
  const o = ctx.createOscillator();
  o.type = 'square';
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur);
}

// One entry point: the sim/render layer hands audio an event record.
export function playEvent(e) {
  if (!ctx || !audible) return;
  switch (e.kind) {
    case 'shot': {
      if (e.weapon === 'falcon') { hiss(0.35, 900, 0.8, 0.9, 'lowpass', 0.7); ping(90, 0.25, 0.3, 45); }
      else if (e.weapon === 'p9') hiss(0.09, 1800, 1, 0.5, 'bandpass', 1.3);
      else if (e.weapon === 'hornet') hiss(0.1, 1600, 1, 0.55, 'bandpass', 1.15);
      else hiss(0.12, 1400, 1, 0.6, 'bandpass', 1);
      break;
    }
    case 'dryfire': ping(1200, 0.03, 0.15); break;
    case 'hitmark': ping(1800, 0.05, 0.2); break;
    case 'death': ping(220, 0.3, 0.25, 90); break;
    case 'explode':
      hiss(0.9, 160, 0.5, 1.0, 'lowpass');
      ping(55, 0.8, 0.5, 28);
      break;
    case 'planted': ping(880, 0.12, 0.25); ping(880, 0.12, 0.25, 0, 0.18); break;
    case 'round': ping(520, 0.4, 0.3); ping(780, 0.5, 0.3, 0, 0.25); break;
    case 'reload': ping(600, 0.05, 0.15); ping(900, 0.05, 0.15, 0, 0.35); break;
    default: break;
  }
}

// Bomb beep while planted: call once per second from the HUD tick.
export function beep() { ping(1200, 0.07, 0.2); }
