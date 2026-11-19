import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHeaders } from './browser/static-server.mjs';
import { collectResults, nextBaseline, summarizeAccessibility } from '../scripts/browser-gate-evidence.mjs';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

test('gate host applies the same _headers rules as Pages', async () => {
  const rules = parseHeaders(await readFile(new URL('../_headers', import.meta.url), 'utf8'));
  const all = rules.find(rule => rule.pattern === '/*');
  assert.ok(all, 'site-wide rule');
  assert.ok(all.headers.some(([name, value]) => name === 'Content-Security-Policy' && value.includes("script-src 'self'")));
});

test('manual rows are never recorded as run without a tester, date and versions', async () => {
  const manual = await read('./browser/manual-checks.json');
  assert.ok(manual.rows.length >= 5);
  assert.ok(manual.rows.some(row => row.kind === 'screen-reader'));
  for (const row of manual.rows) {
    assert.ok(['not-yet-run', 'pass', 'fail'].includes(row.status), row.id);
    if (row.status === 'not-yet-run') assert.deepEqual([row.date, row.tester, row.versions], [null, null, null], row.id);
    else {
      assert.match(row.date, /^\d{4}-\d{2}-\d{2}$/, row.id);
      assert.ok(row.tester && row.versions, `${row.id} needs tester and versions`);
    }
  }
});

test('performance thresholds cover both profiles with explicit limits', async () => {
  const thresholds = await read('./browser/performance-thresholds.json');
  const metrics = ['dashboardReadyMs', 'corpusReadyMs', 'corpusLongTaskBlockingMs', 'fullPaperRenderMs', 'questionNavigationMedianMs', 'interactionLatencyMaxMs'];
  for (const profile of ['desktop', 'mobile-emulated']) for (const metric of metrics) assert.ok(Number.isFinite(thresholds.profiles[profile][metric]) && thresholds.profiles[profile][metric] > 0, `${profile}.${metric}`);
});

test('accessibility baseline is only colour contrast and keys are well formed', async () => {
  const baseline = await read('./browser/a11y-baseline.json');
  assert.deepEqual(baseline.known, {}, 'the accessibility baseline is empty: fix new violations rather than recording them');
  for (const key of Object.keys(baseline.known)) assert.match(key, /^[a-z0-9-]+\|color-contrast\|#[0-9a-f]{6} on #[0-9a-f]{6}$/, key);
});

test('evidence collection treats failures as regressions and keeps baseline failures visible', () => {
  const attach = (name, body) => ({name: `evidence:${name}`, body: Buffer.from(JSON.stringify(body)).toString('base64')});
  const report = {suites: [{file: 'a.spec.mjs', specs: [
    {title: 'passes', tests: [{results: [{status: 'passed', duration: 5, attachments: [attach('axe-overview', {view: 'overview', axeVersion: '4', tags: ['wcag2aa'], known: [{key: 'overview|color-contrast|#111111 on #222222', count: 1}], regressions: []})]}]}]},
    {title: 'fails', tests: [{results: [{status: 'failed', duration: 7, error: {message: '\u001b[31mboom\u001b[39m'}, attachments: []}]}]},
  ]}]};
  const {checks, evidence} = collectResults(report);
  assert.deepEqual(checks.map(check => check.status), ['pass', 'fail']);
  assert.equal(checks[1].error, 'boom');
  const summary = summarizeAccessibility(evidence);
  assert.equal(summary.knownFailures.patterns, 1);
  assert.deepEqual(summary.knownFailures.byRule, {'color-contrast': 1});
});

test('the accessibility baseline only shrinks, including once it is empty, and only from a complete passing run', () => {
  const pass = [{id: 'axe.spec.mjs › axe: #overview', status: 'pass'}];
  const evidence = {'axe-overview': {counts: {'overview|color-contrast|#111111 on #222222': 1}}};
  assert.deepEqual(nextBaseline({known: {'overview|color-contrast|#111111 on #222222': 1, 'overview|color-contrast|#333333 on #444444': 1}}, pass, evidence), {'overview|color-contrast|#111111 on #222222': 1});
  assert.throws(() => nextBaseline({known: {}}, pass, evidence), /Refusing to enlarge/);
  assert.deepEqual(nextBaseline({known: {}}, pass, evidence, {allowGrowth: true}), {'overview|color-contrast|#111111 on #222222': 1});
  assert.throws(() => nextBaseline({known: {'overview|color-contrast|#111111 on #222222': 1}}, [...pass, {id: 'axe.spec.mjs › axe: #tests', status: 'fail'}], evidence), /failed or skipped checks/);
});
