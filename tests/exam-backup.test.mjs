import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { prepareContent } from '../scripts/build-content.mjs';
import { createContentRegistry } from '../src/content/catalog.js';
import { answerHistorical, finishHistorical, emptyHistoricalWorkspace, saveHistoricalSession, createHistoricalSession } from '../src/content/session.js';
import { startExam, advanceExam, startSecondPaper, examReport, restoreExamWorkspace } from '../src/content/exam.js';
import { createWorkspaceBackup, parseBackup, analyzeBackup, mergeWorkspace, replaceWorkspace, emptyWorkspaceStores } from '../src/learning/backup.js';

// Complete workspace backups must carry two-paper exam state (PYQ workspace
// version 2) through export, restore, merge and replace, using the real
// reviewed registry and the same validator the workspace uses on load.
const root = new URL('../', import.meta.url).pathname;
const archive = JSON.parse(await readFile(new URL('../data/archive.json', import.meta.url), 'utf8'));
const assets = (await readdir(new URL('../assets/content', import.meta.url), { recursive: true })).map(p => `assets/content/${p}`);
const content = await prepareContent(root, archive, assets);
const catalog = JSON.parse(content.inputs.get('data/content/catalog.json'));
const registry = createContentRegistry({ archive, bundles: catalog.bundles.map(b => JSON.parse(content.inputs.get(b.path)).bundle), papers: catalog.papers, availableAssets: catalog.availableAssets });
const BANK = catalog.bankId, MIN = 60000, T = Date.UTC(2026, 10, 19, 3, 30);
const id2023 = 'jee-advanced-2023-two-paper-v1', id2025 = 'jee-advanced-2025-two-paper-v1';
const answer = (s, at) => { const q = registry.getQuestion(s.questionIds[0]); return answerHistorical(s, 0, q.type === 'multiple' ? ['A'] : q.type === 'numerical' ? '1' : 'A', registry, at); };
const save = (w, s) => advanceExam(saveHistoricalSession(w, s));

const midPaper1 = () => save(startExam(emptyHistoricalWorkspace(BANK), registry, id2023, { seed: 7, now: T }), answer(startExam(emptyHistoricalWorkspace(BANK), registry, id2023, { seed: 7, now: T }).active, T + 5 * MIN));
const onBreak = () => save(midPaper1(), finishHistorical(midPaper1().active, T + 40 * MIN));
const midPaper2 = () => { const w = startSecondPaper(onBreak(), registry, { seed: 9, now: T + 100 * MIN }); return save(w, answer(w.active, T + 105 * MIN)); };
const completed = () => save(midPaper2(), finishHistorical(midPaper2().active, T + 200 * MIN));
const file = (pyq, extra = {}) => JSON.stringify(createWorkspaceBackup({ stores: { ...emptyWorkspaceStores(), pyq, ...extra }, contentBankId: BANK, now: T }));
const analyze = (raw, now) => analyzeBackup(parseBackup(raw), { registry, bankId: BANK, now });
// What the workspace itself would load from the same JSON at the same time.
const loaded = (pyq, now) => restoreExamWorkspace(JSON.stringify(pyq), registry, BANK, now);

test('backups made mid-Paper 1, on the break, mid-Paper 2 and after the exam restore exactly as the workspace loads them', () => {
  for (const [label, pyq, now] of [['paper1', midPaper1(), T + 10 * MIN], ['break', onBreak(), T + 60 * MIN], ['paper2', midPaper2(), T + 110 * MIN], ['complete', completed(), T + 210 * MIN]]) {
    const raw = file(pyq);
    assert.equal(JSON.parse(raw).version, 2, label);
    assert.equal(JSON.parse(raw).stores.pyq.version, 2, `${label}: exam state is exported`);
    const plan = analyze(raw, now);
    assert.deepEqual(plan.stores.pyq, loaded(pyq, now), label);
    assert.equal(plan.report.unresolved.length, 0, label);
    // Replace writes exactly that workspace; it reloads unchanged.
    const replaced = replaceWorkspace(emptyWorkspaceStores(), { pyq: plan.stores.pyq }).stores.pyq;
    assert.deepEqual(loaded(replaced, now), plan.stores.pyq, `${label}: replace reloads unchanged`);
  }
  const mid = analyze(file(midPaper1()), T + 10 * MIN).stores.pyq;
  assert.equal(mid.exam.phase, 'paper1'); assert.equal(mid.active.deadline, T + 180 * MIN, 'restore never adds time');
  const done = analyze(file(completed()), T + 210 * MIN).stores.pyq;
  assert.equal(done.exam, null); assert.equal(done.exams[0].phase, 'complete');
  const before = examReport(completed().exams[0], registry), after = examReport(done.exams[0], registry);
  assert.deepEqual([after.papers[0].report.score, after.papers[1].report.score, after.combined.score], [before.papers[0].report.score, before.papers[1].report.score, before.combined.score]);
});

test('a paper whose deadline passes after export is submitted at it; the break starts then and Paper 2 still gets its full time', () => {
  const plan = analyze(file(midPaper1()), T + 500 * MIN);
  const w = plan.stores.pyq;
  assert.equal(w.exam.phase, 'break'); assert.equal(w.active, null);
  assert.equal(w.exam.breakStartedAt, T + 180 * MIN); assert.equal(w.exam.papers[0].finishedAt, T + 180 * MIN);
  assert.match(plan.report.notes.join(' '), /Paper 1 of the two-paper exam reached its deadline/);
  const p2 = startSecondPaper(w, registry, { seed: 11, now: T + 501 * MIN });
  assert.equal(p2.active.deadline - p2.active.startedAt, 180 * MIN);
  const late2 = analyze(file(midPaper2()), T + 1000 * MIN);
  assert.equal(late2.stores.pyq.exam, null); assert.equal(late2.stores.pyq.exams[0].finishedAt, T + 280 * MIN);
  assert.match(late2.report.notes.join(' '), /restored as completed at that deadline/);
});

test('tampered exam state in a backup is refused; version 1 PYQ data may not carry exam fields', () => {
  const pyq = onBreak();
  assert.throws(() => analyze(file({ ...pyq, exam: { ...pyq.exam, breakStartedAt: pyq.exam.breakStartedAt + 30 * MIN } }), T + 90 * MIN), /PYQ data in this backup failed validation/);
  const done = completed();
  assert.throws(() => analyze(file({ ...done, exams: [{ ...done.exams[0], papers: [done.exams[0].papers[0], { ...done.exams[0].papers[1], startedAt: done.exams[0].papers[1].startedAt - 60 * MIN }] }] }), T + 300 * MIN), /two-paper exam failed validation/);
  assert.throws(() => analyze(file({ ...pyq, version: 1 }), T + 90 * MIN), /PYQ data in this backup is malformed/);
  // An exam whose schedule configuration is not in this release is held, not dropped.
  const held = analyze(file({ ...done, exams: [{ ...done.exams[0], configId: 'jee-advanced-1999-two-paper-v1' }] }), T + 300 * MIN);
  assert.equal(held.stores.pyq.exams, undefined, 'no exams remain, so the workspace is version 1');
  assert.deepEqual(held.report.unresolved.map(i => i.store), ['pyq-exam']);
});

test('older backups still restore: version 1 complete backups and PYQ-only exports of either version', () => {
  const legacy = saveHistoricalSession(emptyHistoricalWorkspace(BANK), finishHistorical(createHistoricalSession(registry, { paperId: 'official-2023-paper-1-en', bankId: BANK, seed: 5, now: T }), T + MIN));
  const v1 = JSON.parse(file(legacy)); v1.version = 1;
  const plan = analyze(JSON.stringify(v1), T + 2 * MIN);
  assert.equal(plan.version, 1); assert.deepEqual(plan.stores.pyq, legacy, 'a version 1 workspace keeps its version 1 shape');
  const pyqOnly = analyze(JSON.stringify(midPaper2()), T + 110 * MIN);
  assert.equal(pyqOnly.source, 'legacy-pyq'); assert.equal(pyqOnly.stores.pyq.exam.phase, 'paper2');
});

test('merge keeps this browser’s unfinished exam, adds finished exams, and adopts a backup exam only when nothing is in progress', () => {
  const now = T + 210 * MIN;
  const incoming = analyze(file(completed()), now).stores;
  // This browser is mid-way through a different exam.
  const current = { ...emptyWorkspaceStores(), pyq: loaded(startExam(emptyHistoricalWorkspace(BANK), registry, id2025, { seed: 21, now: T + 205 * MIN }), now) };
  const merged = mergeWorkspace(current, incoming, { registry, bankId: BANK, now });
  assert.equal(merged.stores.pyq.exam.configId, id2025, 'the exam in progress here is kept');
  assert.equal(merged.stores.pyq.exams.length, 1); assert.equal(merged.stores.pyq.exams[0].configId, id2023);
  // A backup's unfinished exam is not merged over it…
  const busy = mergeWorkspace(current, analyze(file(onBreak()), now).stores, { registry, bankId: BANK, now });
  assert.equal(busy.stores.pyq.exam.configId, id2025);
  assert.match(busy.notes.join(' '), /unfinished work is not merged/);
  // …but is adopted, still on its break, by a browser with nothing in progress.
  const idle = { ...emptyWorkspaceStores(), pyq: loaded(emptyHistoricalWorkspace(BANK), now) };
  const adopted = mergeWorkspace(idle, analyze(file(onBreak()), now).stores, { registry, bankId: BANK, now });
  assert.equal(adopted.stores.pyq.exam.phase, 'break'); assert.equal(adopted.stores.pyq.exam.breakStartedAt, T + 40 * MIN);
  // Merging the same finished exam twice keeps one copy.
  assert.equal(mergeWorkspace(merged.stores, incoming, { registry, bankId: BANK, now }).stores.pyq.exams.length, 1);
});
