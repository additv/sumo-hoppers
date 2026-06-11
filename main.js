/* main.js — input, menu, game loop */

(() => {
  const $ = (id) => document.getElementById(id);

  // inputs[player] = {a, e}; a = leg angle (-1 back / +1 forward),
  // e = knee (-1 bend / +1 extend); player 0 = vermilion, 1 = indigo
  const inputs = [{ a: 0, e: 0 }, { a: 0, e: 0 }];
  let mySide = 0;        // which hopper this device controls (online)
  let running = false;

  // ---- virtual thumbsticks --------------------------------------------------
  // A floating stick spawns wherever the player touches their pad.
  // x axis = leg angle (toward / away from opponent), y axis = knee
  // (up = kick out, down = crouch). Continuous in [-1, 1].
  const STICK_R = 55;

  for (const pad of document.querySelectorAll('.pad')) {
    const p = +pad.dataset.p;
    let pointerId = null, base = null, knob = null, ox = 0, oy = 0;

    function spawn(x, y) {
      base = document.createElement('div');
      base.className = 'stick-base';
      knob = document.createElement('div');
      knob.className = 'stick-knob';
      base.appendChild(knob);
      const r = pad.getBoundingClientRect();
      ox = x; oy = y;
      base.style.left = (x - r.left) + 'px';
      base.style.top = (y - r.top) + 'px';
      pad.appendChild(base);
    }

    function move(x, y) {
      let dx = x - ox, dy = y - oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
      knob.style.left = (55 + dx) + 'px';
      knob.style.top = (55 + dy) + 'px';
      // mirror x for indigo so "toward opponent" is always pushing inward
      const mirror = p === 0 ? 1 : -1;
      inputs[p].a = (dx / STICK_R) * mirror;
      inputs[p].e = -dy / STICK_R;
    }

    function end() {
      pointerId = null;
      if (base) base.remove();
      base = knob = null;
      inputs[p].a = 0;
      inputs[p].e = 0;
    }

    pad.addEventListener('pointerdown', (e) => {
      if (pointerId !== null) return;
      e.preventDefault();
      pointerId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      spawn(e.clientX, e.clientY);
      move(e.clientX, e.clientY);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointerId && base) move(e.clientX, e.clientY);
    });
    pad.addEventListener('pointerup', (e) => { if (e.pointerId === pointerId) end(); });
    pad.addEventListener('pointercancel', (e) => { if (e.pointerId === pointerId) end(); });
  }

  // ---- keyboard (desktop testing) -------------------------------------------
  // P1: A/D angle, W/S knee.  P2: J/L angle, I/K knee.
  const KEYS = {
    a: [0, 'a', -1], d: [0, 'a', 1], w: [0, 'e', 1], s: [0, 'e', -1],
    l: [1, 'a', -1], j: [1, 'a', 1], i: [1, 'e', 1], k: [1, 'e', -1],
  };
  addEventListener('keydown', (e) => {
    const m = KEYS[e.key.toLowerCase()];
    if (m) inputs[m[0]][m[1]] = m[2];
  });
  addEventListener('keyup', (e) => {
    const m = KEYS[e.key.toLowerCase()];
    if (m && inputs[m[0]][m[1]] === m[2]) inputs[m[0]][m[1]] = 0;
  });

  // ---- menu -----------------------------------------------------------------
  Net.callbacks = {
    status: (msg) => { $('net-status').textContent = msg; },
    ready: (role) => {
      mySide = role === 'host' ? 0 : 1;
      start('online');
    },
  };

  $('btn-local').onclick = () => { Net.role = 'local'; start('local'); };
  $('btn-host').onclick = () => Net.host();
  $('btn-join').onclick = () => $('join-row').classList.remove('hidden');
  $('btn-join-go').onclick = () => Net.join($('join-code').value);

  function start(mode) {
    $('menu').classList.add('hidden');
    $('touch-ui').classList.remove('hidden');
    const p1 = $('pad-p1'), p2 = $('pad-p2');
    if (mode === 'local') {
      p1.classList.remove('hidden', 'full');
      p2.classList.remove('hidden', 'full');
    } else {
      // each device shows only its own pad, full width
      const mine = mySide === 0 ? p1 : p2;
      const theirs = mySide === 0 ? p2 : p1;
      mine.classList.remove('hidden'); mine.classList.add('full');
      theirs.classList.add('hidden');
    }
    Game.reset();
    running = true;
  }

  // ---- loop -----------------------------------------------------------------
  function frame() {
    requestAnimationFrame(frame);
    if (!running) return;

    const role = Net.role;
    let label = '';

    if (role === 'local') {
      Game.step(inputs);
    } else if (role === 'host') {
      Game.step([inputs[0], Net.remoteInput]);
      Net.send('s', Game.serialize());
      label = 'you are vermilion';
    } else if (role === 'guest') {
      Net.send('i', inputs[1]);
      if (Net.remoteState) Game.deserialize(Net.remoteState);
      label = 'you are indigo';
    }

    Game.draw(label);
  }
  requestAnimationFrame(frame);
})();
