// Verbindung über PeerJS: ein Handy hostet, die anderen verbinden sich per Raum-Code.
// Kennt keine Spielregeln, nur Nachrichten rein und raus.

import Peer from 'peerjs';

const PREFIX = 'wer-weiss-v1-';
const OPTS = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
  },
};
// Ohne 0/O und 1/I, damit man den Code gut vorlesen kann
const ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ABC[Math.floor(Math.random() * ABC.length)];
  return s;
}

export const cleanCode = (code) =>
  String(code)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** Host: handlers.onReady(code), onConnect(id), onMessage(id, msg), onDisconnect(id), onError(e). */
export function hostTransport(handlers, tries = 0) {
  const code = makeCode();
  const peer = new Peer(PREFIX + code, OPTS);
  const conns = new Map();
  let closed = false;
  const api = {
    code,
    send(id, msg) {
      const c = conns.get(id);
      if (c?.open) c.send(msg);
    },
    broadcast(msg) {
      conns.forEach((c) => c.open && c.send(msg));
    },
    drop(id) {
      conns.get(id)?.close();
    },
    close() {
      closed = true;
      peer.destroy();
    },
  };
  peer.on('open', () => handlers.onReady(code));
  peer.on('connection', (conn) => {
    conn.on('open', () => {
      conns.set(conn.peer, conn);
      handlers.onConnect(conn.peer);
    });
    conn.on('data', (msg) => handlers.onMessage(conn.peer, msg));
    conn.on('close', () => {
      if (conns.get(conn.peer) !== conn) return;
      conns.delete(conn.peer);
      handlers.onDisconnect(conn.peer);
    });
    conn.on('error', () => {});
  });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id' && tries < 4) {
      peer.destroy();
      Object.assign(api, hostTransport(handlers, tries + 1));
      return;
    }
    if (e.type === 'peer-unavailable') return;
    handlers.onError(e);
  });
  peer.on('disconnected', () => {
    if (closed) return;
    try {
      peer.reconnect();
    } catch {
      /* Server weg, die offenen Verbindungen laufen trotzdem weiter */
    }
  });
  return api;
}

/** Gast: handlers.onOpen(), onMessage(msg), onClose(), onError(e). */
export function joinTransport(code, handlers) {
  const peer = new Peer(OPTS);
  let conn = null;
  let opened = false;
  let closed = false;
  const api = {
    send(msg) {
      if (conn?.open) conn.send(msg);
    },
    close() {
      closed = true;
      peer.destroy();
    },
  };
  peer.on('open', () => {
    conn = peer.connect(PREFIX + cleanCode(code), { reliable: true });
    conn.on('open', () => {
      opened = true;
      handlers.onOpen();
    });
    conn.on('data', (msg) => handlers.onMessage(msg));
    conn.on('close', () => !closed && handlers.onClose());
    conn.on('error', () => {});
    setTimeout(() => {
      if (!opened && !closed) handlers.onError({ type: 'timeout' });
    }, 12000);
  });
  peer.on('error', (e) => !closed && handlers.onError(e));
  return api;
}
