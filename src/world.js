// The test area: a small rooftop at night. Every prop is built from primitives, merged into one
// vertex-coloured mesh (one draw call each) and given a little hand-made wobble.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Baker, rng, mix, toonMaterial, glowTexture, radialTexture, clamp, toonifyGltf, fitHeight } from './util.js';

const PI = Math.PI;
const rbox = (w, h, d, r = 0.06, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, r);
const cyl = (rt, rb, h, rs = 12, hs = 1, open = false) => new THREE.CylinderGeometry(rt, rb, h, rs, hs, open);
const sph = (r, ws = 14, hs = 10) => new THREE.SphereGeometry(r, ws, hs);
const torus = (R, r, rs = 6, ts = 14, arc = PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc);
const cone = (r, h, rs = 10) => new THREE.ConeGeometry(r, h, rs);

export const AREA = { minX: -5.6, maxX: 5.6, minZ: -4.1, maxZ: 4.2 };
// 1 unit = 1 metre. The roof is about 12 x 9 m.
export const LAMP_POS = new THREE.Vector3(-3.2, 0, -1.4);
export const LAMP_HEIGHT = 3.0;
export const PLANT_HEIGHT = 0.6; // matches the metre-scale export from the asset pipeline
const FOG = '#3b2d57';

export function buildWorld(scene) {
  const R = rng(7);
  const toon = toonMaterial({ vertexColors: true });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const flatMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const props = [];
  const colliders = []; // rounded boxes in world xz: {x, z, hx, hz}
  const updaters = [];

  scene.fog = new THREE.Fog(FOG, 18, 78);
  scene.background = new THREE.Color(FOG);

  // ---------- sky dome (1 call) ----------
  {
    const g = new THREE.SphereGeometry(90, 32, 16);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 90, z = p.getZ(i) / 90;
      const back = clamp(-z * 0.8 + 0.2, 0, 1); // warmer city glow on the far side
      if (y < 0) c.copy(mix(FOG, '#2e2448', -y * 1.2)); // the city below melts into the haze
      else {
        const horizon = mix(FOG, '#5c3d63', back * 0.55);
        c.copy(horizon.lerp(mix('#251d4a', '#0d0b24', (y - 0.12) / 0.8), clamp(y / 0.35, 0, 1)));
      }
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.renderOrder = -10;
    scene.add(sky);
  }

  // ---------- stars (1 call) ----------
  const stars = (() => {
    const n = 340, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = R() * 2 * PI, v = 0.12 + R() * 0.85;
      const rr = 80;
      pos.set([Math.cos(u) * Math.sqrt(1 - v * v) * rr, v * rr, Math.sin(u) * Math.sqrt(1 - v * v) * rr], i * 3);
      const b = 0.35 + R() * 0.65;
      const tint = R() < 0.2 ? [1, 0.9, 0.75] : [0.85, 0.9, 1];
      col.set([tint[0] * b, tint[1] * b, tint[2] * b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m);
    pts.renderOrder = -9;
    scene.add(pts);
    return pts;
  })();

  // ---------- moon (2 calls) ----------
  {
    const disc = radialTexture([[0, '#fffdf2'], [0.40, '#fff3d2'], [0.44, 'rgba(255,240,210,0.30)'], [0.7, 'rgba(255,230,210,0.06)'], [1, 'rgba(255,230,210,0)']], 128);
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: disc, fog: false, depthWrite: false, transparent: true }));
    moon.position.set(-26, 30, -58);
    moon.scale.setScalar(13);
    moon.renderOrder = -8;
    scene.add(moon);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#8f86d8', opacity: 0.22, fog: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending }));
    halo.position.copy(moon.position);
    halo.scale.setScalar(46);
    halo.renderOrder = -8;
    scene.add(halo);
  }

  // ---------- distant skyline (2 calls) ----------
  {
    const bld = new Baker(), win = new Baker();
    const n = 30;
    for (let i = 0; i < n; i++) {
      const phi = -1.55 + (3.1 * (i + R() * 0.7)) / n;
      const rad = 44 + R() * 26;
      const x = Math.sin(phi) * rad, z = -Math.cos(phi) * rad;
      const w = 4 + R() * 6, d = 4 + R() * 4, top = -20 + R() * 15 + (R() < 0.12 ? 10 : 0), base = -60;
      const h = top - base;
      const ry = -phi + (R() - 0.5) * 0.2;
      const shade = mix('#1d1832', '#2c2445', R());
      bld.add(new THREE.BoxGeometry(w, h, d), shade, { pos: [x, base + h / 2, z], rot: [0, ry, 0] });
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0));
      const local = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(x, 0, z));
      if (R() < 0.35) { // water tank on legs, for silhouette
        const t = local((R() - 0.5) * w * 0.5, top, 0);
        bld.add(cyl(0.9, 0.9, 1.6, 10), shade, { pos: [t.x, top + 1.5, t.z] });
        bld.add(cone(1.05, 0.7, 10), shade, { pos: [t.x, top + 2.65, t.z] });
        bld.add(cyl(0.12, 0.12, 0.8, 4), shade, { pos: [t.x - 0.5, top + 0.4, t.z] });
        bld.add(cyl(0.12, 0.12, 0.8, 4), shade, { pos: [t.x + 0.5, top + 0.4, t.z] });
      }
      const cols = Math.max(2, Math.floor(w / 1.2)), rows = Math.floor((top + 45) / 1.4);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (R() > 0.2) continue;
        const lx = -w / 2 + (c + 0.5) * (w / cols), ly = top - 0.9 - r * 1.4;
        const p = local(lx, ly, d / 2 + 0.02);
        const wc = R() < 0.12 ? '#9fcfff' : ['#ffcf7a', '#ffb067', '#ffe2a6', '#ffc28a'][Math.floor(R() * 4)];
        win.add(new THREE.PlaneGeometry(0.55, 0.7), wc, { pos: [p.x, ly, p.z], rot: [0, ry, 0] });
      }
    }
    scene.add(new THREE.Mesh(bld.build(), flatMat));
    scene.add(new THREE.Mesh(win.build(), glowMat));
  }

  // ---------- roof slab + floor ----------
  {
    const slab = new Baker();
    slab.add(rbox(12.7, 0.9, 9.8, 0.12), (x, y) => mix('#2a2238', '#3e3150', (y + 0.9) / 0.9), { pos: [0, -0.47, -0.05] });
    const m = new THREE.Mesh(slab.build(), toon);
    m.receiveShadow = true;
    scene.add(m);

    const g = new THREE.PlaneGeometry(12.3, 9.4, 49, 38);
    g.rotateX(-PI / 2);
    g.translate(0, 0, -0.05);
    g.deleteAttribute('uv');
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const d = Math.hypot(x - LAMP_POS.x, z - LAMP_POS.z);
      const c = mix('#9a7a86', '#4f4468', d / 8.5);
      // fake contact darkening along the parapet
      const edge = Math.min(6.1 - Math.abs(x), z + 4.65);
      c.lerp(new THREE.Color('#2d2440'), clamp(1 - edge / 0.9, 0, 1) * 0.55);
      // a whisper of tile variation
      const n = Math.sin(x * 2.1 + Math.sin(z * 1.3)) * Math.sin(z * 1.9 + x * 0.4);
      c.multiplyScalar(1 + n * 0.035);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const floor = new THREE.Mesh(g, toon);
    floor.receiveShadow = true;
    floor.name = 'floor';
    scene.add(floor);
  }

  // ---------- parapet wall (1 call, tappable) ----------
  {
    const b = new Baker();
    const wallRun = (x0, z0, x1, z1, h0, seed) => {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(L / 1.05));
      const ry = -Math.atan2(z1 - z0, x1 - x0);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        const w = L / n - 0.05, h = h0 + (R() - 0.5) * 0.07;
        const brick = mix('#6c4250', '#8e5c58', R());
        b.add(rbox(w, h, 0.34, 0.07), (px, py) => mix('#3e2a3c', brick, py / h + 0.25), { pos: [x, h / 2, z], rot: [0, ry + (R() - 0.5) * 0.04, (R() - 0.5) * 0.025], wobble: 0.012, seed: seed + i });
        b.add(rbox(w + 0.08, 0.1, 0.44, 0.045), mix('#a88f94', '#c4aaa2', R()), { pos: [x, h + 0.04, z], rot: [0, ry + (R() - 0.5) * 0.05, (R() - 0.5) * 0.03] });
      }
    };
    wallRun(-6.15, -4.65, 6.15, -4.65, 0.62, 1);
    wallRun(-6.15, -4.4, -6.15, 4.5, 0.62, 20);
    wallRun(6.15, -4.4, 6.15, 4.5, 0.62, 40);
    wallRun(-5.9, 4.6, 5.9, 4.6, 0.16, 60); // low front curb keeps the view open
    for (const [x, z, h] of [[-6.15, -4.65, 0.86], [6.15, -4.65, 0.86], [-6.15, 4.6, 0.86], [6.15, 4.6, 0.86]]) {
      b.add(rbox(0.5, h, 0.5, 0.1), '#7a4a52', { pos: [x, h / 2, z] });
      b.add(rbox(0.6, 0.1, 0.6, 0.05), '#c4aaa2', { pos: [x, h + 0.04, z] });
      b.add(sph(0.11, 10, 8), '#c4aaa2', { pos: [x, h + 0.16, z] });
    }
    const wall = new THREE.Mesh(b.build(), toon);
    wall.castShadow = true; wall.receiveShadow = true;
    const grp = new THREE.Group(); grp.add(wall); scene.add(grp);
    props.push({ key: 'wall', object: grp, wobbleAmp: 0, spark: '#ffd2a8', top: 0.8, hitSparkle: true });
  }

  const addProp = (key, group, { pos, rotY = 0, collider, spark, top, wobbleAmp = 0.1, approach }) => {
    group.position.set(pos[0], 0, pos[2]);
    group.rotation.y = rotY;
    scene.add(group);
    if (collider) colliders.push({ x: pos[0] + (collider.ox || 0), z: pos[2] + (collider.oz || 0), hx: collider.hx, hz: collider.hz });
    const prop = { key, object: group, wobbleAmp, spark, top, w: 99, approach };
    props.push(prop);
    return prop;
  };
  const meshOf = (baker, mat = toon, cast = true) => {
    const m = new THREE.Mesh(baker.build(), mat);
    m.castShadow = cast; m.receiveShadow = true;
    return m;
  };

  // ---------- stair hut with door and lit window (2 calls) ----------
  {
    const b = new Baker(), gl = new Baker();
    b.add(rbox(2.8, 2.5, 2.2, 0.14), (x, y) => mix('#5e3b48', '#9a6260', y / 2.5 + 0.1), { pos: [0, 1.25, 0], wobble: 0.03, seed: 3 });
    b.add(rbox(3.25, 0.24, 2.65, 0.1), '#3d3150', { pos: [0, 2.6, 0], rot: [0.03, 0, -0.02], wobble: 0.015, seed: 4 });
    b.add(rbox(1.0, 1.72, 0.1, 0.05), '#7d6a62', { pos: [-0.55, 0.86, 1.1] });            // frame
    b.add(rbox(0.82, 1.6, 0.12, 0.05), '#5a3b33', { pos: [-0.55, 0.81, 1.14] });           // door
    b.add(rbox(0.6, 0.06, 0.04, 0.02), '#4a3029', { pos: [-0.55, 1.25, 1.21] });
    b.add(rbox(0.6, 0.06, 0.04, 0.02), '#4a3029', { pos: [-0.55, 0.45, 1.21] });
    b.add(sph(0.055, 8, 6), '#e0b65e', { pos: [-0.27, 0.85, 1.23] });                    // knob
    b.add(rbox(0.74, 0.62, 0.08, 0.04), '#3a2c3a', { pos: [0.72, 1.62, 1.1] });            // window frame
    b.add(rbox(0.05, 0.5, 0.05, 0.02), '#3a2c3a', { pos: [0.72, 1.62, 1.16] });
    b.add(rbox(0.6, 0.05, 0.05, 0.02), '#3a2c3a', { pos: [0.72, 1.62, 1.16] });
    b.add(rbox(0.86, 0.08, 0.18, 0.03), '#c4aaa2', { pos: [0.72, 1.28, 1.17] });           // sill
    b.add(rbox(1.15, 0.14, 0.45, 0.05), '#8c7a80', { pos: [-0.55, 0.07, 1.33] });          // step
    b.add(rbox(0.9, 0.03, 0.55, 0.015), (x, y, z) => (Math.floor((x + 5) * 6) % 2 ? '#8c3f55' : '#a45a62'), { pos: [-0.55, 0.015, 1.95] }); // doormat
    b.add(cyl(0.13, 0.13, 0.7, 10), '#6a6378', { pos: [0.8, 2.95, -0.5] });                // vent pipe
    b.add(cyl(0.2, 0.2, 0.08, 10), '#6a6378', { pos: [0.8, 3.33, -0.5] });
    gl.add(rbox(0.6, 0.5, 0.04, 0.02), (x, y) => mix('#ffe7b0', '#ffb565', 1.62 - y + 0.4), { pos: [0.72, 1.62, 1.12] });
    const grp = new THREE.Group();
    grp.add(meshOf(b));
    grp.add(new THREE.Mesh(gl.build(), glowMat));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb877', opacity: 0.35, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.set(0.72, 1.62, 1.3); halo.scale.setScalar(1.6);
    grp.add(halo);
    addProp('hut', grp, { pos: [3.65, 0, -3.15], rotY: -0.06, collider: { hx: 1.5, hz: 1.2 }, spark: '#ffcf87', top: 2.9, wobbleAmp: 0.035, approach: [-0.55, 1.9] });
  }

  // ---------- lamp post (2 calls + halos) + the warm light ----------
  let lampLight, lampHalo, lampHalo2, lampProp, lampMeshes;
  {
    const b = new Baker(), gl = new Baker();
    const iron = '#2f2a3e', ironHi = '#4b4260';
    b.add(cyl(0.24, 0.32, 0.24, 14), iron, { pos: [0, 0.12, 0] });
    b.add(torus(0.2, 0.05, 6, 16), ironHi, { pos: [0, 0.26, 0], rot: [PI / 2, 0, 0] });
    b.add(cyl(0.06, 0.09, 2.1, 10), iron, { pos: [0, 1.3, 0], wobble: 0.01 });
    b.add(torus(0.085, 0.035, 6, 12), ironHi, { pos: [0, 0.95, 0], rot: [PI / 2, 0, 0] });
    b.add(torus(0.085, 0.035, 6, 12), ironHi, { pos: [0, 2.3, 0], rot: [PI / 2, 0, 0] });
    b.add(cyl(0.2, 0.12, 0.09, 8), iron, { pos: [0, 2.38, 0] });
    for (let i = 0; i < 4; i++) {
      const a = i * PI / 2 + PI / 4;
      b.add(cyl(0.022, 0.022, 0.46, 5), iron, { pos: [Math.cos(a) * 0.16, 2.64, Math.sin(a) * 0.16] });
    }
    b.add(cone(0.3, 0.24, 8), iron, { pos: [0, 2.98, 0] });
    b.add(torus(0.07, 0.022, 5, 10, PI * 1.5), ironHi, { pos: [0, 3.17, 0] });
    gl.add(sph(0.15, 12, 10), (x, y) => mix('#fff4d6', '#ffbf6e', (2.64 - y) * 3 + 0.4), { pos: [0, 2.64, 0], scl: [1, 1.3, 1] });
    const grp = new THREE.Group();
    const post = meshOf(b, toon, false); // the light sits inside the lantern, so the post must not cast
    lampMeshes = [post, new THREE.Mesh(gl.build(), glowMat)];
    grp.add(...lampMeshes);
    lampHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb46b', opacity: 0.75, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    lampHalo.position.set(0, 2.64, 0); lampHalo.scale.setScalar(2.0);
    lampHalo2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff9a5a', opacity: 0.22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    lampHalo2.position.set(0, 2.64, 0); lampHalo2.scale.setScalar(6.5);
    grp.add(lampHalo, lampHalo2);
    lampLight = new THREE.PointLight('#ffb36e', 22, 0, 1.6);
    lampLight.position.set(LAMP_POS.x, 2.64, LAMP_POS.z);
    lampLight.castShadow = true;
    lampLight.shadow.mapSize.set(512, 512);
    lampLight.shadow.camera.near = 0.2;
    lampLight.shadow.camera.far = 16;
    lampLight.shadow.bias = -0.004;
    lampLight.shadow.normalBias = 0.02;
    lampLight.shadow.radius = 4;
    scene.add(lampLight);
    lampProp = addProp('lamp', grp, { pos: [LAMP_POS.x, 0, LAMP_POS.z], collider: { hx: 0.3, hz: 0.3 }, spark: '#ffd27a', top: 3.1, wobbleAmp: 0.06 });
  }

  // ---------- bench (1 call) ----------
  {
    const b = new Baker();
    const wood = (x, y) => mix('#7a4c36', '#c08a5e', (y - 0.3) * 1.5 + 0.2), iron = '#2f2a3e';
    for (const z of [-0.17, 0.0, 0.17]) b.add(rbox(1.9, 0.07, 0.15, 0.03), wood, { pos: [0, 0.46, z], rot: [0, 0, (R() - 0.5) * 0.02], wobble: 0.006, seed: z * 10 });
    for (const y of [0.7, 0.88]) b.add(rbox(1.9, 0.13, 0.06, 0.03), wood, { pos: [0, y, -0.3 - (y - 0.7) * 0.25], rot: [-0.22, 0, 0], wobble: 0.006, seed: y * 10 });
    for (const x of [-0.78, 0.78]) {
      b.add(cyl(0.035, 0.045, 0.44, 7), iron, { pos: [x, 0.22, 0.17] });
      b.add(cyl(0.035, 0.045, 0.98, 7), iron, { pos: [x, 0.47, -0.27], rot: [-0.18, 0, 0] });
      b.add(rbox(0.07, 0.06, 0.5, 0.025), iron, { pos: [x, 0.41, -0.03] });
      b.add(torus(0.16, 0.028, 5, 10, PI), iron, { pos: [x, 0.5, 0.0], rot: [0, PI / 2, 0] }); // armrest curl
      b.add(sph(0.05, 8, 6), iron, { pos: [x, 0.02, 0.17], scl: [1.3, 0.6, 1.3] });
      b.add(sph(0.05, 8, 6), iron, { pos: [x, 0.02, -0.36], scl: [1.3, 0.6, 1.3] });
    }
    const grp = new THREE.Group(); grp.add(meshOf(b));
    addProp('bench', grp, { pos: [-1.0, 0, -3.25], rotY: 0.08, collider: { hx: 1.0, hz: 0.38 }, spark: '#ffd9a8', top: 1.05, wobbleAmp: 0.07 });
  }

  // ---------- bushes ----------
  const bushBlobs = (b, cx, cy, cz, size, seed) => {
    const r = rng(seed);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2 + r() * 0.6;
      const rad = i === 0 ? 0 : size * (0.45 + r() * 0.2);
      const s = size * (i === 0 ? 0.62 : 0.42 + r() * 0.16);
      const y = cy + s * 0.8 + (i === 0 ? size * 0.25 : r() * size * 0.25);
      b.add(sph(1, 12, 9), (x, yy) => mix('#1f3f3c', '#5c9a68', (yy - cy) / (size * 1.5) + 0.05), {
        pos: [cx + Math.cos(a) * rad, y, cz + Math.sin(a) * rad * 0.7], scl: [s, s * 0.9, s], wobble: 0.04 * size, seed: seed + i,
      });
    }
  };
  {
    const b = new Baker();
    b.add(rbox(1.7, 0.48, 1.0, 0.1), (x, y) => mix('#4d3029', '#8a5a40', y / 0.48 + 0.1), { pos: [0, 0.24, 0], wobble: 0.015, seed: 9 });
    b.add(rbox(1.8, 0.08, 1.1, 0.04), '#a8744e', { pos: [0, 0.5, 0] });
    bushBlobs(b, 0, 0.4, 0, 0.62, 11);
    const grp = new THREE.Group(); grp.add(meshOf(b));
    addProp('bushA', grp, { pos: [-4.7, 0, -3.65], rotY: 0.12, collider: { hx: 0.9, hz: 0.6 }, spark: '#a8f0a0', top: 1.6, wobbleAmp: 0.12 });
  }
  {
    const b = new Baker();
    b.add(cyl(0.55, 0.45, 0.52, 16), (x, y) => mix('#40445e', '#7c84a2', y / 0.52), { pos: [0, 0.26, 0], wobble: 0.012, seed: 5 });
    b.add(torus(0.55, 0.045, 6, 20), '#9aa0bc', { pos: [0, 0.52, 0], rot: [PI / 2, 0, 0] });
    b.add(torus(0.5, 0.03, 5, 20), '#5a5f7c', { pos: [0, 0.12, 0], rot: [PI / 2, 0, 0] });
    bushBlobs(b, 0, 0.4, 0, 0.5, 23);
    const grp = new THREE.Group(); grp.add(meshOf(b));
    addProp('bushB', grp, { pos: [1.45, 0, -3.8], collider: { hx: 0.6, hz: 0.6 }, spark: '#b8f5b0', top: 1.4, wobbleAmp: 0.12 });
  }

  // ---------- potted plant (1 call) ----------
  let plantProp;
  {
    const b = new Baker();
    const prof = [[0.0, 0], [0.22, 0], [0.27, 0.04], [0.31, 0.38], [0.36, 0.42], [0.37, 0.5], [0.33, 0.52], [0.3, 0.5]].map(([x, y]) => new THREE.Vector2(x, y));
    b.add(new THREE.LatheGeometry(prof, 16), (x, y) => mix('#7c3b2e', '#d27a52', y * 1.8), { wobble: 0.01, seed: 2 });
    b.add(cyl(0.3, 0.3, 0.03, 14), '#3b2a2c', { pos: [0, 0.47, 0] });
    const r = rng(31);
    const n = 8;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2 + r() * 0.5;
      const tilt = 0.35 + r() * 0.55, len = 0.38 + r() * 0.16;
      b.add(sph(1, 10, 8), (x, y) => mix('#2f5f45', '#7cc07a', (y - 0.5) * 1.6), {
        pos: [Math.sin(a) * Math.sin(tilt) * len, 0.5 + Math.cos(tilt) * len, Math.cos(a) * Math.sin(tilt) * len],
        rot: [tilt, a, 0], order: 'YXZ', scl: [0.15, len, 0.05],
      });
    }
    const grp = new THREE.Group(); grp.add(meshOf(b));
    plantProp = addProp('plant', grp, { pos: [4.55, 0, 1.6], collider: { hx: 0.38, hz: 0.38 }, spark: '#c8ffb0', top: 1.15, wobbleAmp: 0.14 });
  }

  // ---------- string lights (1 call wire + 1 call bulbs) ----------
  let bulbs;
  {
    const wire = new Baker();
    const strands = [
      [new THREE.Vector3(LAMP_POS.x, 2.32, LAMP_POS.z), new THREE.Vector3(2.35, 2.62, -2.05), 0.65],
      [new THREE.Vector3(LAMP_POS.x, 2.32, LAMP_POS.z), new THREE.Vector3(-6.15, 0.98, -4.65), 0.35],
      [new THREE.Vector3(2.35, 2.62, -2.05), new THREE.Vector3(6.15, 0.98, -4.65), 0.3],
    ];
    const bulbPos = [];
    for (const [a, c, sag] of strands) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        const p = a.clone().lerp(c, t);
        p.y -= Math.sin(t * PI) * sag;
        pts.push(p);
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      wire.add(new THREE.TubeGeometry(curve, 24, 0.012, 4, false), '#1f1a2a');
      const nb = Math.round(curve.getLength() / 0.5);
      for (let i = 1; i < nb; i++) bulbPos.push(curve.getPointAt(i / nb).add(new THREE.Vector3(0, -0.05, 0)));
    }
    scene.add(new THREE.Mesh(wire.build(), toon));
    const g = new THREE.BufferGeometry().setFromPoints(bulbPos);
    const palette = ['#ffcf7a', '#ffb067', '#ff9fb0', '#ffe6a6', '#9fe0d0'];
    const base = new Float32Array(bulbPos.length * 3);
    const c = new THREE.Color();
    bulbPos.forEach((_, i) => { c.set(palette[i % palette.length]); base.set([c.r, c.g, c.b], i * 3); });
    g.setAttribute('color', new THREE.BufferAttribute(base.slice(), 3));
    bulbs = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.34, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    bulbs.userData.base = base;
    scene.add(bulbs);
  }

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight('#6b78c0', '#3a2840', 1.1));
  const moonLight = new THREE.DirectionalLight('#8d9ee8', 0.55);
  moonLight.position.set(-14, 22, -10);
  scene.add(moonLight);

  // ---------- per-frame idle animation ----------
  let lampBoost = 0;
  const lampBase = lampLight.intensity;
  const update = (t, dt) => {
    lampBoost = Math.max(0, lampBoost - dt * 1.6);
    const flick = 1 + 0.035 * Math.sin(t * 13.1) * Math.sin(t * 3.7) + (lampBoost > 0 ? Math.sin(t * 60) * 0.25 * lampBoost + lampBoost * 0.5 : 0);
    lampLight.intensity = lampBase * flick;
    lampHalo.material.opacity = 0.7 * flick;
    lampHalo.scale.setScalar(2.0 * (0.95 + 0.05 * flick) + lampBoost * 0.8);
    const col = bulbs.geometry.attributes.color, base = bulbs.userData.base;
    for (let i = 0; i < col.count; i++) {
      const k = 0.75 + 0.25 * Math.sin(t * 1.7 + i * 1.3);
      col.setXYZ(i, base[i * 3] * k, base[i * 3 + 1] * k, base[i * 3 + 2] * k);
    }
    col.needsUpdate = true;
    for (const p of props) {
      if (p.w > 1.6 || !p.wobbleAmp) continue;
      p.w += dt;
      const s = Math.exp(-p.w * 4.2) * Math.sin(p.w * 19) * p.wobbleAmp;
      p.object.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5);
      p.object.rotation.z = s * 0.35;
      if (p.w > 1.6) { p.object.scale.set(1, 1, 1); p.object.rotation.z = 0; }
    }
  };

  const poke = (prop) => {
    prop.w = 0;
    if (prop.key === 'lamp') lampBoost = 1;
  };

  const setStarScale = (pr) => { stars.material.size = 2.4 * pr; };

  // Real props from the Blender pipeline replace the primitive versions when they load.
  // Scale is applied here for now (lamp 3 m, plant 0.8 m); the artist will re-export at size.
  const loadGlbProps = async () => {
    const loader = new GLTFLoader();
    const load = (url) => new Promise((res) => loader.load(url, (g) => res(g.scene), undefined, () => { console.info('[props] none at', url); res(null); }));
    const [lamp, plant] = await Promise.all([load('assets/props/lamppost.glb'), load('assets/props/potted_plant.glb')]);
    if (lamp) {
      toonifyGltf(lamp, { cast: false }); // the light sits inside the globe: the post must not cast
      fitHeight(lamp, LAMP_HEIGHT);
      lamp.updateMatrixWorld(true);
      const a = lamp.getObjectByName('anchor_light');
      const ap = a ? a.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, LAMP_HEIGHT * 0.83, 0);
      for (const m of lampMeshes) { lampProp.object.remove(m); m.geometry.dispose(); }
      lampProp.object.add(lamp);
      lampHalo.position.copy(ap); lampHalo2.position.copy(ap);
      lampLight.position.set(LAMP_POS.x + ap.x, ap.y, LAMP_POS.z + ap.z);
      lampProp.top = ap.y + 0.45;
    }
    if (plant) {
      toonifyGltf(plant, { cast: true });
      fitHeight(plant, PLANT_HEIGHT);
      for (const m of [...plantProp.object.children]) if (m.isMesh && m.material.visible !== false) { plantProp.object.remove(m); m.geometry.dispose(); }
      plantProp.object.add(plant);
      plantProp.top = PLANT_HEIGHT + 0.1;
    }
    return { lamp: !!lamp, plant: !!plant };
  };

  return { props, colliders, update, poke, setStarScale, loadGlbProps, lampLight, area: AREA };
}
