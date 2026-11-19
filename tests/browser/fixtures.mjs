// Shared fixtures for the browser release gate. Each test gets its own static
// host for dist/ on a fresh port, so service workers and caches never leak
// between tests. Every other host name fails DNS resolution (see the launch
// options in playwright.config.mjs), so the app must not need third-party
// runtime services. Request interception is deliberately not used: Playwright
// bypasses service workers whenever routing is enabled.
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from './static-server.mjs';

export { expect };
export const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
export const HOST = 'vedaris.localhost';
/**
 * Every hash route the shell links to (main navigation plus Sources & methods),
 * read from the shell's index.html so a newly added view is audited without
 * anyone remembering to list it here.
 */
export const APP_ROUTES = (() => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const routes = [...html.matchAll(/data-route="([a-z-]+)"/g)].map(match => match[1]);
  if (/href="#sources"/.test(html)) routes.push('sources');
  return [...new Set(routes)];
})();
// The only off-origin request the app may make: the resource library's optional
// live-catalog refresh, which the CSP's connect-src also names. It fails DNS here.
export const OPTIONAL_HOSTS = ['raw.githubusercontent.com'];
const offOriginHost = url => {
  try { const {protocol, hostname} = new URL(url); return /^(https?|wss?):$/.test(protocol) && hostname !== HOST ? hostname : null; } catch { return null; }
};

export const test = base.extend({
  server: async ({}, use) => {
    const server = await startStaticServer({root: DIST});
    await use(server);
    await server.close();
  },
  origin: async ({server}, use) => { await use(`http://${HOST}:${server.port}`); },
  /**
   * Every request from the test's browser context, service worker included,
   * stays on the release origin. DNS failure alone would hide an attempted
   * third-party dependency (and does not cover IP-literal URLs), so attempts
   * are recorded and fail the test.
   */
  offOriginRequests: [async ({context}, use) => {
    const hosts = new Set();
    context.on('request', request => { const host = offOriginHost(request.url()); if (host && !OPTIONAL_HOSTS.includes(host)) hosts.add(host); });
    await use(hosts);
    expect([...hosts], 'requests left the release origin (the app must need no third-party runtime service)').toEqual([]);
  }, {auto: true}],
  /** Console errors and uncaught exceptions; online journeys assert this stays empty. */
  pageErrors: async ({page}, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      // The resource library's optional live-catalog refresh cannot resolve under
      // the gate; that expected failure is not an app error. Nothing else is exempt.
      const host = offOriginHost(message.location().url);
      if (host && OPTIONAL_HOSTS.includes(host) && /Failed to load resource/.test(message.text())) return;
      errors.push(`console: ${message.text()} @ ${message.location().url}`);
    });
    await use(errors);
  },
});

/** Open the PYQ workspace and wait until the full reviewed bank is mounted. */
export async function openPYQ(page, origin) {
  await page.goto(`${origin}/#pyq`);
  await expect(page.getByRole('heading', {level: 1, name: 'The PYQ workspace.'})).toBeVisible({timeout: 45_000});
}

export function paperEntry(page, year, paper) {
  return page.locator('.pyq-paper-entry').filter({has: page.getByRole('heading', {name: `${year} · Paper ${paper}`, exact: true})});
}

/** Begin a complete historical paper from the hub with pointer input. */
export async function startPaper(page, year, paper) {
  await paperEntry(page, year, paper).getByRole('button', {name: 'Read instructions →'}).click();
  await page.getByRole('button', {name: 'Begin full paper →'}).click();
  await expect(page.getByRole('heading', {level: 1, name: `${year} · Paper ${paper}`})).toBeVisible();
}

const pyqAction = (name, value) => `[data-pyq-action="${name}"]${value ? `[data-value="${value}"]` : ''}`;
async function answerFirst(page) {
  const choice = page.locator('[data-pyq-choice]:not([disabled])').first();
  if (await choice.count()) await choice.click(); else await page.getByLabel('Your numerical answer').fill('1');
}

/**
 * Drive a two-paper exam day (#18) from the hub through Paper 1, the break and
 * Paper 2 to the combined report, calling `at(name)` on each distinct screen.
 */
export async function walkExamDay(page, origin, at, {configId = 'jee-advanced-2023-two-paper-v1'} = {}) {
  await openPYQ(page, origin);
  await page.locator(pyqAction('prepare-exam', configId)).click();
  await expect(page.locator(pyqAction('start-exam'))).toBeVisible();
  await at('exam-instructions');
  await page.locator(pyqAction('start-exam')).click();
  await expect(page.locator('#main')).toContainText('PAPER 1 OF 2');
  await answerFirst(page);
  await at('exam-paper1');
  await page.locator(pyqAction('submit')).click();
  await page.locator(pyqAction('finish')).click();
  await expect(page.locator('#main')).toContainText('Take your break');
  await at('exam-break');
  await page.locator(pyqAction('ask-cancel-exam')).click();
  await expect(page.locator('#main')).toContainText('End this exam now?');
  await at('exam-break-confirm-end');
  await page.locator(pyqAction('keep-exam')).click();
  await page.locator(pyqAction('start-paper2')).click();
  await expect(page.locator('#main')).toContainText('PAPER 2 OF 2');
  await answerFirst(page);
  await page.locator(pyqAction('submit')).click();
  await page.locator(pyqAction('finish')).click();
  await expect(page.locator('#main')).toContainText('COMBINED MARKS');
  await at('exam-report');
  await page.locator(pyqAction('hub')).first().click();
  await expect(page.getByRole('heading', {level: 1, name: 'The PYQ workspace.'})).toBeVisible();
  await expect(page.locator(pyqAction('exam-history')).first()).toBeVisible();
  await at('pyq-hub-with-exam');
}

/** The palette button for a 1-based question position. */
export function paletteButton(page, position) {
  return page.locator('.pyq-palette button').nth(position - 1);
}

/**
 * Press Tab (or Shift+Tab) until `locator` holds focus. Fails when the target
 * is unreachable by keyboard, and checks that focus is visibly indicated.
 */
export async function tabTo(page, locator, {max = 200, reverse = false} = {}) {
  const target = locator.first();
  await expect(target).toBeAttached();
  for (let presses = 0; presses < max; presses++) {
    if (await target.evaluate(element => element === document.activeElement || element.contains(document.activeElement))) {
      await expectVisibleFocus(page);
      return presses;
    }
    await page.keyboard.press(reverse ? 'Shift+Tab' : 'Tab');
  }
  throw new Error(`Keyboard focus never reached ${target} after ${max} Tab presses`);
}

/** The focused control, or its label when the control itself is visually hidden, shows an outline. */
export async function expectVisibleFocus(page) {
  const indicator = await page.evaluate(() => {
    let element = document.activeElement;
    if (!element || element === document.body) return {ok: false, reason: 'focus on <body>'};
    const box = element.getBoundingClientRect();
    if (box.width <= 2 || box.height <= 2) element = element.closest('label') || element;
    const style = getComputedStyle(element);
    const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
    const ring = style.boxShadow && style.boxShadow !== 'none';
    return {ok: outline || ring, reason: `${element.tagName.toLowerCase()} outline=${style.outlineStyle} ${style.outlineWidth} shadow=${style.boxShadow}`};
  });
  expect(indicator.ok, `Focused element needs a visible focus indicator (${indicator.reason})`).toBe(true);
}

/** Wait until the page is controlled by the release service worker with its shell precached. */
export async function waitForServiceWorker(page) {
  // waitForFunction treats a returned Promise as truthy, so poll explicitly.
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null), {timeout: 30_000}).toBe('activated');
  // The first visit is not controlled (no clients.claim); a reload is.
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), {timeout: 15_000}).toBe(true);
}

/** Put the device offline: refuse connections at the host and in the browser. */
export async function goOffline(context, server) {
  server.setDown(true);
  await context.setOffline(true);
}
export async function goOnline(context, server) {
  server.setDown(false);
  await context.setOffline(false);
}

/**
 * Wait until fonts are loaded and the DOM has stopped changing (no mutation for
 * `quietMs`), so audits and measurements see the fully rendered view rather
 * than whatever an asynchronous render had produced so far.
 */
export async function settle(page, {quietMs = 250, timeoutMs = 5000} = {}) {
  await page.evaluate(async ({quietMs, timeoutMs}) => {
    await document.fonts?.ready;
    await new Promise(resolve => {
      let timer;
      const done = () => { observer.disconnect(); clearTimeout(timer); clearTimeout(cap); requestAnimationFrame(() => requestAnimationFrame(resolve)); };
      const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quietMs); });
      observer.observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
      timer = setTimeout(done, quietMs);
      const cap = setTimeout(done, timeoutMs);
    });
  }, {quietMs, timeoutMs});
}

/** Attach a JSON evidence record to the test; the evidence script collects these. */
export async function recordEvidence(testInfo, name, body) {
  await testInfo.attach(`evidence:${name}`, {body: JSON.stringify(body, null, 2), contentType: 'application/json'});
}
