// How Ghost looks while platforming: the glb (or sphere placeholder) with Ghost's cel outline, ear flicks,
// tail sway and face, plus squash and stretch on hops and landings, a lean into Ghost's run, a floaty
// sway while gliding, and a blob shadow cast straight down (the main depth cue for jumping).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import { TUNING as T } from './tuning.js';
import { radialTexture, clamp, damp, dampAngle, toonifyGltf, fitHeight, addRim } from './util.js';
import { buildPlaceholder, addEarFlick, outlineMaterial } from './cat.js';

const PI = Math.PI;

export function createGhostLook(scene, world) {
  const C = CONFIG.cat, H = C.heightM || 0.5;
  const root = new THREE.Group(), turn = new THREE.Group(), bob = new THREE.Group(), visual = new THREE.Group();
  root.add(turn); turn.add(bob); bob.add(visual); scene.add(root);
  const ph = buildPlaceholder(C);
  const phWrap = new THREE.Group(); const phScale = H / 1.05;
  phWrap.scale.setScalar(phScale); phWrap.position.y = 0.36 * phScale; phWrap.add(ph.group); visual.add(phWrap);
  const uniforms = { uEarL: { value: 0 }, uEarR: { value: 0 }, uOutlinePx: { value: 1.6 }, uRes: { value: new THREE.Vector2(1000, 1000) } };
  let modelLoaded = false, morphMeshes = [], tailPivot = null;

  // Ghost's glow is a soft pool painted on the ground under Ghost, not a light, so it never tints Ghost's black body
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6 * H, 32).rotateX(-PI / 2),
    new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(160,180,255,0.55)'], [0.35, 'rgba(140,160,255,0.22)'], [1, 'rgba(120,140,255,0)']]), color: C.ghostTint, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pool.renderOrder = 1; scene.add(pool);
  const glow = { intensity: 0 };
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.6 * H, 24).rotateX(-PI / 2),
    new THREE.MeshBasicMaterial({ map: radialTexture([[0, 'rgba(8,4,20,0.75)'], [0.55, 'rgba(8,4,20,0.4)'], [1, 'rgba(8,4,20,0)']]), transparent: true, depthWrite: false }));
  blob.renderOrder = 2; scene.add(blob);

  const s = { pose: 'stand', stillT: 0, stretchT: 9, warm: false, poseW: 0, loafW: 0, yaw: 0, sq: 0, sqV: 0, idleT: 0, blinkIn: 2, blinkT: 9, earIn: 2, earT: 9, earSide: 1, happyT: 0, w: { blink: 0, content: 0, happy: 0, squash: 0 }, lean: 0, bank: 0, floatT: 0 };

  const loadModel = (url = C.model) => new Promise((resolve) => {
    if (!url || new URLSearchParams(location.search).has('placeholder')) return resolve(false);
    new GLTFLoader().load(url, (gltf) => {
      const model = gltf.scene;
      toonifyGltf(model, {});
      // Ghost's glow is a rim, not a lift: black body, a cool fresnel edge in the asset's rimColour
      model.traverse((o) => {
        if (!o.isMesh || !(o.material.userData.translucent || o.material.transparent)) return;
        const ud = o.material.userData, m = o.material, role = ud.ghostRole || '';
        m.depthWrite = true;
        // the body is solid black (so Ghost's face never shows through from behind); only the hem and the
        // tail tip fade, and never below a floor, so the ground glow does not tint Ghost blue
        if (role === 'body') m.opacity = 1;
        const rim = new THREE.Color(ud.rimColour || C.ghostTint).multiplyScalar(T.ghostRim);
        m.onBeforeCompile = (sh) => {
          sh.uniforms.uRim = { value: rim };
          sh.fragmentShader = sh.fragmentShader
            .replace('void main() {', 'uniform vec3 uRim;\nvoid main() {')
            .replace('#include <color_fragment>', `#include <color_fragment>
              diffuseColor.a = mix(${T.ghostHemFloor.toFixed(2)}, 1.0, diffuseColor.a);`)
            .replace('#include <opaque_fragment>', `
              float rimF = 1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0);
              float edge = pow(rimF, ${T.ghostRimPower.toFixed(2)});
              outgoingLight += uRim * edge;
              diffuseColor.a = max(diffuseColor.a, edge);
              #include <opaque_fragment>`);
        };
        m.customProgramCacheKey = () => 'ghost-body-' + T.ghostRimPower + '-' + T.ghostHemFloor;
      });
      fitHeight(model, H); model.updateMatrixWorld(true);
      const meshes = []; model.traverse((o) => { if (o.isMesh) meshes.push(o); });
      const byRole = (re) => meshes.find((m) => re.test(m.material.name || ''));
      const body = byRole(/body/i), tail = byRole(/tail/i), feat = byRole(/feature/i);
      for (const m of meshes) if (m.morphTargetDictionary) morphMeshes.push(m);
      let ear = null;
      if (feat) {
        const p = feat.geometry.attributes.position, box = new THREE.Box3().setFromBufferAttribute(p);
        const h = box.max.y - box.min.y, baseY = box.max.y - h * 0.2;
        let sx = 0, n = 0; for (let i = 0; i < p.count; i++) if (p.getY(i) > baseY) { sx += Math.abs(p.getX(i)); n++; }
        ear = { baseY, blend: h * 0.05, x: n ? sx / n : 0.1 };
        addEarFlick(feat.material, ear, uniforms);
      }
      if (tail) {
        const p = tail.geometry.attributes.position, pts = [];
        for (let i = 0; i < p.count; i++) pts.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
        pts.sort((a, b) => b.z - a.z);
        const rootP = new THREE.Vector3(), k = Math.max(1, Math.floor(pts.length * 0.06));
        for (let i = 0; i < k; i++) rootP.add(pts[i]); rootP.divideScalar(k);
        tailPivot = new THREE.Group(); tailPivot.position.copy(tail.position).add(rootP);
        tail.parent.add(tailPivot); tailPivot.add(tail); tail.position.copy(rootP).negate();
      }
      // dark outline only on the ears and paws (an outline shell would show through the faded hem)
      if (feat && new URLSearchParams(location.search).get('outline') !== '0') {
        const p = feat.geometry.attributes.position, fb = new THREE.Box3().setFromBufferAttribute(p), fh = fb.max.y - fb.min.y;
        const mask = { above: ear ? ear.baseY - fh * 0.02 : fb.max.y, below: fb.min.y + fh * 0.16 };
        for (const m of [feat]) {
          const o = new THREE.Mesh(m.geometry, outlineMaterial(1, '#07050d', uniforms, ear, m.geometry.attributes.color?.itemSize === 4, mask));
          o.morphTargetInfluences = m.morphTargetInfluences; o.morphTargetDictionary = m.morphTargetDictionary;
          o.renderOrder = -1; o.raycast = () => {}; m.add(o);
        }
      }
      visual.add(model); phWrap.visible = false; modelLoaded = true;
      resolve(true);
    }, undefined, () => resolve(false));
  });
  const setMorph = (name, v) => { for (const m of morphMeshes) { const i = m.morphTargetDictionary[name]; if (i !== undefined) m.morphTargetInfluences[i] = v; } };

  const kick = (amount) => { s.sqV += amount * 18; };
  const happy = (sec = 1.2) => { s.happyT = Math.max(s.happyT, sec); s.idleT = 0; };

  const tmp = new THREE.Vector3();
  function update(dt, t, body, events, inputMag, camYaw = null) {
    const p = body.pos, v = body.vel, S = body.S;
    for (const e of events) {
      if (e.type === 'jump') kick(0.26);
      else if (e.type === 'airJump') kick(0.2);
      else if (e.type === 'land') kick(-Math.min(0.34, 0.06 + e.speed * 0.035));
      else if (e.type === 'bump') { kick(-0.16); s.earT = 0; s.earSide = Math.random() < 0.5 ? -1 : 1; }
      else if (e.type === 'pop') kick(0.12);
      else if (e.type === 'respawn') { happy(1); }
      s.idleT = 0;
    }
    const hs = Math.hypot(v.x, v.z);
    if (hs > 0.15 || !S.grounded) s.idleT = 0; else s.idleT += dt;
    // idle life: stop and Ghost sits; stay and Ghost loafs (sooner on warm, soft spots); a slow stretch to start the night
    s.stillT = hs > 0.08 || !S.grounded ? 0 : s.stillT + dt;
    s.stretchT += dt;
    s.pose = s.stretchT < 2.0 ? 'stretch' : s.stillT > (s.warm ? 2.0 : 7.0) ? 'loaf' : s.stillT > 0.7 ? 'sit' : 'stand';
    s.poseW += ((s.pose === 'sit' || s.pose === 'loaf' ? 1 : 0) - s.poseW) * damp(5, dt);
    s.loafW += ((s.pose === 'loaf' ? 1 : 0) - s.loafW) * damp(2.5, dt);

    // facing and lean
    if (hs > 0.25) s.yaw = dampAngle(s.yaw, Math.atan2(v.x, v.z), damp(14, dt));
    // standing still: turn three-quarters toward the camera, so we see Ghost's face
    else if (camYaw !== null && s.idleT > T.idleFaceCamera) s.yaw = dampAngle(s.yaw, camYaw - 0.55, damp(2.5, dt));
    const prevYaw = turn.rotation.y;
    turn.rotation.y = s.yaw;
    const turnRate = Math.atan2(Math.sin(s.yaw - prevYaw), Math.cos(s.yaw - prevYaw)) / Math.max(dt, 1e-4);
    s.lean += (clamp(hs / T.runSpeed, 0, 1) * (S.grounded ? 0.22 : 0.12) - s.lean) * damp(8, dt);
    s.bank += (clamp(-turnRate * 0.035, -0.3, 0.3) - s.bank) * damp(8, dt);
    s.floatT = S.floating ? s.floatT + dt : 0;
    bob.rotation.set(s.lean, 0, s.bank + (S.floating ? Math.sin(t * 3.2) * 0.12 : 0));

    // height: hover above the feet, bob while idle, a quick lilt while running
    const run = S.grounded ? clamp(hs / T.runSpeed, 0, 1) : 0;
    const idleBob = S.grounded ? Math.sin(t * 2.1) * 0.025 * (1 - run) : 0;
    const runBob = Math.abs(Math.sin(t * 10.5)) * 0.045 * run;
    root.position.set(p.x, p.y, p.z);
    bob.position.y = (T.hover + idleBob * (1 - s.loafW * 0.8)) * (1 - s.poseW * 0.75) + runBob + (S.floating ? Math.sin(t * 2.6) * 0.02 : 0);
    bob.rotation.x -= s.poseW * 0.06;

    // squash & stretch spring
    const k = 220, c = 15;
    s.sqV += (-k * s.sq - c * s.sqV) * dt; s.sq += s.sqV * dt; s.sq = clamp(s.sq, -0.4, 0.4);
    const air = !S.grounded && !S.floating ? clamp(v.y / 12, -0.08, 0.1) : 0;
    const fl = S.floating ? 0.05 : 0;
    let q = s.sq + air;
    // the stretch: up and long, then a settle
    if (s.pose === 'stretch') { const k = s.stretchT / 2.0; q += Math.sin(Math.min(1, k * 1.4) * PI) * 0.18; }
    const loaf = s.loafW * 0.08;
    visual.scale.set(1 - q * 0.5 + fl + loaf, 1 + q - fl * 0.5 - loaf, 1 - q * 0.5 + fl + loaf);

    // face
    s.happyT = Math.max(0, s.happyT - dt);
    const happyNow = s.happyT > 0;
    const content = !happyNow && (s.idleT > 5 || S.floating || s.pose === 'loaf');
    const wide = !S.grounded && !S.floating && v.y < -6;
    const open = !happyNow && !content;
    s.blinkIn -= dt; s.blinkT += dt;
    if (open && !wide && s.blinkIn <= 0) { s.blinkT = 0; s.blinkIn = 2 + Math.random() * 3.5; }
    const blinking = open && !wide && s.blinkT < 0.12;
    s.earIn -= dt; s.earT += dt;
    if (s.earIn <= 0) { s.earT = 0; s.earSide = Math.random() < 0.5 ? -1 : 1; s.earIn = 2.5 + Math.random() * 5; }
    const flick = s.earT < 0.28 ? Math.sin((s.earT / 0.28) * PI) * 0.5 : 0;
    uniforms.uEarL.value = s.earSide < 0 ? flick : 0; uniforms.uEarR.value = s.earSide > 0 ? flick : 0;
    // sitting, the tail curls round Ghost and only the tip twitches
    const sway = (Math.sin(t * (1.7 + run * 5)) * (0.25 + run * 0.25) - clamp(turnRate * 0.05, -0.4, 0.4)) * (1 - s.poseW * 0.7) + s.poseW * 0.9;
    const lift = Math.sin(t * 2.1 + 0.6) * 0.08 - hs * 0.08 + (S.floating ? 0.25 : 0);
    if (modelLoaded) {
      const yawn = s.pose === 'stretch' && s.stretchT > 0.3 && s.stretchT < 1.5;
      const goal = { content: content && !yawn ? 1 : 0, happy: happyNow || yawn ? 1 : 0, blink: blinking ? 1 : 0, squash: clamp(-s.sq * 2 + s.poseW * 0.25 + s.loafW * 0.3, 0, 1) };
      const kk = damp(14, dt);
      for (const n of ['content', 'happy', 'squash']) s.w[n] += (goal[n] - s.w[n]) * kk;
      s.w.blink += (goal.blink - s.w.blink) * damp(40, dt);
      const sum = s.w.blink + s.w.content + s.w.happy;
      for (const n of ['blink', 'content', 'happy']) setMorph(n, sum > 1 ? s.w[n] / sum : s.w[n]);
      setMorph('squash', s.w.squash);
      if (tailPivot) { tailPivot.rotation.y = sway; tailPivot.rotation.x = lift; }
    } else {
      ph.parts.tailPivot.rotation.y = sway; ph.parts.tailPivot.rotation.x = lift;
      ph.parts.eyesOpen.visible = open && !blinking; ph.parts.eyesClosed.visible = !ph.parts.eyesOpen.visible;
    }
    glow.intensity = 0.8 + Math.sin(t * 2.1) * 0.1 + (S.floating ? 0.2 : 0);

    // blob shadow on whatever is below
    const g = world.raycast(tmp.set(p.x, p.y + 0.15, p.z), new THREE.Vector3(0, -1, 0), 40);
    if (g) {
      const hgt = p.y - g.point.y;
      blob.visible = true;
      blob.position.set(p.x, g.point.y + 0.015, p.z);
      const sc = clamp(1 - hgt * 0.09, 0.4, 1);
      blob.scale.setScalar(sc);
      blob.material.opacity = clamp(1 - hgt * 0.07, 0.35, 1);
      blob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), g.normal);
      pool.visible = true; pool.position.copy(blob.position); pool.position.y -= 0.002; pool.quaternion.copy(blob.quaternion);
      pool.material.opacity = clamp(1 - hgt * 0.25, 0, 1) * glow.intensity;
    } else { blob.visible = false; pool.visible = false; }
  }

  const setViewport = (w, h, pr) => { uniforms.uRes.value.set(w, h); uniforms.uOutlinePx.value = 1.25 * pr; };
  const stretch = () => { s.stretchT = 0; s.stillT = 0; };
  return { root, update, loadModel, setViewport, kick, happy, stretch, set warm(v) { s.warm = v; }, get pose() { return s.pose; }, get modelLoaded() { return modelLoaded; }, s };
}
