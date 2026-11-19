// Narrow viewports, reduced motion, readable equations/diagrams, document
// structure and explicit missing-content states.
import { test, expect, openPYQ, startPaper, recordEvidence } from './fixtures.mjs';

const ROUTES = ['overview', 'chapters', 'pyq', 'tests', 'analysis', 'mistakes', 'bank', 'progress', 'archive', 'sources'];
const VIEWPORTS = [{width: 320, height: 640}, {width: 360, height: 740}, {width: 390, height: 844}];

/** Horizontal overflow of the document, plus the widest offending element. */
async function overflow(page) {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const over = document.documentElement.scrollWidth - width;
    let culprit = null;
    if (over > 0) {
      for (const element of document.querySelectorAll('body *')) {
        const box = element.getBoundingClientRect();
        if (box.right > width + 1 && getComputedStyle(element).position !== 'fixed') {
          // Content inside an intentional horizontal scroller is fine.
          let parent = element.parentElement, scrolls = false;
          while (parent && parent !== document.body) { if (/(auto|scroll)/.test(getComputedStyle(parent).overflowX)) { scrolls = true; break; } parent = parent.parentElement; }
          if (!scrolls) { culprit = element.outerHTML.slice(0, 120); break; }
        }
      }
      // Unbreakable text can overflow without any element box crossing the edge.
      if (!culprit) for (const element of document.querySelectorAll('body *')) {
        const style = getComputedStyle(element);
        if (style.overflowX === 'visible' && element.scrollWidth > element.clientWidth + 1 && element.clientWidth > 0 && element.getBoundingClientRect().right + element.scrollWidth - element.clientWidth > width) { culprit = `text overflow in ${element.outerHTML.slice(0, 120)}`; break; }
      }
    }
    return {over, culprit};
  });
}

async function waitForRoute(page, route) {
  if (route === 'pyq') await expect(page.getByRole('heading', {level: 1, name: 'The PYQ workspace.'})).toBeVisible({timeout: 45_000});
  else await expect(page.locator('#main h1').first()).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test(`no horizontal document overflow at ${viewport.width}px`, async ({page, origin}, testInfo) => {
    await page.setViewportSize(viewport);
    const results = {};
    for (const route of ROUTES) {
      await page.goto(`${origin}/#${route}`);
      await waitForRoute(page, route);
      results[route] = await overflow(page);
    }
    // The most demanding screens: a full paper's question with figures and display maths, and a report.
    await openPYQ(page, origin);
    await startPaper(page, 2023, 1);
    for (const position of [1, 18, 35]) {
      await page.locator('.pyq-palette button').nth(position - 1).click();
      await expect(page.locator('.pyq-question-meta')).toContainText(`${position} / 51`);
      results[`pyq-question-${position}`] = await overflow(page);
    }
    await page.getByRole('button', {name: 'Submit attempt →'}).click();
    await page.getByRole('button', {name: 'Submit & see report'}).click();
    await page.locator('.pyq-review summary').first().click();
    results['pyq-report'] = await overflow(page);
    await recordEvidence(testInfo, `overflow-${viewport.width}`, {viewport, results});
    for (const [view, result] of Object.entries(results)) expect.soft(result.over, `${view} at ${viewport.width}px overflows: ${result.culprit}`).toBeLessThanOrEqual(0);
  });
}

test('mobile question screen keeps controls at a usable size', async ({page, origin}) => {
  await page.setViewportSize({width: 360, height: 740});
  await openPYQ(page, origin);
  await startPaper(page, 2024, 1);
  const small = await page.evaluate(() => [...document.querySelectorAll('.pyq-page button:not([disabled]), .pyq-page input, .pyq-page select')]
    .filter(element => element.offsetParent && !element.closest('.pyq-option'))
    .map(element => ({html: element.outerHTML.slice(0, 80), ...element.getBoundingClientRect().toJSON()}))
    .filter(box => box.width < 24 || box.height < 24));
  // WCAG 2.2 SC 2.5.8 target size (minimum): 24 by 24 CSS pixels.
  expect(small).toEqual([]);
  const option = page.locator('.pyq-option').first();
  if (await option.count()) expect((await option.boundingBox()).height).toBeGreaterThanOrEqual(24);
});

const movingElements = page => page.evaluate(() => [...document.querySelectorAll('*')].map(element => {
  const style = getComputedStyle(element);
  const longest = value => Math.max(...value.split(',').map(part => parseFloat(part) * (part.trim().endsWith('ms') ? 1 : 1000)));
  return {tag: element.tagName, cls: element.className?.baseVal ?? element.className, transition: longest(style.transitionDuration), animation: style.animationName !== 'none' ? longest(style.animationDuration) : 0, scroll: style.scrollBehavior};
}).filter(item => item.transition > 0 || item.animation > 0 || item.scroll === 'smooth'));

test('reduced motion disables transitions and smooth scrolling', async ({page, origin}) => {
  // Control: without the preference the probe does see motion, so an empty result below is meaningful.
  await page.goto(`${origin}/#overview`);
  await waitForRoute(page, 'overview');
  await page.locator('.subject-card').first().hover();
  expect((await movingElements(page)).length).toBeGreaterThan(0);
  await page.emulateMedia({reducedMotion: 'reduce'});
  for (const route of ['overview', 'pyq', 'analysis', 'tests', 'chapters', 'mistakes']) {
    await page.goto(`${origin}/#${route}`);
    await waitForRoute(page, route);
    const card = page.locator('.subject-card').first();
    if (await card.count()) await card.hover();
    expect(await movingElements(page), `#${route} still animates under prefers-reduced-motion`).toEqual([]);
  }
});

test('equations render as native MathML and display maths never widens the page', async ({page, origin}, testInfo) => {
  await page.setViewportSize({width: 320, height: 640});
  await openPYQ(page, origin);
  await startPaper(page, 2025, 2);
  const report = [];
  for (let position = 1; position <= 48; position += 1) {
    const question = page.locator('.pyq-question');
    const facts = await question.evaluate(node => {
      const maths = [...node.querySelectorAll('math')];
      return {
        count: maths.length,
        unlabelled: maths.filter(math => !(math.querySelector('annotation') || math.getAttribute('aria-label') || math.textContent.trim())).length,
        empty: maths.filter(math => { const box = math.getBoundingClientRect(); return box.width === 0 || box.height === 0; }).length,
        tooSmall: maths.filter(math => parseFloat(getComputedStyle(math).fontSize) < 12).length,
        katexErrors: node.querySelectorAll('.katex-error, merror').length,
        rawTex: /\\(frac|sqrt|mathrm|left|right)\b|\$\$/.test(node.innerText),
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    report.push({position, ...facts});
    if (position < 48) {
      await page.getByRole('button', {name: 'Save & next →'}).click();
      await expect(page.locator('.pyq-question-meta')).toContainText(`${position + 1} / 48`);
    }
  }
  await recordEvidence(testInfo, 'mathml-2025-p2', {viewport: '320x640', questions: report});
  expect(report.reduce((sum, item) => sum + item.count, 0)).toBeGreaterThan(48);
  for (const item of report) {
    expect.soft(item.empty, `Q${item.position}: invisible <math>`).toBe(0);
    expect.soft(item.unlabelled, `Q${item.position}: <math> without text`).toBe(0);
    expect.soft(item.tooSmall, `Q${item.position}: maths below 12px`).toBe(0);
    expect.soft(item.katexErrors, `Q${item.position}: maths render errors`).toBe(0);
    expect.soft(item.rawTex, `Q${item.position}: unrendered TeX`).toBe(false);
    expect.soft(item.pageOverflow, `Q${item.position}: page overflow`).toBeLessThanOrEqual(0);
  }
});

test('diagrams load with meaningful alternative text in full papers', async ({page, origin}, testInfo) => {
  await openPYQ(page, origin);
  await startPaper(page, 2023, 1);
  await page.getByRole('navigation', {name: 'Jump to subject'}).getByRole('button', {name: 'Physics'}).click();
  const figure = page.locator('.pyq-question .pyq-figure img').first();
  await expect(figure).toBeVisible();
  await expect.poll(() => figure.evaluate(img => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const alts = await page.locator('.pyq-question .pyq-figure img').evaluateAll(images => images.map(img => img.alt));
  await recordEvidence(testInfo, 'figure-alt', {alts});
  for (const alt of alts) {
    expect(alt.trim().length).toBeGreaterThan(15);
    expect(alt).not.toMatch(/^(figure|image|diagram)\s*\d*$/i);
  }
  const box = await figure.boundingBox();
  expect(box.width).toBeGreaterThan(100);
});

test('every route has one level-one heading, one main landmark and labelled navigation', async ({page, origin}) => {
  for (const route of ROUTES) {
    await page.goto(`${origin}/#${route}`);
    await waitForRoute(page, route);
    expect(await page.locator('main h1').count(), `#${route} h1 count`).toBe(1);
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation', {name: 'Main navigation'})).toBeVisible();
    expect(await page.title()).toMatch(/· Vedaris$/);
  }
});

test('missing content states are explicit', async ({page, origin}) => {
  // Empty filter result.
  await openPYQ(page, origin);
  await page.getByRole('combobox', {name: 'Exam year'}).selectOption('2023');
  await page.getByRole('combobox', {name: 'Question type'}).selectOption('bonus');
  await page.getByRole('combobox', {name: 'Subject'}).selectOption('mathematics');
  await expect(page.getByRole('heading', {name: 'No questions in this selection.'})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Review set & start →'})).toBeDisabled();

  // Not-yet-playable years are labelled, never presented as playable.
  await expect(page.getByText(/The wider\s+paper archive\s+contains source links; those links are not counted as playable questions\./)).toBeVisible();

  // A figure that fails to load says so instead of showing a broken image.
  await page.route(/\/assets\/content\/.*\.(png|jpe?g|webp|svg)$/, route => route.abort('failed'));
  await page.getByRole('combobox', {name: 'Exam year'}).selectOption('');
  await page.getByRole('combobox', {name: 'Question type'}).selectOption('all');
  await page.getByRole('combobox', {name: 'Subject'}).selectOption('all');
  await startPaper(page, 2023, 1);
  await page.getByRole('navigation', {name: 'Jump to subject'}).getByRole('button', {name: 'Physics'}).click();
  const note = page.locator('.pyq-question .pyq-figure.is-unavailable [role="note"]').first();
  await expect(note).toHaveText(/This figure could not be loaded\./);
  await expect(page.locator('.pyq-question .pyq-figure.is-unavailable .pyq-figure-caption').first()).toBeVisible();

  // Unknown routes and records.
  await page.goto(`${origin}/#paper/not-a-real-paper`);
  await expect(page.getByRole('heading', {name: 'Paper not found.'})).toBeVisible();
});
