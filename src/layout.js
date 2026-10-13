// Places an area from assets/layouts/<area>.json into the scene: kit pieces (glbs, through props.js's loader and toon
// pass), ground slabs, the things the engine builds itself ("solids"), named touch spots, lights with halos and warm
// pools, cats, camera zones, fall zones and the ghost start. Static pieces are merged (batch.js), pieces with an id are
// drawn by one BatchedMesh each for toon and glow (prop-batch.js) so they can still wobble, and pieces with
// role 'keep' stay their own meshes (animated nodes, see-through things, things that fade).
//
//   const area = await loadLayout(scene, 'assets/layouts/rooftop.json', { world: collisionWorld });
//   area.placed.chimney        // the chimney's Object3D (by its id)
//   area.update(t, dt)         // light flicker; after moving a batched prop: area.sync(obj)
//
// Options: world (a physics CollisionWorld to add colliders to), place (overrides the JSON's), realLights (false =
// make no PointLights; `lights` still lists every lamp for the caller to light), fx (src/fx.js: runs the `fx` emitters).
// update(t, dt, camera, emit = true): flicker, cat tails, fx emitters, and ceilings (`ground` with ceiling: true) that hide while
// the camera is above them.
//
// JSON (written by tools/stage_areas.py / tools/stage_home_outside.py; every position is relative to `place`):
//   place   {position, rotationY}           where the area's local frame sits in the world (options.place overrides it)
//   pieces  [{glb, position, rotationY, scale, id?, collide?: 'mesh'|'none', role?: 'static'|'prop'|'keep',
//             tilt?: [rx, rz], fade?: true, open_nodes?: {node: radians}, keep_nodes?: [node], no_collide_nodes?: [node],
//             tint?: [r, g, b], batch?: name}]
//           keep_nodes: the piece is merged like a static one, except the named nodes, which stay live meshes (a shop
//           front that costs no draw call of its own, with its curtain still free to sway); no_collide_nodes: those
//           nodes are left out of the collision (an open door); tint: multiplies the piece's colours (a darker stone);
//           batch: static pieces with the same name are merged into their own meshes (mesh.userData.batch), so a caller
//           can hide a far part of an area on its own
//   ground  [{name, top_y, centre, size_xz, colour, noise?, thickness?, collide?, shape?: 'disc', rotationY?}]  slabs (centre.y is the top)
//   solids  [{type, ...}]   box | brick | windows | block | stair | pole           (see the build* functions below)
//   spots   [{id, position}]                named touch points with no model (an empty Object3D in `placed`)
//   lights  [{type: 'point', position, colour, intensity, distance, halo, flicker, pool?: {y, r, colour?}}]
//   cats    [{glb, position, rotationY, pose}]
//   zones   [{min, max, zoom, pitch, aim, yawRange?, priority, name}]   follow-camera.js zones
//   pits    [{min, max}]                    a fall that ends in here floats Ghost back to the last safe spot
//   ghost   {position, rotationY}           where Ghost starts in this area (when it is the first one)
//   fx      [{kind: steam | dust | fireflies | mist | moths, position, size?, rate?, count?, height?}]  particle emitters
//   (other keys, e.g. things, routes, ambient, camera, are data for the game and ignored here)
import * as THREE from 'three';
import { Baker, rng, mix, toonMaterial, glowTexture, radialTexture } from './util.js';
import { getProp, preload } from './props.js';
import { batchStatic } from './batch.js';
import { createPropBatch } from './prop-batch.js';

const PI = Math.PI;
const UP = new THREE.Vector3(0, 1, 0);

export async function loadLayout(scene, src, { world = null, place = null, castShadow = false, realLights = true, fx = null } = {}) {
  const data = typeof src === 'string' ? await (await fetch(src)).json() : src;
  const P = place || data.place || { position: [0, 0, 0], rotationY: 0 };
  const root = new THREE.Group();
  root.name = 'area-' + data.area;
  root.position.set(...P.position); root.rotation.y = P.rotationY || 0;
  scene.add(root); root.updateMatrixWorld(true);
  const M = root.matrixWorld;
  const W = (v) => new THREE.Vector3(...v).applyMatrix4(M);          // local -> world
  const R = rng(data.area.length * 7 + 3);
  const toon = toonMaterial({ vertexColors: true });

  const placed = {}, statics = [], props = [], keeps = [], fadeables = [];

  // ------------------------------------------------------------------ kit pieces
  await preload([...new Set([...(data.pieces || []), ...(data.cats || [])].map((p) => p.glb))]);
  const pieceObjs = await Promise.all((data.pieces || []).map(async (p) => {
    const o = await getProp(p.glb, { scale: p.scale || 1, fallback: () => null });
    if (!o) { console.warn('[layout] missing', p.glb); return null; }
    o.position.set(...p.position);
    o.rotation.order = 'YXZ';
    o.rotation.set(p.tilt ? p.tilt[0] : 0, p.rotationY || 0, p.tilt ? p.tilt[1] : 0);
    for (const [n, ang] of Object.entries(p.open_nodes || {})) { const nd = o.getObjectByName(n); if (nd) nd.rotation.y += ang; }
    for (const n of p.no_collide_nodes || []) o.getObjectByName(n)?.traverse((m) => { m.userData.noCollide = true; });
    for (const n of p.keep_nodes || []) o.getObjectByName(n)?.traverse((m) => { m.userData.noBatch = true; });
    if (p.tint) o.traverse((m) => { if (m.isMesh && m.material.color) { m.material = m.material.clone(); m.material.color.multiply(new THREE.Color(...p.tint)); } });
    o.traverse((m) => { if (m.isMesh) { m.castShadow = castShadow && !m.material.transparent; m.receiveShadow = !m.material.transparent; } });
    root.add(o);
    return o;
  }));
  root.updateMatrixWorld(true);
  (data.pieces || []).forEach((p, i) => {
    const o = pieceObjs[i]; if (!o) return;
    o.userData.layout = p;
    if (p.id) placed[p.id] = o;
    if (world && p.collide === 'mesh') world.addObject(o);
    const role = p.fade ? 'keep' : p.keep_nodes ? 'static' : p.role || (p.id ? 'prop' : 'static');
    (role === 'static' ? statics : role === 'prop' ? props : keeps).push(o);
    if (p.fade) fadeables.push(o);
  });

  // ------------------------------------------------------------------ cats
  const cats = [];
  for (const c of data.cats || []) {
    const o = await getProp(c.glb, { fallback: () => null }); if (!o) continue;
    o.position.set(...c.position); o.rotation.y = c.rotationY || 0; root.add(o);
    o.traverse((m) => { if (m.isMesh && m.morphTargetDictionary) for (const [k, v] of Object.entries(c.pose || {})) if (m.morphTargetDictionary[k] !== undefined) m.morphTargetInfluences[m.morphTargetDictionary[k]] = v; });
    cats.push({ obj: o, tail: o.getObjectByName('tail'), def: c });
    if (c.id) placed[c.id] = o;
  }

  // ------------------------------------------------------------------ ground slabs + solids (merged per material)
  const bake = { toon: new Baker(), glow: new Baker(), inside: new Baker(), insideGlow: new Baker() };
  const used = new Set();
  const add = (kind, geo, colour, opt) => { bake[kind].add(geo, colour, opt); used.add(kind); };
  const L2W = (geo) => geo.applyMatrix4(M);                          // bake in world space

  const ceilings = [];
  for (const g of data.ground || []) {
    const th = g.thickness ?? 0.3, [w, d] = g.size_xz, c = g.centre, n = g.noise || 0; // centre[1] is the top surface
    if (g.ceiling) { // its own mesh: hidden while the camera is above it (looking into a room from over the roofs)
      const m = new THREE.Mesh(L2W(new THREE.BoxGeometry(w, th, d).translate(c[0], c[1] - th / 2, c[2])), toonMaterial({ color: g.colour }));
      m.name = `${data.area}-ceiling`; scene.add(m); ceilings.push({ mesh: m, y: W(c).y - th });
      if (world && g.collide !== false) { const cw = W([c[0], c[1] - th / 2, c[2]]); world.addBox(cw.x, cw.y, cw.z, w, th, d, P.rotationY || 0); }
      continue;
    }
    const cell = g.pattern === 'tar' ? 0.25 : 0.8;
    // shape 'disc': a round slab (a plaza); rotationY turns a slab about its centre (paths at an angle)
    const base = g.shape === 'disc' ? new THREE.CylinderGeometry(w / 2, w / 2, th, 28, 1) : new THREE.BoxGeometry(w, th, d, Math.max(1, Math.round(w / cell)), 1, Math.max(1, Math.round(d / cell)));
    const geo = L2W(base.rotateY(g.rotationY || 0).translate(c[0], c[1] - th / 2, c[2]));
    const topY = W(c).y;
    // 'tar': rolled roofing, strips 0.9 m wide with dark seams, a few patched squares
    const tar = (x, z) => {
      const seam = Math.abs(((z + 50) % 0.9) - 0.45) > 0.4 ? 0.22 : 0;
      const px = Math.floor((x + 50) / 1.1), pz = Math.floor((z + 50) / 0.9), h = Math.sin(px * 12.9898 + pz * 78.233) * 43758.5453;
      return seam + ((h - Math.floor(h)) < 0.12 ? 0.12 : 0) - ((h - Math.floor(h)) > 0.92 ? 0.08 : 0);
    };
    add('toon', geo, (x, y, z) => mix(g.colour, '#000000', n * (0.5 + 0.5 * Math.sin(x * 1.7) * Math.sin(z * 2.3)) + (g.pattern === 'tar' ? tar(x, z) : 0) + (y < topY - 0.01 ? 0.3 : 0)));
    if (world && g.collide !== false) { const cw = W([c[0], c[1] - th / 2, c[2]]); world.addBox(cw.x, cw.y, cw.z, w, th, d, (P.rotationY || 0) + (g.rotationY || 0)); }
  }

  for (const s of data.solids || []) {
    const kind = s.hide_inside ? (s.glow ? 'insideGlow' : 'inside') : (s.glow ? 'glow' : 'toon');
    switch (s.type) {
      case 'box': buildBox(s, kind); break;
      case 'brick': buildBrick(s, kind); break;
      case 'windows': buildWindows(s); break;
      case 'block': buildBlock(s); break;
      case 'pole': buildPole(s); break;
      case 'stair': buildStair(s); break;
      default: console.warn('[layout] unknown solid', s.type);
    }
  }

  // box: centre, size [w, h, d], rotationY?, colour | colours [a, b] (brick pattern), visible (default true),
  // collide (default true), glow (unlit), hide_inside (its own mesh, hidden while the camera is indoors)
  function buildBox(s, kind) {
    const [w, h, d] = s.size, c = s.centre;
    if (s.visible !== false) {
      const geo = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w / 0.4)), Math.max(1, Math.round(h / 0.22)), Math.max(1, Math.round(d / 0.4)))
        .rotateY(s.rotationY || 0).translate(...c);
      const cl = s.colours || (Array.isArray(s.colour) ? s.colour : null);
      add(kind, L2W(geo), cl ? brickColour(cl) : (s.colour || '#6a5a6a'), { wobble: s.wobble || 0, seed: c[0] + c[2] });
    }
    if (world && s.collide !== false) { const cw = W(c); world.addBox(cw.x, cw.y, cw.z, w, h, d, (s.rotationY || 0) + (P.rotationY || 0)); }
  }

  // brick: a flat brick face. plane 'z' runs along x at z = at (u = x), plane 'x' runs along z at x = at (u = z);
  // facing +1/-1 is the side it is seen from; holes [[u centre, half width, y0, y1]] stay open (windows).
  function buildBrick(s, kind) {
    const rects = []; let cur = s.u0;
    const holes = [...(s.holes || [])].sort((a, b) => a[0] - b[0]);
    for (const [cu, hw, h0, h1] of holes) {
      rects.push([cur, cu - hw, s.y0, s.y1]); rects.push([cu - hw, cu + hw, s.y0, h0]); rects.push([cu - hw, cu + hw, h1, s.y1]);
      cur = cu + hw;
    }
    rects.push([cur, s.u1, s.y0, s.y1]);
    for (const [a, b, y0, y1] of rects) {
      if (b - a < 1e-3 || y1 - y0 < 1e-3) continue;
      const k = s.detail || 1; // >1: coarser (far walls)
      const geo = new THREE.PlaneGeometry(b - a, y1 - y0, Math.max(1, Math.ceil((b - a) / (0.4 * k))), Math.max(1, Math.ceil((y1 - y0) / (0.22 * k))));
      placePlane(geo, s.plane, s.at, (a + b) / 2, (y0 + y1) / 2, s.facing);
      add(kind, L2W(geo), brickColour(s.colours || ['#5c3a40', '#7a4a48'], s.plane));
    }
  }
  function placePlane(geo, plane, at, u, y, facing) {
    if (plane === 'z') { if (facing < 0) geo.rotateY(PI); geo.translate(u, y, at); }
    else { geo.rotateY(facing > 0 ? PI / 2 : -PI / 2); geo.translate(at, y, u); }
    return geo;
  }

  // windows: a grid of window panes on a face (same plane/at/u0/u1/y0/y1/facing as brick), `lit` of them warm
  function buildWindows(s, kindLit, kindDark) {
    const r = rng(s.seed || 1), [ww, wh] = s.size || [0.55, 0.75];
    const cols = s.cols, rows = s.rows, du = (s.u1 - s.u0) / cols, dy = rows > 1 ? (s.y1 - s.y0 - wh) / (rows - 1) : 0;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const u = s.u0 + du * (i + 0.5), y = s.y0 + wh / 2 + dy * j, lit = r() < (s.lit ?? 0.4);
      const pane = placePlane(new THREE.PlaneGeometry(ww, wh), s.plane, s.at + s.facing * 0.012, u, y, s.facing);
      const warm = ['#ffcf7a', '#ffb067', '#ffe2a6', '#ffc28a', '#ffd9a0'][Math.floor(r() * 5)];
      add(lit ? (kindLit || (s.hide_inside ? 'insideGlow' : 'glow')) : (kindDark || (s.hide_inside ? 'inside' : 'toon')), L2W(pane), lit ? (r() < 0.1 ? '#a8d4ff' : warm) : '#2a2a48');
      const sill = placePlane(new THREE.BoxGeometry(ww + 0.12, 0.05, 0.06), s.plane, s.at + s.facing * 0.03, u, y - wh / 2 - 0.03, s.facing);
      add(kindDark || (s.hide_inside ? 'inside' : 'toon'), L2W(sill), '#c9b292');
    }
  }

  // block: a neighbour building seen from home. min/max corners, faces ['+z', '-x', ...] get brick, a tar roof with a
  // low parapet on top, and windows {faces, cols, rows, lit, y0} on some faces
  function buildBlock(s) {
    const [x0, y0, z0] = s.min, [x1, y1, z1] = s.max, cols = s.colours;
    for (const f of s.faces) {
      const plane = f[1] === 'z' ? 'z' : 'x', facing = f[0] === '+' ? 1 : -1;
      const at = plane === 'z' ? (facing > 0 ? z1 : z0) : (facing > 0 ? x1 : x0);
      const [u0, u1] = plane === 'z' ? [x0, x1] : [z0, z1];
      buildBrick({ plane, at, u0, u1, y0, y1, facing, colours: cols, detail: s.detail ?? 3 }, 'toon');
      const w = s.windows || {};
      if ((w.faces || []).includes(f)) {
        const wy0 = w.y0 ?? y0 + 0.9, rows = w.rows || Math.max(1, Math.floor((y1 - wy0) / 3));
        buildWindows({ plane, at, u0: u0 + 0.6, u1: u1 - 0.6, y0: wy0, y1: Math.min(y1 - 0.6, wy0 + (rows - 1) * 3 + 0.8), facing, cols: w.cols || Math.max(2, Math.floor((u1 - u0) / 2)), rows, lit: w.lit ?? 0.4, seed: (s.seed || 1) * 13 + f.charCodeAt(1), size: [0.6, 0.85] });
      }
    }
    // roof slab and parapet ring
    add('toon', L2W(new THREE.BoxGeometry(x1 - x0, 0.2, z1 - z0, Math.ceil((x1 - x0) / 1.5), 1, Math.ceil((z1 - z0) / 1.5)).translate((x0 + x1) / 2, y1 - 0.1, (z0 + z1) / 2)),
      (x, y, z) => mix(s.roof || '#3b3550', '#1e1a2a', 0.25 + 0.25 * Math.sin(x * 1.3) * Math.sin(z * 1.1)));
    const ph = s.parapet ?? 0.45, t = 0.22;
    for (const [a0, a1, b0, b1] of [[x0, x1, z0, z0 + t], [x0, x1, z1 - t, z1], [x0, x0 + t, z0, z1], [x1 - t, x1, z0, z1]])
      add('toon', L2W(new THREE.BoxGeometry(a1 - a0, ph, b1 - b0).translate((a0 + a1) / 2, y1 + ph / 2, (b0 + b1) / 2)), (x, y) => (y > y1 + ph - 0.06 ? '#bfae96' : mix(cols[0], cols[1], 0.4)));
  }

  // pole: a cylinder from `from` to `to` (radius, colour); visual only
  function buildPole(s) {
    const a = W(s.from), b = W(s.to), len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(s.radius || 0.04, (s.radius || 0.04) * 1.15, len, 8);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
    geo.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    add('toon', geo, s.colour || '#5a4234');
  }

  // stair: a fire-escape flight from `from` (bottom, on the lower deck) to `to` (top), `width` wide. Walkable: the
  // collision is a ramp under the treads; rails [left, right] are invisible walls (railings let a ghost through, but
  // never off). Its own mesh, so it can fade when it comes between the camera and Ghost.
  function buildStair(s) {
    const A = W(s.from), B = W(s.to), w = s.width || 0.6;
    const flat = new THREE.Vector3(B.x - A.x, 0, B.z - A.z), run = flat.length(), rise = B.y - A.y;
    const dir = flat.clone().normalize(), side = new THREE.Vector3(-dir.z, 0, dir.x), slope = Math.atan2(rise, run), hyp = Math.hypot(run, rise);
    const yaw = Math.atan2(-dir.z, dir.x);
    // a frame whose +x runs up the stair, +y is the stair's "up", +z is across
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, slope, 'YZX'));
    const frame = (cx, cy, cz) => new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), q, new THREE.Vector3(1, 1, 1));
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const nrm = new THREE.Vector3(0, 1, 0).applyQuaternion(q), across = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const b = new Baker(), col = s.colour || '#2c2b3d';
    const steps = Math.max(3, Math.round(rise / 0.2));
    for (let i = 0; i < steps; i++) {
      const k = (i + 0.5) / steps, p = A.clone().lerp(B, k);
      b.add(new THREE.BoxGeometry(run / steps + 0.02, 0.035, w - 0.04), mix(col, '#4a4860', 0.25), { pos: [p.x, p.y - 0.01, p.z], rot: [0, yaw, 0] });
    }
    for (const sgn of [-1, 1]) {
      const c = mid.clone().addScaledVector(across, sgn * w / 2).addScaledVector(nrm, -0.06);
      const g = new THREE.BoxGeometry(hyp + 0.1, 0.16, 0.035); g.applyMatrix4(frame(c.x, c.y, c.z)); b.add(g, col);
      if ((s.rails || [true, true])[sgn < 0 ? 0 : 1]) {
        const top = mid.clone().addScaledVector(across, sgn * (w / 2 + 0.01)).add(new THREE.Vector3(0, 0.82, 0));
        const gr = new THREE.BoxGeometry(hyp, 0.035, 0.035); gr.applyMatrix4(frame(top.x, top.y, top.z)); b.add(gr, col);
        const nPost = Math.max(2, Math.round(run / 0.9));
        for (let i = 0; i <= nPost; i++) {
          const p = A.clone().lerp(B, i / nPost).addScaledVector(across, sgn * (w / 2 + 0.01));
          b.add(new THREE.BoxGeometry(0.03, 0.82, 0.03), col, { pos: [p.x, p.y + 0.41, p.z] });
        }
      }
    }
    const mesh = new THREE.Mesh(b.build(), toonMaterial({ vertexColors: true })); mesh.name = 'stair'; mesh.receiveShadow = true;
    scene.add(mesh);
    if (s.fade) fadeables.push(mesh);
    if (world) {
      const c = mid.clone().addScaledVector(nrm, -0.05);
      world.addGeometry(new THREE.BoxGeometry(hyp, 0.1, w), frame(c.x, c.y, c.z));
      // rail_trim: shorter invisible rails, so a turn from one half of a landing to the other is never blocked where
      // two flights meet (the front fire escape's switchbacks)
      const rl = hyp - 2 * (s.rail_trim || 0);
      for (const [i, sgn] of [[0, -1], [1, 1]]) if ((s.rails || [true, true])[i]) {
        const rc = mid.clone().addScaledVector(across, sgn * (w / 2 + 0.05)).add(new THREE.Vector3(0, 0.5, 0));
        world.addGeometry(new THREE.BoxGeometry(rl, 1.2, 0.06), frame(rc.x, rc.y, rc.z));
      }
    }
  }

  // brick colours by position: courses 0.22 m, staggered bricks 0.4 m, three shades
  function brickColour([a, b], plane) {
    return (x, y, z) => {
      const u = plane === 'x' ? z : x, row = Math.floor((y + 50) / 0.22);
      const n = Math.floor((u + 50 + (row % 2) * 0.2) / 0.4);
      const v = Math.sin(row * 12.9898 + n * 78.233) * 43758.5453;
      return mix(a, b, ((row + n) % 3) / 3 * 0.8 + (v - Math.floor(v)) * 0.2);
    };
  }

  const meshes = {};
  for (const k of used) {
    const mat = k === 'glow' || k === 'insideGlow' ? new THREE.MeshBasicMaterial({ vertexColors: true }) : toon;
    const m = new THREE.Mesh(bake[k].build(), mat); m.name = `${data.area}-${k}`; m.receiveShadow = k === 'toon' || k === 'inside';
    scene.add(m); meshes[k] = m;
  }

  // ------------------------------------------------------------------ spots
  for (const s of data.spots || []) { const o = new THREE.Object3D(); o.position.set(...s.position); o.name = s.id; root.add(o); placed[s.id] = o; }
  root.updateMatrixWorld(true);

  // ------------------------------------------------------------------ lights: point lights, one Points of halos, one mesh of warm pools
  const lights = [], haloPts = [], haloCols = [], pools = [];
  for (const l of data.lights || []) {
    const p = W(l.position);
    let light = null;
    // realLights false: the caller lends a few real lights to the nearest lamps (each light costs every lit pixel)
    if (l.intensity > 0 && realLights) { light = new THREE.PointLight(l.colour, l.intensity, l.distance || 0, 2); light.position.copy(p); scene.add(light); }
    lights.push({ light, base: l.intensity, flicker: l.flicker ?? 0.02, phase: R() * 9, pos: p, colour: new THREE.Color(l.colour), distance: l.distance || 0 });
    if (l.halo) { haloPts.push(p); haloCols.push(new THREE.Color(l.colour)); }
    if (l.pool) pools.push({ x: p.x, z: p.z, y: W([0, l.pool.y, 0]).y, r: l.pool.r, c: new THREE.Color(l.pool.colour || l.colour) });
  }
  let halos = null;
  if (haloPts.length) {
    const g = new THREE.BufferGeometry().setFromPoints(haloPts);
    g.setAttribute('color', new THREE.Float32BufferAttribute(haloCols.flatMap((c) => [c.r, c.g, c.b]), 3));
    halos = new THREE.Points(g, new THREE.PointsMaterial({ map: glowTexture(), vertexColors: true, size: 1.1, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    halos.name = data.area + '-halos'; scene.add(halos);
  }
  let poolMesh = null;
  if (pools.length) {
    const pos = [], uv = [], col = [], idx = [];
    pools.forEach((q, i) => {
      for (const [dx, dz, u, v] of [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]]) { pos.push(q.x + dx * q.r, q.y, q.z + dz * q.r); uv.push(u, v); col.push(q.c.r, q.c.g, q.c.b); }
      idx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
    const tex = radialTexture([[0, 'rgba(255,255,255,0.9)'], [0.35, 'rgba(255,255,255,0.45)'], [0.7, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)']], 128);
    poolMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 }));
    poolMesh.renderOrder = 1; poolMesh.name = data.area + '-pools'; scene.add(poolMesh);
  }

  // ------------------------------------------------------------------ batching
  const groups = new Map();
  for (const o of statics) { const g = o.userData.layout?.batch || ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(o); }
  const staticMeshes = [];
  for (const [g, list] of groups) for (const m of batchStatic(scene, list, { toon, skip: (o) => o.userData.noBatch })) { m.userData.batch = g; staticMeshes.push(m); }
  const liveNodes = []; // keep_nodes meshes left out of the static merge (they still draw, and can move)
  for (const o of statics) o.traverse((m) => { if (m.isMesh && m.userData.noBatch) liveNodes.push(m); });
  const propBatch = createPropBatch(scene, props);

  // ------------------------------------------------------------------ zones, pits, start (to world)
  const box3 = (z) => new THREE.Box3().setFromPoints([W(z.min), W(z.max), W([z.min[0], z.min[1], z.max[2]]), W([z.max[0], z.max[1], z.min[2]])]);
  const zones = (data.zones || []).map((z) => { const b = box3(z); return { ...z, min: b.min, max: b.max, priority: z.priority ?? 1 }; });
  const pits = (data.pits || []).map((z) => { const b = box3(z); return { min: b.min, max: b.max }; });
  const ghost = data.ghost ? { position: W(data.ghost.position), rotationY: (data.ghost.rotationY || 0) + (P.rotationY || 0) } : null;

  // particle emitters (src/fx.js): soft, slow and sparse
  const FX = { steam: ['#efe9ff', 'steam', 1.0, 0.05], dust: ['#fff0d0', 'sparkle', 1.5, 0.3], fireflies: ['#e8ff9a', 'sparkle', 0, 0.45], mist: ['#cfd8ff', 'steam', 0.6, 0.0], moths: ['#f4ecd8', 'sparkle', 2.0, 0.35] };
  const emitters = (data.fx || []).filter((e) => FX[e.kind]).map((e) => ({ ...e, p: W(e.position), acc: R(), rate: e.rate ?? (e.kind === 'fireflies' ? (e.count || 8) / 2.5 : FX[e.kind][2]) }));
  const ep = new THREE.Vector3();
  const update = (t, dt = 0, camera = null, emit = true) => {
    for (const l of lights) if (l.light && l.flicker) l.light.intensity = l.base * (1 + l.flicker * Math.sin(t * 9.3 + l.phase) * Math.sin(t * 2.7 + l.phase * 2));
    for (const c of cats) if (c.tail) c.tail.rotation.y = Math.sin(t * 0.9 + c.obj.position.x) * 0.3;
    if (fx && emit) for (const e of emitters) {
      e.acc += dt * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        const [col, kind, , scale] = FX[e.kind], sz = e.size || [0.2, 0.2, 0.2];
        if (e.kind === 'moths') { const a = R() * 6.28; ep.set(e.p.x + Math.cos(a) * 0.4, e.p.y - 0.2 + R() * 0.4, e.p.z + Math.sin(a) * 0.4); }
        else ep.set(e.p.x + (R() - 0.5) * sz[0], e.p.y + (R() - 0.5) * (sz[1] ?? 0.2), e.p.z + (R() - 0.5) * (sz[2] ?? sz[0]));
        fx.burst(ep, col, 1, 0.05, kind === 'steam' ? { kind } : { scale });
      }
    }
    if (camera) for (const c of ceilings) c.mesh.visible = camera.position.y < c.y;
  };
  return {
    data, root, placed, cats, lights, halos, poolMesh, meshes, staticMeshes, propBatch, keeps, fadeables, zones, pits, ghost, update, ceilings, liveNodes, props,
    sync: (o) => propBatch.syncObject(o), toWorld: W,
    insideMeshes: [meshes.inside, meshes.insideGlow].filter(Boolean),
  };
}
