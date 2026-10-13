// One particle system (one draw call) for sparkle bursts and the lazy fireflies around the lamp,
// plus a soft ring where the ground was tapped, and the glints (Revision 5): a warm, gently pulsing star on the thing
// Ghost is heading for, and fainter ones on untouched things in view. The glints are points in the same draw call.
import * as THREE from 'three';
import { rng } from './util.js';

const N_MOTES = 30, N_SPARK = 170, N_GLINT = 6, N = N_MOTES + N_SPARK + N_GLINT;

export function createFx(scene, { moteCentre = new THREE.Vector3(-3.2, 0, -1.4), moteSpread = [7, 5] } = {}) {
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 4), size = new Float32Array(N), kind = new Float32Array(N);
  for (let k = 0; k < N_GLINT; k++) kind[N_MOTES + N_SPARK + k] = 1; // the glints draw as a soft halo, not a sparkle
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aColor', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } },
    vertexShader: `
      attribute vec4 aColor; attribute float aSize; attribute float aKind; uniform float uScale; varying vec4 vColor; varying float vKind;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
        gl_Position = projectionMatrix * mv;
        vColor = aColor; vKind = aKind;
      }`,
    fragmentShader: `
      varying vec4 vColor; varying float vKind;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        if (vKind > 0.5) {
          // a glint: a warm soft halo, a small bright core and a thin ring (reads as 'this one', not as dust)
          float halo = pow(max(0.0, 1.0 - d), 2.2) * 0.55;
          float core = smoothstep(0.22, 0.0, d);
          float ring = smoothstep(0.1, 0.0, abs(d - 0.72)) * 0.45;
          float ga = clamp(halo + core + ring, 0.0, 1.0) * vColor.a;
          if (ga < 0.01) discard;
          gl_FragColor = vec4(mix(vColor.rgb, vec3(1.0), core * 0.6), ga);
          return;
        }
        float core = smoothstep(1.0, 0.0, d); core *= core;
        float cross = max(0.0, 1.0 - abs(c.x) * 14.0) * max(0.0, 1.0 - abs(c.y) * 2.2)
                    + max(0.0, 1.0 - abs(c.y) * 14.0) * max(0.0, 1.0 - abs(c.x) * 2.2);
        float a = clamp(core + cross * 0.55, 0.0, 1.0) * vColor.a;
        if (a < 0.01) discard;
        gl_FragColor = vec4(vColor.rgb, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(g, mat);
  points.frustumCulled = false;
  points.renderOrder = 5;
  scene.add(points);

  const R = rng(99);
  const moteOff = Array.from({ length: N_MOTES }, () => ({ dx: R() - 0.5, dz: R() - 0.3, cy: 0.4 + R() * 2.0, a: R() * 6.28, sp: 0.15 + R() * 0.3, r: 0.2 + R() * 0.6, ph: R() * 6.28 }));
  const moteC = moteCentre.clone(), moteGoal = moteCentre.clone();
  let spread = moteSpread.slice();
  const motes = moteOff.map((m) => ({ ...m, cx: 0, cz: 0 }));
  const setMotes = (c, sp = spread) => { moteGoal.copy(c); spread = sp; };
  const sparks = Array.from({ length: N_SPARK }, () => ({ life: 0, max: 1, p: new THREE.Vector3(), v: new THREE.Vector3(), c: new THREE.Color(), s: 0.1, g: 0.6, drag: 2.6, a: 1, grow: 0 }));
  let next = 0;

  // kinds: sparkle (default), hearts (pink, rising slowly), drops (blue, falling), zz (slow, drifting up)
  const burst = (at, colour = '#ffe2a0', n = 16, spr = 0.5, { kind = 'sparkle', scale = 1 } = {}) => {
    const c = new THREE.Color(colour);
    for (let i = 0; i < n; i++) {
      const s = sparks[next]; next = (next + 1) % N_SPARK;
      s.life = 0; s.max = (kind === 'steam' ? 2.4 : kind === 'hearts' || kind === 'zz' ? 1.6 : kind === 'drops' ? 0.9 : 0.8) + R() * 0.7;
      s.a = kind === 'steam' ? 0.22 : 1; s.grow = kind === 'steam' ? 1.6 : 0;
      s.p.set(at.x + (R() - 0.5) * spr, at.y + (R() - 0.3) * spr * 0.6, at.z + (R() - 0.5) * spr);
      const a = R() * 6.28;
      if (kind === 'drops') { s.v.set(Math.cos(a) * 0.3, -0.2 - R() * 0.4, Math.sin(a) * 0.3); s.g = 5; s.drag = 0.5; }
      else if (kind === 'steam') { s.v.set(Math.cos(a) * 0.03, 0.12 + R() * 0.08, Math.sin(a) * 0.03); s.g = -0.02; s.drag = 0.2; }
      else if (kind === 'hearts' || kind === 'zz') { s.v.set(Math.cos(a) * 0.12, 0.25 + R() * 0.25, Math.sin(a) * 0.12); s.g = -0.05; s.drag = 0.3; }
      else { const up = 0.8 + R() * 1.6, out = 0.4 + R() * 1.1; s.v.set(Math.cos(a) * out, up, Math.sin(a) * out); s.g = 0.6; s.drag = 2.6; }
      s.v.multiplyScalar(scale);
      s.c.copy(c).lerp(new THREE.Color('#ffffff'), R() * (kind === 'sparkle' ? 0.4 : 0.15));
      s.s = (kind === 'steam' ? 0.07 : kind === 'drops' ? 0.05 : kind === 'hearts' ? 0.11 : 0.09) * scale + R() * 0.06 * scale;
    }
  };

  // glints: [{ pos, main }] (main: the one Ghost is heading for); each fades in and out on its own
  const glints = Array.from({ length: N_GLINT }, (_, i) => ({ p: new THREE.Vector3(), on: false, main: false, a: 0, ph: i * 1.7, key: null }));
  const setGlints = (list) => {
    const want = list.slice(0, N_GLINT);
    // keep a glint on the same slot while it stays wanted, so it never jumps or restarts its fade
    for (const g of glints) g.on = false;
    const free = [];
    for (const g of glints) { const w = want.find((x) => x.key === g.key && !x.taken); if (w && g.key !== null) { w.taken = true; g.on = true; g.main = !!w.main; g.p.copy(w.pos); } else free.push(g); }
    for (const w of want) { if (w.taken) continue; const g = free.shift(); if (!g) break; g.key = w.key; g.on = true; g.main = !!w.main; g.p.copy(w.pos); if (g.a < 0.01) g.a = 0; }
  };

  // ground tap ring
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.36, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: '#cfe0ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  ring.position.y = 0.02;
  ring.renderOrder = 2;
  scene.add(ring);
  let ringT = 9;
  const ripple = (p) => { ring.position.set(p.x, (p.y ?? 0) + 0.02, p.z); ringT = 0; };

  const update = (dt, t) => {
    moteC.lerp(moteGoal, 1 - Math.exp(-dt * 1.5));
    for (let i = 0; i < N_MOTES; i++) {
      const m = motes[i];
      m.cx = moteC.x + m.dx * spread[0]; m.cz = moteC.z + m.dz * spread[1];
      m.a += dt * m.sp;
      pos[i * 3] = m.cx + Math.cos(m.a) * m.r + Math.sin(t * 0.7 + m.ph) * 0.3;
      pos[i * 3 + 1] = m.cy + Math.sin(t * 0.9 + m.ph) * 0.35;
      pos[i * 3 + 2] = m.cz + Math.sin(m.a * 1.3) * m.r;
      const tw = 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.3 + m.ph * 3));
      col.set([1.0, 0.78, 0.45, tw * 0.85], i * 4);
      size[i] = 0.05;
    }
    for (let j = 0; j < N_SPARK; j++) {
      const s = sparks[j], i = N_MOTES + j;
      if (s.life >= s.max) { col[i * 4 + 3] = 0; size[i] = 0; continue; }
      s.life += dt;
      s.v.multiplyScalar(Math.exp(-dt * s.drag));
      s.v.y -= dt * s.g;
      s.p.addScaledVector(s.v, dt);
      const k = 1 - s.life / s.max;
      pos.set([s.p.x, s.p.y, s.p.z], i * 3);
      col.set([s.c.r, s.c.g, s.c.b, Math.min(1, k * 1.6) * s.a * (s.grow ? Math.min(1, (1 - k) * 5) : 1)], i * 4);
      size[i] = s.grow ? s.s * (1 + (1 - k) * s.grow) : s.s * (0.6 + 0.6 * k);
    }
    for (let k = 0; k < N_GLINT; k++) {
      const gl = glints[k], i = N_MOTES + N_SPARK + k;
      const goal = gl.on ? (gl.main ? 1 : 0.42) : 0;
      gl.a += (goal - gl.a) * (1 - Math.exp(-dt * (gl.on ? 3 : 5)));
      if (!gl.on && gl.a < 0.01) { gl.key = null; col[i * 4 + 3] = 0; size[i] = 0; continue; }
      const pulse = 0.72 + 0.28 * Math.sin(t * (gl.main ? 3.0 : 2.0) + gl.ph);
      pos.set([gl.p.x, gl.p.y + Math.sin(t * 1.6 + gl.ph) * 0.025, gl.p.z], i * 3);
      col.set([1.0, gl.main ? 0.84 : 0.8, gl.main ? 0.52 : 0.6, gl.a * pulse * (gl.main ? 0.95 : 0.7)], i * 4);
      size[i] = (gl.main ? 0.3 : 0.17) * (0.88 + 0.12 * pulse);
    }
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;

    ringT += dt;
    const rk = Math.min(1, ringT / 0.6);
    ring.material.opacity = (1 - rk) * 0.8;
    ring.scale.setScalar(0.6 + rk * 1.2);
    ring.visible = rk < 1;
  };

  const resize = (heightPx, fovDeg) => { mat.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360)); };

  return { burst, ripple, update, resize, setMotes, setGlints, get glintsShown() { return glints.filter((x) => x.a > 0.05).map((x) => ({ key: x.key, main: x.main, a: +x.a.toFixed(2) })); } };
}
