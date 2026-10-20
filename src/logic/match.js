// Online-Partie: mehrere Runden, jede Runde ist ein ganzes Spiel (game.js) mit eigenem Thema.
// Jeder wählt vorher Themen, reihum kommt eins davon dran. Punkte nach Platz, am Ende zählt die Summe.
// Wie game.js: kein DOM, kein Math.random, alles JSON.

import { nextRandom } from './game.js';

export const PICKS = 3;
export const POINTS = [10, 5, 3];
export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 10;

/**
 * Thema pro Runde festlegen. Runde r gehört Spieler r % n, aus seinen Themen kommt eins per Zufall,
 * möglichst keins doppelt. Wer nichts gewählt hat, bekommt eins aus `fallback`.
 * players: [{ name, picks: [id] }] → [{ categoryId, by }]
 */
export function planRounds({ players, rounds, fallback, seed }) {
  const plan = [];
  const used = new Set();
  let s = seed | 0;
  const draw = (list) => {
    const [r, next] = nextRandom(s);
    s = next;
    return list[Math.floor(r * list.length)];
  };
  for (let r = 0; r < rounds; r++) {
    const p = players[r % players.length];
    const own = (p.picks ?? []).filter(Boolean);
    const fresh = own.filter((id) => !used.has(id));
    const pool = fresh.length ? fresh : own.length ? own : fallback.filter((id) => !used.has(id));
    const categoryId = draw(pool.length ? pool : fallback);
    used.add(categoryId);
    plan.push({ categoryId, by: own.length ? p.name : null });
  }
  return plan;
}

export function createMatch({ players, rounds, fallback, seed }) {
  const n = Math.min(MAX_ROUNDS, Math.max(MIN_ROUNDS, rounds | 0));
  return {
    round: 0,
    rounds: n,
    plan: planRounds({ players, rounds: n, fallback, seed }),
    scores: Object.fromEntries(players.map((p) => [p.name, 0])),
  };
}

/** Platz eines Spielers in einem fertigen Spiel: Überlebender ist Erster. */
export const placeOf = (p) => (p.out ? p.place : 1);

/** Punkte dieser Runde nach Namen, aus einem Spiel-State mit phase 'winner'. */
export function roundPoints(state) {
  return Object.fromEntries(state.players.map((p) => [p.name, POINTS[placeOf(p) - 1] ?? 0]));
}

export function addPoints(scores, gained) {
  const next = { ...scores };
  for (const [name, pts] of Object.entries(gained)) next[name] = (next[name] ?? 0) + pts;
  return next;
}

/** Tabelle: meiste Punkte oben, gleiche Punkte teilen sich den Platz. Bei Gleichstand bleibt die alte Reihenfolge. */
export function standings(scores) {
  const rows = Object.entries(scores)
    .map(([name, points], i) => ({ name, points, i }))
    .sort((a, b) => b.points - a.points || a.i - b.i);
  return rows.map((r) => ({ name: r.name, points: r.points, rank: rows.findIndex((x) => x.points === r.points) + 1 }));
}

/** Nach dem Spiel: Punkte gutschreiben und eine Runde weiter. */
export function finishRound(match, state) {
  return { ...match, scores: addPoints(match.scores, roundPoints(state)), round: match.round + 1 };
}

export const isLastRound = (match) => match.round >= match.rounds - 1;
