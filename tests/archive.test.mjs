import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, cp, rm, readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {archiveStats, filterPapers, validateArchive} from '../src/archive/index.js';
import {validateQuestionImport, validateQuestionCatalog} from '../src/archive/questions.js';

const source = {id: 'official', title: 'Official archive', url: 'https://example.org/archive', authority: 'official', notes: ''};
function paper(overrides = {}) {
  return {id: '2024-p1', year: 2024, exam: 'jee-advanced', label: '2024 paper 1', subject: 'all', paper: 1, sourceId: 'official', url: 'https://example.org/2024.pdf', sourceUrl: source.url, verification: 'link-observed', coverage: 'full-paper', questionCount: null, durationMinutes: null, maxMarks: null, transcriptionStatus: 'source-linked', ...overrides};
}
const manifest = () => ({version: 1, checkedAt: '2026-11-11', sources: [source], papers: [paper()]});
const review = () => ({reviewer: 'Editorial reviewer', reviewedAt: '2026-11-11', sourceUrl: 'https://example.org/key.pdf'});
function bundle() {
  return {version: 1, questions: [{id: 'jee-2024-p1-physics-s1-q1', paperId: '2024-p1', year: 2024, exam: 'jee-advanced', subject: 'physics', section: '1', questionNumber: '1', source: {url: 'https://example.org/2024.pdf', page: 3}, statement: 'Synthetic schema fixture, not an official question.', options: [{id: 'A', text: 'Choice A'}, {id: 'B', text: 'Choice B'}, {id: 'C', text: 'Choice C'}], answer: {type: 'multiple-choice', value: ['A', 'B']}, marking: {correct: 4, incorrect: -2, unanswered: 0, partialCredits: [{selected: ['A'], marks: 1}]}, review: {transcript: review(), answer: review(), marking: review()}, status: 'practice-ready'}]};
}

test('catalog accepts unknown marks and counts without inventing values', () => {
  assert.deepEqual(validateArchive(manifest()), []);
  const stats = archiveStats(manifest());
  assert.equal(stats.fullPaperCount, 1);
  assert.equal(stats.practiceReadyCount, 0);
  assert.equal(stats.pdfVerifiedCount, 0);
});
test('distinct listed years and complete paper counts are independent', () => {
  const value = manifest();
  value.sources.push({id: 'third', title: 'Historical collection', url: 'https://example.net', authority: 'third-party', notes: 'Partial'});
  value.papers.push(paper({id: '2024-p2', paper: 2}), paper({id: '1980', year: 1980, exam: 'iit-jee', paper: null, sourceId: 'third', coverage: 'partial-collection'}));
  const stats = archiveStats(value);
  assert.deepEqual(stats.yearsListed, [1980, 2024]);
  assert.equal(stats.yearCount, 2);
  assert.equal(stats.paperCount, 3);
  assert.equal(stats.fullPaperCount, 2);
  assert.equal(stats.partialCollectionCount, 1);
  assert.equal(stats.thirdPartyPaperCount, 1);
});
test('filters compose, include all-subject papers, and do not mutate input', () => {
  const papers = [paper(), paper({id: 'old', year: 2010, exam: 'iit-jee'}), paper({id: 'chem', subject: 'chemistry', label: 'Chemistry'})];
  const before = structuredClone(papers);
  assert.deepEqual(filterPapers(papers, {era: 'jee-advanced', subject: 'physics', from: 2020, to: 2024, query: '2024', authority: 'official', sources: [source]}).map(p => p.id), ['2024-p1']);
  assert.deepEqual(filterPapers(papers, {from: 2025}), []);
  assert.deepEqual(papers, before);
});
test('archive rejects unknown sources, duplicate identities, credentials, and fake era', () => {
  const value = manifest();
  value.papers.push(paper({sourceId: 'missing', year: 1990, url: 'https://user:password@example.org/x'}));
  const errors = validateArchive(value).join('\n');
  for (const pattern of [/duplicate/, /unknown source/, /credentials/, /starts in 2013/]) assert.match(errors, pattern);
});
test('archive rejects impossible dates, schema expansion, and inflated transcription claims', () => {
  const value = manifest();
  value.checkedAt = '2026-02-30';
  value.completeYears = 49;
  value.papers[0].transcriptionStatus = 'practice-ready';
  value.papers[0].questionCount = -1;
  const errors = validateArchive(value).join('\n');
  assert.match(errors, /real YYYY-MM-DD/);
  assert.match(errors, /unknown field/);
  assert.match(errors, /source-linked/);
  assert.match(errors, /positive integer/);
});
test('valid reviewed structured batch passes; fixture does not claim official provenance', () => {
  assert.deepEqual(validateQuestionImport(bundle()), []);
});
test('missing source page, answer review, or marking cannot be staged', () => {
  for (const field of ['page', 'answer', 'marking']) {
    const value = bundle();
    if (field === 'page') delete value.questions[0].source.page;
    if (field === 'answer') delete value.questions[0].review.answer;
    if (field === 'marking') delete value.questions[0].marking;
    assert.ok(validateQuestionImport(value).length > 0, field);
  }
});
test('ambiguous keys and partial credit for wrong options are refused', () => {
  const value = bundle();
  value.questions[0].answer.value = ['A', 'A'];
  value.questions[0].marking.partialCredits = [{selected: ['C'], marks: 1}];
  const errors = validateQuestionImport(value).join('\n');
  assert.match(errors, /distinct correct option/);
  assert.match(errors, /proper subset/);
});
test('numeric import requires explicit exact decimal and valid optional range', () => {
  const value = bundle();
  const q = value.questions[0];
  delete q.options;
  delete q.marking.partialCredits;
  q.answer = {type: 'numeric', value: '1.25', acceptedRange: ['1.24', '1.26']};
  assert.deepEqual(validateQuestionImport(value), []);
  q.answer.acceptedRange = ['1.26', '1.24'];
  assert.match(validateQuestionImport(value).join('\n'), /acceptedRange/);
});
test('duplicate paper question identity is refused even with a different ID', () => {
  const value = bundle();
  value.questions.push({...structuredClone(value.questions[0]), id: 'another-id'});
  assert.match(validateQuestionImport(value).join('\n'), /duplicate paper/);
});
test('staged questions resolve to catalog identity and source, while answer evidence remains independent', () => {
  assert.deepEqual(validateQuestionCatalog(bundle(), manifest()), []);
  const value = bundle();
  value.questions[0].source.url = source.url;
  value.questions[0].review.answer.sourceUrl = 'https://independent.example.org/final-key.pdf';
  assert.deepEqual(validateQuestionCatalog(value, manifest()), []);
});
test('unknown papers, year or era mismatch, subject mismatch, and unrelated source URLs are rejected', () => {
  for (const [field, changed, pattern] of [
    ['paperId', 'nonexistent', /paperId: not found/],
    ['year', 2023, /year: does not match/],
    ['exam', 'iit-jee', /invalid exam era/],
  ]) {
    const value = bundle();
    value.questions[0][field] = changed;
    assert.match(validateQuestionCatalog(value, manifest()).join('\n'), pattern);
  }
  const value = bundle();
  value.questions[0].source.url = 'https://unrelated.example.org/source.pdf';
  const catalog = manifest();
  catalog.papers[0].subject = 'chemistry';
  assert.match(validateQuestionCatalog(value, catalog).join('\n'), /subject: does not match/);
  assert.match(validateQuestionCatalog(value, catalog).join('\n'), /source.url: must match/);
  const oldPaper = manifest();
  oldPaper.papers[0].year = 2012;
  oldPaper.papers[0].exam = 'iit-jee';
  assert.match(validateQuestionCatalog(bundle(), oldPaper).join('\n'), /exam: does not match/);
});
test('CLI performs no partial write and refuses duplicate staged content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vedaris-import-test-'));
  try {
    const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
    await mkdir(join(root, 'scripts'), {recursive: true});
    await cp(join(sourceRoot, 'src/archive'), join(root, 'src/archive'), {recursive: true});
    await cp(join(sourceRoot, 'scripts/import-pyq.mjs'), join(root, 'scripts/import-pyq.mjs'));
    await writeFile(join(root, 'package.json'), '{"type":"module"}');
    await mkdir(join(root, 'data'), {recursive: true});
    await writeFile(join(root, 'data/archive.json'), JSON.stringify(manifest()));
    const invalid = bundle();
    invalid.questions.push({...structuredClone(invalid.questions[0]), id: 'bad', statement: ''});
    await writeFile(join(root, 'bad.json'), JSON.stringify(invalid));
    let result = spawnSync(process.execPath, ['scripts/import-pyq.mjs', 'bad.json'], {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, 1);
    await assert.rejects(readdir(join(root, 'data/imports/validated')), {code: 'ENOENT'});
    await writeFile(join(root, 'good.json'), JSON.stringify(bundle()));
    const missingCatalog = manifest();
    missingCatalog.papers = [];
    await writeFile(join(root, 'other-catalog.json'), JSON.stringify(missingCatalog));
    result = spawnSync(process.execPath, ['scripts/import-pyq.mjs', 'good.json', '--catalog', 'other-catalog.json'], {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /paperId: not found/);
    await assert.rejects(readdir(join(root, 'data/imports/validated')), {code: 'ENOENT'});
    result = spawnSync(process.execPath, ['scripts/import-pyq.mjs', 'good.json'], {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    const saved = await readFile(join(root, 'data/imports/validated/good.json'), 'utf8');
    await writeFile(join(root, 'duplicate.json'), JSON.stringify(bundle()));
    result = spawnSync(process.execPath, ['scripts/import-pyq.mjs', 'duplicate.json'], {cwd: root, encoding: 'utf8'});
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Duplicate question identity/);
    assert.equal(await readFile(join(root, 'data/imports/validated/good.json'), 'utf8'), saved);
    assert.deepEqual(await readdir(join(root, 'data/imports/validated')), ['good.json']);
  } finally { await rm(root, {recursive: true, force: true}); }
});
