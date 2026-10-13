// Boot: renderer, scene, loop, taps, pause-when-hidden, perf HUD and the window.__ghost debug API.
import * as THREE from 'three';
import { CONFIG, fmt } from './config.js';
import { applyConfigToPage } from './icon.js';
import { buildWorld } from './world.js';
import { createCat } from './cat.js';
import { createFx } from './fx.js';
import { createCameraRig } from './camera.js';
import { createInput } from './input.js';
import { createUI } from './ui.js';
import { createPerf } from './perf.js';

const params = new URLSearchParams(location.search);
applyConfigToPage();
document.getElementById('splash-title').textContent = fmt(CONFIG.gameTitle);
document.getElementById('splash-text').textContent = fmt(CONFIG.text.loading);

const canvas = document.getElementById('c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
} catch (e) {
  document.getElementById('splash-text').textContent = 'this browser could not start WebGL 2. try updating Safari.';
  throw e;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // the lamp's shadows are baked once; nothing that casts them moves

const DPR_CAP = 2;
const deviceRatio = Math.min(window.devicePixelRatio || 1, DPR_CAP);
let ratio = params.has('dpr') ? Math.min(parseFloat(params.get('dpr')) || 1, DPR_CAP) : deviceRatio;
renderer.setPixelRatio(ratio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 200);
const world = buildWorld(scene);
const cat = createCat(scene, world);
const fx = createFx(scene);
const rig = createCameraRig(camera);
const ui = createUI();
const perf = createPerf({ getRatio: () => ratio, setRatio: (r) => { ratio = r; resize(); }, floor: Math.min(1, deviceRatio) });
renderer.shadowMap.needsUpdate = true;
const assetsReady = Promise.all([cat.loadModel(), world.loadGlbProps()]).then(([glb, props]) => {
  renderer.shadowMap.needsUpdate = true; // re-bake the lamp shadows with the real props in place
  return { glb, ...props };
});
let assets = null;
assetsReady.then((a) => { assets = a; });

// ---------- size ----------
let W = innerWidth, H = innerHeight;
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setPixelRatio(ratio);
  renderer.setSize(W, H);
  rig.resize(W / H);
  fx.resize(H * ratio, camera.fov);
  world.setStarScale(ratio);
}
resize();
addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));

// ---------- tapping ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitProxyMat = new THREE.MeshBasicMaterial({ visible: false });
const pickables = [];
for (const p of world.props) {
  p.line = 0;
  if (p.key === 'wall') { p.object.traverse((o) => { if (o.isMesh) { o.userData.prop = p; pickables.push(o); } }); continue; }
  // a generous invisible cylinder per prop: thin things like the lamp post are easy to hit with a thumb
  p.object.updateMatrixWorld(true);
  const box = new THREE.Box3();
  p.object.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox); } });
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.z) / 2 + 0.15;
  const proxy = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(r, 0.5), Math.max(r, 0.5), size.y + 0.2, 10), hitProxyMat);
  proxy.position.set((box.min.x + box.max.x) / 2, size.y / 2, (box.min.z + box.max.z) / 2);
  proxy.userData.prop = p;
  p.object.add(proxy);
  pickables.push(proxy);
  p.radius = Math.max(size.x, size.z) / 2;
}

const lineFor = (key) => {
  const lines = key === 'purr' ? CONFIG.text.purr : CONFIG.text.props[key] || ['…'];
  const p = world.props.find((q) => q.key === key) || purrState;
  const s = lines[p.line % lines.length];
  p.line++;
  return s;
};
const purrState = { line: 0 };

function pokeProp(prop, point) {
  world.poke(prop);
  const top = new THREE.Vector3();
  if (point && prop.key === 'wall') top.copy(point).setY(point.y + 0.3);
  else prop.object.getWorldPosition(top).setY(prop.top);
  fx.burst(top, prop.spark, prop.key === 'lamp' ? 22 : 16, prop.key === 'wall' ? 0.3 : 0.6);
  ui.speak(lineFor(prop.key), top.clone().setY(top.y + 0.6));
  cat.openEyes(1.8);
  // drift over to have a look
  const c = prop.object.getWorldPosition(new THREE.Vector3());
  let dest;
  if (prop.approach) dest = prop.object.localToWorld(new THREE.Vector3(prop.approach[0], 0, prop.approach[1]));
  else if (prop.key === 'wall') { dest = point.clone(); c.copy(point); dest.lerp(new THREE.Vector3(0, 0, 0), 0.9 / Math.max(0.9, dest.length())); }
  else {
    const away = cat.position.clone().sub(c).setY(0);
    if (away.lengthSq() < 1e-4) away.set(0, 0, 1);
    dest = c.clone().add(away.normalize().multiplyScalar(prop.radius + cat.RADIUS + 0.35));
  }
  cat.moveTo(dest, { face: c.clone() });
}

function tap(x, y) {
  ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const catHit = ray.intersectObjects(cat.hitMeshes(), false)[0];
  const propHit = ray.intersectObjects(pickables, false)[0];
  if (catHit && (!propHit || catHit.distance < propHit.distance)) {
    cat.poke();
    fx.burst(cat.position.clone().setY(cat.top - 0.05), '#cfe0ff', 12, 0.3);
    ui.speak(lineFor('purr'), cat.position.clone().setY(cat.top + 0.35));
    return 'cat';
  }
  if (propHit) { pokeProp(propHit.object.userData.prop, propHit.point); return propHit.object.userData.prop.key; }
  const p = ray.ray.intersectPlane(ground, new THREE.Vector3());
  if (p && p.length() < 30) {
    cat.moveTo(p);
    fx.ripple(cat.state.target || p);
    return 'ground';
  }
  return 'nothing';
}

// ---------- input ----------
let camTurn = 0;
createInput(canvas, {
  onTap: tap,
  onOrbit: (a, b) => rig.orbit(a, b),
  onZoom: (f) => rig.zoom(f),
  onAnyInput: () => ui.dismissHint(),
  onKeys: (k) => {
    if (k.poke) {
      let best = null, bd = 2.2;
      for (const p of world.props) {
        if (p.key === 'wall') continue;
        const d = p.object.getWorldPosition(new THREE.Vector3()).setY(0).distanceTo(cat.position) - (p.radius || 0);
        if (d < bd) { bd = d; best = p; }
      }
      if (best) pokeProp(best); else { cat.poke(); ui.speak(lineFor('purr'), cat.position.clone().setY(cat.top + 0.35)); }
      return;
    }
    cat.setInput(k.x, k.z);
    camTurn = k.turn;
  },
});

// ---------- loop ----------
let lastNow = performance.now();
const clock = { getDelta: () => { const n = performance.now(); const d = (n - lastNow) / 1000; lastNow = n; return d; } };
let t = 0, firstFrameMs = null, lastHud = 0, sampler = null;
const splash = document.getElementById('splash');

function stats() {
  const r = renderer.info.render;
  return {
    fps: perf.fps, ms: perf.ms, calls: r.calls, tris: r.triangles, points: r.points, lines: r.lines,
    pr: ratio, w: W, h: H, gl: renderer.capabilities.isWebGL2 ? 'WebGL 2' : 'WebGL 1', stepDowns: perf.stepDowns,
  };
}

function loop(now) {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  t += dt;
  perf.frame(now);
  if (camTurn) rig.orbit(camTurn * dt * 1.4, 0);
  cat.update(dt, t, rig.az);
  world.update(t, dt);
  fx.update(dt, t);
  rig.update(dt, cat.position, world.area);
  renderer.render(scene, camera);
  ui.update(dt, camera, W, H);
  if (sampler) sampler.push(dt, renderer.info.render);
  if (firstFrameMs === null) {
    firstFrameMs = Math.round(performance.now());
    requestAnimationFrame(() => splash.classList.add('gone'));
  }
  if (now - lastHud > 500) { lastHud = now; ui.showPerf(stats()); }
}

let running = false;
function start() { if (running) return; running = true; clock.getDelta(); perf.reset(); renderer.setAnimationLoop(loop); }
function stop() { running = false; renderer.setAnimationLoop(null); }
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
addEventListener('pagehide', stop);
addEventListener('pageshow', () => { if (!document.hidden) start(); });
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
canvas.addEventListener('webglcontextrestored', () => { renderer.shadowMap.needsUpdate = true; start(); });
if (!document.hidden) start();

// ---------- debug API (used by the tests; harmless in play) ----------
window.__ghost = {
  get ready() { return firstFrameMs !== null; },
  info: () => ({ ...stats(), firstFrameMs, glb: cat.state.modelLoaded, assets, cat: [+cat.position.x.toFixed(2), +cat.position.z.toFixed(2)], programs: renderer.info.programs?.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, running }),
  sample: (seconds = 10) => new Promise((resolve) => {
    const dts = [], calls = [], tris = [];
    const t0 = performance.now();
    sampler = { push: (dt, r) => { dts.push(dt); calls.push(r.calls); tris.push(r.triangles); } };
    setTimeout(() => {
      sampler = null;
      const secs = (performance.now() - t0) / 1000;
      const sorted = [...dts].sort((a, b) => a - b);
      const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] * 1000;
      const wins = perf.windows.filter((w) => w.t >= t0);
      resolve({
        seconds: +secs.toFixed(2), frames: dts.length, avgFps: +(dts.length / secs).toFixed(1),
        minWindowFps: wins.length ? +Math.min(...wins.map((w) => w.fps)).toFixed(1) : null,
        p50ms: +pct(0.5).toFixed(2), p95ms: +pct(0.95).toFixed(2), maxMs: +(sorted[sorted.length - 1] * 1000).toFixed(1),
        callsMin: Math.min(...calls), callsMax: Math.max(...calls), trisMax: Math.max(...tris), pixelRatio: ratio, stepDowns: perf.stepDowns,
      });
    }, seconds * 1000);
  }),
  // Render cost without vsync: draw n frames back to back, forcing the GPU to finish each one.
  bench: (n = 120) => {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const one = () => { renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    for (let i = 0; i < 10; i++) one();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) one();
    const ms = (performance.now() - t0) / n;
    return { msPerFrame: +ms.toFixed(2), fpsIfUncapped: Math.round(1000 / ms), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
  },
  tap, tapProp: (key) => { const p = world.props.find((q) => q.key === key); if (p) pokeProp(p, p.object.getWorldPosition(new THREE.Vector3()).setY(0.6)); return !!p; },
  moveTo: (x, z) => cat.moveTo(new THREE.Vector3(x, 0, z)),
  project: (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera); return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H]; },
  orbit: (a, b) => rig.orbit(a, b), zoom: (f) => rig.zoom(f), setRatio: (r) => { ratio = Math.min(r, DPR_CAP); resize(); },
  renderer, scene, camera, cat, world, rig,
};
