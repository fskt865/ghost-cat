// Two-thumb controls. Left half: a virtual stick that appears under the thumb. Right: one big hop
// button (and the rest of the right half as a fallback: a still press hops, a swipe nudges the camera).
// Mac: WASD / arrows + space. Gamepad: left stick + A. Read with poll() once per frame.
import { TUNING as T } from './tuning.js';

const CSS = `
#controls { position: fixed; inset: 0; z-index: 2; touch-action: none; -webkit-user-select: none; user-select: none; }
#stick-base, #stick-knob { position: fixed; left: 0; top: 0; border-radius: 50%; pointer-events: none; will-change: transform; }
#stick-base { background: radial-gradient(circle, rgba(255,240,220,0.10), rgba(255,240,220,0.18) 70%, rgba(255,240,220,0.04));
  box-shadow: inset 0 0 0 2px rgba(255,236,210,0.28); opacity: 0; transition: opacity 0.18s ease; }
#stick-knob { background: radial-gradient(circle at 40% 35%, rgba(255,250,240,0.95), rgba(230,220,255,0.75));
  box-shadow: 0 4px 14px rgba(20,10,40,0.35); opacity: 0; transition: opacity 0.18s ease; }
#controls.stick-on #stick-base, #controls.stick-on #stick-knob { opacity: 1; }
#controls.touch.idle-hint #stick-base { opacity: 0.45; }
#controls.touch.idle-hint #stick-knob { opacity: 0.35; }
#jump-btn { position: fixed; border-radius: 50%; border: 0; padding: 0;
  right: calc(26px + env(safe-area-inset-right)); bottom: calc(30px + env(safe-area-inset-bottom));
  background: radial-gradient(circle at 40% 35%, rgba(255,246,230,0.34), rgba(255,226,190,0.16));
  box-shadow: inset 0 0 0 2px rgba(255,236,210,0.42), 0 6px 22px rgba(20,10,40,0.3);
  display: none; align-items: center; justify-content: center; transition: transform 0.08s ease, background 0.15s ease; touch-action: none; }
#controls.touch #jump-btn { display: flex; }
#jump-btn.down { transform: scale(0.9); background: radial-gradient(circle at 40% 35%, rgba(255,240,210,0.6), rgba(255,210,160,0.35)); }
#jump-btn svg { width: 46%; height: 46%; opacity: 0.9; pointer-events: none; }
`;
const HOP_ICON = '<svg viewBox="0 0 40 40"><path d="M8 30 C 12 12, 28 12, 32 30" fill="none" stroke="#fff6ea" stroke-width="3.2" stroke-linecap="round"/><path d="M20 6 l -6 8 h 12 z" fill="#fff6ea"/></svg>';

export function createControls() {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'controls';
  root.innerHTML = `<div id="stick-base"></div><div id="stick-knob"></div><button id="jump-btn" aria-label="hop">${HOP_ICON}</button>`;
  document.body.appendChild(root);
  const base = root.querySelector('#stick-base'), knob = root.querySelector('#stick-knob'), jumpBtn = root.querySelector('#jump-btn');
  const R = T.stickRadius, BASE = R * 2 + 36, KNOB = 58;
  base.style.width = base.style.height = BASE + 'px'; knob.style.width = knob.style.height = KNOB + 'px';
  jumpBtn.style.width = jumpBtn.style.height = T.jumpButtonSize + 'px';

  const s = { x: 0, y: 0, jumpHeld: false, pressed: false, nudgeX: 0, nudgeY: 0, lastTouch: 0, usingTouch: false };
  let stick = null;            // { id, cx, cy, x, y }
  const jumps = new Set();     // pointer ids holding a hop
  const zone = new Map();      // right-half pointers: { x, y, t, mode, timer }
  const keys = new Set();

  const setTouch = (on) => { s.usingTouch = on; root.classList.toggle('touch', on); placeIdle(); };
  const placeIdle = () => {
    if (stick) return;
    const cx = Math.max(BASE / 2 + 18, innerWidth * 0.16), cy = innerHeight - Math.max(BASE / 2 + 30, innerHeight * 0.17);
    drawStick(cx, cy, cx, cy); root.classList.add('idle-hint');
  };
  const drawStick = (cx, cy, kx, ky) => {
    base.style.transform = `translate(${cx - BASE / 2}px, ${cy - BASE / 2}px)`;
    knob.style.transform = `translate(${kx - KNOB / 2}px, ${ky - KNOB / 2}px)`;
  };
  const updateStick = (px, py) => {
    let dx = px - stick.cx, dy = py - stick.cy;
    let d = Math.hypot(dx, dy);
    if (d > R && T.stickFollow) { // the base follows a thumb that slides past the edge
      const k = (d - R) / d; stick.cx += dx * k; stick.cy += dy * k; dx = px - stick.cx; dy = py - stick.cy; d = R;
    }
    const m = Math.min(1, d / R);
    const live = m <= T.stickDeadZone ? 0 : Math.pow((m - T.stickDeadZone) / (1 - T.stickDeadZone), T.stickCurve);
    stick.x = d > 0 ? (dx / d) * live : 0; stick.y = d > 0 ? (-dy / d) * live : 0;
    const kd = Math.min(d, R);
    drawStick(stick.cx, stick.cy, stick.cx + (d ? dx / d : 0) * kd, stick.cy + (d ? dy / d : 0) * kd);
  };
  const press = (id) => { if (!jumps.size) { s.pressed = true; } jumps.add(id); s.jumpHeld = true; jumpBtn.classList.add('down'); };
  const release = (id) => { jumps.delete(id); if (!jumps.size) { s.jumpHeld = keys.has('jump'); jumpBtn.classList.remove('down'); } };

  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'touch' || e.pointerType === 'pen') { if (!s.usingTouch) setTouch(true); s.lastTouch = performance.now(); }
    try { root.setPointerCapture(e.pointerId); } catch { /* synthetic or gone */ }
    if (e.target === jumpBtn || jumpBtn.contains(e.target)) { press(e.pointerId); return; }
    if (e.clientX < innerWidth * 0.5) {
      if (!stick) { stick = { id: e.pointerId, cx: e.clientX, cy: e.clientY, x: 0, y: 0 }; root.classList.add('stick-on'); root.classList.remove('idle-hint'); updateStick(e.clientX, e.clientY); }
      return;
    }
    // right half, away from the button: wait a moment to see if it is a hop or a swipe
    const z = { x: e.clientX, y: e.clientY, mode: 'pending' };
    z.timer = setTimeout(() => { if (z.mode === 'pending') { z.mode = 'jump'; press(e.pointerId); } }, T.tapZoneDelay * 1000);
    zone.set(e.pointerId, z);
  });
  root.addEventListener('pointermove', (e) => {
    if (stick && e.pointerId === stick.id) { updateStick(e.clientX, e.clientY); return; }
    const z = zone.get(e.pointerId);
    if (!z) return;
    const dx = e.clientX - z.x, dy = e.clientY - z.y;
    if (z.mode === 'pending' && Math.hypot(dx, dy) > 14) { z.mode = 'swipe'; clearTimeout(z.timer); }
    if (z.mode === 'swipe') { s.nudgeX += dx; s.nudgeY += dy; z.x = e.clientX; z.y = e.clientY; }
  });
  const end = (e) => {
    if (stick && e.pointerId === stick.id) { stick = null; root.classList.remove('stick-on'); if (s.usingTouch) placeIdle(); }
    if (jumps.has(e.pointerId)) release(e.pointerId);
    const z = zone.get(e.pointerId);
    if (z) {
      clearTimeout(z.timer);
      if (z.mode === 'pending') { s.pressed = true; } // a quick tap: a hop with no hold
      if (z.mode === 'jump') release(e.pointerId);
      zone.delete(e.pointerId);
    }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('lostpointercapture', end);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  // keyboard
  const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', Space: 'jump' };
  addEventListener('keydown', (e) => {
    const k = KEYMAP[e.code]; if (!k || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    if (k === 'jump' && !keys.has('jump')) { s.pressed = true; s.jumpHeld = true; }
    keys.add(k);
  });
  addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; if (!k) return; keys.delete(k); if (k === 'jump' && !jumps.size) s.jumpHeld = false; });
  addEventListener('blur', () => { keys.clear(); s.jumpHeld = jumps.size > 0; });
  addEventListener('resize', () => { if (!stick && s.usingTouch) placeIdle(); });

  let padJump = false;
  // once per frame: { x, y (forward), jumpHeld, jumpPressed, nudgeX, nudgeY, source }
  const poll = () => {
    let x = 0, y = 0, source = 'none';
    if (stick) { x = stick.x; y = stick.y; source = 'touch'; }
    const kx = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0), ky = (keys.has('up') ? 1 : 0) - (keys.has('down') ? 1 : 0);
    if (kx || ky) { const l = Math.hypot(kx, ky); x = kx / l; y = ky / l; source = 'keys'; }
    let held = s.jumpHeld;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0, ay = -(p.axes[1] || 0), m = Math.hypot(ax, ay);
      if (m > 0.18 && !(kx || ky) && !stick) { const k = Math.min(1, (m - 0.18) / 0.82) / m; x = ax * k; y = ay * k; source = 'pad'; }
      const b = !!(p.buttons[0] && p.buttons[0].pressed);
      if (b && !padJump) s.pressed = true;
      padJump = b; held = held || b;
    }
    const out = { x, y, jumpHeld: held, jumpPressed: s.pressed, nudgeX: s.nudgeX, nudgeY: s.nudgeY, source };
    s.pressed = false; s.nudgeX = 0; s.nudgeY = 0;
    return out;
  };
  if (matchMedia('(pointer: coarse)').matches) setTouch(true);
  return { poll, root, jumpBtn, setTouch, get usingTouch() { return s.usingTouch; } };
}
