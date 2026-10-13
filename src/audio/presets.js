// presets.js: the music's per-area settings, chord progressions and Ghost's theme.
// Every number here can be tuned by ear; the engine blends all numeric fields over `xfade` seconds
// when the area changes, and switches key and progressions at the next chord.

// Chord qualities as semitones above the chord root.
export const QUALITIES = {
  maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], 'maj7#11': [0, 4, 7, 11, 18], '6/9': [0, 4, 7, 9, 14],
  add9: [0, 4, 7, 14], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14], m11: [0, 3, 7, 10, 14, 17], m6: [0, 3, 7, 9],
  9: [0, 4, 7, 10, 14], 13: [0, 4, 10, 14, 21], '9sus': [0, 5, 7, 10, 14],
};
const DEG = { i: 0, ii: 2, iii: 4, iv: 5, v: 7, vi: 9, vii: 11 };
// 'bVI:maj7' -> { root: 8, q: [...] } (root in semitones above the key)
export function parseChord(sym) {
  const [d, q] = sym.split(':');
  const flat = d[0] === 'b' ? 1 : 0;
  return { sym, root: (DEG[d.slice(flat).toLowerCase()] - flat + 12) % 12, q: QUALITIES[q] };
}

// Progressions by mood. The engine walks gently between neighbours in each list.
export const PROGRESSIONS = {
  warm: [
    ['I:maj9', 'vi:m9', 'ii:m9', 'V:9sus'],
    ['IV:maj9', 'iii:m7', 'vi:m9', 'I:maj7'],
    ['I:maj7', 'iii:m7', 'IV:maj9', 'iv:m6'],
    ['ii:m9', 'V:13', 'I:maj9', 'I:6/9'],
  ],
  airy: [
    ['I:maj9', 'IV:maj7#11', 'vi:m9', 'V:9sus'],
    ['IV:maj9', 'V:9sus', 'iii:m7', 'vi:m9'],
    ['I:maj7#11', 'II:9', 'IV:maj9', 'I:6/9'],
  ],
  street: [
    ['ii:m9', 'V:13', 'I:maj9', 'vi:m9'],
    ['IV:maj9', 'iii:m7', 'vi:m9', 'II:9'],
    ['I:maj9', 'bIII:maj7', 'IV:maj9', 'iv:m6'],
    ['vi:m9', 'ii:m9', 'IV:maj9', 'V:9sus'],
  ],
  park: [
    ['I:maj7', 'vi:m7', 'IV:maj9', 'V:9sus'],
    ['IV:maj7', 'V:9sus', 'vi:m9', 'I:maj9'],
    ['I:6/9', 'iii:m7', 'IV:maj9', 'ii:m9'],
  ],
  open: [
    ['I:maj9', 'IV:maj7#11'],
    ['vi:m9', 'IV:maj9', 'I:6/9', 'V:9sus'],
    ['I:6/9', 'ii:m9', 'IV:maj9', 'I:maj9'],
  ],
  alley: [
    ['i:m9', 'bVI:maj7', 'iv:m9', 'v:m7'],
    ['i:m11', 'IV:9', 'i:m9', 'bVII:6/9'],
    ['i:m9', 'bVI:maj7#11', 'bVII:6/9', 'V:9sus'],
  ],
  morning: [
    ['I:add9', 'IV:add9', 'vi:m7', 'V:9sus'],
    ['IV:maj9', 'V:9sus', 'I:add9', 'I:6/9'],
  ],
};

// Ghost's theme: scale degrees (0 = tonic) on an eighth-note grid over two bars. It turns up in
// most areas now and then, so the whole soundtrack feels like variations of one tune.
export const THEME = [
  { s: 0, d: 4, len: 2 }, { s: 2, d: 2, len: 1 }, { s: 3, d: 1, len: 1 }, { s: 4, d: 2, len: 3 },
  { s: 8, d: 5, len: 2 }, { s: 10, d: 4, len: 2 }, { s: 12, d: 2, len: 4 },
];

export const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

// Numeric fields blend during a crossfade. Levels are 0..1 (bus gains), probabilities 0..1.
//   level: overall trim so every area sits near -16 dBFS RMS
//   piano/ep/box/pad/sub/drums: instrument bus levels; vel: piano touch; melody: chance of a phrase
//   pulse: chance of re-striking the chord mid-bar; roll: chord roll spread (s)
//   epComp: Rhodes comping density; boxDensity: music-box sparkle density
//   kick/back/hat/ghost: drum step probabilities (back = rim or snare on 2 and 4); snare: snare vs rim
//   swing: 16th swing (0.5 straight); crackle; wobble (tape depth); flutter
//   lp/hp: music filter (Hz); reverb: send; width: stereo spread; themeProb: chance a phrase is the theme
//   vinylStop: chance of a vinyl/tape stop at the end of an 8-bar section
const BASE = {
  level: 1, bpm: 72, swing: 0.58, barsPerChord: 1,
  piano: 0.9, vel: 0.42, melody: 0.6, pulse: 0.3, roll: 0.045,
  ep: 0, epComp: 0, box: 0, boxDensity: 0,
  pad: 0.5, padAttack: 2.5, padCutoff: 1400, padHigh: 0,
  sub: 0.45, drums: 0, kick: 0.9, back: 0.85, snare: 0.4, hat: 0.7, ghost: 0.12,
  crackle: 0.4, wobble: 1, flutter: 1, lp: 6500, hp: 30, reverb: 0.35, width: 0.6, themeProb: 0.35, vinylStop: 0,
};

const P = (o) => ({ ...BASE, ...o });

export const PRESETS = {
  // the apartment: warmest and slowest, felt piano and pad, the beat barely there
  home: P({ key: 3, mode: 'major', prog: 'warm', bpm: 64, swing: 0.56, piano: 1, vel: 0.4, melody: 0.55, pulse: 0.2,
    ep: 0.25, epComp: 0.25, pad: 0.6, padCutoff: 1100, sub: 0.45, drums: 0.18, kick: 0.7, back: 0.5, snare: 0, hat: 0.35, ghost: 0.05,
    crackle: 0.55, lp: 5600, reverb: 0.32, width: 0.5, themeProb: 0.5, level: 0.95,
    amb: { city: 0.12, wind: 0, crickets: 0, rainMul: 0.55, lp: 1100 } }),
  // fire escape and rooftops: airier, more motion, Rhodes and a light swung beat
  rooftops: P({ key: 3, mode: 'major', prog: 'airy', bpm: 74, swing: 0.6, piano: 0.85, vel: 0.42, melody: 0.7, pulse: 0.4,
    ep: 0.5, epComp: 0.45, box: 0.12, boxDensity: 0.08, pad: 0.65, padCutoff: 1900, padHigh: 0.15, sub: 0.55,
    drums: 0.55, kick: 0.9, back: 0.85, snare: 0.35, hat: 0.75, ghost: 0.15, crackle: 0.4, lp: 7500, reverb: 0.42, width: 0.85,
    vinylStop: 0.05, level: 0.80, amb: { city: 0.5, wind: 0.45, crickets: 0, rainMul: 1, lp: 16000 } }),
  // the street: carries the beat, Rhodes comping, warm sub
  street: P({ key: 8, mode: 'major', prog: 'street', bpm: 78, swing: 0.61, piano: 0.75, vel: 0.44, melody: 0.6, pulse: 0.35,
    ep: 0.75, epComp: 0.6, pad: 0.45, padCutoff: 1500, sub: 0.7, drums: 0.8, kick: 1, back: 0.95, snare: 0.6, hat: 0.85, ghost: 0.22,
    crackle: 0.5, lp: 6800, reverb: 0.28, width: 0.65, vinylStop: 0.08, level: 0.70,
    amb: { city: 0.9, wind: 0.1, crickets: 0, rainMul: 1, lp: 16000 } }),
  // the park: music-box sparkle over the piano, soft brushes
  park: P({ key: 10, mode: 'major', prog: 'park', bpm: 72, swing: 0.57, piano: 0.85, vel: 0.4, melody: 0.55, pulse: 0.25,
    ep: 0.2, epComp: 0.2, box: 0.6, boxDensity: 0.32, pad: 0.55, padCutoff: 1700, sub: 0.45,
    drums: 0.35, kick: 0.75, back: 0.6, snare: 0, hat: 0.55, ghost: 0.08, crackle: 0.32, lp: 8000, reverb: 0.45, width: 0.75,
    level: 0.97, amb: { city: 0.3, wind: 0.15, crickets: 0.7, rainMul: 1, lp: 16000 } }),
  // the hill with the view: pads only, slow, the widest
  hill: P({ key: 3, mode: 'major', prog: 'open', bpm: 60, barsPerChord: 2, piano: 0, melody: 0, ep: 0, box: 0,
    pad: 1, padAttack: 4, padCutoff: 1700, padHigh: 0.5, sub: 0.5, drums: 0, crackle: 0.22, lp: 7000, reverb: 0.7, width: 1,
    level: 0.77, amb: { city: 0.2, wind: 0.7, crickets: 0.35, rainMul: 1, lp: 16000 } }),
  // corner shop, laundromat: the music next door, through a wall
  interiors: P({ key: 8, mode: 'major', prog: 'warm', bpm: 74, piano: 0.9, vel: 0.46, melody: 0.5, ep: 0.4, epComp: 0.35,
    pad: 0.5, sub: 0.8, drums: 0.6, kick: 1, back: 0.8, snare: 0.5, hat: 0.6, crackle: 0.3, lp: 620, hp: 40, reverb: 0.12,
    width: 0.25, level: 0.67, amb: { city: 0.22, wind: 0, crickets: 0, rainMul: 0.4, lp: 800 } }),
  // the alleys: sparser, minor, a little mysterious
  alley: P({ key: 0, mode: 'minor', prog: 'alley', bpm: 68, swing: 0.6, piano: 0.75, vel: 0.36, melody: 0.35, pulse: 0.12, roll: 0.07,
    ep: 0.35, epComp: 0.15, pad: 0.6, padCutoff: 950, sub: 0.55, drums: 0.4, kick: 0.55, back: 0.55, snare: 0, hat: 0.2, ghost: 0.05,
    crackle: 0.6, lp: 4800, reverb: 0.55, width: 0.75, themeProb: 0.25, vinylStop: 0.04, level: 1.02,
    amb: { city: 0.35, wind: 0.3, crickets: 0, rainMul: 1, lp: 3000 } }),
  // the rooftop party: same palette with more bounce, heard from a small speaker across the roof
  party: P({ key: 5, mode: 'major', prog: 'street', bpm: 84, swing: 0.62, piano: 0.7, vel: 0.48, melody: 0.55, pulse: 0.5,
    ep: 0.85, epComp: 0.75, pad: 0.4, padCutoff: 1800, sub: 0.85, drums: 1, kick: 1, back: 1, snare: 0.8, hat: 0.95, ghost: 0.3,
    crackle: 0.35, lp: 3400, hp: 170, reverb: 0.5, width: 0.2, vinylStop: 0.12, level: 0.77,
    amb: { city: 0.45, wind: 0.35, crickets: 0, rainMul: 1, lp: 16000 } }),
  // dawn: bright major for a few seconds, then the music fades away
  morning: P({ key: 2, mode: 'major', prog: 'morning', bpm: 80, swing: 0.55, piano: 0.9, vel: 0.5, melody: 0.95, pulse: 0.4,
    ep: 0, box: 0.5, boxDensity: 0.35, pad: 0.6, padCutoff: 2600, padHigh: 0.3, sub: 0.3, drums: 0, crackle: 0.15, lp: 9000,
    reverb: 0.4, width: 0.8, themeProb: 1, oneShot: 10, level: 0.86, amb: { city: 0.1, wind: 0.15, crickets: 0, rainMul: 1, lp: 16000 } }),
};

// names the game might use for the same places
export const AREA_ALIASES = {
  apartment: 'home', bedroom: 'home', room: 'home', 'fire-escape': 'rooftops', fireescape: 'rooftops', roof: 'rooftops',
  rooftop: 'rooftops', 'rooftop-garden': 'rooftops', shop: 'interiors', 'corner-shop': 'interiors', laundromat: 'interiors',
  interior: 'interiors', stairwell: 'interiors', alleys: 'alley', hilltop: 'hill', view: 'hill', 'rooftop-party': 'party',
  dawn: 'morning',
};

// musicLean 'piano' (config.js) softens the beat and the Rhodes everywhere
export function leanPreset(p, lean) {
  if (lean !== 'piano') return p;
  return { ...p, drums: p.drums * 0.45, ep: p.ep * 0.6, sub: p.sub * 0.8, piano: Math.min(1, p.piano * 1.1) };
}
