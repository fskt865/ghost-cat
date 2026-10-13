// Ghost's home: bedroom | living room | kitchen | balcony in one connected strip, built as a
// cut-away dollhouse (no ceiling, no front wall, side walls step down toward the camera).
// 1 unit = 1 metre. Rooms run along x; the back wall is at z = -2.4; the camera looks from +z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Baker, rng, mix, toonMaterial, glowTexture, radialTexture, clamp } from './util.js';
import { getProp, preload } from './props.js';
import { neighbourCat, wallSconce, balconyDoor, heartMarker } from './placeholders.js';
import { buildSky } from './sky.js';
import { THINGS } from './things.js';
import { CONFIG } from './config.js';
import { CollisionWorld } from './physics.js';

const PI = Math.PI;
const WALL_H = 2.7, LOW_H = 1.0, CUT_Z = -0.2, T = 0.16; // wall height, cut-away height, where it steps down, thickness
const BACK = -2.4, FRONT = 2.4;

export const ROOM_RECTS = {
  bedroom: { x0: -9.6, x1: -5.0, z0: BACK, z1: FRONT, cam: { az: 0.14, pol: 0.95, dist: 5.4 } },
  living: { x0: -5.0, x1: 1.2, z0: BACK, z1: FRONT, cam: { az: 0.08, pol: 0.95, dist: 5.8 } },
  kitchen: { x0: 1.2, x1: 5.2, z0: BACK, z1: FRONT, cam: { az: -0.1, pol: 0.95, dist: 5.2 } },
  balcony: { x0: 5.2, x1: 8.6, z0: BACK, z1: 0.4, outdoor: true, cam: { az: 0.38, pol: 1.26, dist: 4.8 } },
};
export const ROOM_ORDER = ['bedroom', 'living', 'kitchen', 'balcony'];
// doorways between consecutive rooms: x of the wall, z span of the opening
const DOORS = [
  { x: -5.0, z0: 0.1, z1: 1.2 },
  { x: 1.2, z0: -0.6, z1: 1.0 },
  { x: 5.2, z0: -1.65, z1: -0.65 },
];

// Where everything goes. pos = [x, y, z], rot = y rotation. Things in things.js refer to these keys.
const PLACEMENTS = {
  // bedroom
  bed: { prop: 'bed', pos: [-8.1, 0, -1.3] },
  nightstand: { prop: 'nightstand', pos: [-6.95, 0, -2.13] },
  hairTie: { prop: 'hair_tie', pos: [-7.08, 0.555, -1.98], rot: 0.4 },
  bedWindow: { prop: 'window', pos: [-6.0, 0.7, BACK] },
  slippers: { prop: 'slippers', pos: [-7.05, 0, -0.02], rot: 0.35 },
  bedFairy: { prop: 'fairy_lights', pos: [-8.1, 1.62, BACK] },
  bedCactus: { prop: 'cactus', pos: [-5.62, 0.9, -2.28] },
  catBedSpot: null,
  // living room
  couch: { prop: 'couch', pos: [-2.8, 0, -1.93] },
  coffeeTable: { prop: 'coffee_table', pos: [-2.8, 0, -0.55] },
  laptop: { prop: 'laptop', pos: [-3.05, 0.43, -0.55], rot: 0.15 },
  rug: { prop: 'rug', pos: [-2.8, 0.002, -0.6] },
  floorLamp: { prop: 'floor_lamp', pos: [-4.45, 0, -2.0], rot: 0.5 },
  picture: { prop: 'picture_frame', pos: [-2.8, 1.18, BACK] },
  livingFairy: { prop: 'fairy_lights', pos: [-2.8, 2.05, BACK] },
  livingWindow: { prop: 'window', pos: [-0.75, 0.7, BACK] },
  bookshelf: { prop: 'bookshelf', pos: [0.6, 0, -2.22] },
  livingPlant: { prop: 'potted_plant', pos: [-1.55, 0, -2.12] },
  shelfCactus: { prop: 'cactus', pos: [0.82, 1.29, -2.22] },
  // kitchen
  counter: { prop: 'kitchen_counter', pos: [2.9, 0, -2.07] },
  fridge: { prop: 'fridge', pos: [4.72, 0, -2.0] },
  basil: { prop: 'basil', pos: [2.28, 0.92, -2.22] },
  kitchenWindow: { prop: 'window', pos: [2.9, 1.2, BACK], scale: 0.72 },
  box: { prop: 'cardboard_box', pos: [2.35, 0, 1.05], rot: 0.45 },
  bowl: { prop: 'food_bowl', pos: [4.25, 0, -0.95] },
  counterMug: { prop: 'mug', pos: [3.55, 0.92, -2.25], rot: 1.2 },
  // balcony
  tomatoes: { prop: 'tomato_planter', pos: [7.75, 0, -2.13] },
  balconyFairy: { prop: 'fairy_lights', pos: [6.55, 0.62, -2.33] },
  balcCactus: { prop: 'cactus', pos: [8.35, 0.98, -2.36] },
};

// tap-only zones that are not props: [x, y, z]
const ZONES = {
  moonbeam: [-6.0, 0, -1.15],
  underBed: [-8.1, 0, -0.12],
  underFridge: [4.72, 0, -1.5],
  sky: [7.2, 3.5, -7],
  skyMoon: null, // set from the moon position
  moth: null, leaf: null, snail: null, neighbourCat: null, // moving things, positioned at runtime
};

const COLLIDERS = [
  { x: -8.1, z: -1.3, hx: 0.8, hz: 1.1 }, { x: -6.95, z: -2.13, hx: 0.25, hz: 0.25 },
  { x: -2.8, z: -1.93, hx: 0.97, hz: 0.47 }, { x: -2.8, z: -0.55, hx: 0.5, hz: 0.29 },
  { x: -4.45, z: -2.0, hx: 0.22, hz: 0.22 }, { x: 0.6, z: -2.22, hx: 0.42, hz: 0.18 }, { x: -1.55, z: -2.12, hx: 0.22, hz: 0.22 },
  { x: 2.9, z: -2.07, hx: 0.83, hz: 0.33 }, { x: 4.72, z: -2.0, hx: 0.37, hz: 0.38 },
  { x: 7.75, z: -2.13, hx: 0.34, hz: 0.16 },
];

export async function buildApartment(scene, { platform = false, homeStyle = CONFIG.homeStyle, deferCollision = false } = {}) {
  const coll = platform ? new CollisionWorld() : null; // the platformer's collision world (walls, floors, furniture)
  const dark = homeStyle === 'dark';
  const R = rng(11);
  const toon = toonMaterial({ vertexColors: true });
  const flat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const sky = buildSky(scene, { moonPos: new THREE.Vector3(-12, 13, -58), fogNear: 10, fogFar: 48 });
  const updaters = [];
  const placed = {};
  let livingBack = null, outsideBack = null;

  // ------------------------------------------------------------------ floors
  {
    const g = new Baker();
    const plank = (x, z, base) => {
      const row = Math.floor((z + 10) / 0.22), off = (row % 3) * 0.6;
      const n = Math.floor((x + 20 + off) / 1.3);
      const v = Math.sin(row * 12.9898 + n * 78.233) * 43758.5453;
      return mix(base, '#5c3b2c', (v - Math.floor(v)) * 0.3 + (Math.abs(((z + 10) / 0.22) % 1 - 0.5) > 0.46 ? 0.22 : 0));
    };
    const floor = (r, colourFn) => {
      const w = r.x1 - r.x0, d = r.z1 - r.z0;
      const geo = new THREE.PlaneGeometry(w, d, Math.ceil(w / 0.11), Math.ceil(d / 0.11)).rotateX(-PI / 2);
      g.add(geo, (x, y, z) => colourFn(x, z), { pos: [(r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2] });
    };
    floor(ROOM_RECTS.bedroom, (x, z) => plank(x, z, '#9a6b4c'));
    floor(ROOM_RECTS.living, (x, z) => plank(x, z, '#a3724f'));
    floor(ROOM_RECTS.kitchen, (x, z) => (((Math.floor(x / 0.4) + Math.floor(z / 0.4)) & 1) ? '#b5a692' : '#8c7b78'));
    floor(ROOM_RECTS.balcony, (x, z) => mix('#b0694c', '#8a4c3a', ((Math.floor(x / 0.33) * 7 + Math.floor(z / 0.33) * 3) % 5) / 5 * 0.6));
    // doorway thresholds
    for (const d of DOORS) g.add(new THREE.BoxGeometry(T + 0.04, 0.02, d.z1 - d.z0), '#7a5038', { pos: [d.x, 0.01, (d.z0 + d.z1) / 2] });
    // the building slab under everything, and the balcony's underside
    g.add(new THREE.BoxGeometry(14.9, 0.5, 5.1), '#3a2c40', { pos: [-2.2, -0.26, 0] });
    g.add(new THREE.BoxGeometry(3.5, 0.22, 2.9), '#5a3a3a', { pos: [6.9, -0.12, -1.0] });
    g.add(new THREE.BoxGeometry(2.9, 0.22, 2.9), '#5a3a3a', { pos: [10.6, -0.12, -1.0] }); // the neighbours' balcony
    g.add(new THREE.BoxGeometry(3.45, 0.08, 0.12), '#8a5a48', { pos: [6.9, 0.04, 0.42] });          // balcony front curb (cut-away)
    if (coll) { for (const id of ROOM_ORDER) { const r = ROOM_RECTS[id]; coll.addBox((r.x0 + r.x1) / 2, -0.15, (r.z0 + r.z1) / 2, r.x1 - r.x0 + 0.2, 0.3, r.z1 - r.z0 + 0.1); } }
    const m = new THREE.Mesh(g.build(), toon); m.receiveShadow = true; m.name = 'floors';
    scene.add(m);
  }

  // ------------------------------------------------------------------ walls
  {
    const g = new Baker();
    const paper = { bedroom: ['#4f5683', '#626a9a'], living: ['#8a5f58', '#a57668'], kitchen: ['#5f7f70', '#7b9a88'] };
    const wallCol = (room) => (x, y) => {
      const [lo, hi] = paper[room];
      if (y < 0.12) return '#e9dcc6';                          // skirting
      if (y < 0.95) return mix(lo, '#3a2c40', 0.25);            // wainscot, darker
      if (y < 1.0) return '#e9dcc6';                            // dado rail
      const stripe = room === 'bedroom' ? (Math.floor(x * 5) % 2 ? 0 : 0.12) : room === 'living' ? (Math.sin(x * 9) > 0.6 ? 0.18 : 0) : 0;
      return mix(lo, hi, clamp((y - 1) / 1.7, 0, 1) * 0.6 + stripe);
    };
    const roomOf = (x) => (x < -5 ? 'bedroom' : x < 1.2 ? 'living' : 'kitchen');
    const gLiving = new Baker(); let target = g;
    const box = (x0, x1, y0, y1, z0, z1, colour) => {
      if (x1 - x0 < 1e-3 || y1 - y0 < 1e-3 || z1 - z0 < 1e-3) return;
      if (coll) coll.addBox((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0);
      target.add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, Math.max(1, Math.ceil((x1 - x0) / 0.5)), 6, 1), colour, { pos: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], wobble: 0.008, seed: x0 * 3 + z0 });
    };
    // back wall with window holes: [x centre, half width, y0, y1]
    const holes = [[-6.0, 0.5, 0.86, 2.11], [-0.75, 0.5, 0.86, 2.11], [2.9, 0.36, 1.32, 2.22]];
    const backSeg = (x0, x1) => {
      const hs = holes.filter((h) => h[0] - h[1] < x1 && h[0] + h[1] > x0).sort((a, b) => a[0] - b[0]);
      let cur = x0;
      for (const [cx, hw, y0, y1] of hs) {
        box(cur, cx - hw, 0, WALL_H, BACK - T, BACK, wallCol(roomOf(cx)));
        box(cx - hw, cx + hw, 0, y0, BACK - T, BACK, wallCol(roomOf(cx)));
        box(cx - hw, cx + hw, y1, WALL_H, BACK - T, BACK, wallCol(roomOf(cx)));
        cur = cx + hw;
      }
      box(cur, x1, 0, WALL_H, BACK - T, BACK, wallCol(roomOf(x1 - 0.01)));
    };
    backSeg(-9.6 - T, -5.0); target = gLiving; backSeg(-5.0, 1.2); target = g; backSeg(1.2, 5.2 + T);
    if (coll) {
      // the closed windows (bedroom, kitchen) are glass; the living-room window stands open onto the fire escape
      coll.addBox(-6.0, 1.5, BACK - 0.08, 1.0, 1.3, 0.16); coll.addBox(2.9, 1.77, BACK - 0.08, 0.72, 0.9, 0.16);
      // sills to sit on, inside each window
      for (const [cx, hw, y0] of holes) coll.addBox(cx, y0 - 0.03, BACK + 0.15, hw * 2 + 0.2, 0.06, 0.3);
      // the edges of the world: the open front, the outer walls, the balcony rail line
      coll.addBox(-2.2, 1.5, FRONT + 0.2, 15.6, 3, 0.3); coll.addBox(-9.85, 1.5, 0, 0.3, 3, 5.2);
      coll.addBox(5.4, 1.5, 1.5, 0.4, 3, 2.2); coll.addBox(7.0, 1.5, 0.65, 3.8, 3, 0.3); coll.addBox(8.75, 1.5, -1.0, 0.3, 3, 3.4); coll.addBox(7.0, 1.5, -2.62, 3.8, 3, 0.3);
    }
    // side walls, stepping down toward the camera, with doorway gaps
    const sideWall = (x, gaps, colour) => {
      const spans = []; let cur = BACK - T;
      for (const [a, b] of gaps) { spans.push([cur, a]); cur = b; }
      spans.push([cur, FRONT]);
      for (const [a, b] of spans) {
        if (a < CUT_Z) box(x - T / 2, x + T / 2, 0, WALL_H, a, Math.min(b, CUT_Z), colour);
        if (b > CUT_Z) box(x - T / 2, x + T / 2, 0, LOW_H, Math.max(a, CUT_Z), b, colour);
        if (a < CUT_Z && b > CUT_Z) g.add(new THREE.CylinderGeometry(T / 2 + 0.01, T / 2 + 0.01, WALL_H - LOW_H, 10), '#e9dcc6', { pos: [x, (WALL_H + LOW_H) / 2, CUT_Z] });
      }
      for (const [a, b] of gaps) if (b <= CUT_Z) box(x - T / 2 - 0.02, x + T / 2 + 0.02, 2.15, 2.25, a - 0.06, b + 0.06, '#e9dcc6'); // door head trim (only where the wall is full height)
    };
    sideWall(-9.6, [], wallCol('bedroom'));
    sideWall(-5.0, [[DOORS[0].z0, DOORS[0].z1]], (x, y) => wallCol('living')(x, y));
    sideWall(1.2, [[DOORS[1].z0, DOORS[1].z1]], wallCol('kitchen'));
    sideWall(5.2, [[DOORS[2].z0, DOORS[2].z1]], (x, y) => mix('#6e4446', '#86574f', y / 2.7));
    // top trim on the back wall, and caps along the cut-away edges
    box(-9.6 - T, 5.2 + T, WALL_H, WALL_H + 0.05, BACK - T - 0.02, BACK + 0.03, '#e9dcc6');
    // low front lip so the floor reads as ending
    box(-9.6 - T, 5.2 + T, 0, 0.06, FRONT - 0.04, FRONT + 0.04, '#e9dcc6');
    // exterior: brick face around the balcony door, and the neighbours' building
    box(11.9, 12.2, -0.4, 5.5, -3.4, 1.2, (x, y, z) => mix('#5c3a40', '#764a48', ((Math.floor(y / 0.25) + Math.floor(z / 0.5)) % 3) / 3));
    const m = new THREE.Mesh(g.build(), toon); m.receiveShadow = true; m.castShadow = true; m.name = 'walls';
    scene.add(m);
    // the living-room back wall is its own mesh, so it can fade when Ghost is out on the fire escape
    livingBack = new THREE.Mesh(gLiving.build(), toonMaterial({ vertexColors: true })); livingBack.receiveShadow = true; livingBack.name = 'living-back-wall';
    scene.add(livingBack);
  }

  // ------------------------------------------------------------------ outside, seen through the windows
  {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
    const x = c.getContext('2d');
    const grd = x.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#141238'); grd.addColorStop(0.7, '#3a2d5c'); grd.addColorStop(1, '#5a3d64');
    x.fillStyle = grd; x.fillRect(0, 0, 1024, 256);
    for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(255,250,230,${0.3 + R() * 0.7})`; x.fillRect(R() * 1024, R() * 150, 1.5, 1.5); }
    for (let bx = 0; bx < 1024;) {                                // rooftops of the buildings across the street
      const w = 40 + R() * 70, h = 50 + R() * 80;
      x.fillStyle = '#1f1934'; x.fillRect(bx, 256 - h, w - 4, h);
      for (let wy = 256 - h + 10; wy < 250; wy += 16) for (let wx = bx + 6; wx < bx + w - 12; wx += 14) if (R() < 0.18) { x.fillStyle = R() < 0.15 ? '#9fcfff' : '#ffc77a'; x.fillRect(wx, wy, 6, 8); }
      bx += w;
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    // on the platform build the courtyard and the building across it (assets/layouts/fire_escape.json) stand in
    // front of this, so it hangs far back as the sky and the far roofs seen through the windows
    const back = new THREE.Mesh(new THREE.PlaneGeometry(platform ? 64 : 16, platform ? 16 : 4), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
    back.position.set(-2.2, platform ? 6.5 : 1.3, platform ? -26 : -3.7);
    scene.add(back); outsideBack = back;
  }

  // ------------------------------------------------------------------ balcony door, sconce, neighbour cat
  {
    const door = balconyDoor(DOORS[2].z1 - DOORS[2].z0); door.position.set(5.2, 0, (DOORS[2].z0 + DOORS[2].z1) / 2); scene.add(door);
    const sc = wallSconce(); sc.position.set(1.75, 1.9, BACK); scene.add(sc); placed.sconce = sc;
  }
  // the cat next door (the artist's ginger cat, or a primitive stand-in), with a heart for the slow blink
  {
    const nc = new THREE.Group(); nc.name = 'neighbour';
    const model = await getProp('assets/cats/cat_ginger.glb', { fallback: neighbourCat });
    nc.add(model); nc.add(heartMarker());
    nc.position.set(9.75, 0, -1.55); nc.rotation.y = -PI / 2 + 0.5; scene.add(nc); placed.neighbourCat = nc;
    model.traverse((o) => { if (o.isMesh && o.morphTargetDictionary?.blink !== undefined) nc.userData.face = o; });
    nc.userData.tail = model.getObjectByName('tail');
  }

  // ------------------------------------------------------------------ props
  if (dark) for (const k of ['bed', 'bedWindow', 'livingWindow', 'kitchenWindow']) PLACEMENTS[k] = { ...PLACEMENTS[k], prop: 'dark/' + PLACEMENTS[k].prop };
  await preload([...new Set(Object.values(PLACEMENTS).filter(Boolean).map((p) => p.prop)).values(), 'balcony_railing', 'moth', 'leaf', 'snail', 'dust_bunny', 'coin']);
  await Promise.all(Object.entries(PLACEMENTS).map(async ([key, p]) => {
    if (!p) return;
    const o = await getProp(p.prop, { scale: p.scale || 1 });
    o.position.set(...p.pos); o.rotation.y = p.rot || 0;
    scene.add(o);
    placed[key] = o;
  }));
  // balcony railings: back, right side, front
  for (const [x, z, r] of [[6.02, -2.36, 0], [7.62, -2.36, 0], [8.58, -1.6, PI / 2], [8.58, -0.2, PI / 2], [9.95, -2.36, 0], [11.3, -2.36, 0], [9.2, -1.6, PI / 2], [9.2, -0.2, PI / 2]]) {
    const o = await getProp('balcony_railing'); o.position.set(x, 0, z); o.rotation.y = r; scene.add(o);
    placed['railing' + x + '_' + z] = o;
  }
  // the floor lamp must not shadow its own light
  placed.floorLamp.traverse((o) => { if (o.isMesh) o.castShadow = false; });

  // ---- platform layout: room for the music corner in the living room's left corner
  if (platform) {
    placed.floorLamp.position.set(-1.45, 0, -2.08);
    placed.livingPlant.position.set(-0.02, 0, -2.12);
    placed.floorLamp.updateMatrixWorld(true); placed.livingPlant.updateMatrixWorld(true);
  }

  // ---- the owner's things (homeStyle 'dark') and the vibe props, when the artist has made them
  const DECOR = [
    // key, prop, pos, rotY, { line, soft, colour }
    ['throw', 'dark/throw', [-2.8, 0, -1.93], 0, { line: 'the purple throw. warm, and a little fringed.', soft: true, colour: '#d8b0ff', style: 'dark' }],
    ['ringsDish', 'dark/rings_dish', [-6.28, 0.86, -2.31], 0.3, { style: 'dark', keep: true }],
    ['nailPolish', 'dark/nail_polish', [-5.7, 0.86, -2.3], 0, { line: 'black nail polish. the lid is shut tight. good.', style: 'dark' }],
    ['choker', 'dark/choker', [-9.5, 1.45, -1.55], PI / 2, { line: 'a choker on a hook. the little moon swings.', style: 'dark', colour: '#e0e4ff' }],
    ['mugBlack', 'dark/mug_black', [-2.48, 0.44, -0.42], -0.6, { line: 'a black mug with a little moon on it. still warm.', style: 'dark', steam: true }],
    ['posterA', 'dark/poster_a', [-9.5, 1.15, 0.05], PI / 2, { line: 'a poster. a ring and a pink bolt. very loud, for a wall.', style: 'dark' }],
    ['posterB', 'dark/poster_b', [-6.98, 1.08, -2.4], 0, { style: 'dark' }],
    ['beanie', 'dark/beanie', [-7.68, 0.53, -0.62], 0.5, { soft: true, style: 'dark', keep: true }],
    ['boots', 'dark/boots', [-5.55, 0, 1.75], 0.4, { line: 'boots with buckles. too big to sit in. checked anyway.', style: 'dark' }],
    ['recordCrate', 'vibe/record_crate', [-4.3, 0, -0.75], 0.2, { collide: true }],
    ['turntable', 'vibe/turntable', [-4.3, 0.33, -0.75], 0.2, { keep: true, collide: true }],
    ['headphones', 'vibe/headphones', [-2.25, 0.52, -1.75], 0.3, {}],
    ['cassettes', 'vibe/cassettes', [0.42, 1.2, -2.2], 0, { line: 'cassettes. tiny handwriting on every label. none of them say ham.' }],
    ['teeChair', 'vibe/tee_chair', [-9.05, 0, 1.3], 0.7, { line: 'a chair wearing a band tee. it is wearing it well.', collide: true, soft: true }],
    ['coffeeMaker', 'vibe/coffee_maker', [3.45, 0.9, -2.17], 0, { keep: true, steam: true }],
    ['coffeeBeans', 'vibe/coffee_beans', [3.72, 0.9, -2.22], -0.3, {}],
    // the music corner (living room, left of the couch): desk, keyboard, mic, interface, monitors...
    ['musicDesk', 'music/music_desk', [-4.42, 0, -2.08], 0, { collide: true, platform: true }],
    ['monitors', 'music/monitor_speakers', [-4.42, 0.74, -2.27], 0, { platform: true, collide: true }],
    ['midiKeys', 'music/midi_keyboard', [-4.42, 0.74, -1.97], 0, { platform: true, keep: true }],
    ['dawLaptop', 'music/laptop_daw', [-4.8, 0.74, -2.15], 0.25, { platform: true, keep: true }],
    ['audioInterface', 'music/audio_interface', [-4.06, 0.74, -2.18], -0.2, { platform: true, keep: true }],
    ['notebook', 'music/notebook_open', [-4.1, 0.74, -1.92], 0.3, { platform: true }],
    ['earbuds', 'music/in_ear_buds', [-4.8, 0.74, -1.9], 0.8, { platform: true }],
    ['cables', 'music/cable_tangle', [-4.62, 0, -1.7], 0.4, { platform: true }],
    ['deskLamp', 'music/desk_lamp', [-4.86, 0.74, -2.3], 0.6, { platform: true, keep: true }],
    ['mic', 'music/condenser_mic', [-3.9, 0, -1.55], -0.5, { platform: true, keep: true }],
  ];
  const decor = [];
  for (const [key, prop, pos, rot, opt] of DECOR) {
    if (opt.style === 'dark' && !dark) continue;
    if (opt.platform && !platform) continue;
    const o = await getProp(prop, { fallback: () => null });
    if (!o) continue;
    o.position.set(...pos); o.rotation.y = rot; scene.add(o);
    placed[key] = o; decor.push({ key, obj: o, ...opt });
  }
  if (dark && placed.counterMug) placed.counterMug.position.x = 2.55; // make room for the coffee machine
  if (placed.mugBlack) placed.coffeeTable.getObjectByName('mug')?.traverse((o) => (o.visible = false)); // the black mug replaces the plain one

  // ---- out of the living-room window: the window stands open. The fire escape, the back of the building and the
  // roof are areas of their own (assets/layouts/fire_escape.json, rooftop.json), placed by home.js.
  if (platform) placed.livingWindow.getObjectByName('glass')?.traverse((o) => (o.visible = false));

  // ---- furniture you can climb
  if (coll) {
    for (const k of ['bed', 'nightstand', 'couch', 'coffeeTable', 'floorLamp', 'bookshelf', 'livingPlant', 'counter', 'fridge', 'box', 'tomatoes', 'sconce'])
      if (placed[k]) coll.addObject(placed[k]);
    for (const [k, o] of Object.entries(placed)) if (k.startsWith('railing')) coll.addObject(o);
    for (const d of decor) if (d.collide) coll.addObject(d.obj);
  }
  // kitchen counter mug: hide the counter's own decorative mug duplicates? keep, it's the 'mug' thing.

  // small moving things
  const moth = await getProp('moth'); scene.add(moth); placed.moth = moth;
  const leaf = await getProp('leaf'); leaf.visible = false; scene.add(leaf); placed.leaf = leaf;
  const snail = await getProp('snail'); snail.position.set(6.2, 0.975, -2.37); snail.rotation.y = PI / 2; scene.add(snail); placed.snail = snail;
  const bunny = await getProp('dust_bunny'); bunny.position.set(-8.1, 0, -0.35); bunny.visible = false; scene.add(bunny); placed.dustBunny = bunny;
  const coin = await getProp('coin'); coin.visible = false; coin.scale.setScalar(2.2); scene.add(coin); placed.coin = coin;
  // the stash under the fridge (hair tie, bottle cap, olive) appears once found
  {
    const st = new THREE.Group(); st.position.set(4.72, 0.012, -1.55); st.visible = false;
    const b = new Baker();
    b.add(new THREE.TorusGeometry(0.025, 0.008, 6, 14), '#e8a0a8', { pos: [-0.08, 0.008, 0], rot: [PI / 2, 0, 0] });
    b.add(new THREE.TorusGeometry(0.025, 0.008, 6, 14), '#9fc4ff', { pos: [-0.04, 0.008, 0.05], rot: [PI / 2, 0, 0] });
    b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 12), '#d9493c', { pos: [0.04, 0.004, 0.02] });
    b.add(new THREE.SphereGeometry(0.014, 8, 6), '#556b2f', { pos: [0.1, 0.012, -0.01], scl: [1, 0.8, 1.3] });
    st.add(new THREE.Mesh(b.build(), toon));
    scene.add(st); placed.stash = st;
  }

  // ------------------------------------------------------------------ static batching
  // Everything that never moves on its own is merged into one mesh (per shadow setting), so the
  // whole apartment costs a handful of draw calls. Animated nodes and small moving things stay separate.
  {
    // nodes the game animates, per placement: every thing's node, plus a few extras
    const KEEP = { bookshelf: new Set(['book_wobble', 'shelf_mug', 'books']), tomatoes: new Set(['tomato_1', 'tomato_2', 'tomato_3']), bedWindow: new Set(['curtain_L', 'curtain_R', 'glass']), fridge: new Set(['door']) };
    for (const t of THINGS) if (t.node) (KEEP[t.at] ||= new Set()).add(t.node);
    const OBJ_KEEP = new Set(['hairTie', 'slippers', 'laptop', 'floorLamp', 'livingPlant', 'basil', 'box', 'bowl', 'moth', 'leaf', 'snail',
      'dustBunny', 'coin', 'stash', 'neighbourCat', 'sconce', ...decor.map((d) => d.key)]);
    const groups = { cast: [], still: [] };
    const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });
    for (const [key, obj] of Object.entries(placed)) {
      if (OBJ_KEEP.has(key) || !obj) continue;
      obj.updateMatrixWorld(true);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        const keep = KEEP[key];
        if (keep) for (let p = o; p && p !== obj.parent; p = p.parent) if (keep.has(p.name)) return;
        const m = o.material, ca = o.geometry.attributes.color;
        if (!m.isMeshToonMaterial || m.transparent || !ca || o.geometry.morphAttributes.position) return;
        const src = o.geometry;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', src.attributes.position.clone());
        g.setAttribute('normal', src.attributes.normal ? src.attributes.normal.clone() : src.attributes.position.clone());
        const rgb = new Float32Array(ca.count * 3);
        for (let i = 0; i < ca.count; i++) { rgb[i * 3] = ca.getX(i); rgb[i * 3 + 1] = ca.getY(i); rgb[i * 3 + 2] = ca.getZ(i); }
        g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
        if (src.index) g.setIndex(src.index.clone());
        if (!src.attributes.normal) g.computeVertexNormals();
        g.applyMatrix4(o.matrixWorld);
        (o.castShadow ? groups.cast : groups.still).push(g.index ? g : g);
        // hide it without hiding its children (animated nodes often hang under a static mesh)
        o.material = HIDDEN; o.castShadow = false; o.receiveShadow = false; o.userData.batched = true;
      });
    }
    for (const [k, list] of Object.entries(groups)) {
      if (!list.length) continue;
      const anyIdx = list.some((g) => g.index);
      const geos = anyIdx ? list.map((g) => (g.index ? g : (() => { const n = g.attributes.position.count; g.setIndex([...Array(n).keys()]); return g; })())) : list;
      const merged = mergeGeometries(geos, false);
      if (!merged) { console.warn('[batch] merge failed for', k); for (const g of list) g.dispose(); continue; }
      const mesh = new THREE.Mesh(merged, toon);
      mesh.castShadow = k === 'cast'; mesh.receiveShadow = true; mesh.name = 'static-' + k;
      scene.add(mesh);
      for (const g of list) g.dispose();
    }
  }

  // ------------------------------------------------------------------ light
  const halo = (colour, size, opacity) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: colour, opacity, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    s.scale.setScalar(size); return s;
  };
  const anchorPos = (obj, name, fallback) => {
    obj.updateMatrixWorld(true);
    const a = obj.getObjectByName(name);
    return a ? a.getWorldPosition(new THREE.Vector3()) : obj.localToWorld(new THREE.Vector3(...fallback));
  };
  const lamps = {};
  const lending = { on: false }; // the lamps' lights are lent to the street while Ghost is out there (src/home-outside.js)
  const addLamp = (key, pos, colour, intensity, size, { shadow = false, dist = 0 } = {}) => {
    const l = new THREE.PointLight(colour, intensity, dist, 2);
    l.position.copy(pos);
    if (shadow) {
      l.castShadow = true; l.shadow.mapSize.set(512, 512); l.shadow.camera.near = 0.1; l.shadow.camera.far = 12;
      l.shadow.bias = -0.003; l.shadow.normalBias = 0.02; l.shadow.radius = 4;
    }
    scene.add(l);
    const h = halo(colour, size, 0.3); h.position.copy(pos); scene.add(h);
    lamps[key] = { light: l, base: intensity, halos: [h], on: true, level: 1 };
    return lamps[key];
  };
  addLamp('bedLamp', anchorPos(placed.nightstand, 'anchor_light', [0.06, 0.78, -0.02]), '#ffb877', 2.6, 0.7);
  addLamp('livingLamp', anchorPos(placed.floorLamp, 'anchor_light', [0.12, 1.5, 0]), '#ffb36e', 4.2, 0.85, { shadow: true });
  addLamp('sconce', anchorPos(placed.sconce, 'anchor_light', [0, 0, 0.17]), '#ffc58a', 2.0, 0.4);
  addLamp('balcony', new THREE.Vector3(6.55, 0.9, -2.0), '#ffcf8a', 1.2, 0.01);
  if (placed.deskLamp) addLamp('deskLamp', anchorPos(placed.deskLamp, 'anchor_light', [0.2, 0.36, 0]), '#ffc48a', 1.1, 0.35);
  // glow materials of the lamps' own shades, for switching
  const glowMats = (obj) => { const out = []; obj.traverse((o) => { if (o.isMesh && /glow|screen/i.test(o.material.name || '') ) out.push(o.material); }); return out; };
  lamps.bedLamp.mats = glowMats(placed.nightstand);
  lamps.livingLamp.mats = glowMats(placed.floorLamp);
  for (const l of Object.values(lamps)) l.matCols = (l.mats || []).map((m) => m.color.clone());

  scene.add(new THREE.HemisphereLight('#5d6aa8', '#3a2638', 0.75));
  const moonLight = new THREE.DirectionalLight('#8d9ee8', 0.45);
  moonLight.position.set(6, 10, -12);
  scene.add(moonLight);

  // moonbeam on the bedroom floor: a soft window-shaped patch of light
  const beam = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const grd = x.createRadialGradient(64, 64, 10, 64, 64, 70); grd.addColorStop(0, 'rgba(200,215,255,0.9)'); grd.addColorStop(1, 'rgba(200,215,255,0)');
    x.fillStyle = grd; x.fillRect(0, 0, 128, 128);
    x.globalCompositeOperation = 'destination-out'; x.fillStyle = 'rgba(0,0,0,0.85)';
    x.fillRect(60, 0, 8, 128); x.fillRect(0, 66, 128, 7);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.6).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ map: tex, color: '#a9b8ff', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.position.set(ZONES.moonbeam[0], 0.012, ZONES.moonbeam[2]);
    m.rotation.y = 0.18; m.renderOrder = 1;
    scene.add(m);
    return m;
  })();

  // the moon as seen through the bedroom window (close and small, so it sits in the frame)
  const windowMoon = (() => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonFace(false), fog: false, transparent: true, depthWrite: false }));
    s.position.set(-5.75, 1.38, -3.3); s.scale.setScalar(0.42);
    scene.add(s);
    return s;
  })();
  const winkTex = moonFace(true), plainTex = windowMoon.material.map;

  // soft contact shadows under furniture (one draw call)
  {
    const b = new Baker();
    for (const c of COLLIDERS) b.add(new THREE.PlaneGeometry(c.hx * 2 + 0.3, c.hz * 2 + 0.3).rotateX(-PI / 2), '#000000', { pos: [c.x, 0.006, c.z] });
    const tex = radialTexture([[0, 'rgba(255,255,255,1)'], [0.55, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
    const geo = b.build();
    // uv per quad for the soft radial
    const uv = new Float32Array(geo.attributes.position.count * 2);
    for (let i = 0; i < geo.attributes.position.count; i += 4) uv.set([0, 1, 1, 1, 0, 0, 1, 0], i * 2);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#0c0716', map: tex, transparent: true, opacity: 0.5, depthWrite: false }));
    m.renderOrder = 1;
    scene.add(m);
  }

  // ------------------------------------------------------------------ walkable space + paths
  const walk = [];
  for (const id of ROOM_ORDER) { const r = ROOM_RECTS[id]; walk.push({ x0: r.x0 + T / 2, x1: r.x1 - T / 2, z0: r.z0, z1: r.z1 - 0.15, room: id }); }
  for (const d of DOORS) walk.push({ x0: d.x - 0.4, x1: d.x + 0.4, z0: d.z0, z1: d.z1, door: true });

  const roomAt = (p) => {
    for (const id of ROOM_ORDER) { const r = ROOM_RECTS[id]; if (p.x >= r.x0 && p.x < r.x1) return id; }
    return p.x < -5 ? 'bedroom' : 'balcony';
  };

  // Keep a circle of radius r inside the walkable rectangles, and out of furniture unless told otherwise.
  const clampPoint = (p, r, { ignoreColliders = false } = {}) => {
    let best = null, bd = Infinity;
    for (const w of walk) {
      const sx = w.door ? 0 : r, sz = r;
      const x0 = w.x0 + sx, x1 = w.x1 - sx, z0 = w.z0 + sz, z1 = w.z1 - sz;
      const cx = clamp(p.x, x0, x1), cz = clamp(p.z, z0, z1);
      const d = (cx - p.x) ** 2 + (cz - p.z) ** 2;
      if (d < bd) { bd = d; best = [cx, cz]; }
      if (d === 0) break;
    }
    p.x = best[0]; p.z = best[1];
    if (!ignoreColliders) for (const c of COLLIDERS) {
      const hx = c.hx + r, hz = c.hz + r, dx = p.x - c.x, dz = p.z - c.z;
      if (Math.abs(dx) < hx && Math.abs(dz) < hz) {
        const ox = hx - Math.abs(dx), oz = hz - Math.abs(dz);
        if (ox < oz) p.x += Math.sign(dx || 1) * ox; else p.z += Math.sign(dz || 1) * oz;
      }
    }
    return p;
  };

  // Paths: A* on a 15 cm grid over the walkable floor (rooms + doorways), keeping clear of furniture,
  // then string-pulled so Ghost drifts in smooth straight runs rather than grid steps.
  const CELL = 0.15, GX0 = -9.7, GZ0 = BACK - 0.05, NX = Math.ceil((8.7 - GX0) / CELL), NZ = Math.ceil((FRONT + 0.05 - GZ0) / CELL);
  const PR = 0.2; // the cat's radius
  const freeAt = (x, z) => {
    let inWalk = false;
    for (const w of walk) { const sx = w.door ? 0 : PR; if (x >= w.x0 + sx && x <= w.x1 - sx && z >= w.z0 + PR && z <= w.z1 - PR) { inWalk = true; break; } }
    if (!inWalk) return false;
    for (const c of COLLIDERS) if (Math.abs(x - c.x) < c.hx + PR && Math.abs(z - c.z) < c.hz + PR) return false;
    return true;
  };
  const grid = new Uint8Array(NX * NZ);
  for (let i = 0; i < NX; i++) for (let k = 0; k < NZ; k++) grid[i + k * NX] = freeAt(GX0 + (i + 0.5) * CELL, GZ0 + (k + 0.5) * CELL) ? 1 : 0;
  const cellOf = (p) => [clamp(Math.floor((p.x - GX0) / CELL), 0, NX - 1), clamp(Math.floor((p.z - GZ0) / CELL), 0, NZ - 1)];
  const centre = (i, k) => new THREE.Vector3(GX0 + (i + 0.5) * CELL, 0, GZ0 + (k + 0.5) * CELL);
  const nearestFree = ([i0, k0]) => {
    if (grid[i0 + k0 * NX]) return [i0, k0];
    for (let r = 1; r < 30; r++) {
      let best = null, bd = Infinity;
      for (let i = i0 - r; i <= i0 + r; i++) for (let k = k0 - r; k <= k0 + r; k++) {
        if (i < 0 || k < 0 || i >= NX || k >= NZ || !grid[i + k * NX]) continue;
        const d = (i - i0) ** 2 + (k - k0) ** 2; if (d < bd) { bd = d; best = [i, k]; }
      }
      if (best) return best;
    }
    return [i0, k0];
  };
  const lineFree = (a, b) => {
    const n = Math.ceil(a.distanceTo(b) / 0.06);
    for (let j = 1; j < n; j++) { const t = j / n; if (!freeAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false; }
    return true;
  };
  const path = (from, to) => {
    const a = from.clone().setY(0), b = to.clone().setY(0);
    if (freeAt(a.x, a.z) && freeAt(b.x, b.z) && lineFree(a, b)) return [b];
    const s0 = nearestFree(cellOf(a)), g0 = nearestFree(cellOf(b));
    const S0 = s0[0] + s0[1] * NX, G0 = g0[0] + g0[1] * NX;
    const gScore = new Float32Array(NX * NZ).fill(Infinity), came = new Int32Array(NX * NZ).fill(-1), closed = new Uint8Array(NX * NZ);
    const open = [S0]; gScore[S0] = 0;
    const h = (n) => Math.hypot((n % NX) - g0[0], Math.floor(n / NX) - g0[1]);
    let found = false;
    while (open.length) {
      let bi = 0; for (let j = 1; j < open.length; j++) if (gScore[open[j]] + h(open[j]) < gScore[open[bi]] + h(open[bi])) bi = j;
      const cur = open.splice(bi, 1)[0];
      if (cur === G0) { found = true; break; }
      closed[cur] = 1;
      const ci = cur % NX, ck = Math.floor(cur / NX);
      for (let di = -1; di <= 1; di++) for (let dk = -1; dk <= 1; dk++) {
        if (!di && !dk) continue;
        const ni = ci + di, nk = ck + dk;
        if (ni < 0 || nk < 0 || ni >= NX || nk >= NZ) continue;
        const n = ni + nk * NX;
        if (!grid[n] || closed[n]) continue;
        if (di && dk && (!grid[ci + di + ck * NX] || !grid[ci + (ck + dk) * NX])) continue; // no corner cutting
        const g = gScore[cur] + (di && dk ? 1.4142 : 1);
        if (g < gScore[n]) { gScore[n] = g; came[n] = cur; if (!open.includes(n)) open.push(n); }
      }
    }
    if (!found) return [b];
    const cells = []; for (let n = G0; n !== -1; n = came[n]) cells.push(centre(n % NX, Math.floor(n / NX)));
    cells.reverse();
    // string-pull
    const out = []; let anchor = freeAt(a.x, a.z) ? a : cells[0];
    if (anchor === cells[0]) out.push(cells[0]);
    let j = 0;
    while (j < cells.length - 1) {
      let far = j + 1;
      for (let m = cells.length - 1; m > j + 1; m--) if (lineFree(anchor, cells[m])) { far = m; break; }
      out.push(cells[far]); anchor = cells[far]; j = far;
    }
    if (out.length) out.pop();               // replace the last grid cell with the real destination
    out.push(b);
    return out;
  };

  // ------------------------------------------------------------------ zones and moving things
  const zone = (key, pos) => { const o = new THREE.Object3D(); o.position.set(...pos); scene.add(o); placed[key] = o; };
  zone('moonbeam', ZONES.moonbeam); zone('underBed', ZONES.underBed); zone('underFridge', ZONES.underFridge); zone('sky', ZONES.sky);
  const moonWorld = sky.moon.getWorldPosition(new THREE.Vector3());
  zone('skyMoon', [moonWorld.x * 0.25 + 7, moonWorld.y * 0.25, moonWorld.z * 0.25]); // a reachable proxy in the moon's direction
  placed.tomatoes.userData.tomatoes = [1, 2, 3].map((i) => placed.tomatoes.getObjectByName('tomato_' + i)).filter(Boolean);

  // the moth: flutters at the living-room window, or circles the floor lamp when it is on
  const mothState = { t: 0, mode: 'window', dance: 0, chased: 0 };
  const lampPos = lamps.livingLamp.light.position.clone();
  updaters.push((t, dt, ctx) => {
    const wl = moth.getObjectByName('wing_L'), wr = moth.getObjectByName('wing_R');
    const flap = Math.sin(t * 38) * 0.9;
    if (wl) wl.rotation.z = flap; if (wr) wr.rotation.z = -flap;
    const on = lamps.livingLamp.on;
    let p;
    if (mothState.dance > 0) {
      mothState.dance -= dt;
      const c = ctx.catPos;
      p = new THREE.Vector3(c.x + Math.cos(t * 4) * 0.45, 0.55 + Math.sin(t * 6) * 0.15, c.z + Math.sin(t * 4) * 0.45);
    } else if (on) p = new THREE.Vector3(lampPos.x + Math.cos(t * 2.3) * 0.38, lampPos.y - 0.45 + Math.sin(t * 3.1) * 0.12, lampPos.z + Math.sin(t * 2.3) * 0.38);
    else p = new THREE.Vector3(-0.75 + Math.sin(t * 1.3) * 0.4, 1.5 + Math.sin(t * 2.7) * 0.25, -2.15 + Math.abs(Math.sin(t * 0.9)) * 0.2);
    if (mothState.chased > 0) { mothState.chased -= dt; p.x += Math.sin(t * 9) * 0.25; p.y += 0.2; }
    const prev = moth.position.clone();
    moth.position.lerp(p, 1 - Math.exp(-dt * 6));
    const v = moth.position.clone().sub(prev);
    if (v.lengthSq() > 1e-8) moth.rotation.y = Math.atan2(v.x, v.z);
  });

  // the cat next door: slow tail swish
  updaters.push((t) => { const tl = placed.neighbourCat.userData.tail; if (tl) tl.rotation.y = Math.sin(t * 0.9) * 0.35; });

  // the snail: very slowly along the railing and back
  updaters.push((t) => { const u = (t * 0.008) % 2; const f = u < 1 ? u : 2 - u; snail.position.x = 5.6 + f * 2.2; snail.rotation.y = u < 1 ? PI / 2 : -PI / 2; });

  // falling leaves on the balcony, one at a time
  const leafState = { t: 4, y: 0, x: 0, z: 0, active: false };
  updaters.push((t, dt) => {
    leafState.t -= dt;
    if (!leafState.active && leafState.t <= 0) { leafState.active = true; leafState.x = 6 + R() * 2.2; leafState.z = -1.9 + R() * 1.8; leafState.y = 3.2; leaf.visible = true; }
    if (leafState.active) {
      leafState.y -= dt * 0.32;
      leaf.position.set(leafState.x + Math.sin(t * 1.7) * 0.35, leafState.y, leafState.z + Math.cos(t * 1.3) * 0.2);
      leaf.rotation.set(Math.sin(t * 2.3) * 0.8, t, Math.cos(t * 1.9) * 0.6);
      if (leafState.y < 0.02) { leafState.active = false; leaf.visible = false; leafState.t = 6 + R() * 6; }
    }
  });
  placed.leaf.userData.state = leafState;

  // fairy-light twinkle, moonbeam breathing, lamp flicker
  const twinkleMats = [];
  for (const k of ['bedFairy', 'livingFairy', 'balconyFairy']) placed[k].traverse((o) => { if (o.isMesh && /glow/i.test(o.material.name)) twinkleMats.push([o.material, o.material.color.clone(), R() * 6]); });
  updaters.push((t) => {
    for (const [m, c, ph] of twinkleMats) m.color.copy(c).multiplyScalar(0.8 + 0.2 * Math.sin(t * 1.6 + ph));
    beam.material.opacity = beam.visible ? 0.5 + 0.06 * Math.sin(t * 0.7) : 0;
    for (const [k, l] of Object.entries(lamps)) {
      const target = l.on ? 1 : 0;
      l.level += (target - l.level) * 0.25;
      const flick = k === 'balcony' ? 1 : 1 + 0.02 * Math.sin(t * 11 + k.length) * Math.sin(t * 3.3);
      if (!lending.on) l.light.intensity = l.base * l.level * flick; // (while lent to the street's lamps, home-outside.js sets it)
      l.halos[0].material.opacity = 0.3 * l.level;
      (l.mats || []).forEach((m, i) => m.color.copy(l.matCols[i]).multiplyScalar(0.25 + 0.75 * l.level));
    }
  });

  // ------------------------------------------------------------------ night state -> visuals
  const curtains = [placed.bedWindow.getObjectByName('curtain_L'), placed.bedWindow.getObjectByName('curtain_R')].filter(Boolean);
  const applyNight = (ns) => {
    lamps.bedLamp.on = !!ns.bedLamp; lamps.livingLamp.on = !!ns.livingLamp;
    for (const c of curtains) c.userData.goal = ns.curtains ? 0.4 : 1.0;
    beam.visible = !!ns.curtains;
    windowMoon.visible = !!ns.curtains;
  };
  updaters.push((t, dt) => { for (const c of curtains) if (c.userData.goal !== undefined) c.scale.x += (c.userData.goal - c.scale.x) * (1 - Math.exp(-dt * 6)); });

  const update = (t, dt, ctx) => { for (const u of updaters) u(t, dt, ctx); };
  const cameraFor = (roomId) => ({ ...ROOM_RECTS[roomId], id: roomId });
  const setWink = (on) => { windowMoon.material.map = on ? winkTex : plainTex; windowMoon.material.needsUpdate = true; };

  return {
    placed, lamps, lending, colliders: COLLIDERS, walk, rooms: ROOM_RECTS, roomOrder: ROOM_ORDER, decor, livingBack, outsideBack,
    // deferCollision: the caller adds the outside areas to collisionWorld, then builds it itself
    collisionWorld: coll, collision: coll && !deferCollision ? coll.build() : null,
    roomAt, clampPoint, path, cameraFor, update, applyNight, setWink, mothState, sky, beam, windowMoon,
    setStarScale: sky.setStarScale,
    area: { minX: -9.5, maxX: 8.5, minZ: BACK, maxZ: FRONT },
  };
}

// a small moon face for the bedroom window; winking or not
function moonFace(wink) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, '#fffbe6'); g.addColorStop(0.62, '#fff0c4'); g.addColorStop(0.68, 'rgba(255,240,200,0.35)'); g.addColorStop(1, 'rgba(255,240,200,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  if (wink) {
    x.strokeStyle = '#8a6a4a'; x.lineWidth = 4; x.lineCap = 'round';
    x.beginPath(); x.arc(48, 58, 7, PI * 1.1, PI * 1.9); x.stroke();          // closed eye ^
    x.beginPath(); x.moveTo(74, 56); x.lineTo(86, 56); x.stroke();          // wink -
    x.beginPath(); x.arc(64, 74, 10, PI * 0.15, PI * 0.85); x.stroke();      // smile
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
