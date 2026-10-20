import { initialLetter, normalize } from './normalize.js';

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Buchstaben, mit denen in fast jedem Thema genug Wörter anfangen – für Themen ohne Liste. */
export const OPEN_LETTERS = 'ABDEFGHKLMNPRSTW'.split('');

/** Einträge als Objekte; `words: "Aal, Adler, Elfenbeinküste / Côte d'Ivoire"` ist die Kurzform. */
function rawEntries(raw) {
  if (raw.entries) return raw.entries;
  return String(raw.words ?? '')
    .split(',')
    .map((w) => w.split('/').map((f) => f.trim()).filter(Boolean))
    .filter((forms) => forms.length)
    .map(([name, ...variants]) => ({ name, variants }));
}

/**
 * Bereitet eine Kategorie-Datei auf.
 * keys: jede Schreibweise als { key, letter, text, entry } – für Treffer und Tippfehler-Suche.
 * open: Liste ist nur ein Anfang (oder leer), Unbekanntes wird abgestimmt, Buchstaben aus OPEN_LETTERS.
 */
export function prepareCategory(raw) {
  const entries = rawEntries(raw).map((e, index) => {
    const forms = [e.name, ...(e.variants ?? [])];
    return {
      index,
      name: e.name,
      forms,
      letters: [...new Set(forms.map(initialLetter).filter(Boolean))],
    };
  });

  const byKey = new Map();
  const keys = [];
  for (const entry of entries) {
    for (const text of entry.forms) {
      const key = normalize(text);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, entry.index);
      keys.push({ key, letter: initialLetter(text), text, entry: entry.index });
    }
  }

  return {
    id: raw.id,
    label: raw.label,
    task: raw.task,
    group: raw.group ?? null,
    custom: !!raw.custom,
    open: !!raw.open || entries.length === 0,
    entries,
    byKey,
    keys,
  };
}

/** Wie viele noch nicht genannte Einträge mit diesem Buchstaben gelten können. */
export function remainingFor(category, letter, usedEntries) {
  let n = 0;
  for (const entry of category.entries) {
    if (!usedEntries.includes(entry.index) && entry.letters.includes(letter)) n++;
  }
  return n;
}
