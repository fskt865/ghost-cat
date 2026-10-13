// Revision 3, step 1: the controller on a greybox course. Two-thumb controls, capsule physics,
// automatic camera, walk-into-things reactions. Debug API on window.__ghost (state(), sample(), ...).
import * as THREE from 'three';
import { CONFIG, fmt } from './config.js';
import { TUNING as T } from './tuning.js';
import { applyConfigToPage } from './icon.js';
import { buildCourse } from './course.js';
import { createBody } from './physics.js';
import { createGhostLook } from './ghost-look.js';
import { createControls } from './controls.js';
import { createFollowCamera } from './follow-camera.js';
import { createFx } from './fx.js';
import { createUI } from './ui.js';
import { createPerf } from './perf.js';
import { createSettings } from './settings.js';
import { clamp } from './util.js';

const params = new URLSearchParams(location.search);
applyConfigToPage();
const splashText = document.getElementById('splash-text');
document.getElementById('splash-title').textContent = fmt(CONFIG.gameTitle);
splashText.textContent = fmt(CONFIG.text.loading);

const canvas = document.getElementById('c');
if (!document.createElement('canvas').getContext('webgl2')) {
  splashText.textContent = fmt('{name} needs a newer Safari (or any browser from the last few years) to wake up. Updating the phone should do it.');
  throw new Error('no WebGL 2');
}
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
const DPR_CAP = 2, deviceRatio = Math.min(window.devicePixelRatio || 1, DPR_CAP);
let ratio = params.has('dpr') ? Math.min(parseFloat(params.get('dpr')) || 1, DPR_CAP) : deviceRatio;
renderer.setPixelRatio(ratio);

// Safari: no page zoom, no double-tap zoom, no long-press menu, no rubber-band
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(T.camFov, innerWidth / innerHeight, 0.1, 400);
const ui = createUI();
const perf = createPerf({ getRatio: () => ratio, setRatio: (r) => { ratio = r; resize(); }, floor: Math.min(1, deviceRatio) });

const course = await buildCourse(scene);
const body = createBody(course.world, course.spawn);
const look = createGhostLook(scene, course.world);
const lookReady = look.loadModel();
const controls = createControls();
const settings = createSettings();
const cam = createFollowCamera(camera, course.camWorld);
cam.setZones(course.zones);
cam.snap(course.spawn, course.spawnYaw);
look.s.yaw = Math.atan2(1, 0); // facing +x, along the route
const fx = createFx(scene, { moteCentre: course.spawn.clone(), moteSpread: [10, 8] });

let W = innerWidth, H = innerHeight;
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setPixelRatio(ratio); renderer.setSize(W, H);
  cam.resize(W / H);
  fx.resize(H * ratio, camera.fov);
  course.setStarScale(ratio);
  look.setViewport(W * ratio, H * ratio, ratio);
}
resize();
addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));

// the hint: which one depends on how Ghost is being steered
const hint = document.getElementById('hint');
hint.style.bottom = 'auto'; hint.style.top = 'calc(58px + env(safe-area-inset-top))';
hint.textContent = fmt(controls.usingTouch ? CONFIG.text.hintPlatform : CONFIG.text.hintPlatformKeys);
let hintShown = true;

// ---------- walking into things: glow + wobble (+ a line) ----------
const glowing = [];
function react(b, now) {
  b.t = now;
  const o = b.obj;
  const s0 = o.userData.s0 || (o.userData.s0 = o.scale.clone());
  glowing.push({ b, t: 0 });
  o.traverse((m) => {
    if (!m.isMesh || !m.material || !m.material.emissive) return;
    if (!m.userData.e0) m.userData.e0 = { c: m.material.emissive.clone(), i: m.material.emissiveIntensity };
  });
  void s0;
  const top = b.centre.clone(); top.y += b.height + 0.15;
  fx.burst(top, b.colour, b.cat ? 10 : 14, 0.35, b.cat ? { kind: 'hearts' } : {});
  if (b.line) ui.speak(fmt(b.line), top.clone().setY(top.y + 0.3));
  if (b.cat) {
    look.happy(1.4);
    const face = b.obj.getObjectByProperty ? null : null; void face;
    b.obj.traverse((m) => { if (m.isMesh && m.morphTargetDictionary?.blink !== undefined) m.userData.blinkT = 0; });
  } else look.happy(0.6);
}
function updateGlow(dt) {
  for (let i = glowing.length - 1; i >= 0; i--) {
    const g = glowing[i]; g.t += dt;
    const k = Math.max(0, 1 - g.t / 0.9);
    const wob = Math.exp(-g.t * 5) * Math.sin(g.t * 22) * 0.1;
    const o = g.b.obj, s0 = o.userData.s0;
    o.scale.set(s0.x * (1 - wob * 0.5), s0.y * (1 + wob), s0.z * (1 - wob * 0.5));
    if (course.propBatch.has(o)) {
      course.propBatch.syncObject(o);
      course.propBatch.tintObject(o, g.b.colour, k * 0.9);
      if (g.t > 1.2) { o.scale.copy(s0); course.propBatch.syncObject(o); course.propBatch.tintObject(o, '#000000', 0); glowing.splice(i, 1); }
      continue;
    }
    const col = new THREE.Color(g.b.colour);
    o.traverse((m) => {
      if (!m.isMesh || !m.userData.e0) return;
      m.material.emissive.copy(m.userData.e0.c).lerp(col, k * 0.8);
      m.material.emissiveIntensity = m.userData.e0.i + k * 0.6;
      if (m.userData.blinkT !== undefined) {
        m.userData.blinkT += dt;
        const i = m.morphTargetDictionary.blink; m.morphTargetInfluences[i] = Math.max(0, Math.sin(Math.min(1, m.userData.blinkT / 1.2) * Math.PI));
        if (m.userData.blinkT > 1.2) { m.morphTargetInfluences[i] = 0; delete m.userData.blinkT; }
      }
    });
    if (g.t > 1.2) { o.scale.copy(s0); glowing.splice(i, 1); }
  }
}
function checkBumps(now) {
  const p = body.pos;
  for (const b of course.bumpables) {
    if (now - b.t < 1.6) continue;
    const d = Math.hypot(p.x - b.centre.x, p.z - b.centre.z);
    if (d < b.radius + T.radius + 0.06 && p.y < b.centre.y + b.height + 0.12 && p.y + T.height > b.centre.y - 0.05) react(b, now);
  }
}

// ---------- pits: falling off the edge of the built world drifts Ghost back to the last safe spot ----------
let returning = null, respawns = 0, falls = 0;
const eventCounts = {};
const inBox = (p, z) => p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z;
function startReturn() {
  returning = { from: body.pos.clone(), to: body.S.lastSafe.clone(), t: 0 };
  falls++;
  fx.burst(body.pos.clone().setY(body.pos.y + 0.4), '#cfe0ff', 12, 0.3);
}

// ---------- big things between the camera and Ghost fade away ----------
const fades = [...course.fadeables, ...course.cats.map((c) => c.obj)].map((o) => {
  const b = new THREE.Box3().setFromObject(o), sph = b.getBoundingSphere(new THREE.Sphere());
  const mats = []; o.traverse((m) => { if (m.isMesh && m.material && m.material.visible !== false) mats.push(m.material); });
  for (const m of mats) m.userData.op0 = m.opacity ?? 1;
  return { o, sph, mats, level: 1 };
});
const seg = new THREE.Line3(), segPt = new THREE.Vector3();
// batched props (benches, chimneys, bins...) cannot fade, so they step out of the way instead
const blockers = course.bumpables.filter((b) => course.propBatch.has(b.obj)).map((b) => ({ b, sph: new THREE.Sphere(b.centre.clone().setY(b.centre.y + b.height / 2), Math.max(b.radius, b.height / 2)), hidden: false }));
function updateFades(dt) {
  seg.start.copy(camera.position); seg.end.copy(body.pos).y += T.height * 0.5;
  for (const k of blockers) {
    seg.closestPointToPoint(k.sph.center, true, segPt);
    const hide = segPt.distanceTo(k.sph.center) < k.sph.radius * 0.85 && segPt.distanceTo(seg.end) > 0.35;
    if (hide !== k.hidden) { k.hidden = hide; course.propBatch.setObjectVisible(k.b.obj, !hide); }
  }
  for (const f of fades) {
    seg.closestPointToPoint(f.sph.center, true, segPt);
    const hide = segPt.distanceTo(f.sph.center) < f.sph.radius * 0.8 && segPt.distanceTo(seg.end) > 0.35;
    const goal = hide ? 0.18 : 1;
    if (Math.abs(goal - f.level) < 0.001 && goal === 1) continue;
    f.level += (goal - f.level) * Math.min(1, dt * 8);
    for (const m of f.mats) {
      const faded = f.level < 0.99;
      if (m.transparent !== faded || m.userData.wasFaded !== faded) { m.transparent = faded || m.userData.op0 < 1; m.depthWrite = !faded; m.needsUpdate = true; m.userData.wasFaded = faded; }
      m.opacity = m.userData.op0 * f.level;
    }
  }
}

// ---------- the goal ----------
let reachedGoal = false, goalT = null;
function checkGoal() {
  if (reachedGoal) return;
  const g = course.goal, p = body.pos;
  if (body.S.grounded && Math.hypot(p.x - g.centre.x, p.z - g.centre.z) < g.radius && p.y > g.centre.y - 0.1) {
    reachedGoal = true; goalT = performance.now();
    fx.burst(p.clone().setY(p.y + 0.6), '#ffd98a', 30, 0.8);
    setTimeout(() => fx.burst(p.clone().setY(p.y + 0.8), '#fff4c8', 18, 0.6, { scale: 0.8 }), 300);
    ui.speak(fmt(CONFIG.text.goal), p.clone().setY(p.y + 1.1));
    look.happy(3);
  }
}

// ---------- loop ----------
const STEP = 1 / 120;
let acc = 0, last = performance.now(), t = 0, firstFrameMs = null, lastHud = 0, sampler = null;
const move = new THREE.Vector3();
const splash = document.getElementById('splash');
let lastInput = { x: 0, y: 0, jumpHeld: false, jumpPressed: false, source: 'none' };
let override = null; // tests can drive input directly with __ghost.drive()

function stats() {
  const r = renderer.info.render;
  return { fps: perf.fps, ms: perf.ms, calls: r.calls, tris: r.triangles, points: r.points, lines: r.lines, pr: ratio, w: W, h: H, gl: 'WebGL 2', stepDowns: perf.stepDowns };
}

function loop(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20); last = now; t += dt;
  perf.frame(now);
  const input = override ? { nudgeX: 0, nudgeY: 0, ...override, jumpPressed: override.jumpPressed } : controls.poll();
  if (override) override.jumpPressed = false;
  lastInput = input;
  if (hintShown && (Math.hypot(input.x, input.y) > 0.2 || input.jumpPressed)) { hintShown = false; hint.classList.add('gone'); }
  if (input.source === 'touch' && hint.textContent !== fmt(CONFIG.text.hintPlatform)) hint.textContent = fmt(CONFIG.text.hintPlatform);

  let events = [];
  if (returning) {
    returning.t += dt / 1.4;
    const k = Math.min(1, returning.t), e = k * k * (3 - 2 * k);
    body.pos.lerpVectors(returning.from, returning.to, e);
    body.pos.y += Math.sin(k * Math.PI) * 2.0;
    body.vel.set(0, 0, 0);
    body.S.floating = true; body.S.grounded = false;
    if (k >= 1) { body.teleport(returning.to); body.S.grounded = true; returning = null; events.push({ type: 'respawn' }); }
  } else {
    cam.stickToWorld(input.x, input.y, move);
    if (move.lengthSq() > 1) move.normalize();
    acc += dt;
    let first = true;
    while (acc >= STEP) {
      body.step(STEP, { move, jumpHeld: input.jumpHeld, jumpPressed: first && input.jumpPressed });
      first = false; acc -= STEP;
    }
    if (first && input.jumpPressed) body.S.jumpBufferT = body.S.now; // no step this frame: keep the press
    body.magnet(dt);
    events = body.drain();
    if (body.S.lastSafe.y - body.pos.y > T.pitDrop && course.pits.some((z) => inBox(body.pos, z))) startReturn();
  }
  for (const e of events) {
    const p = body.pos;
    eventCounts[e.type] = (eventCounts[e.type] || 0) + 1;
    if (e.type === 'jump' || e.type === 'airJump') fx.burst(p.clone().setY(p.y + 0.05), e.type === 'jump' ? '#e8e0ff' : '#cfe0ff', e.type === 'jump' ? 6 : 9, 0.2, { scale: 0.6 });
    else if (e.type === 'land' && e.speed > 3) fx.burst(p.clone().setY(p.y + 0.04), '#d8d0f0', Math.min(10, 3 + Math.round(e.speed)), 0.3, { scale: 0.55 });
    else if (e.type === 'bump') fx.burst(p.clone().setY(p.y + 0.3).addScaledVector(e.normal, -T.radius), '#fff0d0', 4, 0.1, { scale: 0.5 });
    else if (e.type === 'respawn') respawns++;
  }
  look.update(dt, t, body, events, Math.hypot(input.x, input.y), cam.yaw + cam.s.nudgeYaw);
  checkBumps(t); updateGlow(dt); checkGoal();
  cam.update(dt, body, input);
  updateFades(dt);
  course.update(t);
  fx.setMotes(body.pos, [9, 7]);
  fx.update(dt, t);
  renderer.render(scene, camera);
  ui.update(dt, camera, W, H);
  if (sampler) sampler.push(dt, renderer.info.render);
  if (firstFrameMs === null) { firstFrameMs = Math.round(performance.now()); requestAnimationFrame(() => splash.classList.add('gone')); }
  if (now - lastHud > 500) { lastHud = now; ui.showPerf(stats()); }
}

let running = false;
function start() { if (running) return; running = true; last = performance.now(); acc = 0; perf.reset(); renderer.setAnimationLoop(loop); }
function stop() { running = false; renderer.setAnimationLoop(null); }
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
addEventListener('pagehide', stop);
addEventListener('pageshow', () => { if (!document.hidden) start(); });
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
canvas.addEventListener('webglcontextrestored', () => start());
if (!document.hidden) start();

// ---------- debug API ----------
window.__ghost = {
  get ready() { return firstFrameMs !== null; },
  info: () => ({ ...stats(), firstFrameMs, glb: look.modelLoaded, running }),
  state: () => ({
    pos: body.pos.toArray().map((v) => +v.toFixed(3)), vel: body.vel.toArray().map((v) => +v.toFixed(2)),
    grounded: body.S.grounded, floating: body.S.floating, airJumpsLeft: body.S.airJumpsLeft, returning: !!returning,
    respawns, falls, reachedGoal, events: { ...eventCounts }, camFollow: +cam.distance.toFixed(2), camBase: +cam.s.baseDist.toFixed(2), goalMs: goalT && goalT - (firstFrameMs || 0), camYaw: +cam.yaw.toFixed(3), camDist: +camera.position.distanceTo(body.pos).toFixed(2),
    input: { x: +lastInput.x.toFixed(2), y: +lastInput.y.toFixed(2), jumpHeld: lastInput.jumpHeld, source: lastInput.source }, usingTouch: controls.usingTouch,
  }),
  route: course.route, goal: { centre: course.goal.centre.toArray(), radius: course.goal.radius },
  // drive input without touch (for comparing); the scripted runs use real pointer events instead
  drive: (o) => { override = o ? { x: 0, y: 0, jumpHeld: false, jumpPressed: false, source: 'test', ...o } : null; },
  // the world direction the stick would move in for a given stick vector
  stickFor: (wx, wz) => { // invert stickToWorld: which stick (x, y) moves along world (wx, wz)
    const f = new THREE.Vector3(-Math.sin(cam.s.inputYaw), 0, -Math.cos(cam.s.inputYaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    return [wx * r.x + wz * r.z, wx * f.x + wz * f.z];
  },
  teleport: (x, y, z) => { body.teleport(new THREE.Vector3(x, y, z)); },
  sample: (seconds = 10) => new Promise((resolve) => {
    const dts = [], calls = [], tris = [], t0 = performance.now();
    sampler = { push: (dt, r) => { dts.push(dt); calls.push(r.calls); tris.push(r.triangles); } };
    setTimeout(() => {
      sampler = null;
      const secs = (performance.now() - t0) / 1000, sorted = [...dts].sort((a, b) => a - b);
      const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 1000;
      const wins = perf.windows.filter((w) => w.t >= t0);
      resolve({ seconds: +secs.toFixed(2), frames: dts.length, avgFps: +(dts.length / secs).toFixed(1), minWindowFps: wins.length ? +Math.min(...wins.map((w) => w.fps)).toFixed(1) : null,
        p50ms: +pct(0.5).toFixed(2), p95ms: +pct(0.95).toFixed(2), callsMin: Math.min(...calls), callsMax: Math.max(...calls), trisMax: Math.max(...tris), pixelRatio: ratio, stepDowns: perf.stepDowns });
    }, seconds * 1000);
  }),
  bench: (n = 120) => {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const one = () => { renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    for (let i = 0; i < 10; i++) one();
    const t0 = performance.now(); for (let i = 0; i < n; i++) one();
    const ms = (performance.now() - t0) / n;
    return { msPerFrame: +ms.toFixed(2), fpsIfUncapped: Math.round(1000 / ms), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
  },
  setRatio: (r) => { ratio = Math.min(r, DPR_CAP); resize(); },
  // how tall Ghost stands on screen right now, in CSS px and as a share of the screen height
  ghostOnScreen: () => {
    // from the bottom of Ghost's hem to the tips of Ghost's ears, straight up through Ghost's middle
    const b = new THREE.Box3(); look.root.traverse((o) => { if (o.isMesh && o.visible && o.material.visible !== false && !o.material.side) b.expandByObject(o); });
    const c = b.getCenter(new THREE.Vector3());
    const yTop = (1 - new THREE.Vector3(c.x, b.max.y, c.z).project(camera).y) / 2 * H, yBot = (1 - new THREE.Vector3(c.x, b.min.y, c.z).project(camera).y) / 2 * H;
    const px = Math.abs(yBot - yTop);
    return { px: Math.round(px), share: +(px / H).toFixed(3), oneIn: +(H / px).toFixed(1) };
  },
  tuning: T, renderer, scene, camera, body, cam, course, look, controls,
};
lookReady.then(() => {});
void clamp;
