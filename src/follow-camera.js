// The automatic camera: behind and a little above Ghost, swinging lazily behind Ghost's direction of
// travel (never flipping when Ghost runs toward it), looking a little ahead, easing up and down softly,
// pulling back in open places and closer in tight ones (camera zones), and moving in front of walls
// that would hide Ghost. A right-half swipe nudges it; it drifts back on its own.
// Revision 5 (Ghost wanders): setStyle() makes it a little further back, higher and calmer, and update() can be given
// the point Ghost is heading for: the view leans toward it so the target is on screen before Ghost gets there.
import * as THREE from 'three';
import { TUNING as T } from './tuning.js';
import { CONFIG } from './config.js';
import { clamp, damp, dampAngle } from './util.js';

export function createFollowCamera(camera, world) {
  const target = new THREE.Vector3(), look = new THREE.Vector3(), lead = new THREE.Vector3(), desired = new THREE.Vector3(), tmp = new THREE.Vector3(), dir = new THREE.Vector3();
  const s = { yaw: Math.PI, pitch: T.camPitch, dist: T.camDistance, baseDist: T.camDistance, wallDist: Infinity, nudgeYaw: 0, nudgePitch: 0, nudgeT: 9, zoom: 1, aim: 0, axisBlend: 0, axisLine: null, zonePitch: T.camPitch, inputYaw: Math.PI, aspect: 1.6, portrait: false };
  // Ghost's height as it actually appears from behind and a little above (measured on screen: ~0.88 of heightM)
  const catH = (CONFIG.cat.heightM || 0.5) * 0.88;
  let zones = [];
  const style = { zoom: 1, pitch: 0, autoYaw: 1, frame: 0, zoomPortrait: null, pitchPortrait: null, maxZoom: Infinity, budget: 1 };
  const frameOff = new THREE.Vector3(), frameWant = new THREE.Vector3();
  const setStyle = (o) => Object.assign(style, o);

  const setZones = (z) => { zones = z; };
  const resize = (aspect) => {
    s.aspect = aspect; s.portrait = aspect < 0.85;
    camera.fov = s.portrait ? T.camFovPortrait : T.camFov;
    camera.aspect = aspect; camera.updateProjectionMatrix();
    // the distance at which Ghost fills the wanted share of the screen height
    const share = s.portrait ? T.camScreenSharePortrait : T.camScreenShare;
    s.baseDist = catH / (2 * share * Math.tan((camera.fov * Math.PI) / 360));
  };
  const snap = (pos, yaw) => {
    s.yaw = yaw; s.inputYaw = yaw; s.dist = s.baseDist * s.zoom;
    target.set(pos.x, pos.y + T.camHeight, pos.z); look.copy(target);
    place(1);
  };

  // yaw convention: camera sits at target + (sin yaw, ., cos yaw) * dist; "forward" for the stick is -that.
  const forwardOf = (yaw) => dir.set(-Math.sin(yaw), 0, -Math.cos(yaw));

  function zoneAt(p) {
    let best = null;
    for (const z of zones) if (p.x >= z.min.x && p.x <= z.max.x && p.y >= z.min.y && p.y <= z.max.y && p.z >= z.min.z && p.z <= z.max.z) { if (!best || z.priority > best.priority) best = z; }
    return best;
  }

  function place(f) {
    const yaw = s.yaw + s.nudgeYaw, pitch = clamp(s.pitch + s.nudgePitch, 0.05, 1.25);
    const dist = Math.min(s.dist, s.wallDist);
    // the camera hangs behind Ghost itself; only where it looks leans ahead of Ghost
    desired.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(dist).add(target);
    // in a long narrow place, hang over its middle line so ledges and sills along the walls stay out of the way
    if (s.axisLine && s.axisBlend > 0.001) {
      if (s.axisLine.axis === 'z') desired.x += (s.axisLine.c - desired.x) * 0.85 * s.axisBlend;
      else desired.z += (s.axisLine.c - desired.z) * 0.85 * s.axisBlend;
    }
    camera.position.lerp(desired, f);
    camera.lookAt(look);
  }

  // body: { pos, vel, S }, input: { x, y, nudgeX, nudgeY }
  function update(dt, body, input, framePoint = null) {
    const p = body.pos, v = body.vel;
    // zones (open rooftops pull back, tight spots come closer)
    const z = zoneAt(p);
    // (the zones that already look steeply down, the roof's edge over the street, the alley, the awning, keep their own framing)
    const steep = z && z.pitch > 0.6;
    const sz = steep ? 1 : s.portrait && style.zoomPortrait !== null ? style.zoomPortrait : style.zoom, sp = steep ? 0 : s.portrait && style.pitchPortrait !== null ? style.pitchPortrait : style.pitch;
    s.zoom += (Math.min((z ? clamp(z.zoom, 0.7, T.camMaxZoom) : 1) * sz, style.maxZoom) * style.budget - s.zoom) * damp(1.5, dt);
    s.zonePitch += ((z ? z.pitch : T.camPitch) + sp - s.zonePitch) * damp(1.5, dt);
    s.aim += ((z && z.aim ? z.aim : 0) - s.aim) * damp(1.5, dt); // look higher where the way goes up
    // a long narrow place: look along it, from the end that is behind Ghost (or the one we are nearest)
    let zoneYaw = null;
    if (z && z.axis) {
      const cands = z.axis === 'z' ? [0, Math.PI] : [Math.PI / 2, -Math.PI / 2];
      const near = (ref) => cands.reduce((a, b) => (Math.abs(Math.atan2(Math.sin(b - ref), Math.cos(b - ref))) < Math.abs(Math.atan2(Math.sin(a - ref), Math.cos(a - ref))) ? b : a));
      if (s.axisYaw === undefined || s.axisZone !== z) { s.axisYaw = near(s.yaw); s.axisZone = z; s.axisT = 0; }
      // turning round inside: only swap ends once Ghost has kept going the other way for a moment
      const want = Math.hypot(v.x, v.z) > 0.6 ? near(Math.atan2(-v.x, -v.z)) : s.axisYaw;
      if (want !== s.axisYaw) { s.axisT += dt; if (s.axisT > 0.8) { s.axisYaw = want; s.axisT = 0; } } else s.axisT = 0;
      zoneYaw = s.axisYaw;
      s.axisLine = { axis: z.axis, c: z.axis === 'z' ? (z.min.x + z.max.x) / 2 : (z.min.z + z.max.z) / 2 };
    } else s.axisZone = null;
    s.axisBlend += ((z && z.axis ? 1 : 0) - s.axisBlend) * damp(3, dt);

    // follow: snappy sideways, soft up and down; look ahead along Ghost's travel
    const hs = Math.hypot(v.x, v.z);
    lead.lerp(tmp.set(v.x, 0, v.z).multiplyScalar(T.camLead), damp(2.5, dt));
    target.x += (p.x - target.x) * damp(T.camFollowH, dt);
    target.z += (p.z - target.z) * damp(T.camFollowH, dt);
    const ty = p.y + T.camHeight;
    // when Ghost is grounded follow height properly; in the air only follow big drops
    const vK = body.S.grounded ? T.camFollowV : (ty < target.y - 1.2 ? T.camFollowV * 1.5 : T.camFollowV * 0.35);
    target.y += (ty - target.y) * damp(vK, dt);
    // lean toward where Ghost is heading (the glinting thing), a share of the way and never far: Ghost stays in frame
    if (framePoint && style.frame > 0) {
      frameWant.set((framePoint.x - p.x) * style.frame, clamp((framePoint.y - p.y) * style.frame * 0.6, -0.5, 0.6), (framePoint.z - p.z) * style.frame);
      // only sideways or away from the camera: leaning toward a target behind the camera would drop Ghost off the bottom
      const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw), along = frameWant.x * fx + frameWant.z * fz;
      if (along < 0) { frameWant.x -= fx * along; frameWant.z -= fz * along; }
      const cap = s.portrait ? 0.8 : 1.4, hl = Math.hypot(frameWant.x, frameWant.z); if (hl > cap) { frameWant.x *= cap / hl; frameWant.z *= cap / hl; }
    } else frameWant.set(0, 0, 0);
    frameOff.lerp(frameWant, damp(1.2, dt));
    look.copy(target).add(lead).add(frameOff); look.y += s.aim;

    // auto yaw: swing behind Ghost's travel direction, scaled by speed, but never flip around
    if (zoneYaw !== null) s.yaw = dampAngle(s.yaw, zoneYaw, damp(2.5, dt)); // narrow places: along their length
    else if (hs > 0.6 && !(z && z.fixedYaw !== undefined)) {
      const moveYaw = Math.atan2(-v.x, -v.z); // the yaw that would put the camera straight behind
      let diff = Math.atan2(Math.sin(moveYaw - s.yaw), Math.cos(moveYaw - s.yaw));
      if (Math.abs(diff) < T.camAutoYawMaxAngle) {
        const rate = T.camAutoYaw * style.autoYaw * Math.min(1, hs / T.runSpeed) * Math.min(1, Math.abs(diff) * 1.5);
        s.yaw += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
      }
    }

    // the wanderer: nobody steers, so the view turns (calmly) to look past Ghost toward where Ghost is going, rather than
    // back along the way Ghost came
    if (zoneYaw === null && framePoint && style.frame > 0 && !(z && z.fixedYaw !== undefined)) {
      const dx = framePoint.x - p.x, dz = framePoint.z - p.z, dl = Math.hypot(dx, dz);
      // (only while Ghost is on the move, and never round into a wall: a yaw whose line from Ghost is blocked is not taken)
      if (dl > 1.5 && hs > 0.3) {
        const want = Math.atan2(-dx, -dz), diff = Math.atan2(Math.sin(want - s.yaw), Math.cos(want - s.yaw));
        if (Math.abs(diff) > 0.35) {
          const ny = s.yaw + Math.sign(diff) * Math.min(Math.abs(diff) - 0.35, T.strollCamTurn * dt), pc = clamp(s.pitch, 0.05, 1.25);
          tmp.set(Math.sin(ny) * Math.cos(pc), Math.sin(pc), Math.cos(ny) * Math.cos(pc));
          const h = world.raycast(target, tmp, s.dist);
          if (!h || h.distance > s.dist * 0.75) s.yaw = ny;
        }
      }
    }
    // rooms seen like a dollhouse: the camera stays on the open side, swinging a little to follow
    if (z && z.yawRange) {
      const [a, b] = z.yawRange, mid = (a + b) / 2;
      const off = Math.atan2(Math.sin(s.yaw - mid), Math.cos(s.yaw - mid));
      const want = mid + clamp(off, a - mid, b - mid);
      s.yaw = dampAngle(s.yaw, want, damp(3, dt));
    }
    // the stick's frame follows the camera only while the stick is idle, so holding a direction
    // keeps meaning the same thing while the view swings round
    const mag = Math.hypot(input.x, input.y);
    if (mag < 0.15) s.inputYaw = s.yaw; else s.inputYaw = dampAngle(s.inputYaw, s.yaw, damp(0.35, dt));

    // swipe nudge, then drift back
    if (input.nudgeX || input.nudgeY) { s.nudgeYaw -= input.nudgeX * T.camNudgeYaw; s.nudgePitch += input.nudgeY * T.camNudgePitch; s.nudgeT = 0; }
    s.nudgeT += dt;
    s.nudgeYaw = clamp(s.nudgeYaw, -1.6, 1.6); s.nudgePitch = clamp(s.nudgePitch, -0.25, 0.5);
    if (s.nudgeT > T.camRecentre) { const k = damp(1.4, dt); s.nudgeYaw -= s.nudgeYaw * k; s.nudgePitch -= s.nudgePitch * k; }

    // pitch and distance: look down more while falling fast, pull back in portrait
    const fallLook = clamp(-v.y / 10, 0, 1) * T.camFallPitch;
    s.pitch += (s.zonePitch + fallLook - s.pitch) * damp(2.5, dt);
    const want = s.baseDist * s.zoom;
    s.dist += (want - s.dist) * damp(2, dt);

    // walls between Ghost and the camera: come in front of them at once, ease back out
    const yaw = s.yaw + s.nudgeYaw, pitch = clamp(s.pitch + s.nudgePitch, 0.05, 1.25);
    tmp.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    const hit = world.raycast(target, tmp, s.dist + 0.3);
    const free = hit ? Math.max(T.camMinDistance, hit.distance - T.camWallMargin) : Infinity;
    if (free < s.wallDist) s.wallDist = free; else s.wallDist += (Math.min(free, 60) - Math.min(s.wallDist, 60)) * damp(1.8, dt);
    if (!hit && s.wallDist > s.dist + 2) s.wallDist = Infinity;

    place(1);
  }

  // stick (x right, y forward) -> world direction on the ground, relative to the camera
  const stickToWorld = (x, y, out) => {
    const f = forwardOf(s.inputYaw), r = tmp.set(-f.z, 0, f.x);
    return out.set(f.x * y + r.x * x, 0, f.z * y + r.z * x);
  };

  return { update, snap, resize, setZones, setStyle, stickToWorld, s, get yaw() { return s.yaw; }, get distance() { return Math.min(s.dist, s.wallDist); } };
}
