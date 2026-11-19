import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  archiveWrittenReviewBlockers, validateWrittenPaper, writtenPaperGate, emptyWrittenWorkspace, saveWrittenWork,
  addWrittenReview, writtenQuestionReport, restoreWrittenWorkspace, exportWrittenReview, MAX_WORK_LENGTH, NO_AUTOMATIC_JUDGMENT,
} from '../src/content/written-review.js';

const now = 1_760_000_000_000;
const realArchive = JSON.parse(await readFile(new URL('../data/archive.json', import.meta.url), 'utf8'));

// SYNTHETIC FIXTURE. This is not a historical JEE question, and its rubric and
// marking instructions are invented solely to exercise the software contract.
const archive = () => ({
  version: 1, checkedAt: '2026-11-11',
  sources: [{ id: 'fixture-source', title: 'Synthetic fixture source', url: 'https://example.org/fixture', authority: 'official', notes: 'Software test fixture only.' }],
  papers: [{ id: 'fixture-written-paper', year: 1990, exam: 'iit-jee', label: 'Synthetic written fixture', subject: 'all', paper: null, sourceId: 'fixture-source', url: 'https://example.org/fixture.pdf', sourceUrl: 'https://example.org/fixture', verification: 'pdf-verified', coverage: 'full-paper', questionCount: 1, durationMinutes: 180, maxMarks: 6, transcriptionStatus: 'source-linked' }],
});
const at = (pageNumber) => ({ url: 'https://example.org/fixture.pdf', page: pageNumber });
const paper = () => ({
  version: 1, paperId: 'fixture-written-paper',
  responseFormat: { kind: 'written-derivation', description: 'Synthetic: answers are written in full in an answer book.', source: at(1) },
  marking: { instructions: 'Synthetic: marks per step as printed in the fixture scheme.', source: at(2), recordedBy: 'Test author', recordedAt: '2026-11-19' },
  questions: [{
    id: 'fixture-written-q1', questionNumber: '1', subject: 'mathematics', source: at(3),
    statement: 'SYNTHETIC FIXTURE, not a historical question: show that the sum of the first n odd numbers is n².', maxMarks: 6,
    rubric: { source: at(4), partialMarksSource: at(4), criteria: [
      { id: 'setup', description: 'States the sum to be evaluated.', marks: 1, partialAllowed: false },
      { id: 'method', description: 'Valid method (induction or arithmetic series).', marks: 3, partialAllowed: true },
      { id: 'conclusion', description: 'Reaches n² with justification.', marks: 2, partialAllowed: false },
    ] },
    explanation: { steps: ['The kth odd number is 2k − 1.', 'Σ(2k − 1) = n(n + 1) − n = n².'], author: 'Test author', review: { status: 'unreviewed' } },
  }],
});
const q = 'fixture-written-q1';
const marks = (setup, method, conclusion) => [{ criterionId: 'setup', marks: setup }, { criterionId: 'method', marks: method }, { criterionId: 'conclusion', marks: conclusion }];
const expert = (extra = {}) => ({ kind: 'expert', reviewer: { name: 'Fixture Examiner' }, reviewedAt: '2026-11-19', evidence: 'Compared the work line by line with the fixture rubric.', criteria: marks(1, 2, 2), ...extra });

test('every legacy archive record is blocked from written review: none has recorded marking provenance', () => {
  const legacy = realArchive.papers.filter(p => p.year < 2007);
  assert.ok(legacy.length > 0);
  for (const record of legacy) {
    const source = realArchive.sources.find(s => s.id === record.sourceId);
    const reasons = archiveWrittenReviewBlockers(record, source);
    assert.ok(reasons.some(r => /not a complete paper/.test(r)), record.id);
    assert.ok(reasons.some(r => /maximum marks/.test(r)), record.id);
    // Even with a fully formed written-review record, the archive record blocks it.
    const gate = writtenPaperGate({ ...paper(), paperId: record.id }, realArchive);
    assert.equal(gate.publishable, false, record.id);
    assert.ok(gate.errors.some(e => e.startsWith('paper.paperId:')), record.id);
  }
});

test('the fixture passes the gate only with complete source-backed provenance', () => {
  assert.deepEqual(validateWrittenPaper(paper(), archive()), []);
  assert.equal(writtenPaperGate(paper(), archive()).publishable, true);
  const broken = [
    p => { delete p.marking; },
    p => { p.marking.source.page = 0; },
    p => { p.marking.recordedAt = '2026-02-30'; },
    p => { p.responseFormat.kind = 'multiple-choice'; },
    p => { p.questions[0].rubric.partialMarksSource = null; },
    p => { p.questions[0].rubric.criteria[0].marks = 2; },
    p => { p.questions[0].explanation.review = { status: 'expert-reviewed' }; },
    p => { p.questions.push(structuredClone(p.questions[0])); },
    p => { p.questions[0].autoGrade = true; },
  ];
  for (const mutate of broken) { const value = paper(); mutate(value); assert.equal(writtenPaperGate(value, archive()).publishable, false, mutate.toString()); }
  assert.equal(writtenPaperGate(paper(), undefined).publishable, false);
  const partial = archive(); partial.papers[0].coverage = 'partial-collection';
  assert.equal(writtenPaperGate(paper(), partial).publishable, false);
});

test('a question with no review is unreviewed with unknown marks, not zero', () => {
  let w = emptyWrittenWorkspace('fixture-written-paper');
  let report = writtenQuestionReport(w, paper(), archive(), q, now);
  assert.equal(report.status, 'unreviewed'); assert.equal(report.awardedMarks, null); assert.equal(report.unknownCriteria, 3);
  assert.ok(report.criteria.every(c => c.marks === null));
  w = saveWrittenWork(w, paper(), archive(), q, 'Σ(2k−1) = 2·n(n+1)/2 − n = n²', now);
  report = writtenQuestionReport(w, paper(), archive(), q, now);
  assert.equal(report.hasWork, true); assert.equal(report.status, 'unreviewed'); assert.equal(report.automaticCorrectnessJudgment, false);
  assert.throws(() => saveWrittenWork(w, paper(), archive(), q, 'x'.repeat(MAX_WORK_LENGTH + 1), now));
  assert.throws(() => saveWrittenWork(w, paper(), archive(), 'missing-q', 'work', now));
});

test('sample responses receive marks only from recorded self and expert reviews against the rubric', () => {
  let w = saveWrittenWork(emptyWrittenWorkspace('fixture-written-paper'), paper(), archive(), q, 'Sample A: uses induction, conclusion stated without proof.', now);
  // Self review with one criterion left unknown: no total is claimed.
  w = addWrittenReview(w, paper(), archive(), q, { kind: 'self', criteria: [{ criterionId: 'setup', marks: 1 }, { criterionId: 'method', marks: 1.5 }, { criterionId: 'conclusion', marks: null }] }, now + 1);
  let report = writtenQuestionReport(w, paper(), archive(), q, now + 1);
  assert.equal(report.status, 'self-reviewed'); assert.equal(report.markedBy, 'self');
  assert.equal(report.awardedMarks, null); assert.equal(report.recordedMarks, 2.5); assert.equal(report.unknownCriteria, 1);
  // A later expert review takes precedence over self review and is distinguished.
  w = addWrittenReview(w, paper(), archive(), q, expert(), now + 2);
  report = writtenQuestionReport(w, paper(), archive(), q, now + 2);
  assert.equal(report.status, 'expert-reviewed'); assert.equal(report.awardedMarks, 5);
  assert.deepEqual(report.reviewKinds, { self: 1, expert: 1, automatedAssist: 0 });
  // A further self review does not overwrite the expert record.
  w = addWrittenReview(w, paper(), archive(), q, { kind: 'self', criteria: marks(1, 3, 2) }, now + 3);
  assert.equal(writtenQuestionReport(w, paper(), archive(), q, now + 3).awardedMarks, 5);
});

test('partial marks are bounded by the rubric and the source permission', () => {
  const w = emptyWrittenWorkspace('fixture-written-paper');
  const add = criteria => addWrittenReview(w, paper(), archive(), q, { kind: 'self', criteria }, now);
  assert.throws(() => add(marks(0.5, 3, 2)), /does not permit partial/);
  assert.throws(() => add(marks(1, 3.5, 2)), /from 0 to 3/);
  assert.throws(() => add(marks(1, -1, 2)), /from 0 to 3/);
  assert.throws(() => add(marks(1, 2, 1)), /does not permit partial/);
  assert.throws(() => add(marks(1, 2, 2).slice(0, 2)), /every rubric criterion/);
  assert.throws(() => add([...marks(1, 2, 2).slice(0, 2), { criterionId: 'setup', marks: 1 }]), /repeated/);
  assert.equal(writtenQuestionReport(add(marks(0, 2.25, 0)), paper(), archive(), q, now).awardedMarks, 2.25);
  const noPartial = paper(); noPartial.questions[0].rubric.partialMarksSource = null;
  noPartial.questions[0].rubric.criteria[1].partialAllowed = false;
  assert.throws(() => addWrittenReview(w, noPartial, archive(), q, { kind: 'self', criteria: marks(1, 2, 2) }, now), /does not permit partial/);
});

test('expert reviews need identity, date and evidence; automated assistance cannot score or judge', () => {
  const w = emptyWrittenWorkspace('fixture-written-paper');
  const add = review => addWrittenReview(w, paper(), archive(), q, review, now);
  assert.throws(() => add(expert({ reviewer: {} })), /name its reviewer/);
  assert.throws(() => add(expert({ reviewedAt: 'yesterday' })), /date/);
  assert.throws(() => add(expert({ evidence: '' })), /evidence/);
  const tool = { name: 'Fixture assistant', version: '0.0-test' };
  for (const field of ['criteria', 'marks', 'score', 'status', 'verdict', 'correct']) {
    assert.throws(() => add({ kind: 'automated-assist', tool, annotations: ['Check the final step.'], [field]: field === 'criteria' ? marks(1, 3, 2) : 6 }), /cannot award marks/);
  }
  assert.throws(() => add({ kind: 'automated-assist', annotations: ['note'] }), /tool/);
  const assisted = add({ kind: 'automated-assist', tool, annotations: ['The induction step does not state its hypothesis.'] });
  const report = writtenQuestionReport(assisted, paper(), archive(), q, now);
  assert.equal(report.status, 'unreviewed'); assert.equal(report.awardedMarks, null); assert.equal(report.reviewKinds.automatedAssist, 1);
  assert.throws(() => add({ kind: 'model-grade', criteria: marks(1, 3, 2) }), /unknown review kind/);
});

test('persistence round-trips, discards injected totals and rejects tampering', () => {
  let w = saveWrittenWork(emptyWrittenWorkspace('fixture-written-paper'), paper(), archive(), q, 'Sample B', now);
  w = addWrittenReview(w, paper(), archive(), q, expert(), now + 1);
  const raw = JSON.stringify(w);
  assert.deepEqual(restoreWrittenWorkspace(raw, paper(), archive(), now + 2), w);
  const injected = JSON.parse(raw); injected.score = 6; injected.entries[0].status = 'expert-reviewed'; injected.entries[0].awardedMarks = 6;
  const clean = restoreWrittenWorkspace(JSON.stringify(injected), paper(), archive(), now + 2);
  assert.deepEqual(clean, w); assert.equal(clean.score, undefined); assert.equal(clean.entries[0].awardedMarks, undefined);
  for (const mutate of [
    v => { v.version = 2; }, v => { v.paperId = 'other'; }, v => { v.entries[0].questionId = 'missing'; },
    v => { v.entries.push(structuredClone(v.entries[0])); }, v => { v.entries[0].reviews[0].criteria[1].marks = 9; },
    v => { v.entries[0].reviews[0].reviewer = {}; }, v => { v.entries[0].work.text = 'x'.repeat(MAX_WORK_LENGTH + 1); },
    v => { v.entries[0].reviews.push({ kind: 'automated-assist', createdAt: now, tool: { name: 't', version: '1' }, annotations: ['a'], marks: 6 }); },
    v => { v.entries[0].reviews[0].createdAt = now + 10_000_000; },
  ]) { const v = JSON.parse(raw); mutate(v); assert.equal(restoreWrittenWorkspace(JSON.stringify(v), paper(), archive(), now + 2), null, mutate.toString()); }
  assert.equal(restoreWrittenWorkspace('{', paper(), archive(), now), null);
  assert.equal(restoreWrittenWorkspace(raw, { ...paper(), marking: undefined }, archive(), now), null);
  const legacy = realArchive.papers.find(p => p.year < 2007);
  assert.throws(() => emptyWrittenWorkspace(''));
  assert.throws(() => saveWrittenWork(emptyWrittenWorkspace(legacy.id), { ...paper(), paperId: legacy.id }, realArchive, q, 'work', now), /not source-backed/);
});

test('export carries identity, rubric provenance, reviewer kinds and statuses without automatic judgment', () => {
  let w = saveWrittenWork(emptyWrittenWorkspace('fixture-written-paper'), paper(), archive(), q, 'Sample C', now);
  w = addWrittenReview(w, paper(), archive(), q, { kind: 'self', criteria: marks(1, 3, null) }, now + 1);
  w = addWrittenReview(w, paper(), archive(), q, { kind: 'automated-assist', tool: { name: 'Fixture assistant', version: '0.0-test' }, annotations: ['Conclusion not written.'] }, now + 2);
  const exported = JSON.parse(exportWrittenReview(w, paper(), archive(), now + 3));
  assert.equal(exported.kind, 'written-review-report'); assert.equal(exported.notice, NO_AUTOMATIC_JUDGMENT);
  assert.deepEqual(exported.paper.marking, paper().marking);
  const [row] = exported.questions;
  assert.equal(row.questionId, q); assert.equal(row.questionNumber, '1');
  assert.deepEqual(row.rubricSource, at(4)); assert.deepEqual(row.partialMarksSource, at(4));
  assert.equal(row.status, 'self-reviewed'); assert.equal(row.markedBy, 'self'); assert.equal(row.awardedMarks, null); assert.equal(row.unknownCriteria, 1);
  assert.deepEqual(row.reviews.map(r => r.kind), ['self', 'automated-assist']);
  assert.equal(row.automaticCorrectnessJudgment, false);
  assert.equal(row.explanationReview.status, 'unreviewed');
  assert.ok(!/"(correct|isCorrect|verdict)"/.test(JSON.stringify(exported)));
  const fresh = JSON.parse(exportWrittenReview(emptyWrittenWorkspace('fixture-written-paper'), paper(), archive(), now));
  assert.equal(fresh.questions[0].status, 'unreviewed'); assert.equal(fresh.questions[0].work, null);
});
