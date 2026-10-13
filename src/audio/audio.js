// audio.js: the game's one entry point for sound. See src/audio/README.md.
//
//   import { createAudio } from './audio/audio.js';
//   const audio = createAudio({ musicLean: CONFIG.musicLean });
//   // in every pointer/touch/key handler (cheap, idempotent): audio.unlock();
//   audio.setArea('rooftops'); audio.play('hop'); audio.update(dt, speed, grounded, fallSpeed, 'roof', floating);
//
// Nothing is created until unlock() runs inside a user gesture. No method ever throws.
import { createEngine, createStore, resolveArea } from './engine.js';
import { clamp } from './dsp.js';

const MODES = ['off', 'sfx', 'music', 'all'];

export function createAudio(config = {}) {
  const opts = {
    storageKey: 'ghostcat3d.audio', startArea: 'home', stepStride: 0.3, stepMinGap: 0.1, maxSfx: 14, maxMusic: 28,
    ...config,
  };
  opts.lean = config.musicLean || (config.audio && config.audio.musicLean) || 'beats';
  const win = typeof window !== 'undefined' ? window : null, doc = typeof document !== 'undefined' ? document : null;

  let ctx = null, engine = null, store = null, destroyed = false, timer = 0, silentDone = false;
  let area = resolveArea(opts.startArea) || 'home';
  let mute = 'off', musicV = 1, sfxV = 1;
  let lastTime = -1, lastTimeAt = 0, stalled = false, troubleSince = 0;
  const tickStats = { n: 0, ms: 0, max: 0 };
  let warned = false;
  const warn = (where, e) => { if (!warned && win && win.console) { warned = true; console.warn('[audio] ' + where + ':', e && e.message || e); } };
  const safe = (where, fn) => (...a) => { try { return fn(...a); } catch (e) { warn(where, e); return undefined; } };

  // ---- persisted settings
  try {
    const s = JSON.parse(localStorage.getItem(opts.storageKey) || 'null');
    if (s) { if (MODES.includes(s.mute)) mute = s.mute; if (s.music >= 0 && s.music <= 1) musicV = s.music; if (s.sfx >= 0 && s.sfx <= 1) sfxV = s.sfx; }
  } catch (e) { /* private mode: defaults */ }
  const save = () => { try { localStorage.setItem(opts.storageKey, JSON.stringify({ mute, music: musicV, sfx: sfxV })); } catch (e) { /* ignore */ } };

  const musicOn = () => mute !== 'all' && mute !== 'music' && musicV > 0.001;
  const sfxOn = () => mute !== 'all' && mute !== 'sfx' && sfxV > 0.001;
  const wantRunning = () => !destroyed && !!ctx && !(doc && doc.hidden) && mute !== 'all';

  function applyMix() {
    if (!engine) return;
    const t = ctx.currentTime;
    engine.setMusicGain(musicOn() ? musicV * musicV : 0, t);
    engine.setSfxGain(sfxOn() ? sfxV * sfxV : 0, t);
    engine.setMusicPaused(!musicOn());
  }

  function resume() {
    if (!ctx || !wantRunning() || ctx.state === 'running' || ctx.state === 'closed') return;
    try { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* not allowed yet */ }
  }
  function suspend() {
    if (!ctx || ctx.state !== 'running') return;
    try { const p = ctx.suspend(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  }

  function build() {
    const AC = win && (win.AudioContext || win.webkitAudioContext);
    if (!AC) return false;
    // 'ambient': respect the silent switch and mix with whatever else is playing (iOS 17+ Safari; ignored elsewhere)
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) { /* ignore */ }
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    ctx.onstatechange = onState;
    if (!store) { store = createStore(ctx, {}); store.loadAll(); }
    engine = createEngine(ctx, { store, lean: opts.lean, maxSfx: opts.maxSfx, maxMusic: opts.maxMusic });
    applyMix();
    if (mute === 'all') engine.setMasterGain(0, ctx.currentTime, 0.01);
    engine.setArea(area, ctx.currentTime);
    lastTime = -1; stalled = false; troubleSince = 0;
    if (!timer) timer = setInterval(onTimer, 100);
    return true;
  }

  // iOS: a call, Siri or an alarm leaves the context 'interrupted'; backgrounding leaves it 'suspended'.
  // We retry resume() on visibility/focus and on every gesture; if it stays dead, the next gesture rebuilds it.
  function onState() {
    if (!ctx) return;
    if (ctx.state === 'running') { troubleSince = 0; return; }
    if (!troubleSince) troubleSince = performance.now();
    if (wantRunning()) resume();
  }

  // the classic iOS unlock: start a one-sample silent buffer inside the gesture. Repeated on any gesture that finds the
  // context not running (the first touch may be a touchstart, which some iOS versions do not count as a gesture)
  function kick() {
    if (!ctx || ctx.state === 'closed') return;
    try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); silentDone = true; } catch (e) { /* ignore */ }
  }

  function rebuild() {
    try { engine && engine.dispose(); } catch (e) { /* ignore */ }
    try { ctx && ctx.close && ctx.close().catch(() => {}); } catch (e) { /* ignore */ }
    ctx = null; engine = null; silentDone = false;
    build();
  }

  function onTimer() {
    if (!ctx || destroyed) return;
    const t0 = performance.now();
    if (ctx.state === 'running') {
      const t = ctx.currentTime;
      if (t !== lastTime) { lastTime = t; lastTimeAt = t0; stalled = false; }
      else if (t0 - lastTimeAt > 1500 && !(doc && doc.hidden)) stalled = true;   // "running" but the clock is frozen (an iOS bug)
      try { engine.tick(t); } catch (e) { warn('tick', e); }
    } else { lastTime = -1; lastTimeAt = t0; }   // suspended (put away, muted): the stall clock starts again on resume
    const ms = performance.now() - t0;
    tickStats.n++; tickStats.ms += ms; if (ms > tickStats.max) tickStats.max = ms;
  }

  function onGesture() {
    if (!ctx || destroyed || !wantRunning()) return;
    const troubled = ctx.state !== 'running' && troubleSince && performance.now() - troubleSince > 3000;
    if (stalled || troubled || ctx.state === 'closed') rebuild();
    resume();
    if (ctx && ctx.state !== 'running') kick();
  }
  function onVisibility() {
    if (!ctx) return;
    if (doc.hidden) suspend();
    else { if (ctx.state !== 'running') troubleSince = performance.now(); resume(); }   // trouble counts from coming back, not from our own suspend
  }
  const listeners = [
    ['touchstart', onGesture], ['pointerdown', onGesture], ['pointerup', onGesture], ['touchend', onGesture], ['click', onGesture], ['keydown', onGesture],
    ['focus', onVisibility], ['pageshow', onVisibility], ['pagehide', () => suspend()],
  ];
  let listening = false;
  function listen(on) {
    if (!win || on === listening) return;
    listening = on;
    for (const [ev, fn] of listeners) (on ? win.addEventListener : win.removeEventListener).call(win, ev, fn, { capture: true, passive: true });
    if (doc) (on ? doc.addEventListener : doc.removeEventListener).call(doc, 'visibilitychange', onVisibility);
  }

  // ---- footsteps and the float whoosh, driven from the game loop (no allocations)
  let stepAcc = 0, lastStepAt = -1, floatSent = -1;

  const api = {
    unlock: safe('unlock', () => {
      if (destroyed) return false;
      if (!ctx && !build()) return false;
      listen(true);
      if (mute !== 'all') resume();
      if (!silentDone || ctx.state !== 'running') kick();
      return ctx.state === 'running';
    }),
    setArea: safe('setArea', (name) => {
      const a = resolveArea(name);
      if (!a) { warn('setArea', new Error('unknown area ' + name)); return false; }
      if (a !== 'studio') area = a;
      if (engine) engine.setArea(a, ctx.currentTime);
      return true;
    }),
    play: safe('play', (name, params) => {
      if (!engine || !sfxOn() || ctx.state !== 'running') return false;
      if (name === 'micPurr') return engine.play('micPurr', params, ctx.currentTime);
      return engine.play(name, params, ctx.currentTime);
    }),
    // continuous sounds: 'float' 0..1 (the game can also use update()), 'rain' 0..1, 'wind'/'city'/'crickets' multipliers (default 1)
    setLoop: safe('setLoop', (name, level) => { if (engine) engine.setLoop(name, level, ctx.currentTime); }),
    update: safe('update', (dt, speed, grounded, fallSpeed, surface, floating) => {
      if (!engine || ctx.state !== 'running' || !sfxOn()) return;
      const t = ctx.currentTime;
      if (grounded && speed > 0.25) {
        stepAcc += speed * dt;
        if (stepAcc >= opts.stepStride && t - lastStepAt > opts.stepMinGap) { stepAcc = 0; lastStepAt = t; engine.play('step', surfaceParams(surface, speed), t); }
      } else stepAcc = opts.stepStride * 0.7;
      const fall = Math.max(0, fallSpeed || 0);
      const amt = grounded ? 0 : clamp((floating ? 0.18 : 0) + (fall - 0.6) / 7, 0, 1);
      if (Math.abs(amt - floatSent) > 0.03 || (amt === 0 && floatSent !== 0)) { floatSent = amt; engine.setLoop('float', amt, t); }
    }),
    setMute: safe('setMute', (mode) => {
      if (mode === true) mode = 'all'; if (mode === false || mode == null) mode = 'off';
      if (!MODES.includes(mode)) return mute;
      mute = mode; save();
      if (engine) {
        applyMix();
        if (mode === 'all') { engine.setMasterGain(0, ctx.currentTime, 0.05); setTimeout(() => { if (mute === 'all') suspend(); }, 300); }
        else { engine.setMasterGain(1, ctx.currentTime, 0.05); if (ctx.state !== 'running') troubleSince = performance.now(); resume(); }
      }
      return mute;
    }),
    getMute: () => mute,
    setMusicVolume: safe('setMusicVolume', (v) => { musicV = clamp(+v || 0, 0, 1); save(); applyMix(); }),
    setSfxVolume: safe('setSfxVolume', (v) => { sfxV = clamp(+v || 0, 0, 1); save(); applyMix(); }),
    get musicVolume() { return musicV; },
    get sfxVolume() { return sfxV; },
    moment: safe('moment', (name) => {
      if (!engine || ctx.state !== 'running' || mute === 'all') return false;
      return engine.moment(name, ctx.currentTime);
    }),
    // music corner: a key of the MIDI keyboard (any integer), in tune with whatever is playing
    playKey: safe('playKey', (index, velocity) => {
      if (!engine || ctx.state !== 'running' || !musicOn()) return false;
      return engine.playKey(index, velocity, ctx.currentTime);
    }),
    // music corner: Ghost purrs into the mic (params: { squeal: false } for the clean take, volume, pan)
    micPurr: safe('micPurr', (params) => {
      if (!engine || ctx.state !== 'running' || !sfxOn()) return false;
      return engine.play('micPurr', params, ctx.currentTime);
    }),
    get state() {
      return {
        ctx: ctx ? ctx.state : 'none', unlocked: !!ctx, area: engine ? engine.area : area, mute, music: musicV, sfx: sfxV,
        sampleRate: ctx && ctx.sampleRate, baseLatency: ctx && ctx.baseLatency, outputLatency: ctx && ctx.outputLatency, stalled,
      };
    },
    stats: safe('stats', () => ({ ...api.state, tick: { n: tickStats.n, avgMs: +(tickStats.ms / (tickStats.n || 1)).toFixed(3), maxMs: +tickStats.max.toFixed(2) }, ...(engine ? engine.stats() : {}) })),
    destroy: safe('destroy', () => {
      destroyed = true; listen(false);
      if (timer) clearInterval(timer); timer = 0;
      try { engine && engine.dispose(); } catch (e) { /* ignore */ }
      try { store && store.dispose(); } catch (e) { /* ignore */ }
      try { ctx && ctx.close && ctx.close().catch(() => {}); } catch (e) { /* ignore */ }
      ctx = null; engine = null; store = null;
    }),
    get _engine() { return engine; },
    get _ctx() { return ctx; },   // tests only (tests/lifecycle.mjs)
  };
  return api;
}

const SURF = {};
function surfaceParams(surface, speed) {
  const k = surface || 'soft';
  const p = SURF[k] || (SURF[k] = { surface: k, speed: 0 });
  p.speed = clamp(speed / 3.8, 0, 1);
  return p;
}
