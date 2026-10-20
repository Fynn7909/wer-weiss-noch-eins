import { prepareCategory } from '../logic/category.js';
import {
  createMatch,
  finishRound,
  isLastRound,
  MAX_ROUNDS,
  MIN_ROUNDS,
  PICKS,
  POINTS,
  roundPoints,
  standings,
} from '../logic/match.js';
import { alivePlayers, canAct, createGame, currentPlayer, reduce, winner } from '../logic/game.js';
import { normalize } from '../logic/normalize.js';
import { createSolo, SKIP_PENALTY_MS, skipSolo, SOLO_SECONDS, soloScore, submitSolo } from '../logic/solo.js';
import { demoTransport } from '../net/demo.js';
import { cleanCode, hostTransport, joinTransport } from '../net/peer.js';
import { createGuestRoom, createHostRoom } from '../net/room.js';
import { dotHTML, figureSVG } from './avatars.js';
import { countUp, popIn, reorder, wait } from './board.js';
import { confetti, setSound, sfx, vibrate } from './fx.js';
import {
  cardOut,
  closeOverlay,
  land,
  launch,
  leaveScreen,
  morphEmboss,
  morphText,
  popClose,
  popOpen,
} from './morph.js';
import { createTimer } from './timer.js';

const SAYINGS = {
  fast: ['Das ist ja Schlag auf Schlag hier!', 'Zack.', 'Ohne Nachdenken.', 'Der war schnell.'],
  close: ['Ganz knapp!', 'Puh. Gerade so.', 'Auf den letzten Drücker.'],
  pressure: ['Druck, Druck, Druck …', 'Tick, tack.', 'Jetzt aber.', 'Na?'],
  out: ['Geh einfach schon mal.', 'Das lohnt sich nicht.', 'Geschichtsunterricht nicht aufgepasst?', 'Die Knie geben langsam nach.'],
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];

const DEFAULTS = { categoryId: 'countries', thinkTime: 5, rapid: false, sound: true, rounds: 5 };
const MAIN = ['countries', 'food', 'animals'];
const RANDOM = 'random';
// Startseite: alle paar Sekunden rückt der Punkt weiter und die Riesenschrift zeigt ein anderes Thema
const DOTS = 8;
const TEASER_MS = 3000;
// Buchstaben für "mit T." auf der Startseite – ohne Q, X, Y, dazu fällt kaum jemandem was ein
const ALPHABET = 'ABCDEFGHIJKLMNOPRSTUVWZ';
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
// Online: Rundenstart = Thema + Buchstabe ansagen, dann 5-4-3-2-1. Nach einem Rauswurf nur neuer Buchstabe + 3-2-1.
const ROUND_INTRO_MS = 3000;
const ROUND_COUNT = 5;
const LETTER_INTRO_MS = 1800;
const LETTER_COUNT = 3;
const OUT_MS = 5000;
/** Online: kurz zeigen, wer rausfliegt – dann rückt der Nächste in der Reihe sofort vor. */
const OUT_NET_MS = 1200;
const RESULT_MS = 4000;
// Verbindung weg: so lange wird gewartet, bevor der Spieler rausfliegt
const DROP_GRACE_MS = 15000;
// Antwort kurz vor 0 braucht übers Netz ein paar Millisekunden
const NET_GRACE_MS = 350;

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`lmt:${key}`);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`lmt:${key}`, JSON.stringify(value));
    } catch {
      /* privates Fenster o. ä. */
    }
  },
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const secs = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

/** "Eine Automarke" -> Aufgabe "EINE AUTOMARKE MIT", Name "Automarke". */
export function customCategory(taskText, words, id = `eigen-${Date.now().toString(36)}`) {
  const text = taskText.trim().replace(/\s+/g, ' ').replace(/\s+mit\s*$/i, '');
  const label = text.replace(/^(ein|eine|einen|einem|einer|etwas|irgendwas|was)\s+/i, '') || text;
  const say = text[0].toUpperCase() + text.slice(1);
  return { id, label: label[0].toUpperCase() + label.slice(1), task: `${text.toUpperCase()} MIT`, say, words, custom: true, open: true };
}

const SMALL_WORDS = new Set(['oder', 'und', 'der', 'die', 'das', 'dem', 'den', 'des', 'aus', 'am', 'im', 'in', 'auf', 'zu', 'von', 'eine', 'einer', 'einem', 'man', 'kann']);
// Wörter, die aus den Großbuchstaben nicht zurückzuraten sind (ß wurde zu SS, Bindestrich-Nomen)
const SPECIAL = {
  'us-bundesstaat': 'US-Bundesstaat',
  'technik-marke': 'Technik-Marke',
  süssigkeit: 'Süßigkeit',
  fussballer: 'Fußballer',
  fussballverein: 'Fußballverein',
};

/**
 * Riesenschrift auf dem Startbildschirm: "EINE BERÜHMTE PERSON DER GESCHICHTE MIT" -> "Eine berühmte Person der Geschichte".
 * Aufgaben stehen in Großbuchstaben in den Daten, also raten: Füllwörter und Adjektive vor einem Nomen klein, der Rest groß.
 */
function embossLabel(c) {
  if (!c) return 'Irgendwas';
  if (c.say) return c.say;
  const words = c.task.replace(/ MIT$/, '').toLowerCase().split(' ');
  let rest = false; // nach "etwas, das …" ist alles klein
  return words
    .map((w, i) => {
      const bare = w.replace(/,$/, '');
      if (SPECIAL[bare]) return SPECIAL[bare] + w.slice(bare.length);
      if (i === 0) return w[0].toUpperCase() + w.slice(1);
      if (rest || SMALL_WORDS.has(bare)) {
        rest ||= bare === 'das' && words[i - 1]?.endsWith(',');
        return w;
      }
      const next = words[i + 1];
      const adjective = /(e|es|er|en)$/.test(bare) && next && !SMALL_WORDS.has(next);
      return adjective ? w : w[0].toUpperCase() + w.slice(1);
    })
    .join(' ')
    .replace(/,$/, '');
}

/**
 * Schwarze Kapsel unter der gewählten Kategorie: gleitet per clip-path zum neuen Knopf.
 * Beim ersten Mal ohne Übergang, sonst würde sie beim Laden von links reinfahren.
 */
function moveIndicator(seg) {
  const ind = seg.querySelector('.seg-ind');
  const on = seg.querySelector('[aria-checked="true"]');
  if (!ind || !on) return;
  const left = on.offsetLeft;
  const right = seg.clientWidth - left - on.offsetWidth;
  const first = !ind.style.clipPath;
  if (first) ind.style.transition = 'none';
  ind.style.clipPath = `inset(0 ${right}px 0 ${left}px round 999px)`;
  if (first) {
    void ind.offsetWidth;
    ind.style.transition = '';
  }
}

export function startApp(root, rawCategories) {
  const builtIn = rawCategories.map(prepareCategory);
  let customRaw = store.get('custom', []);
  let categories = [];
  let byId = {};
  function rebuild() {
    categories = [...builtIn, ...customRaw.map(prepareCategory)];
    byId = Object.fromEntries(categories.map((c) => [c.id, c]));
  }
  rebuild();
  let remote = {}; // Online-Gast: eigene Kategorien des Hosts
  const lookup = (id) => byId[id] ?? remote[id];

  const settings = { ...DEFAULTS, ...store.get('settings', {}) };
  if (settings.categoryId !== RANDOM && !byId[settings.categoryId]) settings.categoryId = categories[0].id;
  let names = store.get('names', ['', '']);
  let game = null;
  let view = null; // Elemente des Spielbildschirms
  /** Online: { role: 'host'|'guest', room, transport, code, name, me, seq, players, info, drops } – sonst null. */
  let net = null;
  let lobbyView = null;
  /** Vorschau (?vorschau, nur npm run dev): Raum mit Test-Mitspielern ohne Netz, zum Anschauen und Bearbeiten. */
  const demo =
    import.meta.env.DEV && new URLSearchParams(location.search).has('vorschau')
      ? {
          auto: false,
          paused: false,
          move: 0,
          frozen: [],
          bots: Math.min(7, Math.max(1, Number(new URLSearchParams(location.search).get('vorschau')) || 3)),
        }
      : null;

  setSound(settings.sound);
  trackViewport();

  // Jeder Klick klingt: Knöpfe tocken, Schalter rasten, Regler rasten beim Ziehen
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target.closest('button, [role="radio"], [role="switch"], a');
      if (!el || el.disabled || el.closest('.answer')) return;
      sfx.unlock();
      if (el.matches('[role="switch"], [data-toggle]')) return sfx.toggle(el.getAttribute('aria-checked') !== 'true');
      sfx.tap(el.matches('.primary, .big'));
    },
    true,
  );
  document.addEventListener('input', (e) => e.target.matches?.('input[type="range"]') && sfx.slide());

  const saveSettings = () => store.set('settings', settings);

  /* ---------------- Start ---------------- */

  function showStart() {
    stopGame();
    leaveOnline();
    leaveScreen(root);
    const el = h(`
      <main class="screen start">
        <header class="topbar">
          <div><div class="brand">Wer weiß noch eins?</div><div class="meta">Nr. 001 · Partyspiel</div></div>
          <button class="link" data-act="how" aria-label="So geht's"><span class="how-text">So geht's</span> <span class="q">?</span></button>
        </header>
        <div class="emboss emboss-start" aria-hidden="true"><span>Ein Land</span><span>mit T.</span></div>
        <section class="panel">
          <div class="dots" aria-hidden="true" style="--teaser: ${TEASER_MS}ms">${'<i></i>'.repeat(DOTS)}</div>
          <h1 class="serif">Wer weiß <br>noch eins?</h1>
          <p class="lede">Reihum ein Wort mit dem Buchstaben. Nichts doppelt. Wem nichts mehr einfällt, wird runtergezählt und fliegt raus.</p>
          <div class="startbtns">
            <button class="pill" data-act="solo">Solo</button>
            <button class="pill primary" data-act="new">Neues Spiel <span class="arrow"></span></button>
            <button class="pill" data-act="online">Online</button>
          </div>

          ${settingsHTML()}
        </section>
        <footer class="foot meta"></footer>
      </main>`);
    root.append(el);

    el.querySelector('[data-act="new"]').onclick = (e) => {
      sfx.unlock();
      launch(e.currentTarget, showSetup);
    };
    el.querySelector('[data-act="online"]').onclick = (e) => {
      sfx.unlock();
      launch(e.currentTarget, showOnline);
    };
    el.querySelector('[data-act="solo"]').onclick = (e) => {
      sfx.unlock();
      launch(e.currentTarget, showSolo);
    };
    el.querySelector('[data-act="how"]').onclick = showHowTo;
    function showCategory() {
      const id = settings.categoryId;
      const c = byId[id];
      const foot =
        id === RANDOM
          ? `Jede Runde ein neues Thema · ${themePool().length} im Topf`
          : c.open
            ? `${c.label} · was das Spiel nicht kennt, stimmt ihr ab`
            : `${c.entries.length} ${c.label} im Spiel · offline spielbar`;
      morphText(el.querySelector('.foot'), foot, { blur: 3 });
      showEmboss(embossLabel(id === RANDOM ? null : c));
    }
    // Buchstabe in "mit T." wechselt mit, nie zweimal hintereinander derselbe; beim Laden steht T
    let letter = null;
    function showEmboss(label) {
      const emboss = el.querySelector('.emboss-start');
      const others = ALPHABET.replace(letter, '');
      letter = letter ? others[Math.floor(Math.random() * others.length)] : 'T';
      morphEmboss(
        emboss,
        label,
        () => {
          emboss.classList.toggle('long', label.length > 18);
          emboss.style.setProperty('--chars', Math.max(label.length, 7));
          emboss.style.setProperty('--line', label.length + 7);
        },
        `mit ${letter}.`,
      );
    }

    // Vorschau: Punkt wandert, Riesenschrift zeigt ein zufälliges Thema. Gespielt wird trotzdem die gewählte Kategorie.
    const dots = el.querySelector('.dots');
    let dot = 0;
    let shown = null;
    const moveDot = () => [...dots.children].forEach((d, i) => d.classList.toggle('on', i === dot));
    moveDot();
    let teaser = 0;
    const tick = () => {
      if (!el.isConnected) return clearInterval(teaser);
      if (document.hidden || root.querySelector('.overlay')) return;
      const pool = builtIn.filter((c) => c.id !== shown && c.id !== settings.categoryId);
      const c = pool[Math.floor(Math.random() * pool.length)];
      shown = c.id;
      dot = (dot + 1) % DOTS;
      moveDot();
      showEmboss(embossLabel(c));
    };
    // eigene Wahl steht eine volle Runde oben, danach dreht die Vorschau weiter
    const restartTeaser = () => {
      clearInterval(teaser);
      teaser = setInterval(tick, TEASER_MS);
    };
    restartTeaser();

    bindSettings(el, (key) => {
      if (key !== 'categoryId') return;
      restartTeaser();
      dot = (dot + 1) % DOTS;
      moveDot();
      showCategory();
    });
    showCategory();
  }

  /** Einstellungs-Block der Startseite. */
  function settingsHTML() {
    return `
      <div class="settings">
        <div class="row"><span class="label">Kategorie<small data-v="catname"></small></span>
          <div class="seg" role="radiogroup" aria-label="Kategorie">
            ${MAIN.filter((id) => byId[id])
              .map((id) => `<button role="radio" aria-checked="false" data-cat="${id}">${esc(byId[id].label)}</button>`)
              .join('')}
            <span class="seg-ind" aria-hidden="true"></span>
            <button class="more" role="radio" aria-checked="false" data-act="themes" aria-label="Mehr Themen" title="Mehr Themen"><span class="chev"></span></button>
          </div>
        </div>
        <div class="row"><label class="label" for="think">Bedenkzeit</label>
          <div class="slider"><input id="think" type="range" min="3" max="15" step="1" value="${settings.thinkTime}"><output>${settings.thinkTime} s</output></div>
        </div>
        <div class="row"><span class="label">Schlag auf Schlag<small>Countdown läuft sofort</small></span>
          <button class="switch" role="switch" aria-checked="${settings.rapid}" data-toggle="rapid" aria-label="Schlag auf Schlag"></button>
        </div>
        <div class="row"><span class="label">Sound</span>
          <button class="switch" role="switch" aria-checked="${settings.sound}" data-toggle="sound" aria-label="Sound"></button>
        </div>
      </div>`;
  }

  /** Einstellungs-Block verdrahten: speichert selbst, onChange(key) nach jeder Änderung. */
  function bindSettings(el, onChange) {
    const seg = el.querySelector('.seg');
    const showCategory = () => {
      const id = settings.categoryId;
      el.querySelectorAll('[data-cat]').forEach((x) => x.setAttribute('aria-checked', x.dataset.cat === id));
      el.querySelector('[data-act="themes"]').setAttribute('aria-checked', !MAIN.includes(id));
      moveIndicator(seg);
      morphText(el.querySelector('[data-v="catname"]'), MAIN.includes(id) ? '' : id === RANDOM ? 'Zufall' : byId[id].label, {
        blur: 3,
      });
    };
    const choose = (id) => {
      if (id !== settings.categoryId) vibrate(8);
      settings.categoryId = id;
      saveSettings();
      showCategory();
      onChange('categoryId');
    };
    el.querySelectorAll('[data-cat]').forEach((b) => {
      b.onclick = () => choose(b.dataset.cat);
    });
    el.querySelector('[data-act="themes"]').onclick = (e) => showThemes(choose, e.currentTarget);
    new ResizeObserver(() => moveIndicator(seg)).observe(seg);
    const range = el.querySelector('#think');
    range.oninput = () => {
      settings.thinkTime = Number(range.value);
      morphText(range.nextElementSibling, `${settings.thinkTime} s`, { blur: 3, duration: 220 });
      saveSettings();
      onChange('thinkTime');
    };
    el.querySelectorAll('[data-toggle]').forEach((b) => {
      b.onclick = () => {
        const key = b.dataset.toggle;
        settings[key] = !settings[key];
        b.setAttribute('aria-checked', settings[key]);
        if (key === 'sound') setSound(settings.sound);
        saveSettings();
        onChange(key);
      };
    });
    showCategory();
  }

  /** Alle Themen außer den eigenen – daraus zieht der Zufallsmodus. */
  const themePool = () => builtIn.filter((c) => !c.open).map((c) => c.id);

  /* ---------------- Themen ---------------- */

  /**
   * origin: Knopf, aus dem das Menü aufgeht und in den es sich beim Schließen zurückzieht.
   * multi: { picked, done(list) } – Online-Lobby: bis zu PICKS Themen ankreuzen statt eins wählen.
   */
  function showThemes(choose, origin, multi = null) {
    const groups = new Map();
    if (multi) groups.set('Klassiker', MAIN.map((id) => byId[id]).filter(Boolean));
    for (const c of builtIn) {
      if (MAIN.includes(c.id)) continue;
      const g = c.group ?? 'Sonstiges';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(c);
    }
    let picked = multi ? [...multi.picked] : [];
    const chip = (c) =>
      `<button class="tchip" data-pick="${c.id}" aria-pressed="${multi ? picked.includes(c.id) : c.id === settings.categoryId}">${esc(c.label)}</button>`;
    const count = () => `${picked.length} von ${PICKS} gewählt`;
    const dlg = h(`
      <div class="overlay themes" role="dialog" aria-modal="true" aria-labelledby="themes-t">
        <div class="sheet wide">
          <div class="meta" data-v="count">${multi ? count() : `${builtIn.length - MAIN.length} Themen`}</div>
          <h2 class="serif" id="themes-t">${multi ? 'Deine drei Themen' : "Worum geht's?"}</h2>
          ${
            multi
              ? `<div class="tiles"><button class="tile" data-act="dice">
              <span class="dice" aria-hidden="true"><i></i><i></i><i></i></span><b>Zufällig</b><small>Drei Themen auswürfeln</small>
            </button></div>`
              : `<div class="tiles">
            <button class="tile" data-pick="${RANDOM}" aria-pressed="${settings.categoryId === RANDOM}">
              <span class="dice" aria-hidden="true"><i></i><i></i><i></i></span><b>Zufall</b><small>Jede Runde ein neues Thema</small>
            </button>
            <button class="tile" data-act="custom">
              <span class="plus" aria-hidden="true"></span><b>Eigene Kategorie</b><small>Selbst ausdenken</small>
            </button>
          </div>`
          }
          <input class="tsearch" type="search" placeholder="Thema suchen" aria-label="Thema suchen" autocomplete="off">
          <div class="tgroups">
            ${
              customRaw.length && !multi
                ? `<section data-group><h3 class="meta">Eigene</h3><div class="tchips">${customRaw
                    .map(
                      (c) =>
                        `<span class="tchip-wrap">${chip(c)}<button class="tdel" data-del="${c.id}" aria-label="${esc(c.label)} löschen">×</button></span>`,
                    )
                    .join('')}</div></section>`
                : ''
            }
            ${[...groups]
              .map(
                ([g, list]) =>
                  `<section data-group><h3 class="meta">${esc(g)}</h3><div class="tchips">${list.map(chip).join('')}</div></section>`,
              )
              .join('')}
            <p class="tnone lede" hidden>Nichts gefunden. Mach doch eine eigene Kategorie draus.</p>
          </div>
          <button class="pill${multi ? ' primary' : ''}" data-close>${multi ? 'Fertig' : 'Schließen'}</button>
        </div>
      </div>`);
    const close = () => {
      multi?.done(picked);
      popClose(dlg, origin);
    };
    dlg.querySelector('[data-close]').onclick = close;
    dlg.onclick = (e) => {
      if (e.target === dlg) close();
    };
    dlg.onkeydown = (e) => {
      if (e.key === 'Escape') close();
    };
    const showPicked = () => {
      dlg.querySelectorAll('[data-pick]').forEach((x) => x.setAttribute('aria-pressed', picked.includes(x.dataset.pick)));
      morphText(dlg.querySelector('[data-v="count"]'), count(), { blur: 3, duration: 260 });
    };
    dlg.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => {
        if (!multi) {
          choose(b.dataset.pick);
          return close();
        }
        // Viertes Thema schiebt das älteste raus, statt stumm nichts zu tun
        const id = b.dataset.pick;
        picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id].slice(-PICKS);
        vibrate(6);
        showPicked();
      };
    });
    dlg.querySelector('[data-act="dice"]')?.addEventListener('click', () => {
      const pool = themePool().concat(MAIN.filter((id) => byId[id]));
      picked = [];
      while (picked.length < PICKS && picked.length < pool.length) {
        const id = pool[Math.floor(Math.random() * pool.length)];
        if (!picked.includes(id)) picked.push(id);
      }
      vibrate(10);
      showPicked();
    });
    dlg.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => {
        customRaw = customRaw.filter((c) => c.id !== b.dataset.del);
        store.set('custom', customRaw);
        rebuild();
        if (!byId[settings.categoryId] && settings.categoryId !== RANDOM) choose(MAIN[0]);
        b.parentElement.remove();
      };
    });
    dlg.querySelector('[data-act="custom"]')?.addEventListener('click', () => {
      popClose(dlg); // geht ins nächste Fenster über, nicht zurück in den Pfeil
      showCustom(choose, dlg.querySelector('.tsearch').value);
    });
    const search = dlg.querySelector('.tsearch');
    search.oninput = () => {
      const q = normalize(search.value);
      let any = false;
      dlg.querySelectorAll('[data-group]').forEach((sec) => {
        let shown = 0;
        sec.querySelectorAll('.tchip').forEach((b) => {
          const hit = !q || normalize(b.textContent).includes(q);
          (b.closest('.tchip-wrap') ?? b).hidden = !hit;
          if (hit) shown++;
        });
        sec.hidden = shown === 0;
        any ||= shown > 0;
      });
      dlg.querySelector('.tnone').hidden = any;
    };
    root.append(dlg);
    dlg.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'center' });
    popOpen(dlg, origin, dlg.querySelectorAll('.sheet > .meta, .sheet > h2, .tile, .tsearch, [data-group], .sheet > .pill'));
  }

  function showCustom(choose, suggestion = '') {
    const dlg = h(`
      <div class="overlay custom" role="dialog" aria-modal="true" aria-labelledby="custom-t">
        <form class="sheet" autocomplete="off">
          <div class="meta">Eigene Kategorie</div>
          <h2 class="serif" id="custom-t">Was sollen alle nennen?</h2>
          <label class="field"><span class="label">Aufgabe</span>
            <input name="task" placeholder="z. B. Eine Automarke" maxlength="40" required></label>
          <p class="preview meta" aria-live="polite"></p>
          <label class="field"><span class="label">Wörter, die sicher zählen <small>optional, mit Komma getrennt</small></span>
            <textarea name="words" rows="3" placeholder="Audi, BMW, Tesla …"></textarea></label>
          <p class="lede small">Alles, was nicht in der Liste steht, stimmt ihr im Spiel ab.</p>
          <div class="row2"><button type="button" class="pill" data-close>Abbrechen</button><button class="pill primary">Speichern</button></div>
        </form>
      </div>`);
    const form = dlg.querySelector('form');
    const task = form.elements.task;
    const preview = dlg.querySelector('.preview');
    const showPreview = () => {
      morphText(preview, task.value.trim() ? `${customCategory(task.value, '').task} T` : '', { blur: 3, duration: 260 });
    };
    task.value = suggestion;
    task.oninput = showPreview;
    showPreview();
    dlg.querySelector('[data-close]').onclick = () => closeOverlay(dlg);
    dlg.onclick = (e) => {
      if (e.target === dlg) closeOverlay(dlg);
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!task.value.trim()) return;
      const raw = customCategory(task.value, form.elements.words.value);
      customRaw = [...customRaw, raw];
      store.set('custom', customRaw);
      rebuild();
      closeOverlay(dlg);
      choose(raw.id);
    };
    root.append(dlg);
    task.focus();
  }

  function showHowTo() {
    const dlg = h(`
      <div class="overlay how" role="dialog" aria-modal="true" aria-labelledby="how-t">
        <div class="sheet">
          <div class="meta">So geht's</div>
          <h2 class="serif" id="how-t">Ein Land mit T.</h2>
          <ol class="rules">
            <li>Oben steht die Aufgabe, z.&nbsp;B. <em>Ein Land mit T</em>.</li>
            <li>Wer dran ist, tippt eine Antwort ein. Danach geht das Handy weiter.</li>
            <li>Nichts doppelt. Es zählt der Anfangsbuchstabe, so wie getippt wurde.</li>
            <li>Nach der Bedenkzeit wird von 5 runtergezählt. Bei 0 bist du raus.</li>
            <li>Kennt das Spiel eine Antwort nicht, stimmen die anderen ab: Zählt das?</li>
            <li>Wer zuletzt übrig ist, gewinnt.</li>
          </ol>
          <button class="pill primary" data-close>Verstanden</button>
        </div>
      </div>`);
    dlg.querySelector('[data-close]').onclick = () => closeOverlay(dlg);
    dlg.onclick = (e) => {
      if (e.target === dlg) closeOverlay(dlg);
    };
    root.append(dlg);
    dlg.querySelector('[data-close]').focus();
  }

  /* ---------------- Spieler-Setup ---------------- */

  function showSetup() {
    stopGame();
    leaveScreen(root);
    const el = h(`
      <main class="screen setup">
        <header class="topbar">
          <button class="link back" data-act="back">← Zurück</button>
          <div class="meta">Schritt 2 · Spieler</div>
        </header>
        <section class="panel wide">
          <h1 class="serif">Wer spielt mit?</h1>
          <p class="lede">2 bis 8 Spieler. Die Reihenfolge ist die Reihe, in der ihr dran seid. Zum Sortieren am Griff ziehen.</p>
          <ol class="players" aria-label="Spieler"></ol>
          <div class="setup-actions">
            <button class="pill" data-act="add">+ Spieler</button>
            <button class="pill" data-act="shuffle">Mischen</button>
          </div>
          <p class="hint" aria-live="polite"></p>
        </section>
        <div class="dock">
          <button class="pill primary big" data-act="go">Los geht's <span class="arrow"></span></button>
        </div>
      </main>`);
    root.append(el);
    const list = el.querySelector('.players');
    const hint = el.querySelector('.hint');

    const commit = () => store.set('names', names);

    function renderList(focusIndex) {
      list.innerHTML = names
        .map(
          (n, i) => `
          <li class="prow" data-i="${i}">
            <span class="handle" aria-label="Verschieben" title="Ziehen zum Sortieren"><i></i><i></i><i></i></span>
            <span class="num">${String(i + 1).padStart(2, '0')}</span>
            <span class="mini">${figureSVG(i)}</span>
            <input value="${esc(n)}" placeholder="Name" maxlength="16" autocomplete="off" enterkeyhint="next" aria-label="Name Spieler ${i + 1}">
            <button class="x" aria-label="Spieler ${i + 1} entfernen" ${names.length <= MIN_PLAYERS ? 'disabled' : ''}>×</button>
          </li>`,
        )
        .join('');
      el.querySelector('[data-act="add"]').disabled = names.length >= MAX_PLAYERS;
      list.querySelectorAll('.prow').forEach((row) => {
        const i = Number(row.dataset.i);
        const input = row.querySelector('input');
        input.oninput = () => {
          names[i] = input.value;
          commit();
        };
        input.onkeydown = (e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const next = list.querySelectorAll('input')[i + 1];
          if (next) next.focus();
          else if (names.length < MAX_PLAYERS && input.value.trim()) addPlayer();
          else input.blur();
        };
        row.querySelector('.x').onclick = () => {
          names.splice(i, 1);
          commit();
          renderList();
        };
        enableDrag(row, i);
      });
      if (focusIndex != null) list.querySelectorAll('input')[focusIndex]?.focus();
    }

    function addPlayer() {
      if (names.length >= MAX_PLAYERS) return;
      names.push('');
      commit();
      renderList(names.length - 1);
    }

    function enableDrag(row, index) {
      const handle = row.querySelector('.handle');
      handle.onpointerdown = (e) => {
        e.preventDefault();
        handle.setPointerCapture(e.pointerId);
        const rows = [...list.children];
        const step = row.getBoundingClientRect().height + parseFloat(getComputedStyle(list).rowGap || 0);
        const y0 = e.clientY;
        let target = index;
        row.classList.add('dragging');
        handle.onpointermove = (ev) => {
          const dy = ev.clientY - y0;
          target = Math.max(0, Math.min(rows.length - 1, index + Math.round(dy / step)));
          row.style.transform = `translateY(${dy}px)`;
          rows.forEach((r, j) => {
            if (r === row) return;
            let shift = 0;
            if (j > index && j <= target) shift = -step;
            if (j < index && j >= target) shift = step;
            r.style.transform = shift ? `translateY(${shift}px)` : '';
          });
        };
        handle.onpointerup = handle.onpointercancel = () => {
          handle.onpointermove = handle.onpointerup = handle.onpointercancel = null;
          if (target !== index) {
            const [moved] = names.splice(index, 1);
            names.splice(target, 0, moved);
            commit();
          }
          renderList();
        };
      };
    }

    el.querySelector('[data-act="back"]').onclick = () => land('[data-act="new"]', showStart);
    el.querySelector('[data-act="add"]').onclick = addPlayer;
    el.querySelector('[data-act="shuffle"]').onclick = () => {
      for (let i = names.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [names[i], names[j]] = [names[j], names[i]];
      }
      commit();
      list.classList.remove('shuffled');
      void list.offsetWidth;
      list.classList.add('shuffled');
      renderList();
    };
    el.querySelector('[data-act="go"]').onclick = () => {
      const clean = names.map((n) => n.trim());
      if (clean.some((n) => !n)) {
        morphText(hint, 'Jeder braucht einen Namen.', { blur: 3 });
        list.querySelectorAll('input').forEach((inp) => inp.classList.toggle('bad', !inp.value.trim()));
        list.querySelector('input.bad')?.focus();
        return;
      }
      const lower = clean.map((n) => n.toLowerCase());
      if (new Set(lower).size !== lower.length) {
        morphText(hint, 'Zwei Spieler heißen gleich. Bitte unterscheidbar machen.', { blur: 3 });
        return;
      }
      sfx.unlock();
      names = clean;
      commit();
      startGame(clean);
    };
    if (names.length < MIN_PLAYERS) names = ['', ''];
    renderList(names.findIndex((n) => !n.trim()) >= 0 ? names.findIndex((n) => !n.trim()) : null);
  }

  /* ---------------- Vorschau ---------------- */

  function demoPicks() {
    const pool = themePool();
    return Array.from({ length: 3 }, () => pool[Math.floor(Math.random() * pool.length)]);
  }

  /** Ein noch nicht genanntes Wort mit dem Buchstaben, oder null (offene Liste, alles weg). */
  function demoWord(s) {
    const free = lookup(s.categoryId).keys.filter((k) => k.letter === s.letter && !s.usedEntries.includes(k.entry));
    return free.length ? free[Math.floor(Math.random() * free.length)].text : null;
  }

  /** Test-Mitspieler antworten selbst (und du mit Autopilot). Manchmal fällt keinem was ein, damit Runden enden. */
  function demoPlay(s) {
    if (!demo || net?.role !== 'host' || !game) return;
    clearTimeout(demo.move);
    const at = net.seq;
    if (s.phase === 'dispute') {
      s.players.forEach((p, i) => {
        if (i === net.me || !canAct(s, { type: 'VOTE' }, i)) return;
        setTimeout(() => net?.seq === at && onRemoteAction(i, { type: 'VOTE', yes: Math.random() < 0.7 }, at), 900 + i * 400);
      });
    }
    if (s.phase !== 'turn') return;
    const mine = s.turn === net.me;
    if (mine && !demo.auto) return;
    demo.move = setTimeout(function go() {
      if (net?.seq !== at || game?.phase !== 'turn') return;
      if (demo.paused) return (demo.move = setTimeout(go, 300));
      const word = Math.random() < Math.min(0.5, 0.1 + s.answers.length * 0.03) ? null : demoWord(s);
      if (!word) return; // weiß nichts: Zeit läuft ab
      if (!mine) return onRemoteAction(s.turn, { type: 'SUBMIT', text: word }, at);
      view.input.value = word;
      dispatch({ type: 'SUBMIT', text: word, ms: timer.elapsed() });
    }, 1200 + Math.random() * 1800);
  }

  /** Schmale Leiste oben: Autopilot spielt für dich, Pause hält Zeit, Bots und Animationen an. */
  function mountDevbar() {
    const bar = h(`
      <div class="devbar">
        <span>Vorschau</span>
        <button data-dev="auto" aria-pressed="false">Autopilot</button>
        <button data-dev="pause" aria-pressed="false">Pause</button>
      </div>`);
    document.body.append(bar);
    const auto = bar.querySelector('[data-dev="auto"]');
    const pause = bar.querySelector('[data-dev="pause"]');
    auto.onclick = () => {
      demo.auto = !demo.auto;
      auto.setAttribute('aria-pressed', demo.auto);
      if (game) demoPlay(game);
    };
    pause.onclick = () => {
      demo.paused = !demo.paused;
      pause.setAttribute('aria-pressed', demo.paused);
      pause.textContent = demo.paused ? 'Weiter' : 'Pause';
      if (demo.paused) {
        timer.pause();
        demo.frozen = document.getAnimations().filter((a) => a.playState === 'running');
        demo.frozen.forEach((a) => a.pause());
      } else {
        demo.frozen.forEach((a) => a.play());
        demo.frozen = [];
        if (game?.phase === 'turn' && view) timer.resume();
      }
    };
    // ein neuer Zug startet die Uhr neu – in der Pause gleich wieder anhalten
    setInterval(() => demo.paused && timer.running() && timer.pause(), 100);
  }

  /* ---------------- Online ---------------- */

  /** Bleibt pro Tab gleich, damit man nach Neuladen wieder auf seinem Platz landet. */
  function myToken() {
    try {
      let t = sessionStorage.getItem('lmt:token');
      if (!t) sessionStorage.setItem('lmt:token', (t = Math.random().toString(36).slice(2, 12)));
      return t;
    } catch {
      return Math.random().toString(36).slice(2, 12);
    }
  }

  const NET_ERRORS = {
    'peer-unavailable': 'Raum nicht gefunden. Code richtig?',
    timeout: 'Der Raum antwortet nicht.',
    network: 'Keine Verbindung zum Server. Internet an?',
    'server-error': 'Der Verbindungs-Server spinnt gerade. Gleich nochmal versuchen.',
    'browser-incompatible': 'Dieser Browser kann kein Online-Spiel.',
    full: 'Der Raum ist voll (8 Spieler).',
    running: 'Dort läuft schon ein Spiel.',
  };
  const netError = (e) => NET_ERRORS[e?.type ?? e] ?? 'Verbindung hat nicht geklappt.';

  function leaveOnline() {
    if (!net) return;
    net.drops.forEach(clearTimeout);
    net.room.bye();
    net.transport.close();
    net = null;
    remote = {};
    lobbyView = null;
    try {
      history.replaceState(null, '', location.pathname);
    } catch {
      /* egal */
    }
  }

  const lobbyInfo = () => ({ rounds: settings.rounds, thinkTime: settings.thinkTime, rapid: settings.rapid });

  /** Eigene Online-Themen, gemerkt fürs nächste Mal. Nur eingebaute – eigene Kategorien kennen die anderen nicht. */
  let myPicks = store.get('picks', []).filter((id) => byId[id] && !id.startsWith('eigen-'));
  function setMyPicks(list) {
    myPicks = list;
    store.set('picks', list);
    if (net?.role === 'host') net.room.setPicks(list);
    else net?.room.pick(list);
  }

  function createRoom(name, fail) {
    const room = createHostRoom(
      { name, token: myToken() },
      {
        onLobby: (players) => {
          net.players = players;
          lobbyView?.render();
        },
        onAction: onRemoteAction,
        onDrop(i) {
          if (!game || game.phase === 'winner' || game.players[i]?.out) return;
          say(`${game.players[i].name} ist weg …`);
          net.drops.set(
            i,
            setTimeout(() => {
              net?.drops.delete(i);
              if (view && game) apply({ type: 'LEAVE', playerId: i });
            }, DROP_GRACE_MS),
          );
        },
        onLeft(i) {
          // Gast hat selbst "Verlassen" gedrückt: nicht erst warten
          if (view && game && !game.players[i]?.out) apply({ type: 'LEAVE', playerId: i });
        },
        onBack(i) {
          clearTimeout(net.drops.get(i));
          net.drops.delete(i);
          if (game && !game.players[i].out) say(`${game.players[i].name} ist wieder da.`);
        },
      },
    );
    const makeTransport = demo ? (h) => demoTransport(h, demoPicks, demo.bots) : hostTransport;
    const transport = makeTransport({
      onReady(code) {
        if (!net) return;
        net.code = code;
        showLobby();
      },
      onConnect() {},
      onMessage: room.handlers.onMessage,
      onDisconnect: room.handlers.onDisconnect,
      onError(e) {
        if (lobbyView || view) return; // Raum läuft schon, einzelne Fehler sind egal
        leaveOnline();
        fail(netError(e));
      },
    });
    room.attach(transport);
    net = { role: 'host', room, transport, code: null, name, me: 0, seq: 0, players: room.players(), info: lobbyInfo(), drops: new Map() };
    room.setInfo(net.info);
  }

  function joinRoom(code, name, fail) {
    const room = createGuestRoom(
      { name, token: myToken() },
      {
        onLobby(players, info, back, you) {
          net.players = players;
          net.info = info;
          net.me = you;
          if (back) game = null;
          if (!lobbyView || back) showLobby();
          else lobbyView.render();
        },
        onStart(msg) {
          remote = Object.fromEntries((msg.customs ?? []).map((c) => [c.id, prepareCategory(c)]));
          net.me = msg.you;
          net.seq = msg.seq;
          lobbyView = null;
          game = msg.state;
          mountGame();
          update(null, game);
        },
        onState(state, seq) {
          net.seq = seq;
          const prev = game;
          game = state;
          if (view) update(prev, game);
        },
        onRefuse(reason) {
          leaveOnline();
          fail(netError(reason));
        },
        onBye: () => showLost(code, name),
      },
    );
    const transport = joinTransport(code, {
      onOpen: room.handlers.onOpen,
      onMessage: room.handlers.onMessage,
      onClose: () => showLost(code, name),
      onError(e) {
        if (lobbyView || view) return showLost(code, name);
        leaveOnline();
        fail(netError(e));
      },
    });
    room.attach(transport);
    net = { role: 'guest', room, transport, code: cleanCode(code), name, me: null, seq: 0, players: [], info: {}, drops: new Map() };
  }

  /** Host: Partie mit allen aus der Lobby starten. Themen pro Runde werden jetzt festgelegt. */
  function startMatch() {
    if (net.room.names().length < MIN_PLAYERS) return;
    const known = (id) => byId[id] && !id.startsWith('eigen-');
    net.match = createMatch({
      players: net.room.picks().map((p) => ({ name: p.name, picks: p.picks.filter(known) })),
      rounds: settings.rounds,
      fallback: themePool(),
      seed: (Math.random() * 2 ** 31) | 0,
    });
    startRound();
  }

  /** Host: nächste Runde der Partie. Das Thema steht im Plan, der Startspieler rückt jede Runde weiter. */
  function startRound() {
    const playerNames = net.room.names();
    if (playerNames.length < MIN_PLAYERS) {
      // alle anderen sind weg: Partie vorbei, zurück in die Lobby
      net.match = null;
      net.room.toLobby();
      return showLobby();
    }
    lobbyView = null;
    const { categoryId } = net.match.plan[net.match.round];
    game = {
      ...createGame({
        names: playerNames,
        settings: { thinkTime: settings.thinkTime, rapid: settings.rapid, pool: [], direct: true },
        category: byId[categoryId],
        seed: (Math.random() * 2 ** 31) | 0,
      }),
      match: net.match,
    };
    net.me = net.room.me();
    net.seq++;
    net.drops.forEach(clearTimeout);
    net.drops.clear();
    net.room.start(game, net.seq, []);
    mountGame();
    update(null, game);
    hostSchedule(game);
    demoPlay(game);
  }

  function showOnline(error = '') {
    stopGame();
    leaveOnline();
    leaveScreen(root);
    const fromLink = cleanCode(new URLSearchParams(location.search).get('raum') ?? '');
    const el = h(`
      <main class="screen setup online">
        <header class="topbar">
          <button class="link back" data-act="back">← Zurück</button>
          <div class="meta">Online · jeder am eigenen Handy</div>
        </header>
        <section class="panel wide">
          <h1 class="serif">Online spielen</h1>
          <p class="lede">Einer macht einen Raum auf, die anderen geben den Code ein. Jeder tippt am eigenen Handy.</p>
          <label class="field"><span class="label">Dein Name</span>
            <input name="name" maxlength="16" placeholder="Name" autocomplete="nickname" enterkeyhint="done"></label>
          <form class="joinrow" autocomplete="off">
            <label class="field"><span class="label">Raum-Code</span>
              <input name="code" maxlength="6" placeholder="z. B. K7QM" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go"></label>
            <button class="pill" data-act="join">Beitreten</button>
          </form>
          <p class="hint" aria-live="polite"></p>
        </section>
        <div class="dock">
          <button class="pill primary big" data-act="create">Raum erstellen <span class="arrow"></span></button>
        </div>
      </main>`);
    root.append(el);
    const nameIn = el.querySelector('[name="name"]');
    const codeIn = el.querySelector('[name="code"]');
    const hint = el.querySelector('.hint');
    const buttons = el.querySelectorAll('[data-act="join"], [data-act="create"]');
    nameIn.value = store.get('onlineName', names.find((n) => n.trim()) ?? '');
    codeIn.value = fromLink;
    const busy = (on, text = '') => {
      buttons.forEach((b) => (b.disabled = on));
      morphText(hint, text, { blur: 3 });
    };
    const fail = (text) => busy(false, text);
    const needName = () => {
      const n = nameIn.value.trim();
      if (n) {
        store.set('onlineName', n);
        nameIn.classList.remove('bad');
        return n;
      }
      nameIn.classList.add('bad');
      nameIn.focus();
      morphText(hint, 'Erst deinen Namen eintragen.', { blur: 3 });
      return null;
    };
    codeIn.oninput = () => {
      codeIn.value = cleanCode(codeIn.value);
    };
    el.querySelector('[data-act="back"]').onclick = () => land('[data-act="online"]', showStart);
    el.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const n = needName();
      if (!n) return;
      const code = cleanCode(codeIn.value);
      if (code.length < 4) {
        codeIn.focus();
        return morphText(hint, 'Der Code hat 4 Zeichen.', { blur: 3 });
      }
      sfx.unlock();
      busy(true, 'Verbinde …');
      joinRoom(code, n, fail);
    };
    el.querySelector('[data-act="create"]').onclick = () => {
      const n = needName();
      if (!n) return;
      sfx.unlock();
      busy(true, 'Raum wird aufgemacht …');
      createRoom(n, fail);
    };
    if (error) morphText(hint, error, { blur: 3 });
    (nameIn.value ? (fromLink ? el.querySelector('[data-act="join"]') : codeIn) : nameIn).focus({ preventScroll: true });
  }

  function showLobby() {
    stopGame();
    leaveScreen(root);
    const host = net.role === 'host';
    const info = () => net.info ?? {};
    const el = h(`
      <main class="screen setup lobby">
        <header class="topbar">
          <button class="link back" data-act="back">← Verlassen</button>
          <div class="meta">Online · Lobby</div>
        </header>
        <section class="panel wide">
          <div class="meta">Raum-Code</div>
          <div class="roomcode serif">${esc(net.code ?? '')}</div>
          ${
            host
              ? `<p class="lede">Code an die anderen schicken oder Link teilen. Sie öffnen das Spiel und tippen auf „Online“.</p>
          <div class="setup-actions"><button class="pill" data-act="share">Link teilen</button></div>`
              : `<p class="lede" data-v="wait"></p>`
          }
          <div class="settings">
            <div class="row"><span class="label">Runden<small>Jede Runde ein neues Thema</small></span>
              ${
                host
                  ? `<div class="stepper"><button data-step="-1" aria-label="Eine Runde weniger">−</button><output data-v="rounds"></output><button data-step="1" aria-label="Eine Runde mehr">+</button></div>`
                  : `<output class="val" data-v="rounds"></output>`
              }
            </div>
            <div class="row"><label class="label" for="think">Bedenkzeit<small data-v="thinknote"></small></label>
              <div class="slider"><input id="think" type="range" min="3" max="15" step="1"><output></output></div>
            </div>
            ${host ? '<div class="suggests" data-v="suggests"></div>' : ''}
            <div class="row"><span class="label">Schlag auf Schlag<small>Countdown läuft sofort</small></span>
              ${
                host
                  ? `<button class="switch" role="switch" aria-checked="${settings.rapid}" data-toggle="rapid" aria-label="Schlag auf Schlag"></button>`
                  : `<output class="val" data-v="rapid"></output>`
              }
            </div>
          </div>
          <div class="mypicks">
            <div class="row"><span class="label">Deine Themen<small>Eins davon wird eine Runde</small></span>
              <button class="pill small" data-act="pick">Wählen</button></div>
            <div class="pickslots" data-v="slots"></div>
          </div>
          <ol class="lplayers" aria-label="Spieler im Raum"></ol>
          <p class="hint" aria-live="polite"></p>
        </section>
        <div class="dock">
          ${host ? '<button class="pill primary big" data-act="go">Partie starten <span class="arrow"></span></button>' : ''}
        </div>
      </main>`);
    root.append(el);
    const list = el.querySelector('.lplayers');
    const hint = el.querySelector('.hint');
    const range = el.querySelector('#think');
    const rangeOut = range.nextElementSibling;
    const v = (k) => el.querySelector(`[data-v="${k}"]`);
    const link = () => `${location.origin}${location.pathname}?raum=${net.code}`;
    let mySuggest = null; // Gast: eigener Vorschlag, solange der Host ihn nicht übernommen hat
    let suggestSeen = false; // Host hat den Vorschlag bekommen – verschwindet er wieder, ist er übernommen

    const showSlots = () => {
      v('slots').innerHTML = Array.from({ length: PICKS }, (_, i) => {
        const c = byId[myPicks[i]];
        return c ? `<span class="slot on">${esc(c.label)}</span>` : '<span class="slot">frei</span>';
      }).join('');
      el.querySelector('[data-act="pick"]').textContent = myPicks.length ? 'Ändern' : 'Wählen';
    };
    const showRange = (n) => {
      range.value = n;
      morphText(rangeOut, `${n} s`, { blur: 3, duration: 220 });
    };

    lobbyView = {
      render() {
        if (!net) return;
        const players = net.players ?? [];
        const myIndex = host ? players.findIndex((p) => p.host) : net.me;
        list.innerHTML = players
          .map((p, i) => {
            const tags = [
              p.host && 'Raum',
              i === myIndex && 'du',
              p.suggest != null && !host && i !== myIndex ? `${p.suggest} s?` : null,
            ].filter(Boolean);
            return `<li class="lrow${i === myIndex ? ' me' : ''}">
              <span class="num">${String(i + 1).padStart(2, '0')}</span>
              <span class="lname">${esc(p.name)}</span>
              <span class="lpicks${p.picks >= PICKS ? ' done' : ''}" title="${p.picks} von ${PICKS} Themen gewählt">${'<i></i>'.repeat(PICKS)}</span>
              <span class="ltag meta">${tags.join(' · ')}</span>
            </li>`;
          })
          .join('');
        list.querySelectorAll('.lpicks').forEach((dots, i) =>
          [...dots.children].forEach((d, k) => d.classList.toggle('on', k < (players[i].picks ?? 0))),
        );
        const { rounds = settings.rounds, thinkTime = settings.thinkTime, rapid = false } = host ? lobbyInfo() : info();
        morphText(v('rounds'), String(rounds), { blur: 3, duration: 220 });
        if (host) {
          const offers = players.filter((p) => !p.host && p.suggest != null && p.suggest !== settings.thinkTime);
          v('suggests').innerHTML = offers
            .map((p) => `<button class="tchip" data-take="${p.suggest}">${esc(p.name)}: ${p.suggest} s <span class="take">übernehmen</span></button>`)
            .join('');
          v('suggests').querySelectorAll('[data-take]').forEach((b) => {
            b.onclick = () => {
              settings.thinkTime = Number(b.dataset.take);
              saveSettings();
              showRange(settings.thinkTime);
              vibrate(8);
              pushInfo();
              net.room.clearSuggest(settings.thinkTime);
            };
          });
          morphText(v('thinknote'), offers.length ? `${offers.length === 1 ? 'Ein Vorschlag' : `${offers.length} Vorschläge`}` : '', { blur: 3 });
          const go = el.querySelector('[data-act="go"]');
          go.disabled = players.length < MIN_PLAYERS;
          const missing = players.filter((p) => (p.picks ?? 0) === 0).map((p) => p.name);
          morphText(
            hint,
            players.length < MIN_PLAYERS
              ? 'Warte auf Mitspieler …'
              : missing.length
                ? `Noch ohne Themen: ${missing.join(', ')} – bekommt sonst ein Zufallsthema.`
                : '',
            { blur: 3 },
          );
        } else {
          const hostName = players.find((p) => p.host)?.name ?? 'Host';
          v('wait').textContent = `Du bist drin. ${hostName} startet die Partie.`;
          v('rapid').textContent = rapid ? 'An' : 'Aus';
          // Vorschlag übernommen (oder keiner da): Regler zeigt wieder, was gilt
          const echoed = players[myIndex]?.suggest;
          if (mySuggest != null && echoed === mySuggest) suggestSeen = true;
          if (suggestSeen && echoed == null) mySuggest = null;
          if (mySuggest == null && Number(range.value) !== thinkTime) showRange(thinkTime);
          morphText(
            v('thinknote'),
            mySuggest == null ? `${hostName} entscheidet – schieb für einen Vorschlag` : `Vorschlag geschickt · gilt: ${thinkTime} s`,
            { blur: 3 },
          );
        }
      },
    };

    const pushInfo = () => {
      net.info = lobbyInfo();
      net.room.setInfo(net.info);
    };
    showSlots();
    showRange(host ? settings.thinkTime : (info().thinkTime ?? settings.thinkTime));
    lobbyView.render();
    // gemerkte Themen gleich mitschicken
    if (myPicks.length) setMyPicks(myPicks);

    if (host) {
      el.querySelectorAll('[data-step]').forEach((b) => {
        b.onclick = () => {
          const next = Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, settings.rounds + Number(b.dataset.step)));
          if (next === settings.rounds) return;
          settings.rounds = next;
          saveSettings();
          vibrate(6);
          pushInfo();
        };
      });
      range.oninput = () => {
        settings.thinkTime = Number(range.value);
        showRange(settings.thinkTime);
        saveSettings();
        pushInfo();
        lobbyView.render();
      };
      el.querySelector('[data-toggle="rapid"]').onclick = (e) => {
        settings.rapid = !settings.rapid;
        e.currentTarget.setAttribute('aria-checked', settings.rapid);
        saveSettings();
        pushInfo();
      };
    } else {
      range.oninput = () => morphText(rangeOut, `${range.value} s`, { blur: 3, duration: 220 });
      // erst beim Loslassen schicken, nicht bei jedem Zwischenschritt
      range.onchange = () => {
        mySuggest = Number(range.value);
        suggestSeen = false;
        net.room.suggest(mySuggest);
        vibrate(6);
        lobbyView.render();
      };
    }
    el.querySelector('[data-act="pick"]').onclick = (e) =>
      showThemes(null, e.currentTarget, {
        picked: myPicks,
        done(list) {
          setMyPicks(list);
          showSlots();
        },
      });

    el.querySelector('[data-act="back"]').onclick = () => land('[data-act="online"]', showStart);
    el.querySelector('[data-act="go"]')?.addEventListener('click', startMatch);
    el.querySelector('[data-act="share"]')?.addEventListener('click', async () => {
      const url = link();
      try {
        if (navigator.share) await navigator.share({ title: 'Wer weiß noch eins?', text: `Spiel mit! Raum-Code ${net.code}`, url });
        else {
          await navigator.clipboard.writeText(url);
          morphText(hint, 'Link kopiert.', { blur: 3 });
        }
      } catch {
        /* Teilen abgebrochen */
      }
    });
  }

  /** Gast: Verbindung zum Host ist weg. */
  function showLost(code, name) {
    if (!net) return;
    leaveOnline();
    stopGame();
    const dlg = h(`
      <div class="overlay lost" role="dialog" aria-modal="true">
        <div class="sheet small">
          <div class="meta">Online</div>
          <h2 class="serif">Verbindung weg.</h2>
          <p class="lede">Der Raum ist zu oder das Netz hat kurz gehakt.</p>
          <div class="row2"><button class="pill" data-home>Startseite</button><button class="pill primary" data-again>Neu verbinden</button></div>
        </div>
      </div>`);
    dlg.querySelector('[data-home]').onclick = () => {
      closeOverlay(dlg);
      showStart();
    };
    dlg.querySelector('[data-again]').onclick = () => {
      closeOverlay(dlg);
      joinRoom(code, name, (text) => showOnline(text));
    };
    root.append(dlg);
  }

  /* ---------------- Spiel ---------------- */

  const timer = createTimer({
    onThink(frac) {
      if (!view) return;
      view.bar.style.transform = `scaleX(${frac})`;
    },
    onCount(n) {
      if (!view) return;
      view.bar.style.transform = 'scaleX(0)';
      view.stage.classList.add('counting');
      countTo(view.tick ?? view.count, n);
      if (n === 5) say(pick(SAYINGS.pressure));
      sfx.tick(n);
    },
    onTimeout() {
      if (!net) return dispatch({ type: 'TIMEOUT' });
      if (net.role !== 'host') return; // Gäste zeigen nur an, der Host zählt
      const at = net.seq;
      setTimeout(() => {
        if (net?.seq === at && game?.phase === 'turn') apply({ type: 'TIMEOUT' });
      }, NET_GRACE_MS);
    },
  });

  function stopGame() {
    timer.stop();
    clearIntro();
    view = null;
  }

  // Bildschirm aus oder anderer Tab: Zug anhalten, beim Zurückkommen weiterlaufen lassen
  // Online läuft die Zeit für alle weiter, sonst könnte einer das Spiel anhalten
  document.addEventListener('visibilitychange', () => {
    if (net) return;
    if (document.hidden) timer.pause();
    else if (game?.phase === 'turn' && view && !quitOpen) timer.resume();
  });

  function newGame(playerNames) {
    const random = settings.categoryId === RANDOM;
    return createGame({
      names: playerNames,
      settings: { thinkTime: settings.thinkTime, rapid: settings.rapid, pool: random ? themePool() : [] },
      category: random ? lookup : byId[settings.categoryId],
      seed: (Math.random() * 2 ** 31) | 0,
    });
  }

  function startGame(playerNames) {
    game = newGame(playerNames);
    mountGame();
    update(null, game);
  }

  /** Klick auf diesem Gerät. Online-Gast schickt die Aktion nur an den Host, der entscheidet. */
  function dispatch(action) {
    if (net?.role === 'guest') return net.room.act(action, net.seq);
    if (net && !canAct(game, action, net.me)) return;
    apply(action);
  }

  function apply(action) {
    const prev = game;
    game = reduce(game, action, lookup);
    if (game === prev) return;
    if (net?.role === 'host') {
      net.seq++;
      net.room.state(game, net.seq);
      hostSchedule(game);
    }
    update(prev, game);
    demoPlay(game);
  }

  /** Online-Ansage vor dem ersten Zug: [Ansage ms, Countdown s]. Rundenstart sagt das Thema an und zählt länger. */
  const isRoundStart = (s) => !s.answers.length && s.players.every((p) => !p.out);
  const introOf = (s) => (isRoundStart(s) ? [ROUND_INTRO_MS, ROUND_COUNT] : [LETTER_INTRO_MS, LETTER_COUNT]);
  const handoffMs = (s) => {
    const [ms, count] = introOf(s);
    return ms + count * 1000;
  };

  /** Online ist niemand da, der "Bereit" oder "Weiter" für alle drückt: der Host macht es nach kurzer Zeit selbst. */
  function hostSchedule(s) {
    const at = net.seq;
    const later = (ms, action) =>
      setTimeout(function fire() {
        if (demo?.paused) return setTimeout(fire, 300);
        if (net?.role === 'host' && net.seq === at && view) apply(action);
      }, ms);
    if (s.phase === 'handoff') later(handoffMs(s), { type: 'READY' });
    else if (s.phase === 'out') later(OUT_NET_MS, { type: 'CONTINUE' });
    else if (s.phase === 'disputeResult') later(RESULT_MS, { type: 'CONTINUE' });
  }

  /** Host bekommt eine Aktion von einem Gast-Handy. */
  function onRemoteAction(playerId, action, seq) {
    if (!game || !view || !action) return;
    // Online startet der Host jeden Zug selbst nach dem Countdown – "Bereit" vom Handy zählt nicht
    if (action.type === 'READY') return;
    // "Weiter" von einem älteren Stand würde sonst den nächsten Schritt überspringen
    if (action.type === 'CONTINUE' && seq !== net.seq) return;
    if (!canAct(game, action, playerId)) return;
    if (action.type === 'SUBMIT') action = { type: 'SUBMIT', text: String(action.text ?? '').slice(0, 40), ms: timer.elapsed() };
    if (action.type === 'VOTE') action = { type: 'VOTE', playerId, yes: !!action.yes };
    apply({ type: action.type, ...action });
  }

  const isMine = (s) => !net || s.turn === net.me;

  function mountGame() {
    leaveScreen(root);
    const el = h(`
      <main class="screen game${net ? ' online' : ''}">
        <header class="topbar">
          <div><div class="brand">Wer weiß noch eins?</div><div class="meta" data-v="meta"></div></div>
          <button class="link" data-act="quit" aria-label="Spiel ${net ? 'verlassen' : 'beenden'}">${net ? 'Verlassen' : 'Beenden'}</button>
        </header>
        <div class="stage">
          ${
            net
              ? '<div class="emboss emboss-start emboss-game" aria-hidden="true" data-v="bigletter"><span></span><span></span></div>'
              : '<div class="emboss emboss-letter" aria-hidden="true" data-v="bigletter"></div>'
          }
          <div class="queue" data-v="queue"></div>
          <div class="cardslot" data-v="cards" aria-live="polite"></div>
          <div class="count" data-v="count" aria-live="assertive"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" pathLength="100"/></svg></div>
          <div class="say" data-v="say" aria-live="polite"></div>
        </div>
        ${net ? '<div class="deck" data-v="deck">' : ''}
        <section class="hud${net ? ' playcard' : ''}" data-v="hud">
          ${net ? '<div class="pc-head"><b class="serif pc-name" data-v="name"></b><div class="tick" data-v="tick" aria-live="assertive"></div></div>' : ''}
          <div class="task"><span class="meta" data-v="task"></span><span class="tletter" data-v="letter"></span></div>
          <div class="turnline serif" data-v="who"></div>
          <div class="bar"><i data-v="bar"></i></div>
          <ul class="chips" data-v="chips" aria-label="Schon genannt"></ul>
          <form class="answer" data-v="form" autocomplete="off">
            <input data-v="input" maxlength="40" placeholder="Antwort eintippen" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Antwort">
            <button class="send" aria-label="Absenden"><span class="arrow"></span></button>
          </form>
          <div class="feedback" data-v="feedback" aria-live="polite"></div>
        </section>
        ${net ? '</div>' : ''}
        <div class="layer" data-v="layer"></div>
      </main>`);
    root.append(el);
    const q = (k) => el.querySelector(`[data-v="${k}"]`);
    view = {
      el,
      stage: el.querySelector('.stage'),
      hud: q('hud'),
      deck: q('deck'),
      line: new Map(), // online: Karten der Wartenden hinter der Spielkarte, nach Spieler-id
      name: q('name'),
      tick: q('tick'), // online: Countdown oben rechts in der Karte
      meta: q('meta'),
      bigletter: q('bigletter'),
      queue: q('queue'),
      cards: q('cards'),
      card: null,
      count: q('count'),
      say: q('say'),
      task: q('task'),
      letter: q('letter'),
      who: q('who'),
      bar: q('bar'),
      chips: q('chips'),
      form: q('form'),
      input: q('input'),
      feedback: q('feedback'),
      layer: q('layer'),
      figs: new Map(),
    };
    if (net) view.hud.style.visibility = 'hidden'; // Karte fliegt erst mit dem ersten Zug rein
    for (const p of game.players) {
      // online nur Namensschilder, keine Figuren
      const body = net ? '' : `<div class="body">${figureSVG(p.id)}</div>`;
      const f = h(`<div class="qfig${net?.me === p.id ? ' me' : ''}" data-id="${p.id}">${body}<span class="tag">${esc(p.name)}</span></div>`);
      view.queue.append(f);
      view.figs.set(p.id, f);
    }
    view.form.onsubmit = (e) => {
      e.preventDefault();
      const text = view.input.value;
      if (!text.trim()) return;
      dispatch({ type: 'SUBMIT', text, ms: timer.elapsed() });
    };
    el.querySelector('[data-act="quit"]').onclick = confirmQuit;
  }

  // Solange "Spiel beenden?" offen ist, steht das Spiel still und ist nicht bedienbar
  let quitOpen = false;

  function confirmQuit() {
    if (quitOpen) return;
    quitOpen = true;
    if (!net) timer.pause();
    view.el.inert = true;
    const [title, text] = !net
      ? ['Spiel beenden?', 'Der Spielstand geht verloren.']
      : net.role === 'host'
        ? ['Spiel verlassen?', 'Du hast den Raum aufgemacht – das Spiel endet dann für alle.']
        : ['Spiel verlassen?', 'Du scheidest aus, die anderen spielen weiter.'];
    const dlg = h(`
      <div class="overlay quit" role="dialog" aria-modal="true">
        <div class="sheet small">
          <h2 class="serif">${title}</h2>
          <p class="lede">${text}</p>
          <div class="row2"><button class="pill" data-no>Weiterspielen</button><button class="pill primary" data-yes>Beenden</button></div>
        </div>
      </div>`);
    dlg.querySelector('[data-no]').onclick = () => {
      quitOpen = false;
      view.el.inert = false;
      closeOverlay(dlg);
      if (!net && game?.phase === 'turn' && !document.hidden) timer.resume();
      if (game?.phase === 'turn' && isMine(game)) view.input.focus({ preventScroll: true });
    };
    dlg.querySelector('[data-yes]').onclick = () => {
      quitOpen = false;
      showStart();
    };
    root.append(dlg);
    dlg.querySelector('[data-no]').focus();
  }

  function say(text) {
    if (!view) return;
    view.say.textContent = text;
    view.say.classList.remove('show');
    void view.say.offsetWidth;
    view.say.classList.add('show');
  }

  /** Reihe: aktiver Spieler vorn, die nächsten dahinter versetzt – wie im Video. */
  function layoutQueue(s) {
    const alive = alivePlayers(s);
    const startIdx = alive.findIndex((p) => p.id === s.turn);
    const order = alive.slice(startIdx).concat(alive.slice(0, startIdx));
    const n = order.length;
    const spread = Math.min(1, 4 / Math.max(n - 1, 1));
    order.forEach((p, k) => {
      const f = view.figs.get(p.id);
      const depth = k;
      f.style.setProperty('--x', `${(depth === 0 ? 0 : 14 + depth * 9 * spread) * (depth % 2 ? 1 : -1)}%`);
      f.style.setProperty('--s', (1 - Math.min(depth, 6) * 0.07).toFixed(3));
      f.style.setProperty('--y', `${-depth * 1.2}%`);
      f.style.zIndex = String(20 - depth);
      f.style.order = String(depth);
      f.classList.toggle('active', depth === 0);
    });
  }

  function update(prev, s) {
    if (!view) return;
    if (s.phase === 'winner') {
      timer.stop();
      setTimeout(() => game === s && (s.match ? showRoundEnd(s) : showWinner(s)), 900);
      return;
    }
    const me = currentPlayer(s);
    const mine = isMine(s);
    const alive = alivePlayers(s);

    const cat = lookup(s.categoryId);
    const random = s.settings.pool.length > 0;
    const meta = s.match
      ? `Runde ${s.match.round + 1} von ${s.match.rounds} · ${cat.label} · ${alive.length} im Spiel`
      : `Runde ${s.round} · ${random ? `${cat.label} · ` : ''}${alive.length} im Spiel`;
    morphText(view.meta, meta, { blur: 3 });
    morphText(view.task, cat.task, { blur: 3 });
    if (!prev || prev.letter !== s.letter || prev.categoryId !== s.categoryId) {
      morphText(view.letter, s.letter ?? '–', { blur: 6 });
      if (net) showSentence(cat, s.letter);
      else morphText(view.bigletter, s.letter ?? '', { blur: 24, duration: 640 });
    }

    // Chips: alles, was zu diesem Buchstaben schon genannt wurde
    const forLetter = s.answers.filter((a) => a.letter === s.letter && a.categoryId === s.categoryId);
    view.chips.innerHTML = forLetter
      .map((a) => `<li class="chip"><s>${esc(a.text)}</s></li>`)
      .join('');

    // Ausgeschiedene Figuren rauswischen
    for (const p of s.players) {
      const f = view.figs.get(p.id);
      if (p.out && !f.classList.contains('gone')) {
        f.classList.add('gone');
        f.style.setProperty('--dir', p.id % 2 ? 1 : -1);
        if (net) setTimeout(() => (f.hidden = true), 600); // Schild macht in der Reihe Platz
      }
    }
    if (s.phase !== 'out') layoutQueue(s);

    // Feedback bei falscher Eingabe
    if (s.feedback && s.feedback !== prev?.feedback) {
      const msg = {
        wrongLetter: `Fängt nicht mit ${s.letter} an.`,
        tooShort: 'Nur ein Buchstabe zählt nicht.',
        used: `${s.feedback.name} wurde schon genannt.`,
        rejected: `„${s.feedback.text}“ zählt nicht. Weiter!`,
      }[s.feedback.kind];
      morphText(view.feedback, msg, { blur: 3, duration: 300 });
      view.form.classList.remove('shake');
      void view.form.offsetWidth;
      view.form.classList.add('shake');
      sfx.nope();
      if (mine) view.input.select();
    } else if (!s.feedback) {
      morphText(view.feedback, '', { blur: 3, duration: 300 });
    }

    // Online-Ansage läuft weiter, wenn sich während der Ansage nur jemand verabschiedet
    const keepIntro = net && prev?.phase === 'handoff' && s.phase === 'handoff' && prev.letter === s.letter;
    if (!keepIntro) clearIntro();

    // alte Karte verschwimmt raus; bei Updates derselben Karte (Abstimmung) einfach still austauschen
    layerStill = !!prev && prev.phase === s.phase;
    if (!keepIntro) {
      for (const node of [...view.layer.children]) {
        if (layerStill) node.remove();
        else closeOverlay(node);
      }
    }
    view.input.disabled = s.phase !== 'turn' || !mine;
    view.input.placeholder = mine ? 'Antwort eintippen' : `${me.name} tippt …`;
    view.el.dataset.phase = s.phase;
    view.el.classList.toggle('watching', !mine);

    switch (s.phase) {
      case 'handoff': {
        timer.stop();
        view.stage.classList.remove('counting');
        if (!keepIntro) clearCount(view.count);
        view.bar.style.transform = 'scaleX(1)';
        view.input.value = '';
        if (net) {
          // online weiß keiner vorher, wer als Nächstes drankommt – die Karte fliegt erst mit dem Zug rein
          dropCard();
          morphText(view.who, 'Gleich geht’s los.', { blur: 5 });
          if (!keepIntro) showIntro(s);
          break;
        }
        morphText(view.who, `${esc(me.name)} ist als Nächstes dran.`, { blur: 5, html: true });
        if (prev && s.notice?.type === 'valid') cheer(s);
        showHandoff(s, prev);
        break;
      }
      case 'turn': {
        const who = !net ? `Du bist dran: <em>${esc(me.name)}</em>` : mine ? 'Du bist dran!' : `<em>${esc(me.name)}</em> ist dran.`;
        morphText(view.who, who, { blur: 5, html: true });
        const fresh = !prev || prev.phase === 'handoff' || prev.turn !== s.turn;
        if (fresh) {
          // neuer Zug ohne Weitergeben (online): Rest vom alten Zug wegräumen
          view.stage.classList.remove('counting');
          clearCount(view.count);
          if (view.tick) clearCount(view.tick);
          view.bar.style.transform = 'scaleX(1)';
          view.input.value = '';
          timer.start(s.settings.thinkTime, s.settings.rapid);
          if (net && mine) vibrate([30, 60, 30]);
        } else timer.resume();
        if (net) showLine(s);
        if (prev && s.answers.length > prev.answers.length) {
          cheer(s);
          morphText(view.feedback, `✓ ${s.notice.text}`, { blur: 3, duration: 300 });
          if (s.notice.exhausted) say(`Keine mehr mit ${s.notice.exhausted}. Neuer Buchstabe!`);
        }
        // Handy gesperrt / Tab weg / Beenden-Dialog offen: Zeit läuft nicht weiter (nur am gemeinsamen Handy)
        if (!net && (quitOpen || document.hidden)) timer.pause();
        if (s.settings.rapid) view.bar.style.transform = 'scaleX(0)';
        if (mine) view.input.focus({ preventScroll: true });
        break;
      }
      case 'suggest':
        timer.pause();
        showSuggest(s);
        break;
      case 'dispute':
        timer.pause();
        showDispute(s, prev);
        break;
      case 'disputeResult':
        showDisputeResult(s);
        break;
      case 'out': {
        timer.stop();
        countTo(view.tick ?? view.count, 0);
        sfx.out();
        setTimeout(() => game === s && view && dropCard(true), 350);
        if (net && s.lastOut === net.me) vibrate([60, 40, 120]);
        view.input.blur();
        showOut(s);
        break;
      }
    }
  }

  /** Gültige Antwort: Ton und ein Spruch, wenn es besonders schnell oder knapp war. */
  function cheer(s) {
    sfx.valid();
    const ms = s.notice.ms;
    const countdownStarted = !s.settings.rapid && ms > s.settings.thinkTime * 1000;
    if (countdownStarted && ms > s.settings.thinkTime * 1000 + 3500) say(pick(SAYINGS.close));
    else if (ms < 2200) say(pick(SAYINGS.fast));
  }

  /** Online: Satz oben wie auf der Startseite – "Ein Land / mit T." – in geprägter Riesenschrift. */
  function showSentence(cat, letter) {
    const box = view.bigletter;
    const label = embossLabel(cat);
    morphEmboss(
      box,
      label,
      () => box.style.setProperty('--chars', Math.max(label.length, 7)),
      letter ? `mit ${letter}.` : '',
    );
  }

  /**
   * Online: die Reihe wie in echt. Vorne die Spielkarte von dem, der dran ist,
   * dahinter schauen die Wartenden in Zugfolge oben raus.
   * Gültige Antwort: vordere Karte stellt sich hinten an. Rauswurf: sie fällt raus (dropCard). Der Nächste rückt vor.
   */
  function showLine(s) {
    const alive = alivePlayers(s);
    const start = alive.findIndex((p) => p.id === s.turn);
    const order = alive.slice(start).concat(alive.slice(0, start));
    const moved = view.card !== String(s.turn);
    if (moved && view.card != null) {
      ghostOut();
      sfx.swish();
    }
    view.deck.classList.toggle('many', order.length > 5);
    view.deck.style.setProperty('--n', order.length - 1);

    const waiting = order.slice(1);
    const ids = new Set(waiting.map((p) => p.id));
    for (const [id, c] of view.line) {
      if (ids.has(id)) continue;
      c.remove();
      view.line.delete(id);
    }
    waiting.forEach((p, i) => {
      let c = view.line.get(p.id);
      if (!c) {
        c = h(`<div class="qcard${net.me === p.id ? ' me' : ''}"><span>${esc(p.name)}</span></div>`);
        view.deck.prepend(c);
        view.line.set(p.id, c);
        // wer gerade dran war, stellt sich hinten an
        if (!reducedMotion())
          c.animate([{ opacity: 0, translate: '0 -14px' }, { opacity: 1, translate: '0 0' }], {
            duration: 420,
            delay: moved ? 220 : 0,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'backwards',
          });
      }
      c.style.setProperty('--k', i + 1);
    });

    if (!moved) return;
    view.card = String(s.turn);
    view.hud.classList.toggle('me', isMine(s));
    view.hud.style.visibility = '';
    view.name.textContent = currentPlayer(s).name;
    // rückt aus der ersten Wartenden-Position nach vorne
    if (!reducedMotion())
      view.hud.animate(
        [
          { transform: 'translateY(calc(-1 * var(--peek))) scale(0.955)', opacity: 0.6, filter: 'blur(2px)' },
          { transform: 'none', opacity: 1, filter: 'blur(0)' },
        ],
        { duration: 520, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', delay: 60, fill: 'backwards' },
      );
  }

  /** Rauswurf: Karte kippt nach unten weg, die Wartenden bleiben stehen. */
  function dropCard(fall = false) {
    if (view.card == null) return;
    ghostOut(fall);
    view.card = null;
    view.hud.style.visibility = 'hidden';
  }

  /** Stilles Abbild der Spielkarte: geht nach hinten weg (gültig) oder fällt raus. */
  function ghostOut(fall = false) {
    const r = view.hud.getBoundingClientRect();
    const ghost = view.hud.cloneNode(true);
    ghost.removeAttribute('data-v');
    ghost.inert = true;
    ghost.classList.add('ghost');
    Object.assign(ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    ghost.querySelector('input').value = view.input.value;
    view.el.append(ghost);
    if (fall) return cardOut(ghost, true);
    if (reducedMotion()) return ghost.remove();
    ghost
      .animate(
        [
          { transform: 'none', opacity: 1, filter: 'blur(0)' },
          { transform: 'translateY(26px) scale(0.94)', opacity: 0, filter: 'blur(5px)' },
        ],
        { duration: 340, easing: 'cubic-bezier(0.55, 0, 0.75, 0.3)', fill: 'forwards' },
      )
      .finished.then(() => ghost.remove(), () => ghost.remove());
  }

  /** Großer Countdown: Ziffer rollt weich rein, der Ring läuft in einer Sekunde leer. */
  function countTo(el, n) {
    const old = [...el.querySelectorAll('b:not(.leaving)')];
    const b = document.createElement('b');
    b.textContent = n;
    el.append(b);
    el.classList.add('on');
    el.classList.toggle('zero', n === 0);
    el.classList.remove('run');
    void el.offsetWidth;
    if (n > 0) el.classList.add('run');
    for (const o of old) {
      o.classList.add('leaving');
      o.animate(
        [
          { transform: 'none', opacity: 1, filter: 'blur(0)' },
          { transform: 'translateY(-35%) scale(0.85)', opacity: 0, filter: 'blur(8px)' },
        ],
        { duration: 320, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
      ).finished.then(() => o.remove(), () => o.remove());
    }
    b.animate(
      [
        { transform: 'translateY(35%) scale(0.85)', opacity: 0, filter: 'blur(8px)' },
        { transform: 'none', opacity: 1, filter: 'blur(0)' },
      ],
      { duration: 480, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  }

  function clearCount(el) {
    el.classList.remove('on', 'run', 'zero');
    el.querySelectorAll('b').forEach((b) => b.remove());
  }

  // Ansage + Countdown vor dem ersten Zug (online); läuft auf jedem Handy selbst, der Host startet den Zug
  let introTimers = [];
  function clearIntro() {
    introTimers.forEach(clearTimeout);
    introTimers = [];
  }

  function showIntro(s) {
    const [ms, count] = introOf(s);
    const cat = lookup(s.categoryId);
    let notice = '<div class="notice">Neuer Buchstabe</div>';
    if (isRoundStart(s) && s.match) {
      const by = s.match.plan[s.match.round].by;
      notice = `<div class="notice">Runde ${s.match.round + 1} von ${s.match.rounds} · ${by ? `Thema von ${esc(by)}` : 'Zufallsthema'}</div>`;
    }
    const node = layerSheet(`
      ${notice}
      <div class="handletter intro"><span class="meta">${esc(cat.task)}</span><b>${esc(s.letter ?? '–')}</b></div>`);
    node.classList.add('handoff', 'online');
    const later = (t, fn) => introTimers.push(setTimeout(() => view && game === s && fn(), t));
    later(ms, () => closeOverlay(node));
    for (let i = 0; i < count; i++) {
      const n = count - i;
      later(ms + i * 1000, () => {
        countTo(view.count, n);
        sfx.tick(n);
      });
    }
  }

  let layerStill = false;
  function layerSheet(html) {
    const node = h(`<div class="overlay in-game${layerStill ? ' still' : ''}"><div class="sheet">${html}</div></div>`);
    view.layer.append(node);
    return node;
  }

  function showHandoff(s, prev) {
    const me = currentPlayer(s);
    let notice = '';
    if (!prev) notice = `<div class="notice">Erster Buchstabe</div>`;
    else if (s.notice?.exhausted)
      notice = `<div class="notice">Keine mehr mit ${esc(s.notice.exhausted)}. Neuer Buchstabe!</div>`;
    else if (s.notice?.type === 'valid')
      notice = `<div class="notice ok"><span class="okdot"></span>${esc(s.notice.text)} · ${secs(s.notice.ms)}</div>`;
    else if (prev?.categoryId !== s.categoryId) notice = `<div class="notice">Neues Thema: ${esc(lookup(s.categoryId).label)}</div>`;
    else if (prev?.phase === 'out') notice = `<div class="notice">Neuer Buchstabe</div>`;

    const letterChanged = !prev || prev.letter !== s.letter || prev.categoryId !== s.categoryId;
    const letterHTML = letterChanged
      ? `<div class="handletter"><span class="meta">${esc(lookup(s.categoryId).task)}</span><b>${esc(s.letter ?? '–')}</b></div>`
      : '';
    const node = layerSheet(`
      ${notice}
      ${letterHTML}
      <div class="meta">Weitergeben</div>
      <h2 class="serif">Handy an <em>${esc(me.name)}</em>.</h2>
      <button class="pill primary big" data-ready>Bereit <span class="arrow"></span></button>`);
    node.classList.add('handoff');
    const btn = node.querySelector('[data-ready]');
    btn.onclick = () => dispatch({ type: 'READY' });
    btn.focus({ preventScroll: true });
  }

  function showSuggest(s) {
    if (!isMine(s)) {
      layerSheet(`
        <div class="meta">Tippfehler?</div>
        <h2 class="serif"><em>${esc(currentPlayer(s).name)}</em> überlegt …</h2>
        <p class="lede">„${esc(s.suggestion.input)}“ – meinte ${esc(currentPlayer(s).name)} vielleicht ${esc(s.suggestion.text)}?</p>`);
      return;
    }
    const node = layerSheet(`
      <div class="meta">Tippfehler?</div>
      <h2 class="serif">Meintest du <em>${esc(s.suggestion.text)}</em>?</h2>
      <p class="lede">Du hast „${esc(s.suggestion.input)}“ geschrieben.</p>
      <div class="row2">
        <button class="pill" data-no>Nein</button>
        <button class="pill primary" data-yes>Ja, genau</button>
      </div>`);
    node.querySelector('[data-yes]').onclick = () => dispatch({ type: 'ACCEPT_SUGGESTION' });
    node.querySelector('[data-no]').onclick = () => dispatch({ type: 'REJECT_SUGGESTION' });
    node.querySelector('[data-yes]').focus({ preventScroll: true });
  }

  const THUMB = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4v-9zm2 9h8.2c.9 0 1.7-.6 1.9-1.5l1.4-6c.3-1.2-.7-2.5-1.9-2.5H14l.7-3.6c.2-1-.6-1.9-1.6-1.9L9 10z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

  function showDispute(s, prev) {
    const d = s.dispute;
    const me = currentPlayer(s);
    if (prev?.phase !== 'dispute') sfx.nope();
    const rows = d.voters
      .map((id) => {
        const p = s.players[id];
        const v = d.votes[id];
        // Online stimmt jeder nur am eigenen Handy ab
        const locked = v !== undefined || (net && id !== net.me);
        return `<li class="voter ${v === undefined ? '' : v ? 'yes' : 'no'}${net?.me === id ? ' me' : ''}">
          ${dotHTML(id)}<span class="vname">${esc(p.name)}</span>
          <button class="thumb down" data-vote="${id}" data-yes="0" aria-label="${esc(p.name)}: zählt nicht" aria-pressed="${v === false}" ${locked ? 'disabled' : ''}>${THUMB}</button>
          <button class="thumb up" data-vote="${id}" data-yes="1" aria-label="${esc(p.name)}: zählt" aria-pressed="${v === true}" ${locked ? 'disabled' : ''}>${THUMB}</button>
        </li>`;
      })
      .join('');
    const node = layerSheet(`
      <div class="meta stamp-in">Streitfall!</div>
      <h2 class="serif quote">„${esc(d.text)}“</h2>
      <p class="lede">${
        net && isMine(s)
          ? 'Kennt das Spiel nicht. Die anderen stimmen jetzt ab, ob es zählt.'
          : `Kennt das Spiel nicht. ${esc(me.name)} sagt, das zählt. Ihr entscheidet – die Mehrheit gewinnt, Gleichstand zählt nicht.`
      }</p>
      <ul class="voters">${rows}</ul>`);
    node.classList.add('dispute');
    if (net) node.classList.add('net');
    node.querySelectorAll('[data-vote]').forEach((b) => {
      b.onclick = () => {
        sfx.vote();
        dispatch({ type: 'VOTE', playerId: Number(b.dataset.vote), yes: b.dataset.yes === '1' });
      };
    });
  }

  function showDisputeResult(s) {
    const d = s.dispute;
    const yes = Object.values(d.votes).filter(Boolean).length;
    const no = d.voters.length - yes;
    (d.accepted ? sfx.valid : sfx.nope)();
    const node = layerSheet(`
      <h2 class="serif quote">„${esc(d.text)}“</h2>
      <div class="verdict ${d.accepted ? 'ok' : 'bad'}">${d.accepted ? 'Zählt!' : 'Zählt nicht.'}</div>
      <p class="tally"><span>${yes}</span> dafür · <span>${no}</span> dagegen</p>
      <button class="pill primary" data-go>Weiter <span class="arrow"></span></button>`);
    node.classList.add('result');
    const go = () => game?.phase === 'disputeResult' && dispatch({ type: 'CONTINUE' });
    node.querySelector('[data-go]').onclick = go;
    node.querySelector('[data-go]').focus({ preventScroll: true });
  }

  function showOut(s) {
    const p = s.players[s.lastOut];
    // online wie in echt: kein Halt, nur kurz ansagen – der Nächste macht gleich weiter
    if (net) return say(`${p.name} ist raus!`);
    say('');
    setTimeout(() => {
      if (!view || game !== s) return;
      const node = layerSheet(`
        <div class="meta">${esc(pick(SAYINGS.out))}</div>
        <h2 class="serif"><em>${esc(p.name)}</em> ist raus!</h2>
        <button class="pill primary" data-go>Weiter <span class="arrow"></span></button>`);
      node.classList.add('outsheet');
      const btn = node.querySelector('[data-go]');
      btn.onclick = () => dispatch({ type: 'CONTINUE' });
      btn.focus({ preventScroll: true });
    }, 900);
  }

  /* ---------------- Online-Partie: Tabelle nach jeder Runde ---------------- */

  function showRoundEnd(s) {
    stopGame();
    const m = s.match;
    const last = isLastRound(m);
    const gained = roundPoints(s);
    const next = finishRound(m, s);
    if (net?.role === 'host') net.match = next;
    // vorher: alter Stand, auch für alle, die erst in dieser Runde Punkte bekommen
    const before = standings(Object.fromEntries(Object.keys(next.scores).map((n) => [n, m.scores[n] ?? 0])));
    const after = standings(next.scores);
    const w = winner(s);
    const cat = lookup(s.categoryId);
    const leaders = after.filter((r) => r.rank === 1).map((r) => r.name);
    const meName = net ? (net.players?.[net.me]?.name ?? s.players[net.me]?.name) : null;
    const host = net?.role === 'host';
    const hostName = net?.players?.find((p) => p.host)?.name ?? 'Host';
    sfx.valid();
    leaveScreen(root);
    const el = h(`
      <main class="screen winner online roundend${last ? ' final' : ''}">
        <canvas class="confetti" aria-hidden="true"></canvas>
        <header class="topbar">
          <div><div class="brand">Wer weiß noch eins?</div><div class="meta">Runde ${m.round + 1} von ${m.rounds} · ${esc(cat.label)}</div></div>
          <button class="link" data-act="leave">Verlassen</button>
        </header>
        <div class="emboss emboss-win" aria-hidden="true"><span>${last ? 'Endstand.' : `Runde ${m.round + 1}.`}</span></div>
        <section class="panel">
          <div class="meta" data-v="kicker">${last ? 'Letzte Runde' : `Noch ${m.rounds - m.round - 1} ${m.rounds - m.round - 1 === 1 ? 'Runde' : 'Runden'}`}</div>
          <h1 class="serif" data-v="title">${esc(w?.name ?? '')} holt die Runde.</h1>
          <ol class="board${before.length > 5 ? ' many' : ''}" aria-label="Punktestand">
            ${before
              .map(
                (r) => `<li class="brow${r.name === meName ? ' me' : ''}" data-name="${esc(r.name)}">
                <span class="brank">${r.rank}</span>
                <span class="bname">${esc(r.name)}</span>
                <span class="bgain" hidden>+${gained[r.name] ?? 0}</span>
                <span class="bpts">${r.points}</span>
              </li>`,
              )
              .join('')}
          </ol>
          <p class="hint" data-v="pts">Platz 1 · 2 · 3 bekommen ${POINTS.join(' · ')} Punkte</p>
          <div class="row2" data-v="actions">
            ${
              !last
                ? host
                  ? `<button class="pill primary big" data-act="next">Nächste Runde <span class="arrow"></span></button>`
                  : `<button class="pill primary" disabled>Warte auf ${esc(hostName)} …</button>`
                : host
                  ? `<button class="pill" data-act="lobby">Zur Lobby</button><button class="pill primary" data-act="again">Neue Partie <span class="arrow"></span></button>`
                  : `<button class="pill primary" disabled>Warte auf ${esc(hostName)} …</button>`
            }
          </div>
        </section>
      </main>`);
    root.append(el);
    const list = el.querySelector('.board');
    const rowOf = new Map([...list.children].map((li) => [li.dataset.name, li]));

    el.querySelector('[data-act="leave"]').onclick = showStart;
    el.querySelector('[data-act="next"]')?.addEventListener('click', () => {
      net.room.rotate();
      startRound();
    });
    el.querySelector('[data-act="lobby"]')?.addEventListener('click', () => {
      net.match = null;
      net.room.toLobby();
      showLobby();
    });
    el.querySelector('[data-act="again"]')?.addEventListener('click', () => {
      net.room.rotate();
      startMatch();
    });

    // Ablauf: Marken vom Dritten zum Ersten, Punkte zählen hoch, dann rutscht die Tabelle in die neue Ordnung
    (async () => {
      await wait(650);
      const winners = Object.entries(gained)
        .filter(([, pts]) => pts > 0)
        .sort((a, b) => a[1] - b[1]);
      for (const [name, pts] of winners) {
        const row = rowOf.get(name);
        if (!el.isConnected || !row) return;
        popIn(row.querySelector('.bgain'));
        row.classList.add('scored');
        sfx.vote();
        countUp(row.querySelector('.bpts'), m.scores[name] ?? 0, (m.scores[name] ?? 0) + pts);
        await wait(380);
      }
      await wait(650);
      if (!el.isConnected) return;
      await reorder(
        list,
        after.map((r) => rowOf.get(r.name)),
        1100,
      );
      if (!el.isConnected) return;
      after.forEach((r) => {
        const row = rowOf.get(r.name);
        morphText(row.querySelector('.brank'), String(r.rank), { blur: 4, duration: 300 });
        row.classList.toggle('lead', r.rank === 1);
      });
      if (!last) return;
      // Partie vorbei: Sieger ansagen
      await wait(300);
      if (!el.isConnected) return;
      const title =
        leaders.length === 1 ? `${leaders[0]} gewinnt die Partie.` : `Gleichstand: ${leaders.join(' & ')}.`;
      morphText(el.querySelector('[data-v="title"]'), title, { blur: 10, duration: 700 });
      morphText(el.querySelector('[data-v="kicker"]'), `Nach ${m.rounds} ${m.rounds === 1 ? 'Runde' : 'Runden'}`, { blur: 3 });
      sfx.win();
      confetti(el.querySelector('.confetti'));
    })();
  }

  /* ---------------- Sieger ---------------- */

  /* ---------------- Solo ---------------- */

  /** Solo braucht eine Liste zum Prüfen: Zufall oder Themen ohne Liste spielen ein zufälliges Listen-Thema. */
  function soloCategory() {
    const c = byId[settings.categoryId];
    if (c && !c.open) return c;
    const pool = themePool();
    return byId[pool[Math.floor(Math.random() * pool.length)]];
  }

  /** Allein gegen die Uhr: nach jedem Treffer ein neuer Buchstabe. Uhr läuft hier, Logik in solo.js. */
  function showSolo(cat = soloCategory()) {
    stopGame();
    leaveScreen(root);
    let s = createSolo({ category: cat });
    const el = h(`
      <main class="screen game solo">
        <header class="topbar">
          <div><div class="brand">Wer weiß noch eins?</div><div class="meta">Solo · ${esc(cat.label)} · ${SOLO_SECONDS} Sekunden</div></div>
          <button class="link" data-act="quit">Beenden</button>
        </header>
        <div class="stage">
          <div class="emboss emboss-letter" aria-hidden="true" data-v="bigletter"></div>
          <div class="count" data-v="count" aria-live="assertive"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="47" pathLength="100"/></svg></div>
          <div class="say" data-v="say" aria-live="polite"></div>
        </div>
        <section class="hud">
          <div class="task"><span class="meta">${esc(cat.task)}</span><span class="tletter" data-v="letter"></span></div>
          <div class="solo-line"><span class="turnline serif" data-v="score"></span><span class="solo-time" data-v="time"></span></div>
          <div class="bar"><i data-v="bar"></i></div>
          <ul class="chips" data-v="chips" aria-label="Deine Treffer"></ul>
          <form class="answer" data-v="form" autocomplete="off">
            <input data-v="input" maxlength="40" placeholder="Antwort eintippen" autocapitalize="words" autocorrect="off" spellcheck="false" enterkeyhint="send" aria-label="Antwort" disabled>
            <button class="send" aria-label="Absenden"><span class="arrow"></span></button>
          </form>
          <div class="solo-foot"><div class="feedback" data-v="feedback" aria-live="polite"></div><button class="link" type="button" data-act="skip">Überspringen (−${SKIP_PENALTY_MS / 1000} s)</button></div>
        </section>
      </main>`);
    root.append(el);
    const q = (k) => el.querySelector(`[data-v="${k}"]`);
    const input = q('input');
    const form = q('form');
    const totalMs = SOLO_SECONDS * 1000;
    let usedMs = 0; // ohne Pausen
    let startedAt = 0;
    let running = false;
    let raf = 0;
    let lastCount = null;
    const left = () => totalMs - (running ? usedMs + performance.now() - startedAt : usedMs);

    function showLetter() {
      morphText(q('letter'), s.letter, { blur: 6 });
      morphText(q('bigletter'), s.letter, { blur: 24, duration: 640 });
    }
    function showScore() {
      const n = soloScore(s);
      morphText(q('score'), `<em>${n}</em> Treffer`, { blur: 5, html: true });
      q('chips').innerHTML = s.answers
        .map((a) => `<li class="chip">${esc(a.text)}</li>`)
        .reverse()
        .join('');
    }
    function feedback(msg, bad) {
      morphText(q('feedback'), msg, { blur: 3, duration: 300 });
      if (!bad) return;
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
      sfx.nope();
      input.select();
    }

    function frame() {
      if (!el.isConnected) return pause();
      const ms = left();
      q('bar').style.transform = `scaleX(${Math.max(0, ms / totalMs)})`;
      q('time').textContent = `${Math.max(0, Math.ceil(ms / 1000))} s`;
      const n = Math.ceil(ms / 1000);
      if (n <= 5 && n !== lastCount) {
        lastCount = n;
        el.querySelector('.stage').classList.add('counting');
        if (n > 0) {
          countTo(q('count'), n);
          sfx.tick(n);
        }
      }
      if (ms <= 0) return finish();
      raf = requestAnimationFrame(frame);
    }
    function pause() {
      if (running) usedMs += performance.now() - startedAt;
      running = false;
      cancelAnimationFrame(raf);
    }
    function resume() {
      if (running || !el.isConnected) return;
      running = true;
      startedAt = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function finish() {
      pause();
      document.removeEventListener('visibilitychange', onVisible);
      input.disabled = true;
      setTimeout(() => el.isConnected && showSoloEnd(s, cat), 700);
    }
    // Handy gesperrt oder Tab weg: Uhr hält an
    const onVisible = () => (document.hidden ? pause() : el.isConnected && !input.disabled && resume());
    document.addEventListener('visibilitychange', onVisible);

    form.onsubmit = (e) => {
      e.preventDefault();
      if (input.disabled || !input.value.trim()) return;
      const [next, r] = submitSolo(s, cat, input.value);
      const msg = {
        wrongLetter: `Fängt nicht mit ${s.letter} an.`,
        tooShort: 'Nur ein Buchstabe zählt nicht.',
        used: `${r.name} hattest du schon.`,
        unknown: `„${input.value.trim()}“ kenne ich nicht.`,
      }[r.kind];
      if (r.kind === 'empty') return;
      if (r.kind !== 'valid') return feedback(msg, true);
      s = next;
      sfx.valid();
      input.value = '';
      feedback(r.typo ? `✓ ${r.name} (gemeint)` : `✓ ${r.name}`);
      showScore();
      showLetter();
      input.focus({ preventScroll: true });
    };
    el.querySelector('[data-act="skip"]').onclick = () => {
      if (input.disabled) return;
      s = skipSolo(s, cat);
      input.value = '';
      usedMs += SKIP_PENALTY_MS;
      feedback(`Übersprungen · −${SKIP_PENALTY_MS / 1000} s`);
      showLetter();
      input.focus({ preventScroll: true });
    };
    el.querySelector('[data-act="quit"]').onclick = () => {
      pause();
      document.removeEventListener('visibilitychange', onVisible);
      showStart();
    };

    showScore();
    q('time').textContent = `${SOLO_SECONDS} s`;
    // 3-2-1, dann läuft die Uhr
    say('Gleich geht’s los.');
    [3, 2, 1].forEach((n, i) =>
      setTimeout(() => {
        if (!el.isConnected) return;
        countTo(q('count'), n);
        sfx.tick(n);
      }, i * 800),
    );
    setTimeout(() => {
      if (!el.isConnected) return;
      clearCount(q('count'));
      showLetter();
      input.disabled = false;
      input.focus({ preventScroll: true });
      if (!document.hidden) resume();
    }, 2400);
  }

  function showSoloEnd(s, cat) {
    const n = soloScore(s);
    const key = `solo:${cat.id}`;
    const best = store.get(key, 0);
    const record = n > best;
    if (record) store.set(key, n);
    if (record && n > 0) sfx.win();
    leaveScreen(root);
    const el = h(`
      <main class="screen winner soloend">
        <canvas class="confetti" aria-hidden="true"></canvas>
        <header class="topbar">
          <div><div class="brand">Wer weiß noch eins?</div><div class="meta">Solo · ${esc(cat.label)} · ${SOLO_SECONDS} Sekunden</div></div>
        </header>
        <div class="emboss emboss-win" aria-hidden="true"><span>Zeit um.</span></div>
        <section class="panel">
          <h1 class="serif">${record && n > 0 ? 'Neuer Rekord!' : 'Geschafft.'}</h1>
          <div class="score"><span class="big">${n}</span><span class="of">Treffer in ${SOLO_SECONDS} Sekunden</span></div>
          <p class="lede">${record && best > 0 ? `Alter Rekord: ${best}.` : !record ? `Dein Rekord in ${esc(cat.label)}: <b>${best}</b>.` : ''}${
            s.skips ? ` ${s.skips}× übersprungen.` : ''
          }</p>
          ${n ? `<ul class="chips">${s.answers.map((a) => `<li class="chip">${esc(a.text)}</li>`).join('')}</ul>` : ''}
          <div class="row2">
            <button class="pill" data-act="home">Startseite</button>
            <button class="pill primary" data-act="again">Nochmal <span class="arrow"></span></button>
          </div>
        </section>
      </main>`);
    root.append(el);
    if (record && n > 0) requestAnimationFrame(() => confetti(el.querySelector('.confetti')));
    el.querySelector('[data-act="again"]').onclick = () => showSolo(cat);
    el.querySelector('[data-act="home"]').onclick = showStart;
  }

  function showWinner(s) {
    stopGame();
    const w = winner(s);
    const fastest = s.answers.reduce((best, a) => (best == null || a.ms < best.ms ? a : best), null);
    const ranked = [...s.players].sort((a, b) => b.valid - a.valid || (a.out === b.out ? 0 : a.out ? 1 : -1));
    sfx.win();
    leaveScreen(root);
    const el = h(`
      <main class="screen winner">
        <canvas class="confetti" aria-hidden="true"></canvas>
        <header class="topbar">
          <div><div class="brand">Wer weiß noch eins?</div><div class="meta">${esc(s.settings.pool.length ? 'Zufall' : lookup(s.categoryId).label)} · ${s.round} ${s.round === 1 ? 'Runde' : 'Runden'}</div></div>
        </header>
        <div class="emboss emboss-win" aria-hidden="true"><span>Gewonnen.</span></div>
        <div class="crowd solo" aria-hidden="true"><div class="fig hero">${figureSVG(w.id)}</div></div>
        <section class="panel">
          <h1 class="serif">${esc(w.name)} gewinnt.</h1>
          <div class="score"><span class="big">${w.valid}</span><span class="of">${w.valid === 1 ? 'gültige Antwort' : 'gültige Antworten'}</span></div>
          ${
            fastest
              ? `<p class="lede">Schnellste Antwort: <b>${esc(s.players[fastest.playerId].name)}</b> mit „${esc(fastest.text)}“ in ${secs(fastest.ms)}.</p>`
              : ''
          }
          <table class="stats">
            <thead><tr><th>Spieler</th><th>Gültig</th><th>Schnellste</th></tr></thead>
            <tbody>${ranked
              .map(
                (p) =>
                  `<tr class="${p.id === w.id ? 'win' : ''}"><td>${dotHTML(p.id)}${esc(p.name)}</td><td>${p.valid}</td><td>${p.fastestMs == null ? '–' : secs(p.fastestMs)}</td></tr>`,
              )
              .join('')}</tbody>
          </table>
          <div class="row2">
            <button class="pill" data-act="new">Neue Spieler</button>
            <button class="pill primary" data-act="again">Nochmal <span class="arrow"></span></button>
          </div>
        </section>
      </main>`);
    root.append(el);
    requestAnimationFrame(() => confetti(el.querySelector('.confetti')));
    // Nochmal: gleiche Spieler, der Startspieler rückt eins weiter
    el.querySelector('[data-act="again"]').onclick = () => {
      names = [...names.slice(1), names[0]];
      store.set('names', names);
      startGame(names);
    };
    el.querySelector('[data-act="new"]').onclick = showSetup;
  }

  // Tab zu: den anderen Bescheid sagen, sonst merken sie es erst nach Sekunden
  window.addEventListener('pagehide', () => net?.room.bye());

  if (demo) {
    mountDevbar();
    createRoom('Du', showOnline);
  } else if (new URLSearchParams(location.search).has('raum')) showOnline();
  else showStart();
}

/** Tastatur auf dem Handy: Höhe des sichtbaren Bereichs als CSS-Variable. */
function trackViewport() {
  const vv = window.visualViewport;
  const set = () => {
    const height = vv ? vv.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', `${height}px`);
    if (vv && vv.offsetTop) window.scrollTo(0, 0);
  };
  set();
  (vv ?? window).addEventListener('resize', set);
  vv?.addEventListener('scroll', set);
}
