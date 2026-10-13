// Every touchable thing in the apartment, as data. Carried over from the 2D build's design inventory.
//
//   id        unique id (also the save key)
//   room      bedroom | living | kitchen | balcony
//   at        which placed object it belongs to (a key in apartment.js PLACEMENTS); node = child node in it
//   act       what Ghost does on getting there: bat | nudge | stare | sit | purr | chase | water
//   reaction  what the thing does: wobble | toggle | knockoff | slide | sit | chase | sleep | door | count | reveal
//   toggle    for reaction 'toggle': the night-state switch it flips (bedLamp, livingLamp, curtains, drip)
//   special   extra one-off behaviour handled in game.js (picture, fridge, blanket, hairTie, coin, blink, wink...)
//   lines     what Ghost says, cycling. {name} = the cat's name. Toggles use [on line, off line].
//   secret    { entry, taps: N } poke N times in one night | { entry, sit: S } sit near it S seconds |
//             { entry, once: true } first poke; plus optional requires: { toggle: [key, value] },
//             { found: entryId }, { decoration: id }
//   hit       tap target: { r, h, y } radius/height/base of the invisible cylinder (metres)
//   seat      for sit/sleep: [dx, y, dz] where Ghost settles, relative to the object
//   glimmer   glimmers the first time it's poked each night (default 1)

export const ROOMS = [
  { id: 'bedroom', name: 'the bedroom' },
  { id: 'living', name: 'the living room' },
  { id: 'kitchen', name: 'the kitchen' },
  { id: 'balcony', name: 'the balcony' },
];

export const THINGS = [
  // ---------------------------------------------------------------- bedroom
  { id: 'bed', room: 'bedroom', at: 'bed', act: 'sit', reaction: 'sleep', seat: [0.15, 0.62, 0.05], hit: { r: 0.6, h: 0.9 }, lines: ['the bed. for later. or now.'] },
  { id: 'blanket', room: 'bedroom', at: 'bed', node: 'blanket', act: 'nudge', reaction: 'wobble', special: 'blanket', hit: { r: 0.55, h: 0.75, y: 0.1 },
    lines: ['the blanket is still warm. suspicious.', 'lumpy. needs more inspecting.', 'deeper...'], secret: { entry: 'blanket-fort', taps: 3 } },
  { id: 'curtain', room: 'bedroom', at: 'bedWindow', node: 'curtain_L', act: 'nudge', reaction: 'toggle', toggle: 'curtains', hit: { r: 0.25, h: 1.6, y: 0.7 },
    lines: ['curtains: open. hello, moon.', 'curtains: closed. the moon can wait.'] },
  { id: 'beam', room: 'bedroom', at: 'moonbeam', act: 'sit', reaction: 'sit', seat: [0, 0.03, 0], hit: { r: 0.55, h: 0.3 },
    lines: ['moonlight on the floor. it looks warm.', 'a good spot for sitting.'], secret: { entry: 'moonbeam', sit: 3, requires: { toggle: ['curtains', true] } } },
  { id: 'moon0', room: 'bedroom', at: 'bedWindow', node: 'glass', act: 'stare', reaction: 'wobble', special: 'wink', hit: { r: 0.4, h: 0.9, y: 0.8 },
    lines: ['the moon is out.', 'the moon is still out.', 'the moon...'], secret: { entry: 'moon-wink', taps: 3, requires: { toggle: ['curtains', true] } } },
  { id: 'hairtie', room: 'bedroom', at: 'hairTie', act: 'bat', reaction: 'knockoff', special: 'hairTie', hit: { r: 0.25, h: 0.25, y: -0.05 },
    lines: ['bat.', 'already batted. it lives under the fridge now.'], secret: { entry: 'hair-tie', once: true } },
  { id: 'nlamp', room: 'bedroom', at: 'nightstand', node: 'lamp', act: 'bat', reaction: 'toggle', toggle: 'bedLamp', hit: { r: 0.25, h: 0.35, y: 0.5 },
    lines: ['click.', 'clack.'] },
  { id: 'slippers', room: 'bedroom', at: 'slippers', act: 'nudge', reaction: 'wobble', special: 'slippers', hit: { r: 0.3, h: 0.3 },
    lines: ['slippers rearranged. art.', 'slippers lined up. boring.'] },
  { id: 'underbed', room: 'bedroom', at: 'underBed', act: 'stare', reaction: 'reveal', special: 'dustBunny', hit: { r: 0.4, h: 0.3 },
    lines: ['the dust bunny is not moving. neither am I.', 'it twitched. I saw it.'], secret: { entry: 'dust-bunny', once: true } },

  // ---------------------------------------------------------------- living room
  { id: 'win1', room: 'living', at: 'livingWindow', node: 'glass', act: 'nudge', reaction: 'door', hit: { r: 0.55, h: 1.2, y: 0.8 },
    lines: ['the fire escape is out there. another night.', 'the window is stuck. for now.'] },
  { id: 'moth', room: 'living', at: 'moth', act: 'chase', reaction: 'chase', hit: { r: 0.3, h: 0.4, y: -0.2 },
    lines: ['the moth prefers the window. rude.', 'too fast. too fluttery.'], secret: { entry: 'moths-dance', once: true, requires: { toggle: ['livingLamp', true] } } },
  { id: 'lamp', room: 'living', at: 'floorLamp', act: 'bat', reaction: 'toggle', toggle: 'livingLamp', hit: { r: 0.3, h: 1.6 },
    lines: ['click. light.', 'click. dark.'] },
  { id: 'picture', room: 'living', at: 'picture', node: 'picture', act: 'nudge', reaction: 'wobble', special: 'picture', hit: { r: 0.45, h: 0.6, y: -0.05 },
    lines: ['straight. for now.', 'straight again. watch it.', 'it moved. pictures move.'], secret: { entry: 'crooked-picture', taps: 3 } },
  { id: 'shelf', room: 'living', at: 'bookshelf', node: 'shelf_mug', act: 'bat', reaction: 'knockoff', special: 'shelfMug', hit: { r: 0.25, h: 0.3, y: -0.1 },
    lines: ['a mug. on the edge of a shelf. hm.', 'the mug is already on the floor. job done.'], secret: { entry: 'gravity', once: true } },
  { id: 'books', room: 'living', at: 'bookshelf', node: 'books', act: 'nudge', reaction: 'wobble', special: 'books', hit: { r: 0.42, h: 1.0, y: -0.06 },
    lines: ['books. mostly about birds.', 'a book wobbled. it was nervous.'] },
  { id: 'laptop', room: 'living', at: 'laptop', act: 'purr', reaction: 'sit', seat: [0, 0.03, 0.02], hit: { r: 0.25, h: 0.25 },
    lines: ['warm. very warm.', 'jjjjjjjjjjjjj'], secret: { entry: 'warm-laptop', once: true } },
  { id: 'cushion', room: 'living', at: 'couch', node: 'cushion_L', act: 'sit', reaction: 'wobble', special: 'coin', seat: [-0.34, 0.6, 0.12], hit: { r: 0.42, h: 0.4, y: -0.05 },
    lines: ['knead.', 'knead, knead.', 'something in there...'], secret: { entry: 'couch-money', taps: 3 } },
  { id: 'sweater', room: 'living', at: 'couch', node: 'sweater', act: 'purr', reaction: 'sit', seat: [0.7, 0.66, 0.08], hit: { r: 0.3, h: 0.35, y: -0.1 },
    lines: ['the grey sweater. soft. maybe stay a while.', 'very sittable.'], secret: { entry: 'grey-sweater', sit: 3 } },
  { id: 'plant', room: 'living', at: 'livingPlant', act: 'water', reaction: 'wobble', hit: { r: 0.35, h: 0.7 },
    lines: ['the plant is fine. stop fussing.', 'a splash for the plant.'] },

  // ---------------------------------------------------------------- kitchen
  { id: 'tap', room: 'kitchen', at: 'counter', node: 'tap', act: 'bat', reaction: 'toggle', toggle: 'drip', hit: { r: 0.22, h: 0.35, y: -0.05 },
    lines: ['drip again. classic.', 'no drips. very professional.'], secret: { entry: 'plumber', once: true, requires: { toggle: ['drip', false] } } },
  { id: 'basil', room: 'kitchen', at: 'basil', act: 'stare', reaction: 'wobble', hit: { r: 0.22, h: 0.35 },
    lines: ['basil. smells like summer.', 'not for eating. for sniffing.'] },
  { id: 'mug', room: 'kitchen', at: 'counter', node: 'mug', act: 'nudge', reaction: 'slide', special: 'mugEdge', hit: { r: 0.22, h: 0.25, y: -0.05 },
    lines: ['a little closer to the edge.', 'closer...', 'right on the edge. leaving it there.'], secret: { entry: 'edge', taps: 3 } },
  { id: 'fridge', room: 'kitchen', at: 'fridge', node: 'door', act: 'stare', reaction: 'wobble', special: 'fridge', hit: { r: 0.5, h: 1.75, y: -0.1 },
    lines: ['the fridge did not open.', 'still closed. staring harder.', 'any second now...'], secret: { entry: 'fridge', taps: 3 } },
  { id: 'stash', room: 'kitchen', at: 'underFridge', act: 'stare', reaction: 'reveal', special: 'stash', hit: { r: 0.35, h: 0.2 },
    lines: ['dark under there. needs a collection.', 'the collection is safe.'], secret: { entry: 'stash', once: true, requires: { found: 'hair-tie' } } },
  { id: 'box', room: 'kitchen', at: 'box', act: 'sit', reaction: 'sit', seat: [0, 0.2, 0], hit: { r: 0.42, h: 0.45 },
    lines: ['the box is still a box. good.', 'perfect fit.'], secret: { entry: 'box', once: true } },
  { id: 'bowl', room: 'kitchen', at: 'bowl', act: 'stare', reaction: 'wobble', hit: { r: 0.25, h: 0.15 },
    lines: ['empty. checked anyway.', 'still empty. checked twice.'] },
  { id: 'fishT', room: 'kitchen', at: 'fishbowl', act: 'stare', reaction: 'sit', needs: 'fishbowl', hit: { r: 0.25, h: 0.35 },
    lines: ['the fish is staring back.', 'only watching. promise.'], secret: { entry: 'fish-tv', sit: 3, requires: { decoration: 'fishbowl' } } },

  // ---------------------------------------------------------------- the owner's things and the vibe props
  { id: 'rings', room: 'bedroom', at: 'ringsDish', act: 'bat', reaction: 'knockoff', special: 'rings', hit: { r: 0.18, h: 0.25, y: -0.05 },
    lines: ['a silver ring. bat.', 'another ring. the floor is collecting them.', 'rings are for batting.', 'one left. it knows.', 'all five on the floor. as they should be.'], secret: { entry: 'five-rings', taps: 5 } },
  { id: 'beanie', room: 'bedroom', at: 'beanie', act: 'purr', reaction: 'sit', hit: { r: 0.22, h: 0.3, y: -0.05 },
    lines: ['the beanie still smells like outside.', 'a good hat. for napping in.'], secret: { entry: 'the-beanie', sit: 3 } },
  { id: 'record', room: 'living', at: 'turntable', act: 'stare', reaction: 'wobble', special: 'record', hit: { r: 0.3, h: 0.3, y: -0.05 },
    lines: ['the record is turning. it does not mind being watched.', 'round and round. {name} could watch this all night.', 'the needle hums along.'], secret: { entry: 'the-record', taps: 3 } },
  { id: 'coffee', room: 'kitchen', at: 'coffeeMaker', act: 'stare', reaction: 'wobble', special: 'coffee', hit: { r: 0.22, h: 0.42, y: -0.05 },
    lines: ['the coffee machine gurgled. it smells like mornings.', 'blub. blub.'], secret: { entry: 'coffee', sit: 3 } },

  // ---------------------------------------------------------------- balcony
  { id: 'stars', room: 'balcony', at: 'sky', act: 'stare', reaction: 'wobble', hit: { r: 5, h: 6 },
    lines: ['counting stars. one, two, lots.', 'the sky is busy tonight.'] },
  { id: 'moon', room: 'balcony', at: 'skyMoon', act: 'purr', reaction: 'wobble', hit: { r: 2.5, h: 5, y: -2.5 },
    lines: ['still there. good.', 'the moon says nothing. good company.'] },
  { id: 'hi', room: 'balcony', at: 'neighbourCat', act: 'stare', reaction: 'wobble', special: 'blink', hit: { r: 0.35, h: 0.6 },
    lines: ['the cat next door is pretending not to see.', 'still pretending.', 'it looked. it looked!'], secret: { entry: 'slow-blink', taps: 3 } },
  { id: 'tomato', room: 'balcony', at: 'tomatoes', act: 'water', reaction: 'count', special: 'tomatoes', hit: { r: 0.4, h: 0.9 },
    lines: ['one tomato.', 'two tomatoes.', 'three...'], secret: { entry: 'three-tomatoes', taps: 3 } },
  { id: 'leaf', room: 'balcony', at: 'leaf', act: 'chase', reaction: 'chase', hit: { r: 0.35, h: 0.5, y: -0.25 },
    lines: ['leaves fall. that is what they do.'], secret: { entry: 'best-leaf', once: true } },
  { id: 'snail', room: 'balcony', at: 'snail', act: 'stare', reaction: 'wobble', hit: { r: 0.25, h: 0.25, y: -0.08 },
    lines: ['a snail on the railing. it is going somewhere. slowly.', 'it has moved. probably.', 'we are racing. I am winning.'] },
];

// Journal entries for the apartment (2D entries 1-21). Unfound ones show the hint under a silhouette.
export const ENTRIES = [
  { id: 'blanket-fort', room: 'bedroom', title: 'the blanket fort', note: "under the blanket there's a whole country. population: me.", hint: 'the blanket. again. and again.', icon: 'blanket' },
  { id: 'moonbeam', room: 'bedroom', title: 'the moonbeam', note: 'the moonbeam is warm if you believe it is. I believe it.', hint: 'sit in the moonlight', icon: 'moon' },
  { id: 'hair-tie', room: 'bedroom', title: 'the hair tie', note: 'one hair tie, batted off the nightstand. that is the law.', hint: 'the nightstand', icon: 'ring' },
  { id: 'moon-wink', room: 'bedroom', title: "the moon's wink", note: 'tapped the window three times. the moon winked. we have an understanding.', hint: 'the moon in the window. more than once.', icon: 'moon' },
  { id: 'dust-bunny', room: 'bedroom', title: 'the dust bunny', note: 'under the bed: one dust bunny. we are not friends. we are not enemies.', hint: 'look under things', icon: 'fluff' },
  { id: 'moths-dance', room: 'living', title: "the moth's dance", note: 'with the lamp on, the moth and I danced. it led.', hint: 'light first, then chase', icon: 'moth' },
  { id: 'crooked-picture', room: 'living', title: 'the crooked picture', note: 'straightened the picture three times. it prefers crooked. so do I, now.', hint: 'the picture. persistently.', icon: 'frame' },
  { id: 'gravity', room: 'living', title: 'gravity', note: 'tested gravity with a mug. still works. will check again tomorrow.', hint: 'the shelf', icon: 'mug' },
  { id: 'warm-laptop', room: 'living', title: 'the warm laptop', note: 'the laptop is warm and says jjjjjjjj when I sit on it. a good machine.', hint: 'something warm', icon: 'laptop' },
  { id: 'couch-money', room: 'living', title: 'couch money', note: 'kneaded the cushion until it gave me a coin. couch money.', hint: 'knead. knead. knead.', icon: 'coin', glimmers: 8 },
  { id: 'grey-sweater', room: 'living', title: 'the grey sweater', note: 'the grey sweater is officially mine now. it smells like naps.', hint: 'sit on something soft', icon: 'sweater' },
  { id: 'plumber', room: 'kitchen', title: 'the plumber', note: "drip. drip. no drip. I'm a plumber now.", hint: 'the tap', icon: 'drop' },
  { id: 'fridge', room: 'kitchen', title: 'the fridge', note: 'stared until the fridge opened. no ham. there is never ham.', hint: 'stare. keep staring.', icon: 'fridge' },
  { id: 'stash', room: 'kitchen', title: 'the stash', note: 'under the fridge: my collection. 14 hair ties, a bottle cap, one olive.', hint: 'under the fridge, once there is something to hide', icon: 'ring' },
  { id: 'edge', room: 'kitchen', title: 'the edge', note: 'pushed the mug to the very edge, then stopped. that is power.', hint: 'push. push. push.', icon: 'mug' },
  { id: 'box', room: 'kitchen', title: 'the box', note: 'if I fits, I sits. the box agreed.', hint: 'a box', icon: 'box' },
  { id: 'fish-tv', room: 'kitchen', title: 'fish TV', note: 'watched the fish. only watched. it watched back. a draw.', hint: 'needs a fishbowl. then: watch.', icon: 'fish' },
  { id: 'five-rings', room: 'bedroom', title: 'five rings', note: 'batted all five rings off the little dish. they are on the floor now. where they belong.', hint: 'the little dish on the sill. all of it.', icon: 'ring' },
  { id: 'the-beanie', room: 'bedroom', title: 'the beanie', note: 'napped in the beanie. it is a bed now. sorry.', hint: 'something soft on the bed, worn outside', icon: 'sweater' },
  { id: 'the-record', room: 'living', title: 'the record', note: 'watched the record go round three times. it went round some more. a good show.', hint: 'the thing that spins', icon: 'coin' },
  { id: 'coffee', room: 'kitchen', title: 'coffee', note: 'sat by the coffee machine until it gurgled. it smells like mornings in here now.', hint: 'sit by the warm machine', icon: 'mug' },
  { id: 'shooting-star', room: 'balcony', title: 'a shooting star', note: 'caught a shooting star with my eyes. wished for ham.', hint: 'wait for the sky to do something', icon: 'star' },
  { id: 'slow-blink', room: 'balcony', title: 'the slow blink', note: 'the ginger cat next door slow-blinked at me. friends now. official.', hint: 'say hi. three times.', icon: 'heart' },
  { id: 'three-tomatoes', room: 'balcony', title: 'three tomatoes', note: 'there are three tomatoes. I counted twice. still three.', hint: 'count the tomatoes', icon: 'tomato' },
  { id: 'best-leaf', room: 'balcony', title: 'the best leaf', note: 'caught a falling leaf. it was the best leaf. I let it go.', hint: 'something falls', icon: 'leaf' },
];

export const ENTRY_GLIMMERS = 5;

export const NIGHT_LINES = [
  'night {n}. the moon is up. so is {name}.',
  'night {n}. everything is quiet and touchable.',
  'night {n}. the floorboards say hello.',
  'night {n}. the city is asleep. mostly.',
];

export const MORNING_LINES = [
  'morning. the sun found the warm spot before {name} did. rude.',
  '{name} would like it noted that the mug started it.',
  'morning. birds outside. {name} has opinions about all of them.',
  'the sun is up. {name} is asleep in a perfect circle.',
  'morning. the moth is still out there. plotting.',
  'a new day. the box is still a box. good.',
  'morning. the city is loud again. {name} naps through it professionally.',
  'the light comes in sideways. {name} goes to find the warm square of it.',
];

// Night-state switches and their values at the start of every night.
export const NIGHT_DEFAULTS = { bedLamp: true, livingLamp: true, curtains: true, drip: true };
