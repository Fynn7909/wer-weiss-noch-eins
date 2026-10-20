// Reine Spiellogik. Kein DOM, keine Zeit, kein Math.random – alles steckt im State.
// Der State ist ein einfaches JSON-Objekt, damit er später auch übers Netz geschickt werden kann.

import { ALPHABET, OPEN_LETTERS, remainingFor } from './category.js';
import { initialLetter, normalize, withinOneEdit } from './normalize.js';

export const LETTER_BUFFER = 2;

/** Kleiner deterministischer Zufall (mulberry32). Gibt [zahl 0..1, neuer seed] zurück. */
export function nextRandom(seed) {
  let t = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}

/** reduce/createGame nehmen eine Kategorie oder (Zufallsmodus) eine Funktion id -> Kategorie. */
const resolver = (category) => (typeof category === 'function' ? category : () => category);

export function alivePlayers(state) {
  return state.players.filter((p) => !p.out);
}

export function currentPlayer(state) {
  return state.players[state.turn];
}

/**
 * Zieht einen Buchstaben, der genug Antworten für alle übrigen Spieler (+Puffer) hat.
 * Kein Buchstabe doppelt, solange es andere passende gibt.
 */
export function pickLetter(state, category) {
  if (category.open) return pickOpenLetter(state);
  const need = alivePlayers(state).length + LETTER_BUFFER;
  const counts = ALPHABET.map((l) => [l, remainingFor(category, l, state.usedEntries)]);
  let pool = counts.filter(([l, n]) => n >= need && !state.usedLetters.includes(l));
  let usedLetters = state.usedLetters;
  if (pool.length === 0) {
    pool = counts.filter(([l, n]) => n >= need && l !== state.letter);
    usedLetters = [];
  }
  if (pool.length === 0) {
    // Notfall: der Buchstabe mit den meisten Resten.
    const best = Math.max(...counts.map(([, n]) => n));
    pool = best > 0 ? counts.filter(([, n]) => n === best) : [];
  }
  if (pool.length === 0) {
    // Ganze Liste durchgespielt: von vorn, sonst gäbe es keinen Buchstaben mehr
    if (state.usedEntries.length) return pickLetter({ ...state, usedEntries: [], customKeys: [], usedLetters: [] }, category);
    return { ...state, letter: null };
  }
  const [r, seed] = nextRandom(state.seed);
  const letter = pool[Math.floor(r * pool.length)][0];
  return { ...state, seed, letter, usedLetters: [...usedLetters, letter] };
}

/** Themen ohne (vollständige) Liste: Buchstabe aus OPEN_LETTERS, keiner doppelt bis alle durch sind. */
function pickOpenLetter(state) {
  let usedLetters = state.usedLetters;
  let pool = OPEN_LETTERS.filter((l) => !usedLetters.includes(l));
  if (pool.length === 0) {
    usedLetters = [];
    pool = OPEN_LETTERS.filter((l) => l !== state.letter);
  }
  const [r, seed] = nextRandom(state.seed);
  const letter = pool[Math.floor(r * pool.length)];
  return { ...state, seed, letter, usedLetters: [...usedLetters, letter] };
}

/** Zufallsmodus: neues Thema aus settings.pool (nicht dasselbe wie eben), Buchstaben fangen neu an. */
export function pickCategory(state) {
  const pool = state.settings.pool;
  const choices = pool.length > 1 ? pool.filter((id) => id !== state.categoryId) : pool;
  const [r, seed] = nextRandom(state.seed);
  const categoryId = choices[Math.floor(r * choices.length)];
  return { ...state, seed, categoryId, usedEntries: [], customKeys: [], usedLetters: [] };
}

export function createGame({ names, settings, category, seed = Date.now() }) {
  if (names.length < 2 || names.length > 8) throw new Error('2 bis 8 Spieler');
  const get = resolver(category);
  const random = settings.pool?.length > 0;
  let state = {
    phase: 'handoff',
    settings: { ...settings },
    categoryId: random ? null : category.id,
    seed: seed | 0,
    players: names.map((name, i) => ({ id: i, name, out: false, valid: 0, fastestMs: null })),
    turn: 0,
    letter: null,
    usedLetters: [],
    usedEntries: [],
    customKeys: [],
    answers: [],
    round: 1,
    feedback: null,
    suggestion: null,
    dispute: null,
    lastOut: null,
    notice: null,
  };
  if (random) state = pickCategory(state);
  return pickLetter(state, get(state.categoryId));
}

function nextAliveIndex(state, from) {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (!state.players[i].out) return i;
  }
  return from;
}

function recordAnswer(state, { text, entry, key, ms }) {
  const players = state.players.map((p) =>
    p.id === state.turn
      ? { ...p, valid: p.valid + 1, fastestMs: p.fastestMs == null ? ms : Math.min(p.fastestMs, ms) }
      : p,
  );
  return {
    ...state,
    players,
    usedEntries: entry == null ? state.usedEntries : [...state.usedEntries, entry],
    customKeys: key == null ? state.customKeys : [...state.customKeys, key],
    answers: [...state.answers, { text, playerId: state.turn, letter: state.letter, categoryId: state.categoryId, ms }],
  };
}

/**
 * Nach gültiger Antwort: nächster Spieler, ggf. neuer Buchstabe wenn alles verbraucht ist.
 * settings.direct (online): kein Weitergeben, der Nächste ist sofort dran.
 */
function afterValid(state, category) {
  const phase = state.settings.direct ? 'turn' : 'handoff';
  let s = { ...state, turn: nextAliveIndex(state, state.turn), phase, suggestion: null, dispute: null };
  s.notice = { type: 'valid', text: state.answers.at(-1).text, ms: state.answers.at(-1).ms };
  if (!category.open && remainingFor(category, s.letter, s.usedEntries) === 0) {
    const old = s.letter;
    s = pickLetter(s, category);
    s.notice = { ...s.notice, exhausted: old };
  }
  return s;
}

/** Prüft eine Eingabe, ohne den State zu ändern. */
export function checkAnswer(state, category, text) {
  const trimmed = String(text).trim();
  if (!trimmed) return { kind: 'empty' };
  if (initialLetter(trimmed) !== state.letter) return { kind: 'wrongLetter' };
  const key = normalize(trimmed);
  if (key.length < 2) return { kind: 'tooShort' };
  const entry = category.byKey.get(key);
  if (entry != null) {
    if (state.usedEntries.includes(entry)) return { kind: 'used', name: category.entries[entry].name };
    return { kind: 'valid', entry, name: category.entries[entry].name };
  }
  if (state.customKeys.includes(key)) return { kind: 'used', name: trimmed };
  if (key.length >= 4) {
    // Tippfehler von etwas schon Genanntem ("Toggo" nach "Togo") ist eine Wiederholung, kein Streitfall
    const usedNear = category.keys.find(
      (k) => k.letter === state.letter && state.usedEntries.includes(k.entry) && withinOneEdit(k.key, key),
    );
    if (usedNear) return { kind: 'used', name: category.entries[usedNear.entry].name };
    const near = category.keys.find(
      (k) => k.letter === state.letter && !state.usedEntries.includes(k.entry) && withinOneEdit(k.key, key),
    );
    if (near) return { kind: 'suggest', entry: near.entry, text: near.text };
  }
  return { kind: 'unknown', key };
}

export function reduce(state, action, categoryOrLookup) {
  const get = resolver(categoryOrLookup);
  const category = get(state.categoryId);
  switch (action.type) {
    case 'READY':
      if (state.phase !== 'handoff') return state;
      return { ...state, phase: 'turn', feedback: null, notice: null };

    case 'SUBMIT': {
      if (state.phase !== 'turn') return state;
      const text = String(action.text).trim();
      const ms = action.ms ?? 0;
      const result = checkAnswer(state, category, text);
      switch (result.kind) {
        case 'empty':
          return state;
        case 'wrongLetter':
        case 'tooShort':
        case 'used':
          return { ...state, feedback: { ...result, text, at: (state.feedback?.at ?? 0) + 1 } };
        case 'valid':
          return afterValid(recordAnswer(state, { text, entry: result.entry, ms }), category);
        case 'suggest':
          return { ...state, phase: 'suggest', feedback: null, suggestion: { input: text, ...result, ms } };
        default:
          return startDispute(state, text, result.key, ms);
      }
    }

    case 'ACCEPT_SUGGESTION': {
      if (state.phase !== 'suggest') return state;
      const { entry, text, ms } = state.suggestion;
      return afterValid(recordAnswer({ ...state, suggestion: null }, { text, entry, ms }), category);
    }

    case 'REJECT_SUGGESTION': {
      if (state.phase !== 'suggest') return state;
      const { input, ms } = state.suggestion;
      return startDispute({ ...state, suggestion: null }, input, normalize(input), ms);
    }

    case 'VOTE': {
      if (state.phase !== 'dispute') return state;
      const { voters, votes } = state.dispute;
      if (!voters.includes(action.playerId)) return state;
      const nextVotes = { ...votes, [action.playerId]: !!action.yes };
      if (Object.keys(nextVotes).length < voters.length) {
        return { ...state, dispute: { ...state.dispute, votes: nextVotes } };
      }
      const yes = Object.values(nextVotes).filter(Boolean).length;
      const accepted = yes > voters.length - yes;
      return { ...state, phase: 'disputeResult', dispute: { ...state.dispute, votes: nextVotes, accepted } };
    }

    case 'CONTINUE': {
      if (state.phase === 'disputeResult') {
        const { text, key, ms, accepted } = state.dispute;
        if (accepted) return afterValid(recordAnswer({ ...state, dispute: null }, { text, key, ms }), category);
        return {
          ...state,
          phase: 'turn',
          dispute: null,
          feedback: { kind: 'rejected', text, at: (state.feedback?.at ?? 0) + 1 },
        };
      }
      if (state.phase === 'out') {
        if (alivePlayers(state).length <= 1) return { ...state, phase: 'winner', notice: null };
        // online wie in echt: der Nächste in der Reihe macht sofort mit derselben Aufgabe weiter
        if (state.settings.direct) return { ...state, phase: 'turn', turn: nextAliveIndex(state, state.turn), notice: null };
        let s = { ...state, phase: 'handoff', turn: nextAliveIndex(state, state.turn), round: state.round + 1 };
        if (s.settings.pool?.length) s = pickCategory(s);
        return pickLetter(s, get(s.categoryId));
      }
      return state;
    }

    case 'TIMEOUT': {
      if (state.phase !== 'turn') return state;
      // place: Platz in diesem Spiel (wer als Letzter von dreien fliegt, ist Dritter)
      const place = alivePlayers(state).length;
      const players = state.players.map((p) => (p.id === state.turn ? { ...p, out: true, place } : p));
      return { ...state, players, phase: 'out', lastOut: state.turn, feedback: null, notice: null };
    }

    case 'LEAVE': {
      // Online: Verbindung weg. Spieler ist raus, ohne das Spiel aufzuhalten.
      const leaver = state.players[action.playerId];
      if (!leaver || leaver.out || state.phase === 'winner') return state;
      const place = alivePlayers(state).length;
      const players = state.players.map((p) => (p.id === leaver.id ? { ...p, out: true, left: true, place } : p));
      let s = { ...state, players };
      if (alivePlayers(s).length <= 1) return { ...s, phase: 'winner', notice: null, suggestion: null, dispute: null };
      if (state.turn === leaver.id && state.phase !== 'out') {
        return { ...s, phase: 'out', lastOut: leaver.id, feedback: null, notice: null, suggestion: null, dispute: null };
      }
      if (state.phase === 'dispute' && state.dispute.voters.includes(leaver.id)) {
        const voters = state.dispute.voters.filter((id) => id !== leaver.id);
        const { [leaver.id]: _, ...votes } = state.dispute.votes;
        s = { ...s, dispute: { ...state.dispute, voters, votes } };
        if (Object.keys(votes).length >= voters.length) {
          const yes = Object.values(votes).filter(Boolean).length;
          s = { ...s, phase: 'disputeResult', dispute: { ...s.dispute, accepted: yes > voters.length - yes } };
        }
      }
      return s;
    }

    default:
      return state;
  }
}

/**
 * Online: darf das Handy von Spieler `playerId` diese Aktion schicken?
 * TIMEOUT und LEAVE kommen nur vom Host selbst, nie über das Netz.
 */
export function canAct(state, action, playerId) {
  switch (action?.type) {
    case 'READY':
    case 'SUBMIT':
    case 'ACCEPT_SUGGESTION':
    case 'REJECT_SUGGESTION':
      return state.turn === playerId && !state.players[playerId]?.out;
    case 'VOTE':
      return action.playerId === playerId;
    case 'CONTINUE':
      return state.players[playerId] != null;
    default:
      return false;
  }
}

function startDispute(state, text, key, ms) {
  const voters = alivePlayers(state)
    .map((p) => p.id)
    .filter((id) => id !== state.turn);
  return { ...state, phase: 'dispute', feedback: null, dispute: { text, key, ms, voters, votes: {}, accepted: null } };
}

export function winner(state) {
  return state.phase === 'winner' ? alivePlayers(state)[0] : null;
}
