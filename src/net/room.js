// Raum = Lobby + Zuordnung Verbindung -> Spieler. Spielregeln stecken in logic/game.js,
// Transport in peer.js; hier nur, wer drin ist und welche Nachricht wohin geht.
//
// Nachrichten Gast -> Host:  hello {name, token} · act {action, seq} · pick {picks} · suggest {thinkTime} · bye
// Nachrichten Host -> Gast:  lobby {players, info, you, back} · start {you, state, seq, customs} · state {state, seq} · refuse {reason} · bye

export const MAX_ROOM = 8;
const MAX_PICKS = 3;

/** Themenwahl aus dem Netz: höchstens 3 kurze, verschiedene Texte. Ob es die Themen gibt, prüft die App. */
const cleanPicks = (list) =>
  Array.isArray(list) ? [...new Set(list.filter((x) => typeof x === 'string' && x.length <= 40))].slice(0, MAX_PICKS) : [];
const cleanSuggest = (n) => (Number.isInteger(n) && n >= 3 && n <= 15 ? n : null);

/** Gleiche Namen unterscheidbar machen: "Max", "Max 2" … */
function uniqueName(name, taken) {
  const base = String(name).trim().slice(0, 16) || 'Gast';
  const lower = new Set(taken.map((n) => n.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!lower.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/**
 * Host-Seite. `transport` braucht send(id,msg), broadcast(msg), drop(id).
 * Ereignisse an die App: onLobby(players), onAction(playerId, action, seq), onDrop(playerId), onLeft(playerId), onBack(playerId).
 * Die eigene Verbindung des Hosts ist conn = null (nach "Nochmal" nicht mehr unbedingt Platz 0).
 */
export function createHostRoom({ name, token }, events) {
  let transport = null;
  let inGame = false;
  let info = {};
  let last = null; // letzter Spielstand, für wer neu verbindet
  const players = [{ name: uniqueName(name, []), token, conn: null, online: true, self: true, picks: [], suggest: null }];

  // Gäste sehen von fremden Themen nur die Anzahl – Überraschung bleibt
  const publicList = () =>
    players.map((p) => ({ name: p.name, online: p.online, host: isHost(p), picks: p.picks.length, suggest: p.suggest }));
  const byConn = (id) => (id == null ? -1 : players.findIndex((p) => p.conn === id));
  const isHost = (p) => p.self === true;
  /** Jeder Gast bekommt die Liste plus seinen eigenen Platz (you). */
  const pushLobby = (back = false) => {
    const list = publicList();
    players.forEach((p, i) => p.conn && transport?.send(p.conn, { t: 'lobby', players: list, info, you: i, back }));
    events.onLobby?.(list);
  };
  const startMsg = (i) => ({ t: 'start', you: i, ...last });

  function onMessage(id, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const known = players.findIndex((p) => p.token && p.token === msg.token && !isHost(p));
      if (known >= 0) {
        // Neu geladen oder Netz kurz weg: gleicher Platz wie vorher
        const old = players[known].conn;
        players[known].conn = id;
        players[known].online = true;
        if (old && old !== id) transport.drop(old);
        if (inGame) {
          transport.send(id, startMsg(known));
          events.onBack?.(known);
        }
        pushLobby();
        return;
      }
      if (inGame) return refuse(id, 'running');
      if (players.length >= MAX_ROOM) return refuse(id, 'full');
      players.push({
        name: uniqueName(msg.name, players.map((p) => p.name)),
        token: String(msg.token ?? ''),
        conn: id,
        online: true,
        picks: [],
        suggest: null,
      });
      pushLobby();
      return;
    }
    if (msg.t === 'act') {
      const i = byConn(id);
      if (i >= 0 && inGame) events.onAction?.(i, msg.action, msg.seq);
    }
    if (msg.t === 'pick' || msg.t === 'suggest') {
      const i = byConn(id);
      if (i < 0 || inGame) return;
      if (msg.t === 'pick') players[i].picks = cleanPicks(msg.picks);
      else players[i].suggest = cleanSuggest(msg.thinkTime);
      pushLobby();
      return;
    }
    if (msg.t === 'bye') {
      const i = byConn(id);
      if (i < 0) return;
      onDisconnect(id);
      if (inGame) events.onLeft?.(i);
    }
  }

  function refuse(id, reason) {
    transport.send(id, { t: 'refuse', reason });
    setTimeout(() => transport.drop(id), 300);
  }

  function onDisconnect(id) {
    const i = byConn(id);
    if (i < 0) return;
    if (inGame) {
      players[i].online = false;
      players[i].conn = null;
      events.onDrop?.(i);
    } else {
      players.splice(i, 1);
    }
    pushLobby();
  }

  return {
    attach(t) {
      transport = t;
    },
    handlers: { onConnect() {}, onMessage, onDisconnect },
    players: () => publicList(),
    setInfo(next) {
      info = next;
      pushLobby();
    },
    /** Eigene Themen des Hosts. */
    setPicks(list) {
      players[players.findIndex(isHost)].picks = cleanPicks(list);
      pushLobby();
    },
    /** Alle Wünsche fürs Planen der Partie: [{name, picks}] in Spielreihenfolge. */
    picks: () => players.map((p) => ({ name: p.name, picks: [...p.picks] })),
    /** Vorschläge, die gerade übernommen wurden, verschwinden. */
    clearSuggest(value) {
      players.forEach((p) => p.suggest === value && (p.suggest = null));
      pushLobby();
    },
    rename(next) {
      players[0].name = uniqueName(next, players.slice(1).map((p) => p.name));
      pushLobby();
    },
    /** Spiel starten: wer offline ist, fliegt vorher aus der Liste. Gibt die Namen in Spielreihenfolge zurück. */
    names() {
      for (let i = players.length - 1; i >= 0; i--) if (!players[i].online) players.splice(i, 1);
      return players.map((p) => p.name);
    },
    /** Nochmal: Startspieler rückt eins weiter. */
    rotate() {
      players.push(players.shift());
    },
    me: () => players.findIndex(isHost),
    start(state, seq, customs) {
      inGame = true;
      last = { state, seq, customs };
      players.forEach((p, i) => p.conn && transport.send(p.conn, startMsg(i)));
    },
    state(state, seq) {
      last = { ...last, state, seq };
      transport?.broadcast({ t: 'state', state, seq });
    },
    bye() {
      transport?.broadcast({ t: 'bye' });
    },
    toLobby() {
      inGame = false;
      for (let i = players.length - 1; i >= 0; i--) if (!players[i].online) players.splice(i, 1);
      pushLobby(true);
    },
  };
}

/** Gast-Seite. Ereignisse: onLobby(players, info, back, you), onStart({you, state, seq, customs}), onState(state, seq), onRefuse(reason), onBye(). */
export function createGuestRoom({ name, token }, events) {
  let transport = null;
  return {
    attach(t) {
      transport = t;
    },
    handlers: {
      onOpen() {
        transport.send({ t: 'hello', name, token });
      },
      onMessage(msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'lobby') events.onLobby?.(msg.players, msg.info ?? {}, !!msg.back, msg.you);
        else if (msg.t === 'start') events.onStart?.(msg);
        else if (msg.t === 'state') events.onState?.(msg.state, msg.seq);
        else if (msg.t === 'refuse') events.onRefuse?.(msg.reason);
        else if (msg.t === 'bye') events.onBye?.();
      },
    },
    act(action, seq) {
      transport?.send({ t: 'act', action, seq });
    },
    pick(picks) {
      transport?.send({ t: 'pick', picks });
    },
    suggest(thinkTime) {
      transport?.send({ t: 'suggest', thinkTime });
    },
    bye() {
      transport?.send({ t: 'bye' });
    },
  };
}
