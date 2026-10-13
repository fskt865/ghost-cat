// Ghost's body: a capsule moving through a static collision world (a BVH over the course geometry).
// Gravity, grounded checks against real meshes, slopes, step-up, coyote time, jump buffering,
// a small second hop, float, ledge pop and ledge magnetism, and a safe respawn. All numbers: tuning.js.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TUNING as T } from './tuning.js';

const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ the static world
export class CollisionWorld {
  constructor() { this.parts = []; this.bvh = null; }
  // any mesh or object tree, at its current world transform
  addObject(obj) {
    obj.updateMatrixWorld(true);
    obj.traverse((o) => {
      if (!o.isMesh || o.userData.noCollide) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', o.geometry.attributes.position.clone());
      if (o.geometry.index) g.setIndex(o.geometry.index.clone());
      g.applyMatrix4(o.matrixWorld);
      this.parts.push(g.index ? g.toNonIndexed() : g);
    });
  }
  addBox(cx, cy, cz, w, h, d, rotY = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(cx, cy, cz), new THREE.Quaternion().setFromAxisAngle(UP, rotY), new THREE.Vector3(1, 1, 1)));
    for (const n of Object.keys(g.attributes)) if (n !== 'position') g.deleteAttribute(n);
    this.parts.push(g.toNonIndexed());
  }
  addGeometry(geo, matrix) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.attributes.position.clone());
    if (geo.index) g.setIndex(geo.index.clone());
    if (matrix) g.applyMatrix4(matrix);
    this.parts.push(g.index ? g.toNonIndexed() : g);
  }
  build() {
    this.geometry = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    this.bvh = new MeshBVH(this.geometry);
    this.geometry.boundsTree = this.bvh;
    return this;
  }
  // first hit along a ray: { point, normal (facing the ray origin), distance } or null
  raycast(origin, dir, far = 100) {
    _ray.origin.copy(origin); _ray.direction.copy(dir);
    const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far);
    if (!hit) return null;
    const n = hit.face.normal.clone();
    if (n.dot(dir) > 0) n.negate();
    return { point: hit.point, normal: n, distance: hit.distance };
  }
  // the walkable surface just below a point (or null)
  groundBelow(p, far, cosSlope) {
    _o.set(p.x, p.y, p.z);
    const h = this.raycast(_o, _down, far);
    return h && h.normal.y >= cosSlope ? h : null;
  }
}
const _ray = new THREE.Ray(), _o = new THREE.Vector3(), _down = new THREE.Vector3(0, -1, 0);

// ------------------------------------------------------------------ the character
export function createBody(world, spawn) {
  const cosSlope = Math.cos(T.maxSlope);
  const pos = spawn.clone(), vel = new THREE.Vector3();
  const seg = new THREE.Line3(new THREE.Vector3(), new THREE.Vector3());
  const box = new THREE.Box3(), triPt = new THREE.Vector3(), capPt = new THREE.Vector3(), dir = new THREE.Vector3(), tmp = new THREE.Vector3();
  const S = {
    grounded: true, groundNormal: UP.clone(), lastGroundedT: 0, jumpBufferT: -9, jumpedSinceGround: false,
    airJumpsLeft: T.airJumps, floating: false, fallStartY: pos.y, now: 0, lastSafe: spawn.clone(), safeT: 0,
    lastPopT: -9, lastBumpT: -9, wallNormal: null, events: [], peakY: pos.y, jumpT: -9,
  };
  const emit = (type, data = {}) => S.events.push({ type, ...data });

  // push the capsule out of everything it overlaps; returns contact info
  function resolve() {
    let ground = null, wall = null, ceiling = false, lowWall = null;
    for (let pass = 0; pass < 2; pass++) {
      seg.start.set(pos.x, pos.y + T.radius, pos.z);
      seg.end.set(pos.x, pos.y + T.height - T.radius, pos.z);
      box.makeEmpty(); box.expandByPoint(seg.start); box.expandByPoint(seg.end);
      box.min.addScalar(-T.radius); box.max.addScalar(T.radius);
      world.bvh.shapecast({
        intersectsBounds: (b) => b.intersectsBox(box),
        intersectsTriangle: (tri) => {
          const d = tri.closestPointToSegment(seg, triPt, capPt);
          if (d >= T.radius) return false;
          dir.subVectors(capPt, triPt);
          if (dir.lengthSq() < 1e-12) tri.getNormal(dir);
          dir.normalize();
          const depth = T.radius - d;
          if (dir.y >= cosSlope) {
            // walkable: lift straight up, so standing on a slope never slides
            const up = Math.min(depth / dir.y, T.radius);
            seg.start.y += up; seg.end.y += up;
            if (!ground || dir.y > ground.y) ground = dir.clone();
          } else {
            seg.start.addScaledVector(dir, depth); seg.end.addScaledVector(dir, depth);
            if (dir.y < -0.35) ceiling = true;
            else {
              wall = dir.clone();
              const feet = seg.start.y - T.radius;
              if (triPt.y - feet < T.stepHeight) lowWall = { normal: dir.clone(), point: triPt.clone() };
            }
          }
          return false;
        },
      });
      pos.set(seg.start.x, seg.start.y - T.radius, seg.start.z);
    }
    return { ground, wall, ceiling, lowWall };
  }

  // one fixed step. input: { move: Vector3 (world, length 0..1), jumpHeld, jumpPressed }
  function step(h, input) {
    S.now += h;
    const wasGrounded = S.grounded;
    const prevVy = vel.y;

    // ---- hops
    if (input.jumpPressed) S.jumpBufferT = S.now;
    const coyote = !S.jumpedSinceGround && S.now - S.lastGroundedT <= T.coyoteTime;
    if (S.now - S.jumpBufferT <= T.jumpBuffer && (S.grounded || coyote)) {
      vel.y = Math.sqrt(2 * T.gravity * T.jumpHeight);
      S.grounded = false; S.jumpedSinceGround = true; S.airJumpsLeft = T.airJumps; S.jumpBufferT = -9; S.jumpT = S.now;
      S.fallStartY = pos.y; S.peakY = pos.y;
      emit('jump');
    } else if (input.jumpPressed && !S.grounded && !coyote && S.airJumpsLeft > 0 && S.now - S.jumpT > 0.08
      // falling and about to land: keep the press for a full hop on landing instead of a small air hop
      && !(vel.y < 0 && world.groundBelow(tmp.set(pos.x, pos.y + 0.05, pos.z), 0.12 - vel.y * T.jumpBuffer, cosSlope))) {
      vel.y = Math.max(vel.y, Math.sqrt(2 * T.gravity * T.airJumpHeight));
      S.airJumpsLeft--; S.jumpBufferT = -9; S.jumpT = S.now; S.peakY = pos.y;
      emit('airJump');
    }

    // ---- run
    const mv = input.move;
    const air = !S.grounded;
    const target = tmp.set(mv.x, 0, mv.z).multiplyScalar(T.runSpeed);
    const hasInput = mv.lengthSq() > 1e-4;
    let accel = air ? (hasInput ? T.airAccel : T.airDecel) : (hasInput ? T.groundAccel : T.groundDecel);
    if (air && S.floating) accel *= T.floatAirAccelScale;
    if (hasInput && vel.x * target.x + vel.z * target.z < 0) accel *= T.turnBoost;
    const dx = target.x - vel.x, dz = target.z - vel.z, dl = Math.hypot(dx, dz), stepA = accel * h;
    if (dl <= stepA) { vel.x = target.x; vel.z = target.z; } else { vel.x += (dx / dl) * stepA; vel.z += (dz / dl) * stepA; }

    // ---- fall / float
    if (air) {
      S.peakY = Math.max(S.peakY, pos.y);
      const autoFloat = S.peakY - pos.y > T.autoFloatHeight;
      const floating = vel.y < 0 && (input.jumpHeld || autoFloat);
      if (floating && !S.floating) emit('float');
      S.floating = floating;
      if (floating) {
        const cap = input.jumpHeld ? T.floatFallSpeed : T.autoFloatFallSpeed;
        vel.y -= T.floatGravity * h;
        if (vel.y < -cap) vel.y += (-cap - vel.y) * Math.min(1, 7 * h);
      } else vel.y -= T.gravity * h;
      vel.y = Math.max(vel.y, -T.maxFall);
    } else { S.floating = false; vel.y = Math.min(vel.y, 0) - T.gravity * h; }

    // ---- move, then collide
    const before = pos.clone();
    pos.addScaledVector(vel, h);
    const c = resolve();

    // step up onto curbs and small ledges instead of stopping
    // (only a step Ghost is walking into: stepping down off a ledge, its edge behind Ghost is not a step up)
    if (c.lowWall && (wasGrounded || S.now - S.lastGroundedT < 0.1) && hasInput && mv.x * c.lowWall.normal.x + mv.z * c.lowWall.normal.z < -0.05) {
      const n = c.lowWall.normal;
      const probe = new THREE.Vector3(pos.x - n.x * (T.radius + 0.08), pos.y + T.stepHeight + 0.06, pos.z - n.z * (T.radius + 0.08));
      const g = world.groundBelow(probe, T.stepHeight + 0.1, cosSlope);
      if (g && g.point.y - pos.y > 0.01 && g.point.y - pos.y <= T.stepHeight) {
        pos.y = g.point.y + 0.005;
        pos.x -= n.x * 0.04; pos.z -= n.z * 0.04;
        c.ground = g.normal; c.wall = null;
      }
    }

    // ---- what we touched
    if (c.wall) {
      const into = -(vel.x * c.wall.x + vel.z * c.wall.z);
      if (into > 1.4 && S.now - S.lastBumpT > 0.35) { S.lastBumpT = S.now; emit('bump', { speed: into, normal: c.wall.clone() }); }
      const vn = vel.dot(c.wall);
      if (vn < 0) vel.addScaledVector(c.wall, -vn);
    }
    if (c.ceiling && vel.y > 0) vel.y = 0;
    let grounded = !!c.ground && vel.y <= 0.5;
    // stay glued to the ground walking down slopes and steps
    if (!grounded && wasGrounded && vel.y <= 0 && S.now - S.jumpT > 0.1) {
      const g = world.groundBelow(tmp.set(pos.x, pos.y + 0.05, pos.z), T.groundSnap + 0.05, cosSlope);
      if (g) { pos.y = g.point.y; grounded = true; c.ground = g.normal; }
    }
    if (grounded) {
      if (!wasGrounded) emit('land', { speed: -prevVy, fall: S.peakY - pos.y });
      vel.y = 0; S.lastGroundedT = S.now; S.jumpedSinceGround = false; S.airJumpsLeft = T.airJumps;
      S.groundNormal.copy(c.ground); S.peakY = pos.y; S.floating = false;
    } else if (wasGrounded && !S.jumpedSinceGround) { S.peakY = pos.y; }
    S.grounded = grounded;
    S.wallNormal = c.wall;

    // ---- forgiveness in the air
    if (!grounded) {
      const fwd = hasInput ? new THREE.Vector3(mv.x, 0, mv.z).normalize() : new THREE.Vector3(vel.x, 0, vel.z);
      // ledge pop: a ledge just ahead and a little above the feet -> hop Ghost up onto it
      if (fwd.lengthSq() > 0.01 && vel.y < 1.5 && S.now - S.lastPopT > 0.3) {
        fwd.normalize();
        const o = new THREE.Vector3(pos.x + fwd.x * (T.radius + T.ledgeReach), pos.y + T.ledgePop + 0.12, pos.z + fwd.z * (T.radius + T.ledgeReach));
        const g = world.groundBelow(o, T.ledgePop + 0.45, cosSlope);
        if (g) {
          const rise = g.point.y - pos.y;
          // only when the ledge really is above Ghost's feet and Ghost is not simply about to land
          const below = world.groundBelow(tmp.set(pos.x, pos.y + 0.05, pos.z), 0.35, cosSlope);
          if (rise > 0.04 && rise <= T.ledgePop && !below && (c.wall || vel.y < 0)) {
            vel.y = Math.max(vel.y, Math.sqrt(2 * T.gravity * (rise + 0.14)));
            vel.x += fwd.x * 0.8; vel.z += fwd.z * 0.8;
            S.lastPopT = S.now; emit('pop');
          }
        }
      }
    }

    // ---- safe spot for respawns: flat ground with ground all around
    S.safeT += h;
    if (grounded && S.safeT > 0.25 && S.groundNormal.y > 0.95) {
      S.safeT = 0;
      let ok = true;
      for (let k = 0; k < 4 && ok; k++) {
        const a = (k / 4) * Math.PI * 2;
        if (!world.groundBelow(tmp.set(pos.x + Math.cos(a) * 0.45, pos.y + 0.2, pos.z + Math.sin(a) * 0.45), 0.4, cosSlope)) ok = false;
      }
      if (ok) S.lastSafe.copy(pos);
    }
    if (pos.y < T.respawnBelow) {
      pos.copy(S.lastSafe).y += 1.2; vel.set(0, 0, 0); S.peakY = pos.y; emit('respawn');
    }
  }

  // ledge magnetism, once per frame: falling with nothing beneath, drift toward the nearest ground
  function magnet(dt) {
    if (S.grounded || vel.y > -0.3) return;
    if (world.groundBelow(tmp.set(pos.x, pos.y + 0.1, pos.z), 1.4, cosSlope)) return;
    let best = null, bd = Infinity;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const o = new THREE.Vector3(pos.x + Math.cos(a) * T.magnetRadius, pos.y + 0.25, pos.z + Math.sin(a) * T.magnetRadius);
      const g = world.groundBelow(o, 1.6, cosSlope);
      if (g && g.point.y <= pos.y + 0.2) { const d = pos.y - g.point.y; if (d < bd) { bd = d; best = a; } }
    }
    if (best !== null) { vel.x += Math.cos(best) * T.magnetPull * dt * 3; vel.z += Math.sin(best) * T.magnetPull * dt * 3; }
  }

  const teleport = (p) => { pos.copy(p); vel.set(0, 0, 0); S.peakY = p.y; S.lastSafe.copy(p); };
  return { pos, vel, S, step, magnet, teleport, drain: () => { const e = S.events; S.events = []; return e; } };
}
