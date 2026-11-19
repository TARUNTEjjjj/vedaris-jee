// Offline (cached and uncached content), storage failure, reader tabs and an
// upgrade while a test is active. These run against the real service worker.
import { cp, mkdtemp, readFile, rm, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from '../../scripts/build.mjs';
import { test, expect, DIST, openPYQ, startPaper, waitForServiceWorker, goOffline, goOnline, recordEvidence } from './fixtures.mjs';

const physics = page => page.getByRole('navigation', {name: 'Jump to subject'}).getByRole('button', {name: 'Physics'});
const meta = page => page.locator('.pyq-question-meta');
const releaseOf = page => page.evaluate(() => document.querySelector('script[type="module"][src*="releases/"]')?.getAttribute('src').match(/releases\/([a-f0-9]+)\//)?.[1]);

async function answerCurrent(page, value = '2') {
  const choice = page.locator('[data-pyq-choice]').first();
  if (await choice.count()) { await choice.click(); return choice; }
  await page.getByLabel('Your numerical answer').fill(value);
  return page.getByLabel('Your numerical answer');
}

test('a used paper and its figures work offline after reload', async ({page, context, origin, server}, testInfo) => {
  await page.goto(`${origin}/`);
  await waitForServiceWorker(page);
  await openPYQ(page, origin);
  await startPaper(page, 2023, 1);
  await answerCurrent(page);
  await physics(page).click();
  await expect(meta(page)).toContainText('18 / 51');
  const figure = page.locator('.pyq-question .pyq-figure img').first();
  await expect.poll(() => figure.evaluate(img => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const src = await figure.getAttribute('src');
  await expect.poll(() => page.evaluate(async url => !!(await caches.match(url)), src)).toBe(true);

  await goOffline(context, server);
  await page.reload();
  await openPYQ(page, origin);
  await expect(page.getByText('SAVED IN PROGRESS')).toBeVisible();
  await page.getByRole('button', {name: 'Resume session →'}).click();
  await expect(meta(page)).toContainText('18 / 51');
  const offlineFigure = page.locator('.pyq-question .pyq-figure img').first();
  await expect.poll(() => offlineFigure.evaluate(img => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  await expect(page.locator('.pyq-palette button').first()).toHaveAttribute('aria-label', /, answered/);

  // A figure that was never displayed online is explicitly unavailable, not broken.
  await page.locator('.pyq-palette button').nth(18).click();
  await expect(meta(page)).toContainText('19 / 51');
  await expect(page.locator('.pyq-question .pyq-figure.is-unavailable [role="status"]').first()).toBeVisible();

  // Answers keep saving offline.
  await page.locator('.pyq-palette button').nth(1).click();
  await answerCurrent(page, '3');
  await expect(page.locator('.pyq-palette button').nth(1)).toHaveAttribute('aria-label', /, answered/);
  await recordEvidence(testInfo, 'offline-cached', {figure: src, offlineReload: 'pass'});
  await goOnline(context, server);
});

test('an uncached paper offline shows an explicit, recoverable state', async ({page, context, origin, server}) => {
  await page.goto(`${origin}/`);
  await waitForServiceWorker(page);
  // The shell is installed, but no paper bundle has ever been fetched.
  const cachedPapers = await page.evaluate(async () => {
    const keys = await caches.keys();
    let count = 0;
    for (const key of keys) for (const request of await (await caches.open(key)).keys()) if (/data\/content\/\d{4}-p\d\.json$/.test(request.url)) count++;
    return count;
  });
  expect(cachedPapers).toBe(0);
  await goOffline(context, server);
  await page.reload();
  await expect(page.getByRole('heading', {level: 1, name: 'Show up. Solve. Improve.'})).toBeVisible();
  await page.goto(`${origin}/#pyq`);
  await expect(page.getByRole('heading', {level: 1, name: 'The question bank could not load.'})).toBeVisible({timeout: 45_000});
  await expect(page.getByText('A reviewed paper could not be downloaded. Papers you have not opened before are not saved for offline use yet. Reconnect and try again.')).toBeVisible();
  await expect(page.getByRole('link', {name: 'Browse paper sources ↗'})).toBeVisible();
  // Reconnecting and choosing Try again recovers without a reload.
  await goOnline(context, server);
  await page.getByRole('button', {name: 'Try again →'}).click();
  await expect(page.getByRole('heading', {level: 1, name: 'The PYQ workspace.'})).toBeVisible({timeout: 45_000});

  // Original practice works offline with only the shell installed.
  await goOffline(context, server);
  await page.goto(`${origin}/#tests`);
  await page.getByRole('button', {name: 'Start set →'}).first().click();
  await expect(page.locator('#finish-session')).toBeVisible();
  await goOnline(context, server);
});

test('an uncached shell offline gets the worker\'s explicit offline message, not a browser error', async ({page, context, origin, server}) => {
  await page.goto(`${origin}/`);
  await waitForServiceWorker(page);
  // Remove the installed shell to simulate eviction; the worker must answer honestly.
  await page.evaluate(async () => { for (const key of await caches.keys()) await caches.delete(key); });
  await goOffline(context, server);
  const response = await page.reload();
  expect(response.status()).toBe(503);
  await expect(page.locator('body')).toContainText('Vedaris is unavailable offline on this device. Reconnect and reload.');
  await goOnline(context, server);
});

test('a storage write failure keeps the saved attempt and says so', async ({page, origin}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (globalThis.__failWrites && String(key).startsWith('vedaris.')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await openPYQ(page, origin);
  await startPaper(page, 2024, 2);
  await page.evaluate(() => { globalThis.__failWrites = true; });
  const control = await answerCurrent(page);
  await expect(page.getByText('Your latest change could not be saved. It has not replaced your saved session. Try again after restoring browser storage.')).toBeVisible();
  await expect(page.locator('.pyq-palette button').first()).not.toHaveAttribute('aria-label', /, answered/);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vedaris.pyq-workspace.v1')).active.responses[0]);
  expect(saved == null || saved === '' || (Array.isArray(saved) && !saved.length)).toBe(true);

  await page.evaluate(() => { globalThis.__failWrites = false; });
  await answerCurrent(page);
  await expect(page.getByText('Saving is working again. Your latest change is saved.')).toBeVisible();
  await expect(page.locator('.pyq-palette button').first()).toHaveAttribute('aria-label', /, answered/);
  await page.reload();
  await openPYQ(page, origin);
  await page.getByRole('button', {name: 'Resume session →'}).click();
  await expect(page.locator('.pyq-palette button').first()).toHaveAttribute('aria-label', /, answered/);
  expect(control).toBeTruthy();
});

test('unavailable browser storage falls back to memory-only practice with an export reminder', async ({page, origin}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {configurable: true, get() { throw new DOMException('Storage disabled', 'SecurityError'); }});
  });
  await openPYQ(page, origin);
  await expect(page.getByText('This browser cannot access saved PYQ work. Practice is available in this tab; export a PYQ backup before closing it.')).toBeVisible();
  await expect(page.getByText(/Memory-only practice: this browser cannot save your work\./)).toBeVisible();
  await startPaper(page, 2025, 1);
  await answerCurrent(page);
  await expect(page.locator('.pyq-palette button').first()).toHaveAttribute('aria-label', /, answered/);
});

test('without Web Locks the workspace runs in memory mode and says so', async ({page, origin}) => {
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'locks', {configurable: true, get: () => undefined}); });
  await page.goto(`${origin}/`);
  await expect(page.locator('#storage-mode')).toContainText(/cannot/i);
  await openPYQ(page, origin);
  await expect(page.getByText(/Memory-only practice/)).toBeVisible();
});

test('a second tab is a read-only reader that follows the writer and takes over after it closes', async ({context, origin}) => {
  const writer = await context.newPage();
  await openPYQ(writer, origin);
  await startPaper(writer, 2022, 1);
  const reader = await context.newPage();
  await openPYQ(reader, origin);
  await expect(reader.getByText(/Read-only tab: browse questions and saved reports here\./)).toBeVisible();
  await reader.getByRole('button', {name: 'Resume session →'}).click();
  await expect(reader.getByRole('button', {name: 'Submit attempt →'})).toBeDisabled();
  await expect(reader.getByRole('button', {name: '☆ Flag for review'})).toBeDisabled();
  const readerControls = reader.locator('.pyq-question input');
  for (const control of await readerControls.all()) await expect(control).toBeDisabled();

  await answerCurrent(writer);
  await writer.getByRole('button', {name: '☆ Flag for review'}).click();
  await expect(reader.locator('.pyq-palette button').first()).toHaveAttribute('aria-label', /, answered, flagged for review/);

  await writer.close();
  await reader.reload();
  await openPYQ(reader, origin);
  await expect(reader.getByText(/Read-only tab/)).toHaveCount(0);
  await reader.getByRole('button', {name: 'Resume session →'}).click();
  await expect(reader.getByRole('button', {name: 'Submit attempt →'})).toBeEnabled();
  await expect(reader.locator('.pyq-palette button').first()).toHaveAttribute('aria-label', /, answered, flagged for review/);
});

test('a deployment during an active paper waits, keeps saving and resumes intact on the new release', async ({context, origin, server}, testInfo) => {
  // Build a second release from the same inputs plus a harmless stylesheet change,
  // then add the current release as `npm run deploy` retention would.
  const work = await mkdtemp(join(tmpdir(), 'vedaris-upgrade-'));
  try {
    const repo = fileURLToPath(new URL('../../', import.meta.url));
    for (const entry of ['assets', 'src', 'data', 'content', 'resources', 'index.html', 'manifest.webmanifest', '_headers', '404.html']) await cp(join(repo, entry), join(work, entry), {recursive: true});
    await appendFile(join(work, 'assets/style.css'), '\n/* release-gate upgrade fixture */\n');
    const next = await buildSite(work);
    const current = JSON.parse(await readFile(join(DIST, 'build-info.json'), 'utf8'));
    expect(next.version).not.toBe(current.version);
    await cp(join(DIST, current.release), join(work, 'dist', current.release), {recursive: true});

    const page = await context.newPage();
    await page.goto(`${origin}/`);
    await waitForServiceWorker(page);
    expect(await releaseOf(page)).toBe(current.version);
    await page.evaluate(() => { window.__sameDocument = true; });
    await openPYQ(page, origin);
    await startPaper(page, 2023, 2);
    await answerCurrent(page);
    await page.getByRole('button', {name: '☆ Flag for review'}).click();

    // Deploy, and let the browser discover the new worker.
    await server.setRoot(join(work, 'dist'));
    const states = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
      const deadline = Date.now() + 20000;
      while (registration.installing && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
      return {waiting: registration.waiting?.state ?? null, activeIsController: registration.active === navigator.serviceWorker.controller || registration.active?.scriptURL === navigator.serviceWorker.controller?.scriptURL};
    });
    expect(states.waiting).toBe('installed');
    // The active attempt is not reloaded or taken over.
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => window.__sameDocument)).toBe(true);
    expect(await releaseOf(page)).toBe(current.version);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting?.state)).toBe('installed');
    // Keeps saving, and an old-release figure still loads (retained immutable release).
    await page.locator('.pyq-palette button').nth(1).click();
    await answerCurrent(page, '4');
    await expect(page.locator('.pyq-palette button').nth(1)).toHaveAttribute('aria-label', /, answered/);
    await physics(page).click();
    const figure = page.locator('.pyq-question .pyq-figure img').first();
    if (await figure.count()) await expect.poll(() => figure.evaluate(img => img.complete && img.naturalWidth)).toBeGreaterThan(0);

    // Closing the last tab lets the new release activate; the attempt resumes intact.
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto(`${origin}/`);
    await expect.poll(async () => { await reopened.reload(); return releaseOf(reopened); }, {timeout: 30_000}).toBe(next.version);
    await openPYQ(reopened, origin);
    await reopened.getByRole('button', {name: 'Resume session →'}).click();
    await expect(reopened.locator('.pyq-palette button').first()).toHaveAttribute('aria-label', /, answered, flagged for review/);
    await expect(reopened.locator('.pyq-palette button').nth(1)).toHaveAttribute('aria-label', /, answered/);
    await recordEvidence(testInfo, 'upgrade-while-active', {from: current.version, to: next.version, waitingWhileActive: true, resumedIntact: true});
  } finally {
    await server.setRoot(DIST);
    await rm(work, {recursive: true, force: true});
  }
});
