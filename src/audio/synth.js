// synth.js: renders every buffer the audio engine uses, once, from math (no audio files).
// Each render returns { sr, ch: [Float32Array, ...] }. Sample rates are chosen per sound to keep
// memory small (a felt piano is dark, so 22.05 kHz is plenty; sparkles get 44.1 kHz).
import {
  TAU, mtof, clamp, rng, Biquad, onePoleA, filt, noise, brown, blepSaw, removeDC, dcBlock,
  normalizePeak, fadeEnds, loopify, panMono, mixInto, room, adEnv, track, scale, rmsOf,
} from './dsp.js';

const out = (sr, ...ch) => ({ sr, ch });
const len = (sec, sr) => Math.max(1, Math.floor(sec * sr));

// ---------------------------------------------------------------- instrument banks
// Notes are rendered every 4 semitones and pitched at playback (at most +-2 semitones).

export const PIANO_ROOTS = [36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80, 84, 88];
export const EP_ROOTS = [36, 40, 44, 48, 52, 56, 60, 64, 68, 72, 76, 80];
export const BOX_ROOTS = [76, 80, 84, 88, 92, 96];

// Felt piano: inharmonic partials (stiff strings), two detuned strings per partial (beating),
// two-stage decay, hammer at 1/7.3 of the string (that partial notch), soft felt attack and thump.
export function pianoNote(m, sr = 22050) {
  const r = rng(1000 + m), f0 = mtof(m);
  const dur = clamp(3.9 - (m - 36) * 0.045, 1.8, 3.9), n = len(dur, sr);
  const acc = new Float64Array(n);
  const B = 0.00018 * Math.pow(2, (m - 48) / 18);
  const tau = clamp(3.4 - (m - 40) * 0.05, 0.9, 3.4);
  for (let k = 1; k <= 12; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > sr * 0.42) break;
    const amp = (Math.abs(Math.sin((Math.PI * k) / 7.3)) * Math.pow(k, -1.15) * Math.exp(-(k - 1) * 0.2)) * (m < 50 ? 1 : 1 - (m - 50) * 0.004 * (k - 1));
    if (amp <= 0.001) continue;
    const t1 = (tau * 0.22) / (1 + 0.5 * (k - 1)), t2 = tau / (1 + 0.3 * (k - 1));
    for (const s of [-1, 1]) {
      const f = fk * Math.pow(2, (s * 0.55 + (r() - 0.5) * 0.3) / 1200), w = (TAU * f) / sr, c2 = 2 * Math.cos(w);
      let y1 = Math.sin(-w), y2 = Math.sin(-2 * w), e1 = amp * 0.3, e2 = amp * 0.2;
      const d1 = Math.exp(-1 / (t1 * sr)), d2 = Math.exp(-1 / (t2 * sr));
      const nk = Math.min(n, Math.ceil(t2 * sr * Math.log(amp * 2e4 + 1)));
      for (let i = 0; i < nk; i++) { const y = c2 * y1 - y2; y2 = y1; y1 = y; acc[i] += y * (e1 + e2); e1 *= d1; e2 *= d2; }
    }
  }
  const a = new Float32Array(n);
  const att = len(0.007, sr), aLP = onePoleA(Math.min(2.5 * f0 + 250, 3000), sr);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = acc[i] * (i < att ? 0.5 - 0.5 * Math.cos((Math.PI * i) / att) : 1);
    if (t < 0.08) { lp += aLP * ((r() * 2 - 1) - lp); v += lp * 0.09 * Math.exp(-t / 0.012); } // felt thump
    a[i] = v;
  }
  dcBlock(a, sr, 25);
  fadeEnds(a, sr, 0, 300);
  normalizePeak([a], 0.5);
  return out(sr, a);
}

// Rhodes-like electric piano: 1:1 FM with a decaying index (the bark), a tine bell partial,
// and a touch of even-harmonic asymmetry. Tremolo/auto-pan happens live on the bus.
export function epNote(m, sr = 22050) {
  const f = mtof(m), dur = clamp(3.0 - (m - 48) * 0.04, 1.5, 3.0), n = len(dur, sr);
  const tau = clamp(2.3 - (m - 48) * 0.03, 0.8, 2.3), a = new Float32Array(n);
  const w = (TAU * f) / sr, wt = (TAU * f * 7.1) / sr, tine = f * 7.1 < sr * 0.42;
  for (let i = 0; i < n; i++) {
    const t = i / sr, I = 1.25 * Math.exp(-t / 0.16) + 0.3;
    const ph = w * i;
    let y = Math.sin(ph + I * Math.sin(ph)) * (0.7 * Math.exp(-t / tau) + 0.3 * Math.exp(-t / (tau * 0.25)));
    if (tine) y += Math.sin(wt * i) * 0.12 * Math.exp(-t / 0.035);
    y += 0.14 * y * y;
    a[i] = y * (t < 0.003 ? t / 0.003 : 1);
  }
  dcBlock(a, sr, 25);
  fadeEnds(a, sr, 0, 250);
  normalizePeak([a], 0.5);
  return out(sr, a);
}

// Music box tine: a clamped bar's modes (1, 6.27, 17.55) plus a faint octave from the resonator.
export function boxNote(m, sr = 24000) {
  const f = mtof(m), n = len(1.7, sr), a = new Float32Array(n), r = rng(3000 + m);
  const k = Math.pow(2, -(m - 84) / 24);
  const parts = [[1, 1, 1.5 * k], [1.003, 0.35, 1.2 * k], [2, 0.1, 0.6 * k], [6.27, 0.22, 0.18 * k], [17.55, 0.05, 0.05 * k]];
  for (const [ratio, amp, tau] of parts) {
    if (f * ratio > sr * 0.45) continue;
    const w = (TAU * f * ratio) / sr;
    for (let i = 0; i < n; i++) a[i] += Math.sin(w * i) * amp * Math.exp(-i / sr / tau);
  }
  const hp = new Biquad().set('hp', 3000, 0.7, sr), nc = len(0.002, sr);
  for (let i = 0; i < nc; i++) a[i] += hp.run(r() * 2 - 1) * 0.25 * (1 - i / nc);
  fadeEnds(a, sr, 0.5, 200);
  normalizePeak([a], 0.5);
  return out(sr, a);
}

// ---------------------------------------------------------------- drums (lo-fi, dusty, soft)

export function kick(v, sr = 32000) {
  const r = rng(40 + v), n = len(0.5, sr), a = new Float32Array(n), lp = new Biquad().set('lp', 1200, 0.7, sr);
  let ph = 0;
  const f1 = 52 + v * 2, f2 = 75 + v * 6;
  for (let i = 0; i < n; i++) {
    const t = i / sr; ph += (TAU * (f1 + f2 * Math.exp(-t / 0.03))) / sr;
    let y = (Math.sin(ph) + 0.18 * Math.sin(2 * ph)) * adEnv(t, 0.002, 0.13);
    y += lp.run(r() * 2 - 1) * 0.18 * Math.exp(-t / 0.005);
    a[i] = Math.tanh(1.7 * y) / Math.tanh(1.7);
  }
  fadeEnds(a, sr, 0, 30); normalizePeak([a], 0.7);
  return out(sr, a);
}

export function rim(v, sr = 32000) {
  const r = rng(50 + v), n = len(0.16, sr), a = new Float32Array(n), bp = new Biquad().set('bp', 1800 + v * 120, 4, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    a[i] = bp.run(r() * 2 - 1) * 1.6 * Math.exp(-t / 0.012) + Math.sin(TAU * 540 * t) * 0.5 * Math.exp(-t / 0.025) + Math.sin(TAU * 1430 * t) * 0.22 * Math.exp(-t / 0.012);
  }
  filt(a, 'lp', 6000, 0.7, sr); fadeEnds(a, sr, 0.3, 20); normalizePeak([a], 0.6);
  return out(sr, a);
}

export function snare(v, sr = 32000) {
  const r = rng(60 + v), n = len(0.32, sr), a = new Float32Array(n), bp = new Biquad().set('bp', 2100 + v * 150, 0.6, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr; ph += (TAU * (172 + 30 * Math.exp(-t / 0.02))) / sr;
    const y = bp.run(r() * 2 - 1) * adEnv(t, 0.002, 0.075) + Math.sin(ph) * 0.55 * Math.exp(-t / 0.05);
    a[i] = Math.tanh(1.3 * y);
  }
  filt(a, 'lp', 5200, 0.7, sr); fadeEnds(a, sr, 0.3, 30); normalizePeak([a], 0.6);
  return out(sr, a);
}

export function hat(v, sr = 32000, open = false) {
  const r = rng(70 + v + (open ? 9 : 0)), n = len(open ? 0.4 : 0.12, sr), a = new Float32Array(n);
  const hp = new Biquad().set('hp', 6500, 0.7, sr), bp = new Biquad().set('bp', 9000, 2, sr);
  const d = open ? 0.11 : 0.02 + v * 0.004;
  for (let i = 0; i < n; i++) { const t = i / sr, x = r() * 2 - 1; a[i] = (hp.run(x) * 0.6 + bp.run(x) * 0.8) * adEnv(t, 0.0015, d); }
  filt(a, 'lp', 10000, 0.7, sr); fadeEnds(a, sr, 0.2, 10); normalizePeak([a], 0.5);
  return out(sr, a);
}

export function shaker(v, sr = 32000) {
  const r = rng(80 + v), n = len(0.12, sr), a = new Float32Array(n), bp = new Biquad().set('bp', 5200 + v * 300, 1.1, sr);
  for (let i = 0; i < n; i++) { const t = i / sr; a[i] = bp.run(r() * 2 - 1) * adEnv(t, 0.012, 0.035); }
  fadeEnds(a, sr, 0, 10); normalizePeak([a], 0.5);
  return out(sr, a);
}

// ---------------------------------------------------------------- texture

// Vinyl crackle: sparse clicks of random size, a few bigger pops, a thin hiss. Stereo, loops.
export function crackle(sr = 22050) {
  const r = rng(7), n = len(5.5, sr), xf = len(0.5, sr), ch = [];
  for (let c = 0; c < 2; c++) {
    const a = new Float32Array(n), hp = new Biquad().set('hp', 1200, 0.7, sr), lp = new Biquad().set('lp', 7000, 0.7, sr);
    for (let i = 0; i < n; i++) a[i] = lp.run(hp.run(r() * 2 - 1)) * 0.02;
    const rr = rng(100 + c);
    for (let k = 0; k < 5.5 * 26; k++) {
      const at = Math.floor(rr() * (n - 40)), big = rr() < 0.05, amp = (big ? 0.7 : 0.25) * Math.pow(rr(), 2.5) + 0.02;
      const clen = big ? 24 : 6, bp = new Biquad().set('bp', big ? 1500 : 3000 + rr() * 3000, 0.8, sr);
      for (let i = 0; i < clen; i++) a[at + i] += bp.run((rr() * 2 - 1) * amp * (1 - i / clen)) * 3;
    }
    // the other channel shares most clicks (vinyl crackle is nearly mono)
    if (c === 1) for (let i = 0; i < n; i++) a[i] = a[i] * 0.45 + ch[0][i] * 0.55;
    ch.push(a);
  }
  const L = loopify(ch[0], xf), R = loopify(ch[1], xf);
  removeDC(L); removeDC(R); normalizePeak([L, R], 0.5);
  return out(sr, L, R);
}

// Reverb impulse: stereo decorrelated noise, exponential decay that darkens over time, small predelay.
export function reverbIR(sr, sec = 2.2) {
  const r = rng(11), n = len(sec, sr), pre = len(0.012, sr), ch = [];
  for (let c = 0; c < 2; c++) {
    const a = new Float32Array(n);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr, k = onePoleA(clamp(9000 * Math.exp(-t * 1.6), 900, 9000), sr);
      lp += k * ((r() * 2 - 1) - lp);
      a[i] = lp * Math.exp(-t * (6.9 / sec)) * (t < 0.01 ? t / 0.01 : 1);
    }
    ch.push(a);
  }
  // early reflections
  for (const [ms, g, c] of [[9, 0.5, 0], [13, 0.45, 1], [19, 0.35, 0], [23, 0.3, 1], [31, 0.25, 0], [37, 0.2, 1]]) ch[c][pre + len(ms / 1000, sr)] += g;
  const e = Math.sqrt(ch[0].reduce((s, v) => s + v * v, 0));
  scale(ch, 0.6 / e);
  return out(sr, ...ch);
}

// ---------------------------------------------------------------- foley helpers

function thump(n, sr, r, cut = 350, dec = 0.018, sine = 95) {
  const a = new Float32Array(n), lp = new Biquad().set('lp', cut, 0.7, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    a[i] = lp.run(r() * 2 - 1) * 2.2 * adEnv(t, 0.002, dec) + Math.sin(TAU * sine * t) * 0.45 * adEnv(t, 0.002, dec * 1.2);
  }
  return a;
}

function modes(a, sr, list, at = 0) {
  for (const [f, amp, tau] of list) {
    if (f > sr * 0.45) continue;
    const w = (TAU * f) / sr;
    for (let i = at; i < a.length; i++) { const t = (i - at) / sr; a[i] += Math.sin(w * (i - at)) * amp * Math.exp(-t / tau) * (t < 0.001 ? t / 0.001 : 1); }
  }
  return a;
}

function sweepNoise(n, sr, r, f0, f1, q, env) {
  const a = new Float32Array(n), bp = new Biquad();
  for (let i = 0; i < n; i++) {
    if ((i & 31) === 0) { const k = i / n; bp.set('bp', f0 * Math.pow(f1 / f0, k), q, sr); }
    a[i] = bp.run(r() * 2 - 1) * env(i / sr);
  }
  return a;
}

function chirpSine(a, sr, at, f0, f1, dur, amp, attack, decay) {
  let ph = 0;
  const n = Math.min(a.length - at, len(dur, sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr, k = t / dur;
    ph += (TAU * f0 * Math.pow(f1 / f0, k)) / sr;
    a[at + i] += Math.sin(ph) * amp * adEnv(t, attack, decay);
  }
  return a;
}

// a bell / tine ping with inharmonic partials
function bell(a, sr, at, f, amp, decay, partials = [[1, 1, 1], [2.76, 0.4, 0.4], [5.4, 0.2, 0.2], [8.93, 0.08, 0.1]]) {
  for (const [ratio, g, td] of partials) {
    const fr = f * ratio;
    if (fr > sr * 0.45) continue;
    const w = (TAU * fr) / sr, tau = decay * td, n = Math.min(a.length - at, len(tau * 7, sr));
    for (let i = 0; i < n; i++) { const t = i / sr; a[at + i] += Math.sin(w * i) * amp * g * Math.exp(-t / tau) * (t < 0.002 ? t / 0.002 : 1); }
  }
  return a;
}

const finishMono = (a, sr, peak = 0.7) => { dcBlock(a, sr, 20); fadeEnds(a, sr, 1, 15); normalizePeak([a], peak); return out(sr, a); };
const finishStereo = (L, R, sr, peak = 0.7) => { dcBlock(L, sr, 20); dcBlock(R, sr, 20); fadeEnds(L, sr, 1, 20); fadeEnds(R, sr, 1, 20); normalizePeak([L, R], peak); return out(sr, L, R); };

// ---------------------------------------------------------------- foley

export const SURFACES = ['soft', 'roof', 'wood', 'grass', 'metal', 'puddle'];

function step(surface, v) {
  const sr = 24000, r = rng(200 + v * 17 + SURFACES.indexOf(surface) * 101);
  if (surface === 'soft') { const a = thump(len(0.09, sr), sr, r, 260, 0.016, 80 + v * 6); return finishMono(a, sr); }
  if (surface === 'roof') {
    const a = thump(len(0.11, sr), sr, r, 380, 0.015, 90 + v * 5);
    const bp = new Biquad().set('bp', 3200, 1.4, sr);
    for (let k = 0; k < 4 + v; k++) {
      const at = Math.floor(r() * 0.045 * sr), amp = 0.35 + r() * 0.4, nn = len(0.0025, sr);
      for (let i = 0; i < nn; i++) a[at + i] += bp.run((r() * 2 - 1) * amp) * (1 - i / nn) * 2.5;
    }
    return finishMono(a, sr);
  }
  if (surface === 'wood') {
    const a = thump(len(0.13, sr), sr, r, 420, 0.012, 110);
    const d = 1 + (r() - 0.5) * 0.08;
    modes(a, sr, [[185 * d, 0.45, 0.04], [405 * d, 0.3, 0.028], [770 * d, 0.14, 0.018], [1310 * d, 0.06, 0.01]]);
    return finishMono(a, sr);
  }
  if (surface === 'grass') {
    const a = new Float32Array(len(0.13, sr)), bp = new Biquad().set('bp', 3600 + v * 300, 0.7, sr);
    const bursts = [0, 0.012 + r() * 0.015, 0.03 + r() * 0.03];
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      let e = 0; for (const b of bursts) e += adEnv(t - b, 0.004, 0.014);
      a[i] = bp.run(r() * 2 - 1) * e * 0.8;
    }
    mixInto(a, thump(a.length, sr, r, 240, 0.014, 75), 0, 0.35);
    filt(a, 'lp', 7000, 0.7, sr);
    return finishMono(a, sr);
  }
  if (surface === 'metal') {
    const a = thump(len(0.4, sr), sr, r, 300, 0.012, 100), d = 1 + (r() - 0.5) * 0.06;
    for (let i = 0; i < a.length; i++) a[i] *= 0.7;
    modes(a, sr, [[523 * d, 0.16, 0.22], [1187 * d, 0.12, 0.15], [1913 * d, 0.09, 0.11], [2790 * d, 0.06, 0.07], [4120 * d, 0.035, 0.045]]);
    return finishMono(a, sr);
  }
  // puddle: a small splash and a couple of bubble plips
  const a = sweepNoise(len(0.17, sr), sr, r, 1100, 3200, 1.0, (t) => adEnv(t, 0.003, 0.028) * 0.9);
  chirpSine(a, sr, len(0.01 + r() * 0.01, sr), 700 + r() * 500, 1100 + r() * 700, 0.04, 0.35, 0.002, 0.018);
  chirpSine(a, sr, len(0.04 + r() * 0.03, sr), 900 + r() * 500, 1400 + r() * 600, 0.035, 0.22, 0.002, 0.014);
  mixInto(a, thump(a.length, sr, r, 300, 0.012, 90), 0, 0.4);
  return finishMono(a, sr);
}

function hop(v) {
  const sr = 24000, r = rng(300 + v), n = len(0.2, sr);
  const a = sweepNoise(n, sr, r, 520 + v * 40, 2100 + v * 150, 2.2, (t) => adEnv(t, 0.012, 0.05));
  chirpSine(a, sr, 0, 300 + v * 12, 500 + v * 20, 0.09, 0.22, 0.004, 0.035);
  return finishMono(a, sr);
}

function doubleHop(v) {
  const sr = 32000, r = rng(320 + v), n = len(0.32, sr);
  const a = sweepNoise(n, sr, r, 800, 3200, 2.4, (t) => adEnv(t, 0.01, 0.045));
  bell(a, sr, len(0.015, sr), 1568 * (1 + v * 0.01), 0.18, 0.12);
  bell(a, sr, len(0.065, sr), 2093 * (1 + v * 0.01), 0.15, 0.12);
  return finishMono(a, sr);
}

function land(v) {
  const sr = 24000, r = rng(340 + v), n = len(0.2, sr), a = new Float32Array(n), lp = new Biquad().set('lp', 650, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr; ph += (TAU * (48 + 70 * Math.exp(-t / 0.025))) / sr;
    a[i] = Math.sin(ph) * adEnv(t, 0.002, 0.06) + lp.run(r() * 2 - 1) * 1.6 * adEnv(t, 0.002, 0.028);
  }
  return finishMono(a, sr);
}

function bump(v) {
  const sr = 24000, r = rng(360 + v), n = len(0.26, sr), a = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, f = 250 * (1 - 0.35 * Math.min(1, t / 0.08)) * (1 + 0.06 * Math.sin(TAU * 18 * t) * Math.exp(-t / 0.06));
    ph += (TAU * f) / sr;
    a[i] = (Math.sin(ph) + 0.3 * Math.sin(2 * ph)) * adEnv(t, 0.004, 0.06);
  }
  mixInto(a, sweepNoise(n, sr, r, 1200, 600, 1.5, (t) => adEnv(t, 0.003, 0.03)), 0, 0.5);
  mixInto(a, thump(n, sr, r, 300, 0.02, 80), 0, 0.5);
  return finishMono(a, sr);
}

function poke(v) {
  const sr = 24000, n = len(0.55, sr), a = new Float32Array(n), f0 = 360 + v * 30;
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, f = f0 * (1 + 0.12 * Math.exp(-t / 0.02)) * (1 + 0.07 * Math.sin(TAU * 11 * t) * Math.exp(-t / 0.18));
    ph += (TAU * f) / sr;
    a[i] = (Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph)) * adEnv(t, 0.005, 0.15);
  }
  return finishMono(a, sr);
}

function sparkle(v) {
  const sr = 32000, r = rng(400 + v), n = len(0.9, sr), L = new Float32Array(n), R = new Float32Array(n);
  const notes = [2093, 2349, 2637, 3136, 3520, 4186, 4699];
  for (let k = 0; k < 7; k++) {
    const m = new Float32Array(n);
    bell(m, sr, len(r() * 0.45, sr), r.pick(notes), 0.25 + r() * 0.2, 0.08 + r() * 0.12, [[1, 1, 1], [2.76, 0.25, 0.4]]);
    const [l, rr] = panMono(m, r.bi() * 0.8);
    mixInto(L, l, 0); mixInto(R, rr, 0);
  }
  const [rl, rrr] = room([L, R], sr, 0.3, 0.7, 0.3);
  return finishStereo(rl, rrr, sr);
}

function purr(v) {
  // filtered noise pulsed at ~26 Hz with breath cycles (exhale louder, inhale softer and a bit faster)
  const sr = 16000, r = rng(420 + v), dur = 3.4, n = len(dur, sr), a = new Float32Array(n);
  const lp = new Biquad().set('lp', 420, 0.9, sr), lp2 = new Biquad().set('lp', 900, 0.7, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, cyc = (t % 1.9) / 1.9, exhale = cyc < 0.58;
    const rate = exhale ? 25.5 : 28.5, breath = exhale ? Math.sin((Math.PI * cyc) / 0.58) : 0.55 * Math.sin((Math.PI * (cyc - 0.58)) / 0.42);
    ph += rate / sr;
    const p = ph % 1, pulse = p < 0.35 ? Math.pow(Math.sin((Math.PI * p) / 0.35), 2) : 0;
    const x = lp.run(r() * 2 - 1) * 3 + Math.sin(TAU * rate * 2 * t) * 0.2;
    a[i] = lp2.run(x * pulse * (0.2 + 0.8 * breath)) * (0.85 + 0.15 * Math.sin(TAU * 0.7 * t));
  }
  fadeEnds(a, sr, 80, 250);
  return finishMono(a, sr);
}

function journal(open) {
  const sr = 32000, r = rng(open ? 440 : 450), n = len(0.7, sr), a = new Float32Array(n);
  const tThump = open ? 0 : 0.11, tSwish = open ? 0.04 : 0;
  mixInto(a, thump(len(0.15, sr), sr, r, 260, 0.03, 70), len(tThump, sr), 0.8);
  mixInto(a, sweepNoise(len(0.3, sr), sr, r, open ? 2200 : 4200, open ? 4200 : 2200, 0.8, (t) => adEnv(t, open ? 0.07 : 0.03, open ? 0.07 : 0.04)), len(tSwish, sr), 0.6);
  const [f1, f2] = open ? [784, 1175] : [1175, 784];
  bell(a, sr, len(open ? 0.13 : 0.16, sr), f1, 0.16, 0.25, [[1, 1, 1], [2, 0.2, 0.5]]);
  bell(a, sr, len(open ? 0.21 : 0.24, sr), f2, 0.14, 0.3, [[1, 1, 1], [2, 0.2, 0.5]]);
  return finishMono(a, sr);
}

function glimmer(v) {
  const sr = 32000, r = rng(460 + v), n = len(1.1, sr), a = new Float32Array(n);
  bell(a, sr, 0, 1318.5, 0.4, 0.35, [[1, 1, 1], [2, 0.3, 0.6], [3, 0.1, 0.4], [4.2, 0.08, 0.25]]);
  bell(a, sr, len(0.085, sr), 1975.5, 0.38, 0.45, [[1, 1, 1], [2, 0.3, 0.6], [3, 0.1, 0.4], [4.2, 0.08, 0.25]]);
  [2637, 3136, 3951, 4699].forEach((f, k) => bell(a, sr, len(0.14 + k * 0.035 + r() * 0.01, sr), f, 0.08, 0.1, [[1, 1, 1]]));
  const [L, R] = room([a], sr, 0.28, 0.75, 0.4);
  return finishStereo(L, R, sr);
}

function tap(v) {
  const sr = 44100, r = rng(480 + v), n = len(0.07, sr), a = new Float32Array(n), hp = new Biquad().set('hp', 3000, 0.7, sr);
  for (let i = 0; i < n; i++) { const t = i / sr; a[i] = Math.sin(TAU * (1450 + v * 60) * t) * 0.6 * adEnv(t, 0.001, 0.014) + hp.run(r() * 2 - 1) * 0.3 * Math.exp(-t / 0.0012); }
  return finishMono(a, sr);
}

function chime(v) {
  // morning wind chime in D major pentatonic (the morning preset's key)
  const sr = 32000, r = rng(500 + v), n = len(3.6, sr), L = new Float32Array(n), R = new Float32Array(n);
  const notes = [1174.7, 1318.5, 1480, 1760, 1975.5, 2349.3];
  for (let k = 0; k < 7; k++) {
    const m = new Float32Array(n);
    bell(m, sr, len(k * 0.22 + r() * 0.12, sr), notes[(k * 2 + Math.floor(r() * 2)) % notes.length], 0.3 - k * 0.02, 1.4, [[1, 1, 1], [2.76, 0.45, 0.45], [5.4, 0.2, 0.22], [8.93, 0.08, 0.1]]);
    const [l, rr] = panMono(m, r.bi() * 0.7);
    mixInto(L, l, 0); mixInto(R, rr, 0);
  }
  const [rl, rrr] = room([L, R], sr, 0.25, 0.85, 0.5);
  return finishStereo(rl, rrr, sr);
}

function moth(v) {
  const sr = 24000, r = rng(520 + v), n = len(0.75, sr), a = new Float32Array(n), bp = new Biquad().set('bp', 1300 + v * 200, 1.2, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, rate = 36 + 6 * Math.sin(TAU * 3 * t + v);
    ph += rate / sr;
    const p = ph % 1, beat = p < 0.4 ? Math.sin((Math.PI * p) / 0.4) : 0;
    a[i] = (bp.run(r() * 2 - 1) * 1.4 + Math.sin(TAU * 190 * t) * 0.15) * beat * Math.sin((Math.PI * t) / 0.75);
  }
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = 0.5 * Math.sin(TAU * 1.3 * (i / sr) + v), g = ((p + 1) * Math.PI) / 4; L[i] = a[i] * Math.cos(g); R[i] = a[i] * Math.sin(g); }
  return finishStereo(L, R, sr, 0.6);
}

// Cat meows: a band-limited glottal saw through three moving formant filters, with breath.
const MEOWS = {
  // 1: kitten, a short high "mew"
  1: { dur: 0.42, f0: [[0, 640], [0.14, 800], [0.42, 560]], F: [[0, [380, 2500, 3400]], [0.12, [750, 1900, 3100]], [0.42, [450, 1100, 2700]]], trill: 0, breath: 0.1, vib: 0 },
  // 2: the chirpy one, a rising trilled "mrrp?"
  2: { dur: 0.52, f0: [[0, 330], [0.2, 380], [0.52, 560]], F: [[0, [300, 900, 2500]], [0.22, [380, 1150, 2600]], [0.52, [680, 1750, 2900]]], trill: 0.26, breath: 0.08, vib: 0 },
  // 3: the old one, a long low "maaow"
  3: { dur: 0.85, f0: [[0, 300], [0.3, 430], [0.85, 270]], F: [[0, [320, 1000, 2500]], [0.2, [820, 1450, 2700]], [0.55, [660, 1100, 2600]], [0.85, [400, 780, 2400]]], trill: 0, breath: 0.14, vib: 0.012 },
};
function meow(cat) {
  const S = MEOWS[cat], sr = 32000, r = rng(540 + cat), n = len(S.dur + 0.1, sr), a = new Float32Array(n);
  const bands = [new Biquad(), new Biquad(), new Biquad()], gains = [1, 0.55, 0.22];
  const soft = new Biquad().set('lp', 3800, 0.6, sr);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = Math.min(i / sr, S.dur);
    if ((i & 31) === 0) { const F = trackVec(S.F, t); for (let k = 0; k < 3; k++) bands[k].set('bp', F[k], F[k] / (70 + 40 * k), sr); }
    const f = track(S.f0, t) * (1 + S.vib * Math.sin(TAU * 5.5 * t));
    const dp = f / sr; ph += dp; if (ph >= 1) ph -= 1;
    let src = blepSaw(ph, dp) * 0.6 + (r() * 2 - 1) * S.breath;
    if (S.trill && t < S.trill) src *= Math.pow(0.5 + 0.5 * Math.sin(TAU * 27 * t), 1.5);
    let y = 0;
    for (let k = 0; k < 3; k++) y += bands[k].run(src) * gains[k];
    const env = i / sr < S.dur ? adEnv(i / sr, 0.03, 10) * Math.min(1, (S.dur - i / sr) / 0.09) : 0;
    a[i] = soft.run(y) * env;
  }
  const [L, R] = room([a], sr, 0.18, 0.6, 0.35);
  return finishStereo(L, R, sr, 0.7);
}
function trackVec(pts, t) {
  if (t <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) {
    const [t0, v0] = pts[i - 1], [t1, v1] = pts[i], k = (t - t0) / (t1 - t0);
    return [v0[0] + (v1[0] - v0[0]) * k, v0[1] + (v1[1] - v0[1]) * k, v0[2] + (v1[2] - v0[2]) * k];
  }
  return pts[pts.length - 1][1];
}

function train() {
  // a train far away crossing left to right: rumble, wheel clacks in pairs, one soft two-tone horn
  const sr = 11025, r = rng(560), dur = 13, n = len(dur, sr), a = new Float32Array(n);
  const env = (t) => 0.08 + 0.92 * Math.exp(-Math.pow((t - 6.8) / 3.0, 2));
  const rumble = brown(n, r); filt(rumble, 'lp', 140, 0.7, sr);
  for (let i = 0; i < n; i++) a[i] = rumble[i] * 1.6 * env(i / sr);
  const clack = thump(len(0.08, sr), sr, r, 700, 0.02, 70);
  for (let t = 0.6; t < dur - 0.5; t += 1.55) {
    for (const off of [0, 0.16, 0.95, 1.11]) { const tt = t + off + r() * 0.01; if (tt < dur - 0.2) mixInto(a, clack, len(tt, sr), 0.4 * env(tt)); }
  }
  // horn: two saw tones, very soft, with a far echo
  const hornAt = len(2.2, sr), hl = len(1.4, sr), lpH = new Biquad().set('lp', 900, 0.7, sr);
  let p1 = 0, p2 = 0;
  for (let i = 0; i < hl; i++) {
    const t = i / sr, e = adEnv(t, 0.15, 10) * Math.min(1, (1.4 - t) / 0.3);
    p1 += 311 / sr; p2 += 370 / sr; p1 %= 1; p2 %= 1;
    const y = lpH.run((blepSaw(p1, 311 / sr) + blepSaw(p2, 370 / sr)) * 0.35 * e);
    a[hornAt + i] += y; if (hornAt + i + len(0.38, sr) < n) a[hornAt + i + len(0.38, sr)] += y * 0.3;
  }
  filt(a, 'lp', 1400, 0.7, sr);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = -0.8 + 1.6 * (i / n), g = ((p + 1) * Math.PI) / 4; L[i] = a[i] * Math.cos(g); R[i] = a[i] * Math.sin(g); }
  fadeEnds(L, sr, 300, 800); fadeEnds(R, sr, 300, 800);
  const [rl, rr] = room([L, R], sr, 0.3, 0.8, 0.5);
  return finishStereo(rl, rr, sr, 0.6);
}

function coffee() {
  // a soft percolator: clusters of low bubbles rising in pitch, and a thin steam hiss
  const sr = 16000, r = rng(580), dur = 3.0, n = len(dur, sr), a = new Float32Array(n);
  let t = 0.05;
  while (t < dur - 0.25) {
    const cluster = 2 + Math.floor(r() * 4);
    for (let k = 0; k < cluster; k++) {
      const f0 = 140 + r() * 260, d = 0.04 + r() * 0.05;
      chirpSine(a, sr, len(t, sr), f0, f0 * (1.5 + r() * 0.5), d, 0.25 + r() * 0.3, 0.004, d * 0.6);
      t += 0.03 + r() * 0.06;
    }
    t += 0.12 + r() * 0.35;
  }
  const hiss = noise(n, r); filt(hiss, 'hp', 2200, 0.7, sr); filt(hiss, 'lp', 6000, 0.7, sr);
  for (let i = 0; i < n; i++) a[i] += hiss[i] * 0.05 * Math.sin((Math.PI * i) / n);
  filt(a, 'lp', 2500, 0.7, sr);
  const [L, R] = room([a], sr, 0.15, 0.5, 0.3);
  for (let i = 0; i < L.length; i++) L[i] = (L[i] + R[i]) * 0.5;
  fadeEnds(L, sr, 30, 200);
  return finishMono(L, sr, 0.6);
}

function needleDrop() {
  // stylus lands (thump), platter rumble and a burst of crackle that settles
  const sr = 32000, r = rng(600), n = len(1.8, sr), a = new Float32Array(n);
  mixInto(a, thump(len(0.2, sr), sr, r, 220, 0.03, 58), 0, 1);
  const rumble = brown(n, r); filt(rumble, 'lp', 90, 0.7, sr);
  const hp = new Biquad().set('hp', 1500, 0.7, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr, e = Math.min(1, t / 0.05) * (0.4 + 0.6 * Math.exp(-t / 0.6));
    a[i] += rumble[i] * 0.4 * e + hp.run(r() * 2 - 1) * 0.03 * e;
    if (r() < 0.004 * e) { const amp = 0.15 + r() * 0.35; for (let k = 0; k < 8 && i + k < n; k++) a[i + k] += (r() * 2 - 1) * amp * (1 - k / 8); }
  }
  fadeEnds(a, sr, 0.5, 400);
  return finishMono(a, sr, 0.6);
}

function scratch() {
  // a record scratch-stop: back and forth over a chord, then the platter winds down to nothing
  const sr = 32000, r = rng(620), srcN = len(2.5, sr), src = new Float32Array(srcN);
  for (const m of [60, 64, 67, 71, 74]) { const f = mtof(m) / sr; let p = 0; for (let i = 0; i < srcN; i++) { p += f; p %= 1; src[i] += blepSaw(p, f) * 0.15; } }
  filt(src, 'lp', 2500, 0.7, sr);
  for (let i = 0; i < srcN; i++) src[i] += (r() * 2 - 1) * 0.05;
  const dur = 1.0, n = len(dur, sr), a = new Float32Array(n);
  const rate = (t) => (t < 0.07 ? 1 : t < 0.17 ? -2.6 : t < 0.27 ? 2.8 : t < 0.33 ? -1.2 : Math.max(0, 1 - (t - 0.33) / 0.5));
  let pos = 0.4 * sr;
  const nb = new Biquad().set('bp', 1800, 0.8, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr, rt = rate(t);
    pos = clamp(pos + rt, 1, srcN - 2);
    const i0 = Math.floor(pos), fr = pos - i0, s = src[i0] * (1 - fr) + src[i0 + 1] * fr;
    const sp = Math.min(1, Math.abs(rt));
    a[i] = s * Math.pow(sp, 0.6) * 1.4 + nb.run(r() * 2 - 1) * 0.12 * sp;
  }
  fadeEnds(a, sr, 1, 60);
  return finishMono(a, sr, 0.6);
}

// Ghost's purr picked up by the corner's mic: proximity bass cut, presence lift, a little preamp
// grit and a small room. Variant 0 adds a faint feedback ring that starts to build and is pulled down
// before it squeals (the "avoided" squeal); variant 1 is clean.
function micPurr(v) {
  const p = purr(0), sr = p.sr, src = p.ch[0];
  const n = src.length + len(0.2, sr), a = new Float32Array(n);
  const hp = new Biquad().set('hp', 160, 0.7, sr), pres = new Biquad().set('peak', 2800, 1.0, sr, 5), lp = new Biquad().set('lp', 6500, 0.7, sr);
  for (let i = 0; i < src.length; i++) a[i] = Math.tanh(lp.run(pres.run(hp.run(src[i] * 2.2))) * 1.6) * 0.7;
  if (v === 0) {
    // a ring at 2.7 kHz rises for 0.3 s from 1.1 s, then is caught and fades out quickly
    const at = len(1.1, sr), rl = len(0.55, sr), f = 2700 / sr;
    for (let i = 0; i < rl && at + i < n; i++) {
      const t = i / sr, e = t < 0.3 ? Math.pow(t / 0.3, 2) : Math.exp(-(t - 0.3) / 0.04);
      a[at + i] += Math.sin(TAU * f * i) * 0.045 * e;
    }
  }
  const [L, R] = room([a], sr, 0.22, 0.55, 0.3);
  for (let i = 0; i < L.length; i++) L[i] = (L[i] + R[i]) * 0.5;
  return finishMono(L, sr, 0.65);
}

// ---------------------------------------------------------------- ambience loops

function hissLoop() {
  // studio monitors left on: a soft high hiss with a trace of hum
  const sr = 22050, n = len(2.4, sr), xf = len(0.4, sr), ch = [];
  for (let c = 0; c < 2; c++) {
    const r = rng(730 + c), a = noise(n, r);
    filt(a, 'hp', 1800, 0.7, sr); filt(a, 'lp', 9000, 0.7, sr);
    for (let i = 0; i < n; i++) a[i] = a[i] * 0.8 + Math.sin((TAU * 120 * i) / sr) * 0.025 + Math.sin((TAU * 240 * i) / sr) * 0.01;
    ch.push(loopify(a, xf));
  }
  return finishLoop(ch, sr);
}


function windLoop() {
  const sr = 16000, dur = 7, n = len(dur, sr), xf = len(1, sr), ch = [];
  const g = rng(640), gust = new Float32Array(n);
  let gv = 0.5, gt = 0.5;
  for (let i = 0; i < n; i++) { if (i % 2205 === 0) gt = 0.3 + g() * 0.7; gv += (gt - gv) * 0.00012; gust[i] = gv; }
  for (let c = 0; c < 2; c++) {
    const r = rng(650 + c), a = new Float32Array(n), bp = new Biquad(), wh = new Biquad();
    for (let i = 0; i < n; i++) {
      if ((i & 63) === 0) { bp.set('bp', 260 + gust[i] * 520, 0.9, sr); wh.set('bp', 900 + gust[i] * 700, 9, sr); }
      const x = r() * 2 - 1;
      a[i] = (bp.run(x) * 1.0 + wh.run(x) * 0.25 * gust[i]) * (0.25 + gust[i]);
    }
    ch.push(loopify(a, xf));
  }
  return finishLoop(ch, sr);
}

function cityLoop() {
  const sr = 8000, dur = 10, n = len(dur, sr), xf = len(1.5, sr), ch = [];
  for (let c = 0; c < 2; c++) {
    const r = rng(670 + c), b = brown(n, r), a = new Float32Array(n);
    filt(b, 'lp', 220, 0.7, sr);
    for (let i = 0; i < n; i++) a[i] = b[i] * (0.8 + 0.2 * Math.sin(TAU * (0.07 + c * 0.02) * (i / sr)));
    // distant cars passing now and then
    for (let t = 1 + c * 1.7; t < dur - 2; t += 3.2 + r() * 1.6) {
      const pass = sweepNoise(len(2.2, sr), sr, r, 380, 760, 1.1, (tt) => Math.sin((Math.PI * tt) / 2.2) ** 2 * 0.5);
      mixInto(a, pass, len(t, sr));
    }
    ch.push(loopify(a, xf));
  }
  return finishLoop(ch, sr);
}

function rainLoop() {
  const sr = 22050, dur = 4.5, n = len(dur, sr), xf = len(0.5, sr), ch = [];
  for (let c = 0; c < 2; c++) {
    const r = rng(690 + c), a = noise(n, r);
    filt(a, 'hp', 500, 0.7, sr); filt(a, 'lp', 5500, 0.7, sr);
    for (let i = 0; i < n; i++) a[i] *= 0.28;
    for (let k = 0; k < dur * 260; k++) {
      const at = Math.floor(r() * (n - 200)), f = 1800 + r() * 5000, amp = 0.05 + Math.pow(r(), 3) * 0.3, d = 0.002 + r() * 0.003;
      bell(a, sr, at, f, amp, d, [[1, 1, 1]]);
    }
    for (let k = 0; k < dur * 1.5; k++) chirpSine(a, sr, Math.floor(r() * (n - 2000)), 900 + r() * 700, 1100 + r() * 900, 0.04, 0.12, 0.002, 0.02);
    ch.push(loopify(a, xf));
  }
  return finishLoop(ch, sr);
}

function cricketsLoop() {
  const sr = 22050, dur = 6, n = len(dur, sr), xf = len(0.4, sr), L = new Float32Array(n), R = new Float32Array(n);
  const bugs = [[4300, 0.72, -0.6, 3], [4700, 0.9, 0.5, 3], [5100, 1.15, 0.1, 4]];
  for (const [f, period, pan, pulses] of bugs) {
    const r = rng(f), m = new Float32Array(n);
    for (let t = r() * period; t < dur; t += period * (0.92 + r() * 0.16)) {
      for (let p = 0; p < pulses; p++) {
        const at = len(t + p * 0.032, sr), pl = len(0.018, sr);
        for (let i = 0; i < pl && at + i < n; i++) m[at + i] += Math.sin((TAU * f * i) / sr) * Math.sin((Math.PI * i) / pl) * 0.3;
      }
    }
    const [l, rr] = panMono(m, pan);
    mixInto(L, l, 0); mixInto(R, rr, 0);
  }
  const [rl, rr] = room([L, R], sr, 0.35, 0.7, 0.4);
  const a = loopify(rl.subarray(0, n), xf), b = loopify(rr.subarray(0, n), xf);
  return finishLoop([a, b], sr);
}

function floatLoop() {
  // the airy whoosh while floating: pinkish noise; the engine sweeps a bandpass over it live
  const sr = 24000, n = len(4, sr), xf = len(0.5, sr), r = rng(710), a = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) { const w = r() * 2 - 1; b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048; a[i] = b0 + b1 + b2 + w * 0.05; }
  return finishLoop([loopify(a, xf)], sr);
}

// loops: no fades (seamless), DC removed, normalised by RMS so levels are predictable
function finishLoop(chs, sr) {
  for (const a of chs) removeDC(a);
  const k = 0.18 / (rmsOf(chs) || 1);
  scale(chs, k);
  normalizePeak(chs, Math.min(0.9, Math.max(...chs.map((a) => a.reduce((p, v) => Math.max(p, Math.abs(v)), 0)))));
  return out(sr, ...chs);
}

// ---------------------------------------------------------------- the registry
// name -> { variants, render(v), gain (playback level), prio (higher survives voice stealing),
//           gap (minimum seconds between two plays) }
export const SFX = {
  hop: { variants: 3, render: hop, gain: 0.45, prio: 2, gap: 0.05 },
  doubleHop: { variants: 2, render: doubleHop, gain: 0.42, prio: 2, gap: 0.05 },
  land: { variants: 3, render: land, gain: 0.5, prio: 2, gap: 0.06 },
  bump: { variants: 2, render: bump, gain: 0.45, prio: 2, gap: 0.12 },
  poke: { variants: 3, render: poke, gain: 0.4, prio: 2, gap: 0.08 },
  sparkle: { variants: 3, render: sparkle, gain: 0.28, prio: 3, gap: 0.1 },
  purr: { variants: 1, render: purr, gain: 0.5, prio: 3, gap: 0.5 },
  journalOpen: { variants: 1, render: () => journal(true), gain: 0.38, prio: 4, gap: 0.1 },
  journalClose: { variants: 1, render: () => journal(false), gain: 0.38, prio: 4, gap: 0.1 },
  glimmer: { variants: 2, render: glimmer, gain: 0.34, prio: 4, gap: 0.05 },
  tap: { variants: 2, render: tap, gain: 0.3, prio: 4, gap: 0.03 },
  chime: { variants: 1, render: chime, gain: 0.34, prio: 5, gap: 1 },
  moth: { variants: 3, render: moth, gain: 0.2, prio: 1, gap: 0.4 },
  meow1: { variants: 1, render: () => meow(1), gain: 0.36, prio: 3, gap: 0.3 },
  meow2: { variants: 1, render: () => meow(2), gain: 0.36, prio: 3, gap: 0.3 },
  meow3: { variants: 1, render: () => meow(3), gain: 0.36, prio: 3, gap: 0.3 },
  train: { variants: 1, render: train, gain: 0.4, prio: 1, gap: 10 },
  coffee: { variants: 1, render: coffee, gain: 0.3, prio: 2, gap: 1 },
  needleDrop: { variants: 1, render: needleDrop, gain: 0.4, prio: 4, gap: 0.5 },
  scratch: { variants: 1, render: scratch, gain: 0.34, prio: 4, gap: 0.5 },
  micPurr: { variants: 2, render: micPurr, gain: 0.42, prio: 3, gap: 0.5 },
};
for (const s of SURFACES) SFX['step_' + s] = { variants: 4, render: (v) => step(s, v), gain: s === 'metal' ? 0.2 : s === 'puddle' ? 0.25 : 0.28, prio: 0, gap: 0.06 };

export const LOOPS = {
  float: { render: floatLoop },
  wind: { render: windLoop },
  city: { render: cityLoop },
  rain: { render: rainLoop },
  crickets: { render: cricketsLoop },
  hiss: { render: hissLoop },
};

// One function that renders any buffer by its store key (used by the worker and the sync fallback).
//   piano:60  ep:60  box:84  drum:kick:0  sfx:hop:0  loop:wind  crackle  ir:48000
export function renderKey(key) {
  const p = key.split(':');
  if (p[0] === 'piano') return pianoNote(+p[1]);
  if (p[0] === 'ep') return epNote(+p[1]);
  if (p[0] === 'box') return boxNote(+p[1]);
  if (p[0] === 'drum') return DRUMS[p[1]](+p[2]);
  if (p[0] === 'sfx') return SFX[p[1]].render(+p[2]);
  if (p[0] === 'loop') return LOOPS[p[1]].render();
  if (p[0] === 'crackle') return crackle();
  if (p[0] === 'ir') return reverbIR(+p[1]);
  throw new Error('unknown buffer ' + key);
}

// Every key, most urgent first (what the first seconds of play need comes first).
export function allKeys(sampleRate) {
  const k = ['ir:' + sampleRate, 'crackle'];
  for (const r of PIANO_ROOTS) k.push('piano:' + r);
  for (const d of ['kick', 'rim', 'snare', 'hat', 'shaker']) for (let v = 0; v < 3; v++) k.push(`drum:${d}:${v}`);
  for (const n of ['hop', 'land', 'doubleHop', 'step_soft', 'step_roof', 'step_wood', 'step_metal', 'bump', 'tap', 'poke', 'sparkle', 'glimmer']) for (let v = 0; v < SFX[n].variants; v++) k.push(`sfx:${n}:${v}`);
  for (const r of EP_ROOTS) k.push('ep:' + r);
  k.push('loop:float', 'loop:city', 'loop:wind');
  for (const r of BOX_ROOTS) k.push('box:' + r);
  for (let v = 0; v < 3; v++) k.push('drum:openHat:' + v);
  for (const n of Object.keys(SFX)) for (let v = 0; v < SFX[n].variants; v++) if (!k.includes(`sfx:${n}:${v}`)) k.push(`sfx:${n}:${v}`);
  for (const n of Object.keys(LOOPS)) if (!k.includes('loop:' + n)) k.push('loop:' + n);
  return k;
}

export const DRUMS = { kick, rim, snare, hat: (v) => hat(v), openHat: (v) => hat(v, 32000, true), shaker };
