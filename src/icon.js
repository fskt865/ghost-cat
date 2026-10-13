// Puts CONFIG's name and theme colour on the page (tab title, home-screen title, theme colour).
// The home-screen icons are the real files: assets/icon-180.png (apple-touch-icon) and assets/icon-192/512.png
// (assets/manifest.webmanifest), copied from the Blender renders in assets/brand/ (README: "Rebuild the assets").
// drawIcon() is the old canvas-drawn icon, kept for the early test pages; nothing points the page at it now.
import { CONFIG, fmt } from './config.js';

function mixHex(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

export function drawIcon(size = 180) {
  const C = CONFIG.cat;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size / 180;
  const bg = g.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, '#0f0c26'); bg.addColorStop(1, CONFIG.themeColour);
  g.fillStyle = bg; g.fillRect(0, 0, size, size);
  // moon glow
  const halo = g.createRadialGradient(132 * s, 44 * s, 0, 132 * s, 44 * s, 60 * s);
  halo.addColorStop(0, 'rgba(255,240,200,0.9)'); halo.addColorStop(0.25, 'rgba(255,236,190,0.55)'); halo.addColorStop(0.3, 'rgba(255,230,190,0.15)'); halo.addColorStop(1, 'rgba(255,230,190,0)');
  g.fillStyle = halo; g.fillRect(0, 0, size, size);
  // ghost body: dome, then wavy hem
  const cx = 86 * s, top = 52 * s, w = 54 * s, bottom = 150 * s;
  // canon look: a black cat, near-black head fading to ghost-blue at the hem, with a soft blue glow
  const hem = mixHex(C.furColour, C.ghostTint, Math.min(1, (C.ghostTintAmount ?? 0.4) * 1.7));
  const body = g.createLinearGradient(0, top, 0, bottom);
  body.addColorStop(0, C.furColour); body.addColorStop(0.45, C.furColour); body.addColorStop(1, hem);
  g.save();
  g.shadowColor = C.ghostTint; g.shadowBlur = 22 * s;
  g.fillStyle = body;
  g.strokeStyle = C.ghostTint; g.lineWidth = 2.5 * s;
  g.beginPath();
  g.moveTo(cx - w, 104 * s);
  g.arc(cx, 104 * s, w, Math.PI, 0);
  g.lineTo(cx + w, bottom - 10 * s);
  const waves = 4;
  for (let i = 0; i < waves; i++) {
    const x0 = cx + w - (i * 2 * w) / waves, x1 = cx + w - ((i + 1) * 2 * w) / waves;
    g.quadraticCurveTo((x0 + x1) / 2, bottom + (i % 2 ? -4 : 10) * s, x1, bottom - 8 * s);
  }
  g.closePath(); g.fill(); g.globalAlpha = 0.55; g.stroke(); g.globalAlpha = 1;
  g.restore();
  // ears in Ghost's fur colour, inner ear, a thin glow edge
  for (const d of [-1, 1]) {
    g.fillStyle = C.furColour; g.strokeStyle = C.ghostTint; g.lineWidth = 2 * s; g.globalAlpha = 1;
    g.beginPath(); g.moveTo(cx + d * 16 * s, 60 * s); g.lineTo(cx + d * 44 * s, 30 * s); g.lineTo(cx + d * 46 * s, 72 * s); g.closePath(); g.fill();
    g.globalAlpha = 0.5; g.stroke(); g.globalAlpha = 1;
    g.fillStyle = C.innerEarColour;
    g.beginPath(); g.moveTo(cx + d * 24 * s, 60 * s); g.lineTo(cx + d * 40 * s, 40 * s); g.lineTo(cx + d * 41 * s, 64 * s); g.closePath(); g.fill();
  }
  // content closed eyes in Ghost's eye colour, nose, cheeks
  g.strokeStyle = C.eyeColour; g.lineWidth = 5 * s; g.lineCap = 'round';
  for (const d of [-1, 1]) { g.beginPath(); g.arc(cx + d * 20 * s, 92 * s, 9 * s, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); }
  g.fillStyle = C.noseColour; g.beginPath(); g.ellipse(cx, 108 * s, 4.5 * s, 3 * s, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.cheekColour; g.globalAlpha = 0.55;
  for (const d of [-1, 1]) { g.beginPath(); g.ellipse(cx + d * 34 * s, 110 * s, 7 * s, 4 * s, 0, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  return c;
}

export function applyConfigToPage() {
  const title = fmt(CONFIG.gameTitle);
  document.title = title;
  const meta = (name, content) => {
    let m = document.querySelector(`meta[name="${name}"]`);
    if (!m) { m = document.createElement('meta'); m.name = name; document.head.appendChild(m); }
    m.content = content;
  };
  meta('apple-mobile-web-app-title', title);
  meta('application-name', title);
  meta('theme-color', CONFIG.themeColour);
  document.documentElement.style.setProperty('--theme', CONFIG.themeColour);
}
