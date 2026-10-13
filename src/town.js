// Down on the street: the street block, the corner shop and the park, joined to the home with no loading.
// The street runs out from the front of the building (+z of the roof's front parapet) at ground level, the corner shop
// is a warm room behind its open door, the park waits behind its gate at the far end. Their layouts are staged by
// tools/stage_town.py; where they sit, and the front of our building that joins them on (the brick front, the awning,
// the front fire escape, the shops' roofs), come from assets/layouts/front.json (tools/stage_home_outside.py).
//
// This module places all four with src/layout.js, applies the few join patches the staged files need (below, each
// with its why), and gives them their life: moths at the lamps, fireflies in the park, steam from the ramen window,
// the drains, the cups and the espresso wand, mist on the pond, dust in the shop's pendant light, the moon in the
// puddles, string lights twinkling, the noren and the swing moving. It also hides what cannot be seen from where Ghost
// is (draw calls), tells home.js which area Ghost is in, and runs the mechanics behind the street's secrets.
import * as THREE from 'three';
import { loadLayout } from './layout.js';
import { getProp } from './props.js';
import { rng, glowTexture, clamp } from './util.js';
import { TUNING as T } from './tuning.js';

const PI = Math.PI;
export const TOWN_AREAS = new Set(['street', 'alley', 'corner-shop', 'park']);

// ------------------------------------------------------------------ join patches (the staged layouts stay as staged)
// Lamp light reads amber: hue held between orange and amber, never pink or lilac (PM, from the staged preview).
function amber(hex, { pool = false } = {}) {
  const c = new THREE.Color(hex), hsl = {};
  c.getHSL(hsl);
  if (hsl.s < 0.3 || hsl.h > 0.5) return hex;                 // cool lights (the vending machine) stay as they are
  const h = clamp(hsl.h, 0.075, 0.105), s = Math.max(hsl.s, 0.95), l = pool ? Math.min(hsl.l, 0.6) : Math.min(hsl.l, 0.72);
  return '#' + c.setHSL(h, s, l).getHexString();
}
const warmLights = (d) => {
  for (const l of d.lights || []) {
    l.colour = amber(l.colour);
    if (l.pool) l.pool.colour = amber(l.colour, { pool: true });
  }
};
// The sidewalk tiles: a darker, warmer stone that the lamps pool onto (the staged one read as a pale slab), and a hair
// wider so neighbouring tiles meet with no seam between them.
const SIDEWALK_TINT = [0.6, 0.5, 0.44];
// the road read cold blue in the middle of the block (dark asphalt under the blue night fill): a little warmer
const ROAD_TINT = [1.0, 0.88, 0.78];

function patchStreet(src) {
  const d = structuredClone(src);
  // the park's edge (gate, fences, its lamp and trees), the skyline and the moon belong to the park layout and the sky
  d.pieces = d.pieces.filter((p) => p.position[2] > -12.3 && !/skyline|sky\/moon/.test(p.glb));
  const KEEP = { coffeeShop: [], ramenWindow: ['noren'], medGrill: ['spit'], bike: ['bell'], mail: ['flap'], vend: ['panel'], burgerStand: [] };   // (the dumpster stays its own: it steps aside for the camera in the alley)
  const at = (p, glb, x, y, z) => p.glb.endsWith(glb) && p.position[0] === x && p.position[1] === y && p.position[2] === z;
  for (const p of d.pieces) {
    // the corner shop moves to the corner slot (and the plain front there moves up one): its room behind the door is
    // wider than its front, and in the old slot it would have reached into the alley
    if (p.id === 'cornerShopDoor') { p.position[2] = -7.0; p.open_nodes = { door: -1.35 }; p.no_collide_nodes = ['door']; p.keep_nodes = []; }
    else if (at(p, 'wall_4m_window.glb', -5.5, 0, -7)) p.position[2] = -3;
    else if (at(p, 'window_dark.glb', -5.5, 0.9, -6)) p.position[2] = -2;
    else if (at(p, 'window_lit.glb', -5.5, 0.9, -8)) p.position[2] = -4;
    else if (at(p, 'pot_cluster.glb', -5.05, 0.15, -8.6)) p.position[2] = -9.75;    // not in front of the shop door
    else if (at(p, 'window_dark.glb', 5.5, 0.9, -10)) p.glb = 'assets/outdoor/window_lit.glb';    // the corner by the gate was the dimmest place: lit, with a bench under it (front.json)
    p.batch = p.position[2] > 2.5 ? 'near' : p.position[2] > -5 ? 'middle' : 'end';   // three merged chunks: the ones behind the camera are culled
    if (p.glb.endsWith('sidewalk_4m.glb')) { p.tint = SIDEWALK_TINT; p.scale = 1.008; }
    if (/street_4m|crosswalk_4m/.test(p.glb)) p.tint = ROAD_TINT;
    // the tiles' curbs are bevelled at the steepest walkable slope, where the capsule can perch and stall: the road,
    // the sidewalks and the crossing walk on plain boxes instead (a 0.15 m curb is an ordinary step up)
    if (/sidewalk_4m|street_4m|crosswalk_4m/.test(p.glb)) p.collide = 'none';
    if (p.id && KEEP[p.id]) p.keep_nodes = KEEP[p.id];
    if (/festoon|alley_lights/.test(p.glb)) p.keep_nodes = [];       // (merged: a twinkle per string cost a draw call each)
    if (/trash_bins/.test(p.glb)) p.keep_nodes = [];
  }
  for (const t of d.things) if (t.id === 'cornerShopDoor') t.position[2] -= 4;
  d.lights = d.lights.filter((l) => l.id !== 'parkLamp');           // the park's own lamp stands there now
  for (const l of d.lights) if (l.id === 'shopWindow') l.position[2] -= 4;
  // the dark ground under the street stops at the park's gate (the park's grass carries on from there)
  for (const g of d.ground) if (g.name === 'under') { const z0 = -12.7, z1 = g.centre[2] + g.size_xz[1] / 2; g.centre[2] = (z0 + z1) / 2; g.size_xz[1] = z1 - z0; }
  d.fx = d.fx.filter((e) => e.kind === 'steam');                  // moths: src/town.js draws them at the lamps
  const flat = (x0, x1, z0, z1, top) => ({ type: 'box', centre: [(x0 + x1) / 2, top - 0.15, (z0 + z1) / 2], size: [x1 - x0, 0.3, z1 - z0], visible: false, note: 'join patch: walkable street' });
  (d.solids ||= []).push(flat(-3.0, 3.0, -10.0, 10.0, 0.0), flat(3.0, 5.5, -10.0, 10.0, 0.15), flat(-5.5, -3.0, -10.0, 10.0, 0.15), flat(-6.0, 6.0, -12.5, -10.0, 0.15));
  warmLights(d);
  return d;
}
function patchPark(src) {
  const d = structuredClone(src);
  d.pieces = d.pieces.filter((p) => !/skyline|sky\/moon|firefly/.test(p.glb));   // fireflies: one glowing swarm, drawn here
  for (const p of d.pieces) {
    // the park in three depths, so the street can draw only what it can make out: the gate end, the middle, the back
    p.batch = p.position[2] < -6.5 ? 'far' : p.position[2] > 1.5 ? 'gate' : 'mid';
    if (p.glb.endsWith('park_gate.glb')) { p.open_nodes = { gate_L: -1.2, gate_R: 1.2 }; p.no_collide_nodes = ['gate_L', 'gate_R']; p.keep_nodes = []; }
    if (p.id === 'tree') p.keep_nodes = ['canopy'];
    if (p.id === 'swing') p.keep_nodes = ['swing', 'swing_2'];
    if (/paper_lanterns/.test(p.glb)) p.keep_nodes = [];
    if (/festoon/.test(p.glb)) p.keep_nodes = [];
  }
  // the grass stops at the gate: past it is the street
  for (const g of d.ground) if (g.name === 'grass') { const z0 = g.centre[2] - g.size_xz[1] / 2, z1 = 4.75; g.centre[2] = (z0 + z1) / 2; g.size_xz[1] = z1 - z0; }
  // the paths: the same warmer, darker stone as the street (the staged pale stone read as a flat slab at night)
  for (const g of d.ground) if (/path|plaza/.test(g.name)) { g.colour = '#86705e'; g.noise = 0.22; }
  d.fx = d.fx.filter((e) => e.kind === 'mist');
  warmLights(d);
  return d;
}
function patchShop(src) {
  const d = structuredClone(src);
  d.lights = d.lights.filter((l) => l.id !== 'street');            // a cold blue blob inside a warm shop
  for (const p of d.pieces) {
    if (p.glb.endsWith('/door.glb')) { p.open_nodes = { 'door.001': 1.35 }; p.no_collide_nodes = ['door.001']; }
    if (p.glb.endsWith('shop_counter.glb')) p.keep_nodes = ['register_drawer', 'radio', 'lucky_paw'];
    if (p.id === 'cans') p.keep_nodes = ['top_can'];
    if (p.id === 'mouse') p.keep_nodes = ['whiskers'];
    if (/fridge_cabinet|star_garland|paper_lanterns|pendant_lamp|back_door/.test(p.glb)) p.keep_nodes = [];
  }
  // the front wall stops 1.2 m short of the right-hand side wall: close the corner
  (d.solids ||= []).push({ type: 'box', centre: [2.6, 1.5, -0.42], size: [1.2, 3.0, 0.34], colour: '#d6a982', note: 'join patch: the front corner' });
  warmLights(d);
  return d;
}

// ------------------------------------------------------------------ build
export async function buildTown(scene, apt, outside, { world, fx, camWorld }) {
  const R = rng(41);
  const get = async (n) => (await fetch(`assets/layouts/${n}.json`)).json();
  const [frontData, streetData, parkData, shopData] = await Promise.all(['front', 'street', 'park', 'corner_shop'].map(get));
  const PL = frontData.town;
  const front = await loadLayout(scene, frontData, { world, realLights: false, fx });
  const street = await loadLayout(scene, patchStreet(streetData), { world, realLights: false, fx, place: PL.street });
  const park = await loadLayout(scene, patchPark(parkData), { world, realLights: false, fx, place: PL.park });
  const shop = await loadLayout(scene, patchShop(shopData), { world, realLights: false, fx, place: PL.corner_shop });
  // the curbs: an invisible ramp along each edge between the road and the sidewalks (a square 0.15 m edge can stall
  // the capsule's walk-up, and the tiles' own bevels sit right at the steepest walkable slope)
  if (world) {
    street.root.updateMatrixWorld(true);
    const ramp = (alongZ, c, s, a0, a1, h = 0.15, w = 0.45) => {
      const ang = Math.atan2(h, w), len = a1 - a0;
      const g = alongZ ? new THREE.BoxGeometry(w / Math.cos(ang), 0.06, len).rotateZ(s * ang) : new THREE.BoxGeometry(len, 0.06, w / Math.cos(ang)).rotateX(-s * ang);
      const mid = (a0 + a1) / 2, y = h / 2 - 0.03 / Math.cos(ang);
      g.translate(...(alongZ ? [c - s * w / 2, y, mid] : [mid, y, c - s * w / 2]));
      world.addGeometry(g, street.root.matrixWorld);
    };
    ramp(true, 3.0, 1, -10, 6.6); ramp(true, -3.0, -1, -10, 6.6);        // the two long sidewalks
    ramp(false, -10.0, -1, -3.0, 3.0);                                   // the sidewalk across the park end
    ramp(false, 6.6, 1, -3.0, 3.0, 0.162);                               // the stoop in front of our door
    ramp(false, -12.5, 1, -6.0, 6.0, 0.14);                              // back up from the park path
    ramp(true, -5.5, 1, -1.0, 1.0);                                      // out of the alley
    ramp(true, 6.0, -1, -12.5, -11.0); ramp(true, -6.0, 1, -12.5, -11.0); // round the corners at the park end
  }
  const areas = { front, street, park, shop };
  const all = [front, street, park, shop];
  const placed = Object.assign({}, front.placed, street.placed, shop.placed, park.placed);
  for (const [k, o] of Object.entries(placed)) if (!apt.placed[k]) apt.placed[k] = o; else if (k !== 'counter') console.warn('[town] id clash', k); // (the shop's counter is only ever town's)
  // outdoor props drawn by a BatchedMesh wobble through home-outside's sync
  outside.areas.push(...all);

  // ---------------------------------------------------------------- where things are (world)
  const SW = (x, y, z) => street.toWorld([x, y, z]);
  const gateZ = SW(0, 0, -12.6).z, midZ = SW(0, 0, -2.0).z;
  const shopBox = new THREE.Box3().setFromPoints([shop.toWorld([-3.25, -0.2, -5.45]), shop.toWorld([3.25, 3.2, -0.2])]);
  const alleyBox = new THREE.Box3().setFromPoints([SW(-5.45, -0.5, -1.0), SW(-9.6, 4.0, 1.0)]);
  const shopDoor = SW(-5.5, 0.15, -8.35);
  const FRONT_Z = frontData.place.position[2];
  const edgeBox = new THREE.Box3(new THREE.Vector3(-7.6, 5.5, FRONT_Z - 1.1), new THREE.Vector3(3.2, 7.5, FRONT_Z + 0.2));
  const areaAt = (p) => {
    if (shopBox.containsPoint(p)) return 'corner-shop';
    if (alleyBox.containsPoint(p)) return 'alley';
    if (p.z > FRONT_Z - 0.02) return p.z > gateZ + 0.2 ? 'park' : 'street';
    return null;
  };

  // ---------------------------------------------------------------- camera zones (follow-camera.js) and camera walls
  const box = (a, b, o) => { const bb = new THREE.Box3().setFromPoints([a, b]); return { min: bb.min, max: bb.max, ...o }; };
  const zones = [
    ...front.zones,
    box(SW(-6.0, -1.0, 9.5), SW(6.0, 8.0, -12.6), { zoom: T.camZoomStreet, pitch: T.camPitchStreet, aim: T.camAimStreet, priority: 1, name: 'the street' }),
    box(SW(-5.45, -1.0, -1.0), SW(-9.6, 4.0, 1.0), { zoom: T.camZoomAlley, pitch: T.camPitchAlley, aim: 0.1, axis: 'x', priority: 2, name: 'the alley' }),
    { min: shopBox.min.clone(), max: shopBox.max.clone(), zoom: T.camZoomShop, pitch: T.camPitchShop, aim: 0.2, priority: 2, name: 'the corner shop' },
    box(park.toWorld([-16, -1.0, 4.7]), park.toWorld([16, 9.0, -14]), { zoom: T.camZoomPark, pitch: T.camPitchPark, aim: 0.2, priority: 1, name: 'the park' }),
    // up the climbing tree: the camera stays under the canopy, looking out across the pond
    box(park.toWorld([-5.0, 1.4, 0.2]), park.toWorld([-1.6, 5.0, -3.4]), { zoom: 0.92, pitch: 0.06, aim: 0.25, priority: 2, name: 'up the tree' }),
    // the roof's front edge: lean out and look down the block
    box(new THREE.Vector3(-7.6, 5.5, FRONT_Z - 0.9), new THREE.Vector3(3.2, 7.5, FRONT_Z + 0.2), { zoom: 1.2, pitch: 0.86, aim: -0.3, priority: 3, name: 'the roof edge, over the street' }),
  ];
  // the camera stays out of the buildings: the rows behind the shop fronts (but not where the shop and alley are),
  // and the shop's own walls
  if (camWorld) {
    const solid = (a, b) => { const bb = new THREE.Box3().setFromPoints([a, b]), c = bb.getCenter(new THREE.Vector3()), s = bb.getSize(new THREE.Vector3()); camWorld.addBox(c.x, c.y, c.z, s.x, s.y, s.z); };
    solid(SW(-5.6, 0, 9.0), SW(-11.5, 6.0, 1.0));
    solid(SW(-5.6, 0, -1.0), SW(-11.5, 6.0, -4.9));
    solid(SW(-9.7, 0, 1.0), SW(-11.5, 6.0, -1.0));
    solid(SW(5.6, 0, 9.0), SW(11.5, 6.0, -11.0));
    // our own front wall below and above the apartment (the apartment storey is the dollhouse's open side: no wall there)
    const fz = frontData.place.position[2], fy = frontData.place.position[1];
    solid(new THREE.Vector3(-9.76, fy, fz - 0.4), new THREE.Vector3(5.36, -0.1, fz));
    solid(new THREE.Vector3(-9.76, 2.9, fz - 0.4), new THREE.Vector3(5.36, 5.75, fz));
    for (const [a, b] of [[[-3.3, 0, -0.62], [3.3, 3.1, -0.2]], [[-3.3, 0, -5.45], [3.3, 3.1, -5.2]], [[-3.35, 0, -5.4], [-3.1, 3.1, -0.2]], [[3.1, 0, -5.4], [3.35, 3.1, -0.2]], [[-3.3, 3.05, -5.4], [3.3, 3.3, -0.2]]])
      solid(shop.toWorld(a), shop.toWorld(b));
  }

  // ---------------------------------------------------------------- touch triggers from the layouts' `things` (world)
  const jsonThings = {};
  for (const [a, d] of [[street, streetData], [park, parkData], [shop, shopData]]) {
    for (const t of d.things || []) {
      if (t.kind === 'secret') { jsonThings['secret:' + t.id] = { p: a.toWorld(t.position), r: t.radius }; continue; }
      jsonThings[t.id] = { p: a.toWorld(t.id === 'cornerShopDoor' ? [t.position[0], t.position[1], t.position[2]] : t.position), r: t.radius };
    }
    for (const c of d.cats || []) if (c.id) jsonThings[c.id] = { p: a.toWorld(c.position), r: 0.45 };
  }
  // a thing's trigger: [x, y0, z, r, h] (home.js); `from: 'secret'` uses the secret's spot (the frog: at the pond edge)
  const triggerFor = (id, { r, h = 1.0, y = 0, from } = {}) => {
    const j = jsonThings[from === 'secret' ? 'secret:' + id : id]; if (!j) return null;
    return [j.p.x, j.p.y + y - 0.05, j.p.z, r ?? Math.min(j.r, 0.9), h];
  };
  const spotPos = (id) => { const o = placed[id]; return o ? o.getWorldPosition(new THREE.Vector3()) : null; };

  // ---------------------------------------------------------------- lamps (for the light lending in home-outside.js)
  const lampsOf = (a, tag) => a.lights.filter((l) => l.base > 0).map((l) => Object.assign(l, { town: tag }));
  const lamps = { street: [...lampsOf(street, 'street'), ...lampsOf(front, 'street'), ...lampsOf(park, 'park')], shop: lampsOf(shop, 'shop') };

  // ---------------------------------------------------------------- moths at the street lamps and the park lamps (one InstancedMesh)
  // (the street's own come first: on the street only those are drawn, in the park all of them)
  const mothSpots = [
    ...['slamp', 'slamp2'].map((id) => street.lights.find((l) => l.base > 0 && l.pos.distanceTo(SW(...(id === 'slamp' ? [-3.38, 2.65, 0.09] : [3.42, 2.65, -2.51]))) < 0.3)),
    ...front.lights.filter((l, i) => frontData.lights[i].moths),   // the door lamp, the corner lantern, the top landing's bulbs
    ...park.lights.filter((l) => l.base > 2.5),
  ].filter(Boolean).map((l, i) => ({ c: l.pos, n: i === 0 ? 7 : i < 2 ? 5 : 4, slamp: i === 0, park: park.lights.includes(l) }));
  // a moth here is six triangles (two wings and a body), lit by nothing but the lamp it circles: tiny at this
  // distance, and the street has twenty of them
  const moths = (() => {
    const W = 0.035, Lg = 0.03;
    const pos = [0, 0, -Lg, W, 0.004, -0.01, W * 0.8, 0.004, Lg * 0.9, 0, 0, -Lg, -W * 0.8, 0.004, Lg * 0.9, -W, 0.004, -0.01,
      0, 0, -Lg, W * 0.8, 0.004, Lg * 0.9, 0, 0, Lg * 0.6, 0, 0, -Lg, 0, 0, Lg * 0.6, -W * 0.8, 0.004, Lg * 0.9,
      0, 0.006, -Lg * 1.1, 0.006, 0.006, Lg * 0.8, -0.006, 0.006, Lg * 0.8, 0, 0.006, -Lg * 1.1, -0.006, 0.006, Lg * 0.8, 0.006, 0.006, Lg * 0.8];
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const list = []; for (const s of mothSpots) for (let k = 0; k < s.n; k++) list.push({ c: s.c, slamp: s.slamp, r: 0.2 + R() * 0.3, sp: 1.6 + R() * 1.8, ph: R() * 6, y: -0.15 + R() * 0.35, dir: R() < 0.5 ? -1 : 1 });
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#efe0c4', side: THREE.DoubleSide }), list.length);
    mesh.frustumCulled = false; mesh.name = 'town-moths';
    scene.add(mesh);
    return { mesh, list, boost: 0, stars: 0, streetCount: mothSpots.filter((s) => !s.park).reduce((a, s) => a + s.n, 0) };
  })();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

  // ---------------------------------------------------------------- fireflies in the park (one Points, slow drift, slow blink)
  const flies = (() => {
    const n = T.fireflyCount, homes = [];
    for (let i = 0; i < n; i++) {
      const pond = i >= n - 6;
      const [cx, cy, cz, sx, sz] = pond ? [2.9, 0.45, -1.3, 4.0, 4.0] : [0.4, 0.5, -1.0, 10.0, 7.0];
      homes.push(park.toWorld([cx + (R() - 0.5) * sx, cy + R() * (pond ? 0.6 : 1.3), cz + (R() - 0.5) * sz]));
    }
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture(), size: 0.3, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    pts.frustumCulled = false; pts.name = 'fireflies'; pts.renderOrder = 4; scene.add(pts);
    const list = homes.map((h) => ({ home: h, p: h.clone(), off: new THREE.Vector3(), vel: new THREE.Vector3(), ph: R() * 9, w: 0.6 + R() * 0.8, land: null }));
    return { pts, list, pos, col };
  })();
  const scatterFlies = (p) => {
    let n = 0;
    for (const f of flies.list) { const d = f.p.distanceTo(p); if (d < T.fireflyScatter && !f.land) { n++; f.vel.copy(f.p).sub(p).setY(0.3).normalize().multiplyScalar(2.2 + R()); } }
    return n;
  };
  const landFly = (body) => {
    let best = null, bd = 99;
    for (const f of flies.list) { const d = f.p.distanceTo(body.pos); if (d < bd) { bd = d; best = f; } }
    if (best) best.land = { t: 0, body };
  };

  // ---------------------------------------------------------------- string lights and moon glints, the small motions
  const twinkle = [];
  for (const a of all) for (const m of a.liveNodes) if (m.material.isMeshBasicMaterial) twinkle.push({ m: m.material, c: m.material.color.clone(), ph: R() * 6, sp: 1.1 + R() * 1.5 });
  front.placed.frontLights?.traverse((m) => { if (m.isMesh && m.material.isMeshBasicMaterial) twinkle.push({ m: m.material, c: m.material.color.clone(), ph: R() * 6, sp: 1.3 + R() }); });
  const glints = []; for (const a of [street, park]) for (const k of a.keeps) { const g = k.getObjectByName('glint'); if (g) glints.push({ g, s0: g.scale.clone(), ph: R() * 6 }); }
  const node = (id, name) => placed[id]?.getObjectByName(name) || null;
  const noren = node('ramenWindow', 'noren'), spit = node('medGrill', 'spit'), canopy = node('tree', 'canopy');
  const swings = ['swing', 'swing_2'].map((n) => node('swing', n)).filter(Boolean);
  const swing = { a: 0, v: 0 };
  const paw = node('counter', 'lucky_paw'), lucky = { speed: 2.2 };
  const whiskers = node('mouse', 'whiskers'), mouse = { out: 0, goal: 0, z0: whiskers ? whiskers.position.z : 0 };
  const flowerNodes = [1, 2, 3, 4].map((i) => node('flowers', 'flower_' + i)).filter(Boolean);
  const bloom = { k: 0, goal: 0 }; for (const f of flowerNodes) f.userData.s0 = f.scale.clone();
  const frog = placed.frog, throat = node('frog', 'throat');
  const cats = Object.fromEntries(all.flatMap((a) => a.cats).filter((c) => c.def.id).map((c) => [c.def.id, c]));
  const morph = (obj, name, v) => obj?.traverse((m) => { if (m.isMesh && m.morphTargetDictionary?.[name] !== undefined) m.morphTargetInfluences[m.morphTargetDictionary[name]] = v; });
  const tween = []; const animate = (dur, fn, done) => tween.push({ t: 0, dur, fn, done });

  // ---------------------------------------------------------------- what to draw from where (draw calls)
  const parts = (a) => ({
    big: [...Object.values(a.meshes), ...a.staticMeshes.filter((m) => !['far', 'mid'].includes(m.userData.batch)), a.halos, a.poolMesh].filter(Boolean),
    mid: a.staticMeshes.filter((m) => m.userData.batch === 'mid'),
    small: [...a.propBatch.batches, ...a.keeps, ...a.liveNodes, ...a.cats.map((c) => c.obj), ...a.staticMeshes.filter((m) => m.userData.batch === 'far')].filter(Boolean),
  });
  // the front's own small far things are drawn by distance, not by area: the corner's bench and pots only from the far
  // half of the street or the park, the alley climb's dressing (its AC, the drainpipe) only in the alley or up off the
  // street, the coffee row's roof only up off the street (triangles: from the stoop none of them can be made out)
  const ownGroup = (b) => front.staticMeshes.filter((m) => m.userData.batch === b);
  // (and the corner's string lights and window not from down at our own door: the stoop is the busiest view there is,
  // and the lamps' halos still mark the far end from there)
  const FG = { cornerSmall: { list: ownGroup('cornerSmall'), on: null }, alley: { list: ownGroup('alley'), on: null }, rowRoof: { list: ownGroup('rowRoof'), on: null }, corner: { list: ownGroup('corner'), on: null } };
  const own = new Set(Object.values(FG).flatMap((g) => g.list));
  front.staticMeshes = front.staticMeshes.filter((m) => !own.has(m));
  const showGroup = (g, on) => { if (g.on === on) return; g.on = on; for (const m of g.list) m.visible = on; };
  const highY = SW(0, 1.6, 0).y, doorZ = SW(0, 0, 5.0).z, groundY = SW(0, 0.6, 0).y;
  const P = { front: parts(front), street: parts(street), park: parts(park), shop: parts(shop) };
  const VIEW = {
    home: {},
    roof: { street: 'halo', park: 'halo' },                      // the street is below the parapets: only its lamps' glow shows
    roofEdge: { front: 'big', street: 'all', park: 'halo' },     // leaning out over the front: the view down the block
    street: { front: 'all', street: 'all', park: 'big' },
    alley: { front: 'big', street: 'all', park: 'big' },
    'corner-shop': { street: 'big', shop: 'all' },
    park: { front: 'big', street: 'big', park: 'all' },
  };
  // seen from out on the street the shop's room is not drawn: its open door shows a warm glow instead
  const doorGlow = (() => {
    const g = new THREE.PlaneGeometry(1.05, 2.15).translate(0, 1.075, 0);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#d99a5a', fog: true }));
    m.position.copy(shop.toWorld([1.0, 0.0, -0.75])); m.rotation.y = PL.corner_shop.rotationY; m.name = 'shop-door-glow';
    scene.add(m); return m;
  })();
  let viewNow = null, shopNear = null, farNow = null;
  // far: Ghost is down the far half of the street, where the middle of the park can be made out through the gate
  const setView = (v, near, far = false) => {
    if (v === viewNow && near === shopNear && far === farNow) return;
    viewNow = v; shopNear = near; farNow = far;
    const want = { ...VIEW[v] }; if (near && (v === 'street' || v === 'alley')) want.shop = 'all';
    for (const [k, p] of Object.entries(P)) {
      for (const o of p.big) o.visible = want[k] === 'all' || want[k] === 'big' || (want[k] === 'halo' && o === areas[k].halos);
      for (const o of p.small) { o.visible = want[k] === 'all'; o.userData.viewVisible = o.visible; }
      for (const o of p.mid) o.visible = want[k] === 'all' || (want[k] === 'big' && far);
    }
    if (!want.shop) for (const c of shop.ceilings) c.mesh.visible = false;
    doorGlow.visible = !want.shop && !!want.street && v !== 'roof' && v !== 'roofEdge';
    if (moths) { moths.mesh.visible = want.street === 'all'; moths.mesh.count = v === 'park' ? moths.list.length : moths.streetCount; }
    flies.pts.visible = want.park === 'all' || v === 'street';
  };

  // ---------------------------------------------------------------- props that come between the camera and Ghost step aside
  // (the street is dense: crates, tables, lamps, bins right where a following camera hangs)
  const occluders = [];
  for (const a of all) {
    for (const o of a.props) occluders.push({ o, box: new THREE.Box3().setFromObject(o).expandByScalar(0.04), batch: a.propBatch, hidden: false });
    for (const o of a.keeps) if (!a.fadeables.includes(o) && !/moon_glint|festoon|alley_lights|lantern|pendant|garland/.test(o.userData.prop || '')) occluders.push({ o, box: new THREE.Box3().setFromObject(o).expandByScalar(0.04), batch: null, hidden: false });
  }
  for (const c of occluders) c.size = c.box.getSize(new THREE.Vector3());
  const ray = new THREE.Ray(), hitP = new THREE.Vector3(), gp = new THREE.Vector3();
  function updateOccluders(camera, body, on) {
    gp.copy(body.pos); gp.y += T.height * 0.5;
    const dist = camera.position.distanceTo(gp);
    ray.origin.copy(camera.position); ray.direction.copy(gp).sub(camera.position).normalize();
    for (const c of occluders) {
      // big things (shop fronts) never hide; only what is small enough to be clutter
      let hide = on && c.size.x < 3 && c.size.z < 3 && c.size.y < 3.2 && !c.box.containsPoint(gp) && ray.intersectBox(c.box, hitP) !== null && hitP.distanceTo(camera.position) < dist - 0.3;
      if (hide === c.hidden) continue;
      c.hidden = hide;
      if (c.batch) c.batch.setObjectVisible(c.o, !hide); else c.o.visible = !hide && c.o.userData.viewVisible !== false;
    }
  }

  // ---------------------------------------------------------------- the light around Ghost: warmer and darker down here
  let hemi = null, moon = null; scene.traverse((o) => { if (o.isHemisphereLight) hemi = o; else if (o.isDirectionalLight) moon = o; });
  const LOOK = {
    home: hemi && { sky: hemi.color.clone(), ground: hemi.groundColor.clone(), i: hemi.intensity, moon: moon?.intensity ?? 0 },
    street: { sky: new THREE.Color('#4b4672'), ground: new THREE.Color('#3a2a24'), i: 0.62, moon: 0.28 },
    park: { sky: new THREE.Color('#4a4670'), ground: new THREE.Color('#33291f'), i: 0.6, moon: 0.26 },   // as warm as the street (it read cooler)
    'corner-shop': { sky: new THREE.Color('#7a5a54'), ground: new THREE.Color('#3a2620'), i: 0.7, moon: 0.1 },
  };
  LOOK.alley = LOOK.street;

  // ---------------------------------------------------------------- the grey kitten that follows (the follower secret)
  const kitten = cats.greyKitten?.obj;
  const kit = { on: false, crumbs: [], p0: kitten ? kitten.getWorldPosition(new THREE.Vector3()) : null, r0: kitten ? kitten.getWorldQuaternion(new THREE.Quaternion()) : null, parent: kitten?.parent, lp: kitten?.position.clone(), lr: kitten?.rotation.clone(), lineT: 20 };
  const startFollow = (body) => {
    if (!kitten || kit.on) return;
    kit.on = true; kit.crumbs = [body.pos.clone()];
    scene.attach(kitten); morph(kitten, 'loaf', 0);
    P.park.small.splice(P.park.small.indexOf(kitten), 1);           // it goes wherever Ghost goes now
    kitten.visible = true;
  };
  function updateKitten(dt, t, body) {
    if (!kit.on) return;
    const last = kit.crumbs[kit.crumbs.length - 1];
    if (body.S.grounded && body.pos.distanceTo(last) > 0.12) { kit.crumbs.push(body.pos.clone()); if (kit.crumbs.length > 400) kit.crumbs.shift(); }
    // the point T.followerGap behind Ghost along the way Ghost went
    let need = T.followerGap, goal = kit.crumbs[0], prev = body.pos;
    for (let i = kit.crumbs.length - 1; i >= 0; i--) { const c = kit.crumbs[i], d = c.distanceTo(prev); if (d >= need) { goal = prev.clone().lerp(c, need / d); break; } need -= d; prev = c; goal = c; }
    const p = kitten.position;
    if (goal.distanceTo(body.pos) < 0.6) goal = p.distanceTo(body.pos) < 0.6 ? p.clone().add(p.clone().sub(body.pos).setY(0).setLength(0.02)) : p.clone(); // never on top of Ghost
    const dist = p.distanceTo(goal);
    if (dist > T.followerPop) { p.copy(goal); kit.pop = 0.35; }       // a long drop or a float: it pops across
    else if (dist > 0.02) {
      const step = Math.min(dist, T.followerSpeed * dt * Math.min(1, dist * 2));
      const dir = goal.clone().sub(p); dir.y = 0;
      if (dir.lengthSq() > 1e-5) kitten.rotation.y += Math.atan2(Math.sin(Math.atan2(dir.x, dir.z) - kitten.rotation.y), Math.cos(Math.atan2(dir.x, dir.z) - kitten.rotation.y)) * Math.min(1, dt * 8);
      p.lerp(goal, step / dist);
    }
    const moving = dist > 0.05;
    p.y = (moving ? goal.y : p.y) + (moving ? Math.abs(Math.sin(t * 11)) * 0.03 : 0);
    kit.still = moving ? 0 : (kit.still || 0) + dt;
    morph(kitten, 'loaf', clamp((kit.still - 2) / 1.5, 0, 1));
    kitten.visible = true;
  }
  const resetKitten = () => {
    if (!kitten || !kit.on) return;
    kit.on = false; kit.parent.add(kitten); kitten.position.copy(kit.lp); kitten.rotation.copy(kit.lr); morph(kitten, 'loaf', 1);
    P.park.small.push(kitten); viewNow = null;
  };

  // ---------------------------------------------------------------- reactions the mechanics ask for
  const espresso = { next: T.hissEvery * 0.6, soon: false, hissT: -9 };
  let ctxRef = {}; const bind = (c) => { ctxRef = c; };
  const wand = SW(-5.12, 0.95, 0.45), cups = SW(-3.83, 1.02, 3.65), ramenSteam = SW(5.35, 1.1, 2.3);
  const hiss = (audio) => {
    espresso.hissT = performance.now() / 1000;
    for (let i = 0; i < 5; i++) setTimeout(() => fx.burst(wand, '#f4f0ff', 2, 0.05, { kind: 'steam' }), i * 90);
    audio?.play('coffee', { volume: 0.6 });
  };
  const mothsToStars = () => {
    if (!moths || moths.stars > 0) return;
    moths.stars = 22;    // the slamp's moths rise and become stars, then drift back
    const top = SW(-3.38, 2.75, 0.09);
    for (let i = 0; i < 6; i++) setTimeout(() => { fx.burst(top.clone().add(new THREE.Vector3(0, 0.5 + i * 0.35, 0)), '#fff4c8', 5, 0.35, { scale: 0.7 }); }, 300 + i * 220);
  };
  const frogJump = (body) => {
    if (!frog || frog.userData.jumping) return;
    frog.userData.jumping = true;
    const parent = frog.parent, lp = frog.position.clone(), lr = frog.rotation.clone();
    scene.attach(frog);
    const from = frog.position.clone(), over = body.pos.clone(), to = over.clone().add(over.clone().sub(from).setY(0).setLength(0.7)); to.y = body.pos.y;
    animate(0.9, (k) => { frog.position.lerpVectors(from, to, k); frog.position.y = from.y + (to.y - from.y) * k + Math.sin(k * PI) * (T.frogHop + Math.max(0, body.pos.y - from.y)); frog.rotation.x = -Math.sin(k * PI) * 0.5; },
      () => {
        fx.burst(to.clone().setY(to.y + 0.05), '#cfe8ff', 6, 0.15, { kind: 'drops', scale: 0.6 });
        setTimeout(() => {
          const back = from.clone();
          animate(0.8, (k) => { frog.position.lerpVectors(to, back, k); frog.position.y = to.y + (back.y - to.y) * k + Math.sin(k * PI) * 0.6; },
            () => { parent.attach(frog); frog.position.copy(lp); frog.rotation.copy(lr); frog.userData.jumping = false; });
        }, 3500);
      });
  };
  const calicoEye = () => { const c = cats.calico?.obj; if (!c) return; animate(3.2, (k) => morph(c, 'sleep', 1 - Math.sin(Math.min(1, k * 1.4) * PI) * 0.55)); };
  const dumpsterLid = (big) => { const lid = node('dumpster', 'lid'); if (!lid) return; const r0 = lid.userData.r0 ??= lid.rotation.x; animate(big ? 0.9 : 0.5, (k) => { lid.rotation.x = r0 - Math.sin(k * PI) * (big ? 0.5 : 0.18); }); };
  const nodeWobble = (n, amp = 0.3, dur = 0.8) => { if (!n) return; const r0 = n.userData.r0 ??= n.rotation.clone(); animate(dur, (k) => { n.rotation.z = r0.z + Math.sin(k * 18) * Math.exp(-k * 4) * amp; }, () => n.rotation.copy(r0)); };
  const slide = (n, axis, amt, dur = 0.7) => { if (!n) return; const p0 = n.userData.p0 ??= n.position.clone(); animate(dur, (k) => { n.position[axis] = p0[axis] + Math.sin(k * PI) * amt; }); };
  const special = (name, t, taps, ctx) => {
    const at = t.pos.clone().setY(t.top + 0.1);
    switch (name) {
      case 'slamp': if (moths) moths.boost = 3; if (taps >= 3) mothsToStars(); break;
      case 'espresso': hiss(ctx.audio); break;
      case 'cups': fx.burst(cups, '#f4f0ff', 3, 0.04, { kind: 'steam' }); break;
      case 'bike': nodeWobble(node('bike', 'bell'), 0.5); ctx.audio.play('chime', { volume: 0.5 }); break;
      case 'mail': { const f = node('mail', 'flap'); if (f) { const r0 = f.userData.r0 ??= f.rotation.x; animate(0.7, (k) => { f.rotation.x = r0 - Math.sin(k * PI) * 0.7; }); } break; }
      case 'vend': { const pn = node('vend', 'panel'); pn?.traverse((m) => { if (m.isMesh) { const c0 = m.userData.c0 ??= m.material.color.clone(); animate(0.6, (k) => m.material.color.copy(c0).multiplyScalar(1 + Math.sin(k * PI) * 0.8)); } }); break; }
      case 'ramen': for (let i = 0; i < 4; i++) setTimeout(() => fx.burst(ramenSteam, '#f4f0ff', 2, 0.15, { kind: 'steam' }), i * 120); if (noren) noren.userData.kick = 1; break;
      case 'grill': if (spit) spit.userData.boost = 3; fx.burst(at, '#ffb070', 6, 0.25, { scale: 0.6 }); break;
      case 'food': fx.burst(at, '#ffd8a0', 6, 0.3, { scale: 0.6 }); break;
      case 'drain': fx.burst(t.pos.clone().setY(t.pos.y + 0.1), '#efe9ff', 3, 0.1, { kind: 'steam' }); break;
      case 'dumpster': dumpsterLid(taps >= 3); if (taps >= 3) { ctx.audio.play('meow2', { volume: 0.7 }); setTimeout(() => ctx.audio.play('meow2', { volume: 0.3, rate: 0.92 }), 480); setTimeout(() => ctx.audio.play('meow2', { volume: 0.14, rate: 0.86 }), 900); } break;
      case 'tabby': { const c = cats.tabby; if (c?.tail) c.tail.userData.flick = 1; break; }
      case 'keeper': { const c = cats.calico; if (c?.tail) c.tail.userData.flick = 1; break; }
      case 'lucky': lucky.speed = 9; break;
      case 'radio': nodeWobble(node('counter', 'radio'), 0.2); break;
      case 'register': slide(node('counter', 'register_drawer'), 'z', 0.12); ctx.audio.play('chime', { volume: 0.4 }); break;
      case 'cans': nodeWobble(node('cans', 'top_can'), 0.35); break;
      case 'tree': if (canopy) canopy.userData.kick = 1; fx.burst(at.clone().setY(at.y + 1.5), '#b8f0a0', 8, 0.6, { kind: 'drops', scale: 0.6 }); break;
      case 'frog': if (throat) throat.userData.kick = 1; if (taps >= 3) frogJump(ctx.body); break;
      case 'swing': swing.v += 1.2; break;
      case 'flies': scatterFlies(ctx.body.pos); break;
      case 'birdhouse': nodeWobble(node('birdhouse', 'bird'), 0.25); break;
      case 'pond': fx.burst(ctx.body.pos.clone().setY(ctx.body.pos.y + 0.05), '#cfe0ff', 8, 0.2, { kind: 'drops', scale: 0.7 }); break;
      case 'kitten': if (kitten && !kit.on) { const k = kitten; const s0 = k.userData.s0 ??= k.scale.clone(); animate(0.5, (a) => k.scale.copy(s0).multiplyScalar(1 + Math.sin(a * PI) * 0.06)); } break;
    }
  };
  // sitting still by something that reacts to patience (not a secret): the mouse peeks, the moonflowers open
  const sitReact = (id, sitT) => {
    if (id === 'mouse') mouse.goal = sitT > T.mouseSit ? 1 : mouse.goal;
    if (id === 'flowers' && sitT > T.moonflowerSit) bloom.goal = 1;
  };
  const resetNight = () => { resetKitten(); bloom.goal = 0; mouse.goal = 0; if (moths) moths.stars = 0; };

  // ---------------------------------------------------------------- per frame
  let lookNow = 'home';
  function update(t, dt, { area, camera, body }) {
    const town = TOWN_AREAS.has(area);
    const edge = area === 'rooftop' && edgeBox.containsPoint(body.pos);
    const v = town ? area : edge ? 'roofEdge' : area === 'rooftop' ? 'roof' : 'home';
    setView(v, (v === 'street' || v === 'alley') && body.pos.distanceTo(shopDoor) < 1.8, body.pos.z > midZ);
    showGroup(FG.cornerSmall, v === 'park' || ((v === 'street' || v === 'alley') && body.pos.z > midZ));
    showGroup(FG.alley, v === 'alley' || (town && body.pos.y > highY));
    showGroup(FG.rowRoof, town && body.pos.y > highY);
    showGroup(FG.corner, (town || v === 'roofEdge') && !(body.pos.z < doorZ && body.pos.y < groundY));
    const vis = VIEW[v] || {};
    const live = (k) => vis[k] === 'all' || vis[k] === 'big';
    if (live('street')) street.update(t, dt, camera, area === 'street' || area === 'alley' || area === 'park');
    if (live('front')) front.update(t, dt, camera, false);
    if (live('park')) park.update(t, dt, camera, area === 'park');
    if (vis.shop || shopNear) shop.update(t, dt, camera, area === 'corner-shop');
    if (!(vis.shop || shopNear)) for (const c of shop.ceilings) c.mesh.visible = false;
    for (let i = tween.length - 1; i >= 0; i--) { const a = tween[i]; a.t += dt; const k = Math.min(1, a.t / a.dur); a.fn(k); if (k >= 1) { tween.splice(i, 1); a.done?.(); } }

    // the light: warmer, darker ambient down on the street; the shop warmer still
    const L = LOOK[town ? area : 'home'];
    if (hemi && L) {
      const k = 1 - Math.exp(-dt * 2);
      hemi.color.lerp(L.sky, k); hemi.groundColor.lerp(L.ground, k); hemi.intensity += (L.i - hemi.intensity) * k;
      if (moon) moon.intensity += (L.moon - moon.intensity) * k;
    }
    lookNow = area;
    updateOccluders(camera, body, town);
    if (!live('street') && !live('park') && v !== 'corner-shop') { updateKitten(dt, t, body); return; }

    for (const w of twinkle) w.m.color.copy(w.c).multiplyScalar(0.8 + 0.2 * Math.sin(t * w.sp + w.ph) * Math.sin(t * 0.6 + w.ph * 2));
    for (const g of glints) { g.g.scale.set(g.s0.x * (1 + Math.sin(t * 1.7 + g.ph) * 0.06), g.s0.y, g.s0.z * (1 + Math.sin(t * 1.1 + g.ph) * 0.1)); }
    if (noren) { noren.userData.kick = Math.max(0, (noren.userData.kick || 0) - dt); noren.rotation.x = Math.sin(t * 1.1) * 0.05 + Math.sin(t * 7) * 0.12 * noren.userData.kick; }
    if (spit) { spit.userData.boost = Math.max(0, (spit.userData.boost || 0) - dt); spit.rotation.y += dt * (0.4 + spit.userData.boost); }
    if (canopy) { canopy.userData.kick = Math.max(0, (canopy.userData.kick || 0) - dt * 0.8); canopy.rotation.z = Math.sin(t * 0.7) * 0.012 + Math.sin(t * 9) * 0.04 * canopy.userData.kick; }
    swing.v += (-swing.a * 6 - swing.v * 0.5) * dt; swing.a += swing.v * dt; swing.a = clamp(swing.a, -0.9, 0.9);
    for (const s of swings) s.rotation.x = swing.a + Math.sin(t * 0.8) * 0.03;
    if (paw) { lucky.speed = Math.max(2.2, lucky.speed - dt * 3); paw.rotation.z = Math.sin(t * lucky.speed) * 0.35; }
    if (whiskers) { mouse.out += (mouse.goal - mouse.out) * (1 - Math.exp(-dt * 2)); whiskers.position.z = mouse.z0 + mouse.out * 0.035 + Math.sin(t * 8) * 0.003 * mouse.out; }
    if (flowerNodes.length) { bloom.k += (bloom.goal - bloom.k) * (1 - Math.exp(-dt * 0.8)); for (const f of flowerNodes) f.scale.set(f.userData.s0.x * (1 + bloom.k * 0.35), f.userData.s0.y * (1 + bloom.k * 0.15), f.userData.s0.z * (1 + bloom.k * 0.35)); }
    if (throat) { throat.userData.kick = Math.max(0, (throat.userData.kick || 0) - dt); const s = 1 + Math.max(0, Math.sin(t * 2.4)) ** 6 * 0.25 + throat.userData.kick * 0.5 * Math.abs(Math.sin(t * 9)); throat.scale.setScalar(s); }
    for (const c of Object.values(cats)) {
      if (!c.tail) continue;
      c.tail.userData.flick = Math.max(0, (c.tail.userData.flick || 0) - dt * 1.5);
      c.tail.rotation.y += Math.sin(t * 14) * 0.5 * c.tail.userData.flick;
      const b = 1 + Math.sin(t * 1.6 + c.obj.position.x) * 0.012; if (c.obj !== kitten || !kit.on) c.obj.scale.y = (c.obj.userData.sy ??= c.obj.scale.y) * b;
    }
    // espresso hiss: every ~20 s, sooner once Ghost has sat at the little table
    espresso.next -= dt;
    if (espresso.soon && espresso.next > T.hissSoon) espresso.next = T.hissSoon;
    if (espresso.next <= 0 && live('street')) { espresso.next = T.hissEvery * (0.85 + R() * 0.3); hiss(ctxRef.audio); }
    // moths
    if (moths) {
      moths.boost = Math.max(0, moths.boost - dt * 0.8); moths.stars = Math.max(0, moths.stars - dt);
      moths.list.forEach((m, i) => {
        const away = m.slamp && moths.stars > 0 ? clamp(Math.min(22 - moths.stars, moths.stars) / 1.5, 0, 1) : 0;
        const a = t * m.sp * m.dir * (1 + (m.slamp ? moths.boost : 0)) + m.ph;
        v3.set(m.c.x + Math.cos(a) * m.r * (1 + away * 2), m.c.y + m.y + Math.sin(t * 3.1 + m.ph) * 0.12 + away * 3, m.c.z + Math.sin(a) * m.r * 0.8 * (1 + away * 2));
        q.setFromAxisAngle(UP, -a * m.dir + (m.dir > 0 ? PI : 0));
        s3.set(0.3 + Math.abs(Math.sin(t * 30 + i)) * 0.9, 1, 1).multiplyScalar((1 - away) * 2.2);
        moths.mesh.setMatrixAt(i, m4.compose(v3, q, s3));
      });
      moths.mesh.instanceMatrix.needsUpdate = true;
    }
    // fireflies
    if (flies.pts.visible) {
      flies.list.forEach((f, i) => {
        if (f.land) {
          f.land.t += dt; const head = f.land.body.pos.clone().add(new THREE.Vector3(0.12, T.height + 0.08, 0.05));
          f.p.lerp(head, 1 - Math.exp(-dt * 4)); if (f.land.t > 5) f.land = null;
        } else {
          f.vel.multiplyScalar(Math.exp(-dt * 1.6)); f.off.addScaledVector(f.vel, dt); f.off.multiplyScalar(Math.exp(-dt * 0.15));
          f.p.set(f.home.x + Math.sin(t * 0.31 * f.w + f.ph) * 0.5 + f.off.x, f.home.y + Math.sin(t * 0.53 * f.w + f.ph * 2) * 0.25 + f.off.y, f.home.z + Math.cos(t * 0.27 * f.w + f.ph) * 0.5 + f.off.z);
        }
        flies.pos.set([f.p.x, f.p.y, f.p.z], i * 3);
        const blink = f.land ? (Math.sin(f.land.t * 5) > 0.2 && f.land.t < 2.6 ? 1 : 0.35) : 0.18 + 0.82 * Math.max(0, Math.sin(t * 1.3 * f.w + f.ph)) ** 6;
        flies.col.set([1.0 * blink, 1.0 * blink, 0.5 * blink], i * 3);
      });
      flies.pts.geometry.attributes.position.needsUpdate = true; flies.pts.geometry.attributes.color.needsUpdate = true;
    }
    updateKitten(dt, t, body);
  }

  // ---------------------------------------------------------------- for tests and home.js
  return {
    areas, all, placed, zones, areaAt, atEdge: (p) => edgeBox.containsPoint(p), setView: (v) => { viewNow = null; setView(v, false, false); }, update, special, sitReact, resetNight, lamps, triggerFor, spotPos,
    hiss, mothsToStars, frogJump, calicoEye, startFollow, landFly, scatterFlies, espresso, kitten: kit,
    shopDoor, gateZ, shopBox, alleyBox, frontZ: FRONT_Z, places: PL,
    crateTop: SW(-9.2, 0.9, 0.62), puddles: [SW(1.1, 0, 3.6), SW(-1.7, 0, -1.8), SW(0.6, 0, -6.4)],
    flyZone: jsonThings.flies?.p, bind,
    toWorld: (area, p) => areas[area === 'corner_shop' ? 'shop' : area].toWorld(p).toArray(),  // tests: a layout-local point in the world
  };
}
