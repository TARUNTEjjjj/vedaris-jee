import AxeBuilder from '@axe-core/playwright';
import { test, expect, expectVisibleFocus, settle } from './fixtures.mjs';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

async function sampleCanvasInk(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.pcm-canvas');
    if (!canvas || !canvas.width || !canvas.height) return { nonZero: 0, distinct: 0 };
    const probe = document.createElement('canvas');
    probe.width = 48;
    probe.height = 32;
    const ctx = probe.getContext('2d');
    ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    const seen = new Set();
    let nonZero = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 0 || data[i + 1] > 0 || data[i + 2] > 0) nonZero++;
      seen.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
    }
    return { nonZero, distinct: seen.size };
  });
}

test('3D PCM Field Lab renders WebGL2/3D geometry, switches modes and variants, orbits, zooms, and toggles motion', async ({ page, origin, pageErrors }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`${origin}/#overview`);

  const hero = page.locator('.pcm-hero');
  await expect(hero).toBeVisible();
  await expect(hero).toHaveAttribute('data-mode', 'physics');
  await expect(hero).toHaveAttribute('data-motion', 'running');
  await expect(hero).toHaveAttribute('data-renderer', /^(webgl2|canvas2d)$/);

  const canvasBox = await page.locator('.pcm-canvas').boundingBox();
  expect(canvasBox.width).toBeGreaterThan(240);
  expect(canvasBox.height).toBeGreaterThan(200);

  const physicsInk = await sampleCanvasInk(page);
  expect(physicsInk.nonZero).toBeGreaterThan(500);
  expect(physicsInk.distinct).toBeGreaterThan(4);

  // Physics variant switch
  await expect(page.locator('#pcm-lab-title')).toContainText('Kepler Orbit');
  await expect(page.locator('#pcm-lab-formula')).toContainText('r(θ)');
  await page.getByRole('button', { name: 'Comet e=0.72' }).click();
  await expect(page.locator('#pcm-lab-readout')).toContainText('e = 0.72');

  // Chemistry mode + FCC / BCC toggle
  await page.getByRole('button', { name: 'Chemistry' }).click();
  await expect(hero).toHaveAttribute('data-mode', 'chemistry');
  await expect(page.locator('#pcm-lab-title')).toContainText('d_z² Orbital & FCC Crystal Lattice');
  await expect(page.locator('#pcm-lab-readout')).toContainText('Z = 4 · CN = 12');
  const chemInk = await sampleCanvasInk(page);
  expect(chemInk.distinct).toBeGreaterThan(4);

  await page.getByRole('button', { name: 'p_z + BCC' }).click();
  await expect(page.locator('#pcm-lab-title')).toContainText('p_z Orbital & BCC Crystal Lattice');
  await expect(page.locator('#pcm-lab-readout')).toContainText('Z = 2 · CN = 8');

  // Mathematics mode + Wave / Saddle toggle
  await page.getByRole('button', { name: 'Mathematics' }).click();
  await expect(hero).toHaveAttribute('data-mode', 'mathematics');
  await expect(page.locator('#pcm-lab-title')).toContainText('Damped Radial Wave Manifold');
  await expect(page.locator('#pcm-lab-readout')).toContainText('‖n̂‖ = 1.000');
  const mathInk = await sampleCanvasInk(page);
  expect(mathInk.distinct).toBeGreaterThan(4);

  await page.getByRole('button', { name: 'Hyperbolic Saddle' }).click();
  await expect(page.locator('#pcm-lab-title')).toContainText('Hyperbolic Saddle Manifold');

  // Pause & Resume toggle
  const motionBtn = page.locator('[data-pcm-action="toggle-motion"]');
  await expect(motionBtn).toHaveAttribute('aria-pressed', 'false');
  await motionBtn.click();
  await expect(hero).toHaveAttribute('data-motion', 'paused');
  await expect(motionBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-pcm-motion-badge]')).toHaveText('Paused');

  // Pointer drag-to-orbit & zoom + keyboard Arrow orbit
  const stage = page.locator('.pcm-stage-frame');
  const stageBox = await stage.boundingBox();
  await page.mouse.move(stageBox.x + stageBox.width * 0.5, stageBox.y + stageBox.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width * 0.72, stageBox.y + stageBox.height * 0.35, { steps: 5 });
  await page.mouse.up();

  await page.getByRole('button', { name: 'Zoom in 3D view' }).click();
  await page.getByRole('button', { name: 'Zoom out 3D view' }).click();
  await page.getByRole('button', { name: 'Reset view' }).click();

  await page.getByRole('button', { name: 'Reset view' }).focus();
  await page.keyboard.press('Tab');
  await expect(stage).toBeFocused();
  await expectVisibleFocus(page);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowUp');

  await motionBtn.click();
  await expect(hero).toHaveAttribute('data-motion', 'running');
  await expect(motionBtn).toHaveAttribute('aria-pressed', 'false');

  // Route away and back cleanly disposes and re-mounts without errors
  await page.goto(`${origin}/#tests`);
  await expect(page.getByRole('heading', { level: 1, name: 'Your test centre' })).toBeVisible();
  await page.goto(`${origin}/#overview`);
  await expect(hero).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('3D PCM Field Lab passes WCAG AA 0 violations and reflows without overflow at Desktop, 390px, and 320px across all modes', async ({ page, origin, pageErrors }) => {
  const viewports = [
    { name: 'desktop', width: 1366, height: 900 },
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'mobile-320', width: 320, height: 640 },
  ];

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${origin}/#overview`);
    await expect(page.locator('.pcm-hero')).toBeVisible();

    for (const [label, mode] of [['Physics', 'physics'], ['Chemistry', 'chemistry'], ['Mathematics', 'mathematics']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator('.pcm-hero')).toHaveAttribute('data-mode', mode);
      await settle(page);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${vp.name} ${mode} horizontal overflow`).toBeLessThanOrEqual(0);

      const smallButtons = await page.evaluate(() => [...document.querySelectorAll('.pcm-hero button')]
        .map(btn => {
          const box = btn.getBoundingClientRect();
          return { text: btn.textContent.trim(), width: box.width, height: box.height };
        })
        .filter(item => item.width < 24 || item.height < 24));
      expect(smallButtons, `${vp.name} ${mode} WCAG 2.5.8 target size`).toEqual([]);

      const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      expect(axe.violations, `${vp.name} ${mode} WCAG AA violations`).toEqual([]);
    }
  }

  expect(pageErrors).toEqual([]);
});

test('3D PCM Field Lab auto-pauses under prefers-reduced-motion and supports Canvas2D fallback when WebGL2 is unavailable', async ({ page, origin, pageErrors }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${origin}/#overview`);

  const hero = page.locator('.pcm-hero');
  await expect(hero).toHaveAttribute('data-reduced-motion', 'true');
  await expect(hero).toHaveAttribute('data-motion', 'paused');
  await expect(page.locator('[data-pcm-motion-badge]')).toHaveText('Static (reduced motion)');
  await expect(page.locator('[data-pcm-action="toggle-motion"]')).toBeDisabled();
  await expect(page.locator('[data-pcm-action="toggle-motion"]')).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Chemistry', exact: true }).click();
  await expect(hero).toHaveAttribute('data-motion', 'paused');

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(hero).toHaveAttribute('data-reduced-motion', 'false');
  await expect(hero).toHaveAttribute('data-motion', 'running');

  // Verify Canvas2D software projection fallback when WebGL2 is unavailable
  const fallbackContext = await page.context().browser().newContext();
  const fallbackPage = await fallbackContext.newPage();
  const fallbackErrors = [];
  fallbackPage.on('pageerror', e => fallbackErrors.push(e.message));
  await fallbackPage.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl2') return null;
      return orig.call(this, type, ...args);
    };
  });
  await fallbackPage.goto(`${origin}/#overview`);
  await expect(fallbackPage.locator('.pcm-hero')).toHaveAttribute('data-renderer', 'canvas2d');
  await expect(fallbackPage.locator('[data-pcm-renderer-badge]')).toHaveText('Canvas 2D');
  const fallbackInk = await sampleCanvasInk(fallbackPage);
  expect(fallbackInk.nonZero).toBeGreaterThan(300);
  expect(fallbackInk.distinct).toBeGreaterThan(3);
  await fallbackPage.getByRole('button', { name: 'Mathematics', exact: true }).click();
  await expect(fallbackPage.locator('.pcm-hero')).toHaveAttribute('data-mode', 'mathematics');
  expect(fallbackErrors).toEqual([]);
  await fallbackContext.close();

  expect(pageErrors).toEqual([]);
});
