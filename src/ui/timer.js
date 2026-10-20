// Einziger Ort mit echter Zeit. Bedenkzeit läuft still, danach kommt der große Countdown (Standard 5-4-3-2-1).

export const COUNTDOWN = 5;

export function createTimer({ onThink, onCount, onTimeout }) {
  let thinkMs = 0;
  let countFrom = COUNTDOWN;
  let elapsed = 0; // ohne Pausen
  let startedAt = 0;
  let running = false;
  let raf = 0;
  let lastCount = null;

  function total() {
    return running ? elapsed + (performance.now() - startedAt) : elapsed;
  }

  function frame() {
    if (!running) return;
    const t = total();
    if (t < thinkMs) {
      onThink?.(1 - t / thinkMs);
    } else {
      const left = countFrom - Math.floor((t - thinkMs) / 1000);
      if (left <= 0) {
        stop();
        onTimeout?.();
        return;
      }
      if (left !== lastCount) {
        lastCount = left;
        onCount?.(left);
      }
    }
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (running) elapsed = total();
    running = false;
    cancelAnimationFrame(raf);
  }

  return {
    /** Neuer Zug. rapid = Countdown sofort, count = Länge des Countdowns. */
    start(seconds, rapid, count = COUNTDOWN) {
      stop();
      thinkMs = rapid ? 0 : seconds * 1000;
      countFrom = count;
      elapsed = 0;
      lastCount = null;
      this.resume();
    },
    pause: stop,
    resume() {
      if (running) return;
      running = true;
      startedAt = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop,
    running: () => running,
    elapsed: () => Math.round(total()),
    inCountdown: () => total() >= thinkMs,
  };
}
