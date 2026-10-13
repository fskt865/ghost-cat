// Greybox test course for the controller, assembled from the real outdoor kit (assets/outdoor/):
// start on a rooftop, hop two gaps, climb a fire escape, drop to the street, cross to the park,
// hop up the hill. The four cats sit along the way. 1 unit = 1 metre; the route runs along +x.
// Collision is a separate, simpler world: solid blocks for buildings, the real meshes for things
// you stand on or bump into, thin decks for the fire escape (Ghost drifts through railings).
import * as THREE from 'three';
import { Baker, rng, mix, toonMaterial, glowTexture, clamp } from './util.js';
import { getProp, preload } from './props.js';
import { CollisionWorld } from './physics.js';
import { buildSky } from './sky.js';
import { batchStatic } from './batch.js';
import { createPropBatch } from './prop-batch.js';

const PI = Math.PI;
const K = (n) => `assets/outdoor/${n}.glb`;

// Buildings: x0, x1, z0, z1, storeys (3 m each). Roof height = storeys * 3.
const BUILDINGS = {
  A: { x0: -2, x1: 8, z0: -5, z1: 3, storeys: 2 },
  B: { x0: 9.6, x1: 17.6, z0: -5, z1: 3, storeys: 2 },
  C: { x0: 19.6, x1: 25.6, z0: -5, z1: 3, storeys: 2 },
  D: { x0: 25.6, x1: 31.6, z0: -5, z1: 3, storeys: 3 },
};
const STREET = { sidewalkW: 31.6, roadX0: 34.1, roadX1: 40.5, sidewalkE: 43.0, z0: -10, z1: 10 };
const PARK = { x0: 43.0, x1: 68, z0: -10, z1: 10, top: 0.15 };
// fire-escape decks on D's west wall: [deck height, z centre]
const LANDINGS = [[6.85, -3.3], [7.7, -1.15], [8.55, 1.0]];
// the hill: [cx, cz, radius, top]
const HILL = [[59, 0, 4.2, 0.95], [60, -0.6, 3.0, 1.8], [60.6, -1.0, 2.0, 2.65], [61, -1.2, 1.25, 3.45]];

export async function buildCourse(scene) {
  const R = rng(5);
  const world = new CollisionWorld();
  const camWorld = new CollisionWorld(); // only big things block the camera (buildings, ground, the hill)
  const toon = toonMaterial({ vertexColors: true });
  const statics = [];   // roots to batch
  const bumpables = []; // walk into these: glow + wobble (+ a line)
  const lights = [];
  const fadeables = []; // big things that fade out when they come between the camera and Ghost
  const sky = buildSky(scene, { fog: '#2b2348', fogNear: 30, fogFar: 110, centre: new THREE.Vector3(32, 0, 0), moonPos: new THREE.Vector3(40, 34, -80),
    cityRadius: [62, 40], cityArc: PI, cityCount: 44, cityLift: 4 });

  await preload(['wall_4m', 'wall_4m_window', 'wall_2m', 'wall_2m_window', 'wall_2m_door', 'wall_pillar', 'window_lit', 'window_dark', 'parapet_2m', 'parapet_corner',
    'chimney', 'roof_vent', 'antenna', 'washing_line', 'deck_chair', 'skylight', 'water_tower', 'stair_hut', 'pinwheel', 'fire_escape_landing', 'fire_escape_ladder',
    'street_4m', 'crosswalk_4m', 'sidewalk_4m', 'shop_front', 'laundromat_front', 'bench', 'bike', 'hydrant', 'mailbox', 'newspaper_box', 'trash_bins', 'vending_machine',
    'tree_pit', 'park_gate', 'park_lamp', 'bush_large', 'bush_medium', 'bush_small', 'flower_bed', 'grass_tuft', 'tree_round', 'tree_tall', 'tree_weeping', 'pond_water',
    'pond_corner', 'swing_set', 'moonflowers', 'puddle'].map(K));

  // place a kit piece. collide: 'mesh' (its real geometry) | 'none'; bump: { line, colour } makes it react
  async function put(name, x, y, z, rot = 0, { collide = 'none', bump = null, keep = false, scale = 1, noCollideNodes = [] } = {}) {
    const o = await getProp(K(name), { scale });
    o.position.set(x, y, z); o.rotation.y = rot; scene.add(o);
    o.updateMatrixWorld(true);
    for (const n of noCollideNodes) o.getObjectByName(n)?.traverse((c) => (c.userData.noCollide = true));
    if (collide === 'mesh') world.addObject(o);
    if (bump) { addBump(o, bump); keep = true; }
    if (!keep) statics.push(o);
    return o;
  }
  function addBump(o, { line = null, colour = '#ffe2a0', cat = false, radius = null }) {
    const b = new THREE.Box3().setFromObject(o), c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
    bumpables.push({ obj: o, centre: new THREE.Vector3(c.x, b.min.y, c.z), radius: radius ?? Math.max(0.25, Math.max(sz.x, sz.z) * 0.5), height: sz.y, line, colour, cat, t: -9 });
  }

  // ------------------------------------------------------------------ buildings
  const greybox = new Baker();
  const facade = async (x0, x1, z0, z1, face, y0, storeys, shopAt = null, shopName = 'shop_front') => {
    // face: 'S' (z1, +z), 'N' (z0, -z), 'E' (x1, +x), 'W' (x0, -x)
    const along = face === 'S' || face === 'N' ? [x0, x1] : [z0, z1];
    const rot = { S: 0, N: PI, E: PI / 2, W: -PI / 2 }[face];
    const at = (u, y) => (face === 'S' ? [u, y, z1] : face === 'N' ? [u, y, z0] : face === 'E' ? [x1, y, u] : [x0, y, u]);
    const L = along[1] - along[0];
    for (let s = 0; s < storeys; s++) {
      const y = y0 + s * 3;
      let u = along[0];
      const sign = face === 'N' || face === 'E' ? 1 : 1;
      while (u < along[1] - 0.01) {
        const rest = along[1] - u, len = rest >= 4 ? 4 : 2;
        const shop = shopAt && s === 0 && Math.abs(u - shopAt) < 0.01 && len === 4;
        const window = !shop && face !== 'N' && R() < 0.8; // the backs of buildings stay plain
        const name = shop ? shopName : len === 4 ? (window ? 'wall_4m_window' : 'wall_4m') : (window ? 'wall_2m_window' : 'wall_2m');
        const cu = u + len / 2;
        const [px, py, pz] = at(cu, y);
        const w = await put(name, px, py, pz, rot);
        if (window) {
          const offs = len === 4 ? [-1, 1] : [0];
          for (const ox of offs) {
            const v = new THREE.Vector3(ox, 0.9, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rot).add(w.position);
            await put(R() < 0.45 ? 'window_lit' : 'window_dark', v.x, v.y, v.z, rot);
          }
        }
        u += len;
      }
      void sign; void L;
    }
  };
  for (const [key, b] of Object.entries(BUILDINGS)) {
    const top = b.storeys * 3;
    // solid block for collision, a tar roof on top
    world.addBox((b.x0 + b.x1) / 2, (top - 0.6) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0, top + 0.6, b.z1 - b.z0); // reaches below the street
    camWorld.addBox((b.x0 + b.x1) / 2, (top - 0.6) / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0, top + 0.6, b.z1 - b.z0);
    greybox.add(new THREE.BoxGeometry(b.x1 - b.x0 - 0.02, 0.06, b.z1 - b.z0 - 0.02, 8, 1, 8), (x, y, z) => mix('#4b4160', '#5a4e6c', (Math.sin(x * 1.3) * Math.sin(z * 1.7) + 1) * 0.25), { pos: [(b.x0 + b.x1) / 2, top - 0.02, (b.z0 + b.z1) / 2] });
    // inner fill so the block never shows through gaps in the facade
    greybox.add(new THREE.BoxGeometry(b.x1 - b.x0 - 0.3, top - 0.1, b.z1 - b.z0 - 0.3), '#3a2c3c', { pos: [(b.x0 + b.x1) / 2, (top - 0.1) / 2, (b.z0 + b.z1) / 2] });
    const faces = key === 'C' ? ['S', 'N', 'W'] : key === 'D' ? ['S', 'N', 'E'] : ['S', 'N', 'E', 'W'];
    for (const f of faces) await facade(b.x0, b.x1, b.z0, b.z1, f, 0, b.storeys, key === 'D' && f === 'E' ? b.z0 : key === 'B' && f === 'S' ? b.x0 : null, key === 'B' ? 'laundromat_front' : 'shop_front');
    if (key === 'D') await facade(b.x0, b.x1, b.z0, b.z1, 'W', 6, 1); // the storey above roof C
    for (const [cx, cz] of [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]]) for (let s = 0; s < b.storeys; s++) await put('wall_pillar', cx, s * 3, cz);
  }

  // parapets: along the roof edges, but not where the route crosses
  const parapetRun = async (x0, z0, x1, z1, y, rot) => {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.round(L / 2);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; await put('parapet_2m', x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, rot, { collide: 'mesh' }); }
  };
  { const b = BUILDINGS.A, y = 6;
    await parapetRun(b.x0, b.z0, b.x1, b.z0, y, PI); await parapetRun(b.x0, b.z1, b.x1, b.z1, y, 0); await parapetRun(b.x0, b.z0, b.x0, b.z1, y, -PI / 2); }
  { const b = BUILDINGS.B, y = 6;
    await parapetRun(b.x0, b.z0, b.x1, b.z0, y, PI); await parapetRun(b.x0, b.z1, b.x1, b.z1, y, 0); }
  { const b = BUILDINGS.C, y = 6;
    await parapetRun(b.x0, b.z0, b.x1, b.z0, y, PI); await parapetRun(b.x0, b.z1, b.x1, b.z1, y, 0); }
  { const b = BUILDINGS.D, y = 9;
    await parapetRun(b.x0, b.z0, b.x1, b.z0, y, PI); await parapetRun(b.x0, b.z1, b.x1, b.z1, y, 0); }

  // ------------------------------------------------------------------ rooftop A: the start
  await put('chimney', 2.4, 6, -3.5, 0, { collide: 'mesh', bump: { line: 'the chimney is warm. good chimney.' } });
  const towerA = await put('water_tower', 0.2, 6, -3.3, 0, { collide: 'mesh', keep: true });     // deck at +2 m: chimney, then a hop
  fadeables.push(towerA);
  await put('roof_vent', 5.0, 6, -3.6, 0, { collide: 'mesh', bump: { line: 'warm air. smells like someone\'s dinner.' } });
  await put('antenna', -1.0, 6, 2.2, 0.4, { bump: { line: 'static. then, almost a song.' } });
  await put('washing_line', 3.4, 6, -1.0, 0, { bump: { line: 'socks. drying. or pretending to.', colour: '#ffd0e0' } });
  await put('deck_chair', 6.6, 6, 2.2, -0.6, { collide: 'mesh', bump: { line: 'a deck chair that kept some of the sun.' } });
  const lampA = await put('park_lamp', 6.9, 6, -3.8, 0, { collide: 'mesh', keep: true });
  lights.push(lampA);

  // rooftop B
  await put('skylight', 12.2, 6, -1.6, 0, { collide: 'mesh', bump: { line: 'a glow down there. a cat asleep in a sink.' } });
  await put('roof_vent', 15.6, 6, 1.6, 0, { collide: 'mesh' });
  await put('pinwheel', 16.4, 6, -3.4, 0, { bump: { line: 'whirr.', colour: '#ffe0f0' } });
  fadeables.push(await put('stair_hut', 10.8, 6, 2.9, PI, { collide: 'mesh', keep: true }));

  // rooftop C
  await put('chimney', 21.0, 6, 2.0, 0, { collide: 'mesh' });
  await put('deck_chair', 23.4, 6, -4.2, 0.3, { collide: 'mesh' });

  // the fire escape on D's west wall: decks you can hop up (railings let a ghost through)
  for (const [deckY, z] of LANDINGS) {
    await put('fire_escape_landing', BUILDINGS.D.x0, deckY - 0.08, z, -PI / 2);
    world.addBox(BUILDINGS.D.x0 - 0.52, deckY - 0.05, z, 1.04, 0.1, 2.06);
    // storage crates packed under each deck, so nobody wanders underneath and gets stuck
    const h = deckY - 0.1 - 6;
    world.addBox(BUILDINGS.D.x0 - 0.5, 6 + h / 2, z, 1.0, h, 2.0);
    for (let k = 0; k < Math.ceil(h / 0.5); k++) {
      const hh = Math.min(0.5, h - k * 0.5), jx = (R() - 0.5) * 0.06;
      greybox.add(new THREE.BoxGeometry(0.98 + jx, hh - 0.02, 1.96, 2, 1, 3), (x, y, zz) => mix('#7d5b42', '#9c7553', (Math.floor((zz + 10) * 2.5) % 2) * 0.5 + (y % 0.5) * 0.4), { pos: [BUILDINGS.D.x0 - 0.5 + jx, 6 + k * 0.5 + hh / 2, z], wobble: 0.01, seed: k + z });
    }
  }
  await put('fire_escape_ladder', BUILDINGS.D.x0 - 0.75, 6.85 - 0.08, -2.2, -PI / 2);
  await put('fire_escape_ladder', BUILDINGS.D.x0 - 0.75, 7.7 - 0.08, -0.05, -PI / 2);

  // rooftop D: the high place before the drop
  fadeables.push(await put('water_tower', 27.6, 9, -3.4, 0.3, { collide: 'mesh', keep: true }));
  await put('antenna', 30.8, 9, 2.0, -0.5);

  // ------------------------------------------------------------------ the street (runs along z)
  for (let z = STREET.z0 + 2; z < STREET.z1; z += 4) {
    await put(z === 2 ? 'crosswalk_4m' : 'street_4m', (STREET.roadX0 + STREET.roadX1) / 2, 0, z, PI / 2, { collide: 'mesh' });
    await put('sidewalk_4m', STREET.sidewalkW + 1.25, 0, z, PI / 2, { collide: 'mesh' });
    await put('sidewalk_4m', STREET.roadX1 + 1.25, 0, z, PI / 2, { collide: 'mesh' });
  }
  // the shop and laundromat on D's ground floor were placed by the facade; dress the sidewalk
  await put('bench', 32.4, 0.15, -6.2, PI / 2, { collide: 'mesh', bump: { line: 'a bench. a good bench.' } });
  await put('trash_bins', 32.2, 0.15, 5.2, PI / 2, { collide: 'mesh', bump: { line: 'clang. nobody heard. good.' } });
  await put('mailbox', 33.6, 0.15, -3.4, PI / 2, { collide: 'mesh', bump: { line: 'knock knock. something rustled in there.' } });
  await put('hydrant', 33.7, 0.15, 3.8, 0, { collide: 'mesh', bump: { line: 'smells like every dog in town.' } });
  await put('newspaper_box', 32.2, 0.15, -8.6, PI / 2, { collide: 'mesh', bump: { line: 'yesterday\'s news. still news to me.' } });
  await put('bike', 41.0, 0.15, -6.5, PI / 2, { collide: 'mesh', bump: { line: 'ding!', colour: '#d8f0ff' } });
  await put('vending_machine', 42.4, 0.15, 6.2, -PI / 2, { collide: 'mesh', bump: { line: 'the machine is thinking about tomorrow.', colour: '#d8f0ff' } });
  await put('puddle', 37.0, 0.005, -4.5, 0.4);
  const lampS = await put('../props/lamppost', 33.6, 0.15, 1.2, 0, { collide: 'mesh', keep: true, bump: { line: 'the lamp buzzed. the moths are paying attention.' } });
  lights.push(lampS); fadeables.push(lampS);

  // ------------------------------------------------------------------ the park
  greybox.add(new THREE.BoxGeometry(PARK.x1 - PARK.x0, 0.6, PARK.z1 - PARK.z0, 24, 1, 10), (x, y, z) => mix('#3f6b4a', '#557f52', (Math.sin(x * 0.7) * Math.sin(z * 0.9) + 1) * 0.5), { pos: [(PARK.x0 + PARK.x1) / 2, PARK.top - 0.3, 0] });
  world.addBox((PARK.x0 + PARK.x1) / 2, PARK.top - 0.3, 0, PARK.x1 - PARK.x0, 0.6, PARK.z1 - PARK.z0);
  const gate = await put('park_gate', PARK.x0 + 0.6, PARK.top, 0, PI / 2, { collide: 'mesh', noCollideNodes: ['gate_L', 'gate_R'], keep: true });
  fadeables.push(gate);
  gate.getObjectByName('gate_L')?.rotateY(-1.3); gate.getObjectByName('gate_R')?.rotateY(1.3); // standing open
  fadeables.push(await put('tree_round', 47.5, PARK.top, 5.5, 0.4, { keep: true }));
  world.addBox(47.5, PARK.top + 1.2, 5.5, 0.35, 2.4, 0.35);
  fadeables.push(await put('tree_tall', 49.5, PARK.top, -6.5, 0, { keep: true }));
  world.addBox(49.5, PARK.top + 1.5, -6.5, 0.3, 3, 0.3);
  fadeables.push(await put('tree_weeping', 62.5, PARK.top, 6.5, 1.0, { keep: true }));
  world.addBox(62.5, PARK.top + 1.2, 6.5, 0.35, 2.4, 0.35);
  await put('bush_large', 46.0, PARK.top, -3.4, 0.3, { collide: 'mesh', bump: { line: 'something rustled. it was me.', colour: '#c8ffb8' } });
  await put('bush_medium', 52.6, PARK.top, -8.0, 0, { collide: 'mesh', bump: { line: 'leaf. leaf. leaf. one moth.', colour: '#c8ffb8' } });
  await put('bush_small', 55.0, PARK.top, 4.8, 0, { collide: 'mesh' });
  await put('flower_bed', 46.6, PARK.top, 2.8, 0, { collide: 'mesh', bump: { line: 'the flowers are closed. maybe later.', colour: '#ffd0f0' } });
  await put('moonflowers', 57.0, PARK.top, 5.8, -0.4, { bump: { line: 'moonflowers. they are thinking about it.', colour: '#fff4c8' } });
  await put('bench', 51.0, PARK.top, -2.2, 0, { collide: 'mesh' });
  await put('swing_set', 52.4, PARK.top, -6.4, 0, { bump: { line: 'whee. for the swing.' } });
  const lampP = await put('park_lamp', 49.0, PARK.top, 1.0, 0, { collide: 'mesh', keep: true });
  lights.push(lampP);
  // the pond
  { const cx = 52.0, cz = 5.0;
    await put('pond_water', cx, PARK.top, cz, 0);
    for (let i = 0; i < 4; i++) await put('pond_corner', cx, PARK.top, cz, (i * PI) / 2, { collide: 'mesh' });
    world.addBox(cx, PARK.top - 0.3, cz, 4.2, 0.1, 4.2); // the pond floor
  }
  for (let i = 0; i < 26; i++) await put('grass_tuft', PARK.x0 + 2 + R() * 22, PARK.top, PARK.z0 + 1 + R() * 18, R() * 6);

  // the hill: stacked grassy terraces, each an easy hop, plus a gentle ramp onto the first
  for (const [cx, cz, r, top] of HILL) {
    const h = top - PARK.top + 0.3;
    const g = new THREE.CylinderGeometry(r, r * 1.04, h, 28, 2);
    const m = new THREE.Matrix4().makeTranslation(cx, PARK.top - 0.3 + h / 2, cz);
    world.addGeometry(g, m); camWorld.addGeometry(g, m);
    greybox.add(g.clone(), (x, y) => (y > top - 0.06 ? mix('#5a8a55', '#6c9a5c', R()) : mix('#4a3b34', '#5d4a3e', R())), { pos: [cx, PARK.top - 0.3 + h / 2, cz], wobble: 0.03, seed: cx });
  }
  { // ramp (about 15 degrees) from the park lawn onto the first terrace
    const len = 2.8, rise = HILL[0][3] - PARK.top, w = 1.6;
    const g = new THREE.BoxGeometry(len, 0.2, w);
    const ang = Math.atan2(rise, len);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(HILL[0][0] - HILL[0][2] - len / 2 + 0.3, PARK.top + rise / 2 - 0.08, 1.8), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, ang)), new THREE.Vector3(1, 1, 1));
    world.addGeometry(g, m);
    const vis = new THREE.Mesh(g.clone().applyMatrix4(m), toonMaterial({ color: '#7b6450' }));
    scene.add(vis);
  }
  const top = HILL[HILL.length - 1];
  const lampH = await put('park_lamp', top[0] + 0.5, top[3], top[1] - 0.5, 0, { collide: 'mesh', keep: true });
  lights.push(lampH);
  await put('bench', top[0] + 0.55, top[3], top[1] + 0.75, PI + 0.6, { collide: 'mesh' });

  // ------------------------------------------------------------------ cats along the way
  const cats = [];
  const cat = async (name, x, y, z, rot, pose, line) => {
    const o = await getProp(`assets/cats/${name}.glb`);
    o.position.set(x, y, z); o.rotation.y = rot; scene.add(o);
    o.traverse((m) => { if (m.isMesh && m.morphTargetDictionary && m.morphTargetDictionary[pose] !== undefined) m.morphTargetInfluences[m.morphTargetDictionary[pose]] = 1; });
    addBump(o, { line, cat: true, colour: '#ffb3cf', radius: 0.35 });
    cats.push({ obj: o, pose, tail: o.getObjectByName('tail'), face: (() => { let f = null; o.traverse((m) => { if (m.isMesh && m.morphTargetDictionary?.blink !== undefined && !f) f = m; }); return f; })() });
  };
  await cat('cat_ginger', 5.4, 6, 1.6, -PI / 2 - 0.5, 'sit', 'the ginger cat next door. it pretends not to see me.');
  await cat('cat_tabby', 22.6, 6, 0.6, PI / 2, 'loaf', 'a tabby, loafing. very serious about it.');
  await cat('cat_shopkeeper', 32.6, 0.15, -2.2, PI / 2, 'sleep', 'the shopkeeper is asleep. very asleep.');
  await cat('cat_grey', 51.0, PARK.top + 0.48, -2.2, 0.3, 'sit', 'a small grey cat. it decided I am interesting.');

  // ------------------------------------------------------------------ the alleys between the buildings
  // Missing a gap drops Ghost into an alley: a small place of its own (room for a secret later) with a
  // way back up: bins, then stacked crates, then little fire-escape decks on the wall, each an easy hop.
  const secretSpots = [];
  const alley = async (x0, x1, upSide) => {
    const w = x1 - x0, cx = (x0 + x1) / 2, z0 = -5, z1 = 3;
    // floor (old paving), and walls closing both ends
    greybox.add(new THREE.BoxGeometry(w, 0.3, z1 - z0, 4, 1, 12), (x, y, z) => mix('#3b3442', '#4a4250', ((Math.floor(z * 2) + Math.floor(x * 2)) & 1) * 0.6), { pos: [cx, -0.15, (z0 + z1) / 2] });
    world.addBox(cx, -0.15, (z0 + z1) / 2, w, 0.3, z1 - z0);
    for (const zEnd of [z0 + 0.15, z1 - 0.15]) {
      world.addBox(cx, 1.0, zEnd, w, 2.0, 0.3); // higher than any hop
      // its own mesh, so it can fade when it comes between the camera and Ghost
      const eb = new Baker(); eb.add(new THREE.BoxGeometry(w, 2.0, 0.3, 2, 3, 1), (x, y) => mix('#4a3038', '#6e4648', (Math.floor(y / 0.25) % 2) * 0.5), { pos: [0, 1.0, 0], wobble: 0.01, seed: cx + zEnd });
      const em = new THREE.Mesh(eb.build(), toonMaterial({ vertexColors: true })); em.position.set(cx, 0, zEnd); scene.add(em); fadeables.push(em);
    }
    // the way up: steps of 0.8 m zig-zagging along the alley, against alternate walls
    const steps = [0.8, 1.6, 2.4, 3.2, 4.0, 4.8, 5.6];
    // narrow enough that a path stays open down the middle of the alley
    const sw = Math.min(0.6, w * 0.38);
    for (let i = 0; i < steps.length; i++) {
      const top = steps[i], side = (i % 2 === 0) === (upSide < 0) ? -1 : 1;
      const x = side < 0 ? x0 + sw / 2 : x1 - sw / 2, z = 2.2 - i * 0.95;
      if (i === 0) { await put('trash_bins', x, 0, z, side < 0 ? PI / 2 : -PI / 2, { collide: 'mesh', bump: { line: 'clang. nobody heard. good.' } }); continue; }
      // each step is its own mesh, so it can fade when it comes between the camera and Ghost
      const sb = new Baker();
      if (top <= 3.2) { // crates stacked from the ground
        world.addBox(x, top / 2, z, sw, top, 0.9);
        for (let k = 0; k < Math.round(top / 0.4); k++) sb.add(new THREE.BoxGeometry(sw - 0.02, 0.38, 0.88, 2, 1, 2), (xx, yy, zz) => mix('#7d5b42', '#a07a56', ((k + i) % 3) / 3), { pos: [(R() - 0.5) * 0.04, k * 0.4 + 0.2, (R() - 0.5) * 0.04], wobble: 0.01, seed: k * 7 + i });
      } else { // a small deck bolted to the wall
        world.addBox(x, top - 0.05, z, sw, 0.1, 0.9);
        sb.add(new THREE.BoxGeometry(sw, 0.08, 0.9, 2, 1, 2), '#2c2b3d', { pos: [0, top - 0.04, 0] });
        sb.add(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 5), '#2c2b3d', { pos: [side * -sw * 0.45, top - 0.5, 0], rot: [0, 0, side * 0.6] });
      }
      const sm = new THREE.Mesh(sb.build(), toonMaterial({ vertexColors: true })); sm.position.set(x, 0, z); scene.add(sm); fadeables.push(sm);
    }
    // the top step sits right by the roof edge it came from; the rest of the floor is free for a secret
    secretSpots.push(new THREE.Vector3(cx, 0, -3.9));
    await put('puddle', cx, 0.005, -2.6, 0.3);
  };
  await alley(BUILDINGS.A.x1, BUILDINGS.B.x0, -1); // between A and B: climbs back up to A's roof
  await alley(BUILDINGS.B.x1, BUILDINGS.C.x0, -1); // between B and C: back up to B's roof

  // ------------------------------------------------------------------ light
  scene.add(new THREE.HemisphereLight('#7c88cc', '#3b2a3c', 1.25));
  const moon = new THREE.DirectionalLight('#a9b6f0', 0.9); moon.position.set(-20, 40, 30); scene.add(moon);
  const lightObjs = [], haloPts = [];
  for (const l of lights) {
    l.updateMatrixWorld(true);
    const a = l.getObjectByName('anchor_light');
    const p = a ? a.getWorldPosition(new THREE.Vector3()) : l.localToWorld(new THREE.Vector3(0, 2.5, 0));
    const pl = new THREE.PointLight('#ffbe7a', 9, 14, 1.6); pl.position.copy(p); scene.add(pl);
    lightObjs.push(pl); haloPts.push(p);
  }
  // all lamp halos in one draw call
  const halos = new THREE.Points(new THREE.BufferGeometry().setFromPoints(haloPts), new THREE.PointsMaterial({ map: glowTexture(), color: '#ffb46b', size: 1.6, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(halos);

  // greybox meshes
  const gb = new THREE.Mesh(greybox.build(), toon); gb.receiveShadow = true; scene.add(gb);
  // the city floor far below and between things
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: '#241c36' }));
  floor.position.y = -0.4; scene.add(floor);
  world.addBox(32, -0.45, 0, 300, 0.1, 300); // catch-all ground under everything
  camWorld.addBox(32, -0.45, 0, 300, 0.1, 300);

  // ------------------------------------------------------------------ collision + batching
  world.build(); camWorld.build();
  batchStatic(scene, statics);
  // things that react, and lamps that do not fade, share one BatchedMesh (per-prop transform and tint)
  const batchable = new Set([...bumpables.filter((b) => !b.cat).map((b) => b.obj), ...lights]);
  for (const f of fadeables) batchable.delete(f);
  const propBatch = createPropBatch(scene, [...batchable]);

  // camera zones: open rooftops pull back, the fire escape comes in, the hill opens up
  // zoom: x the normal follow distance (1 = Ghost is 1/8 of a portrait screen); pitch in radians
  // aim: how far above Ghost the camera looks (metres), for places where the way goes up
  // axis: in a long narrow place ('x' or 'z'), the camera looks along it from whichever end is behind Ghost
  const Z = (x0, y0, z0, x1, y1, z1, zoom, pitch, priority = 1, aim = 0, axis) => ({ min: new THREE.Vector3(x0, y0, z0), max: new THREE.Vector3(x1, y1, z1), zoom, pitch, priority, aim, axis });
  const zones = [
    Z(-3, 5, -6, 18, 20, 4, 1.08, 0.29),               // rooftops A, B: a modest pull back
    Z(18, 5, -6, 25.6, 20, 4, 1.05, 0.28),              // rooftop C
    Z(22.5, 5.5, -5, 25.6, 9, 3, 1.15, 0.26, 2, 0.3),  // the fire escape: a little lower, looking up at the decks
    Z(25.6, 8.5, -6, 32, 20, 4, 1.15, 0.33),            // rooftop D: see the drop
    Z(31, -1, -11, 43, 8.5, 11, 1.0, 0.27),            // street
    Z(43, -1, -11, 56, 6, 11, 1.05, 0.27),               // park
    Z(54, -1, -6, 66, 8, 6, 1.15, 0.27, 1, 0.3),      // hill: look up the terraces
    // the alleys: like anywhere else, behind and a little above Ghost, but looking along the alley
    // (from whichever end is behind Ghost), pulled back just enough to see the climb; end walls fade
    Z(BUILDINGS.A.x1, -1, -5, BUILDINGS.B.x0, 5.9, 3, 1.15, 0.36, 3, 0.25, 'z'),
    Z(BUILDINGS.B.x1, -1, -5, BUILDINGS.C.x0, 5.9, 3, 1.15, 0.36, 3, 0.25, 'z'),
  ];

  // pits: only beyond the edges of the world (nothing is built there). Landing there drifts Ghost back
  // up to the last safe spot. The alleys are NOT pits: they are real places with a way back up.
  const pits = [
    { min: new THREE.Vector3(-30, -2, 3.2), max: new THREE.Vector3(31.4, 5.5, 30) },   // in front of the row
    { min: new THREE.Vector3(-30, -2, -30), max: new THREE.Vector3(31.4, 5.5, -5.2) },  // behind it
    { min: new THREE.Vector3(-30, -2, -6), max: new THREE.Vector3(-2.2, 5.5, 4) },      // west of A
  ];

  // the route, for the scripted test run: walk to each point; jump: true = hop on the way there
  const route = [
    { p: [4.0, 6, 0.9] },
    { p: [7.75, 6, -1.0] }, { p: [11.0, 6, -1.0], jump: true },
    { p: [17.45, 6, -1.0] }, { p: [21.0, 6, -1.0], jump: true, hold: true },
    { p: [24.0, 6, -3.3] }, { p: [25.1, 6.85, -3.3], jump: true },
    { p: [25.1, 7.7, -1.15], jump: true },
    { p: [25.1, 8.55, 1.0], jump: true },
    { p: [27.0, 9, 1.0], jump: true },
    { p: [31.4, 9, 0.0] }, { p: [33.0, 0.15, 0.0], drop: true },
    { p: [38.0, 0.15, 2.0] }, { p: [44.5, 0.15, 0.0] },
    { p: [52.5, 0.15, 1.8] }, { p: [55.6, 0.95, 1.8] },
    { p: [56.2, 0.95, -0.3] }, { p: [58.2, 1.8, -0.4], jump: true },
    { p: [59.4, 2.65, -0.9], jump: true }, { p: [60.7, 3.45, -1.1], jump: true },
  ];
  // climbing out of the first alley (for tests): from the alley floor up the steps to roof A
  const ax = (BUILDINGS.A.x1 + BUILDINGS.B.x0) / 2, sw = Math.min(0.6, (BUILDINGS.B.x0 - BUILDINGS.A.x1) * 0.38);
  const L = BUILDINGS.A.x1 + sw / 2, Rr = BUILDINGS.B.x0 - sw / 2;
  const alleyRoute = [
    { p: [ax, 0, 2.6] }, { p: [L, 0.8, 2.2], jump: true }, { p: [Rr, 1.6, 1.25], jump: true }, { p: [L, 2.4, 0.3], jump: true },
    { p: [Rr, 3.2, -0.65], jump: true }, { p: [L, 4.0, -1.6], jump: true }, { p: [Rr, 4.8, -2.55], jump: true }, { p: [L, 5.6, -3.5], jump: true },
    { p: [BUILDINGS.A.x1 - 0.6, 6, -3.5], jump: true },
  ];
  const goal = { centre: new THREE.Vector3(top[0], top[3], top[1]), radius: top[2] };

  const update = (t) => {
    for (const c of cats) if (c.tail) c.tail.rotation.y = Math.sin(t * (c.pose === 'sleep' ? 0.5 : 1.1) + c.obj.position.x) * 0.3;
    for (const l of lightObjs) l.intensity = 9 * (1 + 0.03 * Math.sin(t * 9 + l.position.x));
  };

  return { world, camWorld, bumpables, fadeables, propBatch, zones, pits, route, goal, cats, secretSpots, alleyRoute, spawn: new THREE.Vector3(3.6, 6, 0.9), spawnYaw: -PI / 2, update, sky, setStarScale: sky.setStarScale };
}
