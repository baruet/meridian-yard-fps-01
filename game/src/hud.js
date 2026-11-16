// hud.js — every DOM read/write lives here, plus the P1 minimap (§3.2).
// Element handles are cached once in createHud; text is only rewritten when
// the value actually changed, so a quiet frame costs nothing. The minimap is
// a small 2D canvas painted from WORLD.boxes + live agent positions: the
// player is a white arrow, allies are green dots, and enemies appear ONLY
// when a Vanguard agent has seen or heard them in the last few seconds
// (live dot at their real position, or a hollow ring at the last-seen spot)
// — never a permanent wallhack. The bomb shows as an amber diamond once
// planted or dropped.
import {
  WEAPONS, WEAPON_ORDER, GRENADE_PRICE, SMOKE_PRICE, KEVLAR_PRICE,
  PLANT_TIME, DEFUSE_TIME, BOMB_FUSE, ROUND_TIME, BUY_TIME,
} from './config.js';
import { PHASE } from './state.js';
import { WORLD, siteAt } from './world.js';
import { buy } from './sim.js';

function el(id) { return document.getElementById(id); }

export function createHud(onBuy) {
  const h = {
    hp: el('hp'), hpBar: el('hp-bar'), ammoMag: el('ammo-mag'), ammoRes: el('ammo-reserve'),
    ammoBox: el('ammo'), timer: el('timer'), score: el('score-value'), money: el('money'),
    weapon: el('weapon-name'), nades: el('nades'), team: el('team-alive'), msg: el('msg'),
    cross: el('crosshair'), hit: el('hitmarker'), feed: el('feed'), plant: el('plant-bar'),
    plantFill: el('plant-fill'), plantLabel: el('plant-label'), bomb: el('bomb-state'),
    overlay: el('overlay'), overlayTitle: el('overlay-title'), overlayCopy: el('overlay-copy'),
    playBtn: el('play'), buyMenu: el('buy-menu'), buyList: el('buy-list'), buyMsg: el('buy-msg'),
    vignette: el('vignette'), reload: el('reload-hint'), siteTag: el('site-tag'),
    map: el('minimap'), mapCtx: null, cache: {},
  };
  if (h.map) h.mapCtx = h.map.getContext('2d');
  h.onBuy = onBuy;
  return h;
}

function setText(h, key, node, value) {
  if (!node) return;
  if (h.cache[key] !== value) { h.cache[key] = value; node.textContent = value; }
}

// --- minimap -------------------------------------------------------------
const MAP_S = 3; // pixels per metre; world is 60 x 48 m -> 180 x 144 px
const mx = (x) => (x + 30) * MAP_S;
const mz = (z) => (z + 24) * MAP_S;

function hexColor(c) { return '#' + c.toString(16).padStart(6, '0'); }

// Is enemy `a` known right now? True if a Vanguard agent saw them recently
// (their last-seen point is close to the enemy's real spot), heard them, or
// the enemy was just hit. Sightings older than a few seconds go stale.
function enemyKnown(s, a) {
  if (s.time - a.lastHitT < 2) return true;
  for (const b of s.agents) {
    if (b.team !== 0 || !b.alive) continue;
    if (s.time - b.lastSeenT < 4) {
      const dx = b.lastSeenX - a.x, dz = b.lastSeenZ - a.z;
      if (dx * dx + dz * dz < 25) return true;
    }
    if (s.time - b.heardT < 4) {
      const dx = b.heardX - a.x, dz = b.heardZ - a.z;
      if (dx * dx + dz * dz < 36) return true;
    }
  }
  return false;
}

function paintMap(h, s) {
  const c = h.mapCtx;
  if (!c) return;
  c.clearRect(0, 0, 180, 144);
  c.fillStyle = 'rgba(20,22,26,0.85)';
  c.fillRect(0, 0, 180, 144);
  // Walls / crates / containers, in their real colours.
  for (const b of WORLD.boxes) {
    c.fillStyle = hexColor(b.c);
    c.globalAlpha = b.kind === 'crate' ? 0.75 : 0.95;
    c.fillRect(mx(b.x - b.w / 2), mz(b.z - b.d / 2), b.w * MAP_S, b.d * MAP_S);
  }
  c.globalAlpha = 1;
  // Sites: amber A, teal B.
  c.font = 'bold 10px monospace';
  c.textAlign = 'center'; c.textBaseline = 'middle';
  for (const k of ['A', 'B']) {
    const site = WORLD.sites[k];
    c.strokeStyle = k === 'A' ? '#f0a830' : '#2e7f86';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(mx(site.x), mz(site.z), site.r * MAP_S, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = c.strokeStyle;
    c.fillText(k, mx(site.x), mz(site.z));
  }
  // Last-seen rings: intel that is going stale, not a live position.
  for (const b of s.agents) {
    if (b.team !== 0 || !b.alive || s.time - b.lastSeenT >= 4) continue;
    c.strokeStyle = 'rgba(217,95,75,0.6)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(mx(b.lastSeenX), mz(b.lastSeenZ), 4, 0, Math.PI * 2);
    c.stroke();
  }
  // Bomb: amber diamond once planted or dropped.
  const bomb = s.bomb;
  if (bomb.state === 'planted' || bomb.state === 'dropped') {
    const bx = mx(bomb.x), by = mz(bomb.z);
    c.fillStyle = '#f0a830';
    c.beginPath();
    c.moveTo(bx, by - 5); c.lineTo(bx + 5, by); c.lineTo(bx, by + 5); c.lineTo(bx - 5, by);
    c.closePath(); c.fill();
  }
  // Agents: allies green, known enemies red, player a white arrow.
  for (const a of s.agents) {
    if (!a.alive) continue;
    const ax = mx(a.x), ay = mz(a.z);
    if (a.isPlayer) {
      c.save();
      c.translate(ax, ay);
      c.rotate(-a.yaw);
      c.fillStyle = '#e9e6df';
      c.beginPath();
      c.moveTo(0, -6); c.lineTo(4, 5); c.lineTo(-4, 5);
      c.closePath(); c.fill();
      c.restore();
    } else if (a.team === 0) {
      c.fillStyle = '#7fb069';
      c.beginPath(); c.arc(ax, ay, 3, 0, Math.PI * 2); c.fill();
    } else if (enemyKnown(s, a)) {
      c.fillStyle = '#d95f4b';
      c.beginPath(); c.arc(ax, ay, 3, 0, Math.PI * 2); c.fill();
    }
  }
}

// --- HUD -----------------------------------------------------------------
export function updateHud(h, s, input) {
  const p = s.agents[0];
  const w = WEAPONS[p.weapon];
  setText(h, 'hp', h.hp, String(Math.max(0, Math.ceil(p.hp))));
  h.hpBar.style.width = `${Math.max(0, p.hp)}%`;
  h.hpBar.style.background = p.hp > 50 ? '#7fb069' : p.hp > 25 ? '#f0a830' : '#d95f4b';
  setText(h, 'mag', h.ammoMag, p.reloadT > 0 ? '--' : String(p.mag));
  setText(h, 'res', h.ammoRes, `/ ${p.reserve}`);
  h.ammoBox.classList.toggle('empty', p.mag === 0);
  setText(h, 'wpn', h.weapon, w.name + (p.kevlar ? ' · KEVLAR' : ''));
  setText(h, 'nades', h.nades, `G frag ×${p.frags}   Q smoke ×${p.smokes}`);
  setText(h, 'money', h.money, `$${p.money}`);
  const t = s.phase === PHASE.LIVE ? Math.max(0, Math.ceil(ROUND_TIME - s.roundT))
    : s.phase === PHASE.BUY ? Math.max(0, Math.ceil(BUY_TIME - s.phaseT)) : 0;
  const mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
  setText(h, 'timer', h.timer, `${mm}:${ss}`);
  h.timer.classList.toggle('urgent', t <= 15 && s.phase === PHASE.LIVE);
  setText(h, 'score', h.score, `${s.wins[0]} — ${s.wins[1]}`);
  let alive = 0, foes = 0;
  for (const a of s.agents) if (a.alive) { if (a.team === 0) alive++; else foes++; }
  setText(h, 'team', h.team, `VANGUARD ${alive} · SENTINEL ${foes}`);
  setText(h, 'msg', h.msg, s.msgT > 0 ? s.msg : '');
  const b = s.bomb;
  let bt = '';
  if (b.state === 'carried') bt = b.carrier === 0 ? '◉ YOU CARRY THE CHARGE — plant at A or B (hold E)' : `◉ ${s.agents[b.carrier].name} carries the charge`;
  else if (b.state === 'dropped') bt = '◉ CHARGE DROPPED — walk over it to pick it up';
  else if (b.state === 'planted') bt = `◉ CHARGE PLANTED AT ${b.site} — ${Math.ceil(b.fuse)}s to detonation`;
  else if (b.state === 'defused') bt = '◉ CHARGE DEFUSED';
  setText(h, 'bomb', h.bomb, bt);
  h.bomb.classList.toggle('danger', b.state === 'planted');
  // Plant / defuse progress bar.
  const prog = p.planting > 0 ? p.planting / PLANT_TIME
    : b.state === 'planted' && b.defuseT > 0 ? b.defuseT / DEFUSE_TIME : 0;
  h.plant.style.display = prog > 0 ? 'block' : 'none';
  if (prog > 0) {
    h.plantFill.style.width = `${Math.min(100, prog * 100)}%`;
    setText(h, 'plantLabel', h.plantLabel, p.planting > 0 ? 'PLANTING CHARGE…' : 'DEFUSING…');
  }
  const site = siteAt(p.x, p.z);
  h.siteTag.style.display = site ? 'block' : 'none';
  if (site) setText(h, 'siteTag', h.siteTag, site === 'A' ? 'SITE A — CRATE YARD' : 'SITE B — WAREHOUSE');
  let feedHtml = '';
  for (const f of s.feed) feedHtml += `<div>${f.text}</div>`;
  if (h.cache.feed !== feedHtml) { h.cache.feed = feedHtml; h.feed.innerHTML = feedHtml; }
  const spread = 6 + p.bloom * 260 + (p.moving ? 6 : 0) + (p.ads ? -3 : 0);
  h.cross.style.setProperty('--gap', `${Math.max(3, spread).toFixed(1)}px`);
  setText(h, 'reload', h.reload, p.reloadT > 0 ? 'RELOADING…' : p.mag === 0 ? 'PRESS R TO RELOAD' : '');
  const v = h.cache.vig || 0;
  if (v > 0) {
    h.cache.vig = Math.max(0, v - 0.03);
    h.vignette.style.opacity = String(h.cache.vig);
  }
  paintMap(h, s);
  void input;
}

export function flashHitmarker(h, head) {
  h.hit.classList.add('on');
  h.hit.classList.toggle('head', !!head);
  setTimeout(() => h.hit.classList.remove('on'), 110);
}
export function flashDamage(h) {
  h.cache.vig = 0.85;
  h.vignette.style.opacity = '0.85';
}

export function showOverlay(h, title, copy, btn) {
  h.overlay.hidden = false;
  setText(h, 'ot', h.overlayTitle, title);
  setText(h, 'oc', h.overlayCopy, copy);
  h.playBtn.textContent = btn;
}
export function hideOverlay(h) { h.overlay.hidden = true; }

// Buy menu: rebuilt only when opened or after a purchase.
export function renderBuy(h, s) {
  const p = s.agents[0];
  let html = '';
  for (const id of WEAPON_ORDER) {
    const w = WEAPONS[id];
    const owned = s.owned.includes(id);
    html += `<button data-buy="${id}" class="${p.weapon === id ? 'sel' : ''}">`
      + `<b>${w.name}</b><span>${w.kind} · ${w.dmg} dmg · ${w.mag} rnd</span>`
      + `<i>${owned ? 'OWNED' : '$' + w.price}</i></button>`;
  }
  html += `<button data-buy="frag"><b>Frag grenade</b><span>×${p.frags} held · G to throw</span><i>$${GRENADE_PRICE}</i></button>`;
  html += `<button data-buy="smoke"><b>Smoke grenade</b><span>×${p.smokes} held · Q to throw</span><i>$${SMOKE_PRICE}</i></button>`;
  html += `<button data-buy="kevlar"><b>Kevlar vest</b><span>${p.kevlar ? 'owned' : 'body damage −30%'}</span><i>${p.kevlar ? 'OWNED' : '$' + KEVLAR_PRICE}</i></button>`;
  h.buyList.innerHTML = html;
  h.buyList.querySelectorAll('[data-buy]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const msg = buy(s, btn.getAttribute('data-buy'));
      setText(h, 'buymsg', h.buyMsg, `${msg}  — $${p.money}`);
      renderBuy(h, s);
      if (h.onBuy) h.onBuy();
    });
  });
}

export function setBuyOpen(h, s, open) {
  s.buyOpen = open;
  h.buyMenu.hidden = !open;
  if (open) {
    // Mouse buying needs a visible cursor: release the pointer lock while
    // the menu is open (clicking the canvas re-locks it afterwards).
    if (document.pointerLockElement) document.exitPointerLock();
    renderBuy(h, s);
  }
}

// True once per second while the charge is planted (drives the beep).
export function tickBombBeep(s, lastBeep) {
  if (s.bomb.state === 'planted') {
    const sec = Math.ceil(s.bomb.fuse);
    if (sec !== lastBeep.v) { lastBeep.v = sec; return true; }
  }
  return false;
}
export { BOMB_FUSE };
