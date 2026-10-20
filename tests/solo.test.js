import { describe, expect, it } from 'vitest';
import { prepareCategory } from '../src/logic/category.js';
import { createSolo, skipSolo, soloScore, submitSolo } from '../src/logic/solo.js';

const fixture = prepareCategory({
  id: 'test',
  label: 'Länder',
  task: 'EIN LAND MIT',
  entries: [
    { name: 'Türkei', variants: ['Türkiye'] },
    { name: 'Tansania' },
    { name: 'Togo' },
    { name: 'Tunesien' },
    { name: 'Deutschland' },
    { name: 'Dänemark' },
    { name: 'Dominica' },
    { name: 'Dschibuti' },
  ],
});

const solo = (letter) => ({ ...createSolo({ category: fixture, seed: 1 }), letter, usedLetters: [letter] });

describe('Solo', () => {
  it('startet mit einem Buchstaben, der genug hergibt', () => {
    expect(['T', 'D']).toContain(createSolo({ category: fixture, seed: 7 }).letter);
  });

  it('Treffer zählt und bringt einen neuen Buchstaben', () => {
    const [s, r] = submitSolo(solo('T'), fixture, 'Togo');
    expect(r).toMatchObject({ kind: 'valid', name: 'Togo' });
    expect(soloScore(s)).toBe(1);
    expect(s.letter).toBe('D');
  });

  it('Tippfehler zählt als das gemeinte Wort', () => {
    const [s, r] = submitSolo(solo('T'), fixture, 'Tansanja');
    expect(r).toMatchObject({ kind: 'valid', name: 'Tansania', typo: true });
    expect(soloScore(s)).toBe(1);
  });

  it('Unbekanntes, falscher Buchstabe und Doppeltes zählen nicht', () => {
    const start = solo('T');
    expect(submitSolo(start, fixture, 'Taka-Tuka-Land')[1].kind).toBe('unknown');
    expect(submitSolo(start, fixture, 'Dänemark')[1].kind).toBe('wrongLetter');
    const used = { ...start, usedEntries: [2] };
    expect(submitSolo(used, fixture, 'Togo')[1].kind).toBe('used');
    expect(soloScore(submitSolo(start, fixture, 'Taka-Tuka-Land')[0])).toBe(0);
  });

  it('Überspringen wechselt den Buchstaben ohne Punkt', () => {
    const s = skipSolo(solo('T'), fixture);
    expect(s.letter).toBe('D');
    expect(s.skips).toBe(1);
    expect(soloScore(s)).toBe(0);
  });
});
