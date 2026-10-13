// engine.js: builds the whole audio graph on any BaseAudioContext (live or offline) and runs it.
// audio.js wraps this for the game (unlock, iOS, mute); tests drive it directly on an OfflineAudioContext.
//
//   instruments -> musicSum -> tape wobble (modulated delay) -> hp -> lp -> areaGain -> duck -> stop -> studio -> musicVol -+
//   reverb sends -> convolver ----^                                                       moments, keys ---> musicVol   |
//   sfx (5 pan buses), float loop -> sfxBus --------------------------------------------------------------> sfxVol  ---+-> master
//   ambience loops -> ambLP ----------------------------------------------------------------------------> sfxVol      |
//   master -> highpass 22 Hz -> compressor (gentle) -> soft clip (never above -1.4 dBFS) -> destination  <-------------+
import { PRESETS, AREA_ALIASES } from './presets.js';
import { SFX, PIANO_ROOTS, renderKey, allKeys } from './synth.js';
import { createMusic } from './music.js';
import { rng, clamp } from './dsp.js';

// ------------------------------------------------------------------ buffer store
export function createStore(ctx, { sync = false, cacheRaw = null, worker = true } = {}) {
  const bufs = new Map(), pending = new Set();
  let w = null, onAll = null, total = 0;
  const stats = { rendered: 0, bytes: 0, via: sync ? 'sync' : 'none', ms: 0, firstMs: 0 };
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;

  function put(key, sr, ch) {
    let b;
    try { b = ctx.createBuffer(ch.length, ch[0].length, sr); }
    catch (e) { // very old WebKit: only some rates allowed; resample linearly to the context's rate
      const k = ctx.sampleRate / sr, n = Math.floor(ch[0].length * k);
      b = ctx.createBuffer(ch.length, n, ctx.sampleRate);
      ch = ch.map((a) => { const o = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / k, j = Math.floor(x), f = x - j; o[i] = (a[j] || 0) * (1 - f) + (a[j + 1] || 0) * f; } return o; });
    }
    for (let c = 0; c < ch.length; c++) b.getChannelData(c).set(ch[c]);
    bufs.set(key, b); pending.delete(key);
    stats.rendered++; stats.bytes += ch.reduce((s, a) => s + a.byteLength, 0);
    if (stats.rendered === 1) stats.firstMs = Math.round(performance.now() - t0);
    if (!pending.size && onAll) { stats.ms = Math.round(performance.now() - t0); const f = onAll; onAll = null; f(); }
  }
  function renderNow(key) {
    let r = cacheRaw && cacheRaw.get(key);
    if (!r) { r = renderKey(key); if (cacheRaw) cacheRaw.set(key, r); }
    put(key, r.sr, r.ch);
  }
  function get(key) {
    const b = bufs.get(key);
    if (b) return b;
    if (sync) { try { renderNow(key); } catch (e) { return null; } return bufs.get(key) || null; }
    return null;
  }
  // main-thread fallback: one buffer per slice so a frame never waits long
  function slices(keys) {
    stats.via = 'slices';
    const next = () => {
      while (keys.length && bufs.has(keys[0])) keys.shift();
      if (!keys.length) return;
      try { renderNow(keys.shift()); } catch (e) { /* skip */ }
      setTimeout(next, 8);
    };
    setTimeout(next, 0);
  }
  function loadAll(done) {
    const keys = allKeys(ctx.sampleRate).filter((k) => !bufs.has(k));
    total = keys.length;
    for (const k of keys) pending.add(k);
    onAll = done || null;
    if (sync) { for (const k of keys) renderNow(k); return; }
    if (worker && typeof Worker !== 'undefined') {
      try {
        w = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
        stats.via = 'worker';
        w.onmessage = (e) => {
          const d = e.data;
          if (d.done) { w.terminate(); w = null; if (pending.size) slices([...pending]); return; }
          if (d.error) return;
          if (!bufs.has(d.key)) put(d.key, d.sr, d.ch);
        };
        w.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); if (w) { w.terminate(); w = null; } slices([...pending]); };
        w.postMessage({ keys });
        return;
      } catch (e) { w = null; }
    }
    slices(keys);
  }
  // urgent single buffer (a sound asked for before the loader reached it)
  function want(key) { if (bufs.has(key)) return; if (!w) { try { renderNow(key); } catch (e) { /* ignore */ } } }
  return { get, has: (k) => bufs.has(k), loadAll, want, stats, get total() { return total; }, get pending() { return pending.size; }, dispose() { if (w) w.terminate(); w = null; bufs.clear(); } };
}

// ------------------------------------------------------------------ engine
const LOOP_BASE = { wind: 0.2, city: 0.26, rain: 0.2, crickets: 0.12, hiss: 0.045, float: 0.5 };
const PANS = [-0.8, -0.4, 0, 0.4, 0.8];

export function resolveArea(name) {
  const n = String(name || '').toLowerCase();
  if (n === 'studio') return 'studio';
  return PRESETS[n] ? n : AREA_ALIASES[n] || null;
}

export function createEngine(ctx, opts = {}) {
  const now = opts.now || (() => ctx.currentTime);
  const rnd = rng(opts.seed != null ? opts.seed : (Date.now() ^ 0x5eed) >>> 0);
  const store = opts.store || createStore(ctx, opts);
  const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const F = (type, f, q = 0.707) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const fakeParam = () => ({ value: 0, setTargetAtTime() {}, cancelScheduledValues() {}, setValueAtTime() {} });
  const Pan = (p = 0) => {
    if (ctx.createStereoPanner) { const s = ctx.createStereoPanner(); s.pan.value = p; return s; }
    const g = G(); g.pan = fakeParam(); return g;
  };
  const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
  const live = [];   // oscillators/sources to stop on dispose

  // ---- master
  const master = G(1), hpM = F('highpass', 22), comp = ctx.createDynamicsCompressor(), clip = ctx.createWaveShaper();
  comp.threshold.value = -20; comp.knee.value = 12; comp.ratio.value = 2.5; comp.attack.value = 0.008; comp.release.value = 0.25;
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) { const x = (i / 1024) - 1, ax = Math.abs(x), y = ax < 0.6 ? ax : 0.6 + 0.26 * Math.tanh((ax - 0.6) / 0.26); curve[i] = Math.sign(x) * y; }
  clip.curve = curve; clip.oversample = 'none';
  master.connect(hpM); hpM.connect(comp); comp.connect(clip); clip.connect(ctx.destination);
  const musicVol = G(1), sfxVol = G(1);
  musicVol.connect(master); sfxVol.connect(master);

  // ---- music chain
  const N = {};
  const musicSum = G(1);
  N.wobbleBase = 0.012;
  N.wobble = ctx.createDelay(1.0); N.wobble.delayTime.value = N.wobbleBase;
  N.wobbleDepth = G(0.0011); N.flutterDepth = G(0.00006);
  const lfoW = osc('sine', 0.43), lfoF = osc('sine', 5.7);
  lfoW.connect(N.wobbleDepth); N.wobbleDepth.connect(N.wobble.delayTime);
  lfoF.connect(N.flutterDepth); N.flutterDepth.connect(N.wobble.delayTime);
  N.hp = F('highpass', 30); N.lp = F('lowpass', 5200, 0.6);
  N.areaGain = G(0); N.duck = G(1); N.stopGain = G(1); N.studio = G(1);
  musicSum.connect(N.wobble); N.wobble.connect(N.hp); N.hp.connect(N.lp); N.lp.connect(N.areaGain);
  N.areaGain.connect(N.duck); N.duck.connect(N.stopGain); N.stopGain.connect(N.studio); N.studio.connect(musicVol);

  // reverb (one convolver, music only; sfx carry small baked rooms)
  const conv = ctx.createConvolver(); conv.normalize = false;
  const convIn = G(1), wet = G(1);
  N.reverbSend = G(0.35);
  N.reverbSend.connect(convIn); convIn.connect(conv); conv.connect(wet); wet.connect(musicSum);
  let irSet = false;
  const send = (from, amt) => { const g = G(amt); from.connect(g); g.connect(N.reverbSend); return g; };

  // piano: three pan positions by register
  N.pianoBus = G(0.9); N.pianoBus.connect(musicSum); send(N.pianoBus, 1);
  N.panL = Pan(-0.3); N.panM = Pan(0); N.panH = Pan(0.3);
  for (const p of [N.panL, N.panM, N.panH]) p.connect(N.pianoBus);
  N.pianoL = N.panL; N.pianoM = N.panM; N.pianoH = N.panH;
  // Rhodes: auto-pan and a soft top end
  N.ep = G(1); const epPan = Pan(0), epLP = F('lowpass', 3800, 0.5);
  N.epPanDepth = G(0.3); const lfoE = osc('sine', 4.1); lfoE.connect(N.epPanDepth); N.epPanDepth.connect(epPan.pan || fakeParam());
  N.epBus = G(0); N.ep.connect(epPan); epPan.connect(epLP); epLP.connect(N.epBus); N.epBus.connect(musicSum); send(N.epBus, 0.8);
  // music box
  N.boxBus = G(0); N.boxPanL = Pan(-0.4); N.boxPanR = Pan(0.4);
  N.boxL = N.boxPanL; N.boxR = N.boxPanR; N.boxPanL.connect(N.boxBus); N.boxPanR.connect(N.boxBus);
  N.boxBus.connect(musicSum); send(N.boxBus, 1.3);
  // pad: filter with a slow sweep, then a stereo chorus
  N.padIn = G(1); N.padLP = F('lowpass', 1400, 0.8);
  const padLfo = osc('sine', 0.07), padLfoG = G(260); padLfo.connect(padLfoG); padLfoG.connect(N.padLP.frequency);
  N.padBus = G(0.5);
  N.padIn.connect(N.padLP); N.padLP.connect(N.padBus);
  const dL = ctx.createDelay(0.1), dR = ctx.createDelay(0.1), merger = ctx.createChannelMerger(2), chG = G(0.75);
  dL.delayTime.value = 0.018; dR.delayTime.value = 0.025;
  const cl1 = osc('sine', 0.31), cl2 = osc('sine', 0.23), cg1 = G(0.003), cg2 = G(0.0035);
  cl1.connect(cg1); cg1.connect(dL.delayTime); cl2.connect(cg2); cg2.connect(dR.delayTime);
  N.padLP.connect(dL); N.padLP.connect(dR); dL.connect(merger, 0, 0); dR.connect(merger, 0, 1); merger.connect(chG); chG.connect(N.padBus);
  N.padBus.connect(musicSum); send(N.padBus, 1);
  // pad wave: soft saw (1/n with a gentle roll-off), sub wave: sine plus a little 2nd harmonic
  const H = 24, re = new Float32Array(H + 1), im = new Float32Array(H + 1);
  for (let n = 1; n <= H; n++) im[n] = (1 / n) * Math.exp(-n / 7);
  N.padWave = ctx.createPeriodicWave(re, im);
  N.subWave = ctx.createPeriodicWave(new Float32Array([0, 0, 0]), new Float32Array([0, 1, 0.22]));
  N.sub = G(1); const subLP = F('lowpass', 170, 0.7); N.subBus = G(0.4);
  N.sub.connect(subLP); subLP.connect(N.subBus); N.subBus.connect(musicSum);
  // drums: dusty lowpass, hats a touch right
  N.kick = G(0.6); N.back = G(0.85); const hatPan = Pan(0.18); N.hat = G(0.8);
  const drumLP = F('lowpass', 7000, 0.6); N.drumBus = G(0);
  N.kick.connect(drumLP); N.back.connect(drumLP); N.hat.connect(hatPan); hatPan.connect(drumLP); drumLP.connect(N.drumBus);
  N.drumBus.connect(musicSum); send(N.drumBus, 0.22);
  // crackle (skips the reverb and the wobble)
  N.crackleBoost = G(1); N.crackle = G(0.04); N.crackleBoost.connect(N.crackle); N.crackle.connect(N.hp);
  let crackleSrc = null;
  // moments and the music corner's keys: clear, after the area filter
  N.moment = G(0.9); N.moment.connect(musicVol); send(N.moment, 0.35);
  N.keys = G(0.85); N.keys.connect(musicVol); send(N.keys, 0.4);

  for (const o of [lfoW, lfoF, lfoE, padLfo, cl1, cl2]) { o.start(0); live.push(o); }

  // ---- sfx and ambience
  const sfxBus = G(1); sfxBus.connect(sfxVol);
  const panBus = PANS.map((p) => { const s = Pan(p); s.connect(sfxBus); return s; });
  const ambLP = F('lowpass', 16000, 0.6), ambGain = G(1);
  ambLP.connect(ambGain); ambGain.connect(sfxVol);
  const floatBP = F('bandpass', 600, 0.7), floatOut = G(1); floatBP.connect(floatOut); floatOut.connect(sfxBus);

  const loops = {};
  for (const name of Object.keys(LOOP_BASE)) {
    const g = G(0);
    g.connect(name === 'float' ? floatBP : ambLP);
    loops[name] = { g, src: null, stopAt: 0, target: 0 };
  }
  const amb = { city: 0, wind: 0, crickets: 0, rainMul: 1 };
  const weather = { rain: 0, wind: 1, city: 1, crickets: 1 };
  let floatAmt = 0, studio = false;

  function loopTarget(name) {
    if (name === 'float') return floatAmt;
    if (name === 'hiss') return studio ? 1 : 0;
    if (name === 'rain') return weather.rain * amb.rainMul;
    return (amb[name] || 0) * weather[name];
  }
  function refreshLoop(name, t, tau) {
    const L = loops[name], target = loopTarget(name) * LOOP_BASE[name];
    L.target = target;
    if (target > 0.0005) {
      if (!L.src) {
        const buf = store.get('loop:' + name);
        if (!buf) { store.want('loop:' + name); return; }
        const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.connect(L.g);
        s.start(t, rnd() * buf.duration * 0.9); L.src = s;
        L.g.gain.cancelScheduledValues(t); L.g.gain.setValueAtTime(0, t);
      }
      L.stopAt = Infinity;
      L.g.gain.cancelScheduledValues(t); L.g.gain.setTargetAtTime(target, t, tau);
    } else if (L.src) {
      L.g.gain.cancelScheduledValues(t); L.g.gain.setTargetAtTime(0, t, tau);
      L.stopAt = t + tau * 7 + 0.1;
    }
  }

  // ---- sfx voices
  const maxSfx = opts.maxSfx || 14;
  const voices = []; for (let i = 0; i < maxSfx; i++) voices.push({ end: 0, prio: 0, src: null, g: null });
  const lastT = {}, lastV = {};
  const sstats = { played: 0, dropped: 0, stolen: 0, missing: 0 };
  const JITTER = { hop: 1, doubleHop: 1, land: 1, bump: 1, poke: 1, moth: 1, coffee: 0, train: 0 };

  function startVoice(buf, prio, t, vol, rate, pan, dur) {
    let slot = null, worst = null;
    for (const v of voices) {
      if (v.end <= t) { slot = v; break; }
      if (!worst || v.prio < worst.prio || (v.prio === worst.prio && v.end < worst.end)) worst = v;
    }
    if (!slot) {
      if (worst.prio > prio) { sstats.dropped++; return false; }
      try { worst.g.gain.cancelScheduledValues(t); worst.g.gain.setTargetAtTime(0, t, 0.012); worst.src.stop(t + 0.07); } catch (e) { /* already stopped */ }
      sstats.stolen++; slot = worst;
    }
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = buf; src.playbackRate.value = rate; g.gain.value = vol;
    src.connect(g); g.connect(panBus[Math.round((clamp(pan || 0, -1, 1) + 1) * 2)]);
    let end = t + buf.duration / rate;
    src.start(t);
    if (dur && dur < end - t) { g.gain.setValueAtTime(vol, t + dur); g.gain.setTargetAtTime(0, t + dur, 0.12); end = t + dur + 0.6; src.stop(end); }
    slot.end = end; slot.prio = prio; slot.src = src; slot.g = g;
    sstats.played++;
    return true;
  }

  function play(name, p, t = now()) {
    p = p || {};
    let n = name;
    if (n === 'step' || n === 'footstep') n = 'step_' + (p.surface || 'soft');
    else if (n === 'meow') n = 'meow' + ({ kitten: 1, trill: 2, elder: 3 }[p.cat] || clamp(Math.round(+p.cat || 1), 1, 3));
    else if (n === 'land' && p.surface && p.surface !== 'soft') play('step', { surface: p.surface, speed: 1, volume: 0.9 * (p.volume ?? 1) }, t);
    if (n.startsWith('step_') && !SFX[n]) n = 'step_soft';
    const def = SFX[n];
    if (!def) return false;
    if (lastT[n] != null && t - lastT[n] < def.gap) return false;
    let v = 0;
    if (n === 'micPurr') v = p.squeal === false ? 1 : 0;
    else if (def.variants > 1) { v = Math.floor(rnd() * def.variants); if (v === lastV[n]) v = (v + 1) % def.variants; }
    const key = `sfx:${n}:${v}`, buf = store.get(key);
    if (!buf) { sstats.missing++; store.want(key); return false; }
    lastT[n] = t; lastV[n] = v;
    let vol = def.gain * (p.volume ?? 1), rate = p.pitch ?? 1;
    if (JITTER[n] || n.startsWith('step_')) rate *= 1 + (rnd() - 0.5) * 0.07;
    if (n.startsWith('step_')) vol *= 0.55 + 0.45 * clamp(p.speed ?? 0.7, 0, 1);
    if (n === 'land') { const s = clamp(p.speed ?? 4, 0, 14); vol *= clamp(0.45 + s / 10, 0.45, 1.15); rate *= 1.05 - s * 0.012; }
    if (n === 'bump') vol *= clamp(0.5 + (p.speed ?? 3) / 8, 0.5, 1.1);
    return startVoice(buf, def.prio, t, vol, rate, p.pan, p.duration);
  }

  function setLoop(name, level, t = now()) {
    level = clamp(+level || 0, 0, 2);
    if (name === 'float') {
      if (Math.abs(level - floatAmt) < 0.02 && !(level === 0 && floatAmt > 0)) return;
      floatAmt = clamp(level, 0, 1);
      floatBP.frequency.setTargetAtTime(450 + floatAmt * 1700, t, 0.1);
      refreshLoop('float', t, 0.12);
      return;
    }
    if (!(name in weather)) return;
    weather[name] = level;
    refreshLoop(name, t, 1.5);
  }

  // ---- music
  const music = createMusic(ctx, { store, rnd, nodes: N, now, lean: opts.lean, maxVoices: opts.maxMusic || 28 });
  let area = null, musicWanted = null;
  const pianoReady = () => PIANO_ROOTS.every((r) => store.has('piano:' + r));
  let createdAt = now();

  function setArea(name, t = now()) {
    const a = resolveArea(name);
    if (!a) return false;
    if (a === 'studio') {
      studio = true;
      N.studio.gain.cancelScheduledValues(t); N.studio.gain.setTargetAtTime(0.72, t, 0.8);
      refreshLoop('hiss', t, 1);
      if (!area) { area = 'home'; musicWanted = 'home'; applyAmb(PRESETS.home, t); }
      return true;
    }
    if (studio) { studio = false; N.studio.gain.cancelScheduledValues(t); N.studio.gain.setTargetAtTime(1, t, 0.8); refreshLoop('hiss', t, 0.8); }
    area = a; musicWanted = a;
    applyAmb(PRESETS[a], t);
    if (pianoReady() || t - createdAt > 4) { music.setArea(a, t); musicWanted = null; }
    return true;
  }
  function applyAmb(p, t) {
    const A = p.amb || {};
    amb.city = A.city || 0; amb.wind = A.wind || 0; amb.crickets = A.crickets || 0; amb.rainMul = A.rainMul ?? 1;
    ambLP.frequency.cancelScheduledValues(t); ambLP.frequency.setTargetAtTime(A.lp || 16000, t, 1.2);
    for (const n of ['city', 'wind', 'crickets', 'rain']) refreshLoop(n, t, 1.6);
  }

  function moment(name, t = now()) {
    if (name === 'needle') play('needleDrop', {}, t);
    if (name === 'scratch') play('scratch', {}, t);
    if (name === 'purr') play('purr', { volume: 0.55, duration: 3.2 }, t);
    if (name === 'micPurr') return play('micPurr', {}, t);
    return music.moment(name, t);
  }

  function tick(t = now()) {
    if (musicWanted && (pianoReady() || t - createdAt > 4)) { music.setArea(musicWanted, t); musicWanted = null; }
    music.tick(t + (opts.lookahead || 0.35));
    if (!irSet) { const ir = store.get('ir:' + ctx.sampleRate); if (ir) { conv.buffer = ir; irSet = true; } }
    if (!crackleSrc) {
      const cb = store.get('crackle');
      if (cb) { crackleSrc = ctx.createBufferSource(); crackleSrc.buffer = cb; crackleSrc.loop = true; crackleSrc.connect(N.crackleBoost); crackleSrc.start(t); live.push(crackleSrc); }
    }
    for (const name in loops) {
      const L = loops[name];
      if (L.src && L.stopAt < t) { try { L.src.stop(t); L.src.disconnect(); } catch (e) { /* fine */ } L.src = null; }
      else if (!L.src && L.target > 0.0005) refreshLoop(name, t, 0.8);
    }
  }

  const ramp = (g, v, t, tau = 0.08) => { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(v, t, tau); };
  function dispose() {
    for (const o of live) { try { o.stop(); } catch (e) { /* fine */ } }
    for (const n in loops) { const L = loops[n]; if (L.src) { try { L.src.stop(); } catch (e) { /* fine */ } } }
    try { master.disconnect(); } catch (e) { /* fine */ }
  }

  return {
    ctx, store, music, nodes: N, setArea, play, setLoop, moment, tick, dispose,
    playKey: (i, vel, t = now()) => music.playKey(i, t, vel),
    setMusicGain: (v, t = now()) => ramp(musicVol, v, t),
    setSfxGain: (v, t = now()) => ramp(sfxVol, v, t),
    setMasterGain: (v, t = now(), tau = 0.08) => ramp(master, v, t, tau),
    setMusicPaused: (p) => music.setPaused(p),
    get area() { return studio ? 'studio' : area; },
    stats() {
      const t = now();
      return { area: studio ? 'studio' : area, music: { ...music.stats, ...music.state }, sfx: { ...sstats, active: voices.filter((v) => v.end > t).length },
        loops: Object.fromEntries(Object.entries(loops).filter(([, L]) => L.src).map(([k, L]) => [k, +L.target.toFixed(3)])),
        buffers: { ...store.stats, total: store.total, pending: store.pending } };
    },
  };
}
