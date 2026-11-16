// world.js — MERIDIAN YARD, an original map. The geometry is plain data:
// boxes with a centre, a footprint, a height and a colour, plus the two
// bomb sites, the spawn points and the waypoint graph the bots walk.
//
// Collision and sight are pure AABB mathematics — no three.js in this file.
// The player, the bots and the hitscan resolver all use the same functions,
// so what you see is exactly what blocks you.
//
// Layout (metres, x east, z south, origin at mid). Attackers spawn in the
// south yard (z +20), defenders in the north (z -20). Site A sits west
// (the crate yard), Site B east (the warehouse); the mid lane runs at x ~ 0.
// Three lanes connect them: A-long in the west, mid through the double
// doors, and the B-tunnel underpass in the east. Crates and containers break
// every sightline, so no lane looks straight from one spawn to the other.

// A box: centre (x, z), footprint (w along x, d along z), height h, base y,
// colour c and a kind used by the renderer ('wall' by default).
const box = (x, z, w, d, h, y, c, kind) => ({ x, z, w, d, h, y: y || 0, c, kind: kind || 'wall' });

export const WORLD = {
  name: 'MERIDIAN YARD',
  bounds: { minX: -30, maxX: 30, minZ: -24, maxZ: 24 },
  boxes: [
    // Perimeter walls (5 m high, 1 m thick) — the yard's outer edge.
    box(0, -24.5, 62, 1, 5, 0, 0x8a6f4d),
    box(0, 24.5, 62, 1, 5, 0, 0x8a6f4d),
    box(-30.5, 0, 1, 50, 5, 0, 0x8a6f4d),
    box(30.5, 0, 1, 50, 5, 0, 0x8a6f4d),
    // Mid structure: a wall with a 4 m double-door gap at x -4..4, flanked
    // by crates, plus a low crate sitting in the doorway's approach.
    box(-6, -6, 4, 1.2, 3.6, 0, 0xc9a06b),
    box(6, -6, 4, 1.2, 3.6, 0, 0xc9a06b),
    box(-8.5, -2, 2.4, 2.4, 1.4, 0, 0xb08d57, 'crate'),
    box(8.5, -2, 2.4, 2.4, 1.4, 0, 0xb08d57, 'crate'),
    box(-8.5, -2, 2.4, 2.4, 1.2, 1.4, 0x9a5a34, 'crate'),
    box(0, -10, 3, 1.6, 1.1, 0, 0xb08d57, 'crate'),
    // Site A (west): crate yard behind a sand wall, teal container, stacked crates.
    box(-24, -14, 10, 1.2, 3.4, 0, 0xc9a06b),
    box(-28.5, -8, 1.2, 12, 3.4, 0, 0xc9a06b),
    box(-22, -18, 6, 2.2, 2.6, 0, 0x2e7f86, 'container'),
    box(-19, -12, 2.2, 2.2, 1.3, 0, 0xb08d57, 'crate'),
    box(-25, -10, 2.2, 2.2, 1.3, 0, 0xb08d57, 'crate'),
    box(-25, -10, 2.2, 2.2, 1.1, 1.3, 0x9a5a34, 'crate'),
    box(-16, -20, 2, 2, 2.4, 0, 0x2e7f86, 'container'),
    // Site B (east): warehouse block, rust container, tunnel mouth at z +2.
    box(24, -14, 10, 1.2, 3.4, 0, 0xc9a06b),
    box(28.5, -8, 1.2, 12, 3.4, 0, 0xc9a06b),
    box(22, -18, 6, 2.2, 2.6, 0, 0xc65d21, 'container'),
    box(19, -12, 2.2, 2.2, 1.3, 0, 0xb08d57, 'crate'),
    box(25, -10, 2.2, 2.2, 1.3, 0, 0xb08d57, 'crate'),
    box(26, -16, 2.4, 2.4, 2.2, 0, 0xc65d21, 'container'),
    // Mid and south cover: connector walls, the fountain block, sandbags.
    box(-12, 8, 6, 1.2, 2.6, 0, 0xc9a06b),
    box(12, 8, 6, 1.2, 2.6, 0, 0xc9a06b),
    box(0, 12, 4, 3, 1.0, 0, 0x6b563c, 'block'),
    box(-14, 2, 2, 1, 1.0, 0, 0xb08d57, 'crate'),
    box(14, 2, 2, 1, 1.0, 0, 0xb08d57, 'crate'),
    box(-20, 12, 3, 1.4, 1.2, 0, 0xb08d57, 'crate'),
    box(20, 12, 3, 1.4, 1.2, 0, 0xb08d57, 'crate'),
    // North connector walls behind the sites, for defender rotation.
    box(-14, -16, 1.2, 8, 3.0, 0, 0xc9a06b),
    box(14, -16, 1.2, 8, 3.0, 0, 0xc9a06b),
    box(0, -19, 12, 1.2, 3.0, 0, 0xc9a06b),
  ],
  sites: {
    A: { x: -23, z: -13, r: 4.5, label: 'SITE A — CRATE YARD' },
    B: { x: 23, z: -13, r: 4.5, label: 'SITE B — WAREHOUSE' },
  },
  // Waypoint graph the bots walk: id, x, z, neighbour ids. Bots move
  // hop-by-hop along it, never in a straight line across the map.
  waypoints: [
    { x: 0, z: 20, n: [1, 2, 3] }, // 0 attacker spawn
    { x: -10, z: 12, n: [0, 4, 6] }, // 1 towards A-long
    { x: 10, z: 12, n: [0, 5, 6] }, // 2 towards B-tunnel
    { x: 0, z: 10, n: [0, 1, 2, 7] }, // 3 mid doors approach
    { x: -20, z: 4, n: [1, 8] }, // 4 A-long
    { x: 20, z: 4, n: [2, 9] }, // 5 B-tunnel
    { x: 0, z: 0, n: [1, 2, 3, 7] }, // 6 mid cross
    { x: 0, z: -12, n: [3, 6, 8, 9] }, // 7 mid / defender yard
    { x: -23, z: -13, n: [4, 7] }, // 8 site A
    { x: 23, z: -13, n: [5, 7] }, // 9 site B
    { x: -16, z: -20, n: [7, 8] }, // 10 A back
    { x: 16, z: -20, n: [7, 9] }, // 11 B back
    { x: 0, z: -20, n: [7, 10, 11] }, // 12 defender spawn
  ],
  // Defender hold posts: [waypoint, facing yaw] per role.
  holds: {
    holdA: [[8, 1.2], [10, -0.6]],
    holdB: [[9, -1.2], [11, 0.6]],
    roam: [[7, 0]],
  },
};

// Spawn points, per team and agent id. Attackers face north (yaw 0);
// defenders face south (yaw PI, the outer two angled slightly inward).
const ATTACKER_SPOTS = [
  { x: 0, z: 20, yaw: 0 },
  { x: -3, z: 21, yaw: 0 },
  { x: 3, z: 21, yaw: 0 },
];
const DEFENDER_SPOTS = [
  { x: -6, z: -20, yaw: Math.PI },
  { x: 0, z: -21, yaw: Math.PI },
  { x: 6, z: -20, yaw: Math.PI },
  { x: -12, z: -18, yaw: Math.PI + 0.5 },
  { x: 12, z: -18, yaw: Math.PI - 0.5 },
];

export function spawnPoint(team, id) {
  if (team === 0) return ATTACKER_SPOTS[id] || ATTACKER_SPOTS[0];
  return DEFENDER_SPOTS[(id - 3) % DEFENDER_SPOTS.length];
}
export const spawn = spawnPoint;

// --- Slab test shared by every ray/segment query below ---------------------
// Intersects the ray o + t*d (t in [tLo, tHi]) with one axis-aligned box
// given by its min/max corners. Returns the entry t, or -1 on a miss.
// Written with plain scalars — no arrays allocated per call, so the hot
// loop (hitscan, bot vision) never pressures the garbage collector.
function slabHit(ox, oy, oz, dx, dy, dz, tLo, tHi, mn, mx) {
  let lo = tLo;
  let hi = tHi;
  // One slab per axis: x, then y, then z.
  for (let axis = 0; axis < 3; axis++) {
    const o = axis === 0 ? ox : axis === 1 ? oy : oz;
    const d = axis === 0 ? dx : axis === 1 ? dy : dz;
    const mnA = mn[axis];
    const mxA = mx[axis];
    if (Math.abs(d) < 1e-9) {
      if (o < mnA || o > mxA) return -1;
    } else {
      let t1 = (mnA - o) / d;
      let t2 = (mxA - o) / d;
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > lo) lo = t1;
      if (t2 < hi) hi = t2;
      if (lo > hi) return -1;
    }
  }
  return lo;
}

function boxBounds(b) {
  return [
    [b.x - b.w / 2, b.y, b.z - b.d / 2],
    [b.x + b.w / 2, b.y + b.h, b.z + b.d / 2],
  ];
}

// --- Collision: a circle (agent) against the boxes ------------------------
// Moves the circle by (dx, dz) one axis at a time, so sliding along a wall
// works: a blocked x move still lets the z move through. The result is
// clamped inside the map bounds. Boxes are treated as full height here;
// low crates still block walking (climbing is not a mechanic).
export function collideCircle(x, z, r, dx, dz) {
  let nx = x + dx;
  let nz = z + dz;
  for (const b of WORLD.boxes) {
    const hw = b.w / 2 + r;
    const hd = b.d / 2 + r;
    if (Math.abs(nx - b.x) < hw && Math.abs(z - b.z) < hd) nx = x;
    if (Math.abs(nx - b.x) < hw && Math.abs(nz - b.z) < hd) nz = z;
  }
  const { minX, maxX, minZ, maxZ } = WORLD.bounds;
  nx = Math.max(minX + r, Math.min(maxX - r, nx));
  nz = Math.max(minZ + r, Math.min(maxZ - r, nz));
  return { x: nx, z: nz };
}

// Does the segment (x0,y0,z0) -> (x1,y1,z1) pass through box b?
export function segmentHitsBox(x0, y0, z0, x1, y1, z1, b) {
  const [mn, mx] = boxBounds(b);
  return slabHit(x0, y0, z0, x1 - x0, y1 - y0, z1 - z0, 0, 1, mn, mx) >= 0;
}

// Is the line of sight between two points blocked by any box?
export function losBlocked(x0, y0, z0, x1, y1, z1) {
  for (const b of WORLD.boxes) {
    if (segmentHitsBox(x0, y0, z0, x1, y1, z1, b)) return true;
  }
  return false;
}

// Cast a ray from the origin along a unit direction, up to maxDist.
// Returns the nearest hit {t, box}, or null when nothing is hit.
export function rayWorld(ox, oy, oz, dx, dy, dz, maxDist) {
  let best = null;
  for (const b of WORLD.boxes) {
    const [mn, mx] = boxBounds(b);
    const t = slabHit(ox, oy, oz, dx, dy, dz, 0, maxDist, mn, mx);
    if (t >= 0 && (!best || t < best.t)) best = { t, box: b };
  }
  return best;
}

// Cast a ray against one agent's hitboxes. Standing: body 0..1.35 m, head
// 1.35..1.70 m; crouching shrinks both (body 0..0.82 m, head 0.82..1.05 m).
// Returns {t, head} for the nearest hit, or null. dir must be unit length.
export function rayAgent(ox, oy, oz, dx, dy, dz, maxDist, a) {
  const r = 0.38;
  const mn = [a.x - r, 0, a.z - r];
  const mx = [a.x + r, 0, a.z + r];
  const headTop = a.y + (a.crouch ? 1.05 : 1.7);
  const headBot = a.y + (a.crouch ? 0.82 : 1.35);
  mn[1] = headBot;
  mx[1] = headTop;
  const tHead = slabHit(ox, oy, oz, dx, dy, dz, 0, maxDist, mn, mx);
  mn[1] = a.y;
  mx[1] = headBot;
  const tBody = slabHit(ox, oy, oz, dx, dy, dz, 0, maxDist, mn, mx);
  if (tHead >= 0 && (tBody < 0 || tHead <= tBody)) return { t: tHead, head: true };
  if (tBody >= 0) return { t: tBody, head: false };
  return null;
}

// Which bomb site (if any) contains the point (x, z)? '' when none.
export function siteAt(x, z) {
  for (const k of ['A', 'B']) {
    const s = WORLD.sites[k];
    const dx = x - s.x;
    const dz = z - s.z;
    if (dx * dx + dz * dz < s.r * s.r) return k;
  }
  return '';
}

// Index of the waypoint nearest to (x, z).
export function nearestWp(x, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < WORLD.waypoints.length; i++) {
    const w = WORLD.waypoints[i];
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
