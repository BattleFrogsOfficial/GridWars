'use strict';
// ---------- Online 1 vs 1 (host-authoritative, WebRTC via PeerJS) ----------
const Net = { mode: 'none', peer: null, conn: null, code: '', fxBuf: [], onError: null, onOpen: null };
const PEER_PREFIX = 'dinoduel-v1-';
function loadPeer() {
  return new Promise((res, rej) => {
    if (window.Peer) return res();
    const s = document.createElement('script'); s.src = 'js/vendor/peerjs.min.js';
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not load the multiplayer library.'));
    document.head.appendChild(s);
  });
}
function netClose() { try { if (Net.peer) Net.peer.destroy(); } catch (e) { } Net.peer = Net.conn = null; Net.mode = 'none'; }
function netErr(e) { if (Net.onError) Net.onError(e.type === 'peer-unavailable' ? 'No game found with that code.' : e.type === 'unavailable-id' ? 'Room code clash, try again.' : 'Network error: ' + (e.type || e.message || e)); }
async function netHost() {
  await loadPeer(); netClose(); Net.mode = 'host';
  Net.code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join('');
  Net.peer = new Peer(PEER_PREFIX + Net.code);
  Net.peer.on('open', () => Net.onOpen && Net.onOpen(Net.code));
  Net.peer.on('error', netErr);
  Net.peer.on('connection', c => {
    if (Net.conn) { c.on('open', () => { c.send({ t: 'full' }); }); return; }
    Net.conn = c;
    c.on('open', () => { newMatch({ bots: [null, null] }); c.send({ t: 'start' }); startGame(0, 'host'); });
    c.on('data', m => { if (m && m.t === 'i' && G && G.host) { const i = G.inp[1]; i.mx = clamp(+m.mx || 0, -1, 1); i.jc = m.jc | 0; i.a = !!m.a; } });
    c.on('close', () => { if (Net.conn === c) { Net.conn = null; netLost('Your opponent left the game.'); } });
  });
}
async function netJoin(code) {
  await loadPeer(); netClose(); Net.mode = 'client'; Net.code = code;
  Net.peer = new Peer(); Net.peer.on('error', netErr);
  Net.peer.on('open', () => {
    const c = Net.conn = Net.peer.connect(PEER_PREFIX + code, { reliable: true });
    c.on('data', m => {
      if (!m) return;
      if (m.t === 'full') { if (Net.onError) Net.onError('That game already has two players.'); }
      else if (m.t === 'start') { clientInit(); startGame(1, 'client'); }
      else if (m.t === 's' && G && !G.host) { applySnap(m); if (m.fx) for (const f of m.fx) handleFx(f); }
    });
    c.on('close', () => netLost('The host left the game.'));
  });
}
function netSend() { // host: after sim ticks
  if (!Net.conn || !Net.conn.open) { Net.fxBuf.length = 0; return; }
  const m = makeSnap(); if (Net.fxBuf.length) { m.fx = Net.fxBuf; Net.fxBuf = []; }
  try { Net.conn.send(m); } catch (e) { }
}
function netInput(i) { if (Net.conn && Net.conn.open) try { Net.conn.send({ t: 'i', mx: i.mx, jc: i.jc, a: i.a }); } catch (e) { } }
