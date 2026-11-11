import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const origin = 'https://vedaris-jee.pages.dev';
const version = '0123456789abcdef0123';
const release = `releases/${version}`;
const digest = 'a'.repeat(64);
const source = (await readFile(new URL('../scripts/loadtest.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replace(/^export const /gm, 'const ')
  .replace(/^export function setup\(/m, 'function setup(')
  .replace(/^export default function \(release\)/m, 'function runIteration(release)')
  + '\nglobalThis.profile = {setup, runIteration, options};';

function fixture() {
  return { version, release, files: {
    [`${release}/index.html`]: digest,
    [`${release}/assets/app.js`]: digest,
    [`${release}/guide.html`]: digest,
    [`${release}/help/index.html`]: digest,
    [`${release}/data/archive.json`]: digest,
    'index.html': digest,
    'https://publisher.example/paper.pdf': digest,
  } };
}

// The stubs are the only transport. These tests cannot perform network requests.
function harness({ env = {}, manifest = fixture() } = {}) {
  const requests = [];
  const checks = [];
  const sleeps = [];
  const counts = new Map();
  const context = vm.createContext({
    __ENV: env,
    console: { log() {} },
    check(response, predicates) {
      const outcomes = Object.entries(predicates).map(([name, predicate]) => {
        const passed = predicate(response);
        checks.push({ name, passed });
        return passed;
      });
      return outcomes.every(Boolean);
    },
    fail(message) { throw new Error(message); },
    sleep(seconds) { sleeps.push(seconds); },
    Counter: class {
      constructor(name) { this.name = name; }
      add(value) { counts.set(this.name, (counts.get(this.name) || 0) + value); }
    },
    http: {
      get(url, params) {
        requests.push({ method: 'GET', url, params });
        if (url === `${origin}/build-info.json`) return { status: 200, json: () => manifest };
        if (url === `${origin}/`) return { status: 200, body: `<script src="${release}/assets/app.js"></script>` };
        throw new Error(`Unexpected GET: ${url}`);
      },
      batch(batch) {
        return batch.map(request => {
          requests.push(request);
          // Simulate Cloudflare's physical HTML redirect to expose regressions.
          return { status: request.url.endsWith('.html') ? 308 : 200 };
        });
      },
    },
  });
  vm.runInContext(source, context, { filename: 'loadtest.js' });
  return { ...context.profile, requests, checks, sleeps, counts };
}

test('load profile validates physical files then uses owned canonical Pages URLs', () => {
  const runner = harness();
  const data = runner.setup();
  assert.ok(data.files.includes(`${release}/index.html`), 'manifest still uses physical filenames');
  runner.runIteration(data);
  assert.deepEqual(runner.requests.map(request => request.url), [
    `${origin}/build-info.json`, `${origin}/`,
    `${origin}/${release}/assets/app.js`,
    `${origin}/${release}/data/archive.json`,
    `${origin}/${release}/guide`,
    `${origin}/${release}/help/`,
    `${origin}/${release}/`,
  ]);
  assert.ok(runner.requests.every(request => new URL(request.url).origin === origin));
  assert.ok(runner.requests.every(request => request.params.redirects === 0));
  assert.ok(runner.checks.every(result => result.passed));
  assert.equal(runner.counts.get('successful_cold_sessions'), 1);
  assert.equal(runner.options.scenarios.readers.stages[0].target, 25);
  assert.ok(runner.sleeps.every(seconds => seconds >= 20 && seconds < 40));
});

test('study mode downloads once per virtual user; cold mode downloads each iteration', () => {
  for (const [mode, expectedDownloads] of [['study', 1], ['cold', 2]]) {
    const runner = harness({ env: { MODE: mode } });
    const data = runner.setup();
    runner.runIteration(data);
    runner.runIteration(data);
    assert.equal(runner.requests.filter(request => request.url === `${origin}/`).length, expectedDownloads);
    assert.equal(runner.requests.filter(request => request.url === `${origin}/${release}/`).length, expectedDownloads);
    assert.equal(runner.counts.get('successful_cold_sessions'), expectedDownloads);
    assert.equal(runner.sleeps.length, 2);
  }
});

test('foreign, disguised, and non-HTTPS hosts are rejected before any request', () => {
  for (const host of [
    'https://publisher.example', 'http://vedaris-jee.pages.dev',
    'https://vedaris-jee.pages.dev.evil.example', 'https://vedaris-jee.pages.dev@evil.example',
    'https://vedaris-jee.pages.dev:443', 'https://vedaris-jee.pages.dev?next=evil',
  ]) assert.throws(() => harness({ env: { BASE_URL: host } }), /BASE_URL must be exactly/);
  assert.doesNotThrow(() => harness({ env: { BASE_URL: `${origin}/` } }));
});

test('virtual user limits reject ambiguous values and permit an explicit 10000 target', () => {
  for (const value of ['0', '-1', '10001', '1.5', '1e4', 'NaN', ' 25']) {
    assert.throws(() => harness({ env: { MAX_VUS: value } }), /MAX_VUS must be an integer/);
  }
  const runner = harness({ env: { MAX_VUS: '10000' } });
  assert.equal(runner.options.scenarios.readers.stages[0].target, 10000);
  assert.equal(runner.options.scenarios.readers.stages[0].duration, '10m');
});

test('unsafe physical paths and invalid hashes fail before asset traffic or canonicalization', () => {
  for (const path of [`${release}/../secret.html`, `${release}/help/../../secret.html`, `${release}/%2e%2e/secret.html`]) {
    const manifest = fixture();
    manifest.files[path] = digest;
    const runner = harness({ manifest });
    assert.throws(() => runner.setup(), /Unsafe, empty, or unexpectedly large/);
    assert.equal(runner.requests.length, 1, 'only build-info was requested');
  }
  const manifest = fixture();
  manifest.files[`${release}/index.html`] = 'not-a-digest';
  const runner = harness({ manifest });
  assert.throws(() => runner.setup(), /Unsafe, empty, or unexpectedly large/);
  assert.equal(runner.requests.length, 1);
});
