// sim.js — the fixed-step simulation (DT = 1/60). Everything that changes
// the match runs here, in step(s, input, dt); rendering only reads state.
// Round flow: BUY (14 s, buy menu open) -> LIVE (100 s) -> OVER (5 s banner)
// -> next BUY, until one team reaches 5 round wins (MATCH, max 9 rounds).
// A round ends by elimination, by the bomb exploding (attackers win), by a
// defuse (defenders win), or by the timer expiring unplanted (defenders win).
//
// Bomb carrier rule (decided from the v1 sim/bots behaviour and kept here):
// the carrier starts as the player (id 0). When the carrier dies, the bomb
// is DROPPED where they fell; any living Vanguard agent who walks within
// 1.2 m picks it up and becomes the carrier. A bot carrier plants the charge
// on its own once it reaches a site (see bots.js). If nobody picks the bomb
// up, the round is decided by elimination or by the timer, as usual.

import {
  DT, ROUND_TIME, BUY_TIME, BOMB_FUSE, PLANT_TIME, DEFUSE_TIME, WIN_ROUNDS,
  ROUND_WIN_REWARD, ROUND_LOSS_REWARD, PLANT_REWARD, KILL_REWARD, WEAPONS,
  GRENADE_PRICE, SMOKE_PRICE, KEVLAR_PRICE, WEAPON_ORDER,
} from './config.js';
import { PHASE, aliveCount, pushEvent, pushFeed, resetRound } from './state.js';
import { siteAt } from './world.js';
import { stepPlayerMove, stepWeaponFeel } from './player.js';
import { fireWeapon, startReload, finishReload, buyWeapon, throwGrenade, stepGrenades, damageAgent } from './weapons.js';
import { stepBot } from './bots.js';

// The world is injected once by main.js (via setWorld) so this module never
// imports world.js directly and no import cycle can form.
export let worldRef = null;
export function setWorld(w) { worldRef = w; }

export function startMatch(s) {
  s.round = 1;
  s.score = [0, 0];
  s.wins = [0, 0];
  s.matchWinner = -1;
  for (const a of s.agents) {
    a.money = 800;
    a.kills = 0;
    a.deaths = 0;
    a.weapon = 'p9';
    a.kevlar = false;
    a.frags = 0;
    a.smokes = 0;
  }
  s.owned = ['p9'];
  resetRound(s, worldRef);
  s.phase = PHASE.BUY;
  s.phaseT = 0;
  s.msg = 'MERIDIAN YARD — round 1. Plant the charge at A or B.';
  s.msgT = 5;
}

// Close a round: hand out the win/loss money, announce it, and decide
// whether the match is over (first to 5, or round 9 finished).
function endRound(s, winner, reason) {
  if (s.phase === PHASE.OVER) return;
  s.phase = PHASE.OVER;
  s.phaseT = 0;
  s.roundWinner = winner;
  s.roundReason = reason;
  s.wins[winner] += 1;
  s.score = [s.wins[0], s.wins[1]]; // score mirrors round wins (HUD reads score)
  for (const a of s.agents) {
    if (a.team === winner) a.money += ROUND_WIN_REWARD;
    else a.money += ROUND_LOSS_REWARD;
  }
  s.msg = winner === 0 ? `ROUND WON — ${reason}` : `ROUND LOST — ${reason}`;
  s.msgT = 5;
  pushFeed(s, s.msg);
  pushEvent(s, { kind: 'round', winner, reason });
  if (s.wins[winner] >= WIN_ROUNDS || s.round >= 9) {
    s.matchWinner = winner;
    s.phase = PHASE.MATCH;
    s.phaseT = 0;
    s.msg = winner === 0
      ? 'MATCH WON — Meridian Yard is yours.'
      : 'MATCH LOST — the Sentinels hold the yard.';
    s.msgT = 999;
  }
}

// Player actions from the input edges collected in main.js (fire, reload,
// weapon slot, grenades, hold-E plant/defuse). Only in BUY or LIVE.
function handlePlayerInput(s, input, dt) {
  const p = s.agents[0];
  if (!p.alive) return;
  if (s.phase !== PHASE.LIVE && s.phase !== PHASE.BUY) return;

  if (input.fire && p.fireCd <= 0 && p.reloadT <= 0) {
    if (p.mag > 0) {
      const r = fireWeapon(s, p);
      if (r === 'hit' || r === 'head') pushEvent(s, { kind: 'hitmark', head: r === 'head' });
    } else {
      pushEvent(s, { kind: 'dryfire' });
      startReload(p);
    }
  }
  if (input.reload) startReload(p);
  if (input.slot >= 0) {
    const id = WEAPON_ORDER[input.slot];
    if (id && id !== p.weapon && s.owned && s.owned.includes(id)) {
      // Switching is free, but only to weapons already owned (buy in the menu).
      p.weapon = id;
      p.mag = WEAPONS[id].mag;
      p.reserve = WEAPONS[id].reserve;
      p.reloadT = 0;
    }
  }
  if (input.frag) throwGrenade(s, p, 'frag');
  if (input.smoke) throwGrenade(s, p, 'smoke');

  // Plant / defuse: hold E inside a site (plant, 3 s) or within 2.5 m of a
  // planted bomb (defuse, 5 s). Releasing E resets the progress.
  const site = siteAt(p.x, p.z);
  if (input.use && s.phase === PHASE.LIVE) {
    if (s.bomb.state === 'carried' && s.bomb.carrier === 0 && site) {
      s.bomb.plantT += dt;
      p.planting = s.bomb.plantT;
      if (s.bomb.plantT >= PLANT_TIME) {
        s.bomb.state = 'planted';
        s.bomb.site = site;
        s.bomb.fuse = BOMB_FUSE;
        s.bomb.x = p.x;
        s.bomb.z = p.z;
        p.money += PLANT_REWARD;
        s.msg = `CHARGE PLANTED AT ${site} — defend it!`;
        s.msgT = 5;
        pushFeed(s, `YOU planted the charge at ${site}  +$${PLANT_REWARD}`);
        pushEvent(s, { kind: 'planted', site });
      }
    } else if (s.bomb.state === 'planted') {
      const d = Math.hypot(p.x - s.bomb.x, p.z - s.bomb.z);
      if (d < 2.5) {
        s.bomb.defuseT += dt;
        if (s.bomb.defuseT >= DEFUSE_TIME) {
          s.bomb.state = 'defused';
          s.bomb.defuser = 0;
        }
      } else {
        s.bomb.defuseT = 0;
      }
    }
  } else {
    s.bomb.plantT = 0;
    p.planting = 0;
    if (s.bomb.state === 'planted') s.bomb.defuseT = 0;
  }
}

// One fixed step. `input` is the frame's sampled input (held keys + edges).
export function step(s, input, dt) {
  s.time += dt;

  if (s.phase === PHASE.MENU || s.phase === PHASE.MATCH) {
    // Idle scene: bots hold their posts so the menu has a living backdrop.
    for (const a of s.agents) if (!a.isPlayer) stepBot(s, a, s.time, dt);
    return;
  }
  if (s.phase === PHASE.BUY) {
    s.phaseT += dt;
    if (s.phaseT >= BUY_TIME) {
      s.phase = PHASE.LIVE;
      s.phaseT = 0;
      s.msg = 'GO — plant the charge.';
      s.msgT = 3;
    }
  } else if (s.phase === PHASE.LIVE) {
    s.phaseT += dt;
    s.roundT += dt;
    if (s.roundT >= ROUND_TIME && s.bomb.state !== 'planted') {
      endRound(s, 1, 'time expired — charge never planted');
    }
  } else if (s.phase === PHASE.OVER) {
    s.phaseT += dt;
    if (s.phaseT >= 5) {
      if (s.matchWinner >= 0) {
        s.phase = PHASE.MATCH;
      } else {
        s.round += 1;
        resetRound(s, worldRef);
        s.msg = `ROUND ${s.round} — buy phase`;
        s.msgT = 4;
      }
    }
    // Let the world settle behind the banner.
    for (const a of s.agents) if (!a.isPlayer) stepBot(s, a, s.time, dt);
    drainFx(s, dt);
    return;
  }

  const p = s.agents[0];
  // --- player ---
  if (s.phase === PHASE.LIVE || s.phase === PHASE.BUY) {
    stepPlayerMove(p, input, dt);
    handlePlayerInput(s, input, dt);
    const reloading = p.reloadT > 0;
    stepWeaponFeel(p, dt);
    if (reloading && p.reloadT <= 0) finishReload(p);
    p.ads = !!input.ads;
  }
  // --- bots ---
  for (const a of s.agents) {
    if (a.isPlayer) continue;
    stepBot(s, a, s.time, dt);
    const reloading = a.reloadT > 0;
    stepWeaponFeel(a, dt);
    if (reloading && a.reloadT <= 0) finishReload(a);
  }

  // --- bomb carry / drop / pickup ---
  const bomb = s.bomb;
  if (bomb.state === 'carried') {
    const c = s.agents[bomb.carrier];
    if (!c.alive) {
      bomb.state = 'dropped';
      bomb.x = c.x;
      bomb.z = c.z;
      pushFeed(s, 'The charge was dropped!');
    } else {
      bomb.x = c.x;
      bomb.z = c.z;
    }
  } else if (bomb.state === 'dropped') {
    for (const a of s.agents) {
      if (a.team === 0 && a.alive && Math.hypot(a.x - bomb.x, a.z - bomb.z) < 1.2) {
        bomb.state = 'carried';
        bomb.carrier = a.id;
        if (a.isPlayer) pushFeed(s, 'YOU picked up the charge');
        break;
      }
    }
  } else if (bomb.state === 'planted') {
    bomb.fuse -= dt;
    if (bomb.fuse <= 0) {
      pushEvent(s, { kind: 'explode', x: bomb.x, y: 1, z: bomb.z, big: true });
      // Blast: lethal inside the site, heavy damage nearby, walls shield.
      for (const t of s.agents) {
        if (!t.alive) continue;
        const d = Math.hypot(t.x - bomb.x, t.z - bomb.z);
        if (d < 14) damageAgent(s, t, d < 6 ? 500 : 130 - d * 6, null, false);
      }
      endRound(s, 0, 'charge detonated');
    }
  }
  if (bomb.state === 'defused') {
    endRound(s, 1, `charge defused by ${s.agents[bomb.defuser]?.name || 'a Sentinel'}`);
  }

  stepGrenades(s, dt);
  for (const sm of s.smokes) sm.life -= dt;
  s.smokes = s.smokes.filter((x) => x.life > 0);

  // --- round end by elimination ---
  if (s.phase === PHASE.LIVE) {
    if (aliveCount(s, 1) === 0) {
      endRound(s, 0, 'Sentinel team eliminated');
    } else if (aliveCount(s, 0) === 0 && bomb.state !== 'planted') {
      // With the bomb planted, dead attackers do not end the round: the
      // fuse or a defuse still decides it.
      endRound(s, 1, 'Vanguard eliminated');
    }
  }

  if (s.msgT > 0) s.msgT -= dt;
  s.noises.length = 0; // hearing stimuli only live for one step
  drainFx(s, dt);
}

// Tracer lifetimes tick down; dead ones are dropped.
function drainFx(s, dt) {
  for (const t of s.shots) t.life -= dt;
  s.shots = s.shots.filter((t) => t.life > 0);
}

// Buy-menu purchases (called from the HUD, only during the BUY phase).
// Returns a short message for the HUD to show.
export function buy(s, what) {
  const p = s.agents[0];
  if (s.phase !== PHASE.BUY) return 'Buy phase is over.';
  if (what === 'kevlar') {
    if (p.kevlar) return 'Kevlar already owned.';
    if (p.money < KEVLAR_PRICE) return 'Not enough money.';
    p.money -= KEVLAR_PRICE;
    p.kevlar = true;
    return 'Kevlar vest bought.';
  }
  if (what === 'frag' || what === 'smoke') {
    const price = what === 'frag' ? GRENADE_PRICE : SMOKE_PRICE;
    if (p.money < price) return 'Not enough money.';
    p.money -= price;
    if (what === 'frag') p.frags = Math.min(2, p.frags + 1);
    else p.smokes = Math.min(2, p.smokes + 1);
    return what === 'frag' ? 'Frag grenade bought.' : 'Smoke grenade bought.';
  }
  const w = WEAPONS[what];
  if (!w) return 'Unknown item.';
  if (p.money < w.price) return 'Not enough money.';
  if (!buyWeapon(s, p, what)) return 'Could not buy.';
  if (!s.owned) s.owned = ['p9'];
  if (!s.owned.includes(what)) s.owned.push(what);
  return `${w.name} bought.`;
}

export { KILL_REWARD };
export const SIM_DT = DT;
