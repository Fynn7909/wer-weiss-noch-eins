// Vorschau ohne Netz (?vorschau): ein Raum, in dem Test-Mitspieler schon drin sind.
// Gleiche Schnittstelle wie hostTransport in peer.js, nur geht nichts raus.

export const DEMO_CODE = 'TEST';
const NAMES = ['Lena', 'Max', 'Mia', 'Konstantin', 'Ole', 'Johanna-Sophie', 'Ben'];

/** picksFor(i): Themen-Wünsche des i-ten Test-Mitspielers, damit die Lobby echt aussieht. */
/** bots: wie viele Test-Mitspieler (?vorschau=7 für einen vollen Raum). */
export function demoTransport(handlers, picksFor, bots = 3) {
  const api = {
    code: DEMO_CODE,
    send() {},
    broadcast() {},
    drop() {},
    close() {},
  };
  setTimeout(() => {
    handlers.onReady(DEMO_CODE);
    NAMES.slice(0, bots).forEach((name, i) => {
      const id = `bot-${i}`;
      handlers.onConnect(id);
      handlers.onMessage(id, { t: 'hello', name, token: id });
      handlers.onMessage(id, { t: 'pick', picks: picksFor(i) });
    });
    handlers.onMessage('bot-0', { t: 'suggest', thinkTime: 8 });
  }, 0);
  return api;
}
