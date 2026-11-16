// MERIDIAN YARD — threejs-fps-01 entrypoint (Node 22, standard library only).
//
// Hands the game in: copies game/ (the playable game, plain static ES modules)
// and screenshots/ (the four staged PNG screens) from beside this file into
// /output, then writes /output/dossier.json with the vendored make.fun
// library — the summary the judge reads. Run it twice and both runs must
// produce byte-identical output.
//
// Serve the game locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fail fast before writing anything: a missing game or missing screens
// would hand in a broken entry, so refuse loudly instead.
const required = [join(here, 'game', 'index.html'), join(here, 'game', 'src', 'main.js')];
for (const path of required) {
  if (!existsSync(path)) throw new Error(`missing required file: ${path}`);
}
const shotsDir = join(here, 'screenshots');
if (!existsSync(shotsDir)) throw new Error(`missing screenshots directory: ${shotsDir}`);
const shotFiles = readdirSync(shotsDir).filter((f) => !f.startsWith('.'));
if (shotFiles.length === 0 || shotFiles.length > 4) {
  throw new Error(`expected 3-4 screenshots, found ${shotFiles.length} in: ${shotsDir}`);
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the
// bytes; the others refuse an entry the scorer would refuse (more than 4
// screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of
// game files, in all: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
