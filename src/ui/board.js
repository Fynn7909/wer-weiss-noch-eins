// Punktetabelle zwischen den Runden: Gewinn-Marken ploppen auf, Punkte zählen hoch,
// dann rutschen die Zeilen auf ihren neuen Platz. Beim Rutschen verschmiert jede Zeile senkrecht –
// echter Bewegungsblur über einen eigenen SVG-Filter je Zeile, Stärke folgt der Geschwindigkeit.
// requestAnimationFrame, keine Bibliothek.

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SVG = 'http://www.w3.org/2000/svg';
const EASE_POP = 'cubic-bezier(0.16, 1, 0.3, 1)';

export const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));

// weich rein, weich raus – Zeilen, die schon auf dem Bildschirm sind, bewegen sich darin
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;

/** Zahl in el von from auf to hochzählen. */
export function countUp(el, from, to, ms = 650) {
  if (from === to || reduced()) {
    el.textContent = to;
    return Promise.resolve();
  }
  return new Promise((done) => {
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / ms);
      el.textContent = Math.round(from + (to - from) * easeOut(t));
      if (t < 1) requestAnimationFrame(frame);
      else done();
    };
    requestAnimationFrame(frame);
  });
}

/** Kleine Marke (+10) springt aus der Unschärfe rein. */
export function popIn(el) {
  el.hidden = false;
  if (reduced()) return;
  el.animate(
    [
      { opacity: 0, transform: 'scale(0.4)', filter: 'blur(8px)' },
      { opacity: 1, transform: 'scale(1)', filter: 'blur(0)' },
    ],
    { duration: 520, easing: EASE_POP, fill: 'both' },
  );
}

/**
 * Zeilen in list auf die Reihenfolge `order` bringen (FLIP). Wer nach oben rutscht, fährt über die anderen drüber.
 * Gibt ein Promise zurück, das nach der Bewegung erfüllt ist.
 */
export function reorder(list, order, ms = 1000) {
  const before = new Map(order.map((n) => [n, n.getBoundingClientRect().top]));
  order.forEach((n) => list.append(n));
  if (reduced()) return Promise.resolve();
  const moves = order
    .map((n) => ({ n, dy: before.get(n) - n.getBoundingClientRect().top }))
    .filter((m) => Math.abs(m.dy) > 1);
  if (!moves.length) return Promise.resolve();

  // ein Filter pro Zeile, damit jede nach ihrer eigenen Geschwindigkeit verschmiert
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  const defs = document.createElementNS(SVG, 'defs');
  svg.append(defs);
  document.body.append(svg);
  const id = `mb${Math.random().toString(36).slice(2, 8)}`;
  moves.forEach((m, i) => {
    const f = document.createElementNS(SVG, 'filter');
    f.id = `${id}-${i}`;
    // Platz für die Schliere über und unter der Zeile
    f.setAttribute('x', '0');
    f.setAttribute('y', '-60%');
    f.setAttribute('width', '100%');
    f.setAttribute('height', '220%');
    const blur = document.createElementNS(SVG, 'feGaussianBlur');
    blur.setAttribute('in', 'SourceGraphic');
    blur.setAttribute('stdDeviation', '0 0');
    f.append(blur);
    defs.append(f);
    m.blur = blur;
    m.filter = `url(#${f.id})`;
    m.last = m.dy;
    m.n.style.position = 'relative';
    m.n.style.zIndex = m.dy > 0 ? '3' : '1'; // nach oben = vorne
    m.n.style.transform = `translateY(${m.dy}px)`;
  });

  return new Promise((done) => {
    const start = performance.now();
    const frame = (now) => {
      const t = Math.min(1, (now - start) / ms);
      const k = 1 - easeInOut(t);
      for (const m of moves) {
        const y = m.dy * k;
        const v = Math.abs(y - m.last); // px pro Frame
        m.last = y;
        const amount = Math.min(7, v * 0.45);
        m.blur.setAttribute('stdDeviation', `0 ${amount.toFixed(2)}`);
        m.n.style.filter = amount > 0.15 ? m.filter : '';
        // wer aufsteigt, hebt sich in der Mitte des Wegs kurz an
        const lift = m.dy > 0 ? 1 + 0.035 * Math.sin(Math.PI * t) : 1;
        m.n.style.transform = `translateY(${y}px) scale(${lift})`;
      }
      if (t < 1) return requestAnimationFrame(frame);
      for (const m of moves) {
        m.n.style.transform = '';
        m.n.style.filter = '';
        m.n.style.zIndex = '';
        m.n.style.position = '';
      }
      svg.remove();
      done();
    };
    requestAnimationFrame(frame);
  });
}
