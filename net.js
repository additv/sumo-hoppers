/* PeerJS networking — host-authoritative.
   Host runs the simulation; guest sends inputs and renders state. */

const Net = (() => {
  let peer = null, conn = null;
  let role = 'local';              // 'local' | 'host' | 'guest'
  let remoteInput = { l: 0, r: 0 }; // guest's input, as seen by host
  let remoteState = null;           // host's state, as seen by guest
  let onReady = null, onStatus = null;

  // short human-friendly room codes, namespaced to avoid collisions
  const PREFIX = 'sumo-hoppers-1997-';
  function code() {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += abc[Math.random() * abc.length | 0];
    return s;
  }

  function status(msg) { if (onStatus) onStatus(msg); }

  function wire(c) {
    conn = c;
    conn.on('data', (d) => {
      if (d.t === 'i') remoteInput = d.v;          // guest -> host
      else if (d.t === 's') remoteState = d.v;     // host -> guest
    });
    conn.on('open', () => { status(''); if (onReady) onReady(role); });
    conn.on('close', () => status('opponent left'));
    conn.on('error', (e) => status('connection error: ' + e));
  }

  function host() {
    role = 'host';
    const room = code();
    peer = new Peer(PREFIX + room);
    status('…');
    peer.on('open', () => status('room code: ' + room + ' — waiting for opponent'));
    peer.on('connection', wire);
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { peer.destroy(); host(); } // code collision, reroll
      else status('error: ' + e.type);
    });
    return room;
  }

  function join(room) {
    role = 'guest';
    peer = new Peer();
    status('connecting…');
    peer.on('open', () => wire(peer.connect(PREFIX + room.toUpperCase().trim(),
                                            { reliable: false })));
    peer.on('error', (e) => {
      status(e.type === 'peer-unavailable' ? 'no such room' : 'error: ' + e.type);
    });
  }

  function send(t, v) {
    if (conn && conn.open) conn.send({ t, v });
  }

  return {
    host, join, send,
    get role() { return role; },
    set role(r) { role = r; },
    get remoteInput() { return remoteInput; },
    get remoteState() { return remoteState; },
    set callbacks({ ready, status: st }) { onReady = ready; onStatus = st; },
  };
})();
