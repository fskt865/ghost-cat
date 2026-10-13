// Save: localStorage, versioned, validated on load, autosaved on every change (debounced) and on pagehide.
// Storage may throw (blocked, private mode on old iOS), be full, or hold an old, newer or broken save: the game then
// plays on from memory and says nothing. A broken or newer save is copied aside (key + '.bad' / '.v<N>') before
// anything is written over it; an older one is migrated step by step (MIGRATIONS) and keeps its journal.
// Persistent: night number, glimmers, journal (found + seen), decorations, places seen, lifetime stats.
// Per night (reset when Ghost sleeps): switches, tap counts, what was poked, what was found tonight,
// knocked-over things.
import { CONFIG } from './config.js';
import { ENTRIES, THINGS, NIGHT_DEFAULTS } from './things.js';
import { HOME_ENTRIES, HOME_THINGS } from './home-things.js';

export const SAVE_VERSION = 1;
const ENTRY_IDS = new Set([...ENTRIES, ...HOME_ENTRIES].map((e) => e.id));
const THING_IDS = new Set([...THINGS, ...HOME_THINGS].map((t) => t.id));

export function freshNight() {
  return { ...NIGHT_DEFAULTS, taps: {}, poked: {}, lines: {}, found: [], knocked: {}, mugEdge: 0, pictureStraight: 0 };
}

export function freshSave() {
  return { v: SAVE_VERSION, night: 1, glimmers: 0, found: {}, seen: {}, decorations: [], places: {}, firsts: {}, flags: {}, stats: { pokes: 0, nights: 0 }, tonight: freshNight(), created: Date.now() };
}

const int = (v, lo, hi, d) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// Step migrations: MIGRATIONS[n] turns a version-n save into version n + 1. A save with no `v` is version 0 (the shape
// before versions; same fields). When the schema grows: bump SAVE_VERSION, add MIGRATIONS[old] that fills or renames
// fields, keep `found` and `seen` (the journal) as they are. A save from a newer build than this one is read for
// what this build knows (validate drops the rest); createStore keeps the original aside.
export const MIGRATIONS = {
  0: (r) => ({ ...r, v: 1 }),
};
export function migrate(raw, to = SAVE_VERSION) {
  let r = raw, v = Number.isInteger(raw.v) ? raw.v : 0;
  while (v < to && MIGRATIONS[v]) { try { r = MIGRATIONS[v](r) || r; } catch (e) { /* keep what there is */ } v++; }
  return r;
}

// Accepts anything; returns a clean save. Unknown ids are dropped, numbers clamped, types fixed.
export function validate(raw) {
  const s = freshSave();
  if (!raw || typeof raw !== 'object') return s;
  raw = migrate(raw);
  s.night = int(raw.night, 1, 100000, 1);
  s.glimmers = int(raw.glimmers, 0, 1e7, 0);
  for (const [k, v] of Object.entries(obj(raw.found))) if (ENTRY_IDS.has(k)) s.found[k] = int(v, 1, 100000, 1);
  for (const [k, v] of Object.entries(obj(raw.seen))) if (ENTRY_IDS.has(k) && v === true && s.found[k]) s.seen[k] = true;
  s.decorations = Array.isArray(raw.decorations) ? raw.decorations.filter((d) => typeof d === 'string').slice(0, 100) : [];
  for (const [k, v] of Object.entries(obj(raw.places))) if (typeof k === 'string' && v === true) s.places[k] = true;
  for (const [k, v] of Object.entries(obj(raw.firsts))) if (THING_IDS.has(k) && v === true) s.firsts[k] = true;
  for (const [k, v] of Object.entries(obj(raw.flags))) if (/^[a-zA-Z]{1,30}$/.test(k) && v === true) s.flags[k] = true;
  s.stats.pokes = int(obj(raw.stats).pokes, 0, 1e9, 0);
  s.stats.nights = int(obj(raw.stats).nights, 0, 1e6, 0);
  const t = obj(raw.tonight), n = freshNight();
  for (const k of Object.keys(NIGHT_DEFAULTS)) if (typeof t[k] === 'boolean') n[k] = t[k];
  for (const [k, v] of Object.entries(obj(t.taps))) if (THING_IDS.has(k)) n.taps[k] = int(v, 0, 1000, 0);
  for (const [k, v] of Object.entries(obj(t.poked))) if (THING_IDS.has(k) && v === true) n.poked[k] = true;
  for (const [k, v] of Object.entries(obj(t.lines))) if (THING_IDS.has(k)) n.lines[k] = int(v, 0, 1000, 0);
  for (const [k, v] of Object.entries(obj(t.knocked))) if (/^[a-zA-Z0-9]{1,30}$/.test(k) && v === true) n.knocked[k] = true;
  n.found = Array.isArray(t.found) ? t.found.filter((e) => ENTRY_IDS.has(e) && s.found[e]) : [];
  n.mugEdge = int(t.mugEdge, 0, 3, 0);
  s.tonight = n;
  s.created = int(raw.created, 0, 1e15, Date.now());
  return s;
}

export function createStore() {
  const key = CONFIG.saveKey || 'ghostcat3d.save';
  let data = freshSave(), timer = null, ok = true;
  // false while a save may exist that could not be read (storage threw): never write a fresh one over it
  let mayWrite = true;
  const aside = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* full or blocked: nothing more to do */ } };
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { /* broken below */ }
      if (!parsed || typeof parsed !== 'object') { console.warn('[save] unreadable save kept as', key + '.bad', '; a fresh night'); aside(key + '.bad', raw); }
      else {
        if (Number.isInteger(parsed.v) && parsed.v > SAVE_VERSION) aside(key + '.v' + parsed.v, raw);
        data = validate(parsed);
      }
    }
  } catch (e) { console.warn('[save] storage not readable; playing from memory', e && e.message); ok = false; mayWrite = false; }
  const canWrite = () => {
    if (mayWrite) return true;
    try { if (localStorage.getItem(key) === null) mayWrite = true; } catch (e) { /* still blocked */ }
    return mayWrite;
  };
  const trySet = (v) => { try { localStorage.setItem(key, v); return true; } catch (e) { return false; } };
  const write = (force) => {
    timer = null;
    if (!force && !canWrite()) { ok = false; return; }
    let text; try { text = JSON.stringify(data); } catch (e) { ok = false; return; }
    ok = trySet(text);
    if (!ok) { // full: drop the copies set aside, then try once more
      try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(key + '.')) localStorage.removeItem(k); } } catch (e) { /* blocked */ }
      ok = trySet(text);
    }
  };
  const changed = () => { if (!timer) timer = setTimeout(write, 250); };
  addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); write(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) { clearTimeout(timer); write(); } });
  return {
    get data() { return data; },
    changed, flush: () => { if (timer) clearTimeout(timer); write(); },
    reset: () => { if (timer) clearTimeout(timer); data = freshSave(); mayWrite = true; write(true); },
    get ok() { return ok; }, key,
  };
}
