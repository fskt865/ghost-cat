// Phase 1: Ghost's apartment. Boot, the loop, tapping things, secrets, the journal, glimmers,
// the night / morning loop and the save. Debug API on window.__ghost (state() for tests).
import * as THREE from 'three';
import { CONFIG, fmt } from './config.js';
import { applyConfigToPage } from './icon.js';
import { buildApartment } from './apartment.js';
import { createCat } from './cat.js';
import { createFx } from './fx.js';
import { createCameraRig } from './camera.js';
import { createInput } from './input.js';
import { createUI } from './ui.js';
import { createPerf } from './perf.js';
import { createHud } from './hud.js';
import { createStore, freshNight } from './save.js';
import { THINGS, ENTRIES, ROOMS, NIGHT_LINES, MORNING_LINES, ENTRY_GLIMMERS } from './things.js';
import { glowTexture } from './util.js';

const params = new URLSearchParams(location.search);
applyConfigToPage();
const splashText = document.getElementById('splash-text');
document.getElementById('splash-title').textContent = fmt(CONFIG.gameTitle);
splashText.textContent = fmt(CONFIG.text.loading);

// ---------- renderer (WebGL 2 only) ----------
const canvas = document.getElementById('c');
const probe = document.createElement('canvas').getContext('webgl2');
if (!probe) {
  splashText.textContent = fmt('{name} needs a newer Safari (or any browser from the last few years) to wake up. Updating the phone should do it.');
  throw new Error('no WebGL 2');
}
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
const DPR_CAP = 2;
const deviceRatio = Math.min(window.devicePixelRatio || 1, DPR_CAP);
let ratio = params.has('dpr') ? Math.min(parseFloat(params.get('dpr')) || 1, DPR_CAP) : deviceRatio;
renderer.setPixelRatio(ratio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 220);
const store = createStore();
if (params.has('fresh')) store.reset();
const S = () => store.data;
const hud = createHud();
hud.bind(store);
const ui = createUI();
const rig = createCameraRig(camera);
const perf = createPerf({ getRatio: () => ratio, setRatio: (r) => { ratio = r; resize(); }, floor: Math.min(1, deviceRatio) });

const apt = await buildApartment(scene);
const cat = createCat(scene, apt);
const fx = createFx(scene, { moteCentre: new THREE.Vector3(-2.8, 0, -1.2), moteSpread: [5, 3.5] });
const catReady = cat.loadModel();
apt.applyNight(S().tonight);
renderer.shadowMap.needsUpdate = true;

// ---------- size ----------
let W = innerWidth, H = innerHeight;
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setPixelRatio(ratio); renderer.setSize(W, H);
  rig.resize(W / H);
  fx.resize(H * ratio, camera.fov);
  apt.setStarScale(ratio);
  cat.setViewport(W * ratio, H * ratio, ratio);
}
resize();
addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));

// ---------- things ----------
const tmpV = new THREE.Vector3(), tmpB = new THREE.Box3();
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
const things = [];
const roomRect = (id) => apt.rooms[id];
for (const def of THINGS) {
  if (def.needs && !S().decorations.includes(def.needs)) continue;
  const obj = apt.placed[def.at];
  if (!obj) { console.warn('[things] nothing placed for', def.id, def.at); continue; }
  const node = (def.node && obj.getObjectByName(def.node)) || obj;
  const t = { def, obj, node, line: 0, wob: 9, sitT: 0, base: null };
  const hit = def.hit || { r: 0.35, h: 0.5 };
  t.proxy = new THREE.Mesh(new THREE.CylinderGeometry(hit.r, hit.r, hit.h, 10), proxyMat);
  t.proxy.userData.thing = t;
  scene.add(t.proxy);
  things.push(t);
}
const thingById = Object.fromEntries(things.map((t) => [t.def.id, t]));
const moving = new Set(['moth', 'leaf', 'snail']);
const sky = new Set(['stars', 'moon']);

// world position of a thing: centre of its node's bounds at the bottom, and its top
function thingBounds(t) {
  t.node.updateWorldMatrix(true, true);
  tmpB.makeEmpty();
  t.node.traverse((o) => { if (o.isMesh && o.material !== proxyMat) tmpB.expandByObject(o); });
  if (tmpB.isEmpty()) { const p = t.node.getWorldPosition(new THREE.Vector3()); tmpB.set(p.clone(), p.clone()); }
  return tmpB.clone();
}
function placeProxy(t) {
  const hit = t.def.hit || { r: 0.35, h: 0.5 };
  const b = thingBounds(t);
  const c = b.getCenter(tmpV);
  t.pos = new THREE.Vector3(c.x, b.min.y, c.z);
  t.top = b.max.y;
  t.proxy.position.set(c.x, b.min.y + (hit.y || 0) + hit.h / 2, c.z);
}
for (const t of things) placeProxy(t);

// where Ghost goes to poke a thing, and what Ghost settles on
function standFor(t) {
  const d = t.def;
  if (d.seat) {
    const p = t.obj.localToWorld(new THREE.Vector3(d.seat[0], 0, d.seat[2]));
    return { p, seat: { y: t.obj.position.y + d.seat[1] } };
  }
  if (sky.has(d.id)) return { p: new THREE.Vector3(7.0, 0, -1.3) };
  const r = roomRect(d.room);
  const centre = new THREE.Vector3((r.x0 + r.x1) / 2, 0, Math.min(0.2, (r.z0 + r.z1) / 2));
  const from = t.pos.clone().setY(0);
  const dir = centre.sub(from); dir.y = 0;
  if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
  // wall things: stand in front of them
  if (from.z < r.z0 + 0.5) dir.set(dir.x * 0.25, 0, 1);
  dir.normalize();
  const reach = Math.max(0.35, (d.hit?.r ?? 0.3) * 0.7) + 0.3;
  const p = from.addScaledVector(dir, reach);
  return { p };
}

// ---------- night state helpers ----------
const night = () => S().tonight;
const changed = () => { store.changed(); hud.refresh(); };
const requiresMet = (req) => {
  if (!req) return true;
  if (req.toggle) return night()[req.toggle[0]] === req.toggle[1];
  if (req.found) return !!S().found[req.found];
  if (req.decoration) return S().decorations.includes(req.decoration);
  return true;
};
const entryById = Object.fromEntries(ENTRIES.map((e) => [e.id, e]));

function discover(entryId, at) {
  if (S().found[entryId]) return false;
  const e = entryById[entryId];
  if (!e) return false;
  S().found[entryId] = S().night;
  night().found.push(entryId);
  S().glimmers += e.glimmers || ENTRY_GLIMMERS;
  changed();
  hud.bumpGlimmers();
  hud.showToast(e);
  const p = at || cat.position.clone().setY(cat.top);
  fx.burst(p, '#ffd98a', 26, 0.6);
  setTimeout(() => fx.burst(p, '#fff4c8', 14, 0.4, { scale: 0.7 }), 250);
  cat.poke();
  if (night().found.length === 4) setTimeout(() => hud.showNudge('{name} yawns. the bed at home is there whenever.'), 5000);
  onDiscover(entryId);
  return true;
}

// ---------- reactions ----------
const wobbling = new Map(); // node -> { t, amp, base }
function wobble(node, amp = 0.12) {
  if (!node) return;
  let w = wobbling.get(node);
  if (!w) { w = { base: { s: node.scale.clone(), r: node.rotation.clone() } }; wobbling.set(node, w); }
  w.t = 0; w.amp = amp;
}
function updateWobbles(dt) {
  for (const [node, w] of wobbling) {
    if (w.t > 1.4) continue;
    w.t += dt;
    const s = Math.exp(-w.t * 4.5) * Math.sin(w.t * 20) * w.amp;
    node.scale.set(w.base.s.x * (1 - s * 0.5), w.base.s.y * (1 + s), w.base.s.z * (1 - s * 0.5));
    node.rotation.z = w.base.r.z + s * 0.3;
    if (w.t > 1.4) { node.scale.copy(w.base.s); node.rotation.z = w.base.r.z; }
  }
}
const anims = []; // { t, dur, fn(k), done }
const animate = (dur, fn, done) => anims.push({ t: 0, dur, fn, done });
function updateAnims(dt) {
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i]; a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    a.fn(k);
    if (k >= 1) { anims.splice(i, 1); a.done?.(); }
  }
}

function speakFor(t, text) {
  ui.speak(text, new THREE.Vector3(t.pos.x, Math.max(t.top, cat.top) + 0.3, t.pos.z));
}
function nextLine(t) {
  const lines = t.def.lines;
  const n = night().lines[t.def.id] || 0;
  night().lines[t.def.id] = n + 1;
  return lines[n % lines.length];
}

// Ghost arrived (or was already there): do the thing.
function poke(t) {
  const d = t.def, ns = night();
  ns.taps[d.id] = (ns.taps[d.id] || 0) + 1;
  S().stats.pokes++;
  if (!ns.poked[d.id]) { ns.poked[d.id] = true; S().glimmers += d.glimmer ?? 1; hud.bumpGlimmers(); }
  const taps = ns.taps[d.id];
  const anchor = new THREE.Vector3(t.pos.x, t.top + 0.05, t.pos.z);
  cat.act(d.act === 'sit' ? 'nudge' : d.act);
  if (d.act === 'purr') cat.poke();
  if (d.act === 'stare') cat.openEyes(1.8);
  let line = null;

  switch (d.reaction) {
    case 'toggle': {
      ns[d.toggle] = !ns[d.toggle];
      apt.applyNight(ns);
      line = d.lines[ns[d.toggle] ? 0 : 1];
      wobble(t.node, 0.08);
      if (d.toggle === 'livingLamp' || d.toggle === 'bedLamp') fx.burst(anchor, '#ffd27a', ns[d.toggle] ? 14 : 5, 0.3);
      break;
    }
    case 'sleep': askSleep(); break;
    default: wobble(t.node, d.reaction === 'sit' ? 0.05 : 0.12);
  }
  if (d.act === 'water') fx.burst(anchor.clone().setY(t.top + 0.35), '#9fc4ff', 12, 0.25, { kind: 'drops' });
  else if (d.reaction !== 'sleep') fx.burst(anchor, d.room === 'balcony' ? '#d8f0ff' : '#ffe2a0', 10, 0.35, { scale: 0.7 });

  special(t, taps);
  if (line === null && d.reaction !== 'sleep') line = special.line ?? nextLine(t);
  special.line = null;
  if (line) speakFor(t, line);

  // secrets triggered by poking
  const sec = d.secret;
  if (sec && requiresMet(sec.requires) && ((sec.once) || (sec.taps && taps >= sec.taps))) discover(sec.entry, anchor.clone().setY(t.top + 0.2));
  changed();
}

// per-thing behaviour beyond the wobble
function special(t, taps) {
  const d = t.def, ns = night(), A = apt.placed;
  switch (d.special) {
    case 'blanket':
      if (taps >= 3) { ns.knocked.blanket = true; setBlanket(true); cat.poke(); }
      break;
    case 'hairTie':
      if (ns.knocked.hairtie) { special.line = d.lines[1]; break; }
      ns.knocked.hairtie = true;
      { const o = A.hairTie, from = o.position.clone(); const to = new THREE.Vector3(-6.4, 0.01, 0.4);
        animate(0.9, (k) => { o.position.lerpVectors(from, to, k); o.position.y = from.y * (1 - k) + Math.sin(k * Math.PI) * 0.6; o.rotation.x = k * 9; }, () => { o.visible = false; }); }
      special.line = d.lines[0];
      break;
    case 'shelfMug':
      if (ns.knocked.shelf) { special.line = d.lines[1]; break; }
      ns.knocked.shelf = true; knockShelfMug(true);
      special.line = d.lines[0];
      break;
    case 'picture': {
      const p = t.node; p.userData.straightT = 4; break;
    }
    case 'books': wobble(A.bookshelf.getObjectByName('book_wobble'), 0.3); break;
    case 'slippers': {
      const o = A.slippers; const scattered = !o.userData.scattered; o.userData.scattered = scattered;
      const r0 = o.rotation.y, r1 = scattered ? 1.3 : 0.35;
      animate(0.4, (k) => { o.rotation.y = r0 + (r1 - r0) * k; });
      special.line = d.lines[scattered ? 0 : 1];
      break;
    }
    case 'dustBunny': {
      const b = A.dustBunny; b.visible = true;
      animate(1.6, (k) => { b.position.y = Math.abs(Math.sin(k * Math.PI * 4)) * 0.08 * (1 - k); b.position.z = -0.35 + k * 0.25; });
      break;
    }
    case 'stash':
      if (S().found['hair-tie']) A.stash.visible = true;
      break;
    case 'mugEdge': {
      if (ns.mugEdge >= 3) { special.line = d.lines[2]; break; }
      ns.mugEdge = Math.min(3, ns.mugEdge + 1);
      setMugEdge(ns.mugEdge, true);
      special.line = d.lines[ns.mugEdge - 1];
      break;
    }
    case 'fridge':
      if (taps >= 3) openFridge();
      break;
    case 'coin':
      wobble(t.node, 0.2);
      if (taps >= 3 && !S().found['couch-money']) popCoin(t);
      break;
    case 'tomatoes': {
      const tom = A.tomatoes.userData.tomatoes[(taps - 1) % 3];
      if (tom) { wobble(tom, 0.35); fx.burst(tom.getWorldPosition(new THREE.Vector3()), '#ffb0a0', 8, 0.1, { scale: 0.6 }); }
      break;
    }
    case 'blink':
      if (taps >= 3) {
        const face = A.neighbourCat.userData.face;
        if (face) { const i = face.morphTargetDictionary.blink; animate(1.6, (k) => { face.morphTargetInfluences[i] = Math.sin(k * Math.PI); }); }
        const h = A.neighbourCat.getObjectByName('heart'); h.visible = true; animate(3.5, (k) => { h.position.y = 0.46 + k * 0.25; h.scale.setScalar(Math.min(1, k * 6) * (1 - Math.max(0, k - 0.8) * 5)); }, () => { h.visible = false; }); }
      else wobble(A.neighbourCat, 0.05);
      break;
    case 'wink':
      if (taps >= 3 && night().curtains) { apt.setWink(true); setTimeout(() => apt.setWink(false), 3200); }
      break;
  }
  if (d.reaction === 'chase') chase(t);
}

function chase(t) {
  if (t.def.id === 'moth') {
    apt.mothState.chased = 1.6;
    if (night().livingLamp && S().found['moths-dance']) apt.mothState.dance = 3;
  }
  if (t.def.id === 'leaf') {
    const st = apt.placed.leaf.userData.state;
    if (st.active) { st.active = false; apt.placed.leaf.visible = false; st.t = 5; fx.burst(apt.placed.leaf.position, '#ffd27a', 12, 0.2); }
  }
}

function onDiscover(id) {
  if (id === 'moths-dance') apt.mothState.dance = 4;
  if (id === 'stash') apt.placed.stash.visible = true;
}

// --- visual states that last the night
function setBlanket(on) {
  const b = apt.placed.bed.getObjectByName('blanket'); if (!b) return;
  if (!b.userData.s0) b.userData.s0 = b.scale.clone();
  const w = wobbling.get(b); if (w) w.base.s.copy(b.userData.s0).multiply(new THREE.Vector3(1, on ? 2.2 : 1, 1));
  b.scale.copy(b.userData.s0).multiply(new THREE.Vector3(1, on ? 2.2 : 1, 1));
}
function knockShelfMug(animated) {
  const m = apt.placed.bookshelf.getObjectByName('shelf_mug'); if (!m) return;
  if (!m.userData.p0) { m.userData.p0 = m.position.clone(); m.userData.r0 = m.rotation.clone(); }
  const from = m.userData.p0.clone(), to = from.clone().add(new THREE.Vector3(0.05, -from.y, 0.45));
  const set = (k) => { m.position.lerpVectors(from, to, k); m.position.y = from.y * (1 - k * k); m.rotation.x = k * 1.57; m.rotation.z = k * 0.6; };
  if (animated) animate(0.55, set, () => fx.burst(m.getWorldPosition(new THREE.Vector3()), '#ffe2a0', 8, 0.2, { scale: 0.6 })); else set(1);
}
function resetShelfMug() { const m = apt.placed.bookshelf.getObjectByName('shelf_mug'); if (m?.userData.p0) { m.position.copy(m.userData.p0); m.rotation.copy(m.userData.r0); } }
function setMugEdge(n, animated) {
  const m = apt.placed.counter.getObjectByName('mug'); if (!m) return;
  if (!m.userData.p0) m.userData.p0 = m.position.clone();
  const goal = m.userData.p0.z + n * 0.075;
  if (animated) { const z0 = m.position.z; animate(0.35, (k) => { m.position.z = z0 + (goal - z0) * k; }); } else m.position.z = goal;
}
let fridgeOpen = 0;
const fridgeLight = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#dff4ff', opacity: 0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
fridgeLight.scale.setScalar(1.8); scene.add(fridgeLight);
function openFridge() {
  const door = apt.placed.fridge.getObjectByName('door'); if (!door) return;
  const p = apt.placed.fridge.localToWorld(new THREE.Vector3(0, 0.9, 0.5)); fridgeLight.position.copy(p);
  fridgeOpen = 3;
  const r0 = door.rotation.y;
  animate(0.5, (k) => { door.rotation.y = r0 - 1.3 * k; fridgeLight.material.opacity = 0.7 * k; });
  setTimeout(() => animate(0.6, (k) => { door.rotation.y = r0 - 1.3 * (1 - k); fridgeLight.material.opacity = 0.7 * (1 - k); }), 2800);
}
function popCoin(t) {
  const c = apt.placed.coin; c.visible = true;
  const from = new THREE.Vector3(t.pos.x, t.top, t.pos.z), to = from.clone().add(new THREE.Vector3(0.3, -t.top + 0.01, 0.55));
  animate(0.9, (k) => { c.position.lerpVectors(from, to, k); c.position.y = from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 0.4; c.rotation.y = k * 14; }, () => setTimeout(() => (c.visible = false), 2500));
}
function restoreNightVisuals() {
  const ns = night();
  apt.applyNight(ns);
  setBlanket(!!ns.knocked.blanket);
  if (ns.knocked.shelf) knockShelfMug(false); else resetShelfMug();
  apt.placed.hairTie.visible = !ns.knocked.hairtie;
  setMugEdge(ns.mugEdge, false);
  apt.placed.stash.visible = !!S().found.stash;
  apt.placed.dustBunny.visible = !!ns.taps.underbed;
}
restoreNightVisuals();

// picture: straightened by pokes, drifts crooked again after a few seconds
const pic = apt.placed.picture.getObjectByName('picture');
const CROOKED = 0.13;
if (pic) pic.rotation.z = CROOKED;

// ---------- tapping ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let pending = null; // the thing Ghost is on the way to

let pendingExtra = 0;
function goPoke(t) {
  // tapping the same thing again while Ghost is on the way: Ghost pokes it that many more times
  if (pending === t && cat.busy) { pendingExtra = Math.min(pendingExtra + 1, 4); fx.burst(new THREE.Vector3(t.pos.x, t.top, t.pos.z), '#fff0c8', 3, 0.2, { scale: 0.5 }); return; }
  pending = t; pendingExtra = 0;
  const { p, seat } = standFor(t);
  // instant feedback: a small sparkle and nudge on the thing itself
  fx.burst(new THREE.Vector3(t.pos.x, t.top, t.pos.z), '#fff0c8', 4, 0.2, { scale: 0.5 });
  const near = cat.position.distanceTo(new THREE.Vector3(p.x, cat.position.y, p.z)) < 0.25 && !seat;
  const arrive = () => {
    if (pending !== t) return;
    pending = null; poke(t);
    for (let i = 1; i <= pendingExtra; i++) setTimeout(() => poke(t), i * 450);
    pendingExtra = 0;
  };
  if (near && !cat.state.seated) { cat.state.face = t.pos.clone(); arrive(); }
  else cat.moveTo(p, { face: t.pos.clone(), seat, onArrive: arrive });
}

function tap(x, y) {
  if (hud.journalOpen || hud.cardOpen || sleeping) return 'blocked';
  ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  // a shooting star in flight?
  if (star.active) {
    const sp = star.head.clone().project(camera);
    const sx = (sp.x + 1) / 2 * W, sy = (1 - sp.y) / 2 * H;
    if (Math.hypot(sx - x, sy - y) < 80) { discover('shooting-star', star.head.clone()); fx.burst(star.head, '#fff4c8', 20, 1.5, { scale: 3 }); star.active = false; star.mesh.visible = false; return 'shooting-star'; }
  }
  const catHit = ray.intersectObjects(cat.hitMeshes(), false)[0];
  const proxies = things.filter((t) => t.proxy.visible && !sky.has(t.def.id)).map((t) => t.proxy);
  const hits = ray.intersectObjects(proxies, false);
  let best = null;
  if (hits.length) {
    const d0 = hits[0].distance;
    // among near-equal hits prefer the smaller target (a hair tie on a nightstand)
    best = hits.filter((h) => h.distance < d0 + 0.35).sort((a, b) => (a.object.userData.thing.def.hit?.r ?? 0.35) - (b.object.userData.thing.def.hit?.r ?? 0.35))[0];
  }
  if (catHit && (!best || catHit.distance < best.distance + 0.2)) {
    cat.poke(); pending = null;
    fx.burst(cat.position.clone().setY(cat.top - 0.05), '#ffb3cf', 8, 0.25, { kind: 'hearts' });
    ui.speak(fmt(CONFIG.text.purr[purrN++ % CONFIG.text.purr.length]), cat.position.clone().setY(cat.top + 0.35));
    return 'cat';
  }
  if (best) { goPoke(best.object.userData.thing); return best.object.userData.thing.def.id; }
  // sky things on the balcony: the moon (screen-space) and the stars (anything above the horizon)
  if (apt.roomAt(cat.position) === 'balcony') {
    const mp = apt.sky.moon.getWorldPosition(new THREE.Vector3()).project(camera);
    if (Math.hypot((mp.x + 1) / 2 * W - x, (1 - mp.y) / 2 * H - y) < 70 && thingById.moon) { goPoke(thingById.moon); return 'moon'; }
    if (ray.ray.direction.y > 0.02 && thingById.stars) { goPoke(thingById.stars); return 'stars'; }
  }
  const p = ray.ray.intersectPlane(ground, new THREE.Vector3());
  if (p && p.length() < 40) {
    pending = null;
    cat.moveTo(p);
    fx.ripple(cat.state.path.length ? cat.state.path[cat.state.path.length - 1] : (cat.state.target || p));
    return 'ground';
  }
  return 'nothing';
}
let purrN = 0;

// ---------- input ----------
let camTurn = 0;
createInput(canvas, {
  onTap: tap,
  onOrbit: (a, b) => rig.orbit(a, b),
  onZoom: (f) => rig.zoom(f),
  onAnyInput: () => ui.dismissHint(),
  onKeys: (k) => {
    if (hud.journalOpen || hud.cardOpen) return;
    if (k.poke) {
      let best = null, bd = 1.4;
      for (const t of things) { if (sky.has(t.def.id)) continue; const d = t.pos.clone().setY(0).distanceTo(cat.position.clone().setY(0)); if (d < bd) { bd = d; best = t; } }
      if (best) goPoke(best); else { cat.poke(); ui.speak(fmt(CONFIG.text.purr[purrN++ % CONFIG.text.purr.length]), cat.position.clone().setY(cat.top + 0.35)); }
      return;
    }
    cat.setInput(k.x, k.z); camTurn = k.turn;
    if (k.x || k.z) pending = null;
  },
});
addEventListener('keydown', (e) => { if (e.code === 'KeyJ') hud.journalOpen ? hud.closeJournal() : hud.openJournal(); if (e.code === 'Escape') hud.closeJournal(); });

// ---------- sky event: shooting stars over the balcony ----------
const star = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 16;
  const g = c.getContext('2d'); const grd = g.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.85, 'rgba(255,245,220,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grd; g.beginPath(); g.moveTo(0, 8); g.lineTo(250, 3); g.arc(250, 8, 5, -Math.PI / 2, Math.PI / 2); g.lineTo(0, 8); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.25), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  mesh.visible = false; scene.add(mesh);
  return { mesh, active: false, t: 0, wait: 6, head: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3() };
})();
function updateStar(dt) {
  const onBalcony = apt.roomAt(cat.position) === 'balcony';
  if (!star.active) {
    if (!onBalcony) return;
    star.wait -= dt;
    if (star.wait > 0) return;
    star.active = true; star.t = 0; star.wait = 9 + Math.random() * 6;
    const y = 6 + Math.random() * 3, x0 = 1 + Math.random() * 6;
    star.from.set(x0, y, -20); star.to.set(x0 + 9, y - 2.5, -20);
    star.mesh.visible = true;
  }
  star.t += dt / 1.4;
  star.head.lerpVectors(star.from, star.to, Math.min(1, star.t));
  star.mesh.position.copy(star.head).add(star.from.clone().sub(star.to).setLength(1.9));
  star.mesh.lookAt(camera.position);
  const dir = star.to.clone().sub(star.from).normalize();
  star.mesh.rotation.z = Math.atan2(dir.y, dir.x) * 0.9;
  star.mesh.material.opacity = Math.sin(Math.min(1, star.t) * Math.PI);
  if (star.t >= 1) { star.active = false; star.mesh.visible = false; }
}

// ---------- night / morning ----------
let sleeping = false;
async function askSleep() {
  const n = night().found.length;
  const yes = await hud.askSleep(n);
  if (!yes) { cat.stand(); return; }
  sleeping = true;
  cat.state.purrT = 0;
  fx.burst(cat.position.clone().setY(cat.top), '#cfd8ff', 6, 0.2, { kind: 'zz' });
  hud.dawnOn(true);
  await new Promise((r) => setTimeout(r, 2400));
  const d = S(), ns = d.tonight;
  await hud.morning({
    line: MORNING_LINES[(d.night - 1) % MORNING_LINES.length],
    found: ns.found.map((id) => entryById[id].title),
    pokes: Object.keys(ns.poked).length, glimmers: d.glimmers,
    total: ENTRIES.length, count: Object.keys(d.found).length,
  });
  d.night++; d.stats.nights++;
  d.tonight = freshNight();
  store.flush();
  restoreNightVisuals();
  if (pic) pic.rotation.z = CROOKED;
  apt.placed.dustBunny.visible = false;
  hud.dawnOn(false);
  sleeping = false;
  cat.stand();
  cat.moveTo(new THREE.Vector3(-7.4, 0, 0.6));
  setTimeout(startNight, 900);
}
function startNight() {
  const d = S();
  hud.showNudge(NIGHT_LINES[(d.night - 1) % NIGHT_LINES.length].replace('{n}', d.night), 3.5);
  setTimeout(() => hud.showNudge(nudgeLine(), 6), 3800);
  hud.refresh();
}
function nudgeLine() {
  const d = S();
  if (Object.keys(d.found).length >= ENTRIES.filter((e) => e.id !== 'fish-tv' || d.decorations.includes('fishbowl')).length) return '{name} has found everything. the night is for wandering now.';
  if (d.night === 1) return 'tonight {name} is curious about the living room.';
  const open = ROOMS.filter((r) => ENTRIES.some((e) => e.room === r.id && !d.found[e.id] && (e.id !== 'fish-tv' || d.decorations.includes('fishbowl'))));
  const r = open[(d.night * 7) % open.length];
  return `tonight {name} is curious about ${r.name}.`;
}

// ---------- loop ----------
let last = performance.now(), t = 0, firstFrameMs = null, lastHud = 0, sampler = null, room = apt.roomAt(cat.position), dripT = 0;
const splash = document.getElementById('splash');
const lampFor = { bedroom: apt.lamps.bedLamp.light.position, living: apt.lamps.livingLamp.light.position, kitchen: apt.lamps.sconce.light.position, balcony: new THREE.Vector3(7, 0, -1.2) };
let snapCam = true;

function stats() {
  const r = renderer.info.render;
  return { fps: perf.fps, ms: perf.ms, calls: r.calls, tris: r.triangles, points: r.points, lines: r.lines, pr: ratio, w: W, h: H, gl: 'WebGL 2', stepDowns: perf.stepDowns };
}

function loop(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20); last = now;
  t += dt;
  perf.frame(now);
  if (camTurn) rig.orbit(camTurn * dt * 1.4, 0);
  cat.update(dt, t, rig.az);
  apt.update(t, dt, { catPos: cat.position });
  updateWobbles(dt); updateAnims(dt); updateStar(dt);
  // moving things keep their tap targets with them
  for (const id of moving) { const th = thingById[id]; if (th) { placeProxy(th); th.proxy.visible = id !== 'leaf' || apt.placed.leaf.visible; } }
  // picture drifts crooked again
  if (pic && pic.userData.straightT !== undefined) {
    pic.userData.straightT -= dt;
    const goal = pic.userData.straightT > 0 ? 0 : CROOKED;
    pic.rotation.z += (goal - pic.rotation.z) * (1 - Math.exp(-dt * (goal ? 0.8 : 8)));
  }
  // kitchen tap drips
  if (night().drip && apt.roomAt(cat.position) === 'kitchen') {
    dripT -= dt;
    if (dripT <= 0) { dripT = 0.9; const a = apt.placed.counter.getObjectByName('anchor_drip'); if (a) fx.burst(a.getWorldPosition(tmpV), '#bfe0ff', 1, 0.0, { kind: 'drops', scale: 0.6 }); }
  }
  // sit secrets: stay still near the thing
  for (const th of things) {
    const sec = th.def.secret;
    if (!sec?.sit || S().found[sec.entry]) continue;
    const near = th.pos.clone().setY(0).distanceTo(cat.position.clone().setY(0)) < 1.0 && !cat.moving && !cat.busy;
    if (near && requiresMet(sec.requires)) {
      th.sitT += dt;
      if (Math.floor(th.sitT / 0.7) !== Math.floor((th.sitT - dt) / 0.7)) fx.burst(cat.position.clone().setY(cat.top), '#ffb3cf', 2, 0.15, { kind: 'hearts', scale: 0.7 });
      if (th.sitT >= sec.sit) discover(sec.entry, cat.position.clone().setY(cat.top + 0.1));
    } else th.sitT = 0;
  }
  // room changes: hand the camera over, move the dust motes, name new places
  const r = apt.roomAt(cat.position);
  if (r !== room) {
    room = r;
    fx.setMotes(lampFor[r], r === 'balcony' ? [3, 2] : [4.5, 3.2]);
    const name = ROOMS.find((x) => x.id === r)?.name;
    if (!S().places[r]) { S().places[r] = true; changed(); hud.showPlace(`somewhere new: ${name}.`); } else hud.showPlace(name, 2.2);
  }
  rig.updateRoom(dt, cat.position, cat.velocity, apt.cameraFor(r), { snap: snapCam });
  snapCam = false;
  fx.update(dt, t);
  renderer.render(scene, camera);
  ui.update(dt, camera, W, H);
  if (sampler) sampler.push(dt, renderer.info.render);
  if (firstFrameMs === null) { firstFrameMs = Math.round(performance.now()); requestAnimationFrame(() => splash.classList.add('gone')); }
  if (now - lastHud > 500) { lastHud = now; ui.showPerf(stats()); }
}

let running = false;
function start() { if (running) return; running = true; last = performance.now(); perf.reset(); renderer.setAnimationLoop(loop); }
function stop() { running = false; renderer.setAnimationLoop(null); store.flush(); }
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
addEventListener('pagehide', stop);
addEventListener('pageshow', () => { if (!document.hidden) start(); });
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
canvas.addEventListener('webglcontextrestored', () => { renderer.shadowMap.needsUpdate = true; start(); });
catReady.then(() => { renderer.shadowMap.needsUpdate = true; });
if (!document.hidden) start();
S().places[room] = true;
setTimeout(startNight, 1200);

// ---------- debug API (used by the tests; harmless in play) ----------
const teleport = (x, z) => { cat.rig.position.set(x, 0, z); cat.state.target = null; cat.state.path = []; cat.state.vel.set(0, 0, 0); snapCam = true; };
window.__ghost = {
  get ready() { return firstFrameMs !== null; },
  info: () => ({ ...stats(), firstFrameMs, glb: cat.state.modelLoaded, cat: [+cat.position.x.toFixed(2), +cat.position.z.toFixed(2)], room, running, programs: renderer.info.programs?.length, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
  state: () => {
    const d = S();
    return {
      night: d.night, glimmers: d.glimmers, found: Object.keys(d.found), foundCount: Object.keys(d.found).length, entries: ENTRIES.length,
      tonight: JSON.parse(JSON.stringify(d.tonight)), room, cat: { pos: [+cat.position.x.toFixed(2), +cat.position.y.toFixed(2), +cat.position.z.toFixed(2)], seated: cat.state.seated, moving: cat.moving, busy: cat.busy, morph: { ...cat.state.w } },
      things: things.map((x) => x.def.id), places: Object.keys(d.places), journalOpen: hud.journalOpen, cardOpen: hud.cardOpen, saveOk: store.ok, sleeping,
    };
  },
  sample: (seconds = 10) => new Promise((resolve) => {
    const dts = [], calls = [], tris = [];
    const t0 = performance.now();
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
  tap,
  // walk over and poke (like a tap on the thing), or poke right now (tests)
  tapThing: (id) => { const th = thingById[id]; if (!th) return false; goPoke(th); return true; },
  pokeNow: (id) => { const th = thingById[id]; if (!th) return false; poke(th); return true; },
  thingScreen: (id) => { const th = thingById[id]; if (!th) return null; const v = th.proxy.getWorldPosition(new THREE.Vector3()).project(camera); return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H]; },
  teleport, goRoom: (id) => { const r = apt.rooms[id]; teleport((r.x0 + r.x1) / 2, id === 'balcony' ? -0.9 : 0.6); },
  moveTo: (x, z) => cat.moveTo(new THREE.Vector3(x, 0, z)),
  project: (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera); return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H]; },
  orbit: (a, b) => rig.orbit(a, b), zoom: (f) => rig.zoom(f), setRatio: (r) => { ratio = Math.min(r, DPR_CAP); resize(); },
  sleepNow: () => askSleep(), store, renderer, scene, camera, cat, apt, rig, star,
};
