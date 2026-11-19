// Full-corpus startup, render and input timing with recorded device details.
// Thresholds live in performance-thresholds.json; each run attaches its raw
// measurements, which the evidence script stores with the release identity.
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { test, expect, DIST, HOST, OPTIONAL_HOSTS, recordEvidence } from './fixtures.mjs';

const BUILD = JSON.parse(readFileSync(join(DIST, 'build-info.json'), 'utf8'));
const THRESHOLDS = JSON.parse(readFileSync(new URL('./performance-thresholds.json', import.meta.url), 'utf8'));
const PROFILES = {
  desktop: {viewport: {width: 1366, height: 900}, deviceScaleFactor: 1, isMobile: false, hasTouch: false, cpuThrottle: 1},
  'mobile-emulated': {viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true, cpuThrottle: 4},
};
const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };

// Runs in the page before any app script: records when key screens appear,
// interaction latency (Event Timing, the basis of INP) and long tasks.
function instrument() {
  window.__gate = {marks: {}, events: [], longTasks: []};
  const watch = {
    dashboard: () => /Show up\. Solve\. Improve\./.test(document.querySelector('#main h1')?.textContent || ''),
    pyq: () => /The PYQ workspace\./.test(document.querySelector('#main h1')?.textContent || ''),
  };
  new MutationObserver(() => {
    for (const [name, ready] of Object.entries(watch)) if (!(name in window.__gate.marks) && ready()) window.__gate.marks[name] = performance.now();
  }).observe(document, {subtree: true, childList: true, characterData: true});
  try {
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.interactionId) window.__gate.events.push({name: entry.name, duration: entry.duration}); })
      .observe({type: 'event', durationThreshold: 16, buffered: true});
    new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__gate.longTasks.push({start: entry.startTime, duration: entry.duration}); })
      .observe({type: 'longtask', buffered: true});
  } catch {}
}

for (const [name, profile] of Object.entries(PROFILES)) {
  test(`full-corpus timing: ${name}`, async ({browser, origin, browserName}, testInfo) => {
    test.setTimeout(240_000);
    const limits = THRESHOLDS.profiles[name];
    const context = await browser.newContext({viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, isMobile: profile.isMobile, hasTouch: profile.hasTouch, locale: 'en-IN', timezoneId: 'Asia/Kolkata'});
    await context.addInitScript(instrument);
    // This context is created here, so it needs its own off-origin request record.
    const offOrigin = new Set();
    context.on('request', request => { const {hostname} = new URL(request.url()); if (/^https?:/.test(request.url()) && hostname !== HOST && !OPTIONAL_HOSTS.includes(hostname)) offOrigin.add(hostname); });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', {rate: profile.cpuThrottle});

    // Cold start: empty cache, no service worker yet.
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => 'dashboard' in window.__gate.marks, null, {timeout: 60_000});
    const navigation = await page.evaluate(() => { const [entry] = performance.getEntriesByType('navigation'); return {domContentLoaded: entry.domContentLoadedEventEnd, load: entry.loadEventEnd, transferBytes: entry.transferSize}; });
    const dashboardReady = await page.evaluate(() => window.__gate.marks.dashboard);

    // Full reviewed corpus: all paper bundles downloaded, hash-checked and indexed.
    const pyqStart = await page.evaluate(() => { const t = performance.now(); location.hash = 'pyq'; return t; });
    await page.waitForFunction(() => 'pyq' in window.__gate.marks, null, {timeout: 120_000});
    const pyqReady = await page.evaluate(start => window.__gate.marks.pyq - start, pyqStart);
    const corpus = await page.evaluate(() => ({questions: Number(document.querySelector('.pyq-coverage strong')?.textContent.replace(/\D/g, '')), papers: document.querySelectorAll('.pyq-paper-card .pyq-paper-entry').length, heapBytes: performance.memory?.usedJSHeapSize ?? null,
      contentBytes: performance.getEntriesByType('resource').filter(r => /data\/content\//.test(r.name)).reduce((sum, r) => sum + (r.encodedBodySize || 0), 0)}));
    const longTasksDuringLoad = await page.evaluate(start => window.__gate.longTasks.filter(task => task.start >= start).reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0), pyqStart);

    // Render: open a full paper (2026 Paper 2, the largest current paper) and show its first question.
    await page.locator('.pyq-paper-entry').filter({hasText: '2026 · Paper 2'}).getByRole('button', {name: 'Read instructions →'}).click();
    const renderStart = await page.evaluate(() => performance.now());
    await page.getByRole('button', {name: 'Begin full paper →'}).click();
    await page.locator('.pyq-question-meta').waitFor();
    const paperRender = await page.evaluate(start => performance.now() - start, renderStart);

    // Input: navigate questions and answer them with real pointer input.
    const navigations = [];
    for (let position = 2; position <= 12; position++) {
      const before = await page.evaluate(() => performance.now());
      await page.locator('.pyq-palette button').nth(position - 1).click();
      await expect(page.locator('.pyq-question-meta')).toContainText(`${position} / `);
      navigations.push(await page.evaluate(start => performance.now() - start, before));
      const choice = page.locator('[data-pyq-choice]').first();
      if (await choice.count()) await choice.click();
      else await page.getByLabel('Your numerical answer').pressSequentially('12.5');
    }
    const interactions = await page.evaluate(() => window.__gate.events.map(event => event.duration));
    const metrics = {
      domContentLoadedMs: Math.round(navigation.domContentLoaded),
      dashboardReadyMs: Math.round(dashboardReady),
      corpusReadyMs: Math.round(pyqReady),
      corpusLongTaskBlockingMs: Math.round(longTasksDuringLoad),
      fullPaperRenderMs: Math.round(paperRender),
      questionNavigationMedianMs: Math.round(median(navigations)),
      // Max over fewer than 50 interactions is how INP is defined; below 16 ms is not reported.
      interactionLatencyMaxMs: interactions.length ? Math.round(Math.max(...interactions)) : 16,
    };
    const device = {
      profile: name, cpuThrottle: profile.cpuThrottle, viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor, isMobileEmulation: profile.isMobile,
      browser: `${browserName} ${browser.version()}`, os: `${os.type()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length,
      memoryGiB: Math.round(os.totalmem() / 2 ** 30), node: process.version, ci: !!process.env.CI, network: 'loopback, unthrottled (transfer cost not represented)',
    };
    const checks = Object.fromEntries(Object.entries(limits).map(([metric, limit]) => [metric, {value: metrics[metric], limit, pass: metrics[metric] <= limit}]));
    await recordEvidence(testInfo, `performance-${name}`, {device, corpus: {...corpus, longTaskBlockingMs: metrics.corpusLongTaskBlockingMs}, metrics, thresholds: limits, checks, samples: {navigations, interactions}});
    await context.close();

    expect([...offOrigin], 'requests left the release origin').toEqual([]);
    expect(corpus.questions).toBe(BUILD.playableContent.questions);
    expect(corpus.papers).toBe(BUILD.playableContent.papers);
    for (const [metric, check] of Object.entries(checks)) expect.soft(check.value, `${name} ${metric} (limit ${check.limit} ms)`).toBeLessThanOrEqual(check.limit);
  });
}
