// config.js — every tunable number for MERIDIAN YARD lives here and nowhere
// else: round flow, economy, the four guns, both grenades, movement and the
// bot brain. The sim reads these values read-only; nothing in this file
// allocates or keeps mutable state.
//
// The game: a dusk-lit industrial yard. Vanguard (the player plus two ally
// bots) attacks from the south yard; Sentinel (five bots) holds Site A
// (west, crate yard) and Site B (east, warehouse).

// Fixed-step size and the round clock.
export const DT = 1 / 60;
export const ROUND_TIME = 100; // seconds of live play per round
export const BUY_TIME = 14; // seconds of buy phase before the round starts
export const BOMB_FUSE = 35; // seconds from plant to detonation
export const PLANT_TIME = 3.0; // seconds holding E to plant the charge
export const DEFUSE_TIME = 5.0; // seconds holding E to defuse it
export const WIN_ROUNDS = 5; // first team to 5 rounds wins (max 9 rounds)

// Economy, in dollars.
export const START_MONEY = 800;
export const KILL_REWARD = 300;
export const PLANT_REWARD = 300;
export const ROUND_WIN_REWARD = 3250;
export const ROUND_LOSS_REWARD = 1900;
export const GRENADE_PRICE = 300;
export const SMOKE_PRICE = 300;
export const KEVLAR_PRICE = 650; // body damage x0.7 while worn

// Weapons. Fields per gun: display name, kind, price, body damage, headshot
// multiplier, rounds per minute, magazine size, reserve ammo, hip spread
// (radians), recoil kick (pitch, yaw) per shot, extra spread while moving,
// effective range in metres, full-auto flag, ADS zoom factor.
export const WEAPONS = {
  p9: {
    name: 'Kestrel P9', kind: 'pistol', price: 0, dmg: 26, head: 2.2,
    rpm: 320, mag: 12, reserve: 48, spread: 0.011, recoil: 0.011,
    yaw: 0.004, move: 0.03, range: 42, auto: false, zoom: 1.0,
  },
  hornet: {
    name: 'Hornet-9', kind: 'smg', price: 1200, dmg: 22, head: 2.0,
    rpm: 720, mag: 28, reserve: 112, spread: 0.016, recoil: 0.009,
    yaw: 0.005, move: 0.026, range: 34, auto: true, zoom: 1.0,
  },
  longbow: {
    name: 'Longbow AR', kind: 'rifle', price: 2700, dmg: 33, head: 2.5,
    rpm: 600, mag: 30, reserve: 90, spread: 0.008, recoil: 0.014,
    yaw: 0.005, move: 0.034, range: 60, auto: true, zoom: 1.15,
  },
  falcon: {
    name: 'Falcon-50', kind: 'sniper', price: 4750, dmg: 95, head: 2.5,
    rpm: 55, mag: 5, reserve: 15, spread: 0.002, recoil: 0.055,
    yaw: 0.01, move: 0.06, range: 90, auto: false, zoom: 2.2,
  },
};
export const WEAPON_ORDER = ['p9', 'hornet', 'longbow', 'falcon'];

// Reload durations, in seconds (the Falcon's bolt action is the slowest).
export const RELOAD_TIME = { p9: 1.4, hornet: 2.1, longbow: 2.1, falcon: 2.6 };

// Frag grenade: fuse, blast radius, peak damage, launch speed.
export const FRAG = { fuse: 1.6, radius: 9, maxDmg: 110, throwSpeed: 17 };
// How a throw is launched: base speed above, plus this upward kick and this
// fraction of the thrower's own velocity, so moving throws carry further.
export const THROW = { upKick: 3.2, velShare: 0.5 };
// Smoke grenade: fuse, cloud radius, how long the cloud lingers (seconds).
// A live smoke cloud blocks bot vision.
export const SMOKE = { fuse: 1.1, radius: 4.2, duration: 13 };

// Movement, in metres / seconds. Speeds are caps; the player approaches them
// exponentially (see player.js), which keeps motion snappy but weighty.
export const MOVE = {
  walk: 5.4,
  crouch: 2.7,
  ads: 3.4,
  air: 4.6,
  accel: 52,
  friction: 11,
  jumpVel: 5.4,
  gravity: 14.5,
  eyeStand: 1.62,
  eyeCrouch: 1.05,
  radius: 0.38,
};

// Bot brain tuning. Bots think at 10 Hz and steer continuously between
// thoughts; aim error grows with distance to the target.
export const BOT = {
  thinkHz: 10,
  visionRange: 46,
  fovCos: 0.42,
  hearShot: 34,
  hearStep: 7,
  reactMin: 0.28,
  reactMax: 0.62,
  aimErr: 0.028,
  burstMin: 3,
  burstMax: 6,
  walkSpeed: 4.4,
  holdTime: [4, 9],
  hp: 100,
};

// Dusk palette for the yard: sand, rust, teal containers, amber accents.
export const PALETTE = {
  skyTop: 0x2b3a55,
  skyBot: 0xd98a4a,
  sun: 0xffc98a,
  hemiSky: 0x8fa3c0,
  hemiGround: 0x5a4632,
  ground: 0x8a6f4d,
  groundDark: 0x6b563c,
  wallSand: 0xc9a06b,
  wallRust: 0x9a5a34,
  containerTeal: 0x2e7f86,
  containerRust: 0xc65d21,
  crate: 0xb08d57,
  trim: 0x3a3f46,
  accent: 0xf0a830,
  ally: 0x7fb069,
  enemy: 0xd95f4b,
  smoke: 0x9aa0a8,
};
