// Every personal detail lives here and only here. Re-theming the game for a different person
// and cat should touch this file and the assets/ folder, nothing else.
// Text may use {name}, which is replaced with catName.
export const CONFIG = {
  catName: 'Ghost',
  gameTitle: '{name}',                 // tab title, home-screen name, loading screen
  tagline: 'a little night wander',     // shown under the title on the loading screen

  // The cat's look. This is the single source of truth: tools/export-traits.mjs writes
  // assets/ghost.traits.json from it, and the Blender build reads that file.
  cat: {
    heightM: 0.34,                // world scale: 1 unit = 1 metre. A small cat: the head reads smaller than the neighbour cats'
    furColour: '#131119',         // a black cat: near-black head and ears...
    ghostTint: '#9fb4ff',         // ...fading to ghost-blue at the hem; also the glow and rim light
    ghostTintAmount: 0.1,         // 0 = pure fur colour at the hem, 1 = pure tint. Low: black to the hem; ghostliness comes from fade and glow
    bodyOpacity: 0.92,
    hemFade: 0.65,
    glow: 0.12,
    eyeColour: '#9a6f2f',         // dark amber; keep big highlights so they read on a black face
    pupilColour: '#120f18',
    pupilWidth: 0.7,
    noseColour: '#5c4256',
    innerEarColour: '#6a4560',
    cheekColour: '#e98fb4',
    cheekStrength: 0.55,
    mouthColour: '#a59fc4',
    whiskerColour: '#bfc2e6',
    whiskers: true,
    whiteColour: '#f3f1fb',
    markings: [],                 // any of 'chest', 'paws', 'chin' (white patches)
    build: 'slim',                // 'round' | 'slim' | 'chunky': sets the proportions below unless overridden
    proportions: { bodyWidth: 0.82, bodyHeight: 0.95, earSize: 1.12, eyeSize: 1.1 }, // small cat: slighter body, kitten-ish ears and eyes
    tailOpacity: 0.6,
    hemLobes: 7,
    hemFlare: 0.75,                // less skirt flare: reads slighter
    restExpression: 'content',
    model: 'assets/ghost.glb',    // real model; a sphere placeholder is used until it exists
  },

  themeColour: '#1a1630',       // browser chrome, splash background, home-screen icon background
  saveKey: 'ghostcat3d.save',

  // Things the cat loves, to be placed in the world in later phases. Placeholder list.
  favourites: [
    { id: 'warm-laptop', label: 'a warm laptop', area: 'home' },
    { id: 'cardboard-box', label: 'a cardboard box', area: 'home' },
    { id: 'sunny-sill', label: 'the windowsill', area: 'home' },
    { id: 'string', label: 'a bit of string', area: 'home' },
    { id: 'silver-rings', label: 'a stack of chunky silver rings', area: 'home' },
    { id: 'coffee', label: 'coffee, always coffee', area: 'home' },
    { id: 'vinyl', label: 'a turntable and a crate of records', area: 'home' },
    { id: 'music-corner', label: 'a little music desk: keyboard, mic, interface, notebook', area: 'home' },
    { id: 'burger-stand', label: 'a burger and fries stand', area: 'street' },
    { id: 'ramen-window', label: 'a ramen and sushi window', area: 'street' },
    { id: 'med-grill', label: 'a Mediterranean grill', area: 'street' },
    { id: 'rooftop-party', label: 'a rooftop party, lights still on', area: 'rooftops' },
  ],
  // Owner's style, used by the apartment dressing: 'dark' = black bedding, deep purple throw, band
  // posters, dark nail polish on the nightstand, bedding black-on-white (white with a black pattern),
  // moody palette with warm lamps. 'light' = the original pastel dressing.
  homeStyle: 'dark',
  musicLean: 'beats',           // owner's music: 'piano' | 'beats'
  never: ['clowns', 'masks'],   // things that must not appear anywhere
  credit: 'made by Noah',       // tiny line hidden in settings, the only one

  text: {
    titleLine: 'a small black ghost cat, and one whole night to poke around in.',
    begin: 'begin the night',
    loading: '{name} is waking up…',
    hint: 'tap to drift · tap things to poke them · drag to look · pinch to zoom',
    hintPlatform: 'left thumb to move · right thumb to hop · hold it to float',
    hintPlatformKeys: 'WASD or arrows to move · space to hop · hold space to float',
    goal: 'the top of the hill. the whole neighbourhood, all those windows. all those naps.',
    purr: ['prrrrr.', '{name} purrs. it sounds like a tiny engine.', 'a slow blink. high praise.'],
    props: {
      lamp: ['warm. {name} approves of warm.', 'a moth was here first. negotiations ongoing.', 'the lamp hums. {name} hums back.'],
      bench: ['a bench for sitting. {name} prefers floating.', 'three slats. {name} checked each one.', 'a good bench. nap pending.'],
      bushA: ['something rustled. it was {name}.', 'smells like rain and a different cat.', 'leaf. leaf. leaf. one moth.'],
      bushB: ['a very small forest.', '{name} is hiding. very well. mostly.', 'the leaves are cold and nice.'],
      plant: ['{name} would never knock this over. probably.', 'taller than last night. rude.', 'one leaf has a tooth mark. unrelated.'],
      hut: ['the door to downstairs. home is that way.', 'warm air comes from under the door.', 'the light is on downstairs. good.'],
      wall: ['the edge of the roof. the city goes on forever.', '{name} is not afraid of heights. {name} is a ghost.', 'the bricks are still warm from the day.'],
    },
  },
};

export const fmt = (s) => s.replaceAll('{name}', CONFIG.catName);
