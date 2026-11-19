// Keyboard-only journeys: after the page has loaded, every step below is
// reached with Tab/Shift+Tab and activated with Enter, Space or Escape.
import { readFile } from 'node:fs/promises';
import { test, expect, openPYQ, paperEntry, tabTo, expectVisibleFocus } from './fixtures.mjs';

const focused = page => page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160));

test('skip link and main navigation work from the keyboard', async ({page, origin, pageErrors}) => {
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', {level: 1})).toBeVisible();
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', {name: 'Skip to content'});
  await expect(skip).toBeFocused();
  await expectVisibleFocus(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
  await tabTo(page, page.getByRole('navigation', {name: 'Main navigation'}).getByRole('link', {name: /PYQ practice/}), {reverse: true});
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {level: 1, name: 'The PYQ workspace.'})).toBeVisible({timeout: 45_000});
  expect(pageErrors).toEqual([]);
});

test('PYQ setup, answering, flagging, submit confirmation and review by keyboard', async ({page, origin, pageErrors}) => {
  await openPYQ(page, origin);
  // Setup: filters are native selects; typing selects an option without a pointer.
  await tabTo(page, page.getByRole('combobox', {name: 'Subject'}));
  await page.keyboard.type('Chem');
  await expect(page.getByRole('combobox', {name: 'Subject'})).toHaveValue('chemistry');
  await expect(page.getByRole('combobox', {name: 'Subject'})).toBeFocused();
  await expect(page.locator('.pyq-bank-list article').first()).toContainText('Chemistry');

  // A complete paper: instructions, then begin.
  await tabTo(page, paperEntry(page, 2023, 1).getByRole('button', {name: 'Read instructions →'}));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {level: 1, name: '2023 · JEE Advanced Paper 1'})).toBeVisible();
  await tabTo(page, page.getByRole('button', {name: 'Begin full paper →'}));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {level: 1, name: '2023 · Paper 1'})).toBeVisible();
  await expect(page.locator('.pyq-question-meta')).toContainText('1 / 51');

  // Answer the first question with whichever native control it uses.
  const choice = page.locator('[data-pyq-choice]').first();
  if (await choice.count()) {
    await tabTo(page, choice);
    await page.keyboard.press('Space');
    await expect(choice).toBeChecked();
  } else {
    await tabTo(page, page.getByLabel('Your numerical answer'));
    await page.keyboard.type('2');
  }
  await expect(page.locator('.pyq-palette button').first()).toHaveAttribute('aria-label', /, answered/);

  await tabTo(page, page.getByRole('button', {name: '☆ Flag for review'}));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', {name: '★ Unflag'})).toBeVisible();
  await expect(page.locator('.pyq-palette button').first()).toHaveAttribute('aria-label', /flagged for review/);

  await tabTo(page, page.getByRole('button', {name: 'Save & next →'}));
  await page.keyboard.press('Enter');
  await expect(page.locator('.pyq-question-meta')).toContainText('2 / 51');

  await tabTo(page, page.locator('.pyq-palette button').nth(4));
  await page.keyboard.press('Enter');
  await expect(page.locator('.pyq-question-meta')).toContainText('5 / 51');
  await expect(page.locator('.pyq-palette button').nth(4)).toHaveAttribute('aria-current', 'true');

  // Submission confirmation moves focus into the confirmation and can be dismissed.
  await tabTo(page, page.getByRole('button', {name: 'Submit attempt →'}));
  await page.keyboard.press('Enter');
  const confirmRegion = page.getByRole('region', {name: 'Confirm submission'});
  await expect(confirmRegion).toBeVisible();
  await expect(page.getByRole('button', {name: 'Submit & see report'}), await focused(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Keep working'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmRegion).toHaveCount(0);

  await tabTo(page, page.getByRole('button', {name: 'Submit attempt →'}), {reverse: true});
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', {name: 'Submit & see report'})).toBeFocused();
  await page.keyboard.press('Enter');

  // Finished report and review.
  await expect(page.getByText('YOUR COMPLETED PYQ ATTEMPT')).toBeVisible();
  await expect(page.getByRole('heading', {level: 1, name: '2023 · Paper 1'})).toBeVisible();
  const flagged = page.getByRole('group', {name: 'Filter review questions'}).getByRole('button', {name: /Flagged/});
  await tabTo(page, flagged);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('group', {name: 'Filter review questions'}).getByRole('button', {name: /Flagged/})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.pyq-review')).toHaveCount(1);
  await tabTo(page, page.locator('.pyq-review summary').first());
  await page.keyboard.press('Enter');
  await expect(page.locator('.pyq-review').first()).toHaveAttribute('open', '');
  await expect(page.locator('.pyq-review').first().getByRole('heading', {name: 'Worked solution'})).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('original-practice submit dialog traps focus, closes with Escape and restores focus', async ({page, origin, pageErrors}) => {
  await page.goto(`${origin}/#tests`);
  await expect(page.getByRole('heading', {level: 1, name: 'Your test centre'})).toBeVisible();
  await tabTo(page, page.getByRole('button', {name: 'Start set →'}).first());
  await page.keyboard.press('Enter');
  await expect(page.locator('#finish-session')).toBeVisible();
  await tabTo(page, page.locator('#finish-session'));
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', {name: 'Ready to review your work?'});
  await expect(dialog).toBeVisible();
  // Modal: focus starts inside, and Tab never reaches the inert page behind it
  // (native dialogs may pass focus to browser UI, reported as <body>).
  expect(await dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  const reached = new Set();
  for (let i = 0; i < 6; i++) {
    const where = await dialog.evaluate(node => node.contains(document.activeElement) ? document.activeElement.id || document.activeElement.tagName : document.activeElement === document.body || !document.activeElement ? 'browser' : 'OUTSIDE:' + document.activeElement.outerHTML.slice(0, 80));
    expect(where).not.toMatch(/^OUTSIDE/);
    reached.add(where);
    await page.keyboard.press('Tab');
  }
  expect([...reached]).toEqual(expect.arrayContaining(['continue-session', 'confirm-submit']));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#finish-session')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await tabTo(page, page.locator('#confirm-submit'));
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('#main')).toContainText(/analys|score|Session/i);
  expect(pageErrors).toEqual([]);
});

test('PYQ backup export and restore are keyboard operable', async ({page, origin, browser, server, pageErrors}, testInfo) => {
  await openPYQ(page, origin);
  // Create a saved report quickly with the pointer; the backup steps are keyboard-only.
  await page.getByRole('combobox', {name: 'Questions'}).selectOption('1');
  await page.getByRole('button', {name: 'Review set & start →'}).click();
  await page.getByRole('button', {name: 'Begin PYQ practice →'}).click();
  await page.getByRole('button', {name: 'Submit attempt →'}).click();
  await page.getByRole('button', {name: 'Submit & see report'}).click();
  await page.getByRole('button', {name: '← Bank & history'}).click();
  await expect(page.locator('.pyq-history [data-pyq-action="history"]')).toHaveCount(1);

  await tabTo(page, page.getByRole('button', {name: 'Export backup ↓'}));
  const downloadPromise = page.waitForEvent('download');
  await page.keyboard.press('Enter');
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('vedaris-pyq-backup.json');
  const backupPath = testInfo.outputPath('vedaris-pyq-backup.json');
  await download.saveAs(backupPath);
  expect(JSON.parse(await readFile(backupPath, 'utf8')).history).toHaveLength(1);

  // Restore into a separate, empty browser profile on the same origin.
  const other = await browser.newContext();
  const fresh = await other.newPage();
  await openPYQ(fresh, origin);
  await expect(fresh.locator('.pyq-history [data-pyq-action="history"]')).toHaveCount(0);
  const restore = fresh.getByLabel('Restore backup ↑');
  await tabTo(fresh, restore);
  const chooserPromise = fresh.waitForEvent('filechooser');
  await fresh.keyboard.press('Space');
  const chooser = await chooserPromise;
  await chooser.setFiles(backupPath);
  await expect(fresh.getByText('PYQ backup restored. Scores are recalculated from the reviewed answer keys.')).toBeVisible();
  await expect(fresh.locator('.pyq-history [data-pyq-action="history"]')).toHaveCount(1);

  // Replacing existing work asks first; dismissing keeps the current data.
  fresh.once('dialog', dialog => dialog.dismiss());
  await tabTo(fresh, fresh.getByLabel('Restore backup ↑'));
  const again = fresh.waitForEvent('filechooser');
  await fresh.keyboard.press('Space');
  await (await again).setFiles(backupPath);
  await expect(fresh.locator('.pyq-history [data-pyq-action="history"]')).toHaveCount(1);
  await other.close();
  expect(pageErrors).toEqual([]);
});

test('original-practice progress restore control is keyboard reachable', async ({page, origin}) => {
  await page.goto(`${origin}/#progress`);
  await expect(page.getByRole('button', {name: 'Export progress ↓'})).toBeVisible();
  const restore = page.getByLabel('Restore progress ↑');
  await tabTo(page, restore);
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Space');
  expect((await chooser).isMultiple()).toBe(false);
});
