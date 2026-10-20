import { describe, expect, it } from 'vitest';
import { createGuestRoom, createHostRoom, MAX_ROOM } from '../src/net/room.js';

/** Host + Gäste ohne Netz: Nachrichten gehen direkt rüber. */
function setup() {
  const log = { lobby: [], actions: [], drops: [], back: [], left: [] };
  const host = createHostRoom(
    { name: 'Lena', token: 'h' },
    {
      onLobby: (p) => log.lobby.push(p),
      onAction: (i, a, seq) => log.actions.push([i, a, seq]),
      onDrop: (i) => log.drops.push(i),
      onBack: (i) => log.back.push(i),
      onLeft: (i) => log.left.push(i),
    },
  );
  const guests = new Map();
  host.attach({
    send: (id, msg) => guests.get(id)?.inbox.push(msg),
    broadcast: (msg) => guests.forEach((g) => g.online && g.inbox.push(msg)),
    drop: (id) => {
      const g = guests.get(id);
      if (g?.online) {
        g.online = false;
        host.handlers.onDisconnect(id);
      }
    },
  });
  function join(id, name, token = id) {
    const g = { inbox: [], online: true };
    g.room = createGuestRoom({ name, token }, {});
    g.room.attach({ send: (msg) => g.online && host.handlers.onMessage(id, msg) });
    guests.set(id, g);
    g.room.handlers.onOpen();
    return g;
  }
  const leave = (id) => {
    guests.get(id).online = false;
    host.handlers.onDisconnect(id);
  };
  return { host, join, leave, log };
}

describe('Raum', () => {
  it('Gäste kommen in die Lobby, gleiche Namen werden unterscheidbar', () => {
    const { host, join } = setup();
    const a = join('a', 'Max');
    join('b', 'max');
    expect(host.names()).toEqual(['Lena', 'Max', 'max 2']);
    expect(a.inbox.at(-1)).toMatchObject({ t: 'lobby' });
    expect(a.inbox.at(-1).players).toHaveLength(3);
  });

  it('Lobby: wer geht, ist weg; voll ist voll', () => {
    const { host, join, leave } = setup();
    join('a', 'Max');
    leave('a');
    expect(host.names()).toEqual(['Lena']);
    for (let i = 1; i < MAX_ROOM; i++) join(`g${i}`, `G${i}`);
    const late = join('late', 'Zu spät');
    expect(late.inbox.at(-1)).toEqual({ t: 'refuse', reason: 'full' });
  });

  it('im Spiel: Start mit eigenem Platz, Aktionen kommen mit Spielernummer an', () => {
    const { host, join, log } = setup();
    const a = join('a', 'Max');
    host.start({ phase: 'handoff' }, 1, []);
    expect(a.inbox.at(-1)).toMatchObject({ t: 'start', you: 1, seq: 1 });
    a.room.act({ type: 'VOTE', playerId: 1, yes: true }, 1);
    expect(log.actions).toEqual([[1, { type: 'VOTE', playerId: 1, yes: true }, 1]]);
  });

  it('im Spiel: Verbindung weg und wieder da = gleicher Platz, neuer Gast abgelehnt', () => {
    const { host, join, leave, log } = setup();
    join('a', 'Max', 'tok-max');
    host.start({ phase: 'turn' }, 4, []);
    leave('a');
    expect(log.drops).toEqual([1]);
    const again = join('a2', 'Max', 'tok-max');
    expect(log.back).toEqual([1]);
    expect(again.inbox.at(-2)).toMatchObject({ t: 'start', you: 1, seq: 4 });
    const stranger = join('x', 'Ole');
    expect(stranger.inbox.at(-1)).toEqual({ t: 'refuse', reason: 'running' });
  });

  it('Nochmal: Offline-Spieler fliegen raus, Reihenfolge rückt weiter', () => {
    const { host, join, leave } = setup();
    join('a', 'Max');
    join('b', 'Ole');
    host.start({}, 1, []);
    leave('b');
    host.toLobby();
    expect(host.names()).toEqual(['Lena', 'Max']);
    host.rotate();
    expect(host.names()).toEqual(['Max', 'Lena']);
    expect(host.me()).toBe(1);
  });
});

describe('Raum nach Nochmal', () => {
  it('Gast auf Platz 0 kann weiter Aktionen schicken', () => {
    const { host, join, log } = setup();
    const a = join('a', 'Max');
    host.rotate();
    host.start({}, 2, []);
    expect(a.inbox.at(-1)).toMatchObject({ t: 'start', you: 0 });
    a.room.act({ type: 'READY' }, 2);
    expect(log.actions).toEqual([[0, { type: 'READY' }, 2]]);
  });
});

describe('Tschüss', () => {
  it('Gast geht im Spiel selbst: sofort gemeldet, kein Warten', () => {
    const { host, join, log } = setup();
    const a = join('a', 'Max');
    host.start({}, 1, []);
    a.room.bye();
    expect(log.left).toEqual([1]);
    expect(host.players()[1].online).toBe(false);
  });

  it('Host geht: Gäste bekommen bye', () => {
    const { host, join } = setup();
    const a = join('a', 'Max');
    host.bye();
    expect(a.inbox.at(-1)).toEqual({ t: 'bye' });
  });
});

describe('Lobby-Wünsche', () => {
  it('Gast wählt Themen und schlägt Bedenkzeit vor; andere sehen nur die Anzahl', () => {
    const { host, join } = setup();
    const a = join('a', 'Max');
    const b = join('b', 'Ole');
    a.room.pick(['countries', 'food', 'animals', 'zuviel', 42]);
    a.room.suggest(8);
    expect(host.picks()).toEqual([
      { name: 'Lena', picks: [] },
      { name: 'Max', picks: ['countries', 'food', 'animals'] },
      { name: 'Ole', picks: [] },
    ]);
    const seen = b.inbox.at(-1).players[1];
    expect(seen).toMatchObject({ name: 'Max', picks: 3, suggest: 8 });
    host.clearSuggest();
    expect(host.players()[1].suggest).toBe(null);
  });

  it('Unsinn wird ignoriert, im Spiel ändert sich nichts mehr', () => {
    const { host, join } = setup();
    const a = join('a', 'Max');
    a.room.suggest(99);
    expect(host.players()[1].suggest).toBe(null);
    host.setPicks(['food']);
    expect(host.picks()[0].picks).toEqual(['food']);
    host.start({}, 1, []);
    a.room.pick(['countries']);
    expect(host.picks()[1].picks).toEqual([]);
  });
});
