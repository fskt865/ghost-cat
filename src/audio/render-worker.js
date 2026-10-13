// render-worker.js: renders the audio buffers off the main thread so the game never hitches.
// Receives { keys: [...] }, posts back { key, sr, ch } per buffer (transferred), then { done: true }.
import { renderKey } from './synth.js';

self.onmessage = (e) => {
  for (const key of e.data.keys || []) {
    try {
      const r = renderKey(key);
      self.postMessage({ key, sr: r.sr, ch: r.ch }, r.ch.map((a) => a.buffer));
    } catch (err) {
      self.postMessage({ key, error: String(err && err.message || err) });
    }
  }
  self.postMessage({ done: true });
};
