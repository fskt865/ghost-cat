// Phase 1 overlay: glimmer counter, journal button (gold dot for new finds), the journal itself,
// toasts, the nightly nudge, the place name, and the sleep / morning cards. Plain DOM, soft style.
import { CONFIG, fmt } from './config.js';
import { ENTRIES, ROOMS } from './things.js';
import { LINES } from './lines.js';

// every word here comes from LINES.hud (src/lines.js); {n} {count} {total} {place} filled in, {name} by fmt()
export const hudWord = (id, vars = {}) => fmt((LINES.hud.find((e) => e.id === id) || { text: id }).text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const W = hudWord;

const CSS = `
#hud-top { position: fixed; top: calc(10px + env(safe-area-inset-top)); left: calc(10px + env(safe-area-inset-left)); display: flex; gap: 8px; z-index: 3; }
.hud-pill { height: 36px; border-radius: 18px; border: 0; padding: 0 14px; background: rgba(30, 22, 52, 0.72); color: #f6eadf;
  font: inherit; font-size: 15px; display: flex; align-items: center; gap: 7px; touch-action: manipulation; position: relative; }
.hud-pill svg { width: 18px; height: 18px; }
#hud-glim { color: #ffe3a3; pointer-events: none; }
#hud-glim.bump { animation: bump 0.45s ease; }
@keyframes bump { 40% { transform: scale(1.18); } }
.gold-dot { position: absolute; top: 4px; right: 6px; width: 9px; height: 9px; border-radius: 50%; background: #ffcf5a; box-shadow: 0 0 8px #ffcf5a; display: none; }
.has-new .gold-dot { display: block; }
#hud-place { position: fixed; top: calc(54px + env(safe-area-inset-top)); left: 50%; transform: translateX(-50%); color: rgba(246,234,223,0.85);
  font-size: 14px; letter-spacing: 0.04em; pointer-events: none; transition: opacity 1s ease; text-shadow: 0 1px 8px rgba(0,0,0,0.6); white-space: nowrap; }
#hud-nudge { position: fixed; left: 50%; top: calc(84px + env(safe-area-inset-top)); transform: translateX(-50%); max-width: 82vw; text-align: center;
  color: #f6eadf; font-size: 16px; padding: 10px 16px; border-radius: 16px; background: rgba(30, 22, 52, 0.7); pointer-events: none;
  opacity: 0; transition: opacity 0.8s ease; }
#hud-nudge.show { opacity: 1; }
#hud-toast { position: fixed; left: 50%; bottom: calc(26px + env(safe-area-inset-bottom)); transform: translate(-50%, 20px); width: min(86vw, 360px);
  padding: 12px 16px 13px; border-radius: 18px; background: rgba(36, 26, 60, 0.92); color: #f6eadf; pointer-events: none; opacity: 0;
  transition: opacity 0.4s ease, transform 0.4s ease; box-shadow: 0 8px 30px rgba(10, 6, 30, 0.45), inset 0 0 0 1px rgba(255, 210, 120, 0.35); z-index: 4; }
#hud-toast.show { opacity: 1; transform: translate(-50%, 0); }
#hud-toast .t1 { color: #ffd98a; font-size: 13px; letter-spacing: 0.03em; }
#hud-toast .t2 { font-size: 17px; margin: 2px 0 4px; }
#hud-toast .t3 { font-size: 14px; opacity: 0.85; line-height: 1.35; }
.sheet { position: fixed; inset: 0; z-index: 6; display: none; background: rgba(12, 8, 28, 0.55); }
#journal { cursor: pointer; } /* a tap on the backdrop closes it (and iOS only sends taps to 'clickable' things) */
#journal .panel { cursor: default; }
.sheet.open { display: block; animation: fadein 0.25s ease; }
@keyframes fadein { from { opacity: 0; } }
.sheet .panel { position: absolute; left: 50%; top: calc(14px + env(safe-area-inset-top)); bottom: calc(14px + env(safe-area-inset-bottom)); transform: translateX(-50%);
  width: min(calc(100vw - 24px - env(safe-area-inset-left) - env(safe-area-inset-right)), 720px); border-radius: 26px; background: linear-gradient(#2c2150, #1f1838); color: #f6eadf; box-shadow: 0 20px 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,220,170,0.12);
  display: flex; flex-direction: column; overflow: hidden; }
.panel header { display: flex; align-items: baseline; justify-content: space-between; padding: 18px 20px 8px; gap: 10px; }
.panel h2 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: 0.02em; }
.panel .sub { font-size: 14px; opacity: 0.7; }
.panel .close { border: 0; background: rgba(255,255,255,0.08); color: inherit; font: inherit; font-size: 15px; border-radius: 16px; height: 34px; padding: 0 14px; }
.panel .scroll { overflow-y: auto; padding: 4px 16px 20px; -webkit-overflow-scrolling: touch; overscroll-behavior: contain; touch-action: pan-y; }
.panel h3 { font-size: 13px; text-transform: lowercase; letter-spacing: 0.08em; opacity: 0.6; margin: 16px 4px 8px; font-weight: 500; }
.entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.entry { position: relative; border-radius: 16px; padding: 12px 12px 13px; background: rgba(255,255,255,0.06); min-height: 92px; }
.entry.found { background: linear-gradient(160deg, rgba(255,214,140,0.16), rgba(255,255,255,0.05)); }
.entry .ic { width: 34px; height: 34px; margin-bottom: 6px; }
.entry .ic svg { width: 100%; height: 100%; }
.entry:not(.found) .ic svg * { fill: #0e0a1e !important; stroke: #0e0a1e !important; }
.entry .tt { font-size: 15px; margin-bottom: 3px; }
.entry .nn { font-size: 13px; line-height: 1.35; opacity: 0.8; }
.entry:not(.found) .nn { font-style: italic; opacity: 0.55; }
.entry .gold-dot { display: none; }
.entry.new .gold-dot { display: block; top: 10px; right: 10px; }
.card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(86vw, 380px); border-radius: 26px; padding: 22px 22px 18px;
  box-sizing: border-box; max-height: calc(100% - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); display: flex; flex-direction: column;
  background: linear-gradient(#33265a, #241b42); color: #f6eadf; text-align: center; box-shadow: 0 20px 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,220,170,0.15); }
.card p { margin: 6px 0 14px; line-height: 1.4; text-wrap: balance; }
.card .big { font-size: 20px; }
.card ul { list-style: none; padding: 0; margin: 4px 0 12px; max-height: 40vh; min-height: 3em; flex: 0 1 auto; overflow-y: auto; } /* a big night's list scrolls; the button stays on screen */
.card li { padding: 3px 0; color: #ffd98a; }
.card .stats { font-size: 13px; opacity: 0.7; margin-bottom: 16px; }
.card .stats span { white-space: nowrap; } /* each stat stays whole when the line wraps */
.card .btns { display: flex; gap: 10px; justify-content: center; }
.card button { border: 0; font: inherit; font-size: 16px; border-radius: 18px; height: 42px; padding: 0 18px; background: rgba(255,255,255,0.1); color: inherit; }
.card button.primary { background: #ffcf7a; color: #2a1d3a; }
@media (max-height: 500px) { .card { padding: 14px 20px 12px; } .card p { margin: 4px 0 8px; } .card ul { margin: 0 0 8px; } .card .stats { margin-bottom: 10px; } }
#dawn { position: fixed; inset: 0; z-index: 5; pointer-events: none; opacity: 0; transition: opacity 2.2s ease;
  background: linear-gradient(#f7c59f 0%, #f3a69a 35%, #b07aa8 70%, #6a5a9a 100%); }
#dawn.on { opacity: 1; pointer-events: auto; }
`;

// tiny icons for journal entries (drawn, not emoji, so they look the same everywhere)
const ICON = {
  moon: '<circle cx="16" cy="16" r="11" fill="#ffe9b0"/><circle cx="21" cy="12" r="9" fill="#2c2150"/>',
  ring: '<circle cx="16" cy="16" r="9" fill="none" stroke="#f2a0b8" stroke-width="5"/>',
  fluff: '<circle cx="12" cy="18" r="7" fill="#c9c6d6"/><circle cx="20" cy="17" r="7" fill="#c9c6d6"/><circle cx="16" cy="12" r="7" fill="#dcd9e6"/>',
  moth: '<ellipse cx="10" cy="15" rx="7" ry="5" fill="#efe2c8"/><ellipse cx="22" cy="15" rx="7" ry="5" fill="#efe2c8"/><rect x="15" y="9" width="2.5" height="14" rx="1.2" fill="#8a7a6a"/>',
  frame: '<rect x="6" y="7" width="20" height="17" rx="2" fill="#e0ad48"/><rect x="9" y="10" width="14" height="11" fill="#3b4a8a"/>',
  mug: '<rect x="8" y="10" width="13" height="14" rx="3" fill="#c8704a"/><circle cx="23" cy="17" r="4" fill="none" stroke="#c8704a" stroke-width="2.5"/>',
  laptop: '<rect x="8" y="8" width="16" height="11" rx="1.5" fill="#9fc4ff"/><rect x="5" y="20" width="22" height="3" rx="1.5" fill="#b9bcc8"/>',
  coin: '<circle cx="16" cy="16" r="10" fill="#ffcf5a"/><circle cx="16" cy="16" r="6" fill="none" stroke="#d99a2a" stroke-width="2"/>',
  sweater: '<path d="M9 9 L13 7 L19 7 L23 9 L27 15 L23 17 L22 25 L10 25 L9 17 L5 15 Z" fill="#9a98a8"/>',
  drop: '<path d="M16 5 C 20 12 24 16 24 20 A 8 8 0 0 1 8 20 C 8 16 12 12 16 5 Z" fill="#9fc4ff"/>',
  fridge: '<rect x="9" y="4" width="14" height="24" rx="3" fill="#d8ece6"/><rect x="20" y="10" width="1.5" height="5" fill="#8a9a96"/>',
  box: '<path d="M6 12 L16 8 L26 12 L26 24 L16 28 L6 24 Z" fill="#c49a64"/><path d="M6 12 L16 16 L26 12" fill="none" stroke="#8a6a40" stroke-width="1.5"/>',
  fish: '<ellipse cx="14" cy="16" rx="8" ry="5" fill="#ff9a5a"/><path d="M21 16 L27 11 L27 21 Z" fill="#ff9a5a"/>',
  star: '<path d="M16 4 L19 13 L28 13 L21 19 L24 28 L16 22 L8 28 L11 19 L4 13 L13 13 Z" fill="#fff0b0"/>',
  heart: '<path d="M16 26 C 4 18 6 8 12 8 C 14 8 16 10 16 12 C 16 10 18 8 20 8 C 26 8 28 18 16 26 Z" fill="#ff7d9c"/>',
  tomato: '<circle cx="16" cy="18" r="9" fill="#d9493c"/><path d="M12 10 L16 12 L20 10 L16 8 Z" fill="#4f8a55"/>',
  leaf: '<path d="M6 24 C 8 10 18 6 26 6 C 26 16 20 26 6 24 Z" fill="#e0ad48"/>',
  blanket: '<path d="M4 22 C 8 12 14 10 16 14 C 18 10 24 12 28 22 Z" fill="#5b6fa3"/>',
};
const svg = (k) => `<svg viewBox="0 0 32 32">${ICON[k] || ICON.star}</svg>`;
const BOOK = '<svg viewBox="0 0 24 24"><path d="M4 5 C 7 4 10 4 12 6 C 14 4 17 4 20 5 L20 19 C 17 18 14 18 12 20 C 10 18 7 18 4 19 Z" fill="none" stroke="#f6eadf" stroke-width="1.8" stroke-linejoin="round"/><path d="M12 6 L12 20" stroke="#f6eadf" stroke-width="1.5"/></svg>';

export function createHud({ onJournalOpen } = {}) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const el = (html) => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; };
  const top = el(`<div id="hud-top"><button class="hud-pill" id="hud-journal" aria-label="${W('journal')}">${BOOK}<span>${W('journal')}</span><span class="gold-dot"></span></button><div class="hud-pill" id="hud-glim">✦ <span>0</span></div></div>`);
  const place = el('<div id="hud-place"></div>');
  const nudge = el('<div id="hud-nudge"></div>');
  const toast = el('<div id="hud-toast"><div class="t1"></div><div class="t2"></div><div class="t3"></div></div>');
  const journal = el(`<div class="sheet" id="journal"><div class="panel"><header><div><h2></h2><div class="sub"></div></div><button class="close">${W('close')}</button></header><div class="scroll"></div></div></div>`);
  const cardSheet = el('<div class="sheet" id="cardsheet"><div class="card"></div></div>');
  const dawn = el('<div id="dawn"></div>');
  for (const n of [top, place, nudge, toast, journal, cardSheet, dawn]) document.body.appendChild(n);
  const stop = (e) => e.stopPropagation();
  for (const n of [top, journal, cardSheet]) { n.addEventListener('pointerdown', stop); n.addEventListener('pointerup', stop); }

  const jBtn = top.querySelector('#hud-journal'), glim = top.querySelector('#hud-glim span'), glimPill = top.querySelector('#hud-glim');
  let store = null, ENTRY_LIST = ENTRIES, ROOM_LIST = ROOMS;
  const bind = (s, opts = {}) => { store = s; if (opts.entries) ENTRY_LIST = opts.entries; if (opts.rooms) ROOM_LIST = opts.rooms; refresh(); };

  const refresh = () => {
    const d = store.data;
    glim.textContent = d.glimmers;
    const anyNew = Object.keys(d.found).some((id) => !d.seen[id]);
    jBtn.classList.toggle('has-new', anyNew);
  };
  const bumpGlimmers = () => { glimPill.classList.remove('bump'); void glimPill.offsetWidth; glimPill.classList.add('bump'); refresh(); };

  const renderJournal = () => {
    const d = store.data;
    const total = ENTRY_LIST.length, found = ENTRY_LIST.filter((e) => d.found[e.id]).length;
    journal.querySelector('h2').textContent = W('journal-title');
    journal.querySelector('.sub').textContent = W('journal-count', { count: found, total });
    const sc = journal.querySelector('.scroll');
    sc.innerHTML = '';
    for (const r of ROOM_LIST) {
      const list = ENTRY_LIST.filter((e) => e.room === r.id);
      if (!list.length) continue;
      const h = document.createElement('h3'); h.textContent = r.name; sc.appendChild(h);
      const grid = document.createElement('div'); grid.className = 'entries';
      for (const e of list) {
        const f = !!d.found[e.id];
        const c = document.createElement('div');
        c.className = 'entry' + (f ? ' found' : '') + (f && !d.seen[e.id] ? ' new' : '');
        c.dataset.id = e.id;
        c.innerHTML = `<span class="gold-dot"></span><div class="ic">${svg(e.icon)}</div><div class="tt"></div><div class="nn"></div>`;
        c.querySelector('.tt').textContent = f ? fmt(e.title) : W('journal-unknown');
        c.querySelector('.nn').textContent = f ? fmt(e.note) : fmt(e.hint);
        grid.appendChild(c);
      }
      sc.appendChild(grid);
    }
  };
  // one sheet at a time: the journal, a card and the settings sheet (src/settings.js) tell each other when they open
  const announce = (name) => dispatchEvent(new CustomEvent('ghost-sheet', { detail: name }));
  addEventListener('ghost-sheet', (e) => { if (e.detail !== 'journal' && journal.classList.contains('open')) closeJournal(); });
  const openJournal = () => {
    if (journal.classList.contains('open')) return;
    announce('journal');
    renderJournal();
    journal.classList.add('open');
    // opening the journal marks everything as seen (the dots stay visible until it closes)
    for (const id of Object.keys(store.data.found)) store.data.seen[id] = true;
    store.changed();
    onJournalOpen?.();
  };
  const closeJournal = () => { journal.classList.remove('open'); refresh(); };
  jBtn.addEventListener('click', openJournal);
  journal.querySelector('.close').addEventListener('click', closeJournal);
  // a tap on the dim backdrop (down and up both outside the panel, so a scroll that ends outside never closes it)
  let downOutside = false;
  journal.addEventListener('pointerdown', (e) => { downOutside = e.target === journal; });
  journal.addEventListener('pointerup', (e) => { if (downOutside && e.target === journal) closeJournal(); downOutside = false; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && journal.classList.contains('open')) closeJournal(); });

  let placeT = null;
  const showPlace = (text, sec = 3.5) => {
    place.textContent = fmt(text); place.style.opacity = 1;
    clearTimeout(placeT); placeT = setTimeout(() => (place.style.opacity = 0), sec * 1000);
  };
  let nudgeT = null;
  const showNudge = (text, sec = 5) => {
    nudge.textContent = fmt(text); nudge.classList.add('show');
    clearTimeout(nudgeT); nudgeT = setTimeout(() => nudge.classList.remove('show'), sec * 1000);
  };
  const toastQ = []; let toastBusy = false;
  const showToast = (entry) => { toastQ.push(entry); if (!toastBusy) nextToast(); };
  const nextToast = () => {
    const e = toastQ.shift(); if (!e) { toastBusy = false; return; }
    toastBusy = true;
    toast.querySelector('.t1').textContent = W('toast');
    toast.querySelector('.t2').textContent = fmt(e.title);
    toast.querySelector('.t3').textContent = fmt(e.note);
    toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); setTimeout(nextToast, 450); }, 4200);
  };

  const card = (html, buttons) => new Promise((resolve) => {
    announce('card');
    const c = cardSheet.querySelector('.card');
    c.innerHTML = html + '<div class="btns"></div>';
    for (const [label, value, primary] of buttons) {
      const b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary';
      b.addEventListener('click', () => { cardSheet.classList.remove('open'); resolve(value); });
      c.querySelector('.btns').appendChild(b);
    }
    cardSheet.classList.add('open');
  });
  const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  const askSleep = (foundTonight) => card(
    `<p class="big">${esc(W('sleep-ask'))}</p><p>${esc(foundTonight ? W(foundTonight === 1 ? 'sleep-found-one' : 'sleep-found', { n: foundTonight }) : W('sleep-nothing'))}</p>`,
    [[W('sleep-no'), false], [W('sleep-yes'), true, true]]);

  const dawnOn = (on) => dawn.classList.toggle('on', on);
  const morning = ({ line, found, pokes, glimmers, total, count }) => card(
    `<p class="big">${esc(fmt(line))}</p>` +
    (found.length ? `<p>${esc(W('morning-found'))}</p><ul class="scroll">${found.map((t) => `<li>${esc(fmt(t))}</li>`).join('')}</ul>` : `<p>${esc(W('morning-nothing'))}</p>`) +
    `<div class="stats"><span>${esc(W(pokes === 1 ? 'stat-pokes-one' : 'stat-pokes', { n: pokes }))}</span> · <span>${esc(W('stat-glimmers', { n: glimmers }))}</span> · <span>${esc(W('stat-journal', { count, total }))}</span></div>`,
    [[W('next-night'), true, true]]);

  return { word: W, bind, refresh, bumpGlimmers, showPlace, showNudge, showToast, askSleep, morning, dawnOn, openJournal, closeJournal, get journalOpen() { return journal.classList.contains('open'); }, get cardOpen() { return cardSheet.classList.contains('open'); } };
}
