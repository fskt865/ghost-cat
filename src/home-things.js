// What the touchable things in Ghost's home DO. All words (lines, first lines, on/off, journal titles,
// hints, entries, glimmers) come from src/lines.js, the single source of truth; this file only holds the
// mechanics, keyed by the same ids. Secrets are the ones lines.js lists; their triggers are implemented
// here (taps / sit / once) or in home.js (the custom ones: camouflage, b-side, the-composition,
// the-recording, glow-moon, stash, shooting-star, smoke-ring, skylight). The fire escape's and the roof's things
// point at ids in assets/layouts/*.json, placed by src/home-outside.js.
import { LINES } from './lines.js';

const byId = (list) => Object.fromEntries((list || []).map((x) => [x.id, x]));
export const LINE_THINGS = byId(LINES.things);
export const LINE_SECRETS = byId(LINES.secrets);

// at: placement key in apartment.js; node: child node; act: little body language; reaction; hit: trigger size
export const HOME_THINGS = [
  // bedroom
  { id: 'bed', at: 'bed', act: 'purr', reaction: 'soft', hit: { r: 0.6, h: 1.0, y: 0.3 } },
  { id: 'blanket', at: 'bed', node: 'blanket', act: 'nudge', reaction: 'wobble', special: 'blanket', hit: { r: 0.5, h: 0.7, y: 0.1 } },
  { id: 'curtain', at: 'bedWindow', node: 'curtain_L', act: 'nudge', reaction: 'toggle', toggle: 'curtains', hit: { r: 0.25, h: 1.6, y: 0.7 } },
  { id: 'beam', at: 'moonbeam', act: 'sit', reaction: 'soft', hit: { r: 0.5, h: 0.3 } },
  { id: 'moon0', at: 'bedWindow', node: 'glass', act: 'stare', reaction: 'wobble', special: 'wink', hit: { r: 0.4, h: 0.9, y: 0.8 } },
  { id: 'hairtie', at: 'hairTie', act: 'bat', reaction: 'knockoff', special: 'hairTie', hit: { r: 0.25, h: 0.25, y: -0.05 } },
  { id: 'nlamp', at: 'nightstand', node: 'lamp', act: 'bat', reaction: 'toggle', toggle: 'bedLamp', hit: { r: 0.25, h: 0.35, y: 0.5 } },
  { id: 'slippers', at: 'slippers', act: 'nudge', reaction: 'wobble', special: 'slippers', hit: { r: 0.3, h: 0.3 } },
  { id: 'underbed', at: 'underBed', act: 'stare', reaction: 'reveal', special: 'dustBunny', hit: { r: 0.4, h: 0.3 } },
  { id: 'rings', at: 'ringsDish', act: 'bat', reaction: 'knockoff', special: 'rings', hit: { r: 0.18, h: 0.25, y: -0.05 } },
  { id: 'nailPolish', at: 'nailPolish', act: 'stare', reaction: 'wobble', hit: { r: 0.12, h: 0.2 } },
  { id: 'choker', at: 'choker', act: 'bat', reaction: 'wobble', node: 'band', hit: { r: 0.2, h: 0.3, y: -0.1 } },
  { id: 'posterA', at: 'posterA', act: 'stare', reaction: 'wobble', hit: { r: 0.35, h: 0.8 } },
  { id: 'posterB', at: 'posterB', act: 'stare', reaction: 'wobble', hit: { r: 0.35, h: 0.8 } },
  { id: 'beanie', at: 'beanie', act: 'purr', reaction: 'soft', hit: { r: 0.22, h: 0.3, y: -0.05 } },
  { id: 'boots', at: 'boots', act: 'nudge', reaction: 'wobble', hit: { r: 0.22, h: 0.35 } },
  { id: 'teeChair', at: 'teeChair', act: 'nudge', reaction: 'soft', hit: { r: 0.4, h: 1.0 } },
  // living room
  { id: 'win1', at: 'livingWindow', node: 'glass', act: 'nudge', reaction: 'wobble', hit: { r: 0.5, h: 1.2, y: 0.8 } },
  { id: 'moth', at: 'moth', act: 'chase', reaction: 'chase', hit: { r: 0.3, h: 0.4, y: -0.2 } },
  { id: 'lamp', at: 'floorLamp', act: 'bat', reaction: 'toggle', toggle: 'livingLamp', hit: { r: 0.3, h: 1.6 } },
  { id: 'picture', at: 'picture', node: 'picture', act: 'nudge', reaction: 'wobble', special: 'picture', hit: { r: 0.45, h: 0.6, y: -0.05 } },
  { id: 'shelf', at: 'bookshelf', node: 'shelf_mug', act: 'bat', reaction: 'knockoff', special: 'shelfMug', hit: { r: 0.25, h: 0.3, y: -0.1 } },
  { id: 'books', at: 'bookshelf', node: 'books', act: 'nudge', reaction: 'wobble', special: 'books', hit: { r: 0.42, h: 1.0, y: -0.06 } },
  { id: 'laptop', at: 'laptop', act: 'purr', reaction: 'soft', hit: { r: 0.25, h: 0.25 } },
  { id: 'cushion', at: 'couch', node: 'cushion_L', act: 'sit', reaction: 'wobble', special: 'coin', hit: { r: 0.42, h: 0.4, y: -0.05 } },
  { id: 'sweater', at: 'couch', node: 'sweater', act: 'purr', reaction: 'soft', hit: { r: 0.3, h: 0.35, y: -0.1 } },
  { id: 'plant', at: 'livingPlant', act: 'water', reaction: 'wobble', hit: { r: 0.3, h: 0.7 } },
  { id: 'record', at: 'turntable', act: 'stare', reaction: 'wobble', special: 'record', hit: { r: 0.28, h: 0.25, y: 0.12 } },
  { id: 'recordCrate', at: 'recordCrate', act: 'nudge', reaction: 'wobble', hit: { r: 0.3, h: 0.3 } },
  { id: 'headphones', at: 'headphones', act: 'bat', reaction: 'wobble', hit: { r: 0.18, h: 0.15 } },
  { id: 'cassettes', at: 'cassettes', act: 'bat', reaction: 'wobble', hit: { r: 0.15, h: 0.15 } },
  { id: 'throw', at: 'throw', act: 'purr', reaction: 'soft', hit: { r: 0.3, h: 0.5 } },
  { id: 'mugBlack', at: 'mugBlack', act: 'stare', reaction: 'wobble', hit: { r: 0.14, h: 0.15 } },
  { id: 'midiKeys', at: 'midiKeys', act: 'nudge', reaction: 'keys', hit: { r: 0.3, h: 0.15 } },
  { id: 'mic', at: 'mic', act: 'stare', reaction: 'wobble', hit: { r: 0.2, h: 0.45 } },
  { id: 'audioInterface', at: 'audioInterface', act: 'sit', reaction: 'soft', hit: { r: 0.16, h: 0.12 } },
  { id: 'monitors', at: 'monitors', act: 'stare', reaction: 'wobble', hit: { r: 0.45, h: 0.3 } },
  { id: 'notebook', at: 'notebook', act: 'nudge', reaction: 'wobble', hit: { r: 0.17, h: 0.08 } },
  { id: 'earbuds', at: 'earbuds', act: 'bat', reaction: 'wobble', hit: { r: 0.1, h: 0.08 } },
  { id: 'cables', at: 'cables', act: 'bat', reaction: 'wobble', hit: { r: 0.18, h: 0.06 } },
  { id: 'dawLaptop', at: 'dawLaptop', act: 'stare', reaction: 'wobble', hit: { r: 0.2, h: 0.25 } },
  // kitchen
  { id: 'tap', at: 'counter', node: 'tap', act: 'bat', reaction: 'toggle', toggle: 'drip', hit: { r: 0.22, h: 0.35, y: -0.05 } },
  { id: 'basil', at: 'basil', act: 'stare', reaction: 'wobble', hit: { r: 0.18, h: 0.35 } },
  { id: 'mug', at: 'counter', node: 'mug', act: 'nudge', reaction: 'slide', special: 'mugEdge', hit: { r: 0.2, h: 0.25, y: -0.05 } },
  { id: 'fridge', at: 'fridge', node: 'door', act: 'stare', reaction: 'wobble', special: 'fridge', hit: { r: 0.5, h: 1.75, y: -0.1 } },
  { id: 'stash', at: 'underFridge', act: 'stare', reaction: 'reveal', special: 'stash', hit: { r: 0.35, h: 0.2 } },
  { id: 'box', at: 'box', act: 'sit', reaction: 'soft', hit: { r: 0.42, h: 0.45 } },
  { id: 'bowl', at: 'bowl', act: 'stare', reaction: 'wobble', hit: { r: 0.22, h: 0.15 } },
  { id: 'coffee', at: 'coffeeMaker', act: 'stare', reaction: 'wobble', special: 'coffee', hit: { r: 0.2, h: 0.42, y: -0.05 } },
  { id: 'coffeeBeans', at: 'coffeeBeans', act: 'nudge', reaction: 'wobble', hit: { r: 0.15, h: 0.25 } },
  // balcony
  { id: 'hi', at: 'neighbourCat', act: 'stare', reaction: 'wobble', special: 'blink', trigger: [8.3, 0, -1.55, 0.5, 1.2] },
  { id: 'tomato', at: 'tomatoes', act: 'water', reaction: 'count', special: 'tomatoes', hit: { r: 0.4, h: 0.9 } },
  { id: 'leaf', at: 'leaf', act: 'chase', reaction: 'chase', hit: { r: 0.35, h: 0.5, y: -0.25 } },
  { id: 'snail', at: 'snail', act: 'stare', reaction: 'wobble', hit: { r: 0.25, h: 0.25, y: -0.08 } },
  // fire escape (ids in assets/layouts/fire_escape.json)
  { id: 'herbs', at: 'herbs', act: 'stare', reaction: 'wobble', special: 'herbs', hit: { r: 0.4, h: 0.5 } },
  { id: 'pinwheel', at: 'pinwheel', node: 'wheel', act: 'bat', reaction: 'count', special: 'pinwheel', hit: { r: 0.25, h: 0.75, y: -0.5 } },
  { id: 'pigeon', at: 'pigeon', act: 'stare', reaction: 'wobble', special: 'pigeon', hit: { r: 0.3, h: 0.4 } },
  { id: 'socks', at: 'socks', node: 'sock_loose', act: 'bat', reaction: 'wobble', special: 'socks', hit: { r: 0.32, h: 0.6, y: -0.42 } },
  { id: 'goldfish', at: 'goldfish', act: 'stare', reaction: 'wobble', hit: { r: 0.3, h: 0.5, y: -0.3 } },
  { id: 'geranium', at: 'geranium', act: 'stare', reaction: 'wobble', special: 'petals', hit: { r: 0.45, h: 0.5 } },
  // rooftop (ids in assets/layouts/rooftop.json)
  { id: 'chimney', at: 'chimney', act: 'bat', reaction: 'wobble', special: 'chimney', hit: { r: 0.45, h: 1.7 } },
  { id: 'antenna', at: 'antenna', act: 'bat', reaction: 'wobble', hit: { r: 0.3, h: 2.0 } },
  { id: 'skylight', at: 'skylight', act: 'stare', reaction: 'wobble', hit: { r: 0.6, h: 1.0 } },
  { id: 'puddle', at: 'puddle', act: 'water', reaction: 'wobble', special: 'puddle', hit: { r: 0.5, h: 0.3 } },
  { id: 'chair', at: 'chair', act: 'purr', reaction: 'soft', hit: { r: 0.4, h: 1.0 } },
  { id: 'partyTable', at: 'partyTable', act: 'stare', reaction: 'wobble', hit: { r: 0.6, h: 1.2 } },
  { id: 'stringLights', at: 'partyLightsSpot', act: 'stare', reaction: 'wobble', special: 'bulbs', hit: { r: 0.6, h: 1.4 } },
  { id: 'roofEdge', at: 'roofEdge', act: 'stare', reaction: 'wobble', hit: { r: 0.45, h: 0.7 } },
  // street (assets/layouts/street.json, placed by src/town.js). town: the touch spot from the layout's `things` entry:
  //   r radius, h height, y offset of its bottom, from: 'secret' (use the secret's spot instead)
  { id: 'coffeeShop', at: 'coffeeShop', act: 'stare', reaction: 'wobble', town: { r: 0.7, h: 1.2 } },
  { id: 'espressoMachine', at: 'espressoMachine', act: 'stare', reaction: 'wobble', special: 'espresso', town: { r: 0.45, h: 1.0, y: -0.45 } },
  { id: 'espressoCups', at: 'espressoCups', act: 'stare', reaction: 'wobble', special: 'cups', town: { r: 0.3, h: 0.45 } },
  { id: 'cafeTable', at: 'cafeTable', act: 'sit', reaction: 'wobble', town: { r: 0.55, h: 0.75 } },
  { id: 'chalkboard', at: 'chalkboard', act: 'nudge', reaction: 'wobble', town: { r: 0.45, h: 1.0 } },
  { id: 'chalk', at: 'chalk', act: 'sit', reaction: 'wobble', town: { r: 0.45, h: 0.5 } },
  { id: 'burgerStand', at: 'burgerStand', act: 'stare', reaction: 'wobble', special: 'food', town: { r: 0.8, h: 1.5 } },
  { id: 'ramenWindow', at: 'ramenWindow', act: 'stare', reaction: 'wobble', special: 'ramen', town: { r: 0.8, h: 1.5 } },
  { id: 'medGrill', at: 'medGrill', act: 'stare', reaction: 'wobble', special: 'grill', town: { r: 0.8, h: 1.5 } },
  { id: 'vend', at: 'vend', act: 'bat', reaction: 'wobble', special: 'vend', town: { r: 0.55, h: 1.5 } },
  { id: 'hydrant', at: 'hydrant', act: 'stare', reaction: 'wobble', town: { r: 0.4, h: 0.9 } },
  { id: 'slamp', at: 'slamp', act: 'bat', reaction: 'wobble', special: 'slamp', town: { r: 0.42, h: 1.5 } },
  { id: 'drain', at: 'drain', act: 'stare', reaction: 'wobble', special: 'drain', town: { r: 0.42, h: 0.6 } },
  { id: 'mail', at: 'mail', act: 'bat', reaction: 'wobble', special: 'mail', town: { r: 0.42, h: 1.2 } },
  { id: 'bike', at: 'bike', act: 'bat', reaction: 'wobble', special: 'bike', town: { r: 0.55, h: 1.1 } },
  // the alley mouth (part of the street layout)
  { id: 'dumpster', at: 'dumpster', act: 'bat', reaction: 'wobble', special: 'dumpster', town: { r: 0.95, h: 1.6 } },
  { id: 'crates', at: 'crates', act: 'nudge', reaction: 'wobble', town: { r: 0.42, h: 0.9 } },
  { id: 'catNook', at: 'catNook', act: 'stare', reaction: 'wobble', town: { r: 0.5, h: 0.8 } },
  { id: 'tabby', at: 'tabby', act: 'stare', reaction: 'sit', special: 'tabby', town: { r: 0.42, h: 0.8 } },
  // corner shop (assets/layouts/corner_shop.json)
  { id: 'keeper', at: 'keeper', act: 'stare', reaction: 'sit', special: 'keeper', town: { r: 0.55, h: 1.6, y: -0.75 } },
  { id: 'lucky', at: 'lucky', act: 'stare', reaction: 'wobble', special: 'lucky', town: { r: 0.28, h: 0.6 } },
  { id: 'radio', at: 'radio', act: 'bat', reaction: 'wobble', special: 'radio', town: { r: 0.28, h: 0.6 } },
  { id: 'register', at: 'register', act: 'bat', reaction: 'wobble', special: 'register', town: { r: 0.32, h: 0.6 } },
  { id: 'mouse', at: 'mouse', act: 'stare', reaction: 'wobble', special: 'mouse', sitReact: true, town: { r: 0.45, h: 0.5 } },
  { id: 'cans', at: 'cans', act: 'bat', reaction: 'wobble', special: 'cans', town: { r: 0.5, h: 0.9 } },
  // park (assets/layouts/park.json)
  { id: 'tree', at: 'tree', act: 'bat', reaction: 'wobble', special: 'tree', town: { r: 0.7, h: 1.2 } },
  { id: 'frog', at: 'frog', act: 'stare', reaction: 'wobble', special: 'frog', town: { r: 1.05, h: 0.8, from: 'secret' } }, // stared at from the pond's edge
  { id: 'bench', at: 'bench', act: 'purr', reaction: 'soft', town: { r: 0.7, h: 1.0, y: -0.47 } },
  { id: 'kitten', at: 'kitten', act: 'stare', reaction: 'sit', special: 'kitten', town: { r: 0.8, h: 0.8 } },
  { id: 'swing', at: 'swing', act: 'nudge', reaction: 'wobble', special: 'swing', town: { r: 0.7, h: 1.2 } },
  { id: 'flies', at: 'flies', act: 'chase', reaction: 'chase', special: 'flies', town: { r: 1.4, h: 1.6 } },
  { id: 'flowers', at: 'flowers', act: 'stare', reaction: 'wobble', special: 'flowers', sitReact: true, town: { r: 0.6, h: 1.0 } },
  { id: 'birdhouse', at: 'birdhouse', act: 'stare', reaction: 'wobble', special: 'birdhouse', town: { r: 0.55, h: 0.8 } },
  { id: 'pond', at: 'pond', act: 'water', reaction: 'wobble', special: 'pond', town: { r: 1.0, h: 0.8 } },
];

// how each apartment secret is found (the words are in lines.js; these are their triggers)
//   taps: N touches of a thing in one night | sit: S seconds sitting at a thing | once: first touch
//   late: only in the last third of the night | custom: handled by name in home.js
export const SECRET_RULES = {
  'five-rings': { thing: 'rings', taps: 5 },
  camouflage: { custom: true },             // still on the bed 5 s, outside the sleep question
  'glow-moon': { custom: true },            // touch posterB with the bedside lamp off
  'the-beanie': { thing: 'beanie', sit: 3 },
  'b-side': { custom: true },               // recordCrate x3, then the turntable, same night
  'warm-laptop': { thing: 'laptop', once: true },
  'couch-money': { thing: 'cushion', taps: 3 },
  gravity: { thing: 'shelf', once: true },
  'the-composition': { custom: true },      // walk the keyboard end to end in one go
  'warm-box': { thing: 'audioInterface', sit: 3 },
  'the-recording': { thing: 'mic', sit: 3 },
  coffee: { thing: 'coffee', sit: 3, late: true },
  fridge: { thing: 'fridge', taps: 3 },
  stash: { custom: true },                  // under the fridge once the hair tie has ever been batted
  'slow-blink': { thing: 'hi', taps: 3 },
  'shooting-star': { custom: true },        // hop while a shooting star is crossing the balcony sky
  // fire escape
  'sock-hat': { thing: 'socks', taps: 3 },   // the third bat drops the loose sock on Ghost's head (home.js)
  'puffed-pigeon': { thing: 'pigeon', taps: 3 },
  goldfish: { thing: 'goldfish', sit: 4 },   // the fish comes to the glass while Ghost sits there
  // rooftop
  'party-roof': { thing: 'partyTable', sit: 5, late: true },
  'smoke-ring': { custom: true },            // bat the chimney 3 times, then hop through the ring it puffs out
  skylight: { custom: true },                // land on the skylight from above, then sit there 3 s
  // street
  'warm-sill': { custom: true, spot: 'warm-sill', sit: 4, r: 0.45, dy: 0.75 },        // on the coffee shop's sill cushion (home.js)
  'the-little-table': { custom: true, spot: 'the-little-table', sit: 3, r: 0.62, dy: 0.5, hiss: true }, // ...while the machine hisses
  'food-tour': { custom: true },              // the burger stand, the ramen window and the grill, one night
  'moths-into-stars': { thing: 'slamp', taps: 3 },
  'singing-drain': { thing: 'drain', sit: 3 },
  // corner shop
  shopkeeper: { thing: 'keeper', sit: 4 },
  // park
  follower: { thing: 'kitten', sit: 4 },     // then the grey kitten follows Ghost for the rest of the night (src/town.js)
  frog: { thing: 'frog', taps: 3 },          // the third stare: the frog jumps clean over Ghost
  firefly: { thing: 'flies', taps: 3 },      // walking in, or hopping among them, is a chase (home.js)
  // alley
  'tabby-nook': { thing: 'catNook', sit: 4, unless: 'tabby' },
  'crate-top': { custom: true },             // land on the top crate from above
  'dumpster-echo': { thing: 'dumpster', taps: 3 },
};

// journal entries for every secret in lines.js (all areas; the ones outside home show as silhouettes)
const ICONS = { bedroom: 'moon', living: 'frame', kitchen: 'mug', balcony: 'star', 'fire-escape': 'leaf', rooftop: 'star', street: 'coin', 'corner-shop': 'box', park: 'leaf', alley: 'box' };
const ICON_BY_ID = { 'warm-sill': 'mug', 'the-little-table': 'mug', 'moths-into-stars': 'star', shopkeeper: 'heart', follower: 'heart', 'tabby-nook': 'heart', 'five-rings': 'ring', 'the-beanie': 'sweater', 'warm-laptop': 'laptop', 'couch-money': 'coin', gravity: 'mug', fridge: 'fridge', stash: 'ring', 'slow-blink': 'heart', 'shooting-star': 'star', coffee: 'mug', 'the-recording': 'heart', 'the-composition': 'star', 'warm-box': 'box', 'b-side': 'coin', camouflage: 'blanket', 'glow-moon': 'moon', 'sock-hat': 'sweater', 'puffed-pigeon': 'heart', goldfish: 'heart', 'party-roof': 'star', 'smoke-ring': 'star', skylight: 'moon' };
export const HOME_ENTRIES = LINES.secrets.map((s) => ({ id: s.id, room: s.area, title: s.title, note: s.entry, hint: s.hint, glimmers: s.glimmers, icon: ICON_BY_ID[s.id] || ICONS[s.area] || 'star' }));
export const HOME_ROOMS = [
  { id: 'bedroom', name: 'the bedroom' }, { id: 'living', name: 'the living room' }, { id: 'kitchen', name: 'the kitchen' }, { id: 'balcony', name: 'the balcony' },
  { id: 'fire-escape', name: 'the fire escape' }, { id: 'rooftop', name: 'the rooftop' }, { id: 'street', name: 'the street' },
  { id: 'corner-shop', name: 'the corner shop' }, { id: 'park', name: 'the park' }, { id: 'alley', name: 'the alley' },
];
