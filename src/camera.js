// Orbit camera on a short leash. Follows Ghost with a gentle lead in Ghost's direction of travel,
// frames the room Ghost is in, and hands off smoothly to the next room's framing at a doorway.
// The player can swing and zoom a little; those offsets ease back when Ghost changes rooms.
import * as THREE from 'three';
import { clamp, damp } from './util.js';

export const LIMITS = { azMin: -0.75, azMax: 0.75, polMin: 0.62, polMax: 1.3, distMin: 3.2, distMax: 14 };

export function createCameraRig(camera) {
  const goal = { az: 0.2, pol: 1.02, dist: 8.5 };
  const cur = { ...goal };
  const off = { az: 0, pol: 0, zoom: 1 };       // player's own adjustments (room mode)
  const target = new THREE.Vector3(0.2, 0.6, 0.2);
  const focus = new THREE.Vector3();
  const lead = new THREE.Vector3();
  let fit = 1, portraitSet = false, aspect = 1, roomId = null;

  const orbit = (dAz, dPol) => {
    goal.az = clamp(goal.az + dAz, LIMITS.azMin, LIMITS.azMax);
    goal.pol = clamp(goal.pol + dPol, LIMITS.polMin, LIMITS.polMax);
    off.az = clamp(off.az + dAz, -1.0, 1.0); off.pol = clamp(off.pol + dPol, -0.45, 0.4);
  };
  const zoom = (factor) => { goal.dist = clamp(goal.dist * factor, LIMITS.distMin, LIMITS.distMax); off.zoom = clamp(off.zoom * factor, 0.5, 1.8); };

  const resize = (a) => {
    aspect = a;
    const hfov = 2 * Math.atan(Math.tan((42 * Math.PI) / 360) * Math.max(a, 1.0));
    let vfov = (2 * Math.atan(Math.tan(hfov / 2) / a) * 180) / Math.PI;
    vfov = clamp(vfov, 38, 62);
    camera.fov = vfov; camera.aspect = a; camera.updateProjectionMatrix();
    const hNow = 2 * Math.atan(Math.tan((vfov * Math.PI) / 360) * a);
    const hWant = 2 * Math.atan(Math.tan((42 * Math.PI) / 360) * 1.6);
    fit = clamp(Math.tan(hWant / 2) / Math.tan(hNow / 2), 1, 1.15);
    if (a < 0.8 && !portraitSet) { goal.pol = 0.92; cur.pol = 0.92; goal.dist = 7; portraitSet = true; }
  };

  const place = () => {
    const sp = Math.sin(cur.pol);
    camera.position.set(target.x + cur.dist * sp * Math.sin(cur.az), target.y + cur.dist * Math.cos(cur.pol), target.z + cur.dist * sp * Math.cos(cur.az));
    camera.lookAt(target);
  };

  // phase 0 (one open area)
  const update = (dt, catPos, area) => {
    focus.set(catPos.x * 0.65, 0.6, catPos.z * 0.6 - 0.5);
    focus.x = clamp(focus.x, area.minX * 0.65, area.maxX * 0.65);
    target.lerp(focus, damp(2.5, dt));
    const f = damp(10, dt);
    cur.az += (goal.az - cur.az) * f; cur.pol += (goal.pol - cur.pol) * f; cur.dist += (goal.dist * fit - cur.dist) * f;
    place();
  };

  // rooms: room = { id, x0, x1, z0, z1, outdoor, cam: { az, pol, dist } }
  const updateRoom = (dt, catPos, vel, room, { snap = false } = {}) => {
    if (room.id !== roomId) {
      roomId = room.id;
      off.az = 0; off.pol = 0; off.zoom = 1;   // a new room gets its own framing
    }
    const portrait = aspect < 0.8;
    const c = room.cam;
    const az = clamp(c.az + off.az, LIMITS.azMin, LIMITS.azMax);
    const pol = clamp((portrait ? c.pol - (room.outdoor ? 0.02 : 0.08) : c.pol) + off.pol, LIMITS.polMin, LIMITS.polMax);
    const dist = clamp(c.dist * (portrait ? 1.02 : 1) * off.zoom * fit, LIMITS.distMin, LIMITS.distMax);
    goal.az = az; goal.pol = pol; goal.dist = dist;
    // lead: look a little ahead of where Ghost is going
    lead.lerp(new THREE.Vector3(vel.x, 0, vel.z).multiplyScalar(0.55), damp(2.2, dt));
    if (lead.length() > 1.1) lead.setLength(1.1);
    const w = room.x1 - room.x0;
    const inset = Math.min(w * 0.32, portrait ? 1.0 : 1.6);
    focus.set(
      clamp(catPos.x + lead.x, room.x0 + inset, room.x1 - inset),
      0.55 + (catPos.y || 0) * 0.5 + (room.outdoor ? 0.35 : 0),
      clamp(catPos.z * 0.75 + lead.z - (portrait ? 0.95 : 0.35), room.z0 + (portrait ? 0.6 : 1.0), room.z1 - 1.3));
    if (snap) { target.copy(focus); Object.assign(cur, goal); }
    target.lerp(focus, damp(3.2, dt));
    const f = damp(4, dt);
    cur.az += (goal.az - cur.az) * f; cur.pol += (goal.pol - cur.pol) * f; cur.dist += (goal.dist - cur.dist) * f;
    place();
  };

  return { orbit, zoom, resize, update, updateRoom, get az() { return cur.az; }, goal, cur, target, off };
}
