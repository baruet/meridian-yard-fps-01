// player.js — first-person movement for the player agent: acceleration,
// friction, crouch, jump and AABB collision. Velocity chases its target with
// an exponential approach (snappy but weighty), and air control is weaker
// than ground control, so a jump commits you. Also owns weapon feel —
// recoil recovery and bloom decay — which bots share.
// input shape (fresh each fixed step): {f,b,l,r,crouch,jump,walk,ads}.
import { MOVE } from './config.js';
import { collideCircle } from './world.js';

// One fixed step of player locomotion. Reads `input`, writes the agent.
export function stepPlayerMove(a, input, dt) {
  if (!a.alive) return;

  // Wish direction in world space. Forward is (-sin yaw, -cos yaw) and
  // right is (cos yaw, -sin yaw); diagonal input is normalised.
  const wantX = (input.r ? 1 : 0) - (input.l ? 1 : 0);
  const wantZ = (input.f ? 1 : 0) - (input.b ? 1 : 0);
  const len = Math.hypot(wantX, wantZ) || 1;
  const sy = Math.sin(a.yaw);
  const cy = Math.cos(a.yaw);
  const mx = (-sy * wantZ + cy * wantX) / len;
  const mz = (-cy * wantZ - sy * wantX) / len;

  // Top speed depends on stance: crouched, aiming, walking quietly, or full run.
  const maxSpd = a.crouch
    ? MOVE.crouch
    : a.ads
      ? MOVE.ads
      : input.walk
        ? MOVE.walk * 0.55
        : MOVE.walk;
  const accel = a.onGround ? MOVE.accel : MOVE.accel * 0.35;
  const k = 1 - Math.exp((-accel * dt / maxSpd) * 8);
  a.vx += (mx * maxSpd - a.vx) * Math.min(1, k);
  a.vz += (mz * maxSpd - a.vz) * Math.min(1, k);

  // Standing still on the ground: friction bleeds speed away to a stop.
  if (wantX === 0 && wantZ === 0 && a.onGround) {
    const f = Math.exp(-MOVE.friction * dt);
    a.vx *= f;
    a.vz *= f;
    if (Math.hypot(a.vx, a.vz) < 0.05) { a.vx = 0; a.vz = 0; }
  }
  a.speed = Math.hypot(a.vx, a.vz);
  a.moving = a.speed > 0.4;

  // Vertical motion: gravity pulls, jump launches, ground is y = 0.
  // Crates are cover, not platforms — nobody climbs them.
  if (a.vy === undefined) a.vy = 0;
  if (input.jump && a.onGround) {
    a.vy = MOVE.jumpVel;
    a.onGround = false;
  }
  a.vy -= MOVE.gravity * dt;
  a.y += a.vy * dt;
  if (a.y <= 0) { a.y = 0; a.vy = 0; a.onGround = true; }

  // Horizontal motion resolves against the world's AABBs (axis-separated,
  // so sliding along a wall works) and stays inside the map bounds.
  const p = collideCircle(a.x, a.z, MOVE.radius, a.vx * dt, a.vz * dt);
  a.x = p.x;
  a.z = p.z;
  a.crouch = !!input.crouch;
}

// Recoil recovery + bloom decay + cooldown bookkeeping, shared by the
// player and the bots. Reload timing itself is driven by the sim, which
// watches reloadT cross zero and calls finishReload.
export function stepWeaponFeel(a, dt) {
  a.recoilP *= Math.exp(-7 * dt);
  a.recoilY *= Math.exp(-7 * dt);
  a.bloom = Math.max(0, a.bloom - dt * 0.11);
  if (a.fireCd > 0) a.fireCd -= dt;
  if (a.reloadT > 0) {
    a.reloadT -= dt;
    if (a.reloadT <= 0) a.reloadT = 0; // never linger negative: the sim
    // watches reloadT cross zero to call finishReload exactly once.
  }
}
