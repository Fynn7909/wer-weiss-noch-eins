import { describe, expect, it } from 'vitest';
import { createGame, reduce } from '../src/logic/game.js';
import { createMatch, finishRound, isLastRound, planRounds, roundPoints, standings } from '../src/logic/match.js';

const cat = {
  id: 'x',
  open: true,
  entries: [],
  keys: [],
  byKey: new Map(),
};

/** Spiel bis zum Ende: wer dran ist, läuft in die Zeit. */
function playOut(names) {
  let s = createGame({ names, settings: { thinkTime: 5, rapid: false, pool: [] }, category: cat, seed: 1 });
  while (s.phase !== 'winner') {
    s = reduce(s, { type: 'READY' }, cat);
    s = reduce(s, { type: 'TIMEOUT' }, cat);
    s = reduce(s, { type: 'CONTINUE' }, cat);
  }
  return s;
}

describe('Partie', () => {
  it('merkt sich beim Rausfliegen den Platz', () => {
    const s = playOut(['A', 'B', 'C']);
    const places = Object.fromEntries(s.players.map((p) => [p.name, p.out ? p.place : 1]));
    expect(places).toEqual({ A: 3, B: 2, C: 1 });
  });

  it('verteilt 10/5/3 Punkte, Rest 0', () => {
    const s = playOut(['A', 'B', 'C', 'D']);
    expect(roundPoints(s)).toEqual({ A: 0, B: 3, C: 5, D: 10 });
  });

  it('Themen reihum aus den Wünschen, möglichst ohne Doppel', () => {
    const plan = planRounds({
      players: [
        { name: 'A', picks: ['a1', 'a2', 'a3'] },
        { name: 'B', picks: ['b1', 'b2', 'b3'] },
      ],
      rounds: 6,
      fallback: ['f'],
      seed: 7,
    });
    expect(plan.map((p) => p.by)).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
    expect(plan.filter((p) => p.by === 'A').map((p) => p.categoryId).sort()).toEqual(['a1', 'a2', 'a3']);
    expect(plan.filter((p) => p.by === 'B').map((p) => p.categoryId).sort()).toEqual(['b1', 'b2', 'b3']);
  });

  it('wer nichts gewählt hat, bekommt ein Zufallsthema', () => {
    const plan = planRounds({ players: [{ name: 'A', picks: [] }], rounds: 2, fallback: ['f1', 'f2'], seed: 3 });
    expect(plan.map((p) => p.by)).toEqual([null, null]);
    expect(plan.map((p) => p.categoryId).sort()).toEqual(['f1', 'f2']);
  });

  it('zählt Runden und Punkte bis zum Endstand', () => {
    let m = createMatch({ players: [{ name: 'A' }, { name: 'B' }], rounds: 2, fallback: ['f'], seed: 1 });
    expect(m.scores).toEqual({ A: 0, B: 0 });
    expect(isLastRound(m)).toBe(false);
    m = finishRound(m, playOut(['A', 'B']));
    expect(isLastRound(m)).toBe(true);
    m = finishRound(m, playOut(['B', 'A']));
    expect(m.scores).toEqual({ A: 15, B: 15 });
    expect(standings(m.scores).map((r) => r.rank)).toEqual([1, 1]);
  });

  it('Runden bleiben in Grenzen', () => {
    expect(createMatch({ players: [{ name: 'A' }], rounds: 99, fallback: ['f'], seed: 1 }).rounds).toBe(10);
    expect(createMatch({ players: [{ name: 'A' }], rounds: 0, fallback: ['f'], seed: 1 }).rounds).toBe(1);
  });

  it('Tabelle sortiert nach Punkten', () => {
    expect(standings({ A: 3, B: 10, C: 3 })).toEqual([
      { name: 'B', points: 10, rank: 1 },
      { name: 'A', points: 3, rank: 2 },
      { name: 'C', points: 3, rank: 2 },
    ]);
  });
});
