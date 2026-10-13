// harness.js: offline rendering and level analysis for tests and the test page (not used by the game).
// Renders the real engine on an OfflineAudioContext by stepping a fake clock, exactly as the live
// 100 ms timer would, so what is measured is what plays.
import { createEngine, createStore } from './engine.js';
import { SFX } from './synth.js';
import { PRESETS } from './presets.js';

const RAW = new Map();   // raw renders shared by every offline context (each still gets its own AudioBuffers)

export const AREAS = [...Object.keys(PRESETS), 'studio'];
export const SFX_NAMES = Object.keys(SFX);

export async function renderScene({ seconds = 20, sr = 44100, area = 'home', seed = 1, music = true, amb = true, sfx = true, events = [], lean = 'beats' } = {}) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(seconds * sr), sr);
  let clock = 0;
  const store = createStore(ctx, { sync: true, cacheRaw: RAW });
  store.loadAll();
  const e = createEngine(ctx, { store, seed, now: () => clock, lean });
  e.setMusicGain(music ? 1 : 0, 0, 0.001);
  e.setSfxGain(amb || sfx ? 1 : 0, 0);
  if (!amb) for (const n of ['city', 'wind', 'crickets', 'rain']) e.setLoop(n, 0, 0);
  if (area === 'studio') { e.setArea('home', 0); e.setArea('studio', 0); } else if (area) e.setArea(area, 0);
  const evs = [...events].sort((a, b) => a.t - b.t);
  const t0 = performance.now();
  for (clock = 0; clock < seconds; clock = +(clock + 0.1).toFixed(3)) {
    while (evs.length && evs[0].t <= clock) { const ev = evs.shift(); ev.fn(e, clock); }
    e.tick(clock);
  }
  const scheduleMs = performance.now() - t0;
  const t1 = performance.now();
  const buf = await (ctx.startRendering.length === 0 && typeof Promise !== 'undefined'
    ? new Promise((res, rej) => { ctx.oncomplete = (ev) => res(ev.renderedBuffer); const p = ctx.startRendering(); if (p && p.catch) p.catch(rej); })
    : ctx.startRendering());
  const renderMs = performance.now() - t1;
  return { buf, scheduleMs, renderMs, stats: e.stats() };
}

const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

export function analyse(buf, { from = 0, to = null, win = 0.4 } = {}) {
  const sr = buf.sampleRate, n0 = Math.floor(from * sr), n1 = Math.min(buf.length, Math.floor((to ?? buf.duration) * sr));
  const chs = []; for (let c = 0; c < buf.numberOfChannels; c++) chs.push(buf.getChannelData(c));
  let peak = 0, ss = 0, sum = 0, nan = 0, onset = -1;
  const wn = Math.max(1, Math.floor(win * sr)), wins = [];
  let ws = 0, wc = 0;
  for (let i = n0; i < n1; i++) {
    let fr = 0;
    for (const a of chs) {
      const v = a[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      const av = v < 0 ? -v : v;
      if (av > peak) peak = av;
      ss += v * v; sum += v; fr += v * v;
      if (onset < 0 && av > 0.001) onset = i / sr;
    }
    ws += fr / chs.length; wc++;
    if (wc === wn) { wins.push(Math.sqrt(ws / wc)); ws = 0; wc = 0; }
  }
  const cnt = (n1 - n0) * chs.length || 1;
  let silentRun = 0, longest = 0;
  for (const w of wins) { if (db(w) < -60) { silentRun++; if (silentRun > longest) longest = silentRun; } else silentRun = 0; }
  const wdb = wins.map(db);
  return {
    seconds: +((n1 - n0) / sr).toFixed(2), peakDb: +db(peak).toFixed(2), rmsDb: +db(Math.sqrt(ss / cnt)).toFixed(2),
    dc: +(sum / cnt).toExponential(2), nan, onset: +onset.toFixed(3),
    winMinDb: wdb.length ? +Math.min(...wdb).toFixed(1) : null, winMaxDb: wdb.length ? +Math.max(...wdb).toFixed(1) : null,
    longestSilence: +(longest * win).toFixed(2),
  };
}

// 16-bit PCM WAV, base64 (for the node script that writes preview files)
export function wavBase64(buf, maxSec = Infinity) {
  const sr = buf.sampleRate, ch = buf.numberOfChannels, n = Math.min(buf.length, Math.floor(maxSec * sr));
  const bytes = new Uint8Array(44 + n * ch * 2), dv = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); dv.setInt16(o, Math.round(v * 32767), true); o += 2; }
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// how long each sfx should be rendered (its buffer plus a little)
export function sfxSeconds(name) {
  return { train: 13.5, purr: 3.7, micPurr: 3.9, coffee: 3.3, chime: 4.0, needleDrop: 2.0, meow3: 1.5 }[name] || 1.6;
}

// ---------------------------------------------------------------- the suite
export async function runAll({ quick = false, log = () => {} } = {}) {
  const R = { presets: {}, ambience: {}, sfx: {}, scenes: {}, cpu: {}, errors: [] };
  const sec = quick ? 8 : 20;
  for (const a of AREAS) {
    const r = await renderScene({ area: a, seconds: sec, amb: false, seed: 3 });
    const m = a === 'morning' ? analyse(r.buf, { from: 1, to: 10 }) : analyse(r.buf, { from: 3 });
    m.full = analyse(r.buf);
    if (a === 'morning') m.tail = analyse(r.buf, { from: sec - 3 });
    m.renderMs = Math.round(r.renderMs); m.realtimeX = +(sec * 1000 / r.renderMs).toFixed(1);
    m.notes = r.stats.music.notes; m.maxActive = r.stats.music.maxActive; m.dropped = r.stats.music.dropped;
    R.presets[a] = m; log('preset ' + a + ' ' + JSON.stringify(m));
  }
  for (const a of AREAS) {
    const r = await renderScene({ area: a, seconds: quick ? 6 : 12, music: false, seed: 4 });
    R.ambience[a] = analyse(r.buf, { from: 3 }); log('amb ' + a);
  }
  for (const name of SFX_NAMES) {
    const s = sfxSeconds(name);
    const r = await renderScene({ area: null, seconds: s, music: false, amb: false, seed: 5, events: [{ t: 0.1, fn: (e, t) => e.play(name, { speed: 6 }, t) }] });
    R.sfx[name] = analyse(r.buf); log('sfx ' + name);
  }
  // loops on their own (float at full, rain at full)
  for (const [name, lvl] of [['float', 1], ['rain', 1]]) {
    const r = await renderScene({ area: null, seconds: 6, music: false, amb: false, events: [{ t: 0, fn: (e, t) => e.setLoop(name, lvl, t) }] });
    R.sfx['loop:' + name] = analyse(r.buf, { from: 2 });
  }
  // a tour with crossfades
  {
    const ev = [['street', 6], ['park', 13], ['alley', 20], ['hill', 27]].map(([a, t]) => ({ t, fn: (e, tt) => e.setArea(a, tt) }));
    const r = await renderScene({ area: 'home', seconds: 34, seed: 6, events: ev });
    R.scenes.tour = analyse(r.buf, { from: 3 });
  }
  // everything at once: street music, ambience, rain, and a pile of sfx and moments
  {
    const ev = [];
    const names = ['hop', 'land', 'sparkle', 'glimmer', 'meow1', 'meow3', 'chime', 'bump', 'poke', 'journalOpen', 'doubleHop', 'purr', 'train', 'coffee'];
    for (let i = 0; i < 60; i++) ev.push({ t: 2 + (i % 20) * 0.4, fn: (e, t) => e.play(names[i % names.length], { speed: 12, surface: 'metal' }, t) });
    ev.push({ t: 1, fn: (e, t) => e.setLoop('rain', 1, t) }, { t: 3, fn: (e, t) => e.moment('secret', t) }, { t: 5, fn: (e, t) => e.moment('goal', t) }, { t: 7, fn: (e, t) => e.moment('purr', t) });
    const r = await renderScene({ area: 'street', seconds: 14, seed: 7, events: ev });
    R.scenes.stress = { ...analyse(r.buf), sfx: r.stats.sfx };
  }
  // moments in a row, turntable transitions, keys
  {
    const ev = [['needle', 2], ['scratch', 9], ['secret', 13], ['purr', 15]].map(([m, t]) => ({ t, fn: (e, tt) => e.moment(m, tt) }));
    for (let k = 0; k < 16; k++) ev.push({ t: 17 + k * 0.18, fn: (e, t) => e.playKey(k, 0.5, t) });
    ev.push({ t: 21, fn: (e, t) => e.play('micPurr', {}, t) });
    const r = await renderScene({ area: 'home', seconds: 26, seed: 8, events: ev });
    R.scenes.moments = { ...analyse(r.buf, { from: 1 }), keys: analyse(r.buf, { from: 17, to: 20.5 }), notes: r.stats.music.notes };
  }
  if (!quick) {
    // long run: ten minutes, area changes every 30 s, sfx sprinkled
    const order = ['home', 'rooftops', 'street', 'party', 'park', 'hill', 'interiors', 'alley', 'studio', 'morning'];
    const ev = [];
    for (let i = 0; i < 20; i++) ev.push({ t: i * 30, fn: (e, t) => e.setArea(order[i % order.length], t) });
    for (let t = 1; t < 600; t += 0.7) ev.push({ t, fn: (e, tt) => e.play(['hop', 'land', 'step', 'sparkle', 'tap'][Math.floor(t) % 5], { surface: 'roof' }, tt) });
    const r = await renderScene({ area: 'home', seconds: 600, sr: 44100, seed: 9, events: ev });
    R.scenes.long = { ...analyse(r.buf), renderMs: Math.round(r.renderMs), scheduleMs: Math.round(r.scheduleMs), realtimeX: +(600000 / r.renderMs).toFixed(1), music: r.stats.music, sfx: r.stats.sfx };
  }
  return R;
}
