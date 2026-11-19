import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { prepareContent } from '../scripts/build-content.mjs';
import { createContentRegistry } from '../src/content/catalog.js';
import { answerHistorical, finishHistorical, emptyHistoricalWorkspace, saveHistoricalSession, createHistoricalSession } from '../src/content/session.js';
import { EXAM_CONFIGS, resolveExamConfig, examAvailability, startExam, advanceExam, startSecondPaper, cancelExam, examReport, restoreExamWorkspace } from '../src/content/exam.js';

// The real reviewed registry, compiled exactly as the build does.
const root = new URL('../', import.meta.url).pathname;
const archive = JSON.parse(await readFile(new URL('../data/archive.json', import.meta.url), 'utf8'));
const assets = (await readdir(new URL('../assets/content', import.meta.url), { recursive: true })).map(p => `assets/content/${p}`);
const content = await prepareContent(root, archive, assets);
const catalog = JSON.parse(content.inputs.get('data/content/catalog.json'));
const registry = createContentRegistry({ archive, bundles: catalog.bundles.map(b => JSON.parse(content.inputs.get(b.path)).bundle), papers: catalog.papers, availableAssets: catalog.availableAssets });
const BANK = catalog.bankId, MIN = 60000, T = Date.UTC(2026, 10, 19, 3, 30);
const empty = () => emptyHistoricalWorkspace(BANK);
const reload = (workspace, now) => restoreExamWorkspace(JSON.stringify(workspace), registry, BANK, now);
const id2023 = 'jee-advanced-2023-two-paper-v1';

test('every configuration is source-backed and agrees with both reviewed papers', () => {
  assert.deepEqual(EXAM_CONFIGS.map(c => c.year), [2022, 2023, 2024, 2025, 2026]);
  for (const c of EXAM_CONFIGS) {
    const r = resolveExamConfig(c, registry);
    assert.equal(r.breakMinutes, 150, `${c.year} break is derived from 12:00 → 14:30`);
    assert.deepEqual(r.papers.map(p => [p.year, p.paper, p.durationMinutes]), [[c.year, 1, 180], [c.year, 2, 180]]);
    assert.equal(r.maxMarks, 360);
    assert.match(c.source.url, new RegExp(`^https://jeeadv\\.ac\\.in/reports/${c.year}\\.pdf$`));
    assert.match(c.source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isInteger(c.source.page) && c.review.reviewer.includes('not human review'));
  }
  assert.ok(examAvailability(registry).every(row => row.available));
});

test('unsupported years stay unavailable; no universal timing is applied', () => {
  const years = examAvailability(registry, EXAM_CONFIGS.filter(c => c.year !== 2024));
  assert.equal(years.find(r => r.year === 2024).available, false);
  assert.match(years.find(r => r.year === 2024).reason, /No source-backed two-paper schedule is recorded for 2024/);
  const wrongClock = { ...EXAM_CONFIGS[0], schedule: { ...EXAM_CONFIGS[0].schedule, papers: [{ start: '09:00', end: '11:00' }, { start: '14:30', end: '17:30' }] } };
  assert.throws(() => resolveExamConfig(wrongClock, registry), /does not match its reviewed 180-minute duration/);
  const wrongYear = { ...EXAM_CONFIGS[0], year: 2023 };
  assert.throws(() => resolveExamConfig(wrongYear, registry), /does not belong to 2023/);
  assert.throws(() => startExam(empty(), registry, 'jee-advanced-2019-two-paper-v1', { seed: 1, now: T }), /not available/);
});

test('submitting Paper 1 starts the break; Paper 2 gets its full time only when begun; reload at each transition', () => {
  let w = startExam(empty(), registry, id2023, { seed: 7, now: T });
  assert.equal(w.version, 2); assert.equal(w.exam.phase, 'paper1');
  const p1 = w.active; assert.equal(p1.deadline, T + 180 * MIN);
  w = reload(w, T + 5 * MIN); assert.equal(w.exam.phase, 'paper1'); assert.equal(w.active.deadline, T + 180 * MIN, 'reload never adds time');
  w = advanceExam(saveHistoricalSession(w, answerHistorical(w.active, 0, registry.getQuestion(w.active.questionIds[0]).type === 'multiple' ? ['A'] : registry.getQuestion(w.active.questionIds[0]).type === 'numerical' ? '1' : 'A', registry, T + 6 * MIN)));
  w = advanceExam(saveHistoricalSession(w, finishHistorical(w.active, T + 40 * MIN)));
  assert.equal(w.exam.phase, 'break'); assert.equal(w.exam.breakStartedAt, T + 40 * MIN); assert.equal(w.active, null);
  w = reload(w, T + 100 * MIN); assert.equal(w.exam.phase, 'break'); assert.equal(w.exam.papers[0].finishedAt, T + 40 * MIN);
  assert.throws(() => startExam(w, registry, id2023, { seed: 8, now: T + 101 * MIN }), /Finish or end/);
  // A long break: Paper 2 still receives all 180 minutes from when it is begun.
  w = startSecondPaper(w, registry, { seed: 9, now: T + 300 * MIN });
  assert.equal(w.exam.phase, 'paper2'); assert.equal(w.active.deadline, T + 480 * MIN); assert.equal(w.exam.breakEndedAt, T + 300 * MIN);
  assert.throws(() => startSecondPaper(w, registry, { seed: 10, now: T + 301 * MIN }), /only from the inter-paper break/);
  w = reload(w, T + 310 * MIN); assert.equal(w.exam.phase, 'paper2'); assert.equal(w.active.deadline, T + 480 * MIN);
  w = advanceExam(saveHistoricalSession(w, finishHistorical(w.active, T + 400 * MIN)));
  assert.equal(w.exam, null); assert.equal(w.exams[0].phase, 'complete');
  w = reload(w, T + 401 * MIN); assert.equal(w.exams.length, 1);
  const r = examReport(w.exams[0], registry);
  assert.equal(r.complete, true); assert.equal(r.combined.maxScore, 360); assert.equal(r.breakMs, 260 * MIN); assert.equal(r.scheduledBreakMs, 150 * MIN);
  assert.equal(r.papers[0].report.maxScore, 180); assert.equal(r.papers[1].report.maxScore, 180);
  assert.equal(r.combined.score, r.papers[0].report.score + r.papers[1].report.score);
  assert.equal(r.subjects.length, 3); assert.ok(r.subjects.every(s => s.maxScore === 120 && s.byPaper.length === 2));
});

test('papers that expire while the tab is closed end at their own deadlines and cannot be reopened', () => {
  let w = startExam(empty(), registry, id2023, { seed: 3, now: T });
  w = reload(w, T + 500 * MIN);
  assert.equal(w.exam.phase, 'break'); assert.equal(w.exam.breakStartedAt, T + 180 * MIN, 'the break starts at the Paper 1 deadline, not at reload');
  const done = w.exam.papers[0];
  assert.equal(answerHistorical(done, 0, '1', registry, T + 501 * MIN), done, 'a completed paper is not writable');
  w = startSecondPaper(w, registry, { seed: 4, now: T + 501 * MIN });
  w = reload(w, T + 2000 * MIN);
  assert.equal(w.exam, null); assert.equal(w.exams[0].phase, 'complete'); assert.equal(w.exams[0].papers[1].finishedAt, T + 681 * MIN);
  assert.throws(() => startSecondPaper(w, registry, { seed: 5, now: T + 2001 * MIN }), /only from the inter-paper break/);
});

test('cancellation at each phase keeps completed work and reports only completed papers', () => {
  const during1 = cancelExam(startExam(empty(), registry, id2023, { seed: 1, now: T }), T + 10 * MIN);
  assert.equal(during1.exams[0].phase, 'cancelled'); assert.equal(during1.exams[0].papers[0].finishedAt, T + 10 * MIN); assert.equal(during1.exams[0].papers[1], null); assert.equal(during1.active, null);
  let r = examReport(during1.exams[0], registry);
  assert.equal(r.complete, false); assert.equal(r.combined.maxScore, 180); assert.equal(r.combined.fullMaxScore, 360); assert.equal(r.papers[1].status, 'not attempted');
  let w = advanceExam(saveHistoricalSession(startExam(empty(), registry, id2023, { seed: 2, now: T }), finishHistorical(startExam(empty(), registry, id2023, { seed: 2, now: T }).active, T + 20 * MIN)));
  const duringBreak = cancelExam(w, T + 30 * MIN);
  assert.equal(duringBreak.exams[0].breakEndedAt, null); assert.equal(examReport(duringBreak.exams[0], registry).breakMs, null);
  w = startSecondPaper(w, registry, { seed: 3, now: T + 40 * MIN });
  const during2 = cancelExam(w, T + 50 * MIN);
  r = examReport(during2.exams[0], registry);
  assert.equal(r.combined.papersIncluded, 2); assert.equal(during2.exams[0].papers[1].finishedAt, T + 50 * MIN);
  assert.ok(reload(during2, T + 51 * MIN), 'cancelled exams restore');
  assert.throws(() => cancelExam(during2, T + 52 * MIN), /No exam/);
});

test('each paper keeps its own year-specific rules: 2026 penalties and counts differ from 2025', () => {
  const r2025 = resolveExamConfig(EXAM_CONFIGS.find(c => c.year === 2025), registry), r2026 = resolveExamConfig(EXAM_CONFIGS.find(c => c.year === 2026), registry);
  assert.deepEqual(r2026.papers.map(p => p.expectedQuestionCount), [48, 54]);
  assert.deepEqual(r2025.papers.map(p => p.expectedQuestionCount), [48, 48]);
  const penalty = r => [...new Set(r.papers.flatMap(p => p.sections.filter(s => s.type === 'multiple').map(s => s.marking.incorrect)))];
  assert.deepEqual(penalty(r2026), [-1]); assert.deepEqual(penalty(r2025), [-2]);
  for (const [year, expected] of [[2025, -2], [2026, -1]]) {
    let w = startExam(empty(), registry, `jee-advanced-${year}-two-paper-v1`, { seed: 1, now: T });
    const index = w.active.questionIds.findIndex(id => registry.getQuestion(id).type === 'multiple');
    const q = registry.getQuestion(w.active.questionIds[index]);
    const wrong = q.options.map(o => o.id).filter(id => !(q.acceptedOptionSets ?? [q.answer]).flat().includes(id)).slice(0, 1);
    const response = wrong.length ? wrong : q.options.map(o => o.id);
    w = advanceExam(saveHistoricalSession(w, finishHistorical(answerHistorical(w.active, index, response, registry, T + MIN), T + 2 * MIN)));
    const done = cancelExam(w, T + 3 * MIN);
    const report = examReport(done.exams[0], registry);
    assert.equal(report.papers[0].report.score, expected, `${year} multiple-correct penalty`);
  }
});

test('tampered or inconsistent exam state is refused; version 1 workspaces still load', () => {
  const legacy = saveHistoricalSession(empty(), finishHistorical(createHistoricalSession(registry, { paperId: 'official-2023-paper-1-en', bankId: BANK, seed: 5, now: T }), T + MIN));
  const restored = reload(legacy, T + 2 * MIN);
  assert.equal(restored.version, 1); assert.equal(restored.history.length, 1); assert.equal(restored.exam, null);
  let w = advanceExam(saveHistoricalSession(startExam(empty(), registry, id2023, { seed: 2, now: T }), finishHistorical(startExam(empty(), registry, id2023, { seed: 2, now: T }).active, T + 20 * MIN)));
  assert.equal(reload({ ...w, exam: { ...w.exam, breakStartedAt: T + 60 * MIN } }, T + 70 * MIN), null, 'the break cannot be moved');
  assert.equal(reload({ ...w, version: 1 }, T + 70 * MIN), null);
  assert.equal(reload({ ...w, exam: { ...w.exam, configId: 'jee-advanced-1999-two-paper-v1' } }, T + 70 * MIN), null);
  const p2 = startSecondPaper(w, registry, { seed: 3, now: T + 40 * MIN });
  assert.equal(reload({ ...p2, exam: { ...p2.exam, breakEndedAt: T + 30 * MIN } }, T + 41 * MIN), null, 'Paper 2 cannot claim an earlier start');
  assert.equal(reload({ ...p2, active: null }, T + 41 * MIN), null, 'the current paper must exist');
});
