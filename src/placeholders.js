// Stand-ins built from primitives. Two uses:
//  1. things the artist has not modelled yet (the cat next door, the kitchen sconce, ...): always used;
//  2. a fallback for any assets/props/<name>.glb that fails to load, with the same named child nodes
//     the game animates, so swapping a real model in or out needs no code change.
import * as THREE from 'three';
import { Baker, toonMaterial, mix } from './util.js';

const PI = Math.PI;
const rbox = (w, h, d) => new THREE.BoxGeometry(w, h, d, 2, 2, 2);
const mat = () => toonMaterial({ vertexColors: true });

function meshFrom(build) { const b = new Baker(); build(b); const m = new THREE.Mesh(b.build(), mat()); m.castShadow = true; m.receiveShadow = true; return m; }

// --- always-placeholder things -------------------------------------------------------------

// The ginger cat next door, sitting, for the balcony. `heart` node pops up on the slow blink.
export function neighbourCat() {
  const g = new THREE.Group(); g.name = 'neighbour_cat';
  const fur = '#d98a45', fur2 = '#f2c48b', dark = '#2a1c18';
  const body = meshFrom((b) => {
    b.add(new THREE.SphereGeometry(0.17, 16, 12), (x, y) => mix(fur, fur2, y < 0.12 && Math.abs(x) < 0.08 ? 0.8 : 0), { pos: [0, 0.16, 0], scl: [1, 1.15, 0.95] });
    b.add(new THREE.SphereGeometry(0.12, 16, 12), fur, { pos: [0, 0.38, 0.04] });
    for (const s of [-1, 1]) {
      b.add(new THREE.ConeGeometry(0.045, 0.09, 8), fur, { pos: [s * 0.07, 0.49, 0.03], rot: [0, 0, -s * 0.35] });
      b.add(new THREE.SphereGeometry(0.045, 8, 6), fur2, { pos: [s * 0.07, 0.03, 0.12], scl: [1, 0.6, 1.3] });
      for (let i = 0; i < 3; i++) b.add(new THREE.BoxGeometry(0.03, 0.012, 0.01), '#b8642c', { pos: [s * 0.1, 0.42 - i * 0.025, 0.12 - i * 0.004], rot: [0, s * 0.5, 0] });
    }
    const pts = [[0.12, 0.05, -0.1], [0.2, 0.08, 0.02], [0.22, 0.12, 0.12]].map((p) => new THREE.Vector3(...p));
    b.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.025, 6), fur);
  });
  g.add(body);
  const eyes = meshFrom((b) => { for (const s of [-1, 1]) b.add(new THREE.TorusGeometry(0.022, 0.006, 5, 10, PI), dark, { pos: [s * 0.045, 0.39, 0.155], rot: [0, 0, PI] }); });
  eyes.name = 'eyes'; g.add(eyes);
  return g;
}

// A little heart that pops over the cat next door on the slow blink.
export function heartMarker() {
  const heart = new THREE.Group(); heart.name = 'heart';
  const hm = meshFrom((b) => {
    b.add(new THREE.SphereGeometry(0.03, 10, 8), '#ff7d9c', { pos: [-0.022, 0, 0] });
    b.add(new THREE.SphereGeometry(0.03, 10, 8), '#ff7d9c', { pos: [0.022, 0, 0] });
    b.add(new THREE.ConeGeometry(0.043, 0.06, 10), '#ff7d9c', { pos: [0, -0.035, 0], rot: [PI, 0, 0] });
  });
  hm.castShadow = false;
  heart.add(hm); heart.position.set(0, 0.62, 0); heart.visible = false;
  return heart;
}

// A warm wall sconce for the kitchen (no ceiling to hang a pendant from). anchor_light at the bulb.
export function wallSconce() {
  const g = new THREE.Group(); g.name = 'wall_sconce';
  g.add(meshFrom((b) => {
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 12), '#c99a4a', { pos: [0, 0, 0.015], rot: [PI / 2, 0, 0] });
    b.add(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 6), '#c99a4a', { pos: [0, 0.03, 0.08], rot: [PI / 2.6, 0, 0] });
  }));
  const shade = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10, 0, PI * 2, 0, PI * 0.62), new THREE.MeshBasicMaterial({ color: '#ffd9a0', side: THREE.DoubleSide }));
  shade.name = 'glow'; shade.position.set(0, 0.04, 0.16); shade.rotation.x = PI;
  g.add(shade);
  const a = new THREE.Object3D(); a.name = 'anchor_light'; a.position.set(0, -0.05, 0.4); g.add(a);
  return g;
}

// Glass door frame for the kitchen-to-balcony doorway (built along z, frame faces +x).
export function balconyDoor(width = 1.0, height = 2.15) {
  const g = new THREE.Group(); g.name = 'balcony_door';
  g.add(meshFrom((b) => {
    const c = '#efe2c8';
    b.add(rbox(0.1, height, 0.07), c, { pos: [0, height / 2, -width / 2] });
    b.add(rbox(0.1, height, 0.07), c, { pos: [0, height / 2, width / 2] });
    b.add(rbox(0.12, 0.08, width + 0.07), c, { pos: [0, height, 0] });
    // the open door leaf, swung against the balcony wall
    b.add(rbox(0.05, height - 0.1, 0.05), c, { pos: [0.48, height / 2, -width / 2 - 0.02] });
    b.add(rbox(0.05, height - 0.1, 0.05), c, { pos: [0.95, height / 2, -width / 2 + 0.02] });
    b.add(rbox(0.5, 0.05, 0.05), c, { pos: [0.72, height - 0.1, -width / 2] });
    b.add(rbox(0.5, 0.05, 0.05), c, { pos: [0.72, 0.08, -width / 2] });
  }));
  return g;
}

// Something to tap in the sky: an invisible-ish target (stars, the moon) is just a hit volume,
// built in apartment.js. The shooting star streak lives in fx.

// --- fallback props -------------------------------------------------------------------------
// [w, h, d, colour] for the main body; nodes: name -> [x, y, z, w, h, d, colour]
const FALLBACK = {
  bed: [1.55, 0.5, 2.1, '#8a6a52', { blanket: [0, 0.5, 0.25, 1.5, 0.12, 1.4, '#5b6fa3'] }],
  nightstand: [0.46, 0.55, 0.45, '#a8724c', { lamp: [0.06, 0.55, -0.02, 0.18, 0.25, 0.18, '#ffd58a'] }, { anchor_light: [0, 0.8, 0] }],
  window: [1.2, 1.4, 0.12, '#efe2c8', { glass: [0, 0.7, 0.06, 1.0, 1.2, 0.02, '#4a5aa0'], curtain_L: [0.75, 0.75, 0.2, 0.5, 1.5, 0.04, '#8fae8b'], curtain_R: [-0.75, 0.75, 0.2, 0.5, 1.5, 0.04, '#8fae8b'] }],
  slippers: [0.28, 0.1, 0.27, '#e8a0a8'],
  couch: [1.87, 0.8, 0.88, '#5b6fa3', { cushion_L: [-0.34, 0.45, 0.06, 0.7, 0.15, 0.6, '#8597c7'], cushion_R: [0.34, 0.45, 0.06, 0.7, 0.15, 0.6, '#8597c7'], sweater: [0.82, 0.65, 0.05, 0.3, 0.1, 0.5, '#9a98a8'] }],
  coffee_table: [0.95, 0.43, 0.55, '#a8724c', { mug: [0.22, 0.47, 0.06, 0.09, 0.09, 0.09, '#c8704a'] }],
  floor_lamp: [0.4, 1.5, 0.4, '#2c2b3d', { shade: [0.12, 1.45, 0, 0.3, 0.25, 0.3, '#ffd58a'] }, { anchor_light: [0.12, 1.5, 0] }],
  bookshelf: [0.82, 1.29, 0.32, '#a8724c', { books: [0, 0.6, 0.02, 0.7, 0.25, 0.22, '#7d5174'], book_wobble: [0.22, 0.9, 0.02, 0.06, 0.22, 0.18, '#e0ad48'], shelf_mug: [-0.2, 0.97, 0.04, 0.09, 0.09, 0.09, '#c8704a'] }],
  picture_frame: [0.42, 0.34, 0.04, '#e0ad48', { picture: [0, 0.17, 0.01, 0.38, 0.3, 0.02, '#3b4a8a'] }],
  laptop: [0.33, 0.02, 0.23, '#b9bcc8', { lid: [0, 0.11, -0.11, 0.33, 0.22, 0.01, '#9fc4ff'] }],
  rug: [1.6, 0.02, 1.6, '#e0ad48'],
  potted_plant: [0.4, 0.6, 0.4, '#4f8a55'],
  kitchen_counter: [1.64, 0.92, 0.64, '#8fae8b', { mug: [-0.45, 0.95, 0.2, 0.09, 0.09, 0.09, '#c8704a'], tap: [0.3, 0.92, -0.22, 0.04, 0.2, 0.04, '#b9bcc8'] }, { anchor_drip: [0.3, 1.05, -0.08] }],
  fridge: [0.99, 1.75, 0.73, '#d8ece6', { door: [-0.32, 0.9, 0.36, 0.95, 1.6, 0.04, '#e6f2ee'] }],
  cardboard_box: [0.71, 0.39, 0.56, '#c49a64'],
  food_bowl: [0.2, 0.05, 0.19, '#e8a0a8'],
  basil: [0.2, 0.28, 0.18, '#4f8a55'],
  cactus: [0.11, 0.21, 0.12, '#4f8a55'],
  tomato_planter: [0.65, 0.4, 0.28, '#c8704a', { tomato_1: [0.12, 0.42, 0.05, 0.07, 0.07, 0.07, '#d9493c'], tomato_2: [-0.06, 0.55, 0.06, 0.07, 0.07, 0.07, '#d9493c'], tomato_3: [0.1, 0.68, 0.03, 0.07, 0.07, 0.07, '#d9493c'] }],
  balcony_railing: [1.62, 0.98, 0.06, '#2c2b3d'],
  fairy_lights: [1.5, 0.3, 0.04, '#ffd58a'],
  snail: [0.03, 0.04, 0.07, '#c49a64'],
  leaf: [0.06, 0.02, 0.07, '#e0ad48'],
  moth: [0.09, 0.03, 0.07, '#efe2c8', { wing_L: [0.02, 0.01, 0, 0.04, 0.005, 0.05, '#efe2c8'], wing_R: [-0.02, 0.01, 0, 0.04, 0.005, 0.05, '#efe2c8'] }],
  dust_bunny: [0.1, 0.09, 0.09, '#b9bcc8'],
  hair_tie: [0.06, 0.02, 0.06, '#e8a0a8'],
  coin: [0.03, 0.01, 0.03, '#e0ad48'],
  fishbowl: [0.3, 0.3, 0.3, '#9fc4ff'],
  cat_bed: [0.6, 0.17, 0.6, '#e0ad48'],
  mug: [0.12, 0.09, 0.09, '#c8704a'],
};

export function fallbackProp(name) {
  const spec = FALLBACK[name] || [0.4, 0.4, 0.4, '#9a98a8'];
  const [w, h, d, colour, nodes = {}, anchors = {}] = spec;
  const g = new THREE.Group(); g.name = name; g.userData.placeholder = true;
  const body = meshFrom((b) => b.add(rbox(w, h, d), colour, { pos: [0, h / 2, 0] }));
  g.add(body);
  for (const [n, [x, y, z, nw, nh, nd, c]] of Object.entries(nodes)) {
    const node = new THREE.Group(); node.name = n; node.position.set(x, y, z);
    node.add(meshFrom((b) => b.add(rbox(nw, nh, nd), c)));
    g.add(node);
  }
  for (const [n, [x, y, z]] of Object.entries(anchors)) { const a = new THREE.Object3D(); a.name = n; a.position.set(x, y, z); g.add(a); }
  return g;
}
