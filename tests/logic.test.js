import { describe, expect, it } from 'vitest';
import { prepareCategory, remainingFor } from '../src/logic/category.js';
import { canAct, createGame, pickLetter, reduce } from '../src/logic/game.js';
import { OPEN_LETTERS } from '../src/logic/category.js';
import { initialLetter, normalize, withinOneEdit } from '../src/logic/normalize.js';

const fixture = prepareCategory({
  id: 'test',
  label: 'Länder',
  task: 'EIN LAND MIT',
  entries: [
    { name: 'Türkei', variants: ['Türkiye', 'Turkey'] },
    { name: 'Tansania' },
    { name: 'Togo' },
    { name: 'Tunesien' },
    { name: 'Tschad' },
    { name: 'Deutschland', variants: ['Bundesrepublik Deutschland', 'BRD'] },
    { name: 'Dänemark' },
    { name: 'Dominica' },
    { name: 'Dschibuti' },
    { name: 'Dominikanische Republik' },
    { name: 'Elfenbeinküste', variants: ["Côte d'Ivoire"] },
  ],
});

/** Spiel mit festem Buchstaben, damit Tests nicht vom Zufall abhängen. */
function game(letter, names = ['Lena', 'Max', 'Ole']) {
  const s = createGame({ names, settings: {}, category: fixture, seed: 1 });
  return reduce({ ...s, letter, usedLetters: [letter] }, { type: 'READY' }, fixture);
}

const submit = (s, text, ms = 1000) => reduce(s, { type: 'SUBMIT', text, ms }, fixture);

describe('normalize', () => {
  it('ignoriert Groß/klein, Umlaute, Leerzeichen, Bindestriche, ß', () => {
    expect(normalize('Türkei')).toBe(normalize('turkei'));
    expect(normalize('Türkei')).toBe(normalize('TUERKEI'));
    expect(normalize('Neu-Delhi')).toBe(normalize('neu delhi'));
    expect(normalize('Weißrussland')).toBe(normalize('weissrussland'));
    expect(normalize("Côte d'Ivoire")).toBe(normalize('cote divoire'));
  });

  it('nimmt den getippten Anfangsbuchstaben', () => {
    expect(initialLetter('  Österreich')).toBe('O');
    expect(initialLetter('Bundesrepublik Deutschland')).toBe('B');
    expect(initialLetter('')).toBe('');
  });

  it('erkennt einen Buchstaben Abstand', () => {
    expect(withinOneEdit('tansania', 'tansnia')).toBe(true);
    expect(withinOneEdit('tansania', 'tanzania')).toBe(true);
    expect(withinOneEdit('tansania', 'tanzanja')).toBe(false);
  });
});

describe('Antworten prüfen', () => {
  it('akzeptiert gültige Antwort und gibt weiter', () => {
    const s = submit(game('T'), 'türkei');
    expect(s.phase).toBe('handoff');
    expect(s.turn).toBe(1);
    expect(s.players[0].valid).toBe(1);
  });

  it('sperrt alle Varianten eines genannten Landes', () => {
    let s = submit(game('T'), 'Türkei');
    s = reduce(s, { type: 'READY' }, fixture);
    s = submit(s, 'Turkey');
    expect(s.phase).toBe('turn');
    expect(s.feedback.kind).toBe('used');
    s = submit(s, 'TUERKIYE');
    expect(s.feedback.kind).toBe('used');
  });

  it('wertet nach getipptem Anfangsbuchstaben: Bundesrepublik Deutschland bei D ist falsch', () => {
    const s = submit(game('D'), 'Bundesrepublik Deutschland');
    expect(s.phase).toBe('turn');
    expect(s.feedback.kind).toBe('wrongLetter');
  });

  it('fragt bei Tippfehler nach', () => {
    let s = submit(game('T'), 'Tansnia');
    expect(s.phase).toBe('suggest');
    expect(s.suggestion.text).toBe('Tansania');
    s = reduce(s, { type: 'ACCEPT_SUGGESTION' }, fixture);
    expect(s.phase).toBe('handoff');
    expect(s.usedEntries).toContain(1);
  });

  it('Streitfall: Mehrheit entscheidet, Gleichstand zählt nicht', () => {
    let s = submit(game('T', ['A', 'B', 'C', 'D', 'E']), 'Tralalaland');
    expect(s.phase).toBe('dispute');
    expect(s.dispute.voters).toEqual([1, 2, 3, 4]);
    s = reduce(s, { type: 'VOTE', playerId: 1, yes: true }, fixture);
    s = reduce(s, { type: 'VOTE', playerId: 2, yes: true }, fixture);
    s = reduce(s, { type: 'VOTE', playerId: 3, yes: false }, fixture);
    s = reduce(s, { type: 'VOTE', playerId: 4, yes: false }, fixture);
    expect(s.phase).toBe('disputeResult');
    expect(s.dispute.accepted).toBe(false);
    s = reduce(s, { type: 'CONTINUE' }, fixture);
    expect(s.phase).toBe('turn');
    expect(s.turn).toBe(0);
  });

  it('online: nach Rauswurf ist der Nächste sofort dran, gleicher Buchstabe', () => {
    let s = game('T', ['A', 'B', 'C']);
    s = { ...s, settings: { ...s.settings, direct: true } };
    s = submit(s, 'Togo');
    expect(s.turn).toBe(1);
    s = reduce(s, { type: 'TIMEOUT' }, fixture);
    s = reduce(s, { type: 'CONTINUE' }, fixture);
    expect(s.phase).toBe('turn');
    expect(s.turn).toBe(2);
    expect(s.letter).toBe('T');
    s = submit(s, 'Togo');
    expect(s.feedback.kind).toBe('used');
  });

  it('Streitfall angenommen: Antwort zählt und ist danach gesperrt', () => {
    let s = submit(game('T', ['A', 'B']), 'Tralalaland');
    s = reduce(s, { type: 'VOTE', playerId: 1, yes: true }, fixture);
    s = reduce(s, { type: 'CONTINUE' }, fixture);
    expect(s.phase).toBe('handoff');
    s = reduce(s, { type: 'READY' }, fixture);
    s = submit(s, 'tralala-land');
    expect(s.feedback.kind).toBe('used');
  });
});

describe('Buchstaben', () => {
  it('zieht nur Buchstaben mit genug Antworten (Spieler + 2)', () => {
    // 3 Spieler -> mindestens 5 Antworten. Nur T (5) und D (5) reichen.
    for (let seed = 0; seed < 50; seed++) {
      const s = createGame({ names: ['a', 'b', 'c'], settings: {}, category: fixture, seed });
      expect(['T', 'D']).toContain(s.letter);
    }
  });

  it('wiederholt keinen Buchstaben, solange andere passen', () => {
    const s = createGame({ names: ['a', 'b', 'c'], settings: {}, category: fixture, seed: 3 });
    const next = pickLetter(s, fixture);
    expect(next.letter).not.toBe(s.letter);
  });

  it('neuer Buchstabe ohne Rauswurf, wenn alles verbraucht ist', () => {
    let s = game('E', ['a', 'b']);
    s = submit(s, 'Elfenbeinküste');
    expect(remainingFor(fixture, 'E', s.usedEntries)).toBe(0);
    expect(s.letter).not.toBe('E');
    expect(s.notice.exhausted).toBe('E');
    expect(s.players.every((p) => !p.out)).toBe(true);
  });
});

describe('Ausscheiden und Sieg', () => {
  it('Zeit abgelaufen: Spieler fliegt, neuer Buchstabe, nächster beginnt', () => {
    let s = reduce(game('T'), { type: 'TIMEOUT' }, fixture);
    expect(s.phase).toBe('out');
    expect(s.players[0].out).toBe(true);
    s = reduce(s, { type: 'CONTINUE' }, fixture);
    expect(s.phase).toBe('handoff');
    expect(s.turn).toBe(1);
    expect(s.letter).not.toBe('T');
  });

  it('Letzter übrig gewinnt', () => {
    let s = reduce(game('T', ['A', 'B']), { type: 'TIMEOUT' }, fixture);
    s = reduce(s, { type: 'CONTINUE' }, fixture);
    expect(s.phase).toBe('winner');
    expect(s.players.filter((p) => !p.out).map((p) => p.name)).toEqual(['B']);
  });

  it('überspringt ausgeschiedene Spieler', () => {
    let s = game('T');
    s = reduce({ ...s, players: s.players.map((p) => (p.id === 1 ? { ...p, out: true } : p)) }, { type: 'SUBMIT', text: 'Togo', ms: 1 }, fixture);
    expect(s.turn).toBe(2);
  });
});

describe('Themen-Kurzform und offene Themen', () => {
  it('words: Komma trennt Einträge, Schrägstrich Varianten', () => {
    const c = prepareCategory({ id: 'x', label: 'X', task: 'EIN X MIT', words: 'Tomate, Elfenbeinküste / Côte d’Ivoire,  ' });
    expect(c.entries.map((e) => e.name)).toEqual(['Tomate', 'Elfenbeinküste']);
    expect(c.entries[1].letters.sort()).toEqual(['C', 'E']);
    expect(c.open).toBe(false);
  });

  const open = prepareCategory({ id: 'eigen', label: 'Automarken', task: 'EINE AUTOMARKE MIT', entries: [] });

  it('ohne Liste: Buchstabe aus OPEN_LETTERS, Antworten gehen zur Abstimmung', () => {
    let s = createGame({ names: ['a', 'b', 'c'], settings: {}, category: open, seed: 5 });
    expect(open.open).toBe(true);
    expect(OPEN_LETTERS).toContain(s.letter);
    s = reduce(s, { type: 'READY' }, open);
    s = reduce(s, { type: 'SUBMIT', text: `${s.letter}xyz`, ms: 1 }, open);
    expect(s.phase).toBe('dispute');
  });

  it('ohne Liste: Buchstabe bleibt nach gültiger Antwort', () => {
    let s = createGame({ names: ['a', 'b'], settings: {}, category: open, seed: 5 });
    const letter = s.letter;
    s = reduce(s, { type: 'READY' }, open);
    s = reduce(s, { type: 'SUBMIT', text: `${letter}abc`, ms: 1 }, open);
    s = reduce(s, { type: 'VOTE', playerId: 1, yes: true }, open);
    s = reduce(s, { type: 'CONTINUE' }, open);
    expect(s.phase).toBe('handoff');
    expect(s.letter).toBe(letter);
  });
});

describe('Zufallsmodus', () => {
  const other = prepareCategory({ id: 'other', label: 'Tiere', task: 'EIN TIER MIT', words: 'Tiger, Tukan, Dachs, Delfin, Esel' });
  const cats = { test: fixture, other };
  const lookup = (id) => cats[id];

  it('startet mit einem Thema aus dem Pool und wechselt nach jedem Ausscheiden', () => {
    let s = createGame({ names: ['a', 'b', 'c'], settings: { pool: ['test', 'other'] }, category: lookup, seed: 9 });
    const first = s.categoryId;
    expect(['test', 'other']).toContain(first);
    s = reduce(s, { type: 'READY' }, lookup);
    s = reduce(s, { type: 'TIMEOUT' }, lookup);
    s = reduce(s, { type: 'CONTINUE' }, lookup);
    expect(s.categoryId).not.toBe(first);
    expect(s.usedEntries).toEqual([]);
    expect(remainingFor(lookup(s.categoryId), s.letter, [])).toBeGreaterThan(0);
  });
});

it('Tippfehler eines schon genannten Worts zählt als Wiederholung', () => {
  let s = submit(game('T'), 'Togo');
  s = reduce(s, { type: 'READY' }, fixture);
  s = submit(s, 'Toggo');
  expect(s.phase).toBe('turn');
  expect(s.feedback.kind).toBe('used');
});

it('ein einzelner Buchstabe zählt nicht und geht nicht zur Abstimmung', () => {
  const s = submit(game('T'), 'T.');
  expect(s.phase).toBe('turn');
  expect(s.feedback.kind).toBe('tooShort');
});

it('ist die ganze Liste genannt, fängt sie von vorn an statt ohne Buchstaben dazustehen', () => {
  const s = createGame({ names: ['a', 'b'], settings: {}, category: fixture, seed: 2 });
  const all = fixture.entries.map((e) => e.index);
  const next = pickLetter({ ...s, usedEntries: all }, fixture);
  expect(next.letter).not.toBeNull();
  expect(next.usedEntries).toEqual([]);
});

describe('online: LEAVE und canAct', () => {
  it('wer geht während seines Zugs, ist raus', () => {
    const s = reduce(game('T'), { type: 'LEAVE', playerId: 0 }, fixture);
    expect(s.phase).toBe('out');
    expect(s.players[0]).toMatchObject({ out: true, left: true });
  });

  it('wer nicht dran ist, geht still; bei einem Übrigen gewinnt der', () => {
    let s = reduce(game('T'), { type: 'LEAVE', playerId: 2 }, fixture);
    expect(s.phase).toBe('turn');
    expect(s.players[2].out).toBe(true);
    s = reduce(s, { type: 'LEAVE', playerId: 1 }, fixture);
    expect(s.phase).toBe('winner');
  });

  it('Wähler geht im Streitfall: Stimme fällt weg, Abstimmung wird fertig', () => {
    let s = submit(game('T', ['Lena', 'Max', 'Ole', 'Ida']), 'Tralala');
    expect(s.phase).toBe('dispute');
    s = reduce(s, { type: 'VOTE', playerId: 1, yes: true }, fixture);
    s = reduce(s, { type: 'VOTE', playerId: 2, yes: true }, fixture);
    s = reduce(s, { type: 'LEAVE', playerId: 3 }, fixture);
    expect(s.phase).toBe('disputeResult');
    expect(s.dispute.voters).toEqual([1, 2]);
    expect(s.dispute.accepted).toBe(true);
  });

  it('nur wer dran ist, darf tippen; abstimmen nur für sich selbst', () => {
    const s = game('T');
    expect(canAct(s, { type: 'SUBMIT', text: 'Togo' }, 0)).toBe(true);
    expect(canAct(s, { type: 'SUBMIT', text: 'Togo' }, 1)).toBe(false);
    expect(canAct(s, { type: 'VOTE', playerId: 2, yes: true }, 2)).toBe(true);
    expect(canAct(s, { type: 'VOTE', playerId: 2, yes: true }, 1)).toBe(false);
    expect(canAct(s, { type: 'TIMEOUT' }, 0)).toBe(false);
    expect(canAct(s, { type: 'LEAVE', playerId: 1 }, 1)).toBe(false);
  });

  it('direct: nach gültiger Antwort ist der Nächste sofort dran', () => {
    const s0 = game('T');
    const s = submit({ ...s0, settings: { ...s0.settings, direct: true } }, 'türkei');
    expect(s.phase).toBe('turn');
    expect(s.turn).toBe(1);
    expect(s.notice).toMatchObject({ type: 'valid', text: 'türkei' });
  });
});
