// Frame timing: fps for the HUD and the debug API, plus the automatic pixel-ratio step-down.
// Rule: after a 2 s warm-up, three 1-second windows in a row that are slow drop the ratio by 0.25 (never below 1, or the
// device ratio if that is lower). Slow = under 24 fps, or under 50 fps with uneven frames (the worst frame over 1.25x
// the window's average). A steady 30 fps is a capped screen (iOS Low Power Mode), not a struggling GPU: every frame
// arrives on time, so it never steps down. It never steps back up within a session, so it cannot oscillate.
export function createPerf({ getRatio, setRatio, floor = 1 }) {
  let frames = 0, windowStart = performance.now(), fps = 60, ms = 16.7, last = performance.now();
  let bad = 0, warm = 0, stepDowns = 0;
  const windows = []; // completed 1 s windows: {fps, worst}
  let worst = 0;

  const frame = (now) => {
    const dt = now - last; last = now;
    ms = ms * 0.9 + dt * 0.1;
    worst = Math.max(worst, dt);
    frames++;
    const span = now - windowStart;
    if (span >= 1000) {
      fps = (frames * 1000) / span;
      const uneven = worst > 1.25 * (span / frames); // a frame that came well late against this window's own pace
      windows.push({ fps, worst, t: now });
      if (windows.length > 600) windows.shift();
      frames = 0; windowStart = now; worst = 0;
      warm++;
      if (warm > 2) {
        bad = fps < 24 || (fps < 50 && uneven) ? bad + 1 : 0;
        if (bad >= 3 && getRatio() > floor + 0.01) {
          setRatio(Math.max(floor, getRatio() - 0.25));
          stepDowns++; bad = 0;
          console.info('[perf] stepped pixel ratio down to', getRatio());
        }
      }
    }
  };
  // after a pause the first frame would look like a huge stall; start fresh instead
  const reset = () => { last = performance.now(); windowStart = last; frames = 0; worst = 0; warm = Math.min(warm, 1); bad = 0; };

  return { frame, reset, windows, get fps() { return fps; }, get ms() { return ms; }, get stepDowns() { return stepDowns; } };
}

// The pixel ratio a screen of w x h CSS pixels renders at: the wanted ratio, but never more than a render budget of
// `budget` device pixels (3.2 Mpx). Phones keep 2x (390x844 at 2x is 1.3 Mpx); an iPad (1180x820) renders at ~1.8x and a
// Mac window (1440x900) at ~1.6x, where 2x was 3.9 and 5.2 Mpx of toon shading with six point lights (fill rate).
export const RENDER_BUDGET = 3.2e6;
export function fitRatio(want, w, h, budget = RENDER_BUDGET) {
  return Math.max(Math.min(1, want), Math.min(want, Math.sqrt(budget / Math.max(1, w * h))));
}
