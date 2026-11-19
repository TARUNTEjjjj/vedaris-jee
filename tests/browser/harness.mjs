// Dependency-free headless-Chrome harness for browser UI tests.
// It serves the source tree plus freshly compiled reviewed-content bundles
// from memory (no dist/ write) and drives Chrome over the DevTools protocol.
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareContent } from '../../scripts/build-content.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

/** CHROME_PATH wins; otherwise common install locations. CI must find one. */
export function findChrome() {
  const candidates = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  for (const path of candidates) if (path && existsSync(path)) return path;
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { return execFileSync('which', [name], { encoding: 'utf8' }).trim() || null; } catch {}
  }
  return null;
}

export async function compiledContent() {
  const archive = JSON.parse(await readFile(join(ROOT, 'data/archive.json'), 'utf8'));
  const assets = (await readdir(join(ROOT, 'assets/content'), { recursive: true })).map(path => `assets/content/${path.split(sep).join('/')}`);
  return (await prepareContent(ROOT, archive, assets)).inputs;
}

export async function startServer() {
  const content = await compiledContent();
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const file = normalize(join(ROOT, path));
    try {
      if (!file.startsWith(ROOT) || path.split('/').includes('..')) throw new Error('outside');
      const bytes = content.get(path) ?? await readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(bytes);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { origin: `http://127.0.0.1:${server.address().port}`, content, close: () => new Promise(resolve => server.close(resolve)) };
}

export async function launchChrome(executable) {
  const profile = await mkdtemp(join(tmpdir(), 'vedaris-chrome-'));
  const downloads = await mkdtemp(join(tmpdir(), 'vedaris-downloads-'));
  const child = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking', '--no-sandbox', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start')), 20000);
    child.stderr.on('data', chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}): ${text.slice(-500)}`)); });
  });
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map(), listeners = new Set();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id); pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    } else for (const listener of listeners) listener(message);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId; pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  await send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true });

  async function newPage() {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const call = (method, params) => send(method, params, sessionId);
    await call('Page.enable'); await call('Runtime.enable');
    const errors = [];
    const onEvent = message => { if (message.sessionId === sessionId && message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text); };
    listeners.add(onEvent);
    const page = {
      errors, cdp: call,
      async evaluate(expression) {
        const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      },
      async goto(url) {
        const loaded = new Promise(resolve => { const listener = message => { if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') { listeners.delete(listener); resolve(); } }; listeners.add(listener); });
        await call('Page.navigate', { url }); await loaded;
      },
      async waitFor(expression, { timeout = 15000, message = expression } = {}) {
        const end = Date.now() + timeout;
        for (;;) {
          try { const value = await page.evaluate(expression); if (value) return value; } catch {}
          if (Date.now() > end) throw new Error(`Timed out waiting for: ${message}`);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      },
      async click(selector) {
        await page.waitFor(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});return !!el&&!el.disabled})()`, { message: `enabled ${selector}` });
        await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
      },
      async check(selector) {
        await page.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, { message: selector });
        await page.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}))})()`);
      },
      async upload(selector, path) {
        await page.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, { message: selector });
        const { root } = await call('DOM.getDocument', { depth: 0 });
        const { nodeId } = await call('DOM.querySelector', { nodeId: root.nodeId, selector });
        await call('DOM.setFileInputFiles', { nodeId, files: [path] });
      },
      text: () => page.evaluate('document.querySelector("#main").innerText'),
      close: async () => { listeners.delete(onEvent); await send('Target.closeTarget', { targetId }); },
    };
    return page;
  }

  /** Run fn, then return the path of the one file it downloaded. */
  async function download(fn) {
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Download did not finish')), 15000);
      const listener = message => {
        if (message.method === 'Browser.downloadProgress' && message.params.state === 'completed') { clearTimeout(timer); listeners.delete(listener); resolve(join(downloads, message.params.guid)); }
      };
      listeners.add(listener);
    });
    await fn();
    return done;
  }

  async function close() {
    try { socket.close(); } catch {}
    child.kill('SIGKILL');
    await new Promise(resolve => setTimeout(resolve, 200));
    await rm(profile, { recursive: true, force: true }).catch(() => {});
    await rm(downloads, { recursive: true, force: true }).catch(() => {});
  }
  return { newPage, download, downloads, close };
}
