// Ghost: a movement rig that floats, bobs and faces where Ghost goes, wearing the real glTF model
// (assets/ghost.glb) or a sphere placeholder if it is missing. Idle set: bob, breathe, blinks on a
// random timer, ear flicks, tail sway, purr (happy + squash), sitting, and little acts (bat, nudge,
// stare) when Ghost pokes things. Cel outline on Ghost only.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import { Baker, toonMaterial, radialTexture, mix, clamp, damp, dampAngle, addRim, toonifyGltf, fitHeight } from './util.js';

const PI = Math.PI;
export const CAT_HEIGHT = CONFIG.cat.heightM || 0.5;
const HOVER = 0.12;    // gap under the hem while floating
const RADIUS = 0.2;    // for bumping into furniture
const MAX_SPEED = 2.0; // m/s

// ---------- placeholder (spheres), in the canon look: near-black fur fading to ghost-blue at the hem ----------
export function buildPlaceholder(C) {
  const parts = {};
  const g = new THREE.Group();
  const bs = { round: [1, 1, 1], slim: [0.88, 1.06, 0.88], chunky: [1.13, 0.95, 1.13] }[C.build] || [1, 1, 1];
  g.scale.set(...bs);
  const hemCol = mix(C.furColour, C.ghostTint, C.ghostTintAmount ?? 0.4);
  const ghostCol = (x, y) => mix(C.furColour, hemCol, clamp(0.25 - y * 1.6, 0, 1));
  const ghostMat = (op, side = THREE.FrontSide) => addRim(toonMaterial({ vertexColors: true, emissive: C.ghostTint, emissiveIntensity: 0.12, transparent: op < 1, opacity: op, side }), C.ghostTint, 0.9);
  const marks = new Set(C.markings || []);

  const body = new Baker();
  body.add(new THREE.SphereGeometry(0.34, 26, 10, 0, PI * 2, 0, PI / 2), ghostCol);
  body.add(new THREE.SphereGeometry(0.27, 24, 16), ghostCol, { pos: [0, 0.38, 0.05] });
  if (marks.has('chest')) body.add(new THREE.SphereGeometry(0.16, 14, 10), C.whiteColour, { pos: [0, 0.12, 0.26], scl: [1, 1.1, 0.45] });
  if (marks.has('chin')) body.add(new THREE.SphereGeometry(0.07, 10, 8), C.whiteColour, { pos: [0, 0.27, 0.29], scl: [1.2, 0.7, 0.5] });
  parts.body = new THREE.Mesh(body.build(), ghostMat(C.bodyOpacity ?? 0.92));

  const hem = new Baker();
  hem.add(new THREE.CylinderGeometry(0.34, 0.37, 0.34, 48, 4, true), ghostCol, { pos: [0, -0.17, 0] });
  const hemGeo = hem.build();
  hemGeo.userData.base = hemGeo.attributes.position.array.slice();
  parts.hem = new THREE.Mesh(hemGeo, ghostMat(0.86, THREE.DoubleSide));

  const dark = new Baker();
  for (const s of [-1, 1]) {
    dark.add(new THREE.ConeGeometry(0.105, 0.22, 12), C.furColour, { pos: [s * 0.15, 0.6, 0.02], rot: [0, 0, -s * 0.38] });
    dark.add(new THREE.ConeGeometry(0.06, 0.13, 10), C.innerEarColour, { pos: [s * 0.148, 0.585, 0.055], rot: [0.12, 0, -s * 0.38] });
    dark.add(new THREE.SphereGeometry(0.042, 10, 8), C.cheekColour, { pos: [s * 0.165, 0.33, 0.255], scl: [1.2, 0.7, 0.5] });
    if (marks.has('paws')) dark.add(new THREE.SphereGeometry(0.05, 10, 8), C.whiteColour, { pos: [s * 0.12, -0.3, 0.25], scl: [1, 0.6, 1.2] });
  }
  dark.add(new THREE.SphereGeometry(0.026, 10, 8), C.noseColour, { pos: [0, 0.345, 0.322], scl: [1.35, 0.8, 0.8] });
  parts.dark = new THREE.Mesh(dark.build(), toonMaterial({ vertexColors: true }));

  const closed = new Baker();
  for (const s of [-1, 1]) closed.add(new THREE.TorusGeometry(0.042, 0.012, 6, 12, PI), C.eyeColour, { pos: [s * 0.095, 0.392, 0.303], rot: [0, s * 0.32, 0] });
  parts.eyesClosed = new THREE.Mesh(closed.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
  const open = new Baker();
  for (const s of [-1, 1]) {
    open.add(new THREE.SphereGeometry(0.05, 14, 10), C.eyeColour, { pos: [s * 0.095, 0.4, 0.29], rot: [0, s * 0.32, 0], scl: [1, 1.1, 0.55] });
    open.add(new THREE.SphereGeometry(0.03, 10, 8), C.pupilColour, { pos: [s * 0.095, 0.4, 0.317], scl: [0.38 + (C.pupilWidth ?? 0.7) * 0.5, 1.05, 0.4] });
    open.add(new THREE.SphereGeometry(0.011, 6, 5), '#ffffff', { pos: [s * 0.095 + 0.016, 0.425, 0.322] });
  }
  parts.eyesOpen = new THREE.Mesh(open.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));

  const pts = [[0, -0.1, -0.3], [0.06, -0.06, -0.47], [0.14, 0.08, -0.58], [0.13, 0.26, -0.58], [0.05, 0.36, -0.5]].map((p) => new THREE.Vector3(...p));
  const curve = new THREE.CatmullRomCurve3(pts);
  const tubular = 20, radial = 7;
  const tg = new THREE.TubeGeometry(curve, tubular, 0.05, radial, false);
  const tp = tg.attributes.position, tmp = new THREE.Vector3();
  for (let i = 0; i < tp.count; i++) {
    const t = Math.floor(i / (radial + 1)) / tubular;
    curve.getPointAt(t, tmp);
    const k = 1 - t * 0.55;
    tp.setXYZ(i, tmp.x + (tp.getX(i) - tmp.x) * k, tmp.y + (tp.getY(i) - tmp.y) * k, tmp.z + (tp.getZ(i) - tmp.z) * k);
  }
  const tail = new Baker();
  tail.add(tg, (x, y) => ghostCol(x, y * 0.3));
  parts.tail = new THREE.Mesh(tail.build(), ghostMat(C.tailOpacity ?? 0.6));
  parts.tailPivot = new THREE.Group();
  parts.tailPivot.position.set(0, -0.1, -0.3);
  parts.tail.position.set(0, 0.1, 0.3);
  parts.tailPivot.add(parts.tail);

  // ears get their own pivots so they can flick
  parts.ears = [];
  g.add(parts.body, parts.hem, parts.dark, parts.eyesClosed, parts.eyesOpen, parts.tailPivot);
  return { group: g, parts };
}

// ---------- shader helpers for the real model ----------
// Ear flick: vertices above the ear base on one side rotate about that ear's base (z axis = outward tilt).
function earFlickChunk(ear) {
  return `
    {
      float side = transformed.x < 0.0 ? -1.0 : 1.0;
      float w = smoothstep(${ear.baseY.toFixed(4)}, ${(ear.baseY + ear.blend).toFixed(4)}, transformed.y);
      float ang = (side < 0.0 ? uEarL : uEarR) * w * side;
      vec2 piv = vec2(side * ${ear.x.toFixed(4)}, ${ear.baseY.toFixed(4)});
      vec2 d = transformed.xy - piv;
      float c = cos(ang), s = sin(ang);
      transformed.xy = piv + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    }`;
}

export function addEarFlick(material, ear, uniforms) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uEarL = uniforms.uEarL; sh.uniforms.uEarR = uniforms.uEarR;
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'uniform float uEarL;\nuniform float uEarR;\nvoid main() {')
      .replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\n' + earFlickChunk(ear));
  };
  const key = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.customProgramCacheKey = () => key + '|ear';
}

// Inverted-hull outline with a constant screen width. Shares geometry and morphs with its mesh.
export function outlineMaterial(widthPx, colour, uniforms, ear, rgba, mask = null) {
  const m = new THREE.MeshBasicMaterial({ color: colour, side: THREE.BackSide, vertexColors: rgba, transparent: rgba, depthWrite: true });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uOutlinePx: uniforms.uOutlinePx, uRes: uniforms.uRes, uEarL: uniforms.uEarL, uEarR: uniforms.uEarR });
    sh.vertexShader = sh.vertexShader
      .replace('void main() {', 'uniform float uOutlinePx;\nuniform vec2 uRes;\nuniform float uEarL;\nuniform float uEarR;\n' + (mask ? 'varying float vOutlineMask;\n' : '') + 'void main() {')
      .replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\n' + (mask ? `vOutlineMask = (transformed.y > ${mask.above.toFixed(4)} || transformed.y < ${mask.below.toFixed(4)}) ? 1.0 : 0.0;\n` : '') + (ear ? earFlickChunk(ear) : ''))
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec3 vn = normalize(normalMatrix * normal);
        vec2 cn = normalize((projectionMatrix * vec4(vn, 0.0)).xy + 1e-5);
        gl_Position.xy += cn * uOutlinePx * 2.0 / uRes * gl_Position.w;`);
    // outline colour, vertex alpha only (the hem fades, so does its outline)
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', rgba ? 'diffuseColor.a *= vColor.a;' : '');
    // only some parts get an outline (ears and paws): the rest of the hull is discarded
    if (mask) sh.fragmentShader = sh.fragmentShader.replace('void main() {', 'varying float vOutlineMask;\nvoid main() {\n  if (vOutlineMask < 0.5) discard;');
  };
  m.customProgramCacheKey = () => 'ghost-outline' + (ear ? '-ear' : '') + (rgba ? '-a' : '') + (mask ? `-m${mask.above.toFixed(3)}_${mask.below.toFixed(3)}` : '');
  return m;
}

export function createCat(scene, world) {
  const C = CONFIG.cat;
  const rig = new THREE.Group();   // position on the floor + facing
  const bob = new THREE.Group();   // float height, lean and bank; origin = bottom of the hem
  const visual = new THREE.Group(); // the look; squash/breathe scale from the bottom
  rig.add(bob); bob.add(visual);
  rig.position.set(-2.4, 0, 0.9);
  scene.add(rig);

  const ph = buildPlaceholder(C);
  const phWrap = new THREE.Group();
  const phScale = CAT_HEIGHT / 1.05;
  phWrap.scale.setScalar(phScale);
  phWrap.position.y = 0.36 * phScale;
  phWrap.add(ph.group);
  visual.add(phWrap);
  let model = null, mixer = null, morphMeshes = [], tailPivot = null;
  const uniforms = { uEarL: { value: 0 }, uEarR: { value: 0 }, uOutlinePx: { value: 1.6 }, uRes: { value: new THREE.Vector2(1000, 1000) } };

  const hitBall = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hitBall.position.y = CAT_HEIGHT * 0.5;
  bob.add(hitBall);

  const glow = new THREE.PointLight(C.ghostTint, 0.5, 2.0, 1.5);
  glow.position.set(0, CAT_HEIGHT * 0.45, 0.1);
  bob.add(glow);
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.27, 24).rotateX(-PI / 2),
    new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(10,6,24,0.6)'], [0.6, 'rgba(10,6,24,0.28)'], [1, 'rgba(10,6,24,0)']]), transparent: true, depthWrite: false })
  );
  blob.position.y = 0.012; blob.renderOrder = 1;
  scene.add(blob);

  const state = {
    path: [], target: null, face: null, onArrive: null, seat: null, seated: false, sitT: 0,
    vel: new THREE.Vector3(), input: new THREE.Vector2(), hover: HOVER, floorY: 0,
    yaw: 0, eyesOpen: 0, wide: 0, purr: 0, purrT: 9, idleT: 0, modelLoaded: false,
    blinkIn: 2, blinkT: 9, earIn: 3, earT: 9, earSide: 1,
    act: null, actT: 0,
    w: { blink: 0, content: 0, happy: 0, squash: 0 },
  };

  const hitMeshes = () => [hitBall];

  // ---------- real model ----------
  const loadModel = (url = C.model) =>
    new Promise((resolve) => {
      if (!url || new URLSearchParams(location.search).has('placeholder')) return resolve(false);
      new GLTFLoader().load(url, (gltf) => {
        model = gltf.scene;
        toonifyGltf(model, { rim: C.ghostTint, rimStrength: 0.75 });
        fitHeight(model, CAT_HEIGHT);
        model.updateMatrixWorld(true);
        const meshes = [];
        model.traverse((o) => { if (o.isMesh) meshes.push(o); });
        const byRole = (re) => meshes.find((m) => re.test(m.material.name || ''));
        const body = byRole(/body/i), tail = byRole(/tail/i), feat = byRole(/feature/i);
        for (const m of meshes) if (m.morphTargetDictionary) morphMeshes.push(m);

        // ear region from the features mesh: its highest vertices
        let ear = null;
        if (feat) {
          const p = feat.geometry.attributes.position;
          let maxY = -Infinity; for (let i = 0; i < p.count; i++) maxY = Math.max(maxY, p.getY(i));
          const box = new THREE.Box3().setFromBufferAttribute(p);
          const h = box.max.y - box.min.y;
          const baseY = maxY - h * 0.2;
          let sx = 0, n = 0; for (let i = 0; i < p.count; i++) if (p.getY(i) > baseY) { sx += Math.abs(p.getX(i)); n++; }
          ear = { baseY, blend: h * 0.05, x: n ? sx / n : 0.1 };
          addEarFlick(feat.material, ear, uniforms);
        }
        // tail: pivot at its root (the tail vertices nearest the body's centre line)
        if (tail) {
          const p = tail.geometry.attributes.position;
          const pts = []; for (let i = 0; i < p.count; i++) pts.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
          pts.sort((a, b) => b.z - a.z);
          const root = new THREE.Vector3(); const k = Math.max(1, Math.floor(pts.length * 0.06));
          for (let i = 0; i < k; i++) root.add(pts[i]); root.divideScalar(k);
          tailPivot = new THREE.Group();
          tailPivot.position.copy(tail.position).add(root);
          tail.parent.add(tailPivot);
          tailPivot.add(tail);
          tail.position.copy(root).negate();
        }
        // cel outline: inverted hulls sharing geometry and morph weights
        if (new URLSearchParams(location.search).get('outline') !== '0') {
          for (const m of [body, tail, feat].filter(Boolean)) {
            const o = new THREE.Mesh(m.geometry, outlineMaterial(1, '#07050d', uniforms, m === feat ? ear : null, m.geometry.attributes.color?.itemSize === 4));
            o.morphTargetInfluences = m.morphTargetInfluences; o.morphTargetDictionary = m.morphTargetDictionary;
            o.renderOrder = -1; o.raycast = () => {};
            m.add(o);
          }
        }
        visual.add(model);
        phWrap.visible = false;
        if (gltf.animations.length) {
          mixer = new THREE.AnimationMixer(model);
          mixer.clipAction(gltf.animations.find((a) => /idle|float|bob/i.test(a.name)) || gltf.animations[0]).play();
        }
        state.modelLoaded = true;
        resolve(true);
      }, undefined, () => { console.info('[cat] no model at', url, '- using the placeholder'); resolve(false); });
    });

  const setMorph = (name, v) => {
    for (const m of morphMeshes) { const i = m.morphTargetDictionary[name]; if (i !== undefined) m.morphTargetInfluences[i] = v; }
  };

  // ---------- commands ----------
  const clampP = (p, opts) => {
    if (world.clampPoint) return world.clampPoint(p, RADIUS, opts);
    const a = world.area; p.x = clamp(p.x, a.minX, a.maxX); p.z = clamp(p.z, a.minZ, a.maxZ);
    if (!opts?.ignoreColliders) for (const c of world.colliders || []) {
      const hx = c.hx + RADIUS, hz = c.hz + RADIUS, dx = p.x - c.x, dz = p.z - c.z;
      if (Math.abs(dx) < hx && Math.abs(dz) < hz) { const ox = hx - Math.abs(dx), oz = hz - Math.abs(dz); if (ox < oz) p.x += Math.sign(dx || 1) * ox; else p.z += Math.sign(dz || 1) * oz; }
    }
    return p;
  };
  // Drift to a point (through doorways if needed). seat = { y } settles Ghost on a surface there.
  const moveTo = (p, { face = null, onArrive = null, seat = null } = {}) => {
    const dest = new THREE.Vector3(p.x, 0, p.z);
    if (!seat) clampP(dest);
    state.path = world.path ? world.path(rig.position, dest) : [dest];
    state.target = state.path.shift();
    state.face = face; state.onArrive = onArrive; state.seat = seat;
    if (state.seated) stand();
  };
  const stand = () => { state.seated = false; state.sitT = 0; state.floorY = 0; };
  const setInput = (x, z) => { state.input.set(x, z); if (x || z) { state.target = null; state.path = []; state.seat = null; if (state.seated) stand(); } };
  const poke = () => { state.purr = 1; state.purrT = 0; state.idleT = 0; };
  const openEyes = (sec = 1.6) => { state.eyesOpen = Math.max(state.eyesOpen, sec); state.idleT = 0; };
  // little acts when Ghost reaches the thing that was tapped
  const act = (type) => {
    state.act = type; state.actT = 0; state.idleT = 0;
    if (type === 'stare') { state.wide = 1.4; }
    if (type === 'purr') poke();
  };

  const desired = new THREE.Vector3(), tmp = new THREE.Vector3();
  let arrivedCb = null;
  const update = (dt, t, camAz) => {
    // ---- where to go
    desired.set(0, 0, 0);
    if (state.input.lengthSq() > 0) {
      const fx = -Math.sin(camAz), fz = -Math.cos(camAz), rx = Math.cos(camAz), rz = -Math.sin(camAz);
      desired.set(rx * state.input.x + fx * -state.input.y, 0, rz * state.input.x + fz * -state.input.y).normalize().multiplyScalar(MAX_SPEED * 0.85);
    } else if (state.target) {
      tmp.subVectors(state.target, rig.position); tmp.y = 0;
      const d = tmp.length();
      const last = state.path.length === 0;
      // pinned against furniture or a wall short of the exact spot: close enough counts as there
      const sp = Math.hypot(state.vel.x, state.vel.z);
      state.stuckT = sp < 0.06 && d < 0.8 ? (state.stuckT || 0) + dt : 0;
      if (d < (last ? 0.04 : 0.22) || state.stuckT > 0.35) {
        state.stuckT = 0;
        if (!last) state.target = state.path.shift();
        else {
          state.target = null;
          if (state.seat) { state.seated = true; state.floorY = state.seat.y; state.sitT = 0; }
          arrivedCb = state.onArrive; state.onArrive = null;
        }
      } else desired.copy(tmp).multiplyScalar((last ? Math.min(MAX_SPEED, d * 2.6) : MAX_SPEED * 0.9) / d);
    }
    state.vel.lerp(desired, damp(state.target || state.input.lengthSq() ? 7 : 5, dt));
    rig.position.addScaledVector(state.vel, dt);
    clampP(rig.position, { ignoreColliders: !!state.seat || state.seated });
    if (arrivedCb) { const cb = arrivedCb; arrivedCb = null; cb(); }

    const speed = Math.hypot(state.vel.x, state.vel.z);
    const moving = speed > 0.08;
    if (moving || state.purrT < 1.5 || state.act) state.idleT = 0; else state.idleT += dt;
    if (state.seated) state.sitT += dt;

    // ---- facing
    let targetYaw = state.yaw;
    if (speed > 0.1) targetYaw = Math.atan2(state.vel.x, state.vel.z);
    else if (state.face) targetYaw = Math.atan2(state.face.x - rig.position.x, state.face.z - rig.position.z);
    const prevYaw = state.yaw;
    state.yaw = dampAngle(state.yaw, targetYaw, damp(7, dt));
    rig.rotation.y = state.yaw;
    const turnRate = Math.atan2(Math.sin(state.yaw - prevYaw), Math.cos(state.yaw - prevYaw)) / Math.max(dt, 1e-4);

    // ---- float: bob, lean, bank, settle when sitting
    const hoverGoal = state.seated ? 0.02 : HOVER;
    state.hover += (hoverGoal - state.hover) * damp(5, dt);
    const lift = Math.sin(t * 2.1) * (state.seated ? 0.008 : 0.035);
    // floor height eases (so Ghost glides up onto a seat)
    const fy = state.seat && (state.seated || !state.target || state.path.length === 0) ? state.seat.y : 0;
    rig.position.y += (fy - rig.position.y) * damp(state.seat ? 4 : 6, dt);
    bob.position.y = state.hover + lift;
    let leanX = clamp(speed * 0.12, 0, 0.26), leanZ = clamp(-turnRate * 0.04, -0.25, 0.25), push = 0;
    if (state.act) {
      state.actT += dt;
      const a = state.actT;
      if (state.act === 'bat') { push = Math.sin(clamp(a / 0.35, 0, 1) * PI) * 0.09; leanX += Math.sin(clamp(a / 0.35, 0, 1) * PI) * 0.35; if (a > 0.6) state.act = null; }
      else if (state.act === 'nudge') { leanX += Math.sin(clamp(a / 0.7, 0, 1) * PI) * 0.4; push = Math.sin(clamp(a / 0.7, 0, 1) * PI) * 0.05; if (a > 0.7) state.act = null; }
      else if (state.act === 'stare') { leanX -= 0.12 * Math.min(1, a * 4); if (a > 1.2) state.act = null; }
      else if (state.act === 'water') { leanX += 0.2 * Math.sin(clamp(a, 0, 1) * PI); if (a > 1) state.act = null; }
      else if (state.act === 'chase') { if (a > 1.7) state.act = null; }
      else state.act = null;
    }
    bob.rotation.x = THREE.MathUtils.lerp(bob.rotation.x, leanX, damp(8, dt));
    bob.rotation.z = THREE.MathUtils.lerp(bob.rotation.z, leanZ, damp(6, dt));
    bob.position.z = push;
    state.purrT += dt;
    const purrEnv = state.purrT < 1.6 ? Math.exp(-state.purrT * 2.2) : 0;
    const breathe = Math.sin(t * 2.1 + 1.2) * 0.015;
    const sitSq = state.seated ? 0.06 : 0;
    const sq = state.modelLoaded ? 0 : purrEnv * Math.sin(state.purrT * 22) * 0.09 + sitSq;
    visual.scale.set(1 + sq * 0.6 - breathe * 0.5, 1 - sq + breathe, 1 + sq * 0.6 - breathe * 0.5);

    // ---- eyes: open and blinking while busy; content (closed arcs) after a quiet spell or when sitting;
    //      ^ ^ while purring; wide while staring
    state.eyesOpen = Math.max(0, state.eyesOpen - dt);
    state.wide = Math.max(0, state.wide - dt);
    const happy = state.purrT < 1.8;
    const content = !happy && !state.wide && (state.seated ? state.sitT > 0.6 : state.idleT > 6) && state.eyesOpen <= 0;
    const open = !happy && !content;
    state.blinkIn -= dt; state.blinkT += dt;
    if (open && state.blinkIn <= 0 && !state.wide) { state.blinkT = 0; state.blinkIn = 2 + Math.random() * 3.5; }
    const blinking = open && state.blinkT < 0.13;

    // ---- ear flick on a random timer (more often when something just happened)
    state.earIn -= dt; state.earT += dt;
    if (state.earIn <= 0) { state.earT = 0; state.earSide = Math.random() < 0.5 ? -1 : 1; state.earIn = 3 + Math.random() * 5; }
    const flick = state.earT < 0.28 ? Math.sin(state.earT / 0.28 * PI) * 0.45 : 0;
    uniforms.uEarL.value = state.earSide < 0 ? flick : 0;
    uniforms.uEarR.value = state.earSide > 0 ? flick : 0;

    // ---- tail sway
    const sway = Math.sin(t * 1.7) * 0.28 - clamp(turnRate * 0.05, -0.4, 0.4);
    const lift2 = Math.sin(t * 2.1 + 0.6) * 0.08 - speed * 0.1;

    if (state.modelLoaded) {
      const goal = { content: content ? 1 : 0, happy: happy ? 1 : 0, blink: blinking ? 1 : 0, squash: clamp(purrEnv * (0.55 + 0.45 * Math.sin(state.purrT * 26)) + (state.seated ? 0.35 : 0), 0, 1) };
      const k = damp(14, dt), kb = damp(40, dt);
      for (const n of ['content', 'happy', 'squash']) state.w[n] += (goal[n] - state.w[n]) * k;
      state.w.blink += (goal.blink - state.w.blink) * kb;
      const sum = state.w.blink + state.w.content + state.w.happy;
      for (const n of ['blink', 'content', 'happy']) setMorph(n, sum > 1 ? state.w[n] / sum : state.w[n]);
      setMorph('squash', state.w.squash);
      if (tailPivot) { tailPivot.rotation.y = sway; tailPivot.rotation.x = lift2; }
    } else {
      const hemGeo = ph.parts.hem.geometry, pa = hemGeo.attributes.position, base = hemGeo.userData.base;
      const spd = (speed / MAX_SPEED) * 3, wave = 3.4 + spd * 2;
      for (let i = 0; i < pa.count; i++) {
        const bx = base[i * 3], by = base[i * 3 + 1], bz = base[i * 3 + 2];
        const f = clamp(-by / 0.34, 0, 1), f2 = f * f, th = Math.atan2(bz, bx);
        const r = 1 + f2 * (0.05 * Math.sin(th * 6 + t * wave + 1.1) + spd * 0.02);
        pa.setXYZ(i, bx * r, by + f2 * 0.045 * Math.sin(th * 6 + t * wave) + f2 * spd * 0.03, bz * r - f2 * spd * 0.05);
      }
      pa.needsUpdate = true;
      ph.parts.tailPivot.rotation.y = sway * 1.2; ph.parts.tailPivot.rotation.x = lift2 * 1.5;
      ph.parts.eyesOpen.visible = open && !blinking;
      ph.parts.eyesClosed.visible = !ph.parts.eyesOpen.visible;
    }
    if (mixer) mixer.update(dt);

    glow.intensity = 0.45 + Math.sin(t * 2.1) * 0.06 + state.purr * 0.5;
    state.purr = Math.max(0, state.purr - dt * 0.8);

    blob.position.set(rig.position.x, rig.position.y + 0.012, rig.position.z);
    const k = 1 - lift * 4;
    blob.scale.setScalar(k);
    blob.material.opacity = 0.9 * k;
  };

  const setViewport = (wPx, hPx, pr) => { uniforms.uRes.value.set(wPx, hPx); uniforms.uOutlinePx.value = 1.25 * pr; };

  return {
    rig, update, moveTo, stand, setInput, poke, openEyes, act, loadModel, hitMeshes, setMorph, setViewport, state, RADIUS,
    get position() { return rig.position; },
    get velocity() { return state.vel; },
    get moving() { return Math.hypot(state.vel.x, state.vel.z) > 0.08; },
    get busy() { return !!state.target || state.path.length > 0; },
    get top() { return rig.position.y + CAT_HEIGHT + state.hover; },
  };
}
