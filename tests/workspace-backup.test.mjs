import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, setResponse, finishSession, sessionItems } from '../src/practice/session.js';
import { emptyProgress, recordSession } from '../src/learning/progress.js';
import { emptyHistory, recordHistory } from '../src/learning/history.js';
import { emptyNotebook, updateNotebook } from '../src/learning/notebook.js';
import { createHistoricalSession, answerHistorical, finishHistorical, saveHistoricalSession, emptyHistoricalWorkspace } from '../src/content/session.js';
import { BACKUP_STORES, createWorkspaceBackup, parseBackup, analyzeBackup, mergeWorkspace, replaceWorkspace, writeWorkspaceStores, emptyWorkspaceStores, storageKey } from '../src/learning/backup.js';

// Synthetic PYQ fixtures exercise validation only; they are not exam content.
const START = Date.now() - 3_600_000, BANK = 'synthetic-bank-v1';
const options = ['A', 'B', 'C', 'D'].map(id => ({ id, text: id }));
const pyqQuestions = ['q1', 'q2', 'q3'].map(id => ({ id, subject: 'physics', type: 'single', options, answer: 'B', marking: { correct: 3, incorrect: -1, unanswered: 0 } }));
const registry = (ids = ['q1', 'q2', 'q3']) => ({
  getQuestion(id) { const q = pyqQuestions.find(q => q.id === id && ids.includes(id)); if (!q) throw new Error('Unknown reviewed content'); return q; },
  getFullPaper() { throw new Error('No full paper'); },
});

function workspace() {
  let s = createSession({ seed: 11, count: 3, minutes: 30, now: START });
  const item = sessionItems(s)[0];
  s = setResponse(s, 0, item.type === 'multiple' ? [item.options[0].id] : item.type === 'single' ? item.options[0].id : '1', START + 1000);
  s = finishSession(s, START + 2000);
  const progress = recordSession(emptyProgress(), s, START + 3000);
  const history = recordHistory(emptyHistory(), s, START + 3000);
  const identity = s.questions[0];
  const notebook = updateNotebook(emptyNotebook(), identity, { cause: 'concept', note: 'Revise <this> & "that"' });
  const active = createSession({ seed: 12, count: 3, minutes: 300, now: START + 4000 });
  let p = createHistoricalSession(registry(), { questionIds: ['q1', 'q2'], bankId: BANK, seed: 5, timed: false, now: START });
  p = finishHistorical(answerHistorical(p, 0, 'B', registry(), START + 10), START + 20);
  let pyq = saveHistoricalSession(emptyHistoricalWorkspace(BANK), p);
  pyq = saveHistoricalSession(pyq, createHistoricalSession(registry(), { questionIds: ['q3'], bankId: BANK, seed: 6, timed: true, minutes: 600, now: START + 30 }));
  return { ...emptyWorkspaceStores(), progress, history, session: active, bookmarks: [identity], notebook, goal: 20, paperNotes: { 'jee-2023-p1': { text: 'Q4 approach', deadline: null } }, pyq };
}
const analyze = (raw, ids) => analyzeBackup(parseBackup(typeof raw === 'string' ? raw : JSON.stringify(raw)), { registry: registry(ids), bankId: BANK, archivePaperIds: new Set(['jee-2023-p1']) });

test('inventory covers every persistent store and a full export round-trips exactly', () => {
  assert.deepEqual(BACKUP_STORES.map(s => s.slot), ['progress', 'history', 'session', 'bookmarks', 'notebook', 'goal', 'paper-notes', 'pyq-workspace', 'unresolved']);
  const stores = workspace();
  const file = createWorkspaceBackup({ stores, contentBankId: BANK });
  assert.equal(file.format, 'vedaris-workspace-backup'); assert.equal(file.version, 2);
  const plan = analyze(file);
  for (const name of ['progress', 'history', 'session', 'bookmarks', 'notebook', 'goal', 'paperNotes', 'pyq']) assert.deepEqual(plan.stores[name], JSON.parse(JSON.stringify(stores[name])), name);
  assert.equal(plan.report.unresolved.length, 0);
  assert.equal(plan.stores.pyq.active.questionIds[0], 'q3');
});

test('malformed, partial, unknown-version and foreign files are rejected with explanations', () => {
  const good = createWorkspaceBackup({ stores: workspace(), contentBankId: BANK });
  assert.throws(() => parseBackup(JSON.stringify(good).slice(0, -20)), /not complete JSON/);
  assert.throws(() => parseBackup(JSON.stringify({ ...good, version: 3 })), /version 3.*not changed/);
  assert.equal(parseBackup(JSON.stringify({ ...good, version: 1 })).version, 1, 'version 1 files remain readable');
  const partial = structuredClone(good); delete partial.stores.notebook;
  assert.throws(() => parseBackup(JSON.stringify(partial)), /incomplete.*notebook/);
  assert.throws(() => parseBackup(JSON.stringify({ ...good, stores: { ...good.stores, extra: [] } })), /unknown stores/);
  assert.throws(() => parseBackup('{"hello":1}'), /not a recognised/);
  assert.throws(() => parseBackup('[]'), /not a Vedaris backup/);
  const tampered = structuredClone(good); tampered.stores.history.sessions[0].responses[0] = 5;
  assert.throws(() => analyze(tampered), /reports failed validation/);
  const badGoal = structuredClone(good); badGoal.stores.goal = 7;
  assert.throws(() => analyze(badGoal), /daily goal/);
  const badPyq = structuredClone(good); badPyq.stores.pyq.history[0].finishedAt = badPyq.stores.pyq.history[0].startedAt - 1;
  assert.throws(() => analyze(badPyq), /PYQ attempt failed validation/);
});

test('exact duplicates collapse and are reported; conflicting duplicates are refused', () => {
  const file = createWorkspaceBackup({ stores: workspace() });
  file.stores.bookmarks.push({ ...file.stores.bookmarks[0] });
  file.stores.history.sessions.push(structuredClone(file.stores.history.sessions[0]));
  const plan = analyze(file);
  assert.equal(plan.stores.bookmarks.length, 1);
  assert.deepEqual(plan.report.duplicates, { 'Original-practice reports': 1, 'Saved questions': 1 });
  const conflict = createWorkspaceBackup({ stores: workspace() });
  conflict.stores.notebook.entries.push({ ...conflict.stores.notebook.entries[0], note: 'different' });
  assert.throws(() => analyze(conflict), /two different records/);
});

test('unresolved identities are held verbatim, disclosed and resolve again later', () => {
  const file = createWorkspaceBackup({ stores: workspace() });
  file.stores.bookmarks.push({ templateId: 'retired-family-v1', seed: 9 });
  const plan = analyze(file, ['q1', 'q2']);
  assert.deepEqual(plan.report.unresolved.map(i => [i.store, i.record.templateId ?? i.record.id]), [['bookmarks', 'retired-family-v1'], ['pyq-session', plan.report.unresolved[1].record.id]]);
  assert.equal(plan.stores.pyq.active, null, 'the attempt whose question is missing is held, not discarded');
  assert.equal(plan.stores.pyq.history.length, 1);
  // A later export carries the held records; with the question available again, it rejoins.
  const later = createWorkspaceBackup({ stores: plan.stores });
  const again = analyze(later, ['q1', 'q2', 'q3']);
  assert.equal(again.stores.pyq.active.questionIds[0], 'q3');
  assert.deepEqual(again.report.unresolved.map(i => i.store), ['bookmarks']);
  const foreignBank = createWorkspaceBackup({ stores: { ...workspace(), pyq: { ...workspace().pyq, bankId: 'older-bank' } } });
  const held = analyze(foreignBank);
  assert.deepEqual([held.stores.pyq.active, held.stores.pyq.history], [null, []]);
  assert.equal(held.report.unresolved[0].store, 'pyq-workspace');
  const notes = createWorkspaceBackup({ stores: { ...workspace(), paperNotes: { moved: { text: 'kept' } } } });
  const n = analyze(notes);
  assert.deepEqual(n.report.unlinkedPaperNotes, ['moved']); assert.equal(n.stores.paperNotes.moved.text, 'kept');
});

test('PYQ data is never accepted unchecked when the reviewed bank is unavailable', () => {
  const file = createWorkspaceBackup({ stores: workspace() });
  assert.throws(() => analyzeBackup(parseBackup(JSON.stringify(file)), {}), error => error.code === 'content-unavailable');
  const noPyq = createWorkspaceBackup({ stores: { ...workspace(), pyq: null } });
  assert.equal(analyzeBackup(parseBackup(JSON.stringify(noPyq)), {}).stores.pyq, null);
});

test('older single-store backups restore only their own store', () => {
  const stores = workspace();
  const legacyProgress = parseBackup(JSON.stringify({ app: 'vedaris', ...stores.progress, exportedAt: new Date().toISOString() }));
  assert.equal(legacyProgress.source, 'legacy-progress'); assert.deepEqual(legacyProgress.included, ['progress']);
  const plan = analyzeBackup(legacyProgress, {});
  assert.deepEqual(Object.keys(plan.stores), ['progress']);
  const replaced = replaceWorkspace(emptyWorkspaceStores(), plan.stores).stores;
  assert.deepEqual(replaced.notebook, emptyWorkspaceStores().notebook);
  const legacyPyq = analyze(JSON.stringify(stores.pyq));
  assert.equal(legacyPyq.source, 'legacy-pyq'); assert.deepEqual(Object.keys(legacyPyq.stores), ['pyq']);
});

test('merge keeps existing records and active work; replace matches the backup', () => {
  const mine = workspace();
  const other = createWorkspaceBackup({ stores: { ...emptyWorkspaceStores(), notebook: updateNotebook(emptyNotebook(), mine.bookmarks[0], { note: 'from backup' }), bookmarks: [{ templateId: 'phy-atwood-v1', seed: 3 }], goal: 5, session: createSession({ seed: 99, count: 1, now: START }) } });
  const plan = analyze(other);
  const merged = mergeWorkspace(mine, plan.stores, { registry: registry(), bankId: BANK });
  assert.equal(merged.stores.notebook.entries[0].note, mine.notebook.entries[0].note);
  assert.equal(merged.stores.bookmarks.length, 2);
  assert.equal(merged.stores.goal, 20);
  assert.equal(merged.stores.session.id, mine.session.id);
  assert.ok(merged.notes.some(n => /notes are kept/.test(n)) && merged.notes.some(n => /active original-practice session/.test(n)));
  assert.deepEqual(merged.stores.history, mine.history);
  const replaced = replaceWorkspace(mine, plan.stores).stores;
  assert.equal(replaced.goal, 5); assert.equal(replaced.history.sessions.length, 0); assert.equal(replaced.pyq, null);
});

function memoryStorage({ failOn = () => false } = {}) {
  const data = new Map();
  return { data, getItem: k => data.has(k) ? data.get(k) : null, setItem(k, v) { if (failOn(k, v)) throw new Error('QuotaExceededError'); data.set(k, String(v)); }, removeItem: k => data.delete(k) };
}

test('storage failure rolls every store back to its previous bytes; no pre-restore copy means no change', () => {
  const stores = workspace();
  const storage = memoryStorage();
  storage.setItem(storageKey('progress'), 'previous progress bytes');
  storage.setItem(storageKey('goal'), '10');
  let calls = 0;
  storage.setItem = function (k, v) { if (k === storageKey('notebook') && ++calls === 1) throw new Error('QuotaExceededError'); this.data.set(k, String(v)); };
  assert.throws(() => writeWorkspaceStores(storage, stores, { preRestore: { copy: true } }), /returned to its previous saved state/);
  assert.equal(storage.getItem(storageKey('progress')), 'previous progress bytes');
  assert.equal(storage.getItem(storageKey('goal')), '10');
  assert.equal(storage.getItem(storageKey('history')), null);
  assert.ok(storage.getItem(storageKey('pre-restore')));
  const full = memoryStorage({ failOn: k => k === storageKey('pre-restore') });
  full.data.set(storageKey('goal'), '10');
  assert.throws(() => writeWorkspaceStores(full, stores, { preRestore: {} }), /pre-restore copy/);
  assert.equal(full.getItem(storageKey('goal')), '10');
  assert.equal(full.data.size, 1);
  const ok = memoryStorage();
  writeWorkspaceStores(ok, stores, { preRestore: {} });
  assert.equal(JSON.parse(ok.getItem(storageKey('goal'))), 20);
  assert.equal(ok.getItem(storageKey('unresolved')), null, 'an empty held list is not stored');
});

test('a timed PYQ attempt that expires after export is restored as submitted at its deadline', () => {
  const stores = workspace();
  const file = JSON.stringify(createWorkspaceBackup({ stores, contentBankId: BANK }));
  const deadline = stores.pyq.active.deadline;
  const plan = analyzeBackup(parseBackup(file), { registry: registry(), bankId: BANK, now: deadline + 3_600_000 });
  assert.equal(plan.stores.pyq.active, null);
  const submitted = plan.stores.pyq.history.find(s => s.id === stores.pyq.active.id);
  assert.equal(submitted.finishedAt, deadline, 'no extra time is granted');
  assert.match(plan.report.notes.join(' '), /reached its deadline after this backup was made/);
  // The same holds for a pre-restore copy returned to later.
  const copy = JSON.stringify(createWorkspaceBackup({ stores, kind: 'pre-restore' }));
  assert.equal(analyzeBackup(parseBackup(copy), { registry: registry(), bankId: BANK, now: deadline + 1 }).stores.pyq.history[0].finishedAt, deadline);
});
