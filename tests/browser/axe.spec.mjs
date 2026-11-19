// Automated WCAG 2.2 A/AA rule checks with axe-core. A violation fails the
// gate; automated rules are necessary but not sufficient (see the manual
// screen-reader protocol in docs/BROWSER-RELEASE-GATES.md).
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { test, expect, openPYQ, recordEvidence, settle, APP_ROUTES } from './fixtures.mjs';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// Violations that existed when this gate was introduced. They are recorded as
// failing in every evidence file and may only be removed; any new failing
// pattern (a new colour pair or element in a view) is a regression. Regenerate (only after fixing issues)
// with `node scripts/browser-gate-evidence.mjs --write-a11y-baseline`.
const BASELINE = JSON.parse(readFileSync(new URL('./a11y-baseline.json', import.meta.url), 'utf8'));

/** Stable identity for a failing node: colour pair for contrast, selector otherwise. */
export function violationKey(view, rule, node) {
  const detail = node.detail || {};
  return rule === 'color-contrast' ? `${view}|${rule}|${detail.fgColor} on ${detail.bgColor}` : `${view}|${rule}|${node.target}`;
}

async function audit(page, testInfo, name) {
  await settle(page);
  const result = await new AxeBuilder({page}).withTags(TAGS).analyze();
  const violations = result.violations.map(v => ({id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({target: n.target.join(' '), detail: n.any[0]?.data ?? null}))}));
  const counts = {};
  // Presence, not node count: the number of matching nodes varies with content, the failing pattern does not.
  for (const v of violations) for (const node of v.nodes) counts[violationKey(name, v.id, node)] = 1;
  const regressions = Object.entries(counts).filter(([key, count]) => count > (BASELINE.known[key] || 0)).map(([key, count]) => ({key, count, baseline: BASELINE.known[key] || 0}));
  const known = Object.entries(counts).filter(([key, count]) => BASELINE.known[key] && count <= BASELINE.known[key]).map(([key, count]) => ({key, count}));
  await recordEvidence(testInfo, `axe-${name}`, {view: name, axeVersion: result.testEngine.version, tags: TAGS, passes: result.passes.length, incomplete: result.incomplete.map(v => v.id), counts, regressions, known, violations});
  expect.soft(regressions, `${name}: new accessibility violations (regressions)`).toEqual([]);
}

// Known level-one headings; other routes are checked for any h1 in #main.
const HEADINGS = {
  overview: 'Show up. Solve. Improve.',
  tests: 'Your test centre',
  bank: 'Explore an idea, one variant at a time.',
  progress: 'See the work adding up.',
  sources: 'Good learning starts with clear sources.',
};
// #pyq is audited through its own journey below.
const ROUTES = APP_ROUTES.filter(route => route !== 'pyq').map(route => [route, HEADINGS[route] ?? null]);

for (const [route, heading] of ROUTES) {
  test(`axe: #${route}`, async ({page, origin}, testInfo) => {
    await page.goto(`${origin}/#${route}`);
    if (heading) await expect(page.getByRole('heading', {level: 1, name: heading})).toBeVisible();
    else await expect(page.locator('#main h1').first()).toBeVisible();
    await audit(page, testInfo, route);
  });
}

test('axe: PYQ hub, instructions, question with figure, submit confirmation and report', async ({page, origin}, testInfo) => {
  await openPYQ(page, origin);
  await page.locator('details.pyq-card summary').first().click(); // coverage table open
  await audit(page, testInfo, 'pyq-hub');
  await page.locator('.pyq-paper-entry').filter({hasText: '2023 · Paper 1'}).getByRole('button', {name: 'Read instructions →'}).click();
  await audit(page, testInfo, 'pyq-instructions');
  await page.getByRole('button', {name: 'Begin full paper →'}).click();
  await audit(page, testInfo, 'pyq-question-first');
  await page.getByRole('navigation', {name: 'Jump to subject'}).getByRole('button', {name: 'Physics'}).click();
  await expect(page.locator('.pyq-question .pyq-figure img').first()).toBeVisible();
  await audit(page, testInfo, 'pyq-question-figure');
  await page.getByRole('button', {name: 'Submit attempt →'}).click();
  await audit(page, testInfo, 'pyq-submit-confirm');
  await page.getByRole('button', {name: 'Submit & see report'}).click();
  await page.locator('.pyq-review summary').first().click();
  await audit(page, testInfo, 'pyq-report');
});

test('axe: original-practice question and submit dialog', async ({page, origin}, testInfo) => {
  // Fixed seeds make the generated question (and so the audited markup) repeatable.
  await page.addInitScript(() => { let seed = 7; crypto.getRandomValues = array => { for (let i = 0; i < array.length; i++) array[i] = (seed = (seed * 1103515245 + 12345) >>> 0); return array; }; });
  await page.goto(`${origin}/#tests`);
  await page.getByRole('button', {name: 'Start set →'}).first().click();
  await expect(page.locator('#finish-session')).toBeVisible();
  await audit(page, testInfo, 'practice-question');
  await page.locator('#finish-session').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await audit(page, testInfo, 'practice-submit-dialog');
});

test('axe: not-found page and open-source library', async ({page, origin}, testInfo) => {
  const response = await page.goto(`${origin}/missing-page`);
  expect(response.status()).toBe(404);
  await audit(page, testInfo, 'not-found');
  await page.goto(`${origin}/resources/`);
  await expect(page.locator('h1').first()).toBeVisible();
  await audit(page, testInfo, 'resources');
});
