// Ghost's own feet (Revision 5, "Ghost wanders, you tap"). Ghost walks the hand-made waypoint graphs
// (assets/paths/<area>.json, format in assets/ASSETS.md "Paths") by feeding the same physics body the stick and the
// hop button used to: each frame a world-space stick toward the next node, a hop press for `hop`, a press and an air
// press for `hop2`, a held hop for `float`, nothing but walking for `walk` and `stair`. tests/paths.mjs proved every
// edge with exactly this steering law, so the executor here is a port of its loop.
// On top sits a small cat brain: there is always a next idea (an untouched thing nearby, a warm spot after a busy
// stretch, a perch not sat on, the way out once a room is "done enough"), and between ideas Ghost pauses, looks
// round, sits, loafs. Taps (from home.js) override the idea: go and poke that thing (N taps = N pokes), drift to that
// spot, or sit and purr. Nothing here touches the world directly: home.js passes hooks.
import * as THREE from 'three';
import { TUNING as T } from './tuning.js';

export const PATH_AREAS = ['apartment', 'fire_escape', 'rooftop', 'front', 'street', 'corner_shop', 'alley', 'park'];
// fetched as early as possible (home.js starts this before the world is built); a missing area is simply skipped
export const loadPaths = () => Promise.all(PATH_AREAS.map((a) => fetch(`assets/paths/${a}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));

const MOVE_COST = { walk: 0, stair: 0.3, hop: 0.7, hop2: 1.3, float: 0.9, exit: 0.01 };
const AIRBORNE = new Set(['hop', 'hop2', 'float']);
const TOL_XZ = 0.35, TOL_Y = 0.3; // "there", as tests/paths.mjs measures it
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// the touch stick's response (dead zone, curve): the edges were proved through it, so the wanderer keeps it
const curve = (m) => (m <= T.stickDeadZone ? 0 : Math.pow((m - T.stickDeadZone) / (1 - T.stickDeadZone), T.stickCurve));
const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

// ------------------------------------------------------------------ the graph
export function buildGraph(list, roomAt) {
  const nodes = new Map(), adj = new Map();
  for (const g of list) {
    if (!g) continue;
    for (const n of g.nodes) {
      const p = new THREE.Vector3(...n.pos);
      nodes.set(n.id, { ...n, area: g.area, p, room: roomAt(p.clone().setY(p.y + 0.05)) || g.area });
      adj.set(n.id, []);
    }
  }
  const add = (a, b, move, e) => {
    if (!nodes.has(a) || !nodes.has(b)) return;
    const A = nodes.get(a).p, B = nodes.get(b).p;
    adj.get(a).push({ a, b, move, hold: e.hold || 0, press: e.press ?? (move === 'float' ? -1 : 0), time: e.time || 0, key: `${a}>${b}`,
      cost: Math.hypot(B.x - A.x, B.z - A.z) + Math.abs(B.y - A.y) * 0.5 + MOVE_COST[move] });
  };
  for (const g of list) {
    if (!g) continue;
    for (const e of g.edges) { if (e.needs) continue; add(e.a, e.b, e.move, e); if (!e.oneway) add(e.b, e.a, e.back || e.move, e); } // (an edge that `needs` a game change is not walked)
    for (const x of g.exits || []) add(x.node, x.to.split(':')[1], 'exit', {}); // the two door nodes are one spot
  }
  // cheapest routes from one node to every other (a few hundred nodes: a plain O(n^2) Dijkstra is plenty)
  const routes = (from, bad = new Set()) => {
    const dist = new Map([[from, 0]]), via = new Map(), done = new Set();
    for (;;) {
      let u = null, du = Infinity;
      for (const [k, v] of dist) if (!done.has(k) && v < du) { du = v; u = k; }
      if (u === null) break;
      done.add(u);
      for (const e of adj.get(u) || []) {
        if (bad.has(e.key)) continue;
        const nd = du + e.cost;
        if (nd < (dist.get(e.b) ?? Infinity)) { dist.set(e.b, nd); via.set(e.b, e); }
      }
    }
    const path = (to) => { if (!dist.has(to)) return null; const out = []; for (let n = to; n !== from; n = via.get(n).a) out.unshift(via.get(n)); return out; };
    return { dist, path };
  };
  return { nodes, adj, routes };
}

// ------------------------------------------------------------------ the wanderer
// hooks (all from home.js):
//   body, returning(), night(), found(entry), late(), roomOf(p)
//   targets: [{ id, pos: Vector3 (bottom centre), top, room, act, moving, kind: 'thing'|'spot' }]
//   sitRule(id) -> { sit, late, entry, unless } | null      (the sit secrets and the custom sit spots)
//   poke(id)    -> a direct poke of a thing (the bat after the first touch)
//   purr()      -> Ghost was tapped: hearts, purr
//   sleep()     -> Ghost reached the bed for a tap on the bed: ask about sleeping
//   ring()      -> { active, t, pos } of the chimney's smoke ring
//   bedNode     -> the node that means "the bed" (skipped by the wandering until bedtime)
export function createStroll(graphs, hooks) {
  const G = buildGraph(graphs, hooks.roomOf);
  const { nodes } = G, body = hooks.body;
  const out = { move: new THREE.Vector3(), jumpHeld: false, jumpPressed: false, mag: 0 };
  const targets = new Map(hooks.targets.map((t) => [t.id, { ...t, nodes: [] }]));
  for (const n of nodes.values()) for (const id of [n.thing, ...(n.also || [])].filter(Boolean)) {
    if (!targets.has(id)) { // a secret's spot with no thing of its own (the warm sill, the little table, the top crate...)
      targets.set(id, { id, pos: n.p.clone(), top: n.p.y + 0.3, room: n.room, act: 'sit', kind: 'spot', nodes: [] });
    }
    targets.get(id).nodes.push(n.id);
  }
  const unbound = [...targets.values()].filter((t) => !t.nodes.length && !t.moving).map((t) => t.id);
  if (unbound.length) console.warn('[stroll] things with no node in assets/paths:', unbound.join(', '));

  const st = {
    now: 0, node: null, mode: 'pause', goal: null, path: [], edge: null, pause: null, act: null,
    bad: new Set(), fails: new Map(), sat: new Set(), rooms: new Set(), busy: 0, pace: T.strollPace,
    gaze: null, gazeT: 0, recover: 0, stuck: { t: 0, p: new THREE.Vector3() }, lastIdea: null, moveT: 0, faceCam: 0,
    log: [], pauseN: 0, pendingId: null, pendingExtra: 0, edges: 0, edgeFails: 0, ideas: 0, pokes: 0,
  };
  const note = (s) => { st.log.push(`${st.now.toFixed(1)} ${s}`); if (st.log.length > 80) st.log.shift(); };

  // ---------------------------------------------------------------- where Ghost is on the graph
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  function nearestNode(p, { maxDy = 0.45, skip = null } = {}) {
    let best = null, bd = Infinity;
    for (const n of nodes.values()) {
      if (skip && skip.has(n.id)) continue;
      const dy = Math.abs(n.p.y - p.y); if (dy > maxDy) continue;
      const d = flat(n.p, p) + dy * 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best ? { node: best, d: bd } : null;
  }
  const taps = (id) => hooks.night().taps[id] || 0;
  const touched = (id) => !!hooks.night().poked[id] || st.sat.has(id);

  // ---------------------------------------------------------------- going somewhere
  function planTo(nodeId) {
    if (!st.node) return null;
    if (nodeId === st.node) return [];
    return G.routes(st.node, st.bad).path(nodeId);
  }
  function bestNodeFor(target, routes) {
    let best = null, bc = Infinity;
    for (const id of target.nodes) { const c = routes.dist.get(id); if (c !== undefined && c < bc) { bc = c; best = id; } }
    return best ? { id: best, cost: bc } : null;
  }
  // a goal: { kind: 'thing'|'node'|'point'|'ring'|'sleep', node, target?, point?, pokes, source: 'self'|'tap' }
  // a thing that is walked across rather than touched (the MIDI keyboard): to the nearer end, then over to the other
  function walkGoal(t, R, source) {
    const ends = hooks.walkFor?.(t.id); if (!ends) return null;
    const [a, b] = ends, ca = R.dist.get(a) ?? Infinity, cb = R.dist.get(b) ?? Infinity;
    if (!Number.isFinite(Math.min(ca, cb))) return null;
    return { kind: 'walkover', node: ca <= cb ? a : b, end: ca <= cb ? b : a, target: t, source, pokes: 1 };
  }
  function setGoal(goal) {
    const path = planTo(goal.node);
    if (!path) { note(`no way to ${goal.node}`); return false; }
    st.goal = goal; st.path = path; st.act = null; st.pause = null; st.mode = 'travel'; st.moveT = st.now;
    st.pace = goal.source === 'tap' ? T.strollTapPace : T.strollPace;
    if (goal.target) goal.taps0 = taps(goal.target.id);
    st.ideas++;
    note(`goal ${goal.kind} ${goal.target?.id || ''} at ${goal.node} (${goal.source}, ${path.length} edges)`);
    return true;
  }

  // ---------------------------------------------------------------- one edge, the way tests/paths.mjs walks it
  function beginEdge(e, { final = false, through = false } = {}) {
    const A = e.A || nodes.get(e.a)?.p || body.pos.clone(), B = e.B || nodes.get(e.b).p;
    const walking = e.move === 'walk' || e.move === 'stair';
    const pace = walking ? st.pace : 1;
    const hd = flat(A, B), dy = B.y - A.y, speed = Math.max(0.9, T.runSpeed * pace * 0.75);
    st.edge = {
      e, A, B, move: e.move, final, through, pace,
      phase: AIRBORNE.has(e.move) ? 'prep' : 'go', t0: st.now, tGo: AIRBORNE.has(e.move) ? null : st.now,
      pressed: walking || e.press < 0, second: e.move !== 'hop2', airborne: false, wasAir: false, landedAt: null, floatT: 0, holdUntil: -1,
      limit: e.time || 1.6 + hd / speed + Math.abs(dy) * (dy < 0 ? 1.1 : 0.6) + (e.move === 'float' ? 1.5 : 0) + (walking ? 0.8 : 0),
    };
  }
  function steer(B, { pace = 1, slow = true } = {}) {
    const p = body.pos, dx = B.x - p.x, dz = B.z - p.z, d = Math.hypot(dx, dz);
    if (d < 0.08) { out.move.set(0, 0, 0); return d; }
    const k = slow ? clamp(d / 0.5, 0.5, 1) : 1;
    const ease = clamp(0.35 + (st.now - st.moveT) / 0.45, 0, 1); // ease in from a standstill
    const m = curve(k) * pace * ease;
    out.move.set((dx / d) * m, 0, (dz / d) * m);
    return d;
  }
  // returns 'go' | 'ok' | 'fail'
  function runEdge(dt) {
    const ed = st.edge, S = body.S, v = body.vel;
    if (ed.phase === 'prep') {
      // a hop starts from the node, standing: a short crouch while Ghost sizes it up
      const d = steer(ed.A, { pace: 0.6 });
      const still = Math.hypot(v.x, v.z) < 0.3 && S.grounded;
      const still2 = Math.hypot(v.x, v.z) < 0.15 && S.grounded;
      if ((d < 0.1 && still2 && st.now - ed.t0 > T.strollCrouch) || (d < 0.16 && still && st.now - ed.t0 > 1.2) || st.now - ed.t0 > 2.5) {
        ed.phase = 'go'; ed.tGo = st.now; st.moveT = st.now - 1; hooks.crouch?.();
      }
      return 'go';
    }
    const el = st.now - ed.tGo;
    const d = steer(ed.B, { pace: ed.pace, slow: !ed.through });
    if (!ed.pressed && el >= ed.e.press) { ed.pressed = true; out.jumpPressed = true; ed.holdUntil = st.now + 0.14; }
    if (!ed.second && ed.pressed && !S.grounded && v.y < 0.6 && st.now >= ed.holdUntil) { ed.second = true; out.jumpPressed = true; ed.holdUntil = st.now + 0.14; }
    if (st.now < ed.holdUntil) out.jumpHeld = true;
    if (ed.move === 'float') {
      const falling = !S.grounded && v.y < 0;
      if (falling && (!ed.e.hold || ed.floatT < ed.e.hold)) { out.jumpHeld = true; ed.floatT += dt; }
    }
    if (!S.grounded) ed.airborne = true;
    if (S.grounded && ed.wasAir) ed.landedAt = el;
    ed.wasAir = !S.grounded;
    const dy = Math.abs(body.pos.y - ed.B.y);
    const arrive = ed.through ? 0.3 : 0.1;
    if (d < arrive && S.grounded && dy < TOL_Y) return 'ok';
    // a hop that landed on the wrong level and stopped: no point waiting
    if (ed.pressed && ed.airborne && S.grounded && ed.landedAt !== null && el - ed.landedAt > 0.9 && Math.hypot(v.x, v.z) < 0.05 && d > TOL_XZ) return 'fail';
    if (el > ed.limit) return d <= TOL_XZ && dy <= TOL_Y && S.grounded ? 'ok' : 'fail';
    return 'go';
  }

  // ---------------------------------------------------------------- the cat brain: what next
  const doneCount = (room) => [...targets.values()].filter((t) => t.room === room && t.kind === 'thing' && touched(t.id)).length;
  const openCount = (room) => [...targets.values()].filter((t) => t.room === room && t.nodes.length && !t.moving && !touched(t.id)).length;
  const roomDone = (room) => doneCount(room) >= (T.strollDone[room] ?? 3) || openCount(room) === 0;
  function sitOpen(id) {
    const r = hooks.sitRule(id);
    return r && !hooks.found(r.entry) && (!r.late || hooks.late()) && !(r.unless && taps(r.unless)) ? r : null;
  }
  function chooseIdea() {
    if (!st.node) return null;
    const R = G.routes(st.node, st.bad), here = nodes.get(st.node), roomNow = here.room, doneHere = roomDone(roomNow);
    const sleepy = hooks.sleepy?.();
    const cands = [];
    const roomW = (room) => (room === roomNow ? (doneHere ? 0.08 : 1) : doneHere ? (st.rooms.has(room) ? 0.35 : 1.6) * (openCount(room) ? 1 : 0.25) : 0.05);
    for (const t of targets.values()) {
      if (!t.nodes.length || t.moving) continue;
      const b = bestNodeFor(t, R); if (!b) continue;
      if (b.id === hooks.bedNode && !sleepy) continue;
      if (st.lastIdea === t.id) continue;
      if (hooks.avoid?.(t.id)) continue; // touching it would spoil a secret still open tonight (the tabby and the nook)
      let w = touched(t.id) ? 0.06 : 1;
      if (sitOpen(t.id)) w *= 1.5; // a spot that feels right to sit in
      w *= roomW(t.room || nodes.get(b.id).room) / (1 + b.cost / 5);
      cands.push({ w, kind: t.kind === 'spot' ? 'node' : 'thing', target: t, node: b.id });
    }
    for (const n of nodes.values()) {
      if (n.thing || (n.kind !== 'warm' && n.kind !== 'perch')) continue;
      if (n.id === hooks.bedNode && !sleepy) continue;
      const c = R.dist.get(n.id); if (c === undefined || n.id === st.node) continue;
      let w = 0;
      if (n.kind === 'warm' && st.busy >= T.strollBusy) w = 2.2;
      else if (!st.sat.has(n.id)) w = n.kind === 'warm' ? 0.35 : 0.25;
      w *= (n.room === roomNow ? 1 : 0.15) / (1 + c / 4);
      if (w > 0) cands.push({ w, kind: 'node', node: n.id });
    }
    if (sleepy && hooks.bedNode && R.dist.has(hooks.bedNode)) cands.push({ w: 0.6 / (1 + R.dist.get(hooks.bedNode) / 12), kind: 'node', node: hooks.bedNode });
    // a tap on the ground pointed somewhere: for a while, Ghost's own ideas lean that way (a player who taps toward the
    // kitchen gets a cat who goes and pokes kitchen things, not one who wanders straight back)
    if (st.hint && st.now < st.hint.until) for (const c of cands) { const p = nodes.get(c.node).p; c.w *= 0.12 + 4 / (1 + (flat(p, st.hint.p) + Math.abs(p.y - st.hint.p.y)) / 2); }
    for (const c of cands) c.w *= 0.55 + Math.random() * 0.9; // no two nights the same
    cands.sort((a, b) => b.w - a.w);
    const top = cands.slice(0, 6), sum = top.reduce((s, c) => s + c.w, 0);
    if (sum > 0) { let r = Math.random() * sum; for (const c of top) { r -= c.w; if (r <= 0) return c; } return top[0]; }
    // never aimless: somewhere a few steps away
    const near = [...R.dist.entries()].filter(([id, c]) => c > 1.5 && c < 8 && id !== hooks.bedNode);
    return near.length ? { kind: 'node', node: pick(near)[0] } : null;
  }
  function startIdea(idea) {
    if (!idea) return false;
    if (idea.target && hooks.walkFor?.(idea.target.id)) { const w = walkGoal(idea.target, G.routes(st.node, st.bad), 'self'); if (w && setGoal(w)) { st.lastIdea = idea.target.id; return true; } }
    const ok = setGoal({ kind: idea.kind, node: idea.node, target: idea.target || null, pokes: idea.target && idea.target.act === 'bat' && Math.random() < T.strollBatAgain ? 2 + Math.floor(Math.random() * 2) : 1, source: 'self' });
    if (ok && idea.target) st.lastIdea = idea.target.id;
    return ok;
  }

  // ---------------------------------------------------------------- pausing: look round, sit, loaf
  function pauseHere(seconds, why = 'look') {
    st.mode = 'pause'; st.goal = null; st.path = []; st.edge = null; st.act = null; st.pauseN++;
    st.pause = { until: st.now + seconds, why, next: null, nextAt: st.now + Math.max(0.3, seconds - T.strollDecide) };
    st.gazeT = st.now + rand(0.8, 1.6);
    note(`pause ${seconds.toFixed(1)} s (${why})`);
  }
  function pauseFor(node, id) {
    const n = nodes.get(node);
    let s = n?.kind === 'warm' ? rand(...T.strollWarm) : n?.kind === 'perch' ? rand(...T.strollPerch) : rand(...T.strollLook);
    const r = id && sitOpen(id) || (n?.thing && sitOpen(n.thing));
    if (r) s = Math.max(s, r.sit + T.strollSitMargin + (r.hiss ? T.hissSoon + 1.2 : 0));
    if (n?.kind === 'warm') { st.busy = 0; }
    if (n) st.sat.add(node);
    if (n?.thing && targets.get(n.thing)?.kind === 'spot') st.sat.add(n.thing);
    pauseHere(s, n?.kind || 'look');
    if (n?.look) st.pause.look = new THREE.Vector3(...n.look); // the node says what to look at on arrival
  }

  // ---------------------------------------------------------------- arriving: poke, hop, sit
  function arrive() {
    const g = st.goal;
    st.path = []; st.edge = null;
    if (!g) return pauseHere(rand(...T.strollLook));
    // not quite on the node (a walk cut short, a tap on the spot Ghost was leaving): the last steps first
    const gn = g.node && nodes.get(g.node);
    if (gn && !g.onNode && g.kind !== 'point' && g.kind !== 'ring' && g.kind !== 'chase' && body.S.grounded && (flat(body.pos, gn.p) > 0.25 || Math.abs(body.pos.y - gn.p.y) > TOL_Y)) {
      g.onNode = true; beginEdge({ move: 'walk', A: body.pos.clone(), B: gn.p, press: 0, time: 3 }, { final: true }); st.edge.offGraph = true; st.edge.thenArrive = true; st.mode = 'travel'; return;
    }
    if (g.kind === 'point' && g.point && !g.walked) { g.walked = true; beginEdge({ move: 'walk', A: body.pos.clone(), B: g.point, press: 0 }, { final: true }); st.edge.offGraph = true; return; }
    if (g.kind === 'ring') { st.mode = 'act'; st.act = { kind: 'ring', tries: 0, t: st.now }; return; }
    if (g.kind === 'sleep') { hooks.sleep(); return pauseFor(g.node, null); }
    if (g.kind === 'walkover' && !g.walked) {
      g.walked = true; beginEdge({ move: 'walk', A: body.pos.clone(), B: nodes.get(g.end).p, press: 0, time: 5 }, { final: true });
      st.edge.offGraph = true; st.edge.pace = T.strollWalkOver; st.edge.walkEnd = g.end; return;
    }
    if (g.kind === 'walkover') return pauseFor(g.node, g.target.id);
    if (g.kind === 'chase') { st.mode = 'act'; st.act = { kind: 'chase', tries: 0, walks: 0, t: st.now }; return; }
    if (g.kind === 'thing' && g.target && g.target.kind === 'thing') { st.mode = 'act'; st.act = { kind: 'poke', t: st.now, last: st.now - 0.4, tries: 0 }; return; }
    if (g.kind === 'point') return restAtTap();
    pauseFor(g.node, g.target?.id);
  }
  // resting where a ground tap sent Ghost; at a sit secret's spot that rest is the sit (left alone there, Ghost sits)
  function restAtTap() {
    let s = rand(...T.strollTapRest);
    const nn = nearestNode(body.pos, { maxDy: 0.3 });
    if (nn && nn.d < 0.45) {
      for (const id of [nn.node.thing, ...(nn.node.also || [])].filter(Boolean)) { const r = sitOpen(id); if (r) s = Math.max(s, r.sit + T.strollSitMargin + (r.hiss ? T.hissSoon + 1.2 : 0)); }
      st.sat.add(nn.node.id);
    }
    pauseHere(s, 'tapped spot');
  }
  function hopOnSpot(at) { beginEdge({ move: 'hop', A: body.pos.clone(), B: at.clone(), press: 0, time: 1.6 }, { final: true }); st.edge.offGraph = true; st.edge.phase = 'go'; st.edge.tGo = st.now; }
  function runAct() {
    const a = st.act, g = st.goal;
    if (a.kind === 'poke') {
      const t = g.target, n = nodes.get(g.node), need = g.pokes || 1, done = taps(t.id) - (g.taps0 || 0);
      if (done >= need || a.tries > need * 2 + 1) { st.pokes += done; st.busy++; return pauseFor(g.node, t.id); }
      // the first touch usually happened walking in; the rest are bats (or hops, for things up high and the fireflies)
      if (st.now - a.last < (n?.poke === 'hop' || t.act === 'chase' ? 1.0 : T.strollBatEvery)) return;
      if (st.now - a.t < 0.35) return; // let the arrival's own touch land first
      a.last = st.now; a.tries++;
      if ((n?.poke === 'hop' || t.act === 'chase') && a.tries <= need * 2) { a.hopTaps = taps(t.id); hopOnSpot(n.p); return; }
      hooks.poke(t.id);
      return;
    }
    if (a.kind === 'resume') { // back to the pause the hop interrupted
      const k = a.keep; st.mode = 'pause'; st.pause = k.pause || { until: st.now + 1, why: 'look', next: null, nextAt: st.now + 0.5 }; st.pause.until = Math.max(st.pause.until, st.now + 0.8); st.act = null; return;
    }
    if (a.kind === 'chase') { // the moth, the leaf: under it, a hop, again
      const t = g.target, done = taps(t.id) - (g.taps0 || 0);
      if (done >= (g.pokes || 1) || a.tries >= 4 || !t.live()) { st.busy++; return pauseHere(rand(...T.strollLook), 'chased'); }
      const p = t.live(), under = new THREE.Vector3(p.x, body.pos.y, p.z);
      if (flat(under, body.pos) > 0.2 && a.walks < 3) { a.walks++; beginEdge({ move: 'walk', A: body.pos.clone(), B: under, press: 0, time: 2.5 }, { final: true }); st.edge.offGraph = true; st.edge.pace = 0.8; return; }
      a.tries++; a.walks = 0; hopOnSpot(under); return;
    }
    if (a.kind === 'ring') {
      const r = hooks.ring();
      if (!r.active || hooks.found('smoke-ring') || a.tries >= 4) return pauseFor(g.node, null);
      if (r.t < 2.2) return; // still drifting out
      const under = new THREE.Vector3(r.pos.x, body.pos.y, r.pos.z);
      if (flat(under, body.pos) > 0.12) { beginEdge({ move: 'walk', A: body.pos.clone(), B: under, press: 0, time: 3 }, { final: true }); st.edge.offGraph = true; st.edge.pace = 0.7; return; }
      a.tries++; hopOnSpot(under);
    }
  }

  // ---------------------------------------------------------------- lost: back onto the graph
  function recover(why) {
    st.recover++;
    const skip = st.recover > 2 && st.lastRecover ? new Set([st.lastRecover]) : null;
    const nn = nearestNode(body.pos, { maxDy: st.recover > 4 ? 2.5 : 0.45, skip }) || nearestNode(body.pos, { maxDy: 9 });
    note(`recover (${why}) -> ${nn?.node.id} ${nn ? nn.d.toFixed(2) : ''}`);
    if (!nn) return pauseHere(1.0, 'lost');
    st.lastRecover = nn.node.id;
    const goal = st.goal;
    st.node = null; st.path = []; st.act = null; st.mode = 'travel';
    if (nn.d < 0.25) { st.node = nn.node.id; st.recover = 0; return goal ? resumeGoal(goal) : pauseHere(rand(...T.strollLook)); }
    // walking back first; hopping if that keeps failing or the node is up a step; a double hop if Ghost is boxed in
    const hop = st.recover > 3 || nn.node.p.y - body.pos.y > 0.25, boxed = st.recover > 5;
    beginEdge({ move: boxed ? 'hop2' : hop ? 'hop' : 'walk', A: body.pos.clone(), B: nn.node.p, b: nn.node.id, press: 0 }, { final: true });
    if (boxed || hop) { st.edge.phase = 'go'; st.edge.tGo = st.now; }
    st.edge.recoverTo = nn.node.id; st.edge.offGraph = true; st.goal = goal;
  }
  function resumeGoal(goal) {
    if (!goal || !setGoal({ ...goal, taps0: goal.taps0 })) { st.goal = null; return pauseHere(rand(0.4, 1.0), 'rethink'); }
    if (goal.taps0 !== undefined) st.goal.taps0 = goal.taps0;
  }

  // ---------------------------------------------------------------- the frame
  function poll(dt, blocked) {
    out.move.set(0, 0, 0); out.jumpHeld = false; out.jumpPressed = false;
    if (blocked) return out;
    if (hooks.returning()) { if (st.edge && !st.edge.failed) { st.edge.failed = true; } st.mode = 'returning'; return out; }
    st.now += dt;
    if (st.mode === 'returning') { st.edge = null; recover('floated back'); }
    if (!st.node && !st.edge) { const nn = nearestNode(body.pos, { maxDy: 0.6 }); if (nn && nn.d < 0.6) st.node = nn.node.id; else recover('start'); }

    // the stuck watchdog: travelling (not sitting) and not getting anywhere for a while
    if (st.mode === 'travel' || st.mode === 'act') {
      if (body.pos.distanceTo(st.stuck.p) > 0.25) { st.stuck.p.copy(body.pos); st.stuck.t = st.now; }
      else if (st.now - st.stuck.t > T.strollStuck) { st.stuck.t = st.now; st.edge = null; note('stuck'); recover('stuck'); }
    } else { st.stuck.p.copy(body.pos); st.stuck.t = st.now; }

    if (st.edge) {
      const r = runEdge(dt), ed = st.edge;
      if (r === 'go') return finish();
      st.edge = null; st.moveT = r === 'ok' && ed.through ? st.moveT : st.now;
      if (ed.offGraph) {
        if (ed.recoverTo) { if (r === 'ok') { st.node = ed.recoverTo; st.recover = 0; resumeGoal(st.goal); } else recover('approach failed'); return finish(); }
        if (ed.toStart) { if (r !== 'ok') { st.path = []; recover('back to the node'); } return finish(); }
        if (ed.thenArrive) { if (r === 'ok') arrive(); else recover('last steps'); return finish(); }
        if (ed.walkEnd) { st.node = r === 'ok' ? ed.walkEnd : st.node; if (r !== 'ok') recover('walk-over'); else pauseFor(ed.walkEnd, st.goal?.target?.id); return finish(); }
        if (st.mode === 'act') return finish(); // a hop or a step during an act: the act decides what next
        if (st.goal?.kind === 'point') { st.node = nearestNode(body.pos)?.node.id || st.node; restAtTap(); return finish(); }
        return finish();
      }
      st.edges++;
      if (r === 'ok') { st.node = ed.e.b; st.recover = 0; const room = nodes.get(st.node).room; if (!st.rooms.has(room)) { st.rooms.add(room); } }
      else {
        st.edgeFails++;
        const n = (st.fails.get(ed.e.key) || 0) + 1; st.fails.set(ed.e.key, n);
        if (n >= 2) { st.bad.add(ed.e.key); note(`edge ${ed.e.key} bad for tonight`); } else note(`edge ${ed.e.key} failed once`);
        recover(`edge ${ed.e.key}`);
        return finish();
      }
    }
    if (st.pendingTap && !st.edge && st.node && st.mode !== 'returning') { const p = st.pendingTap; st.pendingTap = null; p(); return finish(); }
    if (st.mode === 'travel' && !st.edge) {
      if (st.path.length) {
        const e = st.path.shift();
        if (e.move === 'exit') { st.node = e.b; return poll(0, false); }
        // an edge starts on its node: knocked off it (hops among the fireflies, a bump), the few steps back first
        const A = nodes.get(e.a).p;
        if (body.S.grounded && (flat(body.pos, A) > 0.4 || Math.abs(body.pos.y - A.y) > TOL_Y) && !st.edge) {
          st.path.unshift(e);
          beginEdge({ move: 'walk', A: body.pos.clone(), B: A, press: 0, time: 3 }, { final: true }); st.edge.offGraph = true; st.edge.toStart = true;
          return finish();
        }
        const next = st.path[0];
        // walk chains flow through their middle nodes, but doorways (an area's way in or out) are reached properly
        const through = (e.move === 'walk' || e.move === 'stair') && next && (next.move === 'walk' || next.move === 'stair') && nodes.get(e.b).kind !== 'door';
        beginEdge(e, { final: !st.path.length, through });
      } else arrive();
    }
    if (st.mode === 'act' && !st.edge) runAct();
    if (st.mode === 'pause') {
      const p = st.pause;
      if (st.now >= p.nextAt && !p.next) { p.next = chooseIdea() || { kind: 'none' }; }
      if (st.now >= p.until) { if (!startIdea(p.next?.kind !== 'none' ? p.next : chooseIdea())) pauseHere(rand(0.6, 1.4), 'rethink'); }
    }
    return finish();
  }
  function finish() {
    out.mag = out.move.length();
    // where Ghost looks while standing: at the next idea once decided, otherwise round about, now and then at the camera
    if (st.mode === 'pause' && st.pause) {
      const nxt = st.pause.next;
      if (nxt && nxt.kind !== 'none') st.gaze = yawTo(body.pos, nodes.get(nxt.node).p);
      else if (st.pause.look && st.now < st.pause.until - 1.5) st.gaze = yawTo(body.pos, st.pause.look);
      else if (st.now >= st.gazeT) { st.gazeT = st.now + rand(1.2, 2.8); st.gaze = Math.random() < 0.3 ? null : (st.gaze ?? 0) + rand(-1.4, 1.4); }
    } else st.gaze = null;
    if (st.faceCam > st.now) st.gaze = null;
    return out;
  }

  // ---------------------------------------------------------------- taps (home.js works out what was tapped)
  // a tap waits for the edge in progress to finish (never abandon a hop in mid-air)
  // (a walking step on the graph is cut short at once, Ghost carrying on from its nearer end; a hop, a float, the walk over
  // the keyboard and getting back onto the graph are let finish)
  const whenFree = (fn) => {
    const ed = st.edge, walkingStep = ed && !ed.offGraph && (ed.move === 'walk' || ed.move === 'stair') && body.S.grounded;
    const busyEdge = ed && !walkingStep && (!ed.offGraph || ed.recoverTo || ed.walkEnd || ed.thenArrive || AIRBORNE.has(ed.move) || !body.S.grounded);
    if (busyEdge || (!st.node && !walkingStep) || st.mode === 'returning') { st.pendingTap = fn; return; }
    if (walkingStep) { const a = nodes.get(ed.e.a).p, b = nodes.get(ed.e.b).p; st.node = body.pos.distanceTo(a) < body.pos.distanceTo(b) ? ed.e.a : ed.e.b; st.path = []; }
    st.edge = null; st.pendingTap = null; fn();
  };
  function tapThing(id) {
    const t = targets.get(id);
    if (!t) return false;
    // the same thing again: one more poke
    if (st.goal && st.goal.target?.id === id && (st.mode === 'travel' || st.mode === 'act') && !st.pendingTap) { st.goal.pokes = Math.min((st.goal.pokes || 1) + 1, 8); st.goal.source = 'tap'; return 'again'; }
    // (a tap still waiting for the step to end: more taps on the same thing add up)
    if (st.pendingTap && st.pendingId === id) { st.pendingExtra = Math.min(st.pendingExtra + 1, 7); return 'again'; }
    st.pendingId = id; st.pendingExtra = 0;
    const addExtra = () => { if (st.goal?.target?.id === id) st.goal.pokes = Math.min((st.goal.pokes || 1) + st.pendingExtra, 8); st.pendingId = null; st.pendingExtra = 0; };
    if (t.moving) {
      whenFree(() => {
        const p = t.live && t.live(); if (!p) return;
        const nn = nearestNode(p, { maxDy: 1.6 }); if (!nn) return;
        st.goal = null;
        if (nn.node.id === st.node) { st.goal = { kind: 'chase', node: st.node, target: t, pokes: 1, source: 'tap', taps0: taps(id) }; arrive(); }
        else setGoal({ kind: 'chase', node: nn.node.id, target: t, pokes: 1, source: 'tap' });
      });
      return true;
    }
    whenFree(() => {
      const R = G.routes(st.node, st.bad), b = bestNodeFor(t, R);
      if (!b) return pauseHere(1.0, 'no way');
      const w = walkGoal(t, R, 'tap');
      if (w) { if (w.node === st.node) { st.goal = w; st.mode = 'travel'; st.path = []; st.pace = T.strollTapPace; return arrive(); } return setGoal(w); }
      const kind = id === hooks.bedThing ? 'sleep' : t.kind === 'spot' ? 'node' : 'thing';
      if (b.id === st.node && kind === 'thing') { st.goal = { kind, node: b.id, target: t, pokes: 1, source: 'tap', taps0: taps(id) }; st.mode = 'travel'; st.pace = T.strollTapPace; addExtra(); return arrive(); }
      if (b.id === st.node) { st.goal = { kind, node: b.id, target: t, source: 'tap' }; addExtra(); return arrive(); }
      setGoal({ kind, node: b.id, target: t, pokes: 1, source: 'tap' }); addExtra();
    });
    return true;
  }
  function tapPoint(p) {
    const dir = new THREE.Vector3(p.x - body.pos.x, 0, p.z - body.pos.z); if (dir.lengthSq() > 1e-4) dir.normalize();
    st.hint = { p: p.clone(), dir, until: st.now + T.strollHintTime };
    const nn = nearestNode(p, { maxDy: 0.5 }) || nearestNode(p, { maxDy: 1.5 });
    if (!nn) return false;
    const level = (q) => Math.abs(q.y - p.y) < 0.35;
    const close = flat(nn.node.p, p) < T.strollPointReach && level(nn.node.p);
    whenFree(() => {
      const here = st.node && nodes.get(st.node).p;
      // the same floor, a few steps away (between two far-apart road nodes, say): straight there from where Ghost stands
      const straight = !close && here && level(body.pos) && flat(body.pos, p) < T.strollPointStraight;
      if (nn.node.id === st.node || straight) {
        if (close || straight) { st.goal = { kind: 'point', node: st.node, point: p.clone().setY(close ? nn.node.p.y : body.pos.y), source: 'tap' }; st.mode = 'travel'; st.path = []; st.pace = T.strollTapPace; arrive(); }
        else pauseHere(rand(...T.strollTapRest), 'tapped spot');
        return;
      }
      setGoal({ kind: 'point', node: nn.node.id, point: close ? p.clone().setY(nn.node.p.y) : null, source: 'tap' });
    });
    return nn.node.id;
  }
  function tapGhost() {
    st.faceCam = st.now + 2.5;
    whenFree(() => { pauseHere(rand(...T.strollPurr), 'purr'); hooks.purr(); });
    return true;
  }
  function tapRing() {
    const node = targets.get('smoke-ring')?.nodes[0];
    if (!node) return false;
    whenFree(() => { if (node === st.node) { st.goal = { kind: 'ring', node, source: 'tap' }; arrive(); } else setGoal({ kind: 'ring', node, source: 'tap' }); });
    return true;
  }
  // a hop right now, where Ghost stands (the shooting star): only from standing, never mid-edge
  function hopNow() {
    if (st.edge || !body.S.grounded || st.mode !== 'pause') return false;
    const keep = { pause: st.pause };
    hopOnSpot(body.pos.clone());
    st.mode = 'act'; st.act = { kind: 'resume', keep };
    return true;
  }
  // the ring as an idea of Ghost's own (cats chase things that float)
  function chaseRing() { if (st.goal?.kind === 'ring' || st.edge) return false; return tapRing() && (st.goal ? (st.goal.source = 'self') : true); }

  function reset() {
    st.node = null; st.goal = null; st.path = []; st.edge = null; st.act = null; st.pendingTap = null;
    st.bad.clear(); st.fails.clear(); st.sat.clear(); st.rooms.clear(); st.busy = 0; st.lastIdea = null; st.recover = 0;
    pauseHere(rand(2.2, 3.2), 'waking');
  }
  pauseHere(rand(2.2, 3.2), 'waking');
  // put somewhere by hand (a test, the resume note): find the graph again from there
  function relocate() { st.node = null; st.goal = null; st.path = []; st.edge = null; st.act = null; st.pendingTap = null; pauseHere(rand(0.8, 1.4), 'placed'); }

  // what the glint marks: the thing (or spot) Ghost is heading for, or about to head for
  function heading() {
    const g = st.goal || (st.mode === 'pause' && st.pause?.next?.kind && st.pause.next.kind !== 'none' ? st.pause.next : null);
    // resting after a tap on the ground: keep looking the way the player pointed
    if (!g && st.mode === 'pause' && st.pause?.why === 'tapped spot' && st.hint?.dir.lengthSq() > 0.5) return { id: null, pos: body.pos.clone().addScaledVector(st.hint.dir, 3), kind: 'hint' };
    if (!g) return null;
    if (g.kind === 'ring') return { id: 'smoke-ring', pos: hooks.ring().pos };
    if (g.target) return { id: g.target.id, pos: g.target.pos, top: g.target.top, kind: g.target.kind };
    if (g.kind === 'point' && g.point) return { id: null, pos: g.point, top: g.point.y + 0.05, kind: 'point' };
    const n = nodes.get(g.node); return n ? { id: null, pos: n.p, top: n.p.y + 0.12, kind: 'node' } : null;
  }

  return {
    poll, reset, relocate, tapThing, tapPoint, tapGhost, tapRing, hopNow, chaseRing, heading, graph: G, targets,
    get gaze() { return st.gaze; }, get faceCamera() { return st.faceCam > st.now; }, get mode() { return st.mode; }, get pauseN() { return st.pauseN; }, get node() { return st.node; },
    get busy() { return st.mode !== 'pause'; }, get pausing() { return st.mode === 'pause' ? st.pause?.why : null; },
    route: (a, b) => G.routes(a, st.bad).path(b)?.map((e) => ({ a: e.a, b: e.b, move: e.move })) || null,
    debug: () => ({ now: +st.now.toFixed(2), mode: st.mode, node: st.node, goal: st.goal ? { kind: st.goal.kind, node: st.goal.node, target: st.goal.target?.id || null, pokes: st.goal.pokes, source: st.goal.source } : null,
      path: st.path.map((e) => e.key), edge: st.edge ? { key: st.edge.e.key || 'off-graph', move: st.edge.move, phase: st.edge.phase } : null, pause: st.pause && st.mode === 'pause' ? { why: st.pause.why, left: +(st.pause.until - st.now).toFixed(2) } : null,
      bad: [...st.bad], fails: Object.fromEntries(st.fails), rooms: [...st.rooms], busy: st.busy, edges: st.edges, edgeFails: st.edgeFails, ideas: st.ideas, log: st.log.slice(-25), unbound }),
  };
}
