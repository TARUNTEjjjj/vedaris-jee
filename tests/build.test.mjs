import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createHash, webcrypto} from 'node:crypto';
import {buildSite, serviceWorkerSource} from '../scripts/build.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'vedaris-build-'));
  for (const path of ['src', 'assets/fonts', 'data/imports/validated']) await mkdir(join(root, path), {recursive: true});
  const files = {
    'src/core.js': 'export const answer = 42;\n',
    'assets/app.js': "import {answer} from '../src/core.js'; export const archiveUrl = new URL('../data/archive.json', import.meta.url); console.log(answer);\n",
    'assets/style.css': '@font-face {font-family: Demo;src:url(./fonts/demo.woff2)}\n',
    'assets/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'assets/fonts/demo.woff2': 'test font bytes',
    'assets/fonts/LICENSE.txt': 'Test font notice',
    'data/archive.json': JSON.stringify({version: 1, checkedAt: '2026-11-11', sources: [], papers: []}),
    'data/imports/validated/unpublished.json': 'THIS MUST NOT SHIP',
    'index.html': '<!doctype html><link rel="icon" href="assets/icon.svg"><link rel="stylesheet" href="assets/style.css"><link rel="manifest" href="manifest.webmanifest"><script type="module" src="assets/app.js"></script>',
    'manifest.webmanifest': JSON.stringify({name: 'Vedaris', start_url: './', icons: [{src: 'assets/icon.svg', type: 'image/svg+xml', sizes: 'any'}]}),
    '_headers': '/*\n  X-Content-Type-Options: nosniff\n',
    '404.html': '<link rel="stylesheet" href="assets/style.css"><h1>Not found</h1><a href="./">Home</a>',
  };
  for (const [path, content] of Object.entries(files)) await writeFile(join(root, path), content);
  return root;
}

test('build emits deterministic versioned assets and excludes unpublished input', async () => {
  const root = await fixture();
  try {
    const first = await buildSite(root);
    const second = await buildSite(root);
    assert.deepEqual(second, first);
    const index = await readFile(join(root, 'dist/index.html'), 'utf8');
    assert.match(index, new RegExp(`src="${first.release}/assets/app.js"`));
    assert.match(index, new RegExp(`href="${first.release}/manifest.webmanifest"`));
    assert.equal(await readFile(join(root, `dist/${first.release}/index.html`), 'utf8'), index);
    assert.deepEqual(await readdir(join(root, 'dist')), ['404.html', '_headers', 'build-info.json', 'index.html', 'manifest.webmanifest', 'releases', 'sw.js']);
    assert.ok(Object.keys(first.files).every(path => !path.includes('imports/') && !path.includes('tests/')));
    assert.equal(await readFile(join(root, `dist/${first.release}/assets/fonts/LICENSE.txt`), 'utf8'), 'Test font notice');
    const appUrl = new URL(`${first.release}/assets/app.js`, 'https://example.org/app/');
    assert.equal(new URL('../data/archive.json', appUrl).pathname, `/app/${first.release}/data/archive.json`);
    const releaseManifest = JSON.parse(await readFile(join(root, `dist/${first.release}/manifest.webmanifest`), 'utf8'));
    assert.equal(new URL(releaseManifest.start_url, new URL(`${first.release}/manifest.webmanifest`, 'https://example.org/app/')).href, 'https://example.org/app/');
    for (const [path, expected] of Object.entries(first.files)) assert.equal(hash(await readFile(join(root, 'dist', path))), expected, path);
    const physicalFiles = new Map(await Promise.all(Object.keys(first.files).filter(path => path.startsWith(`${first.release}/`)).map(async path => [path, await readFile(join(root, 'dist', path))])));
    const builtWorker = workerHarness({version: first.version, sourceCode: await readFile(join(root, 'dist/sw.js'), 'utf8'), contents: physicalFiles});
    await builtWorker.lifecycle('install');
    assert.equal(builtWorker.stores.get(builtWorker.cacheName).size, first.precacheFiles);
    assert.ok(builtWorker.fetches.some(request => new URL(request.url).pathname.endsWith(`/${first.release}/`)));
    assert.ok(builtWorker.fetches.every(request => !new URL(request.url).pathname.endsWith('.html')));
    assert.equal(await (await builtWorker.request('', {mode: 'navigate'})).text(), index);
    const headers = await readFile(join(root, 'dist/_headers'), 'utf8');
    assert.match(headers, /X-Content-Type-Options: nosniff/);
    assert.match(headers, /\/releases\/\*\n  Cache-Control: public, max-age=31536000, immutable/);
    for (const path of ['/', '/index.html', '/sw.js', '/manifest.webmanifest']) assert.ok(headers.includes(`${path}\n  Cache-Control: no-cache`));
    const notFound = await readFile(join(root, 'dist/404.html'), 'utf8');
    assert.ok(notFound.includes(`href="/${first.release}/assets/style.css"`));
    assert.match(notFound, /href="\/">Home/);
    await writeFile(join(root, 'src/core.js'), 'export const answer = 43;\n');
    const third = await buildSite(root);
    assert.notEqual(third.version, first.version);
    assert.ok(Object.keys(third.files).every(path => !path.startsWith(first.release)));
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('oversized public assets fail before replacing the last valid build', async () => {
  const root = await fixture();
  try {
    const before = await buildSite(root);
    await writeFile(join(root, 'assets/oversized.bin'), Buffer.alloc(5 * 1024 * 1024 + 1));
    await assert.rejects(buildSite(root), /5 MiB budget/);
    assert.equal(JSON.parse(await readFile(join(root, 'dist/build-info.json'), 'utf8')).version, before.version);
  } finally { await rm(root, {recursive: true, force: true}); }
});

function workerHarness({scope = 'https://example.org/app/', version = 'release-a', networkFailure = null, sourceCode, contents} = {}) {
  const shell = `releases/${version}/`;
  contents ??= new Map([
    [`${shell}index.html`, '<html>release A</html>'],
    [`releases/${version}/assets/app.js`, 'export const version = "A";'],
    [`releases/${version}/data/archive.json`, '{"papers":[]}'],
  ]);
  const files = Object.fromEntries([...contents].map(([path, value]) => [path.endsWith('/index.html') ? path.slice(0, -'index.html'.length) : path, hash(value)]));
  const network = new Map([...contents].map(([path, value]) => [new URL(path, scope).href, value]));
  const stores = new Map();
  const handlers = {};
  const fetches = [];
  const controls = {networkFailure, skipWaiting: 0, claim: 0};
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const values = stores.get(name);
      return {async match(key) { return values.get(typeof key === 'string' ? key : key.url)?.clone(); }, async put(key, value) { values.set(typeof key === 'string' ? key : key.url, value.clone()); }};
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const context = {
    self: {registration: {scope}, addEventListener(type, callback) { handlers[type] = callback; }, skipWaiting() { controls.skipWaiting++; }, clients: {claim() { controls.claim++; }}},
    caches, URL, Request, Response, crypto: webcrypto,
    async fetch(request) {
      fetches.push(request);
      if (controls.networkFailure === 'offline') throw new Error('offline');
      if (controls.networkFailure === '404') return new Response('not found', {status: 404});
      if (controls.networkFailure === 'mismatch') return new Response('<html>wrong deployment fallback</html>');
      const url = new URL(request.url);
      // Cloudflare Pages canonicalizes index.html and .html before serving file bytes.
      if (url.pathname.endsWith('.html')) {
        if (request.redirect === 'error') throw new TypeError('Pages canonical redirect rejected');
        url.pathname = url.pathname.endsWith('/index.html') ? url.pathname.slice(0, -'index.html'.length) : url.pathname.slice(0, -'.html'.length);
        return Response.redirect(url.href, 308);
      }
      const physicalUrl = url.pathname.endsWith('/') ? `${request.url}index.html` : request.url;
      if (!network.has(physicalUrl)) return new Response('missing', {status: 404});
      return new Response(network.get(physicalUrl));
    },
  };
  vm.runInNewContext(sourceCode ?? serviceWorkerSource({version, files, shell}), context);
  async function lifecycle(type) { let promise; handlers[type]({waitUntil(value) { promise = value; }}); return promise; }
  function request(path, {mode = 'cors', method = 'GET'} = {}) {
    let response;
    handlers.fetch({request: {url: new URL(path, scope).href, method, mode}, respondWith(value) { response = value; }});
    return response;
  }
  return {stores, controls, fetches, lifecycle, request, cacheName: `vedaris-static:${scope}:${version}`, shellUrl: new URL(shell, scope).href, scope, version};
}

test('SW verifies an entire release, uses only its own cache and leaves active tabs alone', async () => {
  const worker = workerHarness();
  worker.stores.set('another-app', new Map());
  worker.stores.set('vedaris-static:https://example.org/other/:old', new Map());
  worker.stores.set(`vedaris-static:${worker.scope}:old`, new Map());
  await worker.lifecycle('install');
  assert.equal(worker.stores.get(worker.cacheName).size, 3);
  assert.equal(worker.controls.skipWaiting, 0);
  await worker.lifecycle('activate');
  assert.equal(worker.controls.claim, 0);
  assert.ok(worker.stores.has('another-app'));
  assert.ok(worker.stores.has('vedaris-static:https://example.org/other/:old'));
  assert.ok(!worker.stores.has(`vedaris-static:${worker.scope}:old`));
  const before = worker.fetches.length;
  worker.controls.networkFailure = 'offline';
  const response = await worker.request('', {mode: 'navigate'});
  assert.equal(await response.text(), '<html>release A</html>');
  assert.equal(worker.fetches.length, before);
  assert.equal(await (await worker.request(`releases/${worker.version}/assets/app.js`)).text(), 'export const version = "A";');
  assert.equal(worker.request('releases/release-b/assets/app.js'), undefined);
  assert.equal(worker.request('https://external.example/paper.pdf'), undefined);
  assert.equal(worker.request('missing-page', {mode: 'navigate'}), undefined);
  assert.equal(worker.request('', {method: 'POST'}), undefined);
});

test('SW install rejects 404s and HTML deployment fallbacks without leaving a poisoned cache', async () => {
  for (const networkFailure of ['404', 'mismatch']) {
    const worker = workerHarness({networkFailure});
    await assert.rejects(worker.lifecycle('install'), networkFailure === '404' ? /unavailable/ : /digest mismatch/);
    assert.equal(worker.stores.has(worker.cacheName), false);
  }
});

test('SW does not persist failed navigation fallbacks when its cache has been evicted', async () => {
  const worker = workerHarness();
  await worker.lifecycle('install');
  worker.stores.delete(worker.cacheName);
  worker.controls.networkFailure = '404';
  const response = await worker.request('index.html?offline=1', {mode: 'navigate'});
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(worker.stores.get(worker.cacheName).size, 0);
  worker.controls.networkFailure = null;
  const recovered = await worker.request('', {mode: 'navigate'});
  assert.equal(recovered.status, 200);
  assert.equal(worker.stores.get(worker.cacheName).size, 1);
});
