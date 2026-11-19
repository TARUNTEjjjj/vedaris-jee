import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome, startServer, launchChrome } from './browser/harness.mjs';
import { createSession, setResponse, finishSession, sessionItems } from '../src/practice/session.js';
import { emptyProgress, recordSession, exportProgress } from '../src/learning/progress.js';
import { emptyHistory, recordHistory } from '../src/learning/history.js';
import { emptyNotebook, updateNotebook } from '../src/learning/notebook.js';
import { createContentRegistry } from '../src/content/catalog.js';
import { createHistoricalSession, answerHistorical, finishHistorical, saveHistoricalSession, emptyHistoricalWorkspace } from '../src/content/session.js';

// These tests drive the real page in headless Chrome: export and restore go
// through the Saved & backups screen, file chooser and buttons. Only the
// initial workspace is seeded directly into localStorage.
const chrome = findChrome();
const skip = chrome ? false : process.env.CI ? false : 'Chrome is not installed; set CHROME_PATH to run browser UI tests';
if (!chrome && process.env.CI) throw new Error('Browser UI tests require Chrome in CI (set CHROME_PATH).');

let server, browser, page, files, loads = 0, registry, bankId;
const key = name => `vedaris.${name}.v1`;

test.before(async () => {
  if (skip) return;
  server = await startServer();
  const catalog = JSON.parse(server.content.get('data/content/catalog.json'));
  bankId = catalog.bankId;
  const bundles = catalog.bundles.map(b => JSON.parse(server.content.get(b.path)).bundle);
  registry = createContentRegistry({ archive: JSON.parse(await readFile(new URL('../data/archive.json', import.meta.url), 'utf8')), bundles, papers: catalog.papers, availableAssets: catalog.availableAssets });
  browser = await launchChrome(chrome);
  page = await browser.newPage();
  files = await mkdtemp(join(tmpdir(), 'vedaris-backup-files-'));
});
test.after(async () => {
  await browser?.close(); await server?.close();
  if (files) await rm(files, { recursive: true, force: true });
});

function seedWorkspace() {
  const now = Date.now();
  let s = createSession({ seed: 41, count: 3, minutes: 30, now: now - 600000 });
  const item = sessionItems(s)[0];
  s = setResponse(s, 0, item.type === 'multiple' ? [item.options[0].id] : item.type === 'single' ? item.options[0].id : '2', now - 590000);
  s = finishSession(s, now - 580000);
  const identity = s.questions[1];
  const ids = registry.filterQuestions().slice(0, 3).map(q => q.id);
  let done = createHistoricalSession(registry, { questionIds: ids.slice(0, 2), bankId, seed: 3, timed: false, now: now - 500000 });
  const first = registry.getQuestion(ids[0]);
  done = answerHistorical(done, 0, first.type === 'multiple' ? [first.options[0].id] : first.type === 'numerical' ? '1' : first.options[0].id, registry, now - 499000);
  done = finishHistorical(done, now - 498000);
  let pyq = saveHistoricalSession(emptyHistoricalWorkspace(bankId), done);
  pyq = saveHistoricalSession(pyq, createHistoricalSession(registry, { questionIds: [ids[2]], bankId, seed: 4, timed: true, minutes: 600, now: now - 1000 }));
  return {
    [key('progress')]: recordSession(emptyProgress(), s, now - 570000),
    [key('history')]: recordHistory(emptyHistory(), s, now - 570000),
    [key('session')]: createSession({ seed: 42, count: 3, minutes: 300, now: now - 1000 }),
    [key('bookmarks')]: [identity],
    [key('notebook')]: updateNotebook(emptyNotebook(), identity, { cause: 'calculation', note: 'Check signs' }),
    [key('goal')]: 20,
    [key('paper-notes')]: { [JSON.parse(server.content.get('data/content/catalog.json')).papers[0].paperId]: { text: 'Paper note' } },
    [key('pyq-workspace')]: pyq,
  };
}
async function open(seed = null) {
  await page.goto(`${server.origin}/?load=${++loads}#overview`);
  await page.evaluate(`localStorage.clear();${seed ? Object.entries(seed).map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(JSON.stringify(v))});`).join('') : ''}`);
  await page.goto(`${server.origin}/?load=${++loads}#progress`);
  await page.waitFor('!!document.querySelector("[data-backup-action=export]")', { message: 'backup panel' });
}
const storage = () => page.evaluate('JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(k=>[k,localStorage.getItem(k)])))').then(JSON.parse);
const workspaceOnly = all => Object.fromEntries(Object.entries(all).filter(([k]) => k !== key('pre-restore')));
// Compare saved values, not JSON key order.
const parsed = all => Object.fromEntries(Object.entries(all).map(([k, v]) => [k, JSON.parse(v)]));
async function exportBackup() {
  const path = await browser.download(() => page.click('[data-backup-action=export]'));
  return JSON.parse(await readFile(path, 'utf8'));
}
async function choose(name, value) {
  const path = join(files, name);
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
  await page.upload('[data-backup-file]', path);
}
const message = () => page.evaluate('document.querySelector(".backup-message")?.innerText||""');
// A successful restore re-renders the whole page (fresh summaries) with the result message.
async function applyAndWait(pattern) {
  await page.evaluate('document.querySelector("#workspace-backup").dataset.before="1"');
  await page.click('[data-backup-action=apply]');
  await page.waitFor(`!document.querySelector("#workspace-backup").dataset.before&&${pattern}.test(document.querySelector(".backup-message")?.innerText||"")`, { message: `restore result ${pattern}` });
}
async function previewed() { await page.waitFor('!!document.querySelector(".backup-preview")', { message: 'restore preview' }); return page.text(); }

test('complete export → replace restore round trip reproduces every store, with a recoverable pre-restore copy', { skip }, async () => {
  await open(seedWorkspace());
  const original = await storage();
  const backup = await exportBackup();
  assert.equal(backup.format, 'vedaris-workspace-backup'); assert.equal(backup.version, 1);
  assert.deepEqual(Object.keys(backup.stores), ['progress', 'history', 'session', 'bookmarks', 'notebook', 'goal', 'paperNotes', 'pyq', 'unresolved']);
  assert.equal(backup.stores.pyq.history.length, 1); assert.ok(backup.stores.pyq.active);
  // A different workspace on this browser is then replaced by the backup.
  await open({ [key('goal')]: 5, [key('bookmarks')]: [{ templateId: 'phy-atwood-v1', seed: 7 }] });
  const before = await storage();
  await choose('round-trip.json', backup);
  const preview = await previewed();
  assert.match(preview, /NOTHING HAS CHANGED YET/i);
  assert.deepEqual(await storage(), before, 'checking a backup must not write');
  await page.check('input[name="backup-mode"][value="replace"]');
  assert.equal(await page.evaluate('document.querySelector("[data-backup-action=apply]").disabled'), true, 'replace needs explicit confirmation');
  await page.check('[data-backup-confirm]');
  await applyAndWait(/Backup restored/);
  const restored = await storage();
  assert.deepEqual(parsed(workspaceOnly(restored)), parsed(original));
  const copy = JSON.parse(restored[key('pre-restore')]);
  assert.equal(copy.kind, 'pre-restore'); assert.equal(copy.stores.goal, 5);
  // The previous workspace can be recovered from the pre-restore copy through the same flow.
  await page.click('[data-backup-action=load-pre]');
  assert.match(await previewed(), /pre-restore copy/);
  await page.check('input[name="backup-mode"][value="replace"]');
  await page.check('[data-backup-confirm]');
  await applyAndWait(/Backup restored/);
  const back = await storage();
  assert.equal(back[key('goal')], '5');
  assert.deepEqual(JSON.parse(back[key('bookmarks')]), [{ templateId: 'phy-atwood-v1', seed: 7 }]);
  assert.deepEqual(JSON.parse(back[key('history')]).sessions, []);
  assert.equal(back[key('session')], undefined);
  // After reload the restored data is what the app reads.
  await page.goto(`${server.origin}/?load=${++loads}#progress`);
  await page.waitFor('!!document.querySelector("[data-backup-action=export]")');
  assert.match(await page.text(), /SAVED QUESTIONS\s*1/);
  assert.deepEqual(page.errors, []);
});

test('malformed, partial and unsupported-version backups are refused without changing the workspace', { skip }, async () => {
  await open(seedWorkspace());
  const backup = await exportBackup();
  const before = await storage();
  const partial = structuredClone(backup); delete partial.stores.pyq;
  const tampered = structuredClone(backup); tampered.stores.pyq.history[0].questionIds.push(tampered.stores.pyq.history[0].questionIds[0]);
  for (const [name, value, pattern] of [
    ['truncated.json', JSON.stringify(backup).slice(0, 500), /not complete JSON/],
    ['future.json', { ...backup, version: 99 }, /version 99/],
    ['partial.json', partial, /incomplete.*pyq/],
    ['tampered.json', tampered, /PYQ/],
    ['other.json', { name: 'not ours' }, /not a recognised/],
  ]) {
    await choose(name, value);
    await page.waitFor(`${pattern}.test(document.querySelector(".backup-message")?.innerText||"")`, { message: `${name} rejection` });
    assert.equal(await page.evaluate('!!document.querySelector(".backup-preview")'), false, name);
    assert.deepEqual(await storage(), before, `${name} must not change storage`);
  }
});

test('a storage failure during restore leaves every saved store exactly as it was', { skip }, async () => {
  await open(seedWorkspace());
  const backup = await exportBackup();
  await open({ [key('goal')]: 30, [key('bookmarks')]: [{ templateId: 'phy-atwood-v1', seed: 8 }] });
  const before = await storage();
  await choose('restore.json', backup);
  await previewed();
  await page.evaluate(`(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===${JSON.stringify(key('notebook'))})throw new DOMException('Quota exceeded','QuotaExceededError');return set.call(this,k,v)}})()`);
  await page.check('input[name="backup-mode"][value="replace"]');
  await page.check('[data-backup-confirm]');
  await page.click('[data-backup-action=apply]');
  await page.waitFor('/previous saved state/.test(document.querySelector(".backup-message")?.innerText||"")', { message: 'rollback message' });
  assert.deepEqual(workspaceOnly(await storage()), before);
  // If even the pre-restore copy cannot be stored, nothing is attempted.
  await open({ [key('goal')]: 30 });
  const again = await storage();
  await choose('restore.json', backup);
  await previewed();
  await page.evaluate(`(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===${JSON.stringify(key('pre-restore'))})throw new DOMException('Quota exceeded','QuotaExceededError');return set.call(this,k,v)}})()`);
  await page.click('[data-backup-action=apply]');
  await page.waitFor('/pre-restore copy, so nothing was restored/.test(document.querySelector(".backup-message")?.innerText||"")');
  assert.deepEqual(await storage(), again);
});

test('duplicates collapse, unresolved identities are disclosed and held, and merge keeps current records', { skip }, async () => {
  await open(seedWorkspace());
  const backup = await exportBackup();
  backup.stores.bookmarks.push({ ...backup.stores.bookmarks[0] }, { templateId: 'retired-family-v1', seed: 12 });
  backup.stores.notebook.entries[0].note = 'Backup note';
  backup.stores.goal = 5;
  await open({ [key('goal')]: 10, [key('notebook')]: { version: 1, entries: [{ ...backup.stores.notebook.entries[0], note: 'Current note' }] } });
  await choose('duplicates.json', backup);
  const preview = await previewed();
  assert.match(preview, /1 exact duplicate collapsed/);
  assert.match(preview, /retired-family-v1 · seed 12/);
  assert.match(preview, /no longer resolves? in this release/);
  await applyAndWait(/Backup merged/);
  const after = await storage();
  assert.equal(after[key('goal')], '10');
  assert.equal(JSON.parse(after[key('notebook')]).entries[0].note, 'Current note');
  assert.equal(JSON.parse(after[key('bookmarks')]).length, 1);
  assert.deepEqual(JSON.parse(after[key('unresolved')]).items.map(i => i.record), [{ templateId: 'retired-family-v1', seed: 12 }]);
  assert.ok(after[key('pre-restore')]);
  assert.match(await message(), /this browser’s notes are kept/);
  // Held records travel in the next export, unchanged.
  const next = await exportBackup();
  assert.deepEqual(next.stores.unresolved.items[0].record, { templateId: 'retired-family-v1', seed: 12 });
});

test('older supported backups (progress-only and PYQ-only exports) restore only their own store', { skip }, async () => {
  const seed = seedWorkspace();
  await open({ [key('goal')]: 30 });
  await choose('old-progress.json', exportProgress(seed[key('progress')]));
  assert.match(await previewed(), /Older concept-practice progress backup/);
  await page.check('input[name="backup-mode"][value="replace"]');
  await page.check('[data-backup-confirm]');
  await applyAndWait(/Backup restored/);
  let after = await storage();
  assert.deepEqual(JSON.parse(after[key('progress')]), seed[key('progress')]);
  assert.equal(after[key('goal')], '30');
  await choose('old-pyq.json', JSON.stringify(seed[key('pyq-workspace')], null, 2));
  assert.match(await previewed(), /Older PYQ backup/);
  await applyAndWait(/Backup merged/);
  after = await storage();
  assert.deepEqual(JSON.parse(after[key('pyq-workspace')]), seed[key('pyq-workspace')]);
  assert.deepEqual(JSON.parse(after[key('progress')]), seed[key('progress')]);
});
