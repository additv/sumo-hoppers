/* Fight of the Sumo Hoppers — physics + ink rendering.
   Verlet particles, distance constraints, and the Korppi trick:
   the two hoppers are tethered together with an inflexible bond. */

const Game = (() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // World is simulated in fixed coordinates and scaled to the screen,
  // so host and guest (and any phone) see the same match.
  const W = 800, H = 450;
  const FLOOR = H - 60;
  const GRAV = 0.42;
  const ITER = 10;

  const COLORS = ['#b5482a', '#3d5a80']; // vermilion, indigo
  const INK = '#2b2b28';

  let view = { scale: 1, ox: 0, oy: 0, w: 0, h: 0 };

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    view.w = w;
    view.h = h;
    view.scale = Math.min(w / W, h / H);
    view.ox = (w - W * view.scale) / 2;
    view.oy = (h - H * view.scale) / 2;
  }
  addEventListener('resize', resize);
  new ResizeObserver(resize).observe(canvas);
  resize();

  // ---- particles & constraints -------------------------------------------

  function pt(x, y) { return { x, y, px: x, py: y }; }

  function makeHopper(side) {
    // side: 0 = left/vermilion, 1 = right/indigo
    // One leg per hopper (as in the original): the player controls the
    // leg's angle at the hip and its extension at the knee.
    const dir = side === 0 ? 1 : -1;
    // Interlocked spawn, as in the original: hips crossed together at
    // center ring, heads apart above, legs splayed outward to the floor.
    // leg angle chosen so the foot plants beneath the head once the
    // pair settles into the clinch (heads rest just outboard of hips)
    const ang = -0.12, len = 95;
    const hipX = W / 2 - dir * 20;
    const hipY = FLOOR - Math.cos(ang) * len;
    return {
      side, dir, ang, len,
      head: pt(hipX - dir * 8, hipY - 57), // |(8,57)| ≈ SPINE
      hip:  pt(hipX, hipY),
      foot: pt(hipX + dir * Math.sin(ang) * len, FLOOR),
      plantX: null,
    };
  }

  const LEG_MIN = 45, LEG_MAX = 130, LEG_SPEED = 4.2;
  const ANG_MAX = 1.2, ANG_SPEED = 0.05;
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const SPINE = 58;
  const HEAD_R = 16;
  // hip joint limit: -2·SPINE·cos(110°), for the head-foot chord that
  // corresponds to the tightest allowed torso-thigh angle
  const FOLD_K = -2 * SPINE * Math.cos((110 * Math.PI) / 180);

  let state = null;

  function reset(scores) {
    const hoppers = [makeHopper(0), makeHopper(1)];
    state = {
      hoppers,
      // the inflexible grip, measured from the spawn pose so spawn is
      // exactly at equilibrium: each head locked to the opponent's hip
      gripLen: dist(hoppers[0].head, hoppers[1].hip),
      hipLen: dist(hoppers[0].hip, hoppers[1].hip),
      scores: scores || [0, 0],
      winner: -1,        // round winner, -1 while live
      freeze: 0,         // frames to hold after a fall
      t: 0,
    };
  }
  reset();

  // mode: 'rigid' enforces the distance exactly; 'rope' only stops the
  // points separating past len (free to come closer)
  function constrain(a, b, len, stiff = 1, mode = 'rigid') {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 0.0001;
    if (mode === 'rope' && d < len) return;
    if (mode === 'space' && d > len) return;
    const diff = ((d - len) / d) * 0.5 * stiff;
    a.x += dx * diff; a.y += dy * diff;
    b.x -= dx * diff; b.y -= dy * diff;
  }

  function eachPt(h, fn) { fn(h.head); fn(h.hip); fn(h.foot); }

  function step(inputs) {
    // inputs: [{a,e},{a,e}] — a: -1 leg back / +1 leg toward opponent,
    //                          e: -1 flex knee / +1 extend knee
    const s = state;
    s.t++;

    if (s.winner >= 0) {
      if (--s.freeze <= 0) {
        const sc = s.scores.slice();
        reset(sc);
      }
      // fall continues animating below, minus input
      inputs = [{ a: 0, e: 0 }, { a: 0, e: 0 }];
    }

    for (const h of s.hoppers) {
      const inp = inputs[h.side];
      h.ang = Math.max(-ANG_MAX, Math.min(ANG_MAX, h.ang + (inp.a || 0) * ANG_SPEED));
      h.len = Math.max(LEG_MIN, Math.min(LEG_MAX, h.len + (inp.e || 0) * LEG_SPEED));

      // verlet integrate
      eachPt(h, (p) => {
        let vx = (p.x - p.px) * 0.97;
        let vy = (p.y - p.py) * 0.97;
        // hard speed cap: constraint servos can otherwise pump energy
        const v = Math.hypot(vx, vy);
        if (v > 12) { vx *= 12 / v; vy *= 12 / v; }
        p.px = p.x; p.py = p.y;
        p.x += vx; p.y += vy + GRAV;
      });

      // heads are buoyant: a gentle righting force so balance is
      // recoverable but losable (the whole game lives in this number)
      h.head.y -= 0.32; // enough to stand tall, not enough to hover when tangled
      // mild righting toward head-over-hips: standing is recoverable,
      // but a committed shove still topples
      h.head.x += (h.hip.x - h.head.x) * 0.025;
      // and the hips seek the support point — balance is the pair's
      // combined stance, so each body leans back over its own foot
      h.hip.x += (h.foot.x - h.hip.x) * 0.006;
    }

    for (let i = 0; i < ITER; i++) {
      const [a, b] = s.hoppers;

      for (const h of s.hoppers) {
        constrain(h.head, h.hip, SPINE);
        // angular servo at the hip, two-sided like a real joint: the
        // correction pushes foot and hip in opposite directions, so a
        // planted foot (anchored by ground friction) drives the body
        const tx = h.hip.x + h.dir * Math.sin(h.ang) * h.len;
        const ty = h.hip.y + Math.cos(h.ang) * h.len;
        const ex = (tx - h.foot.x) * 0.06, ey = (ty - h.foot.y) * 0.06;
        h.foot.x += ex; h.foot.y += ey;
        h.hip.x -= ex; h.hip.y -= ey;
        // knee: rigid rod at the current extension
        constrain(h.hip, h.foot, h.len, 1);
      }

      // the inflexible grip: each head roped to the opponent's hip
      // (the X-shaped bond from the original). Ropes can't stretch, so
      // the wrestlers can never separate, but they can press in closer
      constrain(a.head, b.hip, s.gripLen, 1, 'rope');
      constrain(b.head, a.hip, s.gripLen, 1, 'rope');
      constrain(a.hip, b.hip, s.hipLen + 30, 0.9, 'rope');
      // and the bodies can't pass through each other
      constrain(a.head, b.head, 2 * HEAD_R, 1, 'space');
      constrain(a.hip, b.hip, s.hipLen, 0.5, 'space');

      // a knee can't lift the foot above the hip — kills the degenerate
      // "leg pointing skyward" tangles
      for (const h of s.hoppers) {
        if (h.foot.y < h.hip.y - 8) h.foot.y = h.hip.y - 8;
        // hip joint limit: torso-thigh angle can't close past ~110°,
        // so a hopper can never fold head-between-legs. Enforced as a
        // minimum head-foot chord (law of cosines at the hip).
        const minHF = Math.sqrt(SPINE * SPINE + h.len * h.len + FOLD_K * h.len);
        constrain(h.head, h.foot, minHF, 0.8, 'space');
      }

      // floor & walls
      for (const h of s.hoppers) {
        eachPt(h, (p) => {
          if (p.y > FLOOR) p.y = FLOOR;
          if (p === h.foot) {
            if (p.y >= FLOOR - 2) {
              if (h.plantX === null) h.plantX = p.x;
              // Feet use static friction: once planted, the contact point
              // stays put and the body has to rotate/fall around it.
              p.x += (h.plantX - p.x) * 0.92;
              p.px = p.x;
            } else {
              h.plantX = null;
            }
          } else if (p.y >= FLOOR - 2) {
            // Non-foot floor contact still bleeds sideways energy.
            p.x += (p.px - p.x) * 0.6;
          }
          // walls, with friction so contact bleeds energy instead of storing it
          if (p.x < 20) { p.x = 20; p.y += (p.py - p.y) * 0.5; }
          if (p.x > W - 20) { p.x = W - 20; p.y += (p.py - p.y) * 0.5; }
          // ceiling, just in case
          if (p.y < 10) p.y = 10;
        });
      }
    }

    // lose when your head hits the mat or the wall
    if (s.winner < 0) {
      for (const h of s.hoppers) {
        const hd = h.head;
        if (hd.y > FLOOR - HEAD_R || hd.x < 20 + HEAD_R || hd.x > W - 20 - HEAD_R) {
          s.winner = 1 - h.side;
          s.scores[s.winner]++;
          s.freeze = 90;
        }
      }
    }
  }

  // ---- network (de)serialization -----------------------------------------

  function serialize() {
    const flat = [];
    for (const h of state.hoppers)
      eachPt(h, (p) => flat.push(p.x, p.y, p.px, p.py));
    return { f: flat.map((v) => Math.round(v * 10) / 10),
             s: state.scores, w: state.winner };
  }

  function deserialize(d) {
    let i = 0;
    for (const h of state.hoppers)
      eachPt(h, (p) => { p.x = d.f[i++]; p.y = d.f[i++]; p.px = d.f[i++]; p.py = d.f[i++]; });
    state.scores = d.s;
    state.winner = d.w;
  }

  // ---- ink rendering -------------------------------------------------------

  // a hand-drawn line: two passes with deterministic-per-frame jitter
  let jseed = 0;
  function jitter() {
    jseed = (jseed * 9301 + 49297) % 233280;
    return (jseed / 233280 - 0.5);
  }

  function inkLine(x1, y1, x2, y2, width, color, wobble = 1.4) {
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      ctx.moveTo(x1 + jitter() * wobble, y1 + jitter() * wobble);
      const mx = (x1 + x2) / 2 + jitter() * wobble * 2;
      const my = (y1 + y2) / 2 + jitter() * wobble * 2;
      ctx.quadraticCurveTo(mx, my, x2 + jitter() * wobble, y2 + jitter() * wobble);
      ctx.strokeStyle = color;
      ctx.globalAlpha = pass === 0 ? 0.75 : 0.35;
      ctx.lineWidth = width * (pass === 0 ? 1 : 0.6);
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function inkCircle(x, y, r, color, width = 2.5) {
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      ctx.arc(x + jitter(), y + jitter(), r + jitter(), 0.1, Math.PI * 2.05);
      ctx.strokeStyle = color;
      ctx.globalAlpha = pass === 0 ? 0.75 : 0.3;
      ctx.lineWidth = width * (pass === 0 ? 1 : 0.6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawHopper(h) {
    const c = COLORS[h.side];
    // the one leg, drawn thigh + shin with the knee bowing out as it flexes
    const mx = (h.hip.x + h.foot.x) / 2, my = (h.hip.y + h.foot.y) / 2;
    const dx = h.foot.x - h.hip.x, dy = h.foot.y - h.hip.y;
    const d = Math.hypot(dx, dy) || 1;
    const bend = Math.sqrt(Math.max(0, 1 - (d / 135) ** 2)) * 46;
    const kx = mx + (dy / d) * bend * h.dir + h.dir * 4; // knee bows toward the opponent
    const ky = my - (dx / d) * bend * h.dir;
    inkLine(h.hip.x, h.hip.y, kx, ky, 3.8, INK);
    inkLine(kx, ky, h.foot.x, h.foot.y, 3.2, INK);
    // spine
    inkLine(h.hip.x, h.hip.y, h.head.x, h.head.y - HEAD_R * 0.4, 4.5, INK);
    // belt (mawashi) in player color
    const bx = h.hip.x, by = h.hip.y;
    inkLine(bx - 14, by, bx + 14, by, 6, c, 0.8);
    // head + topknot
    inkCircle(h.head.x, h.head.y, HEAD_R, INK);
    inkLine(h.head.x, h.head.y - HEAD_R, h.head.x + h.dir * 4, h.head.y - HEAD_R - 7, 3, INK, 0.6);
    // foot ripple
    if (h.foot.y >= FLOOR - 1) {
      ctx.globalAlpha = 0.25;
      inkCircle(h.foot.x, FLOOR + 6, 9, c, 1.2);
      ctx.globalAlpha = 1;
    }
  }

  function draw(roleLabel) {
    jseed = (state.t / 4 | 0) * 7 + 13; // jitter changes ~15fps, like a wobbly pencil test
    ctx.fillStyle = '#f1ede4';
    ctx.fillRect(0, 0, view.w, view.h);

    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);

    // dohyo: ground ellipse + ring
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.ellipse(W / 2, FLOOR + 18, W / 2 - 40, 26, 0, 0, Math.PI * 2);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(W / 2, FLOOR + 18, W / 2 - 52, 21, 0, 0, Math.PI * 2);
    ctx.lineWidth = 0.8; ctx.stroke();
    ctx.globalAlpha = 1;

    // center line
    ctx.setLineDash([4, 8]);
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.moveTo(W / 2, 60); ctx.lineTo(W / 2, FLOOR + 10);
    ctx.lineWidth = 1; ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // the grip: arms from each head down to the opponent's hips
    const [a, b] = state.hoppers;
    ctx.globalAlpha = 0.45;
    inkLine(a.head.x, a.head.y + 8, b.hip.x, b.hip.y, 2.5, COLORS[0], 1.8);
    inkLine(b.head.x, b.head.y + 8, a.hip.x, a.hip.y, 2.5, COLORS[1], 1.8);
    ctx.globalAlpha = 1;

    drawHopper(a);
    drawHopper(b);

    // title + score
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.font = '15px Georgia';
    ctx.globalAlpha = 0.55;
    ctx.fillText('押 し 相 撲', W / 2, 38);
    ctx.globalAlpha = 1;
    ctx.font = '26px Georgia';
    ctx.fillStyle = COLORS[0];
    ctx.fillText(state.scores[0], W / 2 - 60, 42);
    ctx.fillStyle = COLORS[1];
    ctx.fillText(state.scores[1], W / 2 + 60, 42);

    if (state.winner >= 0) {
      ctx.fillStyle = COLORS[state.winner];
      ctx.font = 'italic 22px Georgia';
      ctx.fillText(state.winner === 0 ? 'vermilion takes the bout' : 'indigo takes the bout', W / 2, 90);
    }
    if (roleLabel) {
      ctx.fillStyle = INK; ctx.globalAlpha = 0.4;
      ctx.font = 'italic 13px Georgia';
      ctx.fillText(roleLabel, W / 2, H - 14);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  return { step, draw, reset, resize, serialize, deserialize,
           get state() { return state; } };
})();
