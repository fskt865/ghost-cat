// Every number that decides how Ghost feels to control, in one place. Units: metres, seconds, radians.
// Change a value, reload the page.
//
// Ghost's size comes from config.js (cat.heightM). Body, camera and reach scale with it; the hop heights
// scale too but never drop below what the course is built for (every step on the course is at most
// COURSE_STEP high, and every gap is at most COURSE_GAP wide), so a smaller cat can still go everywhere.
import { CONFIG } from './config.js';

const H = CONFIG.cat.heightM || 0.5;   // Ghost's height in metres
const S = H / 0.5;                     // these numbers were first tuned at 0.5 m
export const COURSE_STEP = 0.85;       // tallest single-hop step the course asks for
export const COURSE_GAP = 2.0;         // widest gap the course asks for (with float)

export const TUNING = {
  // --- body (a capsule as tall as Ghost is) -----------------------------------------------------
  radius: 0.4 * H,        // capsule radius
  height: H,              // capsule total height (feet to top)
  hover: 0.1 * H,         // how far the ghost model floats above the capsule's feet

  // --- running ----------------------------------------------------------------------------
  runSpeed: 3.8,          // top speed at full stick
  walkSpeed: 1.4,         // speed at a light touch (stick between dead zone and ~40%)
  groundAccel: 26,        // how fast Ghost reaches the stick speed on the ground
  groundDecel: 30,        // how fast Ghost stops when the stick is released ("short ease")
  turnBoost: 1.8,         // extra acceleration when reversing direction (snappy turns)
  airAccel: 11,           // air control: steering while hopping/floating (slower than ground)
  airDecel: 3,            // drift kept in the air when the stick is released
  maxSlope: 0.8,          // radians (~46°): steeper than this is a wall
  stepHeight: Math.max(0.2, 0.68 * H), // curbs (0.15 m) and small ledges Ghost walks straight up

  // --- hopping ----------------------------------------------------------------------------
  gravity: 24,            // m/s² while rising or falling normally
  jumpHeight: Math.max(COURSE_STEP + 0.15, 2.3 * H), // a tap hop clears this much
  airJumpHeight: Math.max(0.5, 1.2 * H), // the small second hop (tap again in the air)
  airJumps: 1,            // how many second hops before landing
  coyoteTime: 0.14,       // after running off an edge Ghost can still hop for this long
  jumpBuffer: 0.16,       // a tap this long before landing still hops on landing
  maxFall: 14,            // terminal fall speed without float

  // --- floating (hold the hop button in the air) -------------------------------------------
  floatGravity: 4,        // gravity while floating down
  floatFallSpeed: 1.05,   // gentle top fall speed while floating
  floatAirAccelScale: 1.15, // a touch more steering while floating
  autoFloatHeight: 2.2,   // a fall longer than this floats automatically even without holding (no fail state)
  autoFloatFallSpeed: 2.6,// ...at this speed (holding the button floats slower still)

  // --- forgiveness --------------------------------------------------------------------------
  ledgeReach: 0.72 * H,   // a ledge this far ahead of Ghost's reach...
  ledgePop: Math.max(0.5, 1.2 * H), // ...and at most this far above Ghost's feet: Ghost pops up onto it
  magnetRadius: 1.1 * H,  // while falling with nothing below, Ghost is drawn toward ground this close
  magnetPull: 2.2,        // m/s of sideways pull toward that ground
  groundSnap: 0.28,       // stays stuck to slopes and steps going down this far
  respawnBelow: -8,       // falling below this height drifts Ghost back to the last safe spot
  pitDrop: 1.4,           // falling this far off the edge of the built world floats Ghost back up (alleys are real places, not pits)
  floatBackTime: 1.6,     // seconds the drift back up from the courtyard takes (home: off the fire escape)
  floatBackArc: 1.2,      // ...and how high it arcs on the way
  smokeRingReach: 0.42,   // how close (m, sideways) a hop has to pass the chimney's smoke ring to go through it
  smokeRingHang: 0.62,    // the ring hangs this far above Ghost's middle when standing on the roof (a hop reaches ~1.0)

  // --- the night ------------------------------------------------------------------------------
  nightMinutes: 18,       // the night clock: about this much play, or until Ghost sleeps. 'late' = its last third
  bedAskAfter: 2.5,       // seconds sitting still on the pillow end of the bed before 'sleep till morning?'

  // --- how Ghost reads against the night ---------------------------------------------------------
  ghostRim: 0.9,          // thin fresnel edge on Ghost's silhouette, in the asset's rimColour (raise this if Ghost gets lost)
  ghostRimPower: 4.5,     // how tight the rim hugs the edge: high, so it sits on the outline, not across Ghost's body
  ghostHemFloor: 0.6,     // the faded hem never goes below this opacity (keeps Ghost black, not see-through blue)

  // --- touch controls -----------------------------------------------------------------------
  stickRadius: 58,        // px the knob can travel from where the thumb landed
  stickDeadZone: 0.14,    // fraction of the radius that does nothing
  stickCurve: 1.35,       // >1 = finer control near the centre
  stickFollow: true,      // the base follows the thumb if it drags past the edge
  jumpButtonSize: 96,     // px diameter of the hop button
  tapZoneDelay: 0.11,     // right-half fallback: a press that has not moved after this long is a hop

  // --- camera -----------------------------------------------------------------------------
  // The follow distance is not a fixed number of metres: it is worked out from how tall Ghost
  // should look on screen, so the feel is the same on every screen and at any cat size.
  camScreenShare: 1 / 6.5,       // landscape, iPad, Mac: Ghost stands about 1/6.5 of the screen height
  camScreenSharePortrait: 1 / 8, // phone portrait: about 1/8 (90-110 px on a 390x844 phone)
  camDistance: 2.4,       // only the starting value; the real distance comes from the two lines above
  camPitch: 0.27,         // angle above horizontal: low enough to see Ghost's face, high enough to judge hops
  camHeight: 1.1 * H,     // the point it looks at, above Ghost's feet
  camFov: 55,             // vertical field of view in landscape
  camFovPortrait: 62,     // a little wider in portrait (more of the path to the sides)
  camLead: 0.22,          // seconds of travel it looks ahead (the camera stays behind Ghost; only its aim leads)
  camFollowH: 7,          // horizontal follow stiffness
  camFollowV: 3.2,        // vertical follow stiffness (soft, so hops don't bounce the view)
  camAutoYaw: 1.7,        // how quickly it swings behind Ghost while Ghost runs (rad/s at full speed)
  camAutoYawMaxAngle: 1.9,// it only swings when Ghost runs within this angle of "away" (no flips)
  camFallPitch: 0.25,     // extra look-down while falling fast
  camNudgeYaw: 0.006,     // rad per px of a right-half swipe
  camNudgePitch: 0.004,
  camRecentre: 1.6,       // seconds after a swipe before it drifts back
  camWallMargin: 0.3,     // keeps this far in front of walls between it and Ghost
  camMinDistance: 2.4 * H,      // closest it ever gets (in front of a wall)
  camMaxZoom: 1.25,             // zones may pull back at most this much (open rooftops, the hill)
  idleFaceCamera: 1.2,          // after standing still this long Ghost turns three-quarters toward the camera

  // --- the street, the corner shop, the alley and the park (src/town.js) ------------------------
  camZoomStreet: 1.2,     // the street: wider, so the lamps and the lit windows down the block are in the frame
  camPitchStreet: 0.3,
  camAimStreet: 0.3,      // and look a little up the block
  camZoomPark: 1.18,      // the park: wide too
  camPitchPark: 0.3,
  camZoomShop: 0.84,      // the corner shop: close and warm
  camPitchShop: 0.36,
  camZoomAlley: 0.9,      // the alley: close, looking along it from above
  camPitchAlley: 0.72,   // (high enough to look over the dumpster)
  townRealLights: 6,      // real point lights lent to the lamps nearest Ghost in an area; the rest are halo + pool
  hissEvery: 20,          // the espresso machine on the street hisses about this often (s)...
  hissSoon: 1.2,          // ...and this soon once Ghost has sat at the little table long enough
  followerGap: 0.85,      // how far behind Ghost (along the way Ghost went) the grey kitten keeps
  followerSpeed: 4.4,     // how fast the kitten catches up (m/s)
  followerPop: 1.6,       // a gap longer than this between two footsteps: the kitten pops across instead of walking
  fireflyCount: 22,       // fireflies in the park
  fireflyScatter: 1.3,    // a hop this close sends them darting off (and counts as a chase)
  frogHop: 0.95,          // how high the frog jumps over Ghost (m)
  moonflowerSit: 3,       // seconds sitting by the closed moonflowers before they open
  mouseSit: 3,            // seconds waiting by the mouse hole before the whiskers come out

  // --- Revision 5: Ghost wanders alone, the player taps (src/stroll.js) ---------------------
  strollPace: 0.5,        // wandering: this much of the stick (about 1.9 m/s at the top of the curve), a cat's stroll
  strollTapPace: 0.85,    // going somewhere tapped: brisker
  strollCrouch: 0.22,     // the short crouch before a hop (seconds standing at the take-off node)
  strollLook: [0.9, 2.6], // a pause after an ordinary poke: a sniff, a look round
  strollPerch: [2.2, 4.8],// up on something: sits a while
  strollWarm: [4.5, 9.0], // a warm spot: loafs
  strollTapRest: [2.0, 3.5], // after drifting to a tapped spot, before wandering again
  strollPurr: [4.5, 6.5], // tapped: sits, purrs, looks at the camera
  strollSitMargin: 1.3,   // at a sit secret's spot, Ghost sits its time plus this
  strollDecide: 1.2,      // the next idea is chosen this long before a pause ends (Ghost looks at it; the glint shows)
  strollBusy: 5,          // after this many pokes without a rest, a warm spot wins the next idea
  strollBatAgain: 0.28,   // chance Ghost bats a 'bat' thing two or three times unprompted
  strollBatEvery: 0.75,   // seconds between pokes when a thing was tapped more than once
  strollPointReach: 1.6,  // a ground tap this close to a node (and level with it) is walked to exactly
  strollPointStraight: 4, // a ground tap on Ghost's own level this close: straight there, whatever node is nearest
  strollWalkOver: 0.42,   // walking across the keyboard: slow, so every key sounds
  strollHintTime: 30,     // after a ground tap, Ghost's own next ideas lean toward that spot for this long
  strollStuck: 9,         // travelling without moving 0.25 m for this long: back onto the graph
  // a room is "done enough" after this many different things poked in it: Ghost heads for the way out
  strollDone: { bedroom: 3, living: 4, kitchen: 3, balcony: 2, 'fire-escape': 3, rooftop: 4, street: 5, 'corner-shop': 3, alley: 3, park: 4 },
  // 'late' (the coffee, the party roof) in a 2-4 minute night: past this minute of play, or after this many finds tonight
  strollLateAfter: 120,
  strollLateFinds: 6,
  strollSleepAfter: 240,  // seconds of play before the sleep card offers itself (anywhere) ...
  strollSleepAgain: 150,  // ... and again this long after a "not yet"
  lineMin: 1.6,           // a speech line stays up at least this long before the next one replaces it
  lineThingGap: 4,        // one thing says something at most this often
  strollGlints: 4,        // at most this many faint glints on untouched things in view
  strollGlintRange: 7,    // metres: further things get no glint
  strollCamZoom: 1.2,     // the camera is this much further back than Revision 4's ...
  strollCamPitch: 0.09,   // ... and this much higher (radians)
  strollCamZoomPortrait: 1.9,  // a phone held upright sees a narrow slice: further back and higher still, so the room
  strollCamPitchPortrait: 0.2, // around Ghost (and what there is to tap) is on screen
  strollCamMaxZoom: 1.8,  // ... but never more than this in all (zones that pull back already: the budgets hold, Ghost stays readable)
  strollCamYaw: 0.55,     // and swings behind Ghost's travel this much slower (a calmer view; nobody steers)
  strollIndoorYaw: 0.3,   // indoors the camera's sideways swing is this share of Revision 4's (straight into the rooms)
  strollBudgetCalls: 52,  // over this many draw calls (or triangles) in a frame the wanderer's camera eases in ...
  strollBudgetTris: 135000,
  strollBudgetMin: 0.6,   // ... down to this share of its distance at most
  strollCamTurn: 0.9,     // rad/s: how fast the view turns to face where Ghost is heading (outdoors; indoors the dollhouse holds)
  strollCamFrame: 0.32,   // how far toward Ghost's target the camera looks (share of the way, at most 1.4 m)
};
