// Text-Morphing: gemeinsamer Wortanfang bleibt stehen, der Rest blendet mit Unschärfe
// direkt in den neuen Text über. Die Breite wächst dabei weich mit, damit nichts daneben springt.
// WAAPI, keine Bibliothek.

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
// schnell raus, lange weich auslaufen – fühlt sich an wie aus dem Knopf gezogen, ohne Nachwippen
const EASE_POP = 'cubic-bezier(0.16, 1, 0.3, 1)';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const esc = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Setzt el auf text. blur: wie stark die Texte beim Überblenden verschwimmen (große Schrift verträgt mehr).
 * html: true, wenn text Auszeichnung enthält (<em> …); dann blendet alles über, ohne festen Anfang.
 * Unterbrechbar: ein neuer Aufruf mitten im Morph springt aufs alte Ziel und blendet von dort weiter.
 */
export function morphText(el, text, { blur = 8, duration = 520, html = false } = {}) {
  el._anims?.forEach((a) => a.cancel());
  el._anims = null;
  const set = (v) => (html ? (el.innerHTML = v) : (el.textContent = v));
  const old = el._target ?? (html ? el.innerHTML : el.textContent);
  el._target = text;
  set(old);
  if (old === text) return;
  if (reduced() || !el.isConnected) {
    set(text);
    return;
  }

  // gemeinsamen Anfang nur an Wortgrenzen stehen lassen
  let same = 0;
  if (!html) {
    while (same < old.length && same < text.length && old[same] === text[same]) same++;
    while (same > 0 && old[same - 1] !== ' ') same--;
  }
  const part = (v) => (html ? v : esc(v));

  el.innerHTML = `${part(old.slice(0, same))}<span class="mx"><span>${part(old.slice(same))}</span><span>${part(text.slice(same))}</span></span>`;
  const box = el.querySelector('.mx');
  const [from, to] = box.children;
  // in em, damit eine gleichzeitig mitlaufende Schriftgrößen-Änderung die Breite mitnimmt
  const fontSize = parseFloat(getComputedStyle(box).fontSize);
  const width = (node) => node.getBoundingClientRect().width / fontSize;
  const w0 = width(from);
  const w1 = width(to);

  const timing = { duration, easing: EASE_IN_OUT, fill: 'both' };
  el._anims = [
    animateWidth(box, w0, w1, timing),
    from.animate(
      [
        { opacity: 1, filter: 'blur(0)' },
        { opacity: 0, filter: `blur(${blur}px)` },
      ],
      timing,
    ),
    to.animate(
      [
        { opacity: 0, filter: `blur(${blur}px)` },
        { opacity: 1, filter: 'blur(0)' },
      ],
      timing,
    ),
  ];
  const mine = el._anims;
  Promise.all(mine.map((a) => a.finished)).then(
    () => {
      if (el._anims !== mine) return;
      el._anims = null;
      set(text);
    },
    () => {},
  );
}

/**
 * Breite in em, live pro Frame. Firefox rechnet em in WAAPI-Keyframes beim Start in px um –
 * wächst die Schrift gleichzeitig (Themenwechsel), stimmt die Breite am Ende nicht und der Rest springt.
 * Die leere Animation liefert nur den Takt (Fortschritt mit Easing) und lässt sich wie die anderen abbrechen.
 */
function animateWidth(box, w0, w1, timing) {
  const clock = box.animate([{ opacity: 1 }, { opacity: 1 }], timing);
  const frame = () => {
    if (clock.playState !== 'running' && clock.playState !== 'pending') return;
    const t = clock.effect.getComputedTiming().progress ?? 0;
    box.style.width = `${w0 + (w1 - w0) * t}em`;
    requestAnimationFrame(frame);
  };
  box.style.width = `${w0}em`;
  frame();
  return clock;
}

/** Overlay weich schließen: Blatt rutscht leicht runter und verschwimmt, dann weg. */
export function closeOverlay(overlay) {
  if (overlay._closing) return;
  overlay._closing = true;
  if (reduced()) {
    overlay.remove();
    return;
  }
  overlay.style.pointerEvents = 'none';
  const sheet = overlay.querySelector('.sheet');
  sheet?.animate(
    [
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
      { opacity: 0, transform: 'translateY(16px) scale(0.98)', filter: 'blur(4px)' },
    ],
    { duration: 180, easing: EASE_OUT, fill: 'forwards' },
  );
  overlay
    .animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: EASE_OUT, fill: 'forwards' })
    .finished.then(() => overlay.remove(), () => overlay.remove());
}

/**
 * Bildschirmwechsel: der alte Bildschirm bleibt kurz liegen und verschwimmt,
 * während der neue (screen-in) darüber scharf wird. Offene Fenster gehen mit.
 */
export function leaveScreen(root) {
  for (const node of [...root.children]) {
    if (!node.classList.contains('screen') || reduced() || node._leaving) {
      if (!node._leaving) node.remove();
      continue;
    }
    node._leaving = true;
    node.classList.add('leaving');
    node
      .animate(
        [
          { opacity: 1, filter: 'blur(0)', transform: 'none' },
          { opacity: 0, filter: 'blur(10px)', transform: 'scale(0.985)' },
        ],
        { duration: 320, easing: EASE_OUT, fill: 'forwards' },
      )
      .finished.then(() => node.remove(), () => node.remove());
  }
}

/** Online-Spielerkarte fliegt von rechts rein, leicht schräg und unscharf, und kommt gerade zur Ruhe. */
export function cardIn(card) {
  if (reduced()) return;
  card.animate(
    [
      { transform: 'translateX(min(70vw, 560px)) rotate(7deg)', opacity: 0, filter: 'blur(6px)' },
      { opacity: 1, filter: 'blur(0)', offset: 0.55 },
      { transform: 'none', opacity: 1, filter: 'blur(0)' },
    ],
    { duration: 620, easing: EASE_POP, delay: 90, fill: 'backwards' },
  );
}

/** Karte geht: nach links raus – oder bei Rauswurf (fall) kippt sie nach unten weg. */
export function cardOut(card, fall = false) {
  card.classList.add('leaving');
  if (reduced()) {
    card.remove();
    return;
  }
  const to = fall
    ? { transform: 'translateY(60%) rotate(-9deg)', opacity: 0, filter: 'blur(6px)' }
    : { transform: 'translateX(max(-70vw, -560px)) rotate(-7deg)', opacity: 0, filter: 'blur(6px)' };
  card
    .animate([{ transform: 'none', opacity: 1, filter: 'blur(0)' }, to], {
      duration: fall ? 520 : 380,
      easing: 'cubic-bezier(0.55, 0, 0.75, 0.3)',
      fill: 'forwards',
    })
    .finished.then(() => card.remove(), () => card.remove());
}

/**
 * Großer Knopf startet etwas Neues – wie das Themen-Menü aus dem Pfeil (popOpen):
 * der neue Bildschirm (`go`) wächst aus dem Knopf heraus und wird dabei scharf, der Inhalt kommt kurz versetzt nach.
 */
export function launch(btn, go) {
  const r = btn.getBoundingClientRect();
  go();
  const screen = [...document.querySelectorAll('.screen')].find((s) => !s.classList.contains('leaving'));
  if (reduced() || !screen) return;
  const s = screen.getBoundingClientRect();
  screen.style.transformOrigin = `${r.left + r.width / 2 - s.left}px ${r.top + r.height / 2 - s.top}px`;
  screen.animate(
    [
      { opacity: 0, transform: 'scale(0.3)', filter: 'blur(18px)' },
      { opacity: 1, offset: 0.12 },
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
    ],
    { duration: 640, easing: EASE_POP, fill: 'backwards' },
  );
  [...screen.children].forEach((node, i) =>
    node.animate(
      [
        { opacity: 0, transform: 'translateY(10px)', filter: 'blur(6px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
      ],
      { duration: 420, delay: 110 + Math.min(i, 10) * 40, easing: EASE_OUT, fill: 'backwards' },
    ),
  );
}

/**
 * Gegenstück zu launch: zurück (`go`), der alte Bildschirm zieht sich in den Knopf (`selector`) auf dem
 * neuen Bildschirm zurück und verschwimmt – wie das Themen-Menü in den Pfeil (popClose).
 */
export function land(selector, go) {
  const old = [...document.querySelectorAll('.screen')].find((s) => !s.classList.contains('leaving'));
  if (reduced() || !old) return go();
  // leaveScreen soll ihn liegen lassen, die Animation hier übernimmt
  old._leaving = true;
  old.classList.add('leaving');
  old.style.zIndex = 2;
  go();
  const target = document.querySelector(`.screen:not(.leaving) ${selector}`);
  const s = old.getBoundingClientRect();
  const t = target?.getBoundingClientRect();
  old.style.transformOrigin = t ? `${t.left + t.width / 2 - s.left}px ${t.top + t.height / 2 - s.top}px` : '50% 50%';
  old
    .animate(
      [
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
        { opacity: 1, offset: 0.6 },
        { opacity: 0, transform: 'scale(0.3)', filter: 'blur(18px)' },
      ],
      { duration: 420, easing: EASE_IN_OUT, fill: 'forwards' },
    )
    .finished.then(() => old.remove(), () => old.remove());
}

/** Punkt von `origin` (Mitte) relativ zu `sheet`, als transform-origin. Ohne Ursprung: unten Mitte. */
function originOf(sheet, origin) {
  const r = sheet.getBoundingClientRect();
  if (!origin?.isConnected) return '50% 100%';
  const o = origin.getBoundingClientRect();
  return `${o.left + o.width / 2 - r.left}px ${o.top + o.height / 2 - r.top}px`;
}

/**
 * Menü wächst aus `origin` (z. B. dem Pfeilknopf) heraus und wird dabei scharf.
 * Hintergrund-Unschärfe blendet weich auf, der Inhalt (`items`) kommt kurz versetzt nach.
 */
export function popOpen(overlay, origin, items = []) {
  overlay.classList.add('pop');
  if (reduced()) return;
  const sheet = overlay.querySelector('.sheet');
  sheet.style.transformOrigin = originOf(sheet, origin);
  overlay._pop = [
    overlay.animate(
      [
        { opacity: 0, backdropFilter: 'blur(0px)' },
        { opacity: 1, backdropFilter: 'blur(10px)' },
      ],
      { duration: 380, easing: EASE_OUT, fill: 'backwards' },
    ),
    sheet.animate(
      [
        { opacity: 0, transform: 'scale(0.3)', filter: 'blur(18px)' },
        { opacity: 1, offset: 0.12 },
        { opacity: 1, transform: 'none', filter: 'blur(0)' },
      ],
      { duration: 640, easing: EASE_POP, fill: 'backwards' },
    ),
    ...[...items].map((node, i) =>
      node.animate(
        [
          { opacity: 0, transform: 'translateY(10px)', filter: 'blur(6px)' },
          { opacity: 1, transform: 'none', filter: 'blur(0)' },
        ],
        { duration: 420, delay: 110 + Math.min(i, 10) * 32, easing: EASE_OUT, fill: 'backwards' },
      ),
    ),
  ];
}

/** Gegenstück zu popOpen: Menü zieht sich in `origin` zurück und verschwimmt, dann weg. */
export function popClose(overlay, origin) {
  if (overlay._closing) return;
  overlay._closing = true;
  overlay.style.pointerEvents = 'none';
  if (reduced()) {
    overlay.remove();
    return;
  }
  overlay._pop?.forEach((a) => a.finish());
  const sheet = overlay.querySelector('.sheet');
  sheet.style.transformOrigin = originOf(sheet, origin);
  sheet.animate(
    [
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
      { opacity: 0, transform: `scale(${origin?.isConnected ? 0.5 : 0.94})`, filter: 'blur(14px)' },
    ],
    { duration: 340, easing: EASE_IN_OUT, fill: 'forwards' },
  );
  overlay
    .animate(
      [
        { opacity: 1, backdropFilter: 'blur(10px)' },
        { opacity: 0, backdropFilter: 'blur(0px)' },
      ],
      { duration: 360, easing: EASE_IN_OUT, fill: 'forwards' },
    )
    .finished.then(() => overlay.remove(), () => overlay.remove());
}

/**
 * Riesenschrift auf der Startseite wechseln: der ganze Satz verschwimmt und zieht leicht nach oben weg,
 * erst dann wird der neue Text gesetzt (`apply` für Größe) und kommt von unten scharf rein.
 * Unterbrechbar: kommt mitten im Rausblenden ein neues Thema, wird nur das Ziel getauscht;
 * mitten im Reinblenden geht es von der aktuellen Stelle aus wieder raus.
 */
const EMB_OUT = { opacity: 0, filter: 'blur(16px)', transform: 'translateY(-0.12em) scale(0.97)' };
const EMB_IN = { opacity: 0, filter: 'blur(16px)', transform: 'translateY(0.12em) scale(1.02)' };
const EMB_REST = { opacity: 1, filter: 'blur(0)', transform: 'none' };

export function morphEmboss(box, label, apply, tail = box.children[1].textContent) {
  const [first, rest] = box.children;
  const set = () => {
    first.textContent = label;
    rest.textContent = tail;
    apply();
  };
  if (box._embPhase === 'out') {
    box._embNext = set; // läuft schon raus – nur das Ziel tauschen
    return;
  }
  if (first.textContent === label && rest.textContent === tail && !box._embPhase) return;
  if (reduced() || !box.isConnected) {
    box._emb?.cancel();
    box._emb = box._embPhase = null;
    box.style.willChange = '';
    set();
    return;
  }

  // mitten im Reinblenden: vom aktuellen Zustand aus wieder raus
  const cs = getComputedStyle(box);
  const from = { opacity: cs.opacity, filter: cs.filter === 'none' ? 'blur(0)' : cs.filter, transform: cs.transform };
  box._emb?.cancel();
  box._embNext = set;
  box._embPhase = 'out';
  // eigene Ebene, damit der Browser die Riesenschrift nicht jeden Frame neu malt
  box.style.willChange = 'transform, opacity, filter';
  const out = box.animate([from, EMB_OUT], { duration: 280, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' });
  box._emb = out;
  out.finished.then(
    () => {
      if (box._emb !== out) return;
      box._embNext();
      out.cancel(); // sonst hält ihr fill den Text nach dem Reinblenden unsichtbar
      box._embPhase = 'in';
      const inn = box.animate([EMB_IN, EMB_REST], { duration: 460, easing: EASE_OUT, fill: 'backwards' });
      box._emb = inn;
      inn.finished.then(
        () => {
          if (box._emb !== inn) return;
          box._emb = box._embPhase = null;
          box.style.willChange = '';
        },
        () => {},
      );
    },
    () => {},
  );
}
