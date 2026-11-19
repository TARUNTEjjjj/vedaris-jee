// Compile a dated browser release-gate evidence record from a Playwright run.
//
//   node scripts/browser-gate-evidence.mjs                 # print a summary, write test-results/browser-gate/evidence.json
//   node scripts/browser-gate-evidence.mjs --out docs/releases/browser-gates
//                                                          # also keep a dated copy: YYYY-MM-DD-<release>.json
//   node scripts/browser-gate-evidence.mjs --write-a11y-baseline
//                                                          # only after fixing issues: shrink the known-violation baseline
//
// The record binds results to the exact build (release hash, app version,
// commit) and the measuring machine. Manual checks are copied from
// tests/browser/manual-checks.json and are never marked as run here.
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const readJSON = async path => JSON.parse(await readFile(join(root, path), 'utf8'));
const git = (...command) => { try { return execFileSync('git', command, {cwd: root, encoding: 'utf8'}).trim(); } catch { return null; } };

export function collectResults(report) {
  const checks = [], evidence = {};
  const walk = (suite, file) => {
    for (const child of suite.suites ?? []) walk(child, child.file ?? file);
    for (const spec of suite.specs ?? []) for (const run of spec.tests ?? []) {
      const result = run.results?.at(-1);
      const status = result?.status ?? 'not-run';
      checks.push({id: `${spec.file ?? file} › ${spec.title}`, status: status === 'passed' ? 'pass' : status === 'skipped' ? 'skipped' : 'fail', durationMs: result?.duration ?? null, error: status === 'passed' ? null : (result?.error?.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').slice(0, 6).join('\n')});
      for (const attachment of result?.attachments ?? []) if (attachment.name.startsWith('evidence:') && attachment.body) evidence[attachment.name.slice('evidence:'.length)] = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
    }
  };
  for (const suite of report.suites ?? []) walk(suite, suite.file);
  return {checks, evidence};
}

export function summarizeAccessibility(evidence) {
  const views = Object.entries(evidence).filter(([name]) => name.startsWith('axe-')).map(([, body]) => body);
  const known = {}, regressions = [];
  for (const view of views) {
    for (const item of view.known ?? []) known[item.key] = 1;
    regressions.push(...(view.regressions ?? []));
  }
  const byRule = {};
  for (const key of Object.keys(known)) { const rule = key.split('|')[1]; byRule[rule] = (byRule[rule] ?? 0) + 1; }
  return {axeVersion: views[0]?.axeVersion ?? null, tags: views[0]?.tags ?? [], viewsAudited: views.map(view => view.view), regressions, knownFailures: {byRule, patterns: Object.keys(known).length, keys: Object.keys(known).sort()}};
}

async function main() {
  const report = await readJSON('test-results/browser-gate/results.json');
  const {checks, evidence} = collectResults(report);
  if (args.includes('--write-a11y-baseline')) {
    const counts = {};
    for (const [name, body] of Object.entries(evidence)) if (name.startsWith('axe-')) Object.assign(counts, body.counts);
    const path = join(root, 'tests/browser/a11y-baseline.json');
    const previous = JSON.parse(await readFile(path, 'utf8'));
    const grew = Object.entries(counts).filter(([key, count]) => count > (previous.known[key] ?? 0) && Object.keys(previous.known).length);
    if (grew.length && !args.includes('--allow-growth')) throw new Error(`Refusing to enlarge the accessibility baseline (fix these instead):\n${grew.map(([key, count]) => `${key}: ${count}`).join('\n')}`);
    const known = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, 'en')));
    await writeFile(path, `${JSON.stringify({version: 1, recordedAt: new Date().toISOString().slice(0, 10), note: 'Known WCAG violations when recorded. Each key may only shrink; see docs/BROWSER-RELEASE-GATES.md.', known}, null, 2)}\n`);
    console.log(`Wrote ${Object.keys(known).length} baseline keys to tests/browser/a11y-baseline.json`);
    return;
  }
  const build = await readJSON('dist/build-info.json');
  const app = await readJSON('dist/app-version.json');
  const pkg = await readJSON('package.json');
  const manual = await readJSON('tests/browser/manual-checks.json');
  const thresholds = await readJSON('tests/browser/performance-thresholds.json');
  const performance = Object.fromEntries(Object.entries(evidence).filter(([name]) => name.startsWith('performance-')).map(([name, body]) => [name.slice('performance-'.length), body]));
  const accessibility = summarizeAccessibility(evidence);
  const failed = checks.filter(check => check.status === 'fail');
  const perfFailures = Object.entries(performance).flatMap(([profile, body]) => Object.entries(body.checks).filter(([, check]) => !check.pass).map(([metric, check]) => `${profile} ${metric} ${check.value} > ${check.limit}`));
  const pendingManual = manual.rows.filter(row => row.status !== 'pass');
  const now = new Date();
  const record = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    release: {
      releaseVersion: build.version, appVersion: app.version, packageVersion: pkg.version,
      commit: process.env.GITHUB_SHA ?? git('rev-parse', 'HEAD'), workingTreeClean: git('status', '--porcelain') === '',
      ci: process.env.GITHUB_RUN_ID ? {runId: process.env.GITHUB_RUN_ID, repository: process.env.GITHUB_REPOSITORY ?? null} : null,
    },
    environment: Object.values(performance)[0]?.device ?? null,
    playwright: report.config?.version ?? null,
    automated: {total: checks.length, passed: checks.filter(check => check.status === 'pass').length, failed: failed.length, skipped: checks.filter(check => check.status === 'skipped').length, checks},
    accessibility,
    performance: {thresholdStatus: thresholds.status, profiles: performance},
    offline: Object.fromEntries(Object.entries(evidence).filter(([name]) => /^(offline|upgrade)/.test(name))),
    manual: manual.rows,
    // A failed automated check is a regression. Known accessibility failures and
    // manual checks that have not been run keep the release decision open.
    decision: {
      automatedGate: failed.length ? 'fail' : 'pass',
      regressions: [...failed.map(check => check.id), ...perfFailures, ...accessibility.regressions.map(item => `a11y ${item.key}`)],
      knownOpenFailures: Object.entries(accessibility.knownFailures.byRule).map(([rule, patterns]) => `${rule}: ${patterns} view/pattern pairs (baseline)`),
      manualChecksNotRun: pendingManual.map(row => row.id),
      releaseReady: !failed.length && !accessibility.knownFailures.patterns && !pendingManual.length,
    },
  };
  await mkdir(join(root, 'test-results/browser-gate'), {recursive: true});
  await writeFile(join(root, 'test-results/browser-gate/evidence.json'), `${JSON.stringify(record, null, 2)}\n`);
  const out = option('--out');
  if (out) {
    const directory = resolve(root, out);
    await mkdir(directory, {recursive: true});
    const file = join(directory, `${now.toISOString().slice(0, 10)}-${build.version}.json`);
    await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`Evidence: ${file}`);
  }
  console.log(`Release ${build.version} (app ${app.version.slice(0, 12)}): ${record.automated.passed}/${record.automated.total} automated checks passed; ${record.decision.regressions.length} regression(s); known open failures: ${record.decision.knownOpenFailures.join('; ') || 'none'}; manual checks not run: ${pendingManual.length}.`);
  if (record.decision.regressions.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
