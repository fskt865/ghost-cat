// Frame timing: fps for the HUD and the debug API, plus the automatic pixel-ratio step-down.
// Rule: after a 2 s warm-up, three 1-second windows in a row under 50 fps drop the ratio by 0.25
// (never below 1, or the device ratio if that is lower). It never steps back up within a session,
// so it cannot oscillate.
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
      windows.push({ fps, worst, t: now });
      if (windows.length > 600) windows.shift();
      frames = 0; windowStart = now; worst = 0;
      warm++;
      if (warm > 2) {
        bad = fps < 50 ? bad + 1 : 0;
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
