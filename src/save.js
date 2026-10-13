// Save: localStorage, versioned, validated on load, autosaved on every change (debounced) and on pagehide.
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

// Accepts anything; returns a clean save. Unknown ids are dropped, numbers clamped, types fixed.
export function validate(raw) {
  const s = freshSave();
  if (!raw || typeof raw !== 'object') return s;
  if (raw.v !== SAVE_VERSION) {
    // future migrations go here; for now an unknown version starts fresh but keeps the journal if it parses
  }
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
  try {
    const raw = localStorage.getItem(key);
    if (raw) data = validate(JSON.parse(raw));
  } catch (e) { console.warn('[save] could not read, starting fresh', e); ok = false; }
  const write = () => {
    timer = null;
    try { localStorage.setItem(key, JSON.stringify(data)); ok = true; } catch (e) { ok = false; }
  };
  const changed = () => { if (!timer) timer = setTimeout(write, 250); };
  addEventListener('pagehide', () => { if (timer) { clearTimeout(timer); write(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer) { clearTimeout(timer); write(); } });
  return {
    get data() { return data; },
    changed, flush: () => { if (timer) clearTimeout(timer); write(); },
    reset: () => { data = freshSave(); write(); },
    get ok() { return ok; }, key,
  };
}
