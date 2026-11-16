// weapons.js — gunplay model for MERIDIAN YARD, shared by the player and
// every bot. Hitscan shots, spread and recoil, reloads, the buy, and the two
// grenades. All randomness comes from the state's seeded RNG (s.rng), never
// from any nondeterministic source, so two runs with the same seed play
// out identically. The hot path reuses two scratch vectors and never
// allocates per shot.

import { WEAPONS, MOVE, FRAG, SMOKE, THROW, RELOAD_TIME, KILL_REWARD } from './config.js';
import { rayWorld, rayAgent, losBlocked } from './world.js';
import { pushEvent, pushFeed } from './state.js';

// Scratch vectors, reused by every shot so the hot loop stays allocation-free.
const DIR = { x: 0, y: 0, z: 0 };
const EYE = { x: 0, y: 0, z: 0 };

// Where the agent's eyes are, given crouch state. Writes into `out`.
export function eyePos(a, out) {
  out.x = a.x;
  out.y = a.y + (a.crouch ? MOVE.eyeCrouch : MOVE.eyeStand);
  out.z = a.z;
  return out;
}

// Build the shot direction from yaw/pitch plus recoil, then perturb it by
// `spread` (a random point inside a disc of that radius, in radians).
function shotDir(a, spread, rng, out) {
  const pitch = a.pitch + a.recoilP;
  const yaw = a.yaw + a.recoilY;
  const cp = Math.cos(pitch);
  // Forward is -z rotated by yaw; pitch lifts the muzzle up/down.
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  if (spread > 0) {
    const ang = rng() * Math.PI * 2;
    const r = spread * Math.sqrt(rng());
    out.x += Math.cos(ang) * r;
    out.y += Math.sin(ang) * r * 0.7;
    out.z += Math.sin(ang) * r;
    const len = Math.hypot(out.x, out.y, out.z);
    out.x /= len; out.y /= len; out.z /= len;
  }
  return out;
}

// Spread right now: base hip spread, plus movement and bloom, plus an air
// penalty, reduced by crouching and by aiming down sights.
export function currentSpread(a) {
  const w = WEAPONS[a.weapon];
  const speed = Math.hypot(a.vx, a.vz);
  const moveK = Math.min(1, speed / MOVE.walk);
  let s = w.spread + w.move * moveK + a.bloom;
  if (!a.onGround) s += 0.05;
  if (a.crouch) s *= 0.85;
  if (a.ads) s *= 0.45;
  return s;
}

export function canFire(a) {
  return a.alive && a.fireCd <= 0 && a.reloadT <= 0 && a.mag > 0;
}

// Fire one hitscan round. Returns 'hit', 'head', 'miss' or 'wall'.
// The nearest wall caps the shot; the nearest enemy in front of that wall
// takes damage. A tracer record and a shot event are always emitted.
export function fireWeapon(s, a) {
  const w = WEAPONS[a.weapon];
  a.mag -= 1;
  a.fireCd = 60 / w.rpm;
  a.bloom = Math.min(0.09, a.bloom + w.recoil * 0.55);
  a.recoilP += w.recoil * (0.8 + s.rng() * 0.4);
  a.recoilY += (s.rng() - 0.5) * w.yaw * 2;
  if (a.isPlayer) s.stats.shotsFired += 1;

  const spread = currentSpread(a);
  const o = eyePos(a, EYE);
  const d = shotDir(a, spread, s.rng, DIR);
  const wall = rayWorld(o.x, o.y, o.z, d.x, d.y, d.z, w.range);
  const wallT = wall ? wall.t : w.range;

  let best = null;
  let bestA = null;
  for (const t of s.agents) {
    if (t === a || !t.alive || t.team === a.team) continue;
    const hit = rayAgent(o.x, o.y, o.z, d.x, d.y, d.z, wallT, t);
    if (hit && (!best || hit.t < best.t)) { best = hit; bestA = t; }
  }
  const endT = best ? best.t : wallT;
  s.shots.push({
    x0: o.x, y0: o.y, z0: o.z,
    x1: o.x + d.x * endT, y1: o.y + d.y * endT, z1: o.z + d.z * endT,
    life: 0.07, color: a.team === 0 ? 0xffd27a : 0xff7a5c,
  });
  if (s.shots.length > 24) s.shots.shift();
  pushEvent(s, { kind: 'shot', id: a.id, x: o.x, y: o.y, z: o.z, team: a.team, weapon: a.weapon });
  // A gunshot is a noise bots can hear (hearShot radius, see bots.js).
  s.noises.push({ x: a.x, z: a.z, r: 34, team: a.team });

  if (!best) return wall ? 'wall' : 'miss';
  let dmg = w.dmg * (best.head ? w.head : 1);
  if (bestA.kevlar && !best.head) dmg *= 0.7; // kevlar only protects the body
  damageAgent(s, bestA, dmg, a, best.head);
  if (a.isPlayer) {
    s.stats.shotsHit += 1;
    if (best.head) s.stats.headshots += 1;
    s.stats.damage += dmg;
  }
  return best.head ? 'head' : 'hit';
}

// Apply damage to one agent; handles death, the kill feed and the reward.
export function damageAgent(s, victim, dmg, attacker, head) {
  if (!victim.alive) return;
  victim.hp -= dmg;
  victim.lastHitT = s.time;
  pushEvent(s, { kind: 'damage', id: victim.id, head: !!head, hp: victim.hp });
  if (victim.hp > 0) return;
  victim.alive = false;
  victim.hp = 0;
  victim.deaths += 1;
  if (attacker) {
    attacker.kills += 1;
    if (attacker.isPlayer) {
      attacker.money += KILL_REWARD;
      pushFeed(s, `YOU ▸ ${victim.name}${head ? ' — HEADSHOT' : ''}  +$${KILL_REWARD}`);
    } else if (attacker.team === 0) {
      pushFeed(s, `${attacker.name} ▸ ${victim.name}`);
    } else {
      pushFeed(s, `${victim.name} was dropped by ${attacker.name}`);
    }
  }
  pushEvent(s, { kind: 'death', id: victim.id, x: victim.x, z: victim.z });
}

// Reload times by weapon (config RELOAD_TIME): Falcon 2.6 s, P9 1.4 s,
// everything else 2.1 s.
export function startReload(a) {
  const w = WEAPONS[a.weapon];
  if (a.reloadT > 0 || a.mag >= w.mag || a.reserve <= 0) return false;
  a.reloadT = RELOAD_TIME[a.weapon];
  return true;
}

export function finishReload(a) {
  const w = WEAPONS[a.weapon];
  const need = w.mag - a.mag;
  const take = Math.min(need, a.reserve);
  a.mag += take;
  a.reserve -= take;
}

// Buy a weapon for `a`: pay, switch to it, fill mag + reserve. The HUD's
// buy() wrapper records ownership; this only handles money and the swap.
export function buyWeapon(s, a, id) {
  const w = WEAPONS[id];
  if (!w || a.money < w.price) return false;
  a.money -= w.price;
  a.weapon = id;
  a.mag = w.mag;
  a.reserve = w.reserve;
  a.reloadT = 0;
  return true;
}

// Lob a grenade from the agent's eye, along the aim direction, with a small
// upward arc and half the agent's own velocity carried over.
export function throwGrenade(s, a, kind) {
  if (kind === 'frag' && a.frags <= 0) return false;
  if (kind === 'smoke' && a.smokes <= 0) return false;
  const o = eyePos(a, EYE);
  const d = shotDir(a, 0, s.rng, DIR);
  if (kind === 'frag') a.frags -= 1; else a.smokes -= 1;
  s.grenades.push({
    x: o.x, y: o.y, z: o.z,
    vx: d.x * FRAG.throwSpeed + a.vx * THROW.velShare,
    vy: d.y * FRAG.throwSpeed + THROW.upKick,
    vz: d.z * FRAG.throwSpeed + a.vz * THROW.velShare,
    fuse: kind === 'frag' ? FRAG.fuse : SMOKE.fuse,
    kind, team: a.team, alive: true,
  });
  pushEvent(s, { kind: 'throw', x: o.x, y: o.y, z: o.z, gkind: kind });
  return true;
}

// Grenade physics: gravity, a damped bounce off the floor, then detonation
// on fuse. A frag hurts by distance with line-of-sight (walls shield); a
// smoke leaves a 13 s vision-blocking puff.
export function stepGrenades(s, dt) {
  for (const g of s.grenades) {
    if (!g.alive) continue;
    g.fuse -= dt;
    g.vy -= 14.5 * dt;
    let nx = g.x + g.vx * dt;
    let ny = g.y + g.vy * dt;
    let nz = g.z + g.vz * dt;
    if (ny < 0.12) {
      ny = 0.12;
      g.vy = Math.abs(g.vy) * 0.45;
      g.vx *= 0.7;
      g.vz *= 0.7;
    }
    g.x = nx; g.y = ny; g.z = nz;
    if (g.fuse > 0) continue;
    g.alive = false;
    if (g.kind === 'frag') {
      pushEvent(s, { kind: 'explode', x: g.x, y: g.y, z: g.z });
      // The kill credit goes to the player if the thrower is on their team.
      const atk = s.agents.find((x) => x.team === g.team && x.isPlayer) || null;
      for (const t of s.agents) {
        if (!t.alive) continue;
        const dx = t.x - g.x;
        const dz = t.z - g.z;
        const dy = (t.y + 0.9) - g.y;
        const dist = Math.hypot(dx, dy, dz);
        if (dist > FRAG.radius) continue;
        if (losBlocked(g.x, g.y, g.z, t.x, t.y + 0.9, t.z)) continue;
        const dmg = FRAG.maxDmg * (1 - dist / FRAG.radius) * 0.9 + 8;
        damageAgent(s, t, dmg, atk, false);
      }
    } else {
      s.smokes.push({ x: g.x, y: 1.1, z: g.z, r: SMOKE.radius, life: SMOKE.duration });
      pushEvent(s, { kind: 'smoke', x: g.x, y: 1.1, z: g.z });
    }
  }
  s.grenades = s.grenades.filter((g) => g.alive);
}
