// Dev-only static host for the browser release gate. It serves a built dist/
// tree with the same `_headers` rules Cloudflare Pages applies, can switch to a
// newer build in place (upgrade-while-active) and can drop every connection to
// simulate a network outage without relying on browser offline emulation.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

/** Parse the subset of the Pages `_headers` format used by the build. */
export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) { current = {pattern: line.trim(), headers: []}; rules.push(current); continue; }
    const index = line.indexOf(':');
    if (current && index > 0) current.headers.push([line.slice(0, index).trim(), line.slice(index + 1).trim()]);
  }
  return rules;
}
const matches = (pattern, path) => pattern.endsWith('*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path;

export async function startStaticServer({root, host = '127.0.0.1', port = 0} = {}) {
  let base = resolve(root), down = false, headerRules = [];
  const sockets = new Set();
  const requests = [];
  async function loadHeaders() {
    try { headerRules = parseHeaders(await readFile(join(base, '_headers'), 'utf8')); } catch { headerRules = []; }
  }
  await loadHeaders();
  const server = createServer(async (request, response) => {
    if (down) { request.socket.destroy(); return; }
    const url = new URL(request.url, 'http://local');
    requests.push(url.pathname);
    let path = decodeURIComponent(url.pathname);
    const headers = {};
    for (const rule of headerRules) if (matches(rule.pattern, path)) for (const [name, value] of rule.headers) headers[name] = value;
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(base, path));
    if (file !== base && !file.startsWith(base + sep)) { response.writeHead(400).end(); return; }
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      const bytes = await readFile(file);
      response.writeHead(200, {...headers, 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Content-Length': bytes.length});
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      let body = 'Not found';
      try { body = await readFile(join(base, '404.html')); } catch {}
      response.writeHead(404, {...headers, 'Content-Type': 'text/html; charset=utf-8'}).end(body);
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, host, resolveListen); });
  const address = server.address();
  return {
    port: address.port,
    requests,
    /** Serve another build tree from the same origin, like a new deployment. */
    async setRoot(next) { base = resolve(next); await loadHeaders(); },
    /** Refuse every connection, as if the device lost its network. */
    setDown(value) { down = value; if (value) for (const socket of sockets) socket.destroy(); },
    close() { for (const socket of sockets) socket.destroy(); return new Promise(done => server.close(() => done())); },
  };
}
