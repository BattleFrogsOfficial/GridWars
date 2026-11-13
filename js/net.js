'use strict';
// ---------- Peer-to-peer multiplayer (host-authoritative, via PeerJS / WebRTC) ----------
const Net = { mode: 'none', peer: null, conns: [], conn: null, code: '', name: '', buf: { e: [], fx: [], msg: [] }, onLobby: null, onError: null };
const PEER_PREFIX = 'gridwars-v1-';
function loadPeer() {
  return new Promise((res, rej) => {
    if (window.Peer) return res();
    const s = document.createElement('script'); s.src = 'js/vendor/peerjs.min.js';
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not load the multiplayer library.'));
    document.head.appendChild(s);
  });
}
function lobbyList() { return [Net.name].concat(Net.conns.map(c => c.pname)); }
function sendLobby() { const l = lobbyList(); for (const c of Net.conns) c.send({ t: 'lobby', players: l }); if (Net.onLobby) Net.onLobby(l); }
async function netHost(name) {
  await loadPeer();
  Net.mode = 'host'; Net.name = name; Net.conns = [];
  Net.code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join('');
  Net.peer = new Peer(PEER_PREFIX + Net.code);
  Net.peer.on('open', () => sendLobby());
  Net.peer.on('error', e => Net.onError && Net.onError(e.type === 'unavailable-id' ? 'Room code clash, please try again.' : 'Network error: ' + (e.type || e.message)));
  Net.peer.on('connection', c => {
    c.on('data', m => {
      if (!m) return;
      if (m.t === 'join') {
        if (running || Net.conns.length >= 3 || Net.conns.includes(c)) { c.send({ t: 'full' }); return; }
        c.pname = String(m.name || 'Player').slice(0, 16); Net.conns.push(c); sendLobby();
      } else if (m.t === 'cmd' && running && c.slot != null) { try { applyCmd(c.slot, m.c); } catch (e) { console.warn('bad command', e); } }
    });
    c.on('close', () => {
      const i = Net.conns.indexOf(c); if (i < 0) return; Net.conns.splice(i, 1);
      if (running && S && c.slot != null) { const p = S.players[c.slot]; if (p && p.alive) { makeAI(p, 'normal'); S.msgs.push(p.name + ' left. The computer takes over their village.'); } }
      else sendLobby();
    });
  });
}
async function netJoin(code, name) {
  await loadPeer();
  Net.mode = 'client'; Net.name = name; Net.code = code;
  Net.peer = new Peer();
  Net.peer.on('error', e => Net.onError && Net.onError(e.type === 'peer-unavailable' ? 'No game found with that code.' : 'Network error: ' + (e.type || e.message)));
  Net.peer.on('open', () => {
    const c = Net.conn = Net.peer.connect(PEER_PREFIX + code, { reliable: true });
    c.on('open', () => c.send({ t: 'join', name }));
    c.on('data', m => {
      if (!m) return;
      if (m.t === 'lobby') { if (Net.onLobby) Net.onLobby(m.players); }
      else if (m.t === 'full') { if (Net.onError) Net.onError('That game is full or already started.'); }
      else if (m.t === 'start') { clientState(m.seed, m.players); startGame(m.you); }
      else if (m.t === 's' && S && !S.host) { applySnap(m); consumeEvents(m.e, m.fx, m.msg); }
    });
    c.on('close', () => { if (Net.onError) Net.onError('Disconnected from the host.'); toast('Disconnected from the host.'); });
  });
}
function netStart(seed, aiCount, diff) {
  const players = lobbyList().map(n => ({ name: n, ai: false }));
  for (let i = 0; i < aiCount && players.length < 4; i++) players.push({ name: 'Computer ' + (i + 1), ai: true, diff });
  newGame({ seed, players });
  Net.conns.forEach((c, i) => { c.slot = i + 1; c.send({ t: 'start', seed, players: players.map(p => ({ name: p.name, ai: p.ai })), you: c.slot }); });
  startGame(0);
}
function netSnapshot() { // host: called after sim ticks
  if (!Net.conns.length) { Net.buf.e.length = Net.buf.fx.length = Net.buf.msg.length = 0; return; }
  const m = makeSnap(false);
  if (Net.buf.e.length) m.e = Net.buf.e; if (Net.buf.fx.length) m.fx = Net.buf.fx; if (Net.buf.msg.length) m.msg = Net.buf.msg;
  Net.buf = { e: [], fx: [], msg: [] };
  for (const c of Net.conns) { try { c.send(m); } catch (e) { } }
}
function sendCmd(c) { if (S.host) applyCmd(ME, c); else if (Net.conn && Net.conn.open) Net.conn.send({ t: 'cmd', c }); }
