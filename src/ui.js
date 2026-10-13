// The soft overlay: a speech line that floats above whatever was poked, a first-time hint,
// and the performance panel behind the small "fps" button.
import * as THREE from 'three';
import { CONFIG, fmt } from './config.js';

const $ = (id) => document.getElementById(id);

export function createUI() {
  const say = $('say'), hint = $('hint'), perfBtn = $('perf-btn'), perfPanel = $('perf');
  let sayAnchor = null, sayT = 0, hintGone = false, sayW = 0, sayH = 0;
  const v = new THREE.Vector3();

  const speak = (text, anchor) => {
    say.textContent = fmt(text);
    sayAnchor = anchor ? anchor.clone() : null;
    sayT = 2.6 + text.length * 0.035;
    say.classList.remove('show');
    void say.offsetWidth; // restart the pop-in transition
    say.classList.add('show');
    sayW = say.offsetWidth; sayH = say.offsetHeight; // measure once, not every frame
  };

  const dismissHint = () => { if (!hintGone) { hintGone = true; hint.classList.add('gone'); } };
  hint.textContent = fmt(CONFIG.text.hint);

  let perfOn = new URLSearchParams(location.search).has('perf');
  const setPerf = (on) => { perfOn = on; perfPanel.hidden = !on; perfBtn.setAttribute('aria-pressed', String(on)); };
  setPerf(perfOn);
  perfBtn.addEventListener('click', (e) => { e.stopPropagation(); setPerf(!perfOn); });
  perfBtn.addEventListener('pointerdown', (e) => e.stopPropagation());

  const update = (dt, camera, w, h) => {
    if (sayT > 0) {
      sayT -= dt;
      if (sayT <= 0) say.classList.remove('show');
      if (sayAnchor) {
        v.copy(sayAnchor).project(camera);
        const half = sayW / 2 + 10;
        // below the HUD pills and the place name (top ~100 px); a point behind the camera has no place on screen, so
        // the line sits under the place name rather than dropping to the bottom edge
        // (and below the night's nudge while it shows)
        const nudge = document.getElementById('hud-nudge'), nb = nudge && nudge.classList.contains('show') ? nudge.getBoundingClientRect().bottom + 10 : 0;
        const top = sayH + Math.max(104, nb);
        const behind = v.z > 1;
        const x = behind ? w / 2 : Math.min(Math.max((v.x * 0.5 + 0.5) * w, half), w - half);
        const y = behind ? top : Math.min(Math.max((-v.y * 0.5 + 0.5) * h, top), h - 60);
        say.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
      } else say.style.transform = `translate(${w / 2}px, ${h - 110}px) translate(-50%, -100%)`;
    }
  };

  const showPerf = (s) => {
    if (!perfOn) return;
    perfPanel.textContent =
      `${s.fps.toFixed(0)} fps  ${s.ms.toFixed(1)} ms\n` +
      `calls ${s.calls}  tris ${(s.tris / 1000).toFixed(1)}k\n` +
      `px ratio ${s.pr.toFixed(2)}  ${s.w}×${s.h}\n` +
      `${s.gl}${s.stepDowns ? `  step-downs ${s.stepDowns}` : ''}`;
  };

  return { speak, dismissHint, update, showPerf, get perfOn() { return perfOn; } };
}
