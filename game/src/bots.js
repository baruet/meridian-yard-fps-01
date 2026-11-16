// bots.js — the AI for the Sentinel defenders and the Vanguard allies.
// Each bot is a small state machine with a 10 Hz brain (thinkBot) and
// continuous steering every fixed step (stepBot):
//   HOLD    — sit on a site post, watch a lane, strafe-peek now and then
//   PATROL  — walk the waypoint graph hop by hop toward a goal
//   ENGAGE  — a visible enemy: stop, aim with reaction delay + error, burst fire
//   PLANT / DEFUSE — objective work: allies plant, defenders retake and defuse
//   RETREAT — fall back to the planted site (defenders retake, attackers guard)
// Vision is a cone plus a line-of-sight test against the world boxes, and
// smoke puffs block it. Hearing is a noise list the sim fills (gunshots and
// sprint steps). All randomness flows through the state's seeded RNG;
// nothing here reads a nondeterministic source.

import { BOT, MOVE, BOMB_FUSE, PLANT_TIME, DEFUSE_TIME } from './config.js';
import { WORLD, losBlocked, nearestWp, collideCircle } from './world.js';
import { fireWeapon, startReload } from './weapons.js';

// Eye height used for the sight test (bots never crouch, so a fixed height).
const BOT_EYE = 1.5;

// Can `a` see `t` right now? Range, field-of-view cone, line of sight
// against the boxes, and no smoke puff sitting between the two.
export function canSee(s, a, t) {
  if (!t.alive) return false;
  const dx = t.x - a.x;
  const dz = t.z - a.z;
  const d2 = dx * dx + dz * dz;
  if (d2 > BOT.visionRange * BOT.visionRange) return false;
  const d = Math.sqrt(d2);
  const fx = -Math.sin(a.yaw);
  const fz = -Math.cos(a.yaw);
  if (d > 3 && (dx * fx + dz * fz) / (d || 1) < BOT.fovCos) return false;
  const ay = a.y + BOT_EYE;
  const ty = t.y + (t.crouch ? 1.0 : 1.35);
  if (losBlocked(a.x, ay, a.z, t.x, ty, t.z)) return false;
  for (const sm of s.smokes) {
    const mx = (a.x + t.x) / 2;
    const mz = (a.z + t.z) / 2;
    if ((mx - sm.x) ** 2 + (mz - sm.z) ** 2 < sm.r * sm.r) return false;
  }
  return true;
}

// The closest living enemy, or null. Used for target selection every step.
function nearestEnemy(s, a) {
  let best = null;
  let bd = Infinity;
  for (const t of s.agents) {
    if (t.team === a.team || !t.alive) continue;
    const d = (t.x - a.x) ** 2 + (t.z - a.z) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

// Next waypoint hop toward `goal`: the neighbour of the bot's current
// waypoint that lies closest to the goal (with a little jitter so bots do
// not all trace identical lines). Never a straight line across the map.
function nextHop(a, goal, rng) {
  const cur = nearestWp(a.x, a.z);
  if (cur === goal) return goal;
  const g = WORLD.waypoints[goal];
  let best = cur;
  let bd = Infinity;
  for (const n of WORLD.waypoints[cur].n) {
    const w = WORLD.waypoints[n];
    const d = (w.x - g.x) ** 2 + (w.z - g.z) ** 2 + rng() * 4;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

// Walk toward a point at bot speed, colliding with the world. Returns true
// once the bot is close enough to call it arrived.
function moveToward(a, tx, tz, dt, speedMul) {
  const dx = tx - a.x;
  const dz = tz - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.4) return true;
  const sp = BOT.walkSpeed * (speedMul || 1);
  const vx = (dx / d) * sp;
  const vz = (dz / d) * sp;
  const p = collideCircle(a.x, a.z, MOVE.radius, vx * dt, vz * dt);
  a.x = p.x;
  a.z = p.z;
  a.vx = vx;
  a.vz = vz;
  a.speed = sp;
  a.moving = true;
  a.yaw = Math.atan2(-dx, -dz); // face where we are going
  return false;
}

// Turn toward the target at a limited rate — no snap-aim — and store the
// aim error the shot will carry as a temporary bloom bump.
function aimAt(a, t, err) {
  const dx = t.x - a.x;
  const dz = t.z - a.z;
  const want = Math.atan2(-dx, -dz);
  let diff = want - a.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  a.yaw += diff * 0.25;
  a.pitch = 0;
  a.aimErr = err;
}

// The 10 Hz brain. Vision and hearing update every step; the role/goal
// decisions below run only when the think timer expires. `now` is sim time.
export function thinkBot(s, a, now, dt) {
  if (!a.alive) return;
  a.thinkT -= dt;

  const enemy = nearestEnemy(s, a);
  const sees = enemy && canSee(s, a, enemy);
  if (sees) {
    // Reaction delay fires ONCE per target acquisition. Re-arming it on
    // every step while the target stays visible would freeze the trigger
    // forever: the delay could never elapse, so the bot would stare and
    // never shoot.
    if (a.targetId !== enemy.id) {
      a.targetId = enemy.id;
      a.reactT = BOT.reactMin + s.rng() * (BOT.reactMax - BOT.reactMin);
    }
    a.lastSeenX = enemy.x;
    a.lastSeenZ = enemy.z;
    a.lastSeenT = now;
  }
  // Hearing: a recent enemy noise pulls the bot toward the sound.
  for (const n of s.noises) {
    if (n.team === a.team) continue;
    const d2 = (n.x - a.x) ** 2 + (n.z - a.z) ** 2;
    if (d2 < n.r * n.r && now - a.heardT > 2) {
      a.heardX = n.x;
      a.heardZ = n.z;
      a.heardT = now;
    }
  }
  if (a.thinkT > 0) return;
  a.thinkT = 1 / BOT.thinkHz;
  const bomb = s.bomb;

  // --- objective overrides: a planted bomb re-tasks everyone ---
  if (bomb.state === 'planted') {
    if (a.team === 1) { // defenders retake the planted site
      a.role = 'retake';
      a.wpTarget = bomb.site === 'A' ? 8 : 9;
    } else { // attackers guard the bomb
      a.role = 'guard';
      a.wpTarget = bomb.site === 'A' ? 8 : 9;
    }
  }

  // --- role goals ---
  if (a.role === 'holdA' || a.role === 'holdB') {
    const posts = WORLD.holds[a.role];
    const post = posts[a.id % posts.length];
    const w = WORLD.waypoints[post[0]];
    const d = Math.hypot(w.x - a.x, w.z - a.z);
    if (d > 1.2) {
      a.wpTarget = post[0];
      a.state = 'patrol';
    } else {
      a.state = 'hold';
      a.yaw = post[1] + Math.sin(now * 0.3 + a.id) * 0.35;
    }
  } else if (a.role === 'roam') {
    if (a.state !== 'patrol' || a.wpTarget < 0) {
      a.wpTarget = [6, 7, 3][Math.floor(s.rng() * 3)];
      a.state = 'patrol';
    }
  } else if (a.role === 'push') {
    // Allies follow the bomb carrier toward whichever site it is heading for.
    const carrier = s.agents[s.bomb.carrier];
    const site = carrier && carrier.alive ? (carrier.x < 0 ? 8 : 9) : 8;
    a.wpTarget = site;
    a.state = 'patrol';
  }

  // Heard something recently and free to check it out? Investigate.
  if (!sees && now - a.heardT < 4 && (a.role === 'roam' || a.role === 'retake')) {
    a.wpTarget = nearestWp(a.heardX, a.heardZ);
    a.state = 'patrol';
  }
  // Last-seen hunt: push the spot where an enemy was seen moments ago.
  if (!sees && now - a.lastSeenT < 3 && a.targetId >= 0) {
    a.wpTarget = nearestWp(a.lastSeenX, a.lastSeenZ);
    a.state = 'patrol';
  }
  // Retake/guard roles move until they arrive.
  if ((a.role === 'retake' || a.role === 'guard') && a.wpTarget >= 0) a.state = 'patrol';

  // Arrival handling: hold at the destination, pick a new roam target, or
  // keep hopping toward a far goal.
  if (a.state === 'patrol' && a.wpTarget >= 0) {
    const w = WORLD.waypoints[a.wpTarget];
    if (Math.hypot(w.x - a.x, w.z - a.z) < 1.0) {
      if (a.role === 'retake' || a.role === 'guard' || a.role === 'push') {
        a.state = 'hold';
        a.holdT = BOT.holdTime[0] + s.rng() * 4;
      } else if (a.role === 'roam') {
        a.wpTarget = [0, 1, 2, 3, 6, 7][Math.floor(s.rng() * 6)];
      } else {
        a.wpTarget = nextHop(a, a.wpTarget, s.rng);
      }
    }
  }
}

// Continuous per-step bot update: think, then plant/defuse, engage, or steer.
export function stepBot(s, a, now, dt) {
  if (!a.alive) { a.moving = false; return; }
  thinkBot(s, a, now, dt);
  const enemy = a.targetId >= 0 ? s.agents[a.targetId] : null;
  const sees = enemy && enemy.alive && canSee(s, a, enemy);
  if (a.reactT > 0) a.reactT -= dt;
  if (a.burstCd > 0) a.burstCd -= dt; // ticks every step, not only while firing

  // --- plant: an ally bot carrying the charge plants it on a site ---
  // (Matches the sim's carrier rule: the bomb is dropped when its carrier
  // dies, picked up by a nearby living Vanguard agent, and a bot carrier
  // plants on its own once it reaches a site. See sim.js.)
  if (s.bomb.state === 'carried' && s.bomb.carrier === a.id && a.team === 0 && !a.isPlayer) {
    const site = WORLD.sites[a.x < 0 ? 'A' : 'B'];
    if (Math.hypot(a.x - site.x, a.z - site.z) < site.r) {
      a.planting += dt;
      a.vx = 0; a.vz = 0; a.moving = false;
      if (a.planting >= PLANT_TIME) {
        s.bomb.state = 'planted';
        s.bomb.site = a.x < 0 ? 'A' : 'B';
        s.bomb.fuse = BOMB_FUSE;
        s.bomb.x = a.x;
        s.bomb.z = a.z;
      }
      return;
    }
  }
  a.planting = 0;

  // --- defuse: a defender standing inside the planted site defuses ---
  if (s.bomb.state === 'planted' && a.team === 1) {
    const site = WORLD.sites[s.bomb.site];
    if (Math.hypot(a.x - site.x, a.z - site.z) < site.r) {
      a.defusing += dt;
      if (a.defusing >= DEFUSE_TIME) { s.bomb.state = 'defused'; s.bomb.defuser = a.id; }
      return; // stand still and defuse
    }
  }
  a.defusing = 0;

  // --- ENGAGE: a visible enemy. Face it, stop, and fire in bursts ---
  if (sees) {
    const d = Math.hypot(enemy.x - a.x, enemy.z - a.z);
    aimAt(a, enemy, BOT.aimErr * (0.7 + d / 40));
    a.vx = 0; a.vz = 0; a.speed = 0; a.moving = false;
    if (a.reactT <= 0) {
      if (a.burstLeft <= 0 && a.burstCd <= 0) {
        a.burstLeft = BOT.burstMin + Math.floor(s.rng() * (BOT.burstMax - BOT.burstMin));
        a.burstCd = 0.5 + s.rng() * 0.7;
      }
      if (a.burstLeft > 0 && a.fireCd <= 0 && a.mag > 0) {
        a.bloom += a.aimErr; // aim error rides in as a temporary spread bump
        fireWeapon(s, a);
        a.burstLeft -= 1;
        if (a.burstLeft <= 0) a.burstCd = 0.4 + s.rng() * 0.8;
      } else if (a.mag === 0) {
        startReload(a);
      }
    }
    return;
  }
  a.targetId = -1;

  // --- steering: hop along the waypoint graph, never a straight line ---
  if (a.state === 'patrol' && a.wpTarget >= 0) {
    const goal = WORLD.waypoints[a.wpTarget];
    if (Math.hypot(goal.x - a.x, goal.z - a.z) < 0.8) {
      a.vx = 0; a.vz = 0; a.speed = 0; a.moving = false;
      a.stuckT = 0;
    } else if (a.detourT > 0) {
      // Sidestep around the obstacle that stopped us; the timer runs out
      // on its own, then the bot re-aims at its waypoint.
      a.detourT -= dt;
      moveToward(a, a.detourX, a.detourZ, dt, 1);
      if (Math.hypot(a.detourX - a.x, a.detourZ - a.z) < 0.5) a.detourT = 0;
    } else {
      const hop = nextHop(a, a.wpTarget, s.rng);
      const w = WORLD.waypoints[hop];
      const bx = a.x, bz = a.z;
      moveToward(a, w.x, w.z, dt, 1);
      // Stuck against a wall: a greedy hop plus a straight line can wedge
      // a bot into a corner (e.g. the north connector walls sealing the
      // hold posts). After ~0.6 s without progress, sidestep perpendicular
      // to the blocked direction, alternating sides each time, and try again.
      if (Math.hypot(a.x - bx, a.z - bz) < 0.02) {
        a.stuckT += dt;
        if (a.stuckT > 0.6) {
          a.stuckT = 0;
          a.detourSide = -(a.detourSide || 1);
          const dx = w.x - a.x, dz = w.z - a.z;
          const len = Math.hypot(dx, dz) || 1;
          a.detourX = a.x + (-dz / len) * a.detourSide * 2.5;
          a.detourZ = a.z + (dx / len) * a.detourSide * 2.5;
          a.detourT = 1.2;
        }
      } else {
        a.stuckT = 0;
      }
    }
  } else if (a.state === 'hold') {
    a.vx = 0; a.vz = 0; a.speed = 0; a.moving = false;
    a.holdT -= dt;
    if (a.holdT <= 0 && (a.role === 'roam' || a.role === 'retake')) {
      a.state = 'patrol';
      a.holdT = 0;
    }
    // Peek-strafe while holding: small sidesteps, still watching the lane.
    a.strafeT -= dt;
    if (a.strafeT <= 0) {
      a.strafeDir *= -1;
      a.strafeT = 1.2 + s.rng() * 1.5;
    }
    const px = a.x + Math.cos(a.yaw) * a.strafeDir * 0.5;
    const pz = a.z - Math.sin(a.yaw) * a.strafeDir * 0.5;
    const p = collideCircle(a.x, a.z, MOVE.radius, (px - a.x) * dt, (pz - a.z) * dt);
    a.x = p.x;
    a.z = p.z;
  } else {
    a.vx = 0; a.vz = 0; a.speed = 0; a.moving = false;
  }

  // Empty mag: reload whenever the bot is not busy shooting.
  if (a.mag === 0 && a.reloadT <= 0) startReload(a);
}
