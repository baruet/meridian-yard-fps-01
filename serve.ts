// MERIDIAN YARD — tiny static server for local development (Node 22, stdlib only).
//
// Serves game/ at http://localhost:8080 by default:
//   node serve.ts [--port 8080]
// Rejects any path that escapes game/ (403). Sends no-store so the browser
// always re-reads the files you just edited.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = join(here, 'game');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.glb': 'model/gltf-binary',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

let port = 8080;
const portFlag = process.argv.indexOf('--port');
if (portFlag !== -1 && process.argv[portFlag + 1]) port = Number(process.argv[portFlag + 1]);

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  const rel = normalize(urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, ''));
  const file = join(root, rel);
  // Refuse anything outside game/.
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('forbidden\n');
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(readFileSync(file));
});

server.listen(port, () => {
  console.log(`MERIDIAN YARD dev server: http://localhost:${port}`);
});
