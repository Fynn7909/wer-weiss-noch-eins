// Solo gegen die Uhr: so viele Wörter wie möglich, nach jedem Treffer kommt ein neuer Buchstabe.
// Wie game.js: kein DOM, keine Zeit, kein Math.random. Die Uhr läuft in der UI.

import { checkAnswer, pickLetter } from './game.js';

export const SOLO_SECONDS = 60;
/** Buchstabe überspringen kostet so viel Zeit. */
export const SKIP_PENALTY_MS = 3000;

export function createSolo({ category, seed = Date.now() }) {
  const state = {
    categoryId: category.id,
    seed: seed | 0,
    // pickLetter rechnet mit Mitspielern: einer, damit jeder Buchstabe ein paar Treffer hergibt
    players: [{ out: false }],
    letter: null,
    usedLetters: [],
    usedEntries: [],
    customKeys: [],
    answers: [],
    skips: 0,
  };
  return pickLetter(state, category);
}

/**
 * Antwort prüfen. Gibt [neuer State, Ergebnis] zurück.
 * Ohne Mitspieler gibt es keine Abstimmung: Tippfehler zählt als das gemeinte Wort, Unbekanntes zählt nicht.
 */
export function submitSolo(state, category, text) {
  const result = checkAnswer(state, category, text);
  if (result.kind !== 'valid' && result.kind !== 'suggest') return [state, result];
  const name = result.kind === 'valid' ? result.name : category.entries[result.entry].name;
  const next = {
    ...state,
    usedEntries: [...state.usedEntries, result.entry],
    answers: [...state.answers, { text: name, letter: state.letter }],
  };
  return [pickLetter(next, category), { kind: 'valid', name, typo: result.kind === 'suggest' }];
}

export function skipSolo(state, category) {
  return pickLetter({ ...state, skips: state.skips + 1 }, category);
}

export const soloScore = (state) => state.answers.length;
