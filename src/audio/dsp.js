// dsp.js: tiny sample-level DSP helpers used to render the game's sounds into Float32Arrays once.
// Nothing here touches Web Audio; it is plain math so the same buffers come out in every browser.

export const TAU = Math.PI * 2;
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;

// Seeded PRNG (mulberry32): deterministic renders, so tests and previews are repeatable.
export function rng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.bi = () => r() * 2 - 1;
  return r;
}

// RBJ biquad, transposed direct form II. set() may be called every block for sweeps.
export class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, f, q, sr, gainDb = 0) {
    const w = (TAU * clamp(f, 10, sr * 0.45)) / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * c; a2 = 1 - al; }
    else { const A = Math.pow(10, gainDb / 40); b0 = 1 + al * A; b1 = -2 * c; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * c; a2 = 1 - al / A; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

// One-pole lowpass: y += a (x - y), with a from a cutoff in Hz.
export const onePoleA = (f, sr) => 1 - Math.exp((-TAU * f) / sr);

// Filter a whole array in place (static settings).
export function filt(arr, type, f, q, sr) {
  const b = new Biquad().set(type, f, q, sr);
  for (let i = 0; i < arr.length; i++) arr[i] = b.run(arr[i]);
  return arr;
}

export function noise(n, r) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = r() * 2 - 1;
  return a;
}

// Brown-ish noise (integrated white with leak), roughly unit peak.
export function brown(n, r) {
  const a = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) { y = y * 0.996 + (r() * 2 - 1) * 0.06; a[i] = y; }
  return a;
}

// Polyblep sawtooth sample for phase p in [0,1) and increment dp.
export function blepSaw(p, dp) {
  let v = 2 * p - 1;
  if (p < dp) { const t = p / dp; v -= t + t - t * t - 1; }
  else if (p > 1 - dp) { const t = (p - 1) / dp; v -= t * t + t + t + 1; }
  return v;
}

export function removeDC(a) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m += a[i];
  m /= a.length || 1;
  for (let i = 0; i < a.length; i++) a[i] -= m;
  return a;
}

// Gentle highpass (one-pole DC blocker) for buffers that should not carry offset at any point.
export function dcBlock(a, sr, f = 20) {
  const R = Math.exp((-TAU * f) / sr);
  let x1 = 0, y1 = 0;
  for (let i = 0; i < a.length; i++) { const y = a[i] - x1 + R * y1; x1 = a[i]; y1 = y; a[i] = y; }
  return a;
}

export function peakOf(chs) {
  let p = 0;
  for (const a of chs) for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > p) p = v; }
  return p;
}
export function rmsOf(chs) {
  let s = 0, n = 0;
  for (const a of chs) { for (let i = 0; i < a.length; i++) s += a[i] * a[i]; n += a.length; }
  return Math.sqrt(s / (n || 1));
}
export function scale(chs, k) { for (const a of chs) for (let i = 0; i < a.length; i++) a[i] *= k; return chs; }
export function normalizePeak(chs, target) { const p = peakOf(chs); if (p > 0) scale(chs, target / p); return chs; }

// Short fades at both ends so nothing clicks.
export function fadeEnds(a, sr, inMs = 2, outMs = 8) {
  const ni = Math.min(a.length, Math.floor((inMs / 1000) * sr)), no = Math.min(a.length, Math.floor((outMs / 1000) * sr));
  for (let i = 0; i < ni; i++) a[i] *= i / ni;
  for (let i = 0; i < no; i++) a[a.length - 1 - i] *= i / no;
  return a;
}

// Make a seamless loop: the last xf samples are crossfaded (equal power) into the start.
export function loopify(a, xf) {
  const n = a.length - xf, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i];
  for (let i = 0; i < xf; i++) {
    const t = i / xf, gi = Math.sin((t * Math.PI) / 2), go = Math.cos((t * Math.PI) / 2);
    out[i] = a[i] * gi + a[n + i] * go;
  }
  return out;
}

// Constant-power pan of a mono array into [L, R].
export function panMono(a, p) {
  const ang = ((clamp(p, -1, 1) + 1) * Math.PI) / 4, gl = Math.cos(ang), gr = Math.sin(ang);
  const L = new Float32Array(a.length), R = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) { L[i] = a[i] * gl; R[i] = a[i] * gr; }
  return [L, R];
}

// Add src into dst at sample offset with gain (mono or matching channels).
export function mixInto(dst, src, at, g = 1) {
  const n = Math.min(src.length, dst.length - at);
  for (let i = Math.max(0, -at); i < n; i++) dst[at + i] += src[i] * g;
}

// Small baked room (Schroeder: 4 combs + 2 allpasses per channel). Returns [L, R] with dry + wet.
// Used for sounds that should feel like they sit in the night air, at zero runtime cost.
export function room(chs, sr, wet = 0.25, decay = 0.8, tailSec = 0.6) {
  const inL = chs[0], inR = chs[1] || chs[0];
  const n = inL.length + Math.floor(tailSec * sr);
  const outs = [];
  const sets = [[1116, 1188, 1277, 1356, 556, 441], [1139, 1211, 1300, 1379, 579, 464]];
  const k = sr / 44100;
  for (let c = 0; c < 2; c++) {
    const x = c === 0 ? inL : inR, out = new Float32Array(n);
    const lens = sets[c].map((v) => Math.max(8, Math.floor(v * k * 1.3)));
    const combs = lens.slice(0, 4).map((L) => ({ b: new Float32Array(L), i: 0, s: 0 }));
    const aps = lens.slice(4).map((L) => ({ b: new Float32Array(L), i: 0 }));
    const fb = Math.min(0.92, 0.7 + decay * 0.25), damp = 0.35;
    for (let i = 0; i < n; i++) {
      const xi = i < x.length ? x[i] : 0;
      let acc = 0;
      for (const cb of combs) {
        const y = cb.b[cb.i];
        cb.s = y * (1 - damp) + cb.s * damp;
        cb.b[cb.i] = xi + cb.s * fb;
        cb.i = (cb.i + 1) % cb.b.length;
        acc += y;
      }
      acc *= 0.25;
      for (const ap of aps) {
        const bo = ap.b[ap.i], y = -acc + bo;
        ap.b[ap.i] = acc + bo * 0.5;
        ap.i = (ap.i + 1) % ap.b.length;
        acc = y;
      }
      out[i] = xi + acc * wet;
    }
    outs.push(out);
  }
  return outs;
}

// Smooth attack/decay envelope value at time t (s): raised-cosine attack, exponential decay.
export function adEnv(t, a, d) {
  if (t < 0) return 0;
  if (t < a) return 0.5 - 0.5 * Math.cos((Math.PI * t) / a);
  return Math.exp(-(t - a) / d);
}

// Piecewise-linear track [[t, v], ...] sampled at t.
export function track(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (t <= pts[i][0]) { const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0); }
  }
  return pts[pts.length - 1][1];
}
