import test from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, startServer, launchChrome } from './browser/harness.mjs';

// Drives the real PYQ workspace in headless Chrome: two-paper exam start,
// reload at every transition, the break, Paper 2, reports and cancellation.
const chrome = findChrome();
const skip = chrome ? false : process.env.CI ? false : 'Chrome is not installed; set CHROME_PATH to run browser UI tests';
if (!chrome && process.env.CI) throw new Error('Browser UI tests require Chrome in CI (set CHROME_PATH).');
let server, browser, page, loads = 0;
const KEY = 'vedaris.pyq-workspace.v1';

test.before(async () => {
  if (skip) return;
  server = await startServer();
  browser = await launchChrome(chrome);
  page = await browser.newPage();
});
test.after(async () => { await browser?.close(); await server?.close(); });

const action = (name, value) => `[data-pyq-action="${name}"]${value ? `[data-value="${value}"]` : ''}`;
const saved = () => page.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(KEY)})||'null')`);
const text = () => page.text();
async function open({ clear = false } = {}) {
  if (clear) { await page.goto(`${server.origin}/?load=${++loads}#overview`); await page.evaluate('localStorage.clear()'); }
  await page.goto(`${server.origin}/?load=${++loads}#pyq`);
  await page.waitFor('!!document.querySelector(".pyq-hub-grid")', { message: 'PYQ hub', timeout: 30000 });
}
async function answerCurrent() {
  await page.evaluate(`(()=>{const choice=document.querySelector('[data-pyq-choice]:not([disabled])');if(choice){choice.click();return;}const n=document.querySelector('[data-pyq-numeric]');n.value='1';n.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
async function submitPaper() {
  await page.click(action('submit'));
  await page.click(action('finish'));
}

test('a two-paper exam survives reload at every transition and reports each paper and the total', { skip }, async () => {
  await open({ clear: true });
  await page.click(action('prepare-exam', 'jee-advanced-2023-two-paper-v1'));
  const intro = await text();
  assert.match(intro, /150 min/); assert.match(intro, /Paper 1 09:00–12:00, Paper 2 14:30–17:30/); assert.match(intro, /JIC report|Joint Implementation Committee Report/);
  await page.click(action('start-exam'));
  await page.waitFor('/PAPER 1 OF 2/.test(document.querySelector("#main").innerText)');
  await answerCurrent();
  const p1 = (await saved()).active;
  assert.equal(p1.deadline - p1.startedAt, 180 * 60000);

  await open();
  assert.match(await text(), /Continue Paper 1/);
  assert.equal((await saved()).active.deadline, p1.deadline, 'reload keeps the Paper 1 deadline');
  await page.click(action('resume-exam'));
  await page.waitFor('/PAPER 1 OF 2/.test(document.querySelector("#main").innerText)');
  await page.click(action('submit'));
  assert.match(await text(), /starts the inter-paper break/);
  await page.click(action('finish'));
  await page.waitFor('/Take your break/.test(document.querySelector("#main").innerText)', { message: 'break view' });
  let w = await saved();
  assert.equal(w.exam.phase, 'break'); assert.equal(w.active, null); assert.equal(w.exam.breakStartedAt, w.exam.papers[0].finishedAt);

  await open();
  assert.match(await text(), /You are on the inter-paper break/);
  assert.equal(await page.evaluate(`document.querySelectorAll('${action('history')}').length`), 0, 'Paper 1 stays sealed until Paper 2 ends');
  await page.click(action('resume-exam'));
  await page.waitFor('/Paper 2 · section marking/.test(document.querySelector("#main").innerText)');
  await page.click(action('start-paper2'));
  await page.waitFor('/PAPER 2 OF 2/.test(document.querySelector("#main").innerText)');
  w = await saved();
  assert.equal(w.exam.phase, 'paper2'); assert.equal(w.active.startedAt, w.exam.breakEndedAt); assert.equal(w.active.deadline - w.active.startedAt, 180 * 60000, 'the break never shortens Paper 2');

  await open();
  assert.match(await text(), /Continue Paper 2/);
  await page.click(action('resume-exam'));
  await answerCurrent();
  await submitPaper();
  await page.waitFor('/COMBINED MARKS/.test(document.querySelector("#main").innerText)', { message: 'exam report' });
  const report = await text();
  assert.match(report, /\/ 360/); assert.match(report, /Subjects by paper/); assert.match(report, /Paper 1: -?\d+(\.\d+)? \/ 180 · Paper 2: -?\d+(\.\d+)? \/ 180/);
  assert.match(report, /scheduled 150m 0s/);
  w = await saved();
  assert.equal(w.exam, null); assert.equal(w.exams[0].phase, 'complete');

  await open();
  assert.equal(await page.evaluate(`document.querySelectorAll('${action('exam-history')}').length`), 1);
  await page.click(action('exam-history'));
  await page.waitFor('/COMBINED MARKS/.test(document.querySelector("#main").innerText)');
  await page.click(action('exam-paper-report', w.exams[0].papers[0].id));
  await page.waitFor('/Question review & solutions/.test(document.querySelector("#main").innerText)');
  assert.match(await text(), /2023 · Paper 1/);
  assert.deepEqual(page.errors, []);
});

test('ending an exam early submits the paper on screen and reports only completed papers', { skip }, async () => {
  await open({ clear: true });
  await page.click(action('prepare-exam', 'jee-advanced-2026-two-paper-v1'));
  assert.match(await text(), /Paper 1 · 48 questions/); assert.match(await text(), /Paper 2 · 54 questions/);
  await page.click(action('start-exam'));
  await page.waitFor('/PAPER 1 OF 2/.test(document.querySelector("#main").innerText)');
  await answerCurrent();
  await page.click(action('ask-cancel-exam'));
  assert.match(await text(), /End this exam now\?/);
  await page.click(action('keep-exam'));
  assert.doesNotMatch(await text(), /End this exam now\?/);
  await page.click(action('ask-cancel-exam'));
  await page.click(action('cancel-exam'));
  await page.waitFor('/COMPLETED PAPERS ONLY/.test(document.querySelector("#main").innerText)');
  const report = await text();
  assert.match(report, /ended early/); assert.match(report, /Paper 2: not attempted/); assert.match(report, /The full exam carries 360 marks/);
  const w = await saved();
  assert.equal(w.exam, null); assert.equal(w.exams[0].phase, 'cancelled'); assert.equal(w.active, null);
  assert.equal(w.history[0].id, w.exams[0].papers[0].id, 'the submitted Paper 1 is kept as its own report');
});
