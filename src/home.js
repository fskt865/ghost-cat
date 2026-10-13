// Ghost's home (Revision 4 "small and cozy", Revision 5 "Ghost wanders, you tap"): the apartment, the fire escape,
// the roof, the street, the shop, the alley and the park as one little world. Touching things reacts on its own;
// staying still sits, then loafs on warm spots; the bed ends the night. Title screen first.
// Two input sources drive the same physics body: the wanderer (src/stroll.js, the default: Ghost walks the waypoint
// graphs alone, the player taps things, the ground or Ghost) and, at ?platformer, Revision 4's stick and hop
// button (src/controls.js). Everything else (the world, reactions, secrets, camera zones) is shared.
// Debug API on window.__ghost (state(), teleport, drive, thing positions, stroll, pickAt...).
import * as THREE from 'three';
import { CONFIG, fmt } from './config.js';
import { TUNING as T } from './tuning.js';
import { applyConfigToPage } from './icon.js';
import { buildApartment } from './apartment.js';
import { buildOutside } from './home-outside.js';
import { buildTown, TOWN_AREAS } from './town.js';
import { createBody, CollisionWorld } from './physics.js';
import { createGhostLook } from './ghost-look.js';
import { createControls } from './controls.js';
import { createFollowCamera } from './follow-camera.js';
import { createFx } from './fx.js';
import { createUI } from './ui.js';
import { createPerf, fitRatio } from './perf.js';
import { createSettings } from './settings.js';
import { createHud } from './hud.js';
import { createStore, freshNight } from './save.js';
import { NIGHT_LINES, MORNING_LINES, ENTRY_GLIMMERS } from './things.js';
import { HOME_THINGS, HOME_ENTRIES, HOME_ROOMS, SECRET_RULES, LINE_THINGS } from './home-things.js';
import { LINES } from './lines.js';
import { createAudio } from './audio/audio.js';
import { createStroll, loadPaths } from './stroll.js';
const THINGS = HOME_THINGS, ENTRIES = HOME_ENTRIES, ROOMS = HOME_ROOMS;
import { glowTexture } from './util.js';

const params = new URLSearchParams(location.search);
// the input source: Ghost wanders and the player taps (the game), or Revision 4's stick and hop button (?platformer)
const PLATFORMER = params.has('platformer');
const pathsReady = PLATFORMER ? null : loadPaths(); // the waypoint graphs, fetched while the world builds
applyConfigToPage();
const splashText = document.getElementById('splash-text');
document.getElementById('splash-title').textContent = fmt(CONFIG.gameTitle);
splashText.textContent = fmt(CONFIG.text.loading);

// ---------- renderer ----------
const canvas = document.getElementById('c');
if (!document.createElement('canvas').getContext('webgl2')) {
  splashText.textContent = fmt('{name} needs a newer Safari (or any browser from the last few years) to wake up. Updating the phone should do it.');
  throw new Error('no WebGL 2');
}
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('shot') });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
const DPR_CAP = 2, deviceRatio = Math.min(window.devicePixelRatio || 1, DPR_CAP);
let ratio = params.has('dpr') ? Math.min(parseFloat(params.get('dpr')) || 1, DPR_CAP) : deviceRatio;
let wantRatio = ratio; // ratio = this, held to a render budget by screen area (src/perf.js fitRatio; ?dpr= is taken as is)
renderer.setPixelRatio(ratio);
for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => { if (!e.target.closest || !e.target.closest('.scroll')) e.preventDefault(); }, { passive: false });

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(T.camFov, innerWidth / innerHeight, 0.05, 220);
const store = createStore();
if (params.has('fresh')) store.reset();
const S = () => store.data;
const hud = createHud(); hud.bind(store, { entries: ENTRIES, rooms: ROOMS });
const audio = createAudio({ musicLean: CONFIG.musicLean, startArea: 'apartment' });
// on the window, capturing: runs before any control sees the touch (and before anything could preventDefault it)
for (const ev of ['touchstart', 'pointerdown', 'keydown', 'touchend', 'pointerup', 'click']) addEventListener(ev, () => audio.unlock(), { capture: true, passive: true });
const ui = createUI();
const perf = createPerf({ getRatio: () => ratio, setRatio: (r) => { wantRatio = r; resize(); }, floor: Math.min(1, deviceRatio) });

const apt = await buildApartment(scene, { platform: true, deferCollision: true });
const fx = createFx(scene, { moteCentre: new THREE.Vector3(-7.5, 0, -1), moteSpread: [4.5, 3.2] });
// out of the living-room window: the fire escape and the roof, joined on (src/home-outside.js), then one collision world
const outside = await buildOutside(scene, apt, { world: apt.collisionWorld, fx });
// the camera only needs to stay above the floor indoors (it lives on the open side of the dollhouse); down on the street
// it also keeps out of the buildings behind the shop fronts and inside the corner shop's walls
const camWorld = new CollisionWorld(); camWorld.addBox(0, -0.4, 0, 60, 0.4, 40); camWorld.addBox(-2.2, -3.65, 28, 70, 0.4, 70);
// down the front: the street, the corner shop, the alley and the park (src/town.js), all in the same world
const town = await buildTown(scene, apt, outside, { world: apt.collisionWorld, fx, camWorld });
camWorld.build();
town.bind({ audio });
apt.collision = apt.collisionWorld.build();
const BED = new THREE.Vector3(-7.85, 0.56, -1.25);
const body = createBody(apt.collision, BED.clone());
const look = createGhostLook(scene, apt.collision);
const lookReady = look.loadModel();
const controls = PLATFORMER ? createControls() : null;
const settings = createSettings({ audio, store, onRestart: () => restartNight() });
const cam = createFollowCamera(camera, camWorld);
const R = (id) => apt.rooms[id];
const zone = (x0, x1, z0, z1, o) => ({ min: new THREE.Vector3(x0, -1, z0), max: new THREE.Vector3(x1, 3.2, z1), priority: 1, ...o,
  // the wanderer's camera sits further back: indoors it looks straight into the dollhouse (a wide swing would put the
  // room dividers between it and Ghost)
  ...(PLATFORMER || !o.yawRange ? {} : { yawRange: o.yawRange.map((v) => v * T.strollIndoorYaw) }) });
cam.setZones([
  zone(R('bedroom').x0, R('bedroom').x1, -3, 3, { zoom: 0.95, pitch: 0.36, aim: 0.15, yawRange: [-0.55, 0.55] }),
  zone(R('living').x0, R('living').x1, -2.5, 3, { zoom: 0.95, pitch: 0.36, aim: 0.15, yawRange: [-0.55, 0.55] }),
  zone(R('kitchen').x0, R('kitchen').x1, -3, 3, { zoom: 0.95, pitch: 0.36, aim: 0.15, yawRange: [-0.55, 0.55] }),
  zone(R('balcony').x0, R('balcony').x1, -3, 1, { zoom: 1.1, pitch: 0.3, aim: 0.25, yawRange: [-0.8, 0.8] }),
  ...outside.zones, // the fire escape (seen from outside), the stair, the top landing, the open roof: assets/layouts/*.json
  ...town.zones,    // the front fire escape, the street, the alley, the corner shop, the park (src/town.js)
]);
cam.snap(BED, 0);
apt.applyNight(S().tonight);
renderer.shadowMap.needsUpdate = true;
// every material, so walking out of the window or down to the street never hitches on a shader: once with the
// living lamp's shadow (indoors) and once without (outdoors, where it is switched off), town included. Started just
// after the first frame, behind the title screen, in parallel where the browser can: up front it held the title ~0.8 s
const livingShadow = apt.lamps.livingLamp.light;
const compileAll = () => { const on = livingShadow.castShadow; livingShadow.castShadow = true; renderer.compileAsync(scene, camera); livingShadow.castShadow = false; renderer.compileAsync(scene, camera); livingShadow.castShadow = on; };
town.setView('home');

let W = innerWidth, H = innerHeight;
// the size to draw at: the visual viewport where there is one (iOS toolbars, rotation), else the window
function viewSize() {
  const vv = window.visualViewport;
  if (vv && vv.width > 0 && vv.height > 0 && Math.abs((vv.scale || 1) - 1) < 0.01) return [Math.round(vv.width), Math.round(vv.height)];
  return [innerWidth, innerHeight];
}
function resize() {
  [W, H] = viewSize(); ratio = params.has('dpr') ? wantRatio : fitRatio(wantRatio, W, H);
  renderer.setPixelRatio(ratio); renderer.setSize(W, H);
  cam.resize(W / H); fx.resize(H * ratio, camera.fov);
  apt.setStarScale(ratio); look.setViewport(W * ratio, H * ratio, ratio);
  perf.reset(); // a rotation or a toolbar costs a frame or two; that is not a slow GPU (no pixel-ratio step-down for it)
}
resize();
addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));

// ---------- text ----------
const lineList = (id) => LINE_THINGS[id]?.lines || ['...'];

// ---------- things: touch them and they react ----------
const tmpB = new THREE.Box3(), tmpV = new THREE.Vector3();
const SKIP = new Set(['stars', 'moon']); // sky things belong to the sitting-on-the-balcony moment
const things = [];
for (const base of THINGS) {
  if (SKIP.has(base.id)) continue;
  const obj = apt.placed[base.at];
  if (!obj) continue; // its prop is not in this home (yet)
  const rule = Object.entries(SECRET_RULES).find(([, r]) => r.thing === base.id);
  const def = { ...base, room: LINE_THINGS[base.id]?.area || 'living', secret: rule ? { entry: rule[0], ...rule[1] } : null };
  if (base.town) { def.trigger = town.triggerFor(base.id, base.town); if (!def.trigger) { console.warn('[home] no touch spot for', base.id); continue; } }
  const node = (def.node && obj.getObjectByName(def.node)) || obj;
  things.push({ def, obj, node, inside: false, lastT: -9, sitT: 0, line: 0 });
}
const thingById = Object.fromEntries(things.map((t) => [t.def.id, t]));
// triggers that sit somewhere other than the object itself
function placeTrigger(t) {
  const hit = t.def.hit || { r: 0.3, h: 0.5 };
  if (t.def.trigger) { const [x, y, z, r, h] = t.def.trigger; t.pos = new THREE.Vector3(x, y, z); t.top = y + h; t.r = r; t.y0 = y; t.y1 = y + h; return; }
  t.node.updateWorldMatrix(true, true);
  tmpB.makeEmpty();
  t.node.traverse((o) => { if (o.isMesh) tmpB.expandByObject(o); });
  if (tmpB.isEmpty()) { const p = t.node.getWorldPosition(tmpV); tmpB.set(p.clone(), p.clone()); }
  const c = tmpB.getCenter(tmpV);
  t.pos = new THREE.Vector3(c.x, tmpB.min.y, c.z); t.top = tmpB.max.y;
  t.r = Math.max(0.16, Math.min(hit.r, 0.6));
  t.y0 = tmpB.min.y + (hit.y || 0) - 0.05; t.y1 = Math.max(t.y0 + hit.h, tmpB.max.y + 0.1);
}
for (const t of things) placeTrigger(t);
const moving = ['moth', 'leaf', 'snail'].map((id) => thingById[id]).filter(Boolean);
const SOFT = new Set(THINGS.filter((d) => d.reaction === 'soft').map((d) => d.id).concat(['blanket', 'cushion']));

const night = () => S().tonight;
const changed = () => { store.changed(); hud.refresh(); };
const late = () => (PLATFORMER ? nightT > T.nightMinutes * 60 * (2 / 3) : nightT > T.strollLateAfter || night().found.length >= T.strollLateFinds);
const requiresMet = (req) => {
  if (!req) return true;
  if (req.toggle) return night()[req.toggle[0]] === req.toggle[1];
  if (req.found) return !!S().found[req.found];
  if (req.decoration) return S().decorations.includes(req.decoration);
  return true;
};
const entryById = Object.fromEntries(ENTRIES.map((e) => [e.id, e]));
const entryText = (e) => ({ title: e.title, note: e.note });

function discover(entryId, at) {
  if (S().found[entryId] || !entryById[entryId]) return false;
  const e = entryById[entryId];
  S().found[entryId] = S().night;
  night().found.push(entryId);
  S().glimmers += e.glimmers || ENTRY_GLIMMERS;
  changed(); hud.bumpGlimmers(); hud.showToast({ ...e, ...entryText(e) });
  const p = at || body.pos.clone().setY(body.pos.y + 0.5);
  fx.burst(p, '#ffd98a', 26, 0.5);
  setTimeout(() => fx.burst(p, '#fff4c8', 14, 0.35, { scale: 0.7 }), 250);
  look.happy(1.6);
  if (night().found.length === 4) setTimeout(() => hud.showNudge(hud.word('yawn')), 5000);
  if (entryId === 'stash') apt.placed.stash.visible = true;
  if (entryId === 'the-recording') audio.micPurr({ squeal: false });
  townFound(entryId, p);
  audio.play('glimmer');
  return true;
}

// wobble + tween helpers
const wobbling = new Map();
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
    if (w.batched ??= outside.batched(node)) outside.sync(node); // outdoor props drawn by a BatchedMesh
  }
}
const anims = [];
const animate = (dur, fn, done) => anims.push({ t: 0, dur, fn, done });
function updateAnims(dt) { for (let i = anims.length - 1; i >= 0; i--) { const a = anims[i]; a.t += dt; const k = Math.min(1, a.t / a.dur); a.fn(k); if (k >= 1) { anims.splice(i, 1); a.done?.(); } } }

// lines go through a short queue: each stays up at least T.lineMin seconds, the same words never twice in a row or twice
// in the queue, and at most three wait (when Ghost touches several things at once the latest few are said, in order)
const sayQ = []; let sayUntil = 0, sayLast = '', sayLastT = -99;
function speakAt(text, x, y, z) {
  const s = fmt(text);
  if (sayQ.some((q) => q.text === s) || (s === sayLast && t - sayLastT < 6)) return;
  sayQ.push({ text: s, at: new THREE.Vector3(x, y, z) });
  while (sayQ.length > 3) sayQ.shift();
  pumpSay();
}
function pumpSay() {
  if (!sayQ.length || t < sayUntil) return;
  const q = sayQ.shift();
  ui.speak(q.text, q.at); sayLast = q.text; sayLastT = t; sayUntil = t + T.lineMin;
}
// each thing speaks at most once every T.lineThingGap seconds, and never the same line twice in a row in a night
const thingSaid = new Map(), nowT = () => t;
// the first touch ever gets the 'first' line; after that the lines rotate (count things: by count)
function nextLine(t, taps) {
  const L = LINE_THINGS[t.def.id] || {}, id = t.def.id;
  if (L.first && !S().firsts[id]) { S().firsts[id] = true; return L.first; }
  if (L.done && t.def.secret && S().found[t.def.secret.entry]) return L.done; // its secret found: the after line
  const lines = L.lines || ['...'];
  if (L.order === 'count') return lines[Math.min(taps, lines.length) - 1];
  const n = night().lines[id] || 0;
  night().lines[id] = n + 1;
  return lines[n % lines.length];
}

// Ghost touched it: the reaction
function poke(t) {
  const d = t.def, ns = night();
  ns.taps[d.id] = (ns.taps[d.id] || 0) + 1;
  S().stats.pokes++;
  if (!ns.poked[d.id]) { ns.poked[d.id] = true; S().glimmers += d.glimmer ?? 1; hud.bumpGlimmers(); }
  const taps = ns.taps[d.id];
  const anchor = new THREE.Vector3(t.pos.x, t.top + 0.05, t.pos.z);
  look.kick(d.act === 'bat' ? 0.1 : 0.06);
  if (d.act === 'purr' || SOFT.has(d.id)) look.happy(1.0);
  let line = null;
  if (d.reaction === 'toggle') {
    ns[d.toggle] = !ns[d.toggle];
    apt.applyNight(ns);
    line = LINE_THINGS[d.id]?.[ns[d.toggle] ? 'on' : 'off'] || null;
    wobble(t.node, 0.08);
    if (d.toggle === 'livingLamp' || d.toggle === 'bedLamp') fx.burst(anchor, '#ffd27a', ns[d.toggle] ? 14 : 5, 0.3);
  } else if (d.reaction !== 'sleep') wobble(t.node, d.reaction === 'sit' ? 0.05 : 0.12);
  if (d.act === 'water') fx.burst(anchor.clone().setY(t.top + 0.35), '#9fc4ff', 12, 0.25, { kind: 'drops' });
  else fx.burst(anchor, d.room === 'balcony' ? '#d8f0ff' : '#ffe2a0', 9, 0.3, { scale: 0.6 });
  special.line = null;
  special(t, taps);
  if (line === null) line = special.line ?? nextLine(t, taps);
  audio.play(d.act === 'bat' ? 'tap' : 'poke');
  customOnPoke(t, taps);
  const said = thingSaid.get(d.id);
  if (line && !(said && (said.line === line || nowT() - said.t < T.lineThingGap))) { thingSaid.set(d.id, { line, t: nowT() }); speakAt(line, t.pos.x, Math.max(t.top, body.pos.y + T.height) + 0.3, t.pos.z); }
  const sec = d.secret;
  if (sec && (sec.once || (sec.taps && taps >= sec.taps))) discover(sec.entry, anchor.clone().setY(t.top + 0.2));
  changed();
}

function special(t, taps) {
  const d = t.def, ns = night(), A = apt.placed;
  switch (d.special) {
    case 'blanket': if (taps >= 3) { ns.knocked.blanket = true; setBlanket(true); look.happy(1.5); } break;
    case 'hairTie':
      if (ns.knocked.hairtie) break;
      ns.knocked.hairtie = true; S().flags.hairTie = true;
      { const o = A.hairTie, from = o.position.clone(), to = new THREE.Vector3(-6.4, 0.01, 0.4);
        animate(0.9, (k) => { o.position.lerpVectors(from, to, k); o.position.y = from.y * (1 - k) + Math.sin(k * Math.PI) * 0.6; o.rotation.x = k * 9; }, () => { o.visible = false; }); }
     
      break;
    case 'shelfMug':
      if (ns.knocked.shelf) break;
      ns.knocked.shelf = true; knockShelfMug(true);
      break;
    case 'picture': { const p = t.node; p.userData.straightT = 4; break; }
    case 'books': wobble(A.bookshelf.getObjectByName('book_wobble'), 0.3); break;
    case 'slippers': {
      const o = A.slippers, sc = !o.userData.scattered; o.userData.scattered = sc;
      const r0 = o.rotation.y, r1 = sc ? 1.3 : 0.35;
      animate(0.4, (k) => { o.rotation.y = r0 + (r1 - r0) * k; });
     
      break;
    }
    case 'dustBunny': { const b = A.dustBunny; b.visible = true; animate(1.6, (k) => { b.position.y = Math.abs(Math.sin(k * Math.PI * 4)) * 0.08 * (1 - k); b.position.z = -0.35 + k * 0.25; }); break; }
    case 'stash': if (S().flags.hairTie) A.stash.visible = true; break;
    case 'mugEdge': {
      if (ns.mugEdge >= 3) break;
      ns.mugEdge = Math.min(3, ns.mugEdge + 1); setMugEdge(ns.mugEdge, true);
     
      break;
    }
    case 'fridge': if (taps >= 3) openFridge(); break;
    case 'coin': wobble(t.node, 0.2); if (taps >= 3 && !S().found['couch-money']) popCoin(t); break;
    case 'tomatoes': { const tom = A.tomatoes.userData.tomatoes[(taps - 1) % 3]; if (tom) { wobble(tom, 0.35); fx.burst(tom.getWorldPosition(new THREE.Vector3()), '#ffb0a0', 8, 0.1, { scale: 0.6 }); } break; }
    case 'blink':
      if (taps >= 3) {
        const face = A.neighbourCat.userData.face;
        if (face) { const i = face.morphTargetDictionary.blink; animate(1.6, (k) => { face.morphTargetInfluences[i] = Math.sin(k * Math.PI); }); }
        const h = A.neighbourCat.getObjectByName('heart'); h.visible = true;
        animate(3.5, (k) => { h.position.y = 0.46 + k * 0.25; h.scale.setScalar(Math.min(1, k * 6) * (1 - Math.max(0, k - 0.8) * 5)); }, () => { h.visible = false; });
      } else wobble(A.neighbourCat, 0.05);
      break;
    case 'wink': if (taps >= 3 && night().curtains) { apt.setWink(true); setTimeout(() => apt.setWink(false), 3200); } break;
    case 'rings': {
      const k = Math.min(taps, 5), ring = A.ringsDish?.getObjectByName('ring_' + k);
      ns.knocked['ring' + k] = true;
      if (ring && ring.visible) dropRing(ring, true);
     
      break;
    }
    case 'record': recordBoost = 2.5; fx.burst(t.pos.clone().setY(t.top + 0.25), '#ffe8b0', 6, 0.25, { kind: 'hearts', scale: 0.6 }); break;
    case 'coffee': for (let i = 0; i < 3; i++) setTimeout(() => steamAt(A.coffeeMaker, 0.42, 3), i * 200); break;
    // ---- the fire escape and the roof
    case 'herbs': fx.burst(t.pos.clone().setY(t.top + 0.1), '#b8f0a0', 8, 0.25, { scale: 0.6 }); break;
    case 'petals': fx.burst(t.pos.clone().setY(t.top + 0.1), '#ff7a7a', 7, 0.3, { kind: 'drops', scale: 0.7 }); break;
    case 'pinwheel': outside.react.pinwheel(taps); break;
    case 'pigeon': if (taps >= 3) { outside.react.pigeonPuff(); fx.burst(t.pos.clone().setY(t.top + 0.15), '#e8e4f4', 10, 0.25, { scale: 0.7 }); } break;
    case 'socks': if (taps >= 3) outside.react.dropSock(look); else outside.react.sockLoose(taps); break;
    case 'chimney':
      for (let i = 0; i < 2 + Math.min(taps, 3); i++) setTimeout(() => outside.chimneyTop && fx.burst(outside.chimneyTop, '#efe9ff', 2, 0.12, { kind: 'steam' }), i * 160);
      if (taps >= 3 && !outside.react.ring.active) setTimeout(() => outside.react.startRing(), 700);
      break;
    case 'puddle': outside.react.ripple(); break;
    case 'bulbs': wobble(A.stringLights, 0.06); break;
    default: if (d.town) town.special(d.special, t, taps, { audio, body, look });
  }
  if (d.reaction === 'chase') {
    if (d.id === 'moth') { apt.mothState.chased = 1.6; if (night().livingLamp && S().found['moths-dance']) apt.mothState.dance = 3; }
    if (d.id === 'leaf') { const st = apt.placed.leaf.userData.state; if (st.active) { st.active = false; apt.placed.leaf.visible = false; st.t = 5; fx.burst(apt.placed.leaf.position, '#ffd27a', 12, 0.2); } }
  }
}

// ---- the custom secrets that hang on a touch
function customOnPoke(t, taps) {
  const id = t.def.id, ns = night(), at = new THREE.Vector3(t.pos.x, t.top + 0.2, t.pos.z);
  if (id === 'posterB' && !ns.bedLamp) discover('glow-moon', at);
  if (id === 'record' && (ns.taps.recordCrate || 0) >= 3) discover('b-side', at);
  if (id === 'stash' && S().flags.hairTie) discover('stash', at);
  if (id === 'mic') { look.happy(1.0); audio.micPurr({ squeal: Math.random() < 0.3 }); }
  // the food tour: the burger stand, the ramen window and the grill, any order, one night
  if (['burgerStand', 'ramenWindow', 'medGrill'].includes(id) && ['burgerStand', 'ramenWindow', 'medGrill'].every((k) => ns.taps[k])) discover('food-tour', at);
}

// ---- down on the street: what the town's secrets do when found, the sits that are spots, the drain's song
const catLine = (id, at) => { const c = LINES.cats.find((x) => x.id === id); if (c) speakAt(c.lines[(S().night + night().found.length) % c.lines.length], at.x, at.y + 0.5, at.z); };
function townFound(id, at) {
  if (id === 'moths-into-stars') town.mothsToStars();
  if (id === 'shopkeeper') { town.calicoEye(); setTimeout(() => catLine('calico', thingById.keeper.pos.clone().setY(thingById.keeper.top)), 1600); }
  if (id === 'follower') { town.startFollow(body); setTimeout(() => catLine('greyKitten', body.pos.clone().setY(body.pos.y + T.height)), 1800); }
  if (id === 'firefly') town.landFly(body);
  if (id === 'tabby-nook') setTimeout(() => catLine('tabby', thingById.tabby.pos.clone().setY(thingById.tabby.top)), 1600);
  if (id === 'singing-drain') [0, 2, 4, 7].forEach((k, i) => setTimeout(() => audio.playKey(k, 0.6), 300 + i * 260));
  if (id === 'dumpster-echo') {}
}
const SPOT_SITS = Object.entries(SECRET_RULES).filter(([, r]) => r.spot).map(([entry, r]) => ({ entry, ...r, pos: town.spotPos(r.spot), t: 0 }));
function updateTownSits(dt, p, still) {
  for (const s of SPOT_SITS) {
    if (!s.pos || S().found[s.entry]) continue;
    const on = Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < s.r && Math.abs(p.y - s.pos.y) < s.dy;
    if (on && still) {
      s.t += dt;
      if (Math.floor(s.t / 0.7) !== Math.floor((s.t - dt) / 0.7)) fx.burst(p.clone().setY(p.y + T.height + 0.05), '#ffb3cf', 2, 0.12, { kind: 'hearts', scale: 0.6 });
      if (s.hiss) {
        // the little table: sat there long enough, the machine hisses (the sit sets it off, not the 20 s clock); the
        // hiss while sitting is the moment
        if (s.t >= s.sit) {
          if (performance.now() / 1000 - town.espresso.hissT > 1.5) town.hiss(audio);
          discover(s.entry, p.clone().setY(p.y + T.height + 0.1));
        }
      } else if (s.t >= s.sit) discover(s.entry, p.clone().setY(p.y + T.height + 0.1));
    } else s.t = 0;
  }
}

// ---- the MIDI keyboard: every key under Ghost plays; walking it end to end is a secret
const KEY_NAMES = ['c4', 'd4', 'e4', 'f4', 'g4', 'a4', 'b4', 'c5', 'd5', 'e5', 'f5', 'g5', 'a5', 'b5', 'c6'];
const keyNodes = apt.placed.midiKeys ? KEY_NAMES.map((n) => apt.placed.midiKeys.getObjectByName('key_' + n)).filter(Boolean) : [];
const keyWorld = keyNodes.map((k) => { k.updateWorldMatrix(true, false); return k.getWorldPosition(new THREE.Vector3()); });
const keyRun = { pressed: new Set(), on: false };
let keyDown = -1;
function updateKeys(dt) {
  if (!keyNodes.length) return;
  const p = body.pos, deckY = keyWorld[0].y;
  const onKeys = body.S.grounded && Math.abs(p.y - deckY) < 0.12 && Math.abs(p.z - keyWorld[7].z) < 0.12 && p.x > keyWorld[0].x - 0.06 && p.x < keyWorld[keyWorld.length - 1].x + 0.06;
  let idx = -1;
  if (onKeys) { let bd = 9; keyWorld.forEach((k, i) => { const d = Math.abs(p.x - k.x); if (d < bd) { bd = d; idx = i; } }); }
  if (idx !== keyDown) {
    if (keyDown >= 0) keyNodes[keyDown].position.y += 0.006;
    if (idx >= 0) { keyNodes[idx].position.y -= 0.006; audio.playKey(idx, 0.7); fx.burst(keyWorld[idx].clone().setY(deckY + 0.08), '#ffe2a0', 2, 0.03, { scale: 0.4 }); }
    keyDown = idx;
  }
  if (onKeys) { keyRun.on = true; keyRun.pressed.add(idx); if (keyRun.pressed.has(0) && keyRun.pressed.has(keyNodes.length - 1)) discover('the-composition', p.clone().setY(p.y + 0.5)); }
  else if (keyRun.on) { keyRun.on = false; keyRun.pressed.clear(); }
}

// ---- night-long visual states
function setBlanket(on) {
  const b = apt.placed.bed.getObjectByName('blanket'); if (!b) return;
  if (!b.userData.s0) b.userData.s0 = b.scale.clone();
  const sy = on ? 1.8 : 1;
  const w = wobbling.get(b); if (w) w.base.s.copy(b.userData.s0).multiply(new THREE.Vector3(1, sy, 1));
  b.scale.copy(b.userData.s0).multiply(new THREE.Vector3(1, sy, 1));
}
function knockShelfMug(animated) {
  const m = apt.placed.bookshelf.getObjectByName('shelf_mug'); if (!m) return;
  if (!m.userData.p0) { m.userData.p0 = m.position.clone(); m.userData.r0 = m.rotation.clone(); }
  const from = m.userData.p0.clone(), to = from.clone().add(new THREE.Vector3(0.05, -from.y, 0.45));
  const set = (k) => { m.position.lerpVectors(from, to, k); m.position.y = from.y * (1 - k * k); m.rotation.x = k * 1.57; m.rotation.z = k * 0.6; };
  if (animated) animate(0.55, set); else set(1);
}
function resetShelfMug() { const m = apt.placed.bookshelf.getObjectByName('shelf_mug'); if (m?.userData.p0) { m.position.copy(m.userData.p0); m.rotation.copy(m.userData.r0); } }
function setMugEdge(n, animated) {
  const m = apt.placed.counter.getObjectByName('mug'); if (!m) return;
  if (!m.userData.p0) m.userData.p0 = m.position.clone();
  const goal = m.userData.p0.z + n * 0.075;
  if (animated) { const z0 = m.position.z; animate(0.35, (k) => { m.position.z = z0 + (goal - z0) * k; }); } else m.position.z = goal;
}
function dropRing(ring, animated) {
  if (!ring.userData.p0) { ring.userData.p0 = ring.position.clone(); ring.userData.r0 = ring.rotation.clone(); }
  const dish = apt.placed.ringsDish;
  const fromW = ring.getWorldPosition(new THREE.Vector3());
  const toW = fromW.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.5, 0, 0.35 + Math.random() * 0.3)); toW.y = 0.01;
  const from = dish.worldToLocal(fromW.clone()), to = dish.worldToLocal(toW.clone());
  const set = (k) => { ring.position.lerpVectors(from, to, k); ring.position.y = from.y + (to.y - from.y) * k * k + Math.sin(k * Math.PI) * 0.25; ring.rotation.x = k * 7; };
  if (animated) animate(0.7, set, () => fx.burst(toW, '#e8eeff', 5, 0.08, { scale: 0.5 })); else set(1);
}
function resetRings() { for (let i = 1; i <= 5; i++) { const r = apt.placed.ringsDish?.getObjectByName('ring_' + i); if (r?.userData.p0) { r.position.copy(r.userData.p0); r.rotation.copy(r.userData.r0); } } }
const fridgeLight = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#dff4ff', opacity: 0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
fridgeLight.scale.setScalar(1.8); scene.add(fridgeLight);
function openFridge() {
  const door = apt.placed.fridge.getObjectByName('door'); if (!door) return;
  fridgeLight.position.copy(apt.placed.fridge.localToWorld(new THREE.Vector3(0, 0.9, 0.5)));
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
  resetRings();
  for (let i = 1; i <= 5; i++) { const r = apt.placed.ringsDish?.getObjectByName('ring_' + i); if (r && ns.knocked['ring' + i]) dropRing(r, false); }
}
restoreNightVisuals();
const pic = apt.placed.picture.getObjectByName('picture');
const CROOKED = 0.13;
if (pic) pic.rotation.z = CROOKED;

// ---------- the little life of the place ----------
let recordBoost = 0, steamT = 0, coffeeT = 0;
const platter = apt.placed.turntable?.getObjectByName('platter');
const curtains = ['bedWindow', 'livingWindow', 'kitchenWindow'].flatMap((k) => ['curtain_L', 'curtain_R'].map((n) => apt.placed[k]?.getObjectByName(n))).filter(Boolean);
function steamAt(obj, h, n = 1) { if (!obj) return; const p = obj.localToWorld(new THREE.Vector3(0, h, 0)); fx.burst(p, '#f4f0ff', n, 0.03, { kind: 'steam' }); }
function ambient(t, dt) {
  if (platter) platter.rotation.y += dt * (3.46 + recordBoost * 4);
  recordBoost = Math.max(0, recordBoost - dt);
  for (let i = 0; i < curtains.length; i++) curtains[i].rotation.x = Math.sin(t * 0.55 + i * 1.7) * 0.03 + Math.sin(t * 1.3 + i) * 0.012;
  steamT -= dt; coffeeT -= dt;
  if (steamT <= 0) { steamT = 0.45; steamAt(apt.placed.mugBlack, 0.1); }
  if (coffeeT <= 0) { coffeeT = 0.35; steamAt(apt.placed.coffeeMaker, 0.4); }
  // the fridge hums: the faintest shiver
  const f = apt.placed.fridge; if (f) f.position.x = 4.72 + Math.sin(t * 47) * 0.0008;
}

// ---------- the shooting star over the balcony (seen when Ghost sits out there) ----------
const star = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 16;
  const g = c.getContext('2d'); const grd = g.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.85, 'rgba(255,245,220,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,1)');
  g.fillStyle = grd; g.beginPath(); g.moveTo(0, 8); g.lineTo(250, 3); g.arc(250, 8, 5, -Math.PI / 2, Math.PI / 2); g.lineTo(0, 8); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.25), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  mesh.visible = false; scene.add(mesh);
  return { mesh, active: false, t: 0, wait: 5, from: new THREE.Vector3(), to: new THREE.Vector3(), head: new THREE.Vector3() };
})();
let hoppedNow = false;
function updateStar(dt, onBalcony, sitting) {
  // sitting out on the balcony makes the sky do something sooner
  if (!star.active && onBalcony && sitting) star.wait -= dt;
  if (!star.active) {
    if (!onBalcony) return;
    star.wait -= dt; if (star.wait > 0) return;
    star.active = true; star.t = 0; star.wait = 8 + Math.random() * 6;
    const y = 5 + Math.random() * 2.5, x0 = 2 + Math.random() * 5;
    star.from.set(x0, y, -16); star.to.set(x0 + 8, y - 2.2, -16); star.mesh.visible = true;
  }
  star.t += dt / 1.4;
  star.head.lerpVectors(star.from, star.to, Math.min(1, star.t));
  star.mesh.position.copy(star.head).add(star.from.clone().sub(star.to).setLength(1.9));
  star.mesh.lookAt(camera.position);
  star.mesh.material.opacity = Math.sin(Math.min(1, star.t) * Math.PI);
  if (hoppedNow && star.t > 0.15 && star.t < 0.95) discover('shooting-star', body.pos.clone().setY(body.pos.y + 0.6));
  if (star.t >= 1) { star.active = false; star.mesh.visible = false; }
}

// ---------- night / morning ----------
let sleeping = false, nightT = 0, bedStillT = 0, bedAsked = false, started = false;
const onBed = () => { const b = apt.placed.bed.position; return Math.abs(body.pos.x - b.x) < 0.75 && Math.abs(body.pos.z - b.z) < 1.05 && body.pos.y > 0.4; };
const onPillows = () => onBed() && body.pos.z < apt.placed.bed.position.z - 0.15;
let camoT = 0;
async function askSleep() {
  bedAsked = true;
  const yes = await hud.askSleep(night().found.length);
  if (!yes) return;
  sleeping = true;
  fx.burst(body.pos.clone().setY(body.pos.y + 0.5), '#cfd8ff', 6, 0.2, { kind: 'zz' });
  hud.dawnOn(true);
  await new Promise((r) => setTimeout(r, 2400));
  const d = S(), ns = d.tonight;
  await hud.morning({
    line: (() => { const list = ns.found.length ? LINES.morning.found : LINES.morning.nothing; return list[(d.night - 1) % list.length].text; })(),
    found: ns.found.map((id) => entryText(entryById[id]).title), pokes: Object.keys(ns.poked).length, glimmers: d.glimmers,
    total: ENTRIES.length, count: Object.keys(d.found).length,
  });
  d.night++; d.stats.nights++; d.tonight = freshNight(); store.flush(); dropResumeNote();
  restoreNightVisuals(); if (pic) pic.rotation.z = CROOKED; apt.placed.dustBunny.visible = false; outside.resetNight(); town.resetNight();
  body.teleport(BED.clone()); hud.dawnOn(false); sleeping = false; stroll?.reset();
  startNight();
}
// settings: "start the night again": tonight starts over on the bed, the journal and the glimmers stay
function restartNight() {
  if (!started || sleeping) return;
  S().tonight = freshNight(); store.flush(); returning = null;
  restoreNightVisuals(); if (pic) pic.rotation.z = CROOKED; apt.placed.dustBunny.visible = false; outside.resetNight(); town.resetNight();
  body.teleport(BED.clone()); cam.snap(BED, 0); stroll?.reset(); dropResumeNote(); sleepOfferAt = T.strollSleepAfter;
  startNight();
}
const HOME_AREAS = new Set(['bedroom', 'living', 'kitchen', 'balcony', 'fire-escape', 'rooftop', 'street', 'corner-shop', 'park', 'alley']);
function startNight() {
  nightT = 0; bedAsked = false; bedStillT = 0; thingSaid.clear();
  look.stretch();
  const d = S();
  // one line to start the night, about somewhere with things still to find
  const open = new Set(ENTRIES.filter((e) => !d.found[e.id]).map((e) => e.room));
  const cands = LINES.nightStart.filter((n) => open.has(n.area) && HOME_AREAS.has(n.area));
  const pick = (cands.length ? cands : LINES.nightStart)[(d.night - 1) % (cands.length || LINES.nightStart.length)];
  hud.showNudge(pick.text, 5.5);
  hud.refresh();
}
function nudgeLine() {
  const d = S();
  const avail = ENTRIES.filter((e) => e.id !== 'fish-tv' || d.decorations.includes('fishbowl'));
  if (avail.every((e) => d.found[e.id])) return '{name} has found everything. the night is for wandering now.';
  if (d.night === 1) return 'tonight {name} is curious about the living room.';
  const open = ROOMS.filter((r) => avail.some((e) => e.room === r.id && !d.found[e.id]));
  return `tonight {name} is curious about ${open[(d.night * 7) % open.length].name}.`;
}

// ---------- title screen ----------
const title = document.createElement('div');
title.id = 'title';
title.innerHTML = `<style>
  #title { position: fixed; inset: 0; z-index: 8; display: grid; align-items: end; justify-items: center; background: #120e24; transition: opacity 0.9s ease; }
  #title img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 36% 35%; }
  #title .fade { position: absolute; inset: 0; background: linear-gradient(to bottom, rgba(18,14,36,0) 45%, rgba(18,14,36,0.85) 80%, rgba(18,14,36,0.95)); }
  #title .words { position: relative; text-align: center; color: #f6eadf; padding: 0 24px calc(48px + env(safe-area-inset-bottom)); max-width: 520px; }
  #title h1 { margin: 0 0 6px; font-size: 40px; font-weight: 600; letter-spacing: 0.03em; }
  #title p { margin: 0 0 22px; font-size: 16px; line-height: 1.4; opacity: 0.85; text-wrap: balance; }
  #title .how { margin-top: 16px; font-size: 13px; opacity: 0.6; }
  #title button { border: 0; font: inherit; font-size: 18px; border-radius: 22px; height: 48px; padding: 0 28px; background: #ffcf7a; color: #2a1d3a; box-shadow: 0 8px 26px rgba(255,190,110,0.35); }
  #title.gone { opacity: 0; pointer-events: none; }
  #title h1, #title p { text-shadow: 0 2px 14px rgba(18,14,36,0.95); } /* the lanterns sit behind the words on short screens */
  @media (max-height: 500px) { #title .fade { background: linear-gradient(to bottom, rgba(18,14,36,0) 15%, rgba(18,14,36,0.8) 50%, rgba(18,14,36,0.95)); } #title .words { padding-bottom: calc(22px + env(safe-area-inset-bottom)); } #title h1 { font-size: 34px; } }
</style><img alt="" src="assets/brand/hero.webp"><div class="fade"></div><div class="words"><h1></h1><p></p><button></button><div class="how"></div></div>`;
title.querySelector('h1').textContent = fmt(CONFIG.gameTitle);
const titleLines = LINES.title.lines;
title.querySelector('p').textContent = fmt(titleLines[(S().night - 1) % titleLines.length].text);
title.querySelector('button').textContent = fmt(LINES.title.button?.text || LINES.title.button || CONFIG.text.begin);
const coarse = matchMedia('(pointer: coarse)').matches;
title.querySelector('.how').textContent = fmt(PLATFORMER ? (coarse ? CONFIG.text.hintPlatform : CONFIG.text.hintPlatformKeys) : (coarse ? LINES.title.how : LINES.title.howMouse).text);
document.body.appendChild(title);
const stopTitle = (e) => e.stopPropagation();
title.addEventListener('pointerdown', stopTitle);
const begin = () => { if (started) return; started = true; title.classList.add('gone'); setTimeout(() => title.remove(), 1000); startNight(); };
title.querySelector('button').addEventListener('click', begin);
if (params.has('play')) begin(); // tests skip the title
// the position note: written on every put-away (and before the reload after a lost GL context, reloadSameNight below);
// any start within 30 minutes of it skips the title and puts Ghost back where the night was left (Revision 5: closing
// the app mid-night loses nothing). Nothing accrues while closed: the night clock carries on from where it stopped.
const RESUME_KEY = 'ghostcat3d.resume', RESUME_MS = 30 * 60e3;
const resumeBlob = (() => {
  let r = null;
  // (even naming the storage can throw when the browser blocks it: every touch is inside the try)
  for (const which of ['localStorage', 'sessionStorage']) { try { const st = window[which]; r = r || JSON.parse(st.getItem(RESUME_KEY) || 'null'); st.removeItem(RESUME_KEY); } catch (e) { /* storage blocked: no note */ } }
  return params.has('fresh') ? null : r;
})();
let resumedNight = false;
if (resumeBlob && Date.now() - resumeBlob.at < RESUME_MS && Date.now() >= resumeBlob.at && resumeBlob.night === S().night && Array.isArray(resumeBlob.pos) && resumeBlob.pos.length === 3 && resumeBlob.pos.every(Number.isFinite)) {
  begin(); nightT = Math.max(0, +resumeBlob.nightT || 0); resumedNight = true;
  body.teleport(new THREE.Vector3(...resumeBlob.pos)); cam.snap(body.pos, Number.isFinite(resumeBlob.yaw) ? resumeBlob.yaw : 0);
}
function writeResumeNote() {
  if (!started || sleeping) return;
  try { localStorage.setItem(RESUME_KEY, JSON.stringify({ pos: body.pos.toArray(), yaw: cam.yaw, nightT, night: S().night, at: Date.now() })); } catch (e) { /* the save alone still keeps the night */ }
}
const dropResumeNote = () => { try { localStorage.removeItem(RESUME_KEY); } catch (e) { /* nothing to drop */ } };

// ---------- out on the fire escape and the roof ----------
const inBox = (p, z) => p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z;
let returning = null, fxMoteY = 0;
const fxMoteX = new THREE.Vector3();
function startReturn() {
  returning = { from: body.pos.clone(), to: body.S.lastSafe.clone(), t: 0 };
  eventCounts.floatBack = (eventCounts.floatBack || 0) + 1;
  fx.burst(body.pos.clone().setY(body.pos.y + 0.4), '#cfe0ff', 12, 0.3);
}
function stepReturn(dt) {
  returning.t += dt / T.floatBackTime;
  const k = Math.min(1, returning.t), e = k * k * (3 - 2 * k);
  body.pos.lerpVectors(returning.from, returning.to, e);
  body.pos.y += Math.sin(k * Math.PI) * T.floatBackArc;
  body.vel.set(0, 0, 0); body.S.floating = true; body.S.grounded = false;
  if (k >= 1) { body.teleport(returning.to); body.S.grounded = true; returning = null; return [{ type: 'respawn' }]; }
  return [];
}
// the skylight: land on it from above, then sit; the smoke ring: hop through it while it hangs over the roof
const sky = { armed: false, sitT: 0 };
const TOWN_MUSIC = { street: 'street', alley: 'alley', 'corner-shop': 'interiors', park: 'park' }; // src/audio/presets.js
let musicArea = 'home', trainT = 40 + Math.random() * 40, mothT = 4;
function updateOutsideLife(dt, p) {
  const sl = apt.placed.skylight;
  if (sl && !S().found.skylight) {
    const c = sl.getWorldPosition(tmpV), on = Math.abs(p.x - c.x) < 0.62 && Math.abs(p.z - c.z) < 0.48 && p.y > c.y + 0.25 && p.y < c.y + 1.0;
    if (!on) { sky.armed = false; sky.sitT = 0; }
    else {
      if (lastEvents.some((e) => e.type === 'land')) sky.armed = true;
      const still = body.S.grounded && Math.hypot(body.vel.x, body.vel.z) < 0.08;
      if (sky.armed && still) { sky.sitT += dt; if (Math.floor(sky.sitT / 0.7) !== Math.floor((sky.sitT - dt) / 0.7)) fx.burst(p.clone().setY(p.y + T.height + 0.05), '#ffe9b8', 2, 0.12, { scale: 0.6 }); if (sky.sitT >= 3) discover('skylight', p.clone().setY(p.y + T.height + 0.1)); }
      else sky.sitT = 0;
    }
  }
  const ring = outside.react.ring;
  if (ring.active && ring.t > 1.2 && !body.S.grounded && !S().found['smoke-ring']) {
    const c = outside.react.ringPos();
    if (Math.hypot(p.x - c.x, p.z - c.z) < T.smokeRingReach && Math.abs(p.y + T.height * 0.5 - c.y) < 0.3) discover('smoke-ring', c.clone());
  }
  // the goldfish swims to the glass while Ghost sits by the bowl
  const gf = thingById.goldfish;
  outside.react.fishNear(!!gf && (gf.sitT > 1.2 || (S().found.goldfish && Math.hypot(p.x - gf.pos.x, p.z - gf.pos.z) < 0.7 && Math.abs(p.y - gf.pos.y) < 0.6)));
  // music and ambience: the roof's own preset, the party speaker near the decks, wind up high, a train far off
  const dj = apt.placed.djTable, nearParty = room === 'rooftop' && dj && dj.getWorldPosition(tmpV).distanceTo(p) < 4.2;
  const want = nearParty ? 'party' : room === 'rooftop' || room === 'fire-escape' ? 'rooftops' : TOWN_MUSIC[room] || 'home';
  if (want !== musicArea) { musicArea = want; audio.setArea(want); audio.setLoop('wind', room === 'rooftop' ? 1.25 : 1); }
  if (room === 'rooftop') { trainT -= dt; if (trainT <= 0) { trainT = 80 + Math.random() * 60; audio.play('train', { volume: 0.7 }); } }
  if (room === 'rooftop' || room === 'fire-escape' || room === 'street' || room === 'park') {
    mothT -= dt;
    if (mothT <= 0) { mothT = 3 + Math.random() * 4; if ([...outside.lamps, ...town.lamps.street.map((l) => l.pos)].some((l) => l.distanceTo(p) < 1.8)) audio.play('moth'); }
  }
}
// big things between the camera and Ghost (the stair, the stair hut, the water towers) fade away
const fadeRay = new THREE.Raycaster(), fadeDir = new THREE.Vector3();
const fades = [...outside.fadeables, ...town.all.flatMap((a) => a.fadeables)].map((o) => {
  const mats = []; o.traverse((m) => { if (m.isMesh && m.material && m.material.visible !== false) { m.material = m.material.clone(); mats.push(m.material); } });
  for (const m of mats) m.userData.op0 = m.opacity ?? 1;
  return { o, mats, level: 1 };
});
function updateFades(dt) {
  const to = body.pos.clone(); to.y += T.height * 0.5;
  fadeDir.subVectors(to, camera.position); const dist = fadeDir.length(); fadeDir.normalize();
  fadeRay.set(camera.position, fadeDir); fadeRay.far = Math.max(0, dist - 0.3);
  for (const f of fades) {
    const hide = room !== null && fadeRay.intersectObject(f.o, true).length > 0;
    const goal = hide ? 0.2 : 1;
    if (Math.abs(goal - f.level) < 0.001 && goal === 1) continue;
    f.level += (goal - f.level) * Math.min(1, dt * 8);
    for (const m of f.mats) {
      const faded = f.level < 0.99;
      if (m.userData.wasFaded !== faded) { m.transparent = faded || m.userData.op0 < 1; m.depthWrite = !faded; m.needsUpdate = true; m.userData.wasFaded = faded; }
      m.opacity = m.userData.op0 * f.level;
    }
  }
}
let lastEvents = [];
// what Ghost's paws are on (src/audio: soft | roof | wood | grass | metal | puddle)
function surfaceAt(r, p) {
  if (r === 'fire-escape') return 'metal';
  if (r === 'rooftop') return 'roof';
  if (r === 'corner-shop') return 'wood';
  if (r === 'park') return p.y > town.places.park.position[1] + 0.3 ? 'wood' : 'grass';
  if (r === 'street' || r === 'alley') {
    if (p.z < town.frontZ + 1.2 && p.y > town.places.street.position[1] + 1.5) return p.y > -1.3 ? 'metal' : 'soft'; // the fire escape; the awning
    return town.puddles.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 0.6) ? 'puddle' : 'roof';
  }
  return 'wood';
}

// ---------- Revision 5: Ghost wanders alone; the player taps (src/stroll.js) ----------
const BED_NODE = 'ap-bed';
// the sit secrets, as the wanderer needs them: how long to sit where (only while they can still be found)
const SIT_BY_THING = Object.fromEntries(Object.entries(SECRET_RULES).filter(([, r]) => r.thing && r.sit).map(([entry, r]) => [r.thing, { entry, sit: r.sit, late: !!r.late, unless: r.unless || null }]));
const SIT_SPOT = Object.fromEntries(Object.entries(SECRET_RULES).filter(([, r]) => r.spot).map(([entry, r]) => [entry, { entry, sit: r.sit, hiss: !!r.hiss }]));
const sitRule = (id) => {
  if (SIT_BY_THING[id]) return SIT_BY_THING[id];
  if (SIT_SPOT[id]) return SIT_SPOT[id];
  if (id === 'skylight') return { entry: 'skylight', sit: 3 };
  if (id === 'shooting-star') return { entry: 'shooting-star', sit: 8 }; // sitting out under the sky: the star comes sooner
  if (id === 'blanket' && nightT > 30) return { entry: 'camouflage', sit: 5 }; // still on the bed, no question on screen
  return null;
};
let camBudget = 1, stroll = null, sleepOfferAt = T.strollSleepAfter, purrN = 0, starTried = false, ringTried = false;
if (!PLATFORMER) {
  const graphs = await pathsReady;
  const STROLL_MOVING = new Set(['moth', 'leaf']);
  stroll = createStroll(graphs, {
    body, returning: () => !!returning, night, found: (e) => !!S().found[e], late, sleepy: () => nightT > T.strollSleepAfter,
    roomOf: (p) => outside.areaAt(p) || town.areaAt(p) || apt.roomAt(p),
    targets: things.map((th) => ({ id: th.def.id, pos: th.pos, top: th.top, room: th.def.room, act: th.def.act, kind: 'thing', moving: STROLL_MOVING.has(th.def.id),
      live: STROLL_MOVING.has(th.def.id) ? () => (th.def.id === 'leaf' && !apt.placed.leaf.visible ? null : th.pos) : null })),
    sitRule, bedNode: BED_NODE, bedThing: 'bed',
    avoid: (id) => Object.entries(SECRET_RULES).some(([entry, r]) => r.unless === id && !S().found[entry]),
    walkFor: (id) => (id === 'midiKeys' ? ['ap-lv-desk-w', 'ap-lv-desk-e'] : null), // the composition: the keys, end to end
    poke: (id) => { const th = thingById[id]; if (!th || !started || sleeping) return; th.lastT = t; poke(th); },
    purr: () => {
      look.happy(2.2); look.kick(-0.05); audio.play('purr');
      fx.burst(body.pos.clone().setY(body.pos.y + T.height + 0.05), '#ffb3cf', 6, 0.18, { kind: 'hearts', scale: 0.7 });
      const L = LINES.stroll; speakAt(L[purrN++ % L.length].text, body.pos.x, body.pos.y + T.height + 0.35, body.pos.z);
    },
    sleep: () => { if (!sleeping && !hud.cardOpen && started) { sleepOfferAt = Math.max(sleepOfferAt, nightT + T.strollSleepAgain); askSleep(); } },
    ring: () => ({ active: outside.react.ring.active, t: outside.react.ring.t, pos: outside.react.ringPos() }),
    crouch: () => look.kick(-0.07),
  });
  cam.setStyle({ zoom: T.strollCamZoom, pitch: T.strollCamPitch, zoomPortrait: T.strollCamZoomPortrait, pitchPortrait: T.strollCamPitchPortrait, maxZoom: T.strollCamMaxZoom, autoYaw: T.strollCamYaw, frame: T.strollCamFrame });
  if (resumedNight) stroll.reset();
}

// ---- taps: one pointer, anywhere. What is under it: Ghost, a thing, a secret's spot, something in the air, the ground
const tapRay = new THREE.Raycaster(), tapNdc = new THREE.Vector2(), tapBox = new THREE.Box3(), tapV = new THREE.Vector3();
// how far along a ray the view is really blocked: upright collision (the invisible front of the dollhouse, rails) does
// not block the eye, a floor, a tabletop or a roof does
function sightDistance(origin, dir, far) {
  const from = origin.clone(); let gone = 0;
  for (let k = 0; k < 8; k++) {
    const h = apt.collision.raycast(from, dir, far - gone); if (!h) return Infinity;
    gone += h.distance; if (Math.abs(h.normal.y) > 0.5) return gone;
    from.copy(h.point).addScaledVector(dir, 0.02); gone += 0.02;
  }
  return Infinity;
}
const toScreen = (p) => { tapV.copy(p).project(camera); return { x: (tapV.x + 1) / 2 * W, y: (1 - tapV.y) / 2 * H, front: tapV.z < 1 && tapV.z > -1 }; };
// the secrets' own spots (the warm sill, the little table, the top crate): tappable too
const spotTargets = () => (stroll ? [...stroll.targets.values()].filter((x) => x.kind === 'spot' && x.id !== 'smoke-ring') : []);
function pickAt(x, y) {
  if (!started || sleeping || hud.cardOpen || hud.journalOpen || settings.open) return { kind: 'blocked' };
  tapNdc.set((x / W) * 2 - 1, -(y / H) * 2 + 1); tapRay.setFromCamera(tapNdc, camera);
  const R = tapRay.ray;
  // the first walkable surface along the ray: upright surfaces are passed through (the dollhouse's open front and the
  // rails are invisible collision walls; the camera itself keeps out of the real ones)
  let wHit = null, from = R.origin.clone(), gone = 0;
  for (let k = 0; k < 8; k++) {
    const h = apt.collision.raycast(from, R.direction, 80 - gone); if (!h) break;
    gone += h.distance;
    if (h.normal.y > 0.5) { wHit = { point: h.point.clone(), normal: h.normal.clone(), distance: gone }; break; }
    from.copy(h.point).addScaledVector(R.direction, 0.02); gone += 0.02;
  }
  const wd = wHit ? wHit.distance : Infinity;
  // in the air: the shooting star (screen distance) and the chimney's smoke ring
  if (star.active && room === 'balcony') { const sp = toScreen(star.head); if (sp.front && Math.hypot(sp.x - x, sp.y - y) < 90) return { kind: 'star' }; }
  const rg = outside.react.ring;
  if (rg.active && rg.t > 0.8) { const sp = toScreen(outside.react.ringPos()); if (sp.front && Math.hypot(sp.x - x, sp.y - y) < 60) return { kind: 'ring' }; }
  // things: their touch boxes (a little fattened), not behind a wall; among near-equal hits the smaller one wins
  const hits = [];
  const test = (id, cx, cz, r, y0, y1) => {
    const rr = Math.max(r, 0.16) + 0.06;
    tapBox.min.set(cx - rr, y0, cz - rr); tapBox.max.set(cx + rr, y1, cz + rr);
    const hp = R.intersectBox(tapBox, tapV); if (!hp) return;
    const d = hp.distanceTo(R.origin); if (d > wd + 0.6) return;
    hits.push({ id, d, r, at: hp.clone(), c: new THREE.Vector3(cx, (y0 + y1) / 2, cz), h: y1 - y0 });
  };
  for (const th of things) {
    if (th.def.id === 'leaf' && !apt.placed.leaf.visible) continue;
    if (stroll && !stroll.targets.get(th.def.id)?.nodes.length && !stroll.targets.get(th.def.id)?.moving) continue;
    test(th.def.id, th.pos.x, th.pos.z, th.r, th.y0, th.y1);
  }
  for (const sp of spotTargets()) test(sp.id, sp.pos.x, sp.pos.z, 0.28, sp.pos.y - 0.45, sp.pos.y + 0.45); // (the crate, the sill under the spot)
  // first, as a player sees it: a thing whose drawn middle is within its own size on screen of the finger, and in sight
  // (the nearer of two things on one wall seen at a slant would otherwise shadow the other with its box)
  let best = null, bestS = Infinity;
  const seen = (id, c, r, h) => {
    const sp = toScreen(c); if (!sp.front) return;
    const edge = toScreen(c.clone().setY(c.y + Math.max(r * 0.9, h * 0.5)));
    const rad = Math.max(20, Math.abs(edge.y - sp.y) * 1.15), dd = Math.hypot(sp.x - x, sp.y - y);
    if (dd > rad) return;
    const dir = c.clone().sub(camera.position), len = dir.length();
    if (sightDistance(camera.position, dir.normalize(), len) < len - 0.35) return;
    const sc = dd / rad + r * 0.4;
    if (sc < bestS) { bestS = sc; best = { id, d: len, r, at: c.clone() }; }
  };
  for (const th of things) {
    if (th.def.id === 'leaf' && !apt.placed.leaf.visible) continue;
    if (stroll && !stroll.targets.get(th.def.id)?.nodes.length && !stroll.targets.get(th.def.id)?.moving) continue;
    if (th.r >= 0.5) continue; // the big ones (the bed, the fridge, the dumpster): by their boxes below
    seen(th.def.id, new THREE.Vector3(th.pos.x, (th.y0 + th.y1) / 2, th.pos.z), th.r, th.y1 - th.y0);
  }
  for (const sp of spotTargets()) seen(sp.id, sp.pos.clone().setY(sp.pos.y + 0.1), 0.28, 0.5);
  if (!best && hits.length) {
    hits.sort((a, b) => a.d - b.d);
    // (a big box, the bed or the fridge, gives way to a small thing just past its edge: the hair tie by the bed)
    const big = hits[0].r >= 0.5;
    // among the near ones: the thing drawn closest to the finger, measured in its own size on screen (two things on one
    // wall seen at a slant: the box of the nearer sticks out over the other)
    const near = hits.filter((h) => h.d < hits[0].d + 0.35 || (h.r < 0.3 && h.d < hits[0].d + (big ? 1.2 : 0.9)));
    for (const h of near) {
      const sc = toScreen(h.c), top = toScreen(h.c.clone().setY(h.c.y + Math.max(h.h, h.r * 2) / 2));
      h.sd = Math.hypot(sc.x - x, sc.y - y) / Math.max(16, Math.abs(top.y - sc.y) + 8) + h.r * 0.8;
    }
    best = near.sort((a, b) => a.sd - b.sd)[0];
    // the bed: the pillow end means the bed (sleep), the rest is the blanket
    if (best.id === 'blanket' && best.at.z < apt.placed.bed.position.z - 0.15 && hits.some((h) => h.id === 'bed')) best = hits.find((h) => h.id === 'bed');
  }
  // Ghost: within a thumb of Ghost's middle on screen
  const gc = body.pos.clone().setY(body.pos.y + T.height * 0.5), gs = toScreen(gc), gd = camera.position.distanceTo(gc);
  const gTop = toScreen(gc.clone().setY(gc.y + T.height * 0.6)), gPx = Math.max(34, Math.abs(gTop.y - gs.y) * 1.3);
  // (inside Ghost's own disc on screen Ghost wins, whatever Ghost sits on or in; only a wall in between hides Ghost)
  if (gs.front && Math.hypot(gs.x - x, gs.y - y) < gPx && wd > gd - 0.45) return { kind: 'ghost' };
  if (best) return { kind: 'thing', id: best.id, d: +best.d.toFixed(2) };
  // a near miss on a small thing: the closest thing centre within a thumb on screen, if nothing is in the way
  let near = null, nd = 30;
  for (const th of things) {
    if (stroll && !stroll.targets.get(th.def.id)?.nodes.length) continue;
    const c = tapV.set(th.pos.x, (th.y0 + th.y1) / 2, th.pos.z).clone(), sp = toScreen(c), dd = Math.hypot(sp.x - x, sp.y - y);
    if (!sp.front || dd >= nd) continue;
    const dir = c.clone().sub(camera.position), len = dir.length();
    if (sightDistance(camera.position, dir.normalize(), len) < len - 0.35) continue;
    nd = dd; near = th.def.id;
  }
  if (near) return { kind: 'thing', id: near, near: true };
  if (wHit) return { kind: 'point', p: wHit.point.clone(), up: wHit.normal.y > 0.5 };
  return { kind: 'nothing' };
}
const tapCounts = {};
function onTap(x, y) {
  const r = pickAt(x, y);
  tapCounts[r.kind] = (tapCounts[r.kind] || 0) + 1;
  if (!stroll || r.kind === 'blocked' || r.kind === 'nothing') return r;
  if (r.kind === 'thing') {
    const th = thingById[r.id], at = th ? new THREE.Vector3(th.pos.x, th.top, th.pos.z) : stroll.targets.get(r.id)?.pos.clone().setY(stroll.targets.get(r.id).pos.y + 0.3);
    if (at) fx.burst(at, '#fff0c8', 4, 0.2, { scale: 0.5 });
    r.result = stroll.tapThing(r.id);
  } else if (r.kind === 'point') { fx.ripple(r.p); r.result = stroll.tapPoint(r.p); }
  else if (r.kind === 'ghost') r.result = stroll.tapGhost();
  else if (r.kind === 'ring') r.result = stroll.tapRing();
  else if (r.kind === 'star') r.result = stroll.hopNow();
  return r;
}
if (!PLATFORMER) {
  // a tap is a press and a release close together (a drag or a long hold is nothing); Mac: a click is a tap
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { if (!e.isPrimary && down) return; down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || e.pointerId !== down.id) return;
    const d = down; down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 18 || performance.now() - d.t > 900) return;
    onTap(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointercancel', () => { down = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---- glints: the thing Ghost is heading for (warm, pulsing, visible before Ghost gets there), and a fainter one on
// each untouched thing in view (a few at most)
let glintT = 0, faintGlints = [];
const glintPos = (x, y, z) => new THREE.Vector3(x, y, z);
function updateGlints(dt) {
  if (!stroll) return;
  const list = [];
  const h = started && !sleeping ? stroll.heading() : null;
  if (h && (h.kind === 'thing' || h.kind === 'spot' || h.id === 'smoke-ring')) {
    const th = h.id && thingById[h.id];
    const pos = h.id === 'smoke-ring' ? h.pos.clone().setY(h.pos.y + 0.32) : th && !th.def.town && th.top - th.pos.y > 1.2 ? glintPos(th.pos.x, Math.min(th.top, body.pos.y + 1.3) + 0.12, th.pos.z) : glintPos(h.pos.x, (h.top ?? h.pos.y) + 0.14, h.pos.z);
    list.push({ key: 'go:' + h.id, pos, main: true });
  }
  glintT -= dt;
  if (glintT <= 0) {
    glintT = 0.3; faintGlints = [];
    if (started && !sleeping) {
      const ns = night(), cands = [];
      for (const th of things) {
        const id = th.def.id;
        if (ns.poked[id] || (h && h.id === id) || !stroll.targets.get(id)?.nodes.length || id === 'bed') continue;
        const c = glintPos(th.pos.x, Math.min(th.top, th.pos.y + 1.2) + 0.12, th.pos.z), dist = c.distanceTo(body.pos);
        if (dist > T.strollGlintRange) continue;
        const sp = toScreen(c); if (!sp.front || sp.x < 12 || sp.x > W - 12 || sp.y < 60 || sp.y > H - 40) continue;
        const dir = c.clone().sub(camera.position), len = dir.length();
        if (sightDistance(camera.position, dir.normalize(), len) < len - 0.3) continue;
        cands.push({ key: 'faint:' + id, pos: c, dist });
      }
      faintGlints = cands.sort((a, b) => a.dist - b.dist).slice(0, T.strollGlints);
    }
  }
  fx.setGlints(list.concat(faintGlints));
}

// ---------- loop ----------
const STEP = 1 / 120;
let acc = 0, last = performance.now(), t = 0, firstFrameMs = null, lastHud = 0, sampler = null, override = null, purrT = 0, room = null;
const move = new THREE.Vector3();
const splash = document.getElementById('splash');
const hint = document.getElementById('hint');
hint.style.display = 'none'; // the controls hint lives on the title screen instead
let hintShown = false;
const eventCounts = {};
const lampSpots = () => Object.values(apt.lamps).filter((l) => l.on).map((l) => l.light.position);
let lastInput = { x: 0, y: 0, jumpHeld: false, source: 'none' };

function stats() { const r = renderer.info.render; return { fps: perf.fps, ms: perf.ms, calls: r.calls, tris: r.triangles, points: r.points, lines: r.lines, pr: ratio, w: W, h: H, gl: 'WebGL 2', stepDowns: perf.stepDowns }; }

let resumed = true;
function loop(now) {
  let dt = (now - last) / 1000; last = now;
  // the first frame after a start (back from the background, a restored context) or after the page sat frozen without
  // a word (iOS): nothing moves and no timer runs on, so Ghost is exactly where the night was left
  if (resumed || dt > 1 || dt < 0) { resumed = false; dt = 0; perf.reset(); } else { dt = Math.min(dt, 1 / 20); perf.frame(now); }
  t += dt;
  const blocked = !started || sleeping || hud.cardOpen || hud.journalOpen || settings.open;
  let input, worldMove = null;
  if (override) { input = { nudgeX: 0, nudgeY: 0, ...override }; override.jumpPressed = false; stroll?.poll(dt, true); }
  else if (stroll) { const s = stroll.poll(dt, blocked); worldMove = s.move; input = { x: 0, y: s.mag, jumpHeld: s.jumpHeld, jumpPressed: s.jumpPressed, nudgeX: 0, nudgeY: 0, source: 'stroll' }; }
  else input = controls.poll();
  if (blocked) { input = { x: 0, y: 0, jumpHeld: false, jumpPressed: false, nudgeX: 0, nudgeY: 0, source: input.source }; worldMove = null; }
  lastInput = input;
  if (hintShown && started && (Math.hypot(input.x, input.y) > 0.2 || input.jumpPressed)) { hintShown = false; hint.classList.add('gone'); }

  let events;
  if (returning) events = stepReturn(dt);
  else {
    if (worldMove) move.copy(worldMove); else cam.stickToWorld(input.x, input.y, move);
    if (move.lengthSq() > 1) move.normalize();
    acc += dt; let first = true;
    while (acc >= STEP) { body.step(STEP, { move, jumpHeld: input.jumpHeld, jumpPressed: first && input.jumpPressed }); first = false; acc -= STEP; }
    if (first && input.jumpPressed) body.S.jumpBufferT = body.S.now;
    body.magnet(dt);
    events = body.drain();
    // a drop into the courtyard: Ghost floats back up to the last safe spot (no fail state)
    if (body.S.lastSafe.y - body.pos.y > T.pitDrop && outside.pits.some((z) => inBox(body.pos, z))) startReturn();
  }
  hoppedNow = false; lastEvents = events;
  for (const e of events) {
    eventCounts[e.type] = (eventCounts[e.type] || 0) + 1;
    if (e.type === 'jump' || e.type === 'airJump') { hoppedNow = true; audio.play(e.type === 'jump' ? 'hop' : 'doubleHop'); }
    else if (e.type === 'land') audio.play('land', { speed: e.speed });
    else if (e.type === 'bump') audio.play('bump');
    if (e.type === 'land' && e.speed > 3) fx.burst(body.pos.clone().setY(body.pos.y + 0.03), '#d8d0f0', 4, 0.2, { scale: 0.5 });
    // the alley: landing on the top crate from above
    if (e.type === 'land' && !S().found['crate-top'] && Math.hypot(body.pos.x - town.crateTop.x, body.pos.z - town.crateTop.z) < 0.34 && Math.abs(body.pos.y - town.crateTop.y) < 0.15) discover('crate-top', body.pos.clone().setY(body.pos.y + 0.5));
    // the park: a hop among the fireflies is a chase
    if ((e.type === 'jump' || e.type === 'airJump') && room === 'park' && thingById.flies) {
      const f = thingById.flies;
      if (Math.hypot(body.pos.x - f.pos.x, body.pos.z - f.pos.z) < f.r + 0.4 && town.scatterFlies(body.pos) > 0 && t - f.lastT > 0.8 && started && nightT > 1.5) { f.lastT = t; poke(f); }
    }
  }

  // touches: entering a thing's space pokes it
  for (const th of moving) placeTrigger(th);
  const p = body.pos;
  for (const th of things) {
    const d = Math.hypot(p.x - th.pos.x, p.z - th.pos.z);
    const inside = d < th.r + T.radius * 0.6 && p.y < th.y1 && p.y + T.height > th.y0 && (th.def.id !== 'leaf' || apt.placed.leaf.visible);
    // (with the wanderer a switch, the lamps, the curtain, the tap, only flips when it is the thing Ghost meant to poke)
    const brushed = stroll && th.def.reaction === 'toggle' && stroll.heading()?.id !== th.def.id;
    if (inside && !th.inside && t - th.lastT > 0.6 && started && !sleeping && nightT > 1.5 && !brushed) { th.lastT = t; poke(th); }
    th.inside = inside;
  }
  // sitting still: sit secrets, purring on soft things, warm spots, the bed
  const still = body.S.grounded && Math.hypot(body.vel.x, body.vel.z) < 0.08;
  let warm = false, soft = null;
  for (const th of things) {
    const near = Math.hypot(p.x - th.pos.x, p.z - th.pos.z) < Math.max(th.r + 0.25, 0.5) && Math.abs(p.y - th.pos.y) < 0.9;
    if (near && SOFT.has(th.def.id)) { warm = true; soft = th; }
    if (th.def.sitReact) { th.reactT = near && still ? (th.reactT || 0) + dt : 0; if (th.reactT) town.sitReact(th.def.id, th.reactT); }
    const sec = th.def.secret;
    if (!sec?.sit || S().found[sec.entry]) continue;
    if (near && still && (!sec.late || late()) && !(sec.unless && night().taps[sec.unless])) {
      th.sitT += dt;
      if (th.def.id === 'drain' && Math.floor(th.sitT / 0.8) !== Math.floor((th.sitT - dt) / 0.8)) audio.playKey(Math.min(4, Math.floor(th.sitT / 0.8)) * 2 % 7, 0.35);
      if (Math.floor(th.sitT / 0.7) !== Math.floor((th.sitT - dt) / 0.7)) fx.burst(p.clone().setY(p.y + T.height + 0.05), '#ffb3cf', 2, 0.12, { kind: 'hearts', scale: 0.6 });
      if (th.sitT >= sec.sit) discover(sec.entry, p.clone().setY(p.y + T.height + 0.1));
    } else th.sitT = 0;
  }
  for (const lp of lampSpots()) if (Math.hypot(p.x - lp.x, p.z - lp.z) < 1.1 && p.y < lp.y) warm = true;
  for (const s of SPOT_SITS) if (s.pos && s.entry === 'warm-sill' && Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < s.r && Math.abs(p.y - s.pos.y) < s.dy) { warm = true; soft = soft || thingById.coffeeShop; }
  updateTownSits(dt, p, still);
  if (onBed()) warm = true;
  look.warm = warm;
  if (look.pose === 'loaf' && soft) { purrT -= dt; if (purrT <= 0) { purrT = 1.3; fx.burst(p.clone().setY(p.y + T.height + 0.05), '#ffb3cf', 2, 0.1, { kind: 'hearts', scale: 0.55 }); look.kick(-0.04); audio.play('purr'); } }
  nightT += dt;
  if (stroll && started && !sleeping && !hud.cardOpen && !hud.journalOpen && !settings.open && nightT > sleepOfferAt && body.S.grounded) {
    sleepOfferAt = nightT + T.strollSleepAgain; askSleep();
  }
  if (stroll && started && !blocked) {
    // a shooting star over the balcony: now and then Ghost hops at it without being asked
    if (star.active && room === 'balcony' && star.t > 0.25 && star.t < 0.6 && !starTried) { starTried = true; if (Math.random() < 0.5) stroll.hopNow(); }
    if (!star.active) starTried = false;
    // the smoke ring: cats chase things that float
    const rg = outside.react.ring;
    if (rg.active && rg.t > 1.0 && room === 'rooftop' && !S().found['smoke-ring'] && !ringTried) { ringTried = true; if (Math.random() < 0.6) stroll.chaseRing(); }
    if (!rg.active) ringTried = false;
  }
  if (onPillows() && still && nightT > 12 && !bedAsked && !sleeping && started) { bedStillT += dt; if (bedStillT > T.bedAskAfter) askSleep(); } else if (!onPillows()) { bedStillT = 0; if (!onBed()) bedAsked = false; }
  // camouflage: black cat, black-and-white bed. still on the bed for 5 s, with no question on screen
  if (onBed() && still && !hud.cardOpen && nightT > 30 && started) { camoT += dt; if (camoT > 5) discover('camouflage', p.clone().setY(p.y + 0.5)); } else camoT = 0;
  updateKeys(dt);

  // places
  const r = outside.areaAt(p) || town.areaAt(p) || apt.roomAt(p);
  if (r !== room) {
    if ((r === 'corner-shop') !== (room === 'corner-shop') && room !== null) { audio.play('chime', { volume: 0.45 }); wobble(apt.placed.doorBell, 0.3); } // the shop's door bell
    const wasOut = room !== null && !apt.rooms[room], isOut = !apt.rooms[r];
    if (wasOut !== isOut || room === null) { livingShadow.castShadow = !isOut; if (!isOut) renderer.shadowMap.needsUpdate = true; } // the living lamp's shadow: indoors only
    room = r;
    const name = ROOMS.find((x) => x.id === r)?.name;
    if (r === 'fire-escape') fx.setMotes(new THREE.Vector3(p.x, p.y, -3.3), [3.5, 1.2]);
    else if (r === 'rooftop') fx.setMotes(new THREE.Vector3(-1.5, 5.75, 0), [8, 3.5]);
    else if (TOWN_AREAS.has(r)) fx.setMotes(r === 'corner-shop' ? town.shopBox.getCenter(new THREE.Vector3()).setY(town.shopBox.min.y) : new THREE.Vector3(p.x, p.y, p.z), r === 'corner-shop' ? [4, 3.5] : [6, 5]);
    else fx.setMotes(r === 'balcony' ? new THREE.Vector3(7, 0, -1.2) : new THREE.Vector3((R(r).x0 + R(r).x1) / 2, 0, -1), r === 'balcony' ? [3, 2] : [4.5, 3.2]);
    // real lights for the lamps nearest Ghost: down here (and on the roof, where the street shows) the apartment's own
    // lamps are borrowed too; at most T.townRealLights per area, the rest are halo + pool
    outside.lend.borrow = TOWN_AREAS.has(r) || r === 'rooftop';
    outside.lend.max = T.townRealLights;
    outside.lend.candidates = r === 'corner-shop' ? town.lamps.shop : TOWN_AREAS.has(r) ? town.lamps.street : r === 'rooftop' ? [...outside.lampsHome, ...town.lamps.street] : null;
    if (started && name) { if (!S().places[r]) { S().places[r] = true; changed(); hud.showPlace(hud.word('place-new', { place: name })); } else hud.showPlace(name, 2.2); }
  }
  if (room === 'fire-escape' && Math.abs(p.y - fxMoteY) > 1.2) { fxMoteY = p.y; fx.setMotes(new THREE.Vector3(p.x, p.y, -3.3), [3.5, 1.2]); }
  if ((room === 'street' || room === 'park') && Math.hypot(p.x - fxMoteX.x, p.z - fxMoteX.z, p.y - fxMoteX.y) > 3) { fxMoteX.copy(p); fx.setMotes(p.clone(), [6, 5]); }
  updateOutsideLife(dt, p);
  // out on the fire escape, the living-room wall steps aside
  if (apt.livingBack) {
    const goal = 1, m = apt.livingBack.material;
    const o = m.opacity + (goal - m.opacity) * Math.min(1, dt * 6);
    if (Math.abs(o - m.opacity) > 1e-4 || (goal < 1 && !m.transparent)) { m.opacity = o; const tr = o < 0.995; if (m.transparent !== tr) { m.transparent = tr; m.depthWrite = !tr; m.needsUpdate = true; } }
  }

  if (pic && pic.userData.straightT !== undefined) { pic.userData.straightT -= dt; const goal = pic.userData.straightT > 0 ? 0 : CROOKED; pic.rotation.z += (goal - pic.rotation.z) * (1 - Math.exp(-dt * (goal ? 0.8 : 8))); }
  // where Ghost faces while standing: three-quarters to the camera (the platformer), or (the wanderer) the way the
  // little cat brain is looking: at the next idea, round about, or straight at the camera after a tap on Ghost
  let faceYaw = cam.yaw + cam.s.nudgeYaw;
  if (stroll) {
    if (stroll.faceCamera) { faceYaw = cam.yaw + 0.55; if (body.S.grounded && Math.hypot(body.vel.x, body.vel.z) < 0.15) look.s.idleT = Math.max(look.s.idleT, T.idleFaceCamera + 0.01); }
    else if (stroll.gaze !== null) faceYaw = stroll.gaze + 0.55;
  }
  look.update(dt, t, body, events, Math.hypot(input.x, input.y), faceYaw);
  apt.update(t, dt, { catPos: body.pos });
  updateWobbles(dt); updateAnims(dt); ambient(t, dt); pumpSay();
  updateStar(dt, r === 'balcony', look.pose === 'sit' || look.pose === 'loaf');
  audio.update(dt, Math.hypot(body.vel.x, body.vel.z), body.S.grounded, -body.vel.y, surfaceAt(r, p), body.S.floating);
  const heading = stroll && started ? stroll.heading() : null;
  cam.update(dt, body, input, heading ? heading.pos : null);
  updateGlints(dt);
  outside.update(t, dt, { area: r, camera, bodyPos: body.pos, look, overStreet: r === 'rooftop' && town.atEdge(p) });
  town.update(t, dt, { area: r, camera, body });
  updateFades(dt);
  fx.update(dt, t);
  renderer.render(scene, camera);
  // the wanderer's wider camera sees more of the world in some directions (the street from the park, the neighbours from
  // the upper fire escape): over the draw budget it eases in a little, and back out when there is room
  if (stroll) {
    const ri = renderer.info.render, over = ri.calls > T.strollBudgetCalls || ri.triangles > T.strollBudgetTris;
    const room = ri.calls < T.strollBudgetCalls - 8 && ri.triangles < T.strollBudgetTris - 18000;
    camBudget = over ? Math.max(T.strollBudgetMin, camBudget - dt * 0.5) : room ? Math.min(1, camBudget + dt * 0.08) : camBudget;
    cam.setStyle({ budget: camBudget });
  }
  ui.update(dt, camera, W, H);
  if (sampler) sampler.push(dt, renderer.info.render);
  if (now - lastHud > 500) { lastHud = now; ui.showPerf(stats()); }
}

// ---------- lifecycle: errors in a frame, size changes, put away and back, a lost GL context (iOS Safari) ----------
// three.js asks for the next frame only after the loop returns, so one throw would freeze the page for good: each frame
// is caught, each distinct error logged once (console and window.__errors), and the scene still drawn
const frameErrors = new Set();
function frame(now) {
  if (glLost) return;
  try {
    const [w, h] = viewSize(); if (w !== W || h !== H) resize(); // rotation, toolbars: never a frame at the old size
    loop(now);
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (!frameErrors.has(msg) && frameErrors.size < 20) {
      frameErrors.add(msg); console.error('[home] a frame threw; carrying on:', e);
      (window.__errors || (window.__errors = [])).push('frame: ' + msg + ((e && e.stack) ? ' @ ' + String(e.stack).split('\n')[1]?.trim() : ''));
    }
    try { renderer.render(scene, camera); } catch (e2) { /* the next frame tries again */ }
  }
  if (firstFrameMs === null) { firstFrameMs = Math.round(performance.now()); requestAnimationFrame(() => { splash.classList.add('gone'); setTimeout(compileAll, 30); }); }
}

let running = false, glLost = false, glTimer = 0;
const GL_WAIT_MS = 4000; // seen this long without the context coming back: reload into the same night
function start() { if (running || glLost) return; running = true; last = performance.now(); acc = 0; resumed = true; perf.reset(); renderer.setAnimationLoop(frame); }
function stop() { running = false; renderer.setAnimationLoop(null); store.flush(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) { writeResumeNote(); stop(); clearTimeout(glTimer); } else { dropResumeNote(); if (glLost) armGlWait(); else start(); } });
addEventListener('pagehide', () => { writeResumeNote(); stop(); });
addEventListener('pageshow', () => { if (!document.hidden) start(); });
// three.js rebuilds its GL state on restore and re-uploads every geometry, texture (canvas ones too), batch and the fx
// points from the copies it keeps; the lamp shadows are baked on demand, so they are asked for again
function armGlWait() { clearTimeout(glTimer); if (glLost && !document.hidden) glTimer = setTimeout(reloadSameNight, GL_WAIT_MS); }
function reloadSameNight() {
  if (!glLost || document.hidden) return;
  hud.showSystem('sys-wake');
  writeResumeNote();
  store.flush();
  const u = new URL(location.href); u.searchParams.delete('fresh'); // a test's ?fresh must not wipe the night it reloads into
  setTimeout(() => location.replace(u.href), 700);
}
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); glLost = true; stop(); hud.showSystem('sys-lost', 500); armGlWait(); });
canvas.addEventListener('webglcontextrestored', () => {
  glLost = false; clearTimeout(glTimer); hud.hideSystem();
  renderer.shadowMap.needsUpdate = true;
  if (!document.hidden) start();
});
lookReady.then(() => { renderer.shadowMap.needsUpdate = true; });
if (!document.hidden) start();

// ---------- debug API ----------
window.__ghost = {
  get ready() { return firstFrameMs !== null; },
  info: () => ({ ...stats(), firstFrameMs, glb: look.modelLoaded, running, glLost, nightT: +nightT.toFixed(3), t: +t.toFixed(3) }),
  state: () => {
    const d = S();
    return {
      started, night: d.night, glimmers: d.glimmers, found: Object.keys(d.found), foundCount: Object.keys(d.found).length, entries: ENTRIES.length,
      tonight: JSON.parse(JSON.stringify(d.tonight)), room, pose: look.pose, sleeping, cardOpen: hud.cardOpen, journalOpen: hud.journalOpen,
      pos: body.pos.toArray().map((v) => +v.toFixed(3)), vel: body.vel.toArray().map((v) => +v.toFixed(2)), grounded: body.S.grounded, floating: body.S.floating,
      events: { ...eventCounts }, camFollow: +cam.distance.toFixed(2), input: { x: +lastInput.x.toFixed(2), y: +lastInput.y.toFixed(2), jumpHeld: lastInput.jumpHeld, source: lastInput.source },
    };
  },
  things: () => things.map((t) => ({ id: t.def.id, room: t.def.room, pos: t.pos.toArray().map((v) => +v.toFixed(2)), y0: +t.y0.toFixed(2), y1: +t.y1.toFixed(2), r: +t.r.toFixed(2), secret: t.def.secret || null })),
  ghostOnScreen: () => {
    const b = new THREE.Box3(); look.root.traverse((o) => { if (o.isMesh && o.visible && o.material.visible !== false && !o.material.side) b.expandByObject(o); });
    const c = b.getCenter(new THREE.Vector3());
    const y0 = (1 - new THREE.Vector3(c.x, b.max.y, c.z).project(camera).y) / 2 * H, y1 = (1 - new THREE.Vector3(c.x, b.min.y, c.z).project(camera).y) / 2 * H;
    return { px: Math.round(Math.abs(y1 - y0)), oneIn: +(H / Math.abs(y1 - y0)).toFixed(1) };
  },
  setNightT: (v) => { nightT = v; }, star: () => ({ active: star.active, t: star.t }), nightClock: () => ({ t: +nightT.toFixed(1), late: late() }), audio,
  begin, drive: (o) => { override = o ? { x: 0, y: 0, jumpHeld: false, jumpPressed: false, source: 'test', ...o } : null; },
  stickFor: (wx, wz) => { const f = new THREE.Vector3(-Math.sin(cam.s.inputYaw), 0, -Math.cos(cam.s.inputYaw)), r = new THREE.Vector3(-f.z, 0, f.x); return [wx * r.x + wz * r.z, wx * f.x + wz * f.z]; },
  teleport: (x, y, z) => { body.teleport(new THREE.Vector3(x, y, z)); stroll?.relocate(); },
  // Revision 5: the wanderer, and taps as a test would make them (pickAt: what a tap there would do, without doing it)
  stroll, mode: PLATFORMER ? 'platformer' : 'stroll', pickAt: (x, y) => { const r = pickAt(x, y); if (r.p) r.p = r.p.toArray().map((v) => +v.toFixed(3)); return r; },
  tap: (x, y) => { const r = onTap(x, y); if (r.p) r.p = r.p.toArray().map((v) => +v.toFixed(3)); return r; }, tapCounts: () => ({ ...tapCounts }),
  screenOf: (id) => { const th = thingById[id], sp = th ? null : stroll?.targets.get(id); const c = th ? new THREE.Vector3(th.pos.x, (th.y0 + th.y1) / 2, th.pos.z) : sp ? sp.pos.clone().setY(sp.pos.y + 0.15) : null; if (!c) return null; const s = toScreen(c); return { x: +s.x.toFixed(1), y: +s.y.toFixed(1), on: s.front && s.x > 0 && s.x < W && s.y > 0 && s.y < H }; },
  screenOfPoint: (x, y, z) => { const s = toScreen(new THREE.Vector3(x, y, z)); return { x: +s.x.toFixed(1), y: +s.y.toFixed(1), on: s.front && s.x > 0 && s.x < W && s.y > 0 && s.y < H }; },
  glints: () => fx.glintsShown, heading: () => { const h = stroll?.heading(); return h ? { id: h.id, kind: h.kind, pos: h.pos.toArray().map((v) => +v.toFixed(2)) } : null; },
  sleepOfferAt: () => sleepOfferAt, starScreen: () => { if (!star.active) return null; const s = toScreen(star.head); return { x: +s.x.toFixed(1), y: +s.y.toFixed(1), on: s.front && s.x > 0 && s.x < W && s.y > 0 && s.y < H }; },
  pokeNow: (id) => { const th = thingById[id]; if (!th) return false; poke(th); return true; },
  sample: (seconds = 10) => new Promise((resolve) => {
    const dts = [], calls = [], tris = [], t0 = performance.now();
    sampler = { push: (dt, r) => { dts.push(dt); calls.push(r.calls); tris.push(r.triangles); } };
    setTimeout(() => {
      sampler = null;
      const secs = (performance.now() - t0) / 1000, sorted = [...dts].sort((a, b) => a - b), wins = perf.windows.filter((w) => w.t >= t0);
      resolve({ seconds: +secs.toFixed(2), frames: dts.length, avgFps: +(dts.length / secs).toFixed(1), minWindowFps: wins.length ? +Math.min(...wins.map((w) => w.fps)).toFixed(1) : null,
        p95ms: +(sorted[Math.floor(0.95 * sorted.length)] * 1000).toFixed(2), callsMax: Math.max(...calls), trisMax: Math.max(...tris), pixelRatio: ratio, stepDowns: perf.stepDowns });
    }, seconds * 1000);
  }),
  bench: (n = 120) => {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const one = () => { renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    for (let i = 0; i < 10; i++) one();
    const t0 = performance.now(); for (let i = 0; i < n; i++) one();
    const ms = (performance.now() - t0) / n;
    return { msPerFrame: +ms.toFixed(2), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight] };
  },
  tuning: T, renderer, scene, camera, body, cam, apt, look, controls, store, outside, town, hud, settings,
  returning: () => !!returning, ring: () => ({ active: outside.react.ring.active, t: outside.react.ring.t, pos: outside.react.ringPos().toArray() }), musicArea: () => musicArea,
};
