// state.js — the one and only store. Everything mutable about a match lives
// inside the object createState() returns: agents, the bomb, the round clock,
// events, the kill feed and player stats. Other modules read and write this
// object; none of them keeps a second copy of match state. The hot loop
// reuses the preallocated arrays here and never allocates per frame.
import { START_MONEY, WEAPONS } from './config.js';

// mulberry32 — a tiny deterministic PRNG. Same seed, same stream of numbers,
// so staged screenshots and replayed sims agree exactly. Every random choice
// in the game flows through s.rng; the sim never reads the wall clock or
// any nondeterministic source.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function nextRandom() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Match phases. MENU shows the title screen over a live idle scene; BUY is
// the 14-second shop phase; LIVE is the round itself; OVER is the short
// banner between rounds; MATCH is the end-of-match screen.
export const PHASE = {
  MENU: 'menu',
  BUY: 'buy',
  LIVE: 'live',
  OVER: 'over',
  MATCH: 'match',
};

// One combatant: the player (id 0) or a bot. Bot-only fields (role, state,
// waypoints, senses) sit idle on the player and cost nothing.
export function createAgent(id, name, team, isPlayer, x, z, yaw) {
  return {
    id,
    name,
    team,
    isPlayer,
    alive: true,
    hp: 100,
    kevlar: false,
    x,
    z,
    y: 0,
    vx: 0,
    vz: 0,
    yaw,
    pitch: 0,
    crouch: false,
    onGround: true,
    // loadout
    weapon: 'p9',
    mag: WEAPONS.p9.mag,
    reserve: WEAPONS.p9.reserve,
    frags: 0,
    smokes: 0,
    money: START_MONEY,
    kills: 0,
    deaths: 0,
    // gun feel, shared by the player and the bots
    bloom: 0,
    recoilP: 0,
    recoilY: 0,
    fireCd: 0,
    reloadT: 0,
    burstLeft: 0,
    burstCd: 0,
    ads: false,
    lastHitT: -99,
    speed: 0,
    moving: false,
    // bot brain
    role: 'roam',
    state: 'hold',
    wp: 0,
    wpTarget: -1,
    holdT: 0,
    reactT: 0,
    targetId: -1,
    lastSeenX: 0,
    lastSeenZ: 0,
    lastSeenT: -99,
    heardX: 0,
    heardZ: 0,
    heardT: -99,
    thinkT: 0,
    aimErr: 0,
    strafeDir: 1,
    strafeT: 0,
    // stuck recovery for patrol steering (see bots.js)
    stuckT: 0,
    detourT: 0,
    detourX: 0,
    detourZ: 0,
    detourSide: 1,
    planting: 0,
    defusing: 0,
  };
}

// The roster: Vanguard (team 0) attacks — the player plus KITE and ORIO —
// while Sentinel (team 1) defends with five bots. Yaw 0 faces north (-z),
// so attackers look up the map and defenders look back down it.
const ALLY_NAMES = ['KITE', 'ORIO'];
const FOE_NAMES = ['VEX', 'MIRA', 'DUSK', 'HALO', 'PIKE'];

export function createState(seed) {
  const agents = [createAgent(0, 'YOU', 0, true, 0, 20, 0)];
  for (let i = 0; i < 2; i++) {
    agents.push(createAgent(1 + i, ALLY_NAMES[i], 0, false, (i === 0 ? -3 : 3), 21, 0));
  }
  for (let i = 0; i < 5; i++) {
    agents.push(createAgent(3 + i, FOE_NAMES[i], 1, false, 0, -20, Math.PI));
  }
  return {
    seed,
    rng: mulberry32(seed),
    time: 0, // accumulated sim time (seconds), never wall-clock time
    round: 1,
    phase: PHASE.MENU,
    phaseT: 0, // seconds spent in the current phase
    roundT: 0, // seconds spent in the current live round
    score: [0, 0], // rounds won, per team
    wins: [0, 0], // alias kept for the HUD's scoreboard
    agents,
    playerId: 0,
    // the charge: carried by the player at round start, planted on a site,
    // or spent. carrier holds an agent id while state is 'carried'.
    bomb: {
      state: 'carried',
      carrier: 0,
      x: 0,
      z: 0,
      site: '',
      plantT: 0,
      fuse: 0,
      defuseT: 0,
      defuser: -1,
    },
    events: [], // one-shot records {kind, ...}, drained by render/audio/HUD
    shots: [], // tracer records, drained by the renderer
    tracers: [],
    particles: [], // pooled in render.js; the sim only appends records
    grenades: [], // live grenades {x,y,z,vx,vy,vz,fuse,kind,team,alive}
    smokes: [], // live smoke clouds {x,y,z,r,life}
    noises: [], // hearing stimuli {x,z,r,team}, drained each sim step
    msg: '',
    msgT: 0, // centre-screen announcement and its expiry clock
    feed: [], // kill feed lines {text, t}, at most 5
    roundWinner: -1,
    roundReason: '',
    matchWinner: -1,
    buyOpen: false,
    paused: false,
    muted: false,
    owned: ['p9'], // weapon ids the player has bought this match
    stats: { shotsFired: 0, shotsHit: 0, headshots: 0, damage: 0 },
  };
}

// Set up a fresh round: positions, health and timers reset; money, loadouts
// and the score carry over. The world supplies spawn points.
export function resetRound(s, world) {
  s.roundT = 0;
  s.phase = PHASE.BUY;
  s.phaseT = 0;
  s.roundWinner = -1;
  s.roundReason = '';
  s.bomb = {
    state: 'carried',
    carrier: 0,
    x: 0,
    z: 0,
    site: '',
    plantT: 0,
    fuse: 0,
    defuseT: 0,
    defuser: -1,
  };
  s.grenades.length = 0;
  s.smokes.length = 0;
  s.noises.length = 0;
  s.events.length = 0;

  for (const a of s.agents) {
    a.alive = true;
    a.hp = 100;
    a.bloom = 0;
    a.recoilP = 0;
    a.recoilY = 0;
    a.fireCd = 0;
    a.reloadT = 0;
    a.burstLeft = 0;
    a.burstCd = 0;
    a.targetId = -1;
    a.planting = 0;
    a.defusing = 0;
    a.lastHitT = -99;
    // Bot brain state must not leak across rounds: a defender that was
    // mid-strafe or mid-thought when the round ended starts clean.
    a.thinkT = 0;
    a.holdT = 0;
    a.reactT = 0;
    a.stuckT = 0;
    a.detourT = 0;
    a.strafeT = 0;
    a.lastSeenT = -99;
    a.heardT = -99;
    a.wpTarget = -1;
    a.mag = WEAPONS[a.weapon].mag;
    a.reserve = WEAPONS[a.weapon].reserve;
    const sp = world.spawn(a.team, a.id);
    a.x = sp.x;
    a.z = sp.z;
    a.y = 0;
    a.vx = 0;
    a.vz = 0;
    a.yaw = sp.yaw;
    a.pitch = 0;
    if (a.isPlayer) {
      a.frags = 0;
      a.smokes = 0;
    }
  }

  // Defenders take their posts: two hold A, two hold B, one roams mid.
  // The two allies push with the bomb carrier toward a site.
  const posts = [8, 10, 9, 11, 7];
  for (let i = 0; i < 5; i++) {
    const b = s.agents[3 + i];
    b.role = i < 2 ? 'holdA' : i < 4 ? 'holdB' : 'roam';
    b.wp = posts[i];
  }
  s.agents[1].role = 'push';
  s.agents[2].role = 'push';
}

// How many agents of one team are still standing.
export function aliveCount(s, team) {
  let n = 0;
  for (const a of s.agents) {
    if (a.team === team && a.alive) n++;
  }
  return n;
}

// Queue a one-shot event for the renderer, audio and HUD. The ring is
// capped at 64; overflow is dropped rather than allowed to grow.
export function pushEvent(s, e) {
  if (s.events.length < 64) s.events.push(e);
}

// Add a line to the kill feed, keeping only the five most recent.
export function pushFeed(s, text) {
  s.feed.push({ text, t: s.time });
  if (s.feed.length > 5) s.feed.shift();
}
