import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareCategory } from '../src/logic/category.js';
import { normalize } from '../src/logic/normalize.js';

const dir = new URL('../src/data/', import.meta.url);
const load = (path) => JSON.parse(readFileSync(new URL(path, dir), 'utf8'));
const files = readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.json'));
const all = files.flatMap((file) => [load(file)].flat().map((raw) => [`${file} › ${raw.id}`, raw]));

describe.each(all)('%s', (_, raw) => {
  const cat = prepareCategory(raw);

  it('hat id, label, task und genug Einträge', () => {
    expect(raw.id && raw.label && raw.task).toBeTruthy();
    expect(raw.task).toMatch(/ MIT$/);
    expect(cat.entries.length).toBeGreaterThan(cat.open ? 25 : 40);
  });

  it('letters stimmen mit Name und Varianten überein', () => {
    if (!raw.entries) return;
    cat.entries.forEach((e, i) => expect([...(raw.entries[i].letters ?? [])].sort()).toEqual([...e.letters].sort()));
  });

  it('keine Schreibweise gehört zu zwei Einträgen', () => {
    const owner = new Map();
    for (const k of cat.keys) {
      if (owner.has(k.key)) expect(owner.get(k.key), k.text).toBe(k.entry);
      owner.set(k.key, k.entry);
    }
  });
});

it('ids sind eindeutig, 3 Hauptkategorien + 100 Themen', () => {
  const ids = all.map(([, raw]) => raw.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual(expect.arrayContaining(['countries', 'food', 'animals']));
  expect(ids.length - 3).toBe(100);
});

it('Länder: 197 Staaten, bekannte Fälle dabei', () => {
  const raw = load('countries.json');
  const cat = prepareCategory(raw);
  expect(raw.entries.length).toBe(197);
  for (const n of ['Kosovo', 'Taiwan', 'Palästina', 'Vatikanstadt', 'USA', 'Tuerkei', "Côte d'Ivoire"]) {
    expect(cat.byKey.has(normalize(n)), n).toBe(true);
  }
});
