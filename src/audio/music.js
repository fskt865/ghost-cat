// music.js: the generative lo-fi music. One chord clock, one key; areas blend their numbers over a
// few seconds and switch key/progressions at the next chord. Notes are scheduled ahead in time
// (tick(until)), so the same code drives the live game and OfflineAudioContext tests.
import { PRESETS, PROGRESSIONS, THEME, SCALES, parseChord, leanPreset } from './presets.js';
import { PIANO_ROOTS, EP_ROOTS, BOX_ROOTS } from './synth.js';
import { clamp, mtof } from './dsp.js';

const NUM_KEYS = Object.keys(PRESETS.home).filter((k) => typeof PRESETS.home[k] === 'number');
const nearestRoot = (roots, m) => { let best = roots[0]; for (const r of roots) if (Math.abs(r - m) < Math.abs(best - m)) best = r; return best; };
const mod12 = (x) => ((x % 12) + 12) % 12;

export function createMusic(ctx, io) {
  const { store, rnd, nodes: N, now, lean } = io;
  const maxVoices = io.maxVoices || 28;
  const cur = {}, from = {};
  for (const k of NUM_KEYS) { cur[k] = PRESETS.home[k]; from[k] = cur[k]; }
  let to = null, toName = null, xStart = 0, xDur = 0;
  let key = 3, mode = 'major', progList = PROGRESSIONS.warm, progIdx = 0, chordIdx = 0, pending = null;
  let running = false, paused = false, oneShotEnd = Infinity;
  let nextStep = 0, step = 0, bar = 0, barStart = 0, barInChord = 0;
  let chord = null, rh = null, lh = 36, subNote = 36, chordPcs = [0, 4, 7];
  let motif = null, phrase = -1, pulseStep = -1, epPattern = null, quietUntilBar = -1;
  const ends = new Float64Array(64); let endsI = 0;
  const padEnds = [];
  const stats = { notes: 0, dropped: 0, pads: 0, drums: 0, maxActive: 0, vinylStops: 0 };

  // ---------- helpers
  const stepDur = () => 60 / cur.bpm / 4;
  function blendAt(t) {
    if (!to) return;
    let b = xDur > 0 ? clamp((t - xStart) / xDur, 0, 1) : 1;
    b = b * b * (3 - 2 * b);
    for (let i = 0; i < NUM_KEYS.length; i++) { const k = NUM_KEYS[i]; cur[k] = from[k] + (to[k] - from[k]) * b; }
  }
  function active(t) { let n = 0; for (let i = 0; i < ends.length; i++) if (ends[i] > t) n++; return n; }

  function note(bank, roots, m, t, vel, dur, dest) {
    const r = nearestRoot(roots, m), buf = store.get(bank + ':' + r);
    if (!buf || vel <= 0.001) return false;
    const a = active(t);
    if (a >= maxVoices) { stats.dropped++; return false; }
    if (a + 1 > stats.maxActive) stats.maxActive = a + 1;
    const rate = Math.pow(2, (m - r) / 12 + (rnd() - 0.5) * 0.0025);
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate;
    g.gain.setValueAtTime(vel, t);
    g.gain.setTargetAtTime(0, t + dur, 0.09);
    src.connect(g); g.connect(dest);
    const end = Math.min(t + dur + 0.6, t + buf.duration / rate);
    src.start(t); src.stop(end);
    ends[endsI] = end; endsI = (endsI + 1) % ends.length;
    stats.notes++;
    return true;
  }
  const pianoDest = (m) => (m < 52 ? N.pianoL : m < 68 ? N.pianoM : N.pianoH);
  const PIANO_K = 6, EP_K = 3.5, BOX_K = 6;
  const piano = (m, t, vel, dur) => note('piano', PIANO_ROOTS, m, t, vel * vel * PIANO_K, dur, pianoDest(m));
  const ep = (m, t, vel, dur) => note('ep', EP_ROOTS, m, t, vel * vel * EP_K, dur, N.ep);
  const box = (m, t, vel, dur) => note('box', BOX_ROOTS, m, t, vel * vel * BOX_K, dur, rnd() < 0.5 ? N.boxL : N.boxR);

  function drum(name, v, t, vel, dest) {
    const buf = store.get('drum:' + name + ':' + v);
    if (!buf) return;
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; g.gain.value = vel * vel;
    src.connect(g); g.connect(dest); src.start(t);
    stats.drums++;
  }

  function pad(notes, t, dur, attack, level, high) {
    // drop the oldest pad early if three would overlap
    while (padEnds.length && padEnds[0].end <= t) padEnds.shift();
    if (padEnds.length >= 2) { const o = padEnds.shift(); for (const g of o.gains) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, 0.4); } }
    const gains = [], rel = 2.5, stopAt = t + dur + rel * 2.2;
    for (let i = 0; i < notes.length; i++) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.setTargetAtTime(i === 0 ? level * 0.55 : level, t, attack / 3);
      g.gain.setTargetAtTime(0, t + dur, rel / 3);
      g.connect(N.padIn);
      const f = mtof(notes[i]);
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.setPeriodicWave(N.padWave); o.frequency.value = f; o.detune.value = det + (rnd() - 0.5) * 4;
        o.connect(g); o.start(t); o.stop(stopAt);
      }
      gains.push(g);
    }
    if (high > 0.01 && notes.length) {
      const g = ctx.createGain(), o = ctx.createOscillator();
      g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(level * high * 0.8, t, attack / 2); g.gain.setTargetAtTime(0, t + dur, rel / 3);
      o.type = 'sine'; o.frequency.value = mtof(notes[notes.length - 1] + 12);
      o.connect(g); g.connect(N.padIn); o.start(t); o.stop(stopAt);
      gains.push(g);
    }
    padEnds.push({ end: stopAt, gains });
    stats.pads++;
  }

  function sub(m, t, dur, level) {
    if (level < 0.01) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.setPeriodicWave(N.subWave); o.frequency.value = mtof(m);
    g.gain.setValueAtTime(0, t); g.gain.setTargetAtTime(level, t, 0.025); g.gain.setTargetAtTime(0, t + dur, 0.12);
    o.connect(g); g.connect(N.sub); o.start(t); o.stop(t + dur + 0.8);
  }

  // ---------- harmony
  function voiceRH(pcs, prev) {
    let best = null, bestCost = Infinity;
    for (let r = 0; r < pcs.length; r++) {
      const v = [53 + mod12(pcs[r] - 53)];
      for (let j = 1; j < pcs.length; j++) { let n = v[j - 1] + 1; while (mod12(n) !== pcs[(r + j) % pcs.length]) n++; v.push(n); }
      if (v[v.length - 1] > 79) continue;
      let cost = 0;
      if (prev && prev.length === v.length) for (let i = 0; i < v.length; i++) cost += Math.abs(v[i] - prev[i]);
      else cost = Math.abs(v.reduce((a, b) => a + b, 0) / v.length - 65) * 2;
      cost += Math.max(0, v[v.length - 1] - 76) * 2 + rnd() * 1.5;
      if (cost < bestCost) { bestCost = cost; best = v; }
    }
    return best || pcs.map((p) => 60 + p);
  }

  function setChord() {
    const prog = progList[progIdx % progList.length];
    chord = parseChord(prog[chordIdx % prog.length]);
    const root = key + chord.root;
    let upper = chord.q.slice(1);
    if (upper.length > 4) upper = upper.filter((x) => x !== 7);
    chordPcs = chord.q.map((x) => mod12(root + x));
    rh = voiceRH(upper.map((x) => mod12(root + x)), rh);
    lh = 40 + mod12(root - 40);
    subNote = 33 + mod12(root - 33);
  }

  function advanceChord() {
    if (pending) {
      key = pending.key; mode = pending.mode; progList = PROGRESSIONS[pending.prog];
      progIdx = Math.floor(rnd() * progList.length); chordIdx = 0; pending = null; motif = null;
      return;
    }
    chordIdx++;
    if (chordIdx >= progList[progIdx % progList.length].length) {
      chordIdx = 0;
      const r = rnd();   // gentle random walk: mostly stay or step to a neighbour
      if (r < 0.3) progIdx = (progIdx + 1) % progList.length;
      else if (r < 0.5) progIdx = (progIdx + progList.length - 1) % progList.length;
    }
  }

  // ---------- melody
  const scale = () => SCALES[mode];
  function degToMidi(d) {
    let base = 60 + key; if (base < 62) base += 12;
    const sc = scale(), o = Math.floor(d / 7), i = mod12(((d % 7) + 7) % 7);
    let m = base + sc[i] + 12 * o;
    for (const pc of chordPcs) if (mod12(m - pc) === 1) { m -= 1; break; }   // avoid minor-9th clashes
    return m;
  }
  function makeMotif() {
    if (rnd() < cur.themeProb) return THEME;
    const m = [], count = 3 + Math.floor(rnd() * 4), slots = [0, 1, 2, 3, 4, 6, 8, 9, 10, 12];
    let d = [2, 4, 7][Math.floor(rnd() * 3)], s = rnd() < 0.6 ? 0 : 1;
    for (let i = 0; i < count && s < 15; i++) {
      const len = i === count - 1 ? 3 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 2);
      m.push({ s, d, len });
      d = clamp(d + [-2, -1, -1, 1, 1, 2, 0][Math.floor(rnd() * 7)], 0, 9);
      s = Math.max(s + len, slots[Math.floor(rnd() * slots.length)]);
    }
    return m;
  }
  const answer = (m) => m.map((n, i) => (i >= m.length - 2 ? { ...n, d: Math.max(0, n.d - 1 - (i === m.length - 1 ? 1 : 0)) } : n));

  // ---------- the clock
  function onBar(t) {
    barStart = t;
    if (barInChord === 0) {
      if (chord) advanceChord();
      setChord();
      const chordDur = Math.max(1, Math.round(cur.barsPerChord)) * stepDur() * 16;
      if (cur.pad > 0.01) pad([45 + mod12(key + chord.root - 45), rh[0], rh[1], rh[2]], t, chordDur, cur.padAttack, 0.055, cur.padHigh);
      if (cur.sub > 0.01) sub(subNote, t + 0.005, cur.drums > 0.25 && rnd() < 0.5 ? stepDur() * 9.5 : chordDur * 0.95, 0.135);
      if (cur.piano > 0.01) {
        const v = cur.vel;
        piano(lh, t + 0.01, v * 0.72 * (0.85 + rnd() * 0.15), chordDur * 0.95);
        const r2 = rnd();
        if (r2 < 0.35) piano(lh + (chord.q.includes(10) || chord.q.includes(11) ? (chord.q.includes(11) ? 11 : 10) : 7), t + 0.03, v * 0.5, chordDur * 0.9);
        else if (r2 < 0.55) piano(lh + 12, t + 0.03, v * 0.5, chordDur * 0.9);
        const roll = cur.roll * (0.7 + rnd() * 0.6);
        for (let i = 0; i < rh.length; i++) {
          const top = i === rh.length - 1 ? 0.06 : 0;
          piano(rh[i], t + 0.02 + i * roll + rnd() * 0.01, v * (0.82 + rnd() * 0.16) + top, chordDur * (0.85 + rnd() * 0.1));
        }
      }
    }
    barInChord = (barInChord + 1) % Math.max(1, Math.round(cur.barsPerChord));
    // per-bar choices
    pulseStep = rnd() < cur.pulse ? (rnd() < 0.55 ? 6 : 8) : -1;
    const pats = [[0, 6, 10], [3, 6, 14], [0, 10], [6, 14], [2, 8, 11], [0, 7, 10, 14]];
    epPattern = cur.ep > 0.01 && rnd() < 0.4 + cur.epComp * 0.6 ? pats[Math.floor(rnd() * pats.length)] : null;
    const pos = bar % 4;
    if (bar <= quietUntilBar || cur.melody < 0.01) phrase = -1;
    else if (pos === 0) { if (rnd() < cur.melody) { if (!motif || rnd() < 0.6) motif = makeMotif(); phrase = 0; } else phrase = -1; }
    else if (pos === 2 && motif) phrase = rnd() < cur.melody * 0.75 ? 2 : -1;
    // a rare vinyl stop at the end of an 8-bar section
    if (bar % 8 === 7 && cur.drums > 0.2 && rnd() < cur.vinylStop) vinylStop(t + stepDur() * 12, stepDur() * 4);
  }

  function doStep(s, t0) {
    blendAt(t0);
    if (s === 0) onBar(t0);
    const sd = stepDur();
    const t = t0 + (s & 1 ? (cur.swing - 0.5) * 2 * sd : 0);
    // drums
    if (cur.drums > 0.01) {
      const hum = (rnd() - 0.5) * 0.008;
      let pk = 0;
      if (s === 0) pk = cur.kick; else if (s === 10) pk = cur.kick * 0.55; else if (s === 7) pk = cur.kick * 0.22; else if (s === 14 || s === 3) pk = cur.kick * 0.1;
      if (pk && rnd() < pk) drum('kick', Math.floor(rnd() * 3), t + hum, s === 0 ? 0.95 : 0.75 + rnd() * 0.1, N.kick);
      if ((s === 4 || s === 12) && rnd() < cur.back) {
        const sn = rnd() < cur.snare;
        drum(sn ? 'snare' : 'rim', Math.floor(rnd() * 3), t + hum + 0.006, 0.8 + rnd() * 0.12, N.back);
      } else if ((s === 7 || s === 15) && rnd() < cur.ghost * 0.6) drum('rim', Math.floor(rnd() * 3), t + hum, 0.35, N.back);
      const brushy = cur.snare < 0.15;
      if ((s & 1) === 0 && rnd() < cur.hat) drum(brushy ? 'shaker' : s === 14 && rnd() < 0.12 ? 'openHat' : 'hat', Math.floor(rnd() * 3), t + hum, (s & 3) === 0 ? 0.72 : 0.55 + rnd() * 0.1, N.hat);
      else if (s & 1 && rnd() < cur.ghost) drum(brushy ? 'shaker' : 'hat', Math.floor(rnd() * 3), t + hum, 0.32, N.hat);
    }
    // bass bounce
    if (s === 10 && cur.sub > 0.01 && cur.drums > 0.25 && rnd() < 0.45) sub(rnd() < 0.7 ? subNote : subNote + 7 > 44 ? subNote - 5 : subNote + 7, t, sd * 5, 0.11);
    // piano re-strike
    if (s === pulseStep && cur.piano > 0.01 && rh) for (let i = 1; i < rh.length; i++) piano(rh[i], t + (i - 1) * 0.015, cur.vel * 0.62 * (0.85 + rnd() * 0.2), sd * (16 - s) * 0.9);
    // Rhodes comping
    if (epPattern && rh && epPattern.includes(s) && rnd() < 0.55 + cur.epComp * 0.45) {
      const len = s === 0 ? sd * 8 : sd * (1.5 + rnd() * 2);
      const v = 0.38 + rnd() * 0.12;
      for (let i = 0; i < rh.length; i++) if (i < 3 || rnd() < 0.5) ep(rh[i] + (rh[0] < 55 ? 12 : 0), t + i * 0.006, v, len);
    }
    // melody phrase
    if (phrase >= 0 && motif && (s & 1) === 0) {
      const e8 = ((bar % 4) - phrase) * 8 + s / 2;
      const m = phrase === 2 ? answer(motif) : motif;
      for (const n of m) if (n.s === e8) {
        const midi = degToMidi(n.d), v = cur.vel * (0.95 + rnd() * 0.2) + (n.s % 4 === 0 ? 0.04 : 0), len = n.len * sd * 2 * 1.1;
        const lazy = 0.012 + rnd() * 0.012;
        if (cur.piano > 0.01) piano(midi, t + lazy, Math.min(0.62, v), len);
        else if (cur.ep > 0.01) ep(midi, t + lazy, v, len);
        if (cur.box > 0.2 && rnd() < 0.55) box(midi + 12, t + lazy, 0.4, len);
      }
    }
    // music-box sparkle
    if (cur.box > 0.01 && (s & 1) === 0 && rnd() < cur.boxDensity) {
      const pc = chordPcs[Math.floor(rnd() * chordPcs.length)];
      box(79 + mod12(pc - 79) + (rnd() < 0.35 ? 12 : 0), t, 0.3 + rnd() * 0.18, sd * 4);
    }
  }

  // ---------- effects on the music bus
  function vinylStop(t0, dur) {
    dur = Math.min(dur, 0.85);
    const n = 32, curve = new Float32Array(n), d0 = N.wobbleBase;
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * dur; curve[i] = d0 + (x * x) / (2 * dur); }
    try {
      N.wobble.delayTime.cancelScheduledValues(t0);
      N.wobble.delayTime.setValueCurveAtTime(curve, t0, dur);
      N.wobble.delayTime.setValueAtTime(d0, t0 + dur + 0.08);
      N.stopGain.gain.cancelScheduledValues(t0);
      N.stopGain.gain.setValueAtTime(1, t0);
      N.stopGain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      N.stopGain.gain.setValueAtTime(0, t0 + dur + 0.01);
      N.stopGain.gain.setTargetAtTime(1, t0 + dur + 0.1, 0.01);
      stats.vinylStops++;
    } catch (e) { /* overlapping automation: skip this stop */ }
  }

  // ---------- public
  function setArea(name, t) {
    const p0 = PRESETS[name];
    if (!p0) return false;
    if (name === toName && running && !paused && t < oneShotEnd) return true;
    const p = leanPreset(p0, lean);
    blendAt(t);
    for (const k of NUM_KEYS) from[k] = cur[k];
    const first = !to;
    to = p; toName = name; xStart = t; xDur = first ? 0 : p.xfade || 5;
    if (first) blendAt(t);
    const tau = first ? 0.05 : xDur / 3;
    const w = p.width;
    const set = (param, v, tc = tau) => { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, tc); };
    set(N.pianoBus.gain, p.piano * 0.9); set(N.epBus.gain, p.ep * 0.75); set(N.boxBus.gain, p.box * 0.55);
    set(N.padBus.gain, p.pad); set(N.subBus.gain, p.sub * 0.9); set(N.drumBus.gain, p.drums * 1.2);
    set(N.crackle.gain, p.crackle * 2); set(N.lp.frequency, p.lp); set(N.hp.frequency, p.hp);
    set(N.padLP.frequency, p.padCutoff); set(N.reverbSend.gain, p.reverb);
    set(N.wobbleDepth.gain, 0.0011 * p.wobble); set(N.flutterDepth.gain, 0.00006 * p.flutter);
    set(N.panL.pan, -0.45 * w); set(N.panH.pan, 0.45 * w); set(N.boxPanL.pan, -0.6 * w); set(N.boxPanR.pan, 0.6 * w);
    set(N.epPanDepth.gain, 0.4 * w);
    set(N.areaGain.gain, p.level, first ? 1.2 : tau);
    oneShotEnd = Infinity;
    if (p.oneShot) {
      oneShotEnd = t + p.oneShot;
      N.areaGain.gain.setTargetAtTime(0, oneShotEnd, 1.3);
    }
    if (first || !running || paused || p.key !== key || p.mode !== mode || PROGRESSIONS[p.prog] !== progList) {
      pending = { key: p.key, mode: p.mode, prog: p.prog };
    }
    if (!running) start(t);
    return true;
  }

  function start(t) {
    running = true; paused = false;
    nextStep = t + 0.08; step = 0; barInChord = 0;
    if (pending) { key = pending.key; mode = pending.mode; progList = PROGRESSIONS[pending.prog]; progIdx = Math.floor(rnd() * progList.length); chordIdx = 0; pending = null; }
    chord = null;
  }

  function tick(until) {
    if (!running || paused) return;
    const t = now();
    if (t > oneShotEnd + 5) return;   // the morning has faded: stay idle until the next setArea
    if (nextStep < t - 0.05) { while (nextStep < t + 0.02) { nextStep += stepDur(); step = (step + 1) % 16; if (step === 0) bar++; } }
    while (nextStep < until) {
      doStep(step, nextStep);
      nextStep += stepDur();
      step = (step + 1) % 16;
      if (step === 0) bar++;
    }
  }

  // pause when the music is inaudible (muted or volume 0) to save battery; resume at a fresh bar
  function setPaused(p) {
    if (p === paused) return;
    paused = p;
    if (!p && running) { nextStep = now() + 0.1; step = 0; barInChord = 0; }
  }

  // quantise to the next eighth note
  function nextEighth(t) {
    const e = stepDur() * 2;
    if (!running || paused || !barStart) return t + 0.03;
    const k = Math.ceil((t + 0.04 - barStart) / e);
    return Math.max(t + 0.03, barStart + k * e);
  }

  function moment(name, t) {
    const at = nextEighth(t);
    if (!rh) setChord();
    const duck = (depth, hold) => {
      const g = N.duck.gain;
      g.cancelScheduledValues(at); g.setTargetAtTime(depth, at - 0.02, 0.08); g.setTargetAtTime(1, at + hold, 0.6);
    };
    const M = N.moment;
    const mp = (m, tt, v, d) => note('piano', PIANO_ROOTS, m, tt, v * v * PIANO_K, d, M);
    const mb = (m, tt, v, d) => note('box', BOX_ROOTS, m, tt, v * v * BOX_K, d, M);
    const sd = Math.min(0.2, stepDur());
    if (name === 'secret') {
      const tones = [...rh].sort((a, b) => a - b);
      const seq = [tones[0] + 12, tones[1] + 12, tones[2] + 12, tones[tones.length - 1] + 12, tones[1] + 24];
      seq.forEach((m, i) => { mb(m, at + i * sd, 0.5, i === seq.length - 1 ? 1.6 : 0.5); if (i % 2 === 0) mp(m - 12, at + i * sd, 0.36, 0.9); });
      duck(0.6, seq.length * sd + 1.2);
      quietUntilBar = bar + 2;
      return true;
    }
    if (name === 'purr') {
      const pair = mode === 'minor' ? ['iv:m9', 'i:m9'] : ['IV:maj9', 'I:maj9'];
      pair.forEach((sym, ci) => {
        const c = parseChord(sym), root = key + c.root, tt = at + ci * 1.5;
        const up = c.q.slice(1).filter((x) => x !== 7).map((x) => mod12(root + x));
        const v = voiceRH(up, rh);
        mp(48 + mod12(root - 48), tt, 0.4, 1.6);
        v.forEach((m, i) => mp(m, tt + 0.03 + i * 0.06, 0.38, ci ? 2.6 : 1.5));
      });
      duck(0.5, 3.4);
      quietUntilBar = bar + 2;
      return true;
    }
    if (name === 'goal') {
      THEME.forEach((n) => {
        const m = degToMidi(n.d), tt = at + n.s * sd * 2;
        mp(m, tt, 0.5, n.len * sd * 2.2); mb(m + 12, tt, 0.4, n.len * sd * 2.2);
      });
      duck(0.5, 16 * sd * 2 + 1);
      quietUntilBar = bar + 4;
      return true;
    }
    if (name === 'needle') {
      // crackle first, then the music fades up through a closed filter, like a record starting
      const s = N.stopGain.gain, lp = N.lp.frequency, ck = N.crackleBoost.gain;
      s.cancelScheduledValues(t); s.setTargetAtTime(0, t, 0.03); s.setTargetAtTime(1, t + 0.9, 0.7);
      lp.cancelScheduledValues(t); lp.setTargetAtTime(260, t, 0.03); lp.setTargetAtTime(to ? to.lp : 5000, t + 1.0, 1.1);
      ck.cancelScheduledValues(t); ck.setTargetAtTime(3, t, 0.05); ck.setTargetAtTime(1, t + 2.5, 1.5);
      if (running && !paused) { nextStep = Math.max(nextStep, t + 0.9); step = 0; barInChord = 0; chordIdx = -1; }
      return true;
    }
    if (name === 'scratch') {
      vinylStop(t + 0.05, 0.6);
      if (running && !paused) { nextStep = t + 1.9; step = 0; barInChord = 0; }
      return true;
    }
    return false;
  }

  // The music corner's MIDI keyboard: key `index` (any integer, 0 = lowest) plays a soft Rhodes note
  // from a ladder of the current chord's tones (with the 9th and 6th from the scale), so walking across
  // the keys always fits whatever is playing. Played immediately, not quantised in time.
  let lastKeyT = -1, lastKeyIdx = -99;
  function playKey(index, t, vel) {
    if (!rh) setChord();
    const sc = scale(), tonicPc = mod12(key);
    const pcs = new Set(chordPcs);
    pcs.add(mod12(tonicPc + sc[1])); // the 2nd/9th of the key sits well over every chord here
    const ladder = [];
    for (let m = 52; m <= 88; m++) if (pcs.has(mod12(m))) {
      if (ladder.length && m - ladder[ladder.length - 1] < 2) continue; // no semitone neighbours
      ladder.push(m);
    }
    const i = ((Math.floor(index) % ladder.length) + ladder.length) % ladder.length;
    const m = ladder[Math.min(ladder.length - 1, i + 3)] || ladder[i];
    if (t - lastKeyT < 0.04 && index === lastKeyIdx) return false;
    lastKeyT = t; lastKeyIdx = index;
    const v = clamp((vel == null ? 0.42 : vel) * (0.88 + rnd() * 0.22), 0.05, 0.8);
    return note('ep', EP_ROOTS, m, t + 0.005, v * v * EP_K, 0.32 + rnd() * 0.12, N.keys);
  }

  return { setArea, tick, moment, setPaused, playKey, stats, get area() { return toName; }, get state() { return { key, mode, bar, step, chord: chord && chord.sym, bpm: +cur.bpm.toFixed(1), active: active(now()) }; } };
}
