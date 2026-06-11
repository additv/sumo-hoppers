/* main.js — input, menu, game loop */

(() => {
  const $ = (id) => document.getElementById(id);

  // inputs[player] = {a, e}; a = leg angle (-1 back / +1 forward),
  // e = knee (-1 bend / +1 extend); player 0 = vermilion, 1 = indigo
  const inputs = [{ a: 0, e: 0 }, { a: 0, e: 0 }];
  let mySide = 0;        // which hopper this device controls (online)
  let running = false;
  const resetControls = [];

  // ---- leg controls ---------------------------------------------------------
  // Each touch pad is a small one-legged puppet. The hip stays fixed and the
  // player drags the foot; that pose is translated into angle/extension input.
  const CONTROL = { neutralLen: 112, minLen: 58, maxLen: 158, maxX: 120 };

  for (const pad of document.querySelectorAll('.pad')) {
    const p = +pad.dataset.p;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const thigh = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const shin = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const hip = document.createElement('div');
    const foot = document.createElement('div');
    const mirror = p === 0 ? 1 : -1;
    let pointerId = null;
    let pose = null;

    svg.classList.add('leg-lines');
    thigh.classList.add('leg-thigh');
    shin.classList.add('leg-shin');
    ghost.classList.add('leg-ghost');
    svg.append(ghost, thigh, shin);
    hip.className = 'leg-hip';
    foot.className = 'leg-foot';
    pad.append(svg, hip, foot);

    function metrics() {
      const r = pad.getBoundingClientRect();
      const safeTop = Math.max(52, r.height * 0.25);
      const hipX = r.width / 2;
      const hipY = Math.min(safeTop, r.height - CONTROL.neutralLen - 28);
      return {
        hipX,
        hipY,
        minY: hipY + CONTROL.minLen * 0.45,
        maxY: r.height - 34,
        minX: Math.max(34, hipX - CONTROL.maxX),
        maxX: Math.min(r.width - 34, hipX + CONTROL.maxX),
      };
    }

    function setLine(line, x1, y1, x2, y2) {
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
    }

    function setPose(x, y, active = false) {
      const m = metrics();
      const footX = Math.max(m.minX, Math.min(m.maxX, x));
      const footY = Math.max(m.minY, Math.min(m.maxY, y));
      const dx = footX - m.hipX;
      const dy = footY - m.hipY;
      const len = Math.hypot(dx, dy) || CONTROL.neutralLen;
      const bend = Math.min(42, Math.max(16, (CONTROL.maxLen - len) * 0.45));
      const kneeX = m.hipX + dx * 0.52 + mirror * bend;
      const kneeY = m.hipY + dy * 0.48 - Math.abs(dx) * 0.08;

      pose = { x: footX, y: footY };
      hip.style.left = m.hipX + 'px';
      hip.style.top = m.hipY + 'px';
      foot.style.left = footX + 'px';
      foot.style.top = footY + 'px';
      pad.classList.toggle('active', active);
      setLine(ghost, m.hipX, m.hipY, m.hipX + mirror * 18, m.hipY + CONTROL.neutralLen);
      setLine(thigh, m.hipX, m.hipY, kneeX, kneeY);
      setLine(shin, kneeX, kneeY, footX, footY);

      inputs[p].a = Math.max(-1, Math.min(1, (dx * mirror) / CONTROL.maxX));
      inputs[p].e = Math.max(-1, Math.min(1, (len - CONTROL.neutralLen) / (CONTROL.maxLen - CONTROL.neutralLen)));
    }

    function resetPose() {
      const m = metrics();
      setPose(m.hipX + mirror * 18, m.hipY + CONTROL.neutralLen, false);
      inputs[p].a = 0;
      inputs[p].e = 0;
    }

    function move(clientX, clientY) {
      const r = pad.getBoundingClientRect();
      setPose(clientX - r.left, clientY - r.top, true);
    }

    function end() {
      pointerId = null;
      resetPose();
    }

    pad.addEventListener('pointerdown', (e) => {
      if (pointerId !== null) return;
      e.preventDefault();
      pointerId = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      move(e.clientX, e.clientY);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId === pointerId) move(e.clientX, e.clientY);
    });
    pad.addEventListener('pointerup', (e) => { if (e.pointerId === pointerId) end(); });
    pad.addEventListener('pointercancel', (e) => { if (e.pointerId === pointerId) end(); });
    addEventListener('resize', () => {
      if (pointerId === null) resetPose();
      else setPose(pose.x, pose.y, true);
    });
    resetControls.push(resetPose);
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
    resetControls.forEach((resetControl) => resetControl());
    Game.resize();
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
