// Sound (WebAudio, ohne Dateien), Vibration, Konfetti.

let ctx = null;
let enabled = true;

export function setSound(on) {
  enabled = on;
}

function audio() {
  if (!enabled) return null;
  try {
    ctx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

// Alles läuft durch einen Tiefpass: klingt gedämpft und "stumpf" statt nach Piepser.
let bus = null;
function out(a) {
  if (bus?.context === a) return bus;
  const lp = a.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600;
  lp.Q.value = 0.4;
  const master = a.createGain();
  master.gain.value = 0.9;
  lp.connect(master).connect(a.destination);
  bus = lp;
  return bus;
}

/** Weicher Ton: kurzer Anschlag, schnell weg. */
function tone(freq, dur, { type = 'sine', gain = 0.18, delay = 0, slide = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out(a));
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

/** Gefiltertes Rauschen: das "Tock" eines Klicks, ohne Tonhöhe. */
let noiseBuf = null;
function noise(dur, { freq = 1800, q = 1.2, gain = 0.2, delay = 0 } = {}) {
  const a = audio();
  if (!a) return;
  if (noiseBuf?.sampleRate !== a.sampleRate) {
    noiseBuf = a.createBuffer(1, a.sampleRate * 0.3, a.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(out(a));
  src.start(t);
  src.stop(t + dur + 0.02);
}

export function vibrate(pattern) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* nicht verfügbar */
  }
}

let lastSlide = 0;

export const sfx = {
  /** Beim ersten Tippen aufrufen, damit iOS den Ton freigibt. */
  unlock: () => audio(),
  /** Knopf gedrückt: kurzes, dumpfes Tock. Große Knöpfe etwas tiefer und voller. */
  tap(big = false) {
    noise(0.025, { freq: big ? 1100 : 1600, gain: big ? 0.16 : 0.12 });
    tone(big ? 150 : 210, big ? 0.07 : 0.045, { gain: big ? 0.2 : 0.12, slide: 0.7 });
  },
  /** Schalter: an etwas heller als aus. */
  toggle(on) {
    noise(0.02, { freq: on ? 2000 : 1300, gain: 0.1 });
    tone(on ? 330 : 240, 0.05, { gain: 0.1, slide: 0.8 });
  },
  /** Regler: feines Rasten, höchstens alle 45 ms. */
  slide() {
    const now = performance.now();
    if (now - lastSlide < 45) return;
    lastSlide = now;
    noise(0.012, { freq: 2400, q: 2, gain: 0.05 });
  },
  /** Karte geht/kommt: leises Wischen. */
  swish() {
    noise(0.16, { freq: 700, q: 0.6, gain: 0.05 });
  },
  tick(n) {
    // Holzblock-artig; die letzten zwei etwas höher, damit man's merkt
    tone(n <= 2 ? 620 : 480, 0.06, { gain: 0.16, slide: 0.92 });
    noise(0.015, { freq: 2200, gain: 0.05 });
    vibrate(n <= 2 ? 40 : 20);
  },
  valid() {
    tone(523, 0.09, { gain: 0.12 });
    tone(784, 0.14, { gain: 0.1, delay: 0.06 });
  },
  nope() {
    tone(150, 0.1, { gain: 0.18, slide: 0.8 });
    noise(0.03, { freq: 500, gain: 0.08 });
    vibrate(30);
  },
  out() {
    tone(260, 0.38, { gain: 0.16, slide: 0.45 });
    noise(0.08, { freq: 400, q: 0.7, gain: 0.08 });
    vibrate([120, 60, 200]);
  },
  vote() {
    noise(0.02, { freq: 1500, gain: 0.1 });
    tone(330, 0.05, { gain: 0.1 });
  },
  win() {
    [392, 523, 659, 784].forEach((f, i) => tone(f, 0.35, { gain: 0.09, delay: i * 0.1 }));
    vibrate([40, 40, 40, 40, 120]);
  },
};

const CONFETTI = ['#f07a2a', '#1a1a1a', '#c4b49a', '#9db6cf', '#6f806b'];

export function confetti(canvas, ms = 3200) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = (canvas.width = canvas.clientWidth * dpr);
  const h = (canvas.height = canvas.clientHeight * dpr);
  const c = canvas.getContext('2d');
  const n = reduce ? 0 : 110;
  const bits = Array.from({ length: n }, () => ({
    x: w * (0.3 + Math.random() * 0.4),
    y: h * 0.35,
    vx: (Math.random() - 0.5) * 14 * dpr,
    vy: (-8 - Math.random() * 10) * dpr,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    s: (5 + Math.random() * 6) * dpr,
    col: CONFETTI[Math.floor(Math.random() * CONFETTI.length)],
  }));
  const t0 = performance.now();
  function frame(now) {
    const t = now - t0;
    c.clearRect(0, 0, w, h);
    for (const b of bits) {
      b.vy += 0.32 * dpr;
      b.vx *= 0.99;
      b.x += b.vx;
      b.y += b.vy;
      b.r += b.vr;
      c.save();
      c.globalAlpha = Math.max(0, 1 - t / ms);
      c.translate(b.x, b.y);
      c.rotate(b.r);
      c.fillStyle = b.col;
      c.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2);
      c.restore();
    }
    if (t < ms) requestAnimationFrame(frame);
    else c.clearRect(0, 0, w, h);
  }
  if (n) requestAnimationFrame(frame);
}
