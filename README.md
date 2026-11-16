# MERIDIAN YARD — a three.js tactical FPS

A 5v5 tactical first-person shooter built with three.js 0.187.0. Vanguard
attacks, Sentinel defends: plant the charge at Site A or B (or eliminate the
defenders) — first to 5 rounds takes the match.

## Play

Open `game/index.html` in a desktop browser (or serve the repo root and open
`game/`). Click to play, then:

| Input | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click to lock the pointer) |
| Click | Fire |
| Right-click | Aim |
| R | Reload |
| Ctrl | Crouch |
| Space | Jump |
| Shift | Walk quietly |
| E (hold) | Plant / defuse the charge |
| B | Buy menu |
| 1 – 4 | Weapons |
| G / Q | Frag / smoke grenade |
| M | Restart the match |

Buy phase: 14 s before each round — spend your $800 starting cash on rifles,
armour and grenades. Round wins pay out; the economy carries across rounds.

## What's inside

- `game/src/` — the game: deterministic fixed-step sim (`sim.js`,
  `weapons.js`, `bots.js`), world (`world.js`, `config.js`), rendering
  (`render.js`), HUD + minimap (`hud.js`), input + audio.
- `game/vendor/three/` — three.js 0.187.0, byte-identical to the kit.
- `game/index.html` — single import map, zero external URLs.
- `screenshots/` — four staged 1280×800 captures: menu, firefight, plant,
  round won.
- `main.ts` — entrypoint: builds the submission dossier
  (`MAKEFUN_OUTPUT_DIR=out node main.ts`).
- `shots.json` — the four staged screenshot poses.

Bots think, patrol, plant, defuse, throw grenades, and fight back — with
stuck recovery, so they route around walls instead of wedging into them.

## Verify

```sh
node --check game/src/*.js          # every module parses
node fps01-sim-test.mjs             # headless sim test (17 scenarios)
MAKEFUN_OUTPUT_DIR=out node main.ts # dossier build (deterministic)
```

## License

MIT — see `LICENSE`.
