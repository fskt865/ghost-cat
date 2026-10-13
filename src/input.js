// Touch, mouse and keyboard. One finger: tap to drift / poke, drag to orbit. Two fingers: pinch zoom.
// Pointer events only, so Safari, mouse and pen all take the same path.
const TAP_SLOP = 9;       // CSS px a finger may wander and still count as a tap
const TAP_TIME = 450;     // ms

export function createInput(el, { onTap, onOrbit, onZoom, onKeys, onAnyInput }) {
  const ptrs = new Map();
  let start = null, dragging = false, pinchD = 0, multi = false;

  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic or already-gone pointer */ }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    onAnyInput();
    if (ptrs.size === 1) {
      start = { x: e.clientX, y: e.clientY, t: performance.now() };
      dragging = false; multi = false;
    } else if (ptrs.size === 2) {
      multi = true; dragging = false;
      const [a, b] = [...ptrs.values()];
      pinchD = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  el.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1 && !multi && start) {
      if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP) dragging = true;
      if (dragging) onOrbit(-dx * 0.005, -dy * 0.0038);
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchD > 0 && d > 0) onZoom(pinchD / d);
      pinchD = d;
    }
  });

  const end = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (e.type === 'pointerup' && ptrs.size === 0 && start && !dragging && !multi && performance.now() - start.t < TAP_TIME) {
      onTap(e.clientX, e.clientY);
    }
    if (ptrs.size === 0) { start = null; dragging = false; multi = false; }
    if (ptrs.size === 1) pinchD = 0;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);

  el.addEventListener('wheel', (e) => { e.preventDefault(); onZoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });

  // keyboard: arrows / WASD to float, Q/E to swing the camera, space/enter to poke the nearest thing
  const keys = new Set();
  const map = { ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd', ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', KeyQ: 'q', KeyE: 'e' };
  const push = () => {
    onKeys({
      x: (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0),
      z: (keys.has('d') ? 1 : 0) - (keys.has('u') ? 1 : 0),
      turn: (keys.has('e') ? 1 : 0) - (keys.has('q') ? 1 : 0),
    });
  };
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); onKeys({ poke: true }); onAnyInput(); return; }
    const k = map[e.code];
    if (!k) return;
    e.preventDefault();
    keys.add(k); push(); onAnyInput();
  });
  addEventListener('keyup', (e) => { const k = map[e.code]; if (k) { keys.delete(k); push(); } });
  addEventListener('blur', () => { keys.clear(); push(); });

  // Safari: no pinch-zoom of the page, no double-tap zoom, no long-press menu, no rubber-band
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 || e.target === el) e.preventDefault(); }, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
