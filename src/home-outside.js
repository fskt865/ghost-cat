// Out of the living-room window: the fire escape and the roof above the apartment, joined to the home with no loading.
// Places both layouts (assets/layouts/fire_escape.json, rooftop.json) with src/layout.js and gives them their small
// life: moths at the lamps, steam from the chimney and the vents, washing lines moving in the wind, the party bulbs
// twinkling with nobody there, a moon balloon bobbing, haze over the city, fog that opens up outdoors. Also the
// mechanics home.js asks for: which area Ghost is in, the pigeon's puff, the sock that falls, the goldfish, the
// pinwheel, the smoke ring, the skylight, and hiding what cannot be seen (the apartment from the roof, the roof's
// front face from indoors) so the draw calls stay inside the budget.
import * as THREE from 'three';
import { loadLayout } from './layout.js';
import { getProp } from './props.js';
import { rng, glowTexture, radialTexture } from './util.js';
import { TUNING as T } from './tuning.js';

const PI = Math.PI;
// the building, from tools/stage_home_outside.py
export const BUILDING = { x0: -9.76, x1: 5.36, back: -2.572, front: 2.56, roof: 5.75, upper: 2.75 };

export async function buildOutside(scene, apt, { world, fx }) {
  const R = rng(23);
  // the apartment as it is now (to hide its insides while Ghost is up on the roof)
  const SHELL = ['floors', 'walls', 'static-cast', 'static-still', 'living-back-wall']; // the apartment's merged meshes
  const aptObjs = scene.children.filter((o) => !o.isLight && o !== apt.sky?.group && !SHELL.includes(o.name));
  const aptShell = scene.children.filter((o) => SHELL.includes(o.name));

  const fe = await loadLayout(scene, 'assets/layouts/fire_escape.json', { world, realLights: false });
  const roof = await loadLayout(scene, 'assets/layouts/rooftop.json', { world, realLights: false });
  const areas = [fe, roof];
  const placed = { ...fe.placed, ...roof.placed };
  for (const [k, o] of Object.entries(placed)) if (!apt.placed[k]) apt.placed[k] = o; else console.warn('[outside] id clash', k);

  const B = BUILDING;
  const inFootprint = (p, pad = 0) => p.x > B.x0 - pad && p.x < B.x1 + pad && p.z > B.back - pad && p.z < B.front + pad;
  const hideOnRoof = aptObjs.filter((o) => {
    const b = new THREE.Box3().setFromObject(o); if (b.isEmpty()) return false;
    const c = b.getCenter(new THREE.Vector3());
    o.userData.livingRoom = c.x > -2.95 && c.x < 1.3; // what shows through the open living-room window from outside
    return inFootprint(c) && c.y < B.upper + 0.3;
  });

  // ---------------------------------------------------------------- which area Ghost is in
  const areaAt = (p) => {
    if (p.y > B.roof - 0.45 && p.x > B.x0 - 0.3 && p.x < B.x1 + 0.3 && p.z > B.back - 1.3 && p.z < B.front + 0.3) return 'rooftop';
    if (p.z < B.back + 0.12) return 'fire-escape';
    return null;
  };

  // ---------------------------------------------------------------- washing lines: the clothes move in the wind (a vertex sway)
  const wind = { value: 0 };
  const swayLine = (obj, amount) => {
    if (!obj) return;
    obj.traverse((m) => {
      if (!m.isMesh || m.name.startsWith('sock_loose')) return;
      const mat = m.material.clone(); m.material = mat;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uWind = wind;
        sh.vertexShader = sh.vertexShader.replace('void main() {', 'uniform float uWind;\nvoid main() {')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float hang = clamp((1.79 - position.y) / 0.9, 0.0, 1.0) * step(abs(position.x), 1.45) * step(0.35, position.y);
            transformed.z += hang * ${amount.toFixed(3)} * (sin(uWind * 1.3 + position.x * 2.1) + 0.5 * sin(uWind * 2.9 + position.x * 5.0));
            transformed.x += hang * ${(amount * 0.3).toFixed(3)} * sin(uWind * 1.7 + position.x * 3.0);`);
      };
      mat.customProgramCacheKey = () => 'line-sway' + amount;
    });
  };
  swayLine(placed.socks, 0.07); swayLine(placed.roofLine, 0.1);
  const sock = placed.socks?.getObjectByName('sock_loose');
  if (sock) sock.userData.p0 = sock.position.clone();

  // ---------------------------------------------------------------- string lights: the glow twinkles a little
  const twinkle = [];
  for (const id of ['feLights', 'feBulbs', 'stringLights', 'lightString2', 'lanterns', 'partyCandles']) {
    placed[id]?.traverse((m) => { if (m.isMesh && m.material.isMeshBasicMaterial) twinkle.push({ m: m.material, c: m.material.color.clone(), ph: R() * 6, sp: 1.2 + R() * 1.6 }); });
  }
  const jarFlame = []; for (const k of fe.keeps) k.traverse((m) => { if (m.isMesh && /flame/.test(m.name)) jarFlame.push(m); });

  // ---------------------------------------------------------------- moths at the lamps (one InstancedMesh)
  const lamps = [...fe.lights, ...roof.lights].filter((l) => l.base > 0);
  const lampSpots = lamps.map((l) => l.pos);
  // a few real lights lent to the lamps nearest Ghost (every point light costs every lit pixel, indoors too); a lamp
  // that stops being one of the nearest fades out before its light moves on, so nothing pops
  const POOL = 3;
  const pool = Array.from({ length: POOL }, () => { const l = new THREE.PointLight('#ffc27a', 0, 7, 2); scene.add(l); return { light: l, lamp: null, level: 0 }; });
  // Down on the street (and up on the roof, where the street shows) the apartment cannot be seen, so its own lamps are
  // borrowed as more lendable lights: the light count, and so every shader, stays the same (src/town.js asks for it).
  const lend = { candidates: null, borrow: false, max: POOL };
  let extra = [];
  const borrow = () => {
    apt.lending.on = true;
    extra = Object.values(apt.lamps).map((l) => ({ light: l.light, lamp: null, level: 0, save: { p: l.light.position.clone(), c: l.light.color.clone(), d: l.light.distance } }));
    for (const s of extra) s.light.intensity = 0;
  };
  const giveBack = () => {
    for (const s of extra) { s.light.position.copy(s.save.p); s.light.color.copy(s.save.c); s.light.distance = s.save.d; }
    extra = []; apt.lending.on = false;
  };
  function updateLightPool(t, dt, near) {
    if (lend.borrow && !extra.length) borrow();
    const active = lend.borrow ? pool.concat(extra) : pool;
    const list = lend.candidates || lamps;
    const n = Math.min(active.length, lend.borrow ? lend.max : POOL);
    const want = [...list].sort((a, b) => a.pos.distanceToSquared(near) - b.pos.distanceToSquared(near)).slice(0, n);
    const step = (s, assignable) => {
      const keep = s.lamp && want.includes(s.lamp);
      if (assignable && !keep && s.level <= 0.01) {
        const free = want.find((w) => !active.some((o) => o.lamp === w));
        s.lamp = free || null;
        if (free) { s.light.position.copy(free.pos); s.light.color.copy(free.colour); s.light.distance = free.distance; }
      }
      const goal = assignable && s.lamp && want.includes(s.lamp) ? 1 : 0;
      s.level += Math.sign(goal - s.level) * Math.min(Math.abs(goal - s.level), dt * 2.5);
      const L = s.lamp;
      s.light.intensity = L ? L.base * s.level * (1 + L.flicker * Math.sin(t * 9.3 + L.phase) * Math.sin(t * 2.7 + L.phase * 2)) : 0;
    };
    for (const s of active) step(s, true);
    if (!lend.borrow && extra.length) { for (const s of extra) step(s, false); if (extra.every((s) => s.level <= 0.01)) giveBack(); }
  }
  const moths = await (async () => {
    const src = await getProp('moth', { fallback: () => null }); if (!src) return null;
    src.updateMatrixWorld(true);
    const parts = []; src.traverse((m) => { if (m.isMesh) { const g = m.geometry.clone().applyMatrix4(m.matrixWorld); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k); parts.push(g.index ? g.toNonIndexed() : g); } });
    const { mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js');
    const geo = mergeGeometries(parts, false);
    const per = 2, n = lampSpots.length * per;
    const mesh = new THREE.InstancedMesh(geo, src.children[0]?.material?.clone?.() || new THREE.MeshBasicMaterial({ color: '#e8dcc8' }), n);
    mesh.material.vertexColors = !!geo.attributes.color; mesh.frustumCulled = false; mesh.name = 'moths';
    scene.add(mesh);
    const list = []; lampSpots.forEach((p, i) => { for (let k = 0; k < per; k++) list.push({ c: p, r: 0.22 + R() * 0.3, sp: 1.6 + R() * 1.8, ph: R() * 6, y: -0.15 + R() * 0.35, dir: R() < 0.5 ? -1 : 1 }); });
    return { mesh, list };
  })();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();

  // ---------------------------------------------------------------- haze over the city: soft bands in a ring (one mesh)
  const haze = (() => {
    const pos = [], uv = [], idx = [];
    let n = 0;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * PI * 2 + R() * 0.2, rad = 26 + R() * 16, w = 16 + R() * 10, y0 = -4 + R() * 3, h = 7 + R() * 5;
      const cx = -2 + Math.sin(a) * rad, cz = Math.cos(a) * rad, tx = Math.cos(a), tz = -Math.sin(a);
      if (cz > 0 && Math.abs(cx + 2.2) < 16) continue;                // not across the street and the park (src/town.js)
      for (const [u, v] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) { pos.push(cx + tx * u * w, y0 + v * h, cz + tz * u * w); uv.push(u + 0.5, v); }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3); n += 4;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const x = c.getContext('2d');
    const grd = x.createLinearGradient(0, 64, 0, 0); grd.addColorStop(0, 'rgba(255,255,255,0.0)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.75)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = grd; x.fillRect(0, 0, 64, 64);
    const fade = x.createLinearGradient(0, 0, 64, 0); fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.3, 'rgba(0,0,0,0)'); fade.addColorStop(0.7, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = fade; x.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, color: '#6a5a8c', transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.renderOrder = -1; m.name = 'haze'; scene.add(m);
    return m;
  })();

  // ---------------------------------------------------------------- the moon in the roof puddle
  const puddleMoon = (() => {
    const p = placed.puddle; if (!p) return null;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(255,250,230,0.95)'], [0.35, 'rgba(255,240,210,0.8)'], [0.42, 'rgba(255,240,210,0.15)'], [1, 'rgba(255,240,210,0)']]), transparent: true, depthWrite: false, opacity: 0.85 }));
    s.position.copy(p.getWorldPosition(new THREE.Vector3())).add(new THREE.Vector3(0.12, 0.012, -0.1)); s.renderOrder = 2; scene.add(s);
    return s;
  })();
  const ripple = await (async () => { const r = await getProp('assets/sky/puddle_ring.glb', { fallback: () => null }); if (!r) return null; r.visible = false; scene.add(r); return { obj: r, t: 9 }; })();

  // ---------------------------------------------------------------- the smoke ring (the chimney is working on something)
  const ring = (() => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.055, 8, 24), new THREE.MeshBasicMaterial({ color: '#efe8ff', transparent: true, opacity: 0, depthWrite: false }));
    m.visible = false; m.name = 'smoke-ring'; m.rotation.order = 'YXZ'; scene.add(m);
    return { mesh: m, active: false, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3() };
  })();
  const chimneyTop = placed.chimney ? (placed.chimney.getObjectByName('anchor_smoke') || placed.chimney).getWorldPosition(new THREE.Vector3()) : null;
  if (chimneyTop && !placed.chimney.getObjectByName('anchor_smoke')) chimneyTop.y += 1.6;
  const startRing = () => {
    if (!chimneyTop) return;
    ring.active = true; ring.t = 0; ring.mesh.visible = true;
    ring.from.copy(chimneyTop);
    // drifts out over the roof, toward the party, and hangs at hop height for a while
    ring.to.set(chimneyTop.x + 1.05, B.roof + T.height * 0.5 + T.smokeRingHang, chimneyTop.z + 0.75);
  };
  const ringPos = () => ring.mesh.position;
  function updateRing(dt) {
    if (!ring.active) return;
    ring.t += dt;
    const k = Math.min(1, ring.t / 2.2), e = k * k * (3 - 2 * k);
    ring.mesh.position.lerpVectors(ring.from, ring.to, e);
    ring.mesh.position.y += Math.sin(ring.t * 1.3) * 0.04;
    ring.mesh.rotation.set(PI / 2 - 0.35 * (1 - e) + Math.sin(ring.t * 0.9) * 0.08, ring.t * 0.4, 0); // a flat hoop, gently rocking
    const life = 11;
    ring.mesh.material.opacity = Math.min(1, ring.t * 2) * Math.min(1, (life - ring.t) / 2) * 0.75;
    ring.mesh.scale.setScalar(0.7 + e * 0.4 + ring.t * 0.015);
    if (ring.t > life) { ring.active = false; ring.mesh.visible = false; }
  }

  // ---------------------------------------------------------------- the pigeon puffs up; the sock falls on Ghost's head
  const pigeon = placed.pigeon;
  const pigeonState = { puff: 0, goal: 0 };
  const sockHat = await (async () => {
    const h = await getProp('assets/props/cozy/sock.glb', { fallback: () => null }); if (!h) return null;
    h.scale.setScalar(1.25); h.visible = false; return h;
  })();
  const hat = { on: false, t: 0, fall: null };
  function dropSock(look) {
    if (!sock || !sockHat || hat.on || hat.fall) return;
    const from = sock.getWorldPosition(new THREE.Vector3());
    sock.visible = false;
    hat.fall = { t: 0, from, obj: null };
    const vis = look.root.children[0]?.children[0]?.children[0] || look.root; // turn > bob > visual
    sockHat.position.set(0, T.height * 0.86, 0.03); sockHat.rotation.set(0.15, 0.5, 0.35);
    hat.parent = vis;
  }
  function updateHat(dt, look, bodyPos) {
    if (hat.fall) {
      hat.fall.t += dt / 0.55;
      if (!hat.fall.obj) { hat.fall.obj = sockHat.clone(); hat.fall.obj.visible = true; scene.add(hat.fall.obj); }
      const k = Math.min(1, hat.fall.t), to = bodyPos.clone().setY(bodyPos.y + T.height * 0.95);
      hat.fall.obj.position.lerpVectors(hat.fall.from, to, k); hat.fall.obj.position.y += Math.sin(k * PI) * 0.15;
      hat.fall.obj.rotation.set(k * 5, k * 3, 0);
      if (k >= 1) { scene.remove(hat.fall.obj); hat.fall = null; hat.parent.add(sockHat); sockHat.visible = true; hat.on = true; hat.t = 0; }
    }
    if (hat.on) { hat.t += dt; if (hat.t > 45) { sockHat.visible = false; hat.on = false; } }
  }
  const resetNight = () => {
    if (sock) { sock.visible = true; sock.position.copy(sock.userData.p0); }
    sockHat && (sockHat.visible = false); hat.on = false;
    pigeonState.goal = 0;
  };

  // ---------------------------------------------------------------- the goldfish comes to the glass
  const fish = placed.goldfish?.getObjectByName('fish');
  const fishState = { t: 0, near: 0, p0: fish ? fish.position.clone() : null };
  const pinwheel = placed.pinwheel?.getObjectByName('wheel');
  const pin = { speed: 0.4 };
  const vane = placed.vane?.getObjectByName('vane');

  // ---------------------------------------------------------------- steam: the chimney, the vents
  const steamSpots = [];
  for (const id of ['chimney', 'roofVent']) { const o = placed[id]; if (!o) continue; const a = o.getObjectByName('anchor_smoke') || o.getObjectByName('anchor_steam'); steamSpots.push({ p: a ? a.getWorldPosition(new THREE.Vector3()) : o.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 1.0, 0)), t: R(), every: id === 'chimney' ? 0.32 : 0.6 }); }

  // ---------------------------------------------------------------- fog: the night opens up outdoors
  const FOG = { inside: [10, 48], 'fire-escape': [12, 62], rooftop: [16, 95], street: [11, 52], alley: [8, 40], park: [11, 50], 'corner-shop': [6, 24] };
  const TOWN = new Set(['street', 'alley', 'park', 'corner-shop']);
  const fogNow = { near: scene.fog.near, far: scene.fog.far };

  // ---------------------------------------------------------------- per frame
  let onRoofShown = 'in', insideHidden = false;
  function update(t, dt, { area, camera, bodyPos, look, overStreet = false }) {
    wind.value = t;
    const town = TOWN.has(area);
    updateLightPool(t, dt, area === 'rooftop' || area === 'fire-escape' || town ? bodyPos : camera.position);
    for (const a of areas) a.update(t, dt, camera);
    for (const w of twinkle) w.m.color.copy(w.c).multiplyScalar(0.82 + 0.18 * Math.sin(t * w.sp + w.ph) * Math.sin(t * 0.7 + w.ph * 2));
    for (const f of jarFlame) f.scale.y = 1 + Math.sin(t * 13 + f.id) * 0.12;
    // moths
    if (moths) moths.list.forEach((m, i) => {
      const a = t * m.sp * m.dir + m.ph;
      v3.set(m.c.x + Math.cos(a) * m.r, m.c.y + m.y + Math.sin(t * 3.1 + m.ph) * 0.12, m.c.z + Math.sin(a) * m.r * 0.8);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a * m.dir + (m.dir > 0 ? PI : 0));
      s3.set(0.4 + Math.abs(Math.sin(t * 30 + i)) * 0.9, 1, 1);
      moths.mesh.setMatrixAt(i, m4.compose(v3, q, s3));
    });
    if (moths) moths.mesh.instanceMatrix.needsUpdate = true;
    // steam
    for (const s of steamSpots) { s.t -= dt; if (s.t <= 0) { s.t = s.every; fx.burst(s.p, '#efe9ff', 1, 0.06, { kind: 'steam' }); } }
    // the washing line's loose sock swings; the pigeon breathes (and puffs); the balloon bobs; the pinwheel turns
    if (sock && sock.visible) sock.rotation.z = Math.sin(t * 2.3) * 0.25;
    if (pigeon) {
      pigeonState.puff += (pigeonState.goal - pigeonState.puff) * (1 - Math.exp(-dt * 5));
      const breathe = 1 + Math.sin(t * 2.2) * 0.02, pf = 1 + pigeonState.puff * 0.75;
      pigeon.scale.set(breathe * pf, breathe * (1 + pigeonState.puff * 0.45), breathe * pf);
      const head = pigeon.getObjectByName('head'); if (head) head.rotation.x = Math.max(0, Math.sin(t * 1.4)) ** 8 * 0.5;
    }
    if (placed.balloon) { placed.balloon.position.y = (placed.balloon.userData.y0 ??= placed.balloon.position.y) + Math.sin(t * 0.9) * 0.05; placed.balloon.rotation.y = Math.sin(t * 0.5) * 0.4; roof.sync(placed.balloon); }
    if (placed.lanterns) { placed.lanterns.rotation.z = Math.sin(t * 0.8) * 0.03; roof.sync(placed.lanterns); }
    if (pinwheel) { pin.speed = Math.max(0.6, pin.speed - dt * 1.5); pinwheel.rotation.z -= dt * pin.speed * 3; }
    if (vane) vane.rotation.y = Math.sin(t * 0.21) * 0.6 + Math.sin(t * 0.07) * 1.2;
    if (fish && fishState.p0) {
      fishState.t += dt;
      const near = fishState.near;
      fish.position.set(fishState.p0.x + Math.sin(fishState.t * 0.6) * 0.05 * (1 - near), fishState.p0.y + Math.sin(fishState.t * 1.1) * 0.01, fishState.p0.z + Math.cos(fishState.t * 0.6) * 0.04 * (1 - near) + near * 0.06);
      fish.rotation.y = near > 0.5 ? -PI / 2 : Math.atan2(Math.cos(fishState.t * 0.6), -Math.sin(fishState.t * 0.6));
    }
    if (ripple && ripple.obj.visible) { ripple.t += dt; const k = ripple.t / 1.4; ripple.obj.scale.setScalar(0.5 + k * 2.2); ripple.obj.traverse((m) => { if (m.isMesh) { m.material.transparent = true; m.material.opacity = Math.max(0, 1 - k); } }); if (k >= 1) ripple.obj.visible = false; }
    if (puddleMoon) puddleMoon.material.opacity = 0.75 + Math.sin(t * 0.9) * 0.08;
    updateRing(dt);
    updateHat(dt, look, bodyPos);

    // fog and the far haze
    const [fn, ff] = FOG[area] || FOG.inside;
    fogNow.near += (fn - fogNow.near) * (1 - Math.exp(-dt * 1.2)); fogNow.far += (ff - fogNow.far) * (1 - Math.exp(-dt * 1.2));
    scene.fog.near = fogNow.near; scene.fog.far = fogNow.far;
    haze.visible = !indoorsNow;

    // hide what cannot be seen: the apartment's insides from the roof; the roof's front face from indoors
    // (from the fire escape only the living room shows, through its open window)
    const view = town || (area === 'rooftop' && camera.position.y > B.roof - 0.3) ? 'roof' : camera.position.z < B.back - 0.3 ? 'back' : 'in';
    if (view !== onRoofShown) {
      onRoofShown = view;
      for (const o of hideOnRoof) o.visible = view === 'in' || (view === 'back' && o.userData.livingRoom);
      for (const o of aptShell) o.visible = view !== 'roof'; // under the roof: behind the parapets and the walls
      if (apt.outsideBack) apt.outsideBack.visible = view !== 'roof';
      // the little moon that hangs just outside the bedroom window only works from inside
      if (apt.windowMoon) apt.windowMoon.material.visible = view === 'in';
    }
    // indoors = Ghost in one of the rooms (the dollhouse camera often hangs just outside the open front)
    const inside = area !== 'rooftop' && area !== 'fire-escape' && !town;
    setIndoors(inside);
    setRoofBelow(camera.position.z < B.back - 0.3 && camera.position.y < B.roof - 0.6);
    setFeAbove(area === 'rooftop' && camera.position.z > B.back + 0.6 && camera.position.y > B.roof);
    if (inside !== insideHidden) {
      insideHidden = inside;
      for (const m of [...fe.insideMeshes, ...roof.insideMeshes]) m.visible = !inside;
      // outdoors the big brick faces draw first, so the rooms behind them are rejected by depth, not shaded and covered
      for (const m of [fe.meshes.toon, roof.meshes.toon]) if (m) m.renderOrder = inside ? 0 : -1;
    }
    // down on the street: the back of the building (the fire escape) and the roof's own small things are out of sight
    // behind the building and the parapets; the roof's lights still glow up there
    if (town || overStreet) { for (const o of townHide) o.visible = false; townWas = true; }
    else if (townWas) { townWas = false; /* back up: the roof's things and the fire escape come back */ for (const o of townHide) o.visible = true; indoorsNow = !inside; setIndoors(inside); }
  }

  // ---------------------------------------------------------------- indoors: the outside is hidden but for what the windows show
  const drawables = (a) => [...Object.values(a.meshes), ...a.staticMeshes, ...a.propBatch.batches, a.halos, a.poolMesh].filter(Boolean);
  // (through the windows: the across building, the window landing and its crates and herbs; nothing small or moving)
  const indoorHide = [...drawables(roof), ...roof.keeps, ...roof.fadeables, ...fe.keeps, fe.halos, fe.poolMesh, ...fe.fadeables, moths?.mesh, haze].filter(Boolean);
  let indoorsNow = false;
  const setIndoors = (on) => { if (on === indoorsNow) return; indoorsNow = on; for (const o of indoorHide) o.visible = !on; roofBelowNow = null; feAboveNow = null; };
  // down on the fire escape the roof's own things are out of sight behind the parapet
  const roofThings = [...roof.staticMeshes, ...roof.propBatch.batches, roof.halos, roof.poolMesh, ...roof.keeps].filter(Boolean);
  let roofBelowNow = false, feAboveNow = false;
  // up on the roof the fire escape's small things are below the back parapet
  const feSmall = [...fe.keeps, fe.halos, fe.poolMesh].filter(Boolean);
  const setFeAbove = (on) => { if (on === feAboveNow) return; feAboveNow = on; for (const o of feSmall) o.visible = !on && !indoorsNow; };
  const townHide = [...drawables(fe), ...fe.keeps, ...fe.fadeables, ...roof.staticMeshes, ...roof.propBatch.batches, ...roof.keeps, roof.poolMesh, moths?.mesh].filter(Boolean);
  let townWas = false;
  const setRoofBelow = (on) => { if (on === roofBelowNow) return; roofBelowNow = on; for (const o of roofThings) o.visible = !on && !indoorsNow; };

  // ---------------------------------------------------------------- reactions home.js triggers
  const react = {
    pigeonPuff: () => { pigeonState.goal = 1; setTimeout(() => (pigeonState.goal = 0), 6000); },
    sockLoose: (n) => { if (sock) { sock.rotation.x = 0.2 * n; } },
    dropSock,
    pinwheel: (n) => { pin.speed = 1.5 + n * 2.5; },
    fishNear: (on) => { fishState.near = on ? 1 : 0; },
    ripple: () => { if (ripple && placed.puddle) { ripple.obj.position.copy(placed.puddle.getWorldPosition(new THREE.Vector3())).setY(B.roof + 0.008); ripple.obj.visible = true; ripple.t = 0; } },
    startRing, ring, ringPos,
  };

  return {
    fe, roof, areas, placed, areaAt, update, react, resetNight, lend, lampsHome: lamps,
    zones: [...fe.zones, ...roof.zones], pits: [...fe.pits, ...roof.pits],
    fadeables: [...fe.fadeables, ...roof.fadeables],
    lamps: lampSpots, haze,
    sync: (o) => { for (const a of areas) if (a.propBatch.has(o)) a.propBatch.syncObject(o); },
    batched: (o) => areas.some((a) => a.propBatch.has(o)),
    chimneyTop,
  };
}
