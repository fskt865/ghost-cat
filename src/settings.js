// The settings sheet behind the small gear: music and little sounds (on/off and a volume each, kept by
// src/audio/audio.js in localStorage), start the night again (a fresh night, the journal stays), forget
// everything (an in-page confirm, then a fresh save and a reload), and the one easy-to-miss credit line at
// the very bottom (config.credit). Every word comes from LINES.settings in src/lines.js.
//
//   const settings = createSettings({ audio, store, onRestart });
//   settings.open / settings.show() / settings.hide()
//
// Only one sheet is open at a time: opening this one sends a 'ghost-sheet' event (detail 'settings') and any
// other sheet closes; when the journal or a card opens, this one closes (src/hud.js sends the same event).
import { CONFIG, fmt } from './config.js';
import { LINES } from './lines.js';

const CSS = `
#gear { position: fixed; top: calc(10px + env(safe-area-inset-top)); right: calc(10px + env(safe-area-inset-right)); z-index: 4;
  width: 36px; height: 36px; border-radius: 18px; border: 0; background: rgba(30, 22, 52, 0.72); padding: 0; touch-action: manipulation;
  display: grid; place-items: center; }
#gear.beside-fps { right: calc(64px + env(safe-area-inset-right)); }
#gear svg { width: 20px; height: 20px; opacity: 0.85; }
#settings { position: fixed; inset: 0; z-index: 7; display: none; background: rgba(12, 8, 28, 0.55); cursor: pointer; }
#settings.open { display: block; animation: fadein 0.25s ease; }
#settings .panel { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); cursor: default;
  width: min(calc(100vw - 32px - env(safe-area-inset-left) - env(safe-area-inset-right)), 360px);
  max-height: calc(100% - 28px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); overflow-y: auto; overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch; box-sizing: border-box; border-radius: 26px; padding: 18px 20px 12px;
  background: linear-gradient(#2c2150, #1f1838); color: #f6eadf;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,220,170,0.12); }
#settings h2 { margin: 0 0 8px; font-size: 22px; font-weight: 600; letter-spacing: 0.02em; }
#settings .row { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 4px 0; border-top: 1px solid rgba(255,255,255,0.08); font-size: 16px; }
#settings .row .lbl { flex: 0 0 auto; width: 92px; }
#settings [hidden] { display: none !important; }
#settings .vol { flex: 1 1 auto; position: relative; height: 44px; margin: 0 11px; touch-action: none; cursor: pointer; outline: none; }
#settings .vol .track { position: absolute; left: 0; right: 0; top: 19px; height: 6px; border-radius: 3px; background: rgba(255,255,255,0.12); overflow: hidden; }
#settings .vol .fill { height: 100%; background: linear-gradient(90deg, #c98a4a, #ffcf7a); border-radius: 3px; }
#settings .vol .knob { position: absolute; top: 11px; width: 22px; height: 22px; margin-left: -11px; border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #fff8ee, #f3dcc0); box-shadow: 0 2px 8px rgba(10,6,30,0.5); }
#settings .vol:focus-visible .knob { box-shadow: 0 0 0 3px rgba(255,207,122,0.6); }
#settings .off .vol { opacity: 0.35; }
#settings .sw { flex: 0 0 auto; position: relative; width: 48px; height: 28px; border-radius: 14px; border: 0; padding: 0;
  background: rgba(255,255,255,0.14); transition: background 0.2s ease; touch-action: manipulation; }
#settings .sw::after { content: ''; position: absolute; top: 3px; left: 3px; width: 22px; height: 22px; border-radius: 50%;
  background: #f6eadf; transition: transform 0.2s ease; box-shadow: 0 1px 4px rgba(10,6,30,0.4); }
#settings .sw[aria-checked="true"] { background: #ffcf7a; }
#settings .sw[aria-checked="true"]::after { transform: translateX(20px); background: #2a1d3a; }
#settings .act { width: 100%; text-align: left; border: 0; background: none; color: inherit; font: inherit; font-size: 16px; padding: 8px 0;
  display: block; touch-action: manipulation; cursor: pointer; }
#settings .act small { display: block; font-size: 13px; opacity: 0.6; margin-top: 2px; }
#settings .ask { width: 100%; padding: 8px 0; }
#settings .ask p { margin: 0 0 10px; font-size: 15px; line-height: 1.35; }
#settings .ask .btns { display: flex; gap: 10px; }
#settings .ask button { flex: 1; height: 40px; border: 0; border-radius: 16px; font: inherit; font-size: 15px; background: rgba(255,255,255,0.1); color: inherit; touch-action: manipulation; }
#settings .ask button.gone { background: #e98f8f; color: #2a1d3a; }
#settings .close { margin-top: 10px; width: 100%; height: 44px; border: 0; border-radius: 18px; background: #ffcf7a; color: #2a1d3a; font: inherit; font-size: 16px; touch-action: manipulation; }
#settings .credit { margin-top: 14px; text-align: center; font-size: 10px; letter-spacing: 0.04em; opacity: 0.32; }
/* a phone on its side (390 px tall): the same sheet, tighter, so it fits without scrolling */
@media (max-height: 500px) {
  #settings .panel { padding: 12px 18px 8px; }
  #settings h2 { font-size: 19px; margin-bottom: 4px; }
  #settings .row { min-height: 40px; padding: 0; }
  #settings .vol { height: 36px; } #settings .vol .track { top: 15px; } #settings .vol .knob { top: 7px; }
  #settings .act { padding: 5px 0; } #settings .act small { margin-top: 0; }
  #settings .ask { padding: 5px 0; } #settings .ask p { margin-bottom: 6px; } #settings .ask button { height: 36px; }
  #settings .close { height: 38px; margin-top: 6px; } #settings .credit { margin-top: 8px; }
}
@keyframes fadein { from { opacity: 0; } }
`;
const GEAR = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" fill="none" stroke="#f6eadf" stroke-width="1.8"/><path d="M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8" stroke="#f6eadf" stroke-width="1.8" stroke-linecap="round"/></svg>';

// LINES.settings is a list of { id, text }; a missing id shows its id rather than breaking the sheet
const word = (id) => fmt((LINES.settings.find((e) => e.id === id) || { text: id }).text);

export function createSettings({ audio = null, store = null, onRestart = null } = {}) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const gear = document.createElement('button'); gear.id = 'gear'; gear.type = 'button'; gear.setAttribute('aria-label', word('title')); gear.innerHTML = GEAR;
  const fps = document.getElementById('perf-btn');
  if (fps && !fps.hidden) gear.classList.add('beside-fps');
  const sheet = document.createElement('div'); sheet.id = 'settings';
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `<div class="panel scroll"><h2></h2>
    <div class="row" data-ch="music"><span class="lbl"></span><div class="vol" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100"><div class="track"><div class="fill"></div></div><div class="knob"></div></div><button type="button" class="sw" role="switch"></button></div>
    <div class="row" data-ch="sfx"><span class="lbl"></span><div class="vol" role="slider" tabindex="0" aria-valuemin="0" aria-valuemax="100"><div class="track"><div class="fill"></div></div><div class="knob"></div></div><button type="button" class="sw" role="switch"></button></div>
    <div class="row"><button type="button" class="act restart"><span></span><small></small></button></div>
    <div class="row forget"><button type="button" class="act ask-open"><span></span><small></small></button>
      <div class="ask" hidden><p></p><div class="btns"><button type="button" class="keep"></button><button type="button" class="gone"></button></div></div></div>
    <button type="button" class="close"></button>
    <div class="credit"></div></div>`;
  const $ = (s) => sheet.querySelector(s);
  $('h2').textContent = word('title');
  $('.restart span').textContent = word('restart'); $('.restart small').textContent = word('restart-note');
  $('.ask-open span').textContent = word('forget'); $('.ask-open small').textContent = word('forget-note');
  $('.ask p').textContent = word('forget-ask'); $('.keep').textContent = word('forget-no'); $('.gone').textContent = word('forget-yes');
  $('.close').textContent = word('close');
  $('.credit').textContent = fmt(CONFIG.credit || '');
  document.body.append(gear, sheet);

  // ---- sound: two channels, each a switch and a volume. audio.js keeps one mute mode for both:
  // 'off' (nothing muted) | 'music' | 'sfx' | 'all'
  const ch = {
    music: { row: $('[data-ch="music"]'), label: word('music'), get: () => audio?.musicVolume ?? 1, set: (v) => audio?.setMusicVolume(v) },
    sfx: { row: $('[data-ch="sfx"]'), label: word('sound'), get: () => audio?.sfxVolume ?? 1, set: (v) => audio?.setSfxVolume(v) },
  };
  const muted = () => audio?.getMute?.() || 'off';
  const isOn = (k) => { const m = muted(); return m !== 'all' && m !== k; };
  const setOn = (k, on) => {
    const other = k === 'music' ? 'sfx' : 'music', otherOn = isOn(other);
    const mode = on ? (otherOn ? 'off' : other) : (otherOn ? k : 'all');
    audio?.setMute(mode);
  };
  const paint = () => {
    for (const [k, c] of Object.entries(ch)) {
      const on = isOn(k), v = Math.round(c.get() * 100);
      c.row.classList.toggle('off', !on);
      c.sw.setAttribute('aria-checked', String(on));
      c.vol.setAttribute('aria-valuenow', String(v));
      c.fill.style.width = v + '%'; c.knob.style.left = v + '%';
    }
  };
  for (const [k, c] of Object.entries(ch)) {
    c.row.querySelector('.lbl').textContent = c.label;
    c.sw = c.row.querySelector('.sw'); c.vol = c.row.querySelector('.vol');
    c.fill = c.row.querySelector('.fill'); c.knob = c.row.querySelector('.knob');
    c.sw.setAttribute('aria-label', c.label); c.vol.setAttribute('aria-label', c.label);
    c.sw.addEventListener('click', () => { setOn(k, !isOn(k)); paint(); if (k === 'sfx' && isOn(k)) audio?.play('tap'); });
    // a volume drag: pointer events with capture (no <input type=range>: the game stops touchmove on the page)
    let drag = null;
    const at = (e) => { const r = c.vol.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width))); };
    const apply = (v) => { c.set(v); if (!isOn(k) && v > 0) setOn(k, true); paint(); };
    c.vol.addEventListener('pointerdown', (e) => { drag = e.pointerId; try { c.vol.setPointerCapture(e.pointerId); } catch { /* synthetic */ } apply(at(e)); });
    c.vol.addEventListener('pointermove', (e) => { if (drag === e.pointerId) apply(at(e)); });
    const end = (e) => { if (drag !== e.pointerId) return; drag = null; if (k === 'sfx') audio?.play('tap'); };
    c.vol.addEventListener('pointerup', end); c.vol.addEventListener('pointercancel', end);
    c.vol.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: -0.1, ArrowDown: -0.1, ArrowRight: 0.1, ArrowUp: 0.1 }[e.key];
      if (step) { e.preventDefault(); apply(Math.max(0, Math.min(1, Math.round((c.get() + step) * 10) / 10))); }
    });
  }

  // ---- start the night again / forget everything
  const ask = $('.ask'), askOpen = $('.ask-open');
  const closeAsk = () => { ask.hidden = true; askOpen.hidden = false; };
  $('.restart').addEventListener('click', () => { hide(); onRestart?.(); });
  askOpen.addEventListener('click', () => { askOpen.hidden = true; ask.hidden = false; $('.keep').focus({ preventScroll: true }); });
  $('.keep').addEventListener('click', closeAsk);
  $('.gone').addEventListener('click', () => {
    // a fresh save on disk, then the page starts over from the title (sound settings are this device's, they stay)
    try { store?.reset(); } catch (e) { /* storage blocked: the reload still starts fresh in memory */ }
    location.reload();
  });

  // ---- open / close: one sheet at a time, close on a tap outside the panel or on Escape
  const show = () => {
    if (sheet.classList.contains('open')) return;
    dispatchEvent(new CustomEvent('ghost-sheet', { detail: 'settings' }));
    closeAsk(); paint(); sheet.classList.add('open');
  };
  const hide = () => { sheet.classList.remove('open'); closeAsk(); };
  addEventListener('ghost-sheet', (e) => { if (e.detail !== 'settings') hide(); });
  const stop = (e) => e.stopPropagation();
  for (const n of [gear, sheet]) { n.addEventListener('pointerdown', stop); n.addEventListener('pointerup', stop); }
  gear.addEventListener('click', show);
  $('.close').addEventListener('click', hide);
  // a tap on the dim backdrop: pointerdown and pointerup both outside the panel (a drag out of a slider never closes it)
  let downOutside = false;
  sheet.addEventListener('pointerdown', (e) => { downOutside = e.target === sheet; });
  sheet.addEventListener('pointerup', (e) => { if (downOutside && e.target === sheet) hide(); downOutside = false; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('open')) hide(); });
  addEventListener('storage', (e) => { if (e.key && e.key.includes('audio')) paint(); });

  return { get open() { return sheet.classList.contains('open'); }, show, hide };
}
